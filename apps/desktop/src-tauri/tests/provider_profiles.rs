//! Provider 配置存储的测试（Task 1.3 Step 1）。
//!
//! 计划点名的六件事里，属于**存储这一半**的是：profile CRUD、**密钥不进文件**、
//! 修订号递增、以及"读不动就如实说"。
//!
//! 这里用**真的临时文件**而不是内存替身：原子写盘（临时文件 + 改名）与
//! "重启后还在"这两条性质，只有碰真文件才测得出来。

use mathcanvas_desktop_lib::repository::provider_profiles::{
    contains_secret_field, CapabilityEvidence, ProviderHealth, ProviderProfile, ProviderProfileStore, StoreError,
};

fn profile(id: &str, name: &str, model: &str) -> ProviderProfile {
    ProviderProfile {
        max_output_tokens: None,
        id: id.to_string(),
        name: name.to_string(),
        protocol: "openai_compatible".to_string(),
        dialect: "openai_native".to_string(),
        base_url: "https://api.openai.com/v1".to_string(),
        model_id: model.to_string(),
        secret_ref: Some(id.to_string()),
        credential_endpoint: None,
        capabilities: Vec::new(),
        network_policy: "cloud".to_string(),
        revision: 0,
    }
}

/// 一个用完就删的临时目录。不引入 `tempfile` 依赖：三行代码就够，而少一个依赖少一份风险。
struct TempDir(std::path::PathBuf);

impl TempDir {
    fn new(label: &str) -> Self {
        let mut path = std::env::temp_dir();
        path.push(format!("mathcanvas-test-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).expect("create the temp directory");
        Self(path)
    }

    fn file(&self, name: &str) -> std::path::PathBuf {
        self.0.join(name)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn starts_empty_and_adds_a_profile_with_revision_one() {    let dir = TempDir::new("store-add");
    let mut store = ProviderProfileStore::open(dir.file("providers.json")).expect("open");

    assert!(store.list().is_empty());
    let saved = store.upsert(profile("openai", "OpenAI", "gpt-5"), None).expect("upsert");

    assert_eq!(saved.revision, 1);
    assert_eq!(store.list().len(), 1);
    assert_eq!(store.get("openai").expect("get").model_id, "gpt-5");
}

/// **重启后还在**（存 → 关 → 再开）。这是"设置存储"最要紧的一条性质。
#[test]
fn survives_a_restart() {
    let dir = TempDir::new("store-restart");
    {
        let mut store = ProviderProfileStore::open(dir.file("providers.json")).expect("open");
        store.upsert(profile("openai", "OpenAI", "gpt-5"), None).expect("upsert");
    }

    let reopened = ProviderProfileStore::open(dir.file("providers.json")).expect("reopen");

    assert_eq!(reopened.list().len(), 1);
    assert_eq!(reopened.get("openai").expect("get").name, "OpenAI");
}

#[test]
fn output_limit_survives_restart_and_invalid_limits_do_not_write() {
    let dir = TempDir::new("output-limit");
    let file = dir.file("providers.json");
    let mut store = ProviderProfileStore::open(&file).expect("open");
    let mut p = profile("p", "P", "model");
    p.max_output_tokens = Some(8192);
    store.upsert(p.clone(), None).expect("save limit");
    for limit in [0, 131073] {
        p.max_output_tokens = Some(limit);
        assert!(store.upsert(p.clone(), Some(1)).is_err());
    }
    let reopened = ProviderProfileStore::open(&file).expect("reopen");
    assert_eq!(reopened.get("p").expect("saved").max_output_tokens, Some(8192));
}

/// 更新时**修订号由存储方递增**（调用方给的值一律忽略）。
#[test]
fn increments_the_revision_on_every_update() {
    let dir = TempDir::new("store-revision");
    let mut store = ProviderProfileStore::open(dir.file("providers.json")).expect("open");
    store.upsert(profile("openai", "OpenAI", "gpt-5"), None).expect("create");

    let mut changed = profile("openai", "OpenAI", "gpt-5-mini");
    changed.revision = 99; // 调用方给一个假值：必须被忽略。
    let saved = store.upsert(changed, None).expect("update");

    assert_eq!(saved.revision, 2, "the store owns the revision, not the caller");
    assert_eq!(store.get("openai").expect("get").model_id, "gpt-5-mini");
}

/// 乐观并发：期望的修订号不符时**拒绝写**，而不是悄悄覆盖别人的改动。
#[test]
fn refuses_a_write_built_on_a_stale_revision() {
    let dir = TempDir::new("store-cas");
    let mut store = ProviderProfileStore::open(dir.file("providers.json")).expect("open");
    store.upsert(profile("openai", "OpenAI", "gpt-5"), None).expect("create");
    // 另一个窗口先存了一次。
    store.upsert(profile("openai", "OpenAI", "gpt-5-mini"), Some(1)).expect("first writer");

    let stale = store.upsert(profile("openai", "OpenAI", "gpt-4"), Some(1));

    assert!(matches!(stale, Err(StoreError::Invalid { .. })), "a stale write must be refused");
    assert_eq!(store.get("openai").expect("get").model_id, "gpt-5-mini", "the first writer's change must survive");
}

/// **密钥绝不能进文件**（计划 Task 1.3 的 "secret omission"）。
#[test]
fn refuses_a_profile_that_carries_a_secret_and_writes_nothing() {
    let dir = TempDir::new("store-secret");
    let mut store = ProviderProfileStore::open(dir.file("providers.json")).expect("open");

    // 让一个密钥字段混进来（模拟"别的代码路径塞进来的"）。
    let mut json = serde_json::to_value(profile("openai", "OpenAI", "gpt-5")).expect("serialize");
    json.as_object_mut().expect("object").insert("apiKey".to_string(), serde_json::Value::String("sk-live-1234".to_string()));
    let smuggled: ProviderProfile = serde_json::from_value(json).expect("deserialize ignores unknown fields — that is exactly the danger");

    // 反序列化会**忽略**未知字段，所以这个对象本身是"干净"的 ——
    // 真正的防线在写盘前对**任意 JSON** 的结构检查上（下一条用例）。
    assert!(store.upsert(smuggled, None).is_ok());

    // 直接测那道门：它认得出嵌套的密钥字段。
    let nested = serde_json::json!({ "provider": { "auth": { "apiKey": "sk-x" } } });
    assert_eq!(contains_secret_field(&nested, 0).as_deref(), Some("apiKey"));
    // 而 `secretRef` 是引用，必须放行。
    let reference = serde_json::json!({ "secretRef": "openai", "name": "OpenAI" });
    assert_eq!(contains_secret_field(&reference, 0), None);

    // **数组里也要查**（外部审查 M9）。
    //
    // 原先第一句 `value.as_object()?` 让数组成为盲区：`capabilities:[{apiKey}]` 这种载荷
    // **不会被拒**，而是被反序列化**静默削掉**（`CapabilityEvidence` 没有 `deny_unknown_fields`）——
    // 正是这道门自己的注释里说"比报错更危险"的那种结果。函数文档写着"任意深度"，数组也是深度。
    let in_array = serde_json::json!({ "capabilities": [{ "feature": "vision", "status": "unknown", "apiKey": "sk-not-a-real-key" }] });
    assert_eq!(contains_secret_field(&in_array, 0).as_deref(), Some("apiKey"));
    // 深一层也是：数组里嵌对象、对象里再嵌数组。
    let deeper = serde_json::json!({ "a": [{ "b": [{ "token": "sk-not-a-real-key" }] }] });
    assert_eq!(contains_secret_field(&deeper, 0).as_deref(), Some("token"));
    // 反向守卫：数组里**没有**密钥形状字段时照常放行（这条闸不该变成"见到数组就拒"）。
    let clean = serde_json::json!({ "capabilities": [{ "feature": "vision", "status": "unknown", "secretRef": "openai" }] });
    assert_eq!(contains_secret_field(&clean, 0), None);
}

/// 落盘的文件里**逐字**不含任何密钥形状的字段名。
#[test]
fn the_written_file_contains_only_references() {
    let dir = TempDir::new("store-file");
    let path = dir.file("providers.json");
    let mut store = ProviderProfileStore::open(&path).expect("open");
    store.upsert(profile("openai", "OpenAI", "gpt-5"), None).expect("upsert");

    let text = std::fs::read_to_string(&path).expect("read");
    assert!(text.contains("secretRef"), "the reference must be persisted: {text}");
    for forbidden in ["apiKey", "api_key", "password", "\"token\"", "\"secret\""] {
        assert!(!text.contains(forbidden), "the file mentions `{forbidden}`: {text}");
    }
}

/// 名字不能重复：列表里两条一样的名字，用户分不清哪个是哪个。
#[test]
fn refuses_a_second_profile_with_the_same_name() {
    let dir = TempDir::new("store-name");
    let mut store = ProviderProfileStore::open(dir.file("providers.json")).expect("open");
    store.upsert(profile("openai", "OpenAI", "gpt-5"), None).expect("create");

    let clash = store.upsert(profile("openai-backup", "OpenAI", "gpt-5"), None);

    assert!(matches!(clash, Err(StoreError::Invalid { .. })));
    assert_eq!(store.list().len(), 1);
}

/// 闭集校验：协议 / 方言 / 网络策略 / 必填字段。
#[test]
fn refuses_values_outside_the_closed_sets() {
    let dir = TempDir::new("store-sets");
    let mut store = ProviderProfileStore::open(dir.file("providers.json")).expect("open");

    let mut bad_protocol = profile("a", "A", "m");
    bad_protocol.protocol = "gemini".to_string();
    assert!(matches!(store.upsert(bad_protocol, None), Err(StoreError::Invalid { .. })));

    let mut bad_dialect = profile("b", "B", "m");
    bad_dialect.dialect = "something".to_string();
    assert!(matches!(store.upsert(bad_dialect, None), Err(StoreError::Invalid { .. })));

    let mut bad_policy = profile("c", "C", "m");
    bad_policy.network_policy = "whatever".to_string();
    assert!(matches!(store.upsert(bad_policy, None), Err(StoreError::Invalid { .. })));

    let mut no_model = profile("d", "D", "  ");
    no_model.model_id = "  ".to_string();
    assert!(matches!(store.upsert(no_model, None), Err(StoreError::Invalid { .. })));

    assert!(store.list().is_empty(), "nothing invalid may be persisted");
}

/// 删除会把健康记录一起删掉 —— 留着它会让"重建一个同 id 的 profile"继承旧证据。
#[test]
fn removing_a_profile_also_drops_its_health_record() {
    let dir = TempDir::new("store-remove");
    let mut store = ProviderProfileStore::open(dir.file("providers.json")).expect("open");
    store.upsert(profile("openai", "OpenAI", "gpt-5"), None).expect("create");
    store
        .mark_health(
            "openai",
            ProviderHealth { status: "ok".to_string(), latency_ms: Some(120), capability_evidence: vec![CapabilityEvidence { feature: "streaming".to_string(), status: "verified".to_string(), checked_at: Some(1), detail: None }], checked_at: 1, profile_revision: 1 }
        )
        .expect("mark health");
    assert!(store.health("openai").is_some());

    store.remove("openai").expect("remove");

    assert!(store.list().is_empty());
    assert!(store.health("openai").is_none(), "stale evidence must not outlive the profile");
    assert!(matches!(store.remove("openai"), Err(StoreError::NotFound { .. })), "removing twice is an honest error, not a silent no-op");
}

/// 健康记录**不改变配置**，而且带着它对应的 revision。
#[test]
fn records_health_without_touching_the_profile_revision() {
    let dir = TempDir::new("store-health");
    let mut store = ProviderProfileStore::open(dir.file("providers.json")).expect("open");
    let saved = store.upsert(profile("openai", "OpenAI", "gpt-5"), None).expect("create");

    store
        .mark_health("openai", ProviderHealth { status: "degraded".to_string(), latency_ms: None, capability_evidence: Vec::new(), checked_at: 7, profile_revision: saved.revision })
        .expect("mark health");

    let health = store.health("openai").expect("health");
    assert_eq!(health.status, "degraded");
    assert_eq!(health.profile_revision, saved.revision);
    assert_eq!(store.get("openai").expect("get").revision, saved.revision, "health must not bump the configuration revision");
}

/// **配置坏了要如实报错，不许静默重置** —— 重置会把用户所有配置悄悄删掉。
#[test]
fn reports_a_corrupt_configuration_instead_of_resetting_it() {
    let dir = TempDir::new("store-corrupt");
    let path = dir.file("providers.json");
    std::fs::write(&path, "{ this is not json").expect("write garbage");

    let opened = ProviderProfileStore::open(&path);

    assert!(matches!(opened, Err(StoreError::Io { .. })));
    // 而且**没有**把文件改掉：用户还有机会自己修。
    assert_eq!(std::fs::read_to_string(&path).expect("read"), "{ this is not json");
}

/// 未来版本写的配置要**认出来**并说清楚，而不是当作空库。
#[test]
fn refuses_a_configuration_from_a_newer_schema() {
    let dir = TempDir::new("store-newer");
    let path = dir.file("providers.json");
    std::fs::write(&path, r#"{"schemaVersion":99,"profiles":[],"health":{}}"#).expect("write");

    let opened = ProviderProfileStore::open(&path);

    assert!(matches!(opened, Err(StoreError::Io { .. })));
    if let Err(StoreError::Io { detail }) = opened {
        assert!(detail.contains("99"), "the error must name the version it cannot read: {detail}");
    }
}

/// **写盘是原子的**：正常写入之后不该留下临时文件，而且内容能读回来。
#[test]
fn leaves_no_temporary_file_behind() {
    let dir = TempDir::new("store-atomic");
    let path = dir.file("providers.json");
    let mut store = ProviderProfileStore::open(&path).expect("open");
    store.upsert(profile("openai", "OpenAI", "gpt-5"), None).expect("upsert");

    assert!(path.exists());
    assert!(!dir.file("providers.json.tmp").exists(), "the temp file must be renamed away, not left behind");
    // 内容必须是完整可解析的。
    let reopened = ProviderProfileStore::open(&path).expect("reopen");
    assert_eq!(reopened.list().len(), 1);
}

/// 列表顺序稳定：界面上的列表不该因为存了一次就换位置。
#[test]
fn lists_profiles_in_a_stable_order() {
    let dir = TempDir::new("store-order");
    let mut store = ProviderProfileStore::open(dir.file("providers.json")).expect("open");
    store.upsert(profile("zeta", "Zeta", "m"), None).expect("create");
    store.upsert(profile("alpha", "Alpha", "m"), None).expect("create");
    store.upsert(profile("mid", "Mid", "m"), None).expect("create");

    let names: Vec<String> = store.list().into_iter().map(|entry| entry.name).collect();

    assert_eq!(names, vec!["Alpha".to_string(), "Mid".to_string(), "Zeta".to_string()]);
}

// ---------------------------------------------------------------- 当前使用哪一份（Task 1.3 Step 5 的切换）

#[test]
fn newly_stored_configuration_has_nothing_selected_yet() {
    // **不默认选第一个**：那会让"我还没选"与"我选了第一份"变成同一件事，
    // 而界面上要显示的那个"正在使用"的标记必须是真的选过。
    let dir = TempDir::new("active-none");
    let mut store = ProviderProfileStore::open(dir.file("providers.json")).expect("open");
    store.upsert(profile("openai", "OpenAI", "gpt-5"), None).expect("create");

    assert_eq!(store.active_profile_id(), None);
}

#[test]
fn selecting_a_profile_survives_a_restart() {
    // 切换的意义就是"下次还用它"，所以这一条必须是落盘的。
    let dir = TempDir::new("active-persist");
    let path = dir.file("providers.json");
    let mut store = ProviderProfileStore::open(&path).expect("open");
    store.upsert(profile("openai", "OpenAI", "gpt-5"), None).expect("create");
    store.upsert(profile("deepseek", "DeepSeek", "deepseek-chat"), None).expect("create");

    let selected = store.select("deepseek").expect("select");

    assert_eq!(selected, "deepseek");
    assert_eq!(store.active_profile_id().as_deref(), Some("deepseek"));
    let reopened = ProviderProfileStore::open(&path).expect("reopen");
    assert_eq!(reopened.active_profile_id().as_deref(), Some("deepseek"), "the choice must be on disk");
}

#[test]
fn switching_between_profiles_only_moves_the_marker() {
    // "在不同模型之间主动切换"就是改这一个字段 —— 它不该顺带改任何 profile 的修订号。
    let dir = TempDir::new("active-switch");
    let mut store = ProviderProfileStore::open(dir.file("providers.json")).expect("open");
    store.upsert(profile("openai", "OpenAI", "gpt-5"), None).expect("create");
    store.upsert(profile("anthropic", "Anthropic", "claude"), None).expect("create");
    store.select("openai").expect("select openai");
    let revisions: Vec<u32> = store.list().into_iter().map(|entry| entry.revision).collect();

    store.select("anthropic").expect("select anthropic");

    assert_eq!(store.active_profile_id().as_deref(), Some("anthropic"));
    assert_eq!(store.list().into_iter().map(|entry| entry.revision).collect::<Vec<u32>>(), revisions, "switching must not bump any revision");
}

#[test]
fn selecting_something_that_does_not_exist_is_refused() {
    let dir = TempDir::new("active-missing");
    let mut store = ProviderProfileStore::open(dir.file("providers.json")).expect("open");
    store.upsert(profile("openai", "OpenAI", "gpt-5"), None).expect("create");

    let outcome = store.select("nope");

    assert!(matches!(outcome, Err(StoreError::NotFound { .. })), "got {outcome:?}");
    // 而选中的那一份**没有被改掉**：一次失败的切换不该把用户原来的选择清空。
    assert_eq!(store.active_profile_id(), None);
}

#[test]
fn deleting_the_selected_profile_clears_the_selection() {
    // 不清的话界面会一直显示"正在使用 OpenAI"，而那一份已经不存在了。
    let dir = TempDir::new("active-delete");
    let mut store = ProviderProfileStore::open(dir.file("providers.json")).expect("open");
    store.upsert(profile("openai", "OpenAI", "gpt-5"), None).expect("create");
    store.select("openai").expect("select");

    store.remove("openai").expect("remove");

    assert_eq!(store.active_profile_id(), None, "a selection must never point at a removed profile");
}

#[test]
fn deleting_something_else_keeps_the_selection() {
    let dir = TempDir::new("active-delete-other");
    let mut store = ProviderProfileStore::open(dir.file("providers.json")).expect("open");
    store.upsert(profile("openai", "OpenAI", "gpt-5"), None).expect("create");
    store.upsert(profile("anthropic", "Anthropic", "claude"), None).expect("create");
    store.select("openai").expect("select");

    store.remove("anthropic").expect("remove");

    assert_eq!(store.active_profile_id().as_deref(), Some("openai"));
}

#[test]
fn the_written_file_carries_the_selection_as_a_reference_not_a_copy() {
    // 与 `secretRef` 同一个口径：文件里只有 id，没有第二份 profile 副本。
    let dir = TempDir::new("active-file");
    let path = dir.file("providers.json");
    let mut store = ProviderProfileStore::open(&path).expect("open");
    store.upsert(profile("openai", "OpenAI", "gpt-5"), None).expect("create");
    store.select("openai").expect("select");

    let text = std::fs::read_to_string(&path).expect("read");
    let parsed: serde_json::Value = serde_json::from_str(&text).expect("parse");

    assert_eq!(parsed["activeProfileId"], "openai");
    // 而顶层只有一个 profiles 数组（没有第二份被复制出来的配置）。
    assert_eq!(parsed["profiles"].as_array().expect("profiles").len(), 1);
}

#[test]
fn an_older_configuration_without_a_selection_still_opens() {
    // 加这个字段之前写的文件里没有 `activeProfileId`。读不动它等于让升级变成数据丢失。
    let dir = TempDir::new("active-old-file");
    let path = dir.file("providers.json");
    std::fs::write(
        &path,
        r#"{"schemaVersion":1,"profiles":[{"id":"openai","name":"OpenAI","protocol":"openai_compatible","dialect":"openai_native","baseUrl":"https://api.openai.com/v1","modelId":"gpt-5","secretRef":"openai","capabilities":[],"networkPolicy":"cloud","revision":1}],"health":{}}"#
    )
    .expect("write an old file");

    let store = ProviderProfileStore::open(&path).expect("an older file must still open");

    assert_eq!(store.list().len(), 1);
    assert_eq!(store.active_profile_id(), None, "a file without a selection means nothing is selected");
}


#[test]
fn rejects_a_credential_reference_owned_by_another_profile() {
    let dir = TempDir::new("foreign-credential");
    let mut store = ProviderProfileStore::open(dir.file("providers.json")).expect("open");
    let mut foreign = profile("openai", "OpenAI", "gpt-5");
    foreign.secret_ref = Some("victim".to_string());

    let result = store.upsert(foreign, None);

    assert!(matches!(result, Err(StoreError::Invalid { .. })), "a profile must not reference another profile's credential");
    assert!(store.get("openai").is_none(), "a rejected profile must not be persisted");
}


#[test]
fn accepts_a_native_versioned_slot_only_for_its_owning_profile() {
    let dir = TempDir::new("native-slot-owner");
    let mut store = ProviderProfileStore::open(dir.file("providers.json")).expect("open");
    let mut owned = profile("openai", "OpenAI", "gpt-5");
    owned.secret_ref = Some("native-v1:6:openai:2".to_string());
    owned.credential_endpoint = Some(owned.base_url.clone());

    store.upsert(owned, None).expect("the native slot belongs to openai and carries an endpoint binding");

    let mut foreign = profile("victim", "Victim", "gpt-5");
    foreign.secret_ref = Some("native-v1:6:openai:2".to_string());
    foreign.credential_endpoint = Some(foreign.base_url.clone());
    assert!(matches!(store.upsert(foreign, None), Err(StoreError::Invalid { .. })));
}

#[test]
fn normalizes_endpoint_identity_without_confusing_tenants() {
    use mathcanvas_desktop_lib::repository::provider_profiles::normalized_endpoint;

    let canonical = normalized_endpoint("https://API.EXAMPLE.COM:443/v1/").expect("canonical endpoint");
    assert_eq!(canonical, "https://api.example.com/v1");
    assert_eq!(normalized_endpoint("https://api.example.com/v1").expect("same endpoint"), canonical);
    for different in [
        "http://api.example.com/v1",
        "https://other.example.com/v1",
        "https://api.example.com:444/v1",
        "https://api.example.com/tenant-b",
    ] {
        assert_ne!(normalized_endpoint(different).expect("valid but different endpoint"), canonical);
    }
    assert!(normalized_endpoint("https://user:pass@api.example.com/v1").is_err());
    assert!(normalized_endpoint("https://api.example.com/v1?tenant=other").is_err());
}


use mathcanvas_desktop_lib::repository::provider_profiles::{
    update_provider_credentials, CredentialState, CredentialTransaction, CredentialTransactionStage,
};
use mathcanvas_desktop_lib::secrets::{memory::MemorySecretStore, SecretError, SecretState, SecretStore};

#[derive(Default)]
struct FakeSecrets {
    inner: MemorySecretStore,
    fail_put: bool,
    fail_remove: bool,
    sabotage_on_put: Option<std::path::PathBuf>,
    calls: std::sync::Mutex<Vec<String>>,
}

impl FakeSecrets {
    fn read(&self, slot: &str) -> Option<String> {
        self.inner.with_secret(slot, str::to_string).expect("fake secret read")
    }
}

impl SecretStore for FakeSecrets {
    fn put(&self, profile_id: &str, secret: &str) -> Result<SecretState, SecretError> {
        self.calls.lock().expect("call log").push(profile_id.to_string());
        if self.fail_put {
            return Err(SecretError::Backend { detail: "injected put failure".to_string() });
        }
        let result = self.inner.put(profile_id, secret);
        if let Some(path) = &self.sabotage_on_put {
            let _ = std::fs::remove_file(path);
            std::fs::create_dir(path).expect("sabotage the profile target after staging");
        }
        result
    }

    fn remove(&self, profile_id: &str) -> Result<(), SecretError> {
        if self.fail_remove {
            return Err(SecretError::Backend { detail: "injected remove failure".to_string() });
        }
        self.inner.remove(profile_id)
    }

    fn has(&self, profile_id: &str) -> Result<bool, SecretError> {
        self.inner.has(profile_id)
    }

    fn with_secret<T>(&self, profile_id: &str, f: impl FnOnce(&str) -> T) -> Result<Option<T>, SecretError> {
        self.inner.with_secret(profile_id, f)
    }

    fn backend(&self) -> &'static str {
        "fake-memory"
    }

    fn is_persistent(&self) -> bool {
        false
    }
}

#[test]
fn native_update_commits_a_new_slot_and_removes_the_previous_one() {
    let dir = TempDir::new("native-update-success");
    let file = dir.file("providers.json");
    let mut store = ProviderProfileStore::open(&file).expect("open");
    store.upsert(profile("openai", "OpenAI", "old-model"), None).expect("old profile");
    let secrets = FakeSecrets::default();
    secrets.put("openai", "OLD").expect("old secret");
    let mut changed = profile("openai", "OpenAI", "new-model");
    changed.base_url = "https://api.openai.com/tenant-b".to_string();

    let update = update_provider_credentials(&mut store, &secrets, changed, Some(1), Some("NEW")).expect("commit update");

    assert_eq!(update.credential_state, CredentialState::Committed);
    assert!(!update.recovery_required);
    assert_eq!(update.profile.revision, 2);
    assert_eq!(update.profile.secret_ref.as_deref(), Some("native-v1:6:openai:2"));
    assert_eq!(secrets.read("openai"), None, "the old slot is cleaned only after commit");
    assert_eq!(secrets.read("native-v1:6:openai:2").as_deref(), Some("NEW"));
    assert_eq!(store.pending_credentials().len(), 0);
}

#[test]
fn native_update_preserves_the_old_profile_and_secret_when_profile_persistence_fails() {
    let dir = TempDir::new("native-update-write-failure");
    let file = dir.file("providers.json");
    let mut store = ProviderProfileStore::open(&file).expect("open");
    store.upsert(profile("openai", "OpenAI", "old-model"), None).expect("old profile");
    let mut secrets = FakeSecrets::default();
    secrets.put("openai", "OLD").expect("old secret");
    secrets.sabotage_on_put = Some(file);
    let changed = profile("openai", "OpenAI", "new-model");

    let error = update_provider_credentials(&mut store, &secrets, changed, Some(1), Some("NEW")).expect_err("profile persistence must fail");

    assert!(error.profile_unchanged);
    assert!(error.previous_credential_retained);
    assert!(error.recovery_required, "the failed cleanup remains registered for recovery");
    assert_eq!(store.get("openai").expect("old profile").model_id, "old-model");
    assert_eq!(secrets.read("openai").as_deref(), Some("OLD"));
    assert_eq!(secrets.read("native-v1:6:openai:2"), None, "the staged slot was removed");
    assert_eq!(store.pending_credentials().len(), 1);
}

#[test]
fn native_update_checks_the_revision_before_writing_a_secret() {
    let dir = TempDir::new("native-update-cas");
    let mut store = ProviderProfileStore::open(dir.file("providers.json")).expect("open");
    store.upsert(profile("openai", "OpenAI", "old-model"), None).expect("old profile");
    let secrets = FakeSecrets::default();
    secrets.put("openai", "OLD").expect("old secret");
    secrets.calls.lock().expect("call log").clear();

    let result = update_provider_credentials(&mut store, &secrets, profile("openai", "OpenAI", "new-model"), Some(99), Some("NEW"));

    assert!(result.is_err());
    assert!(secrets.calls.lock().expect("call log").is_empty(), "a stale update must not stage a secret");
    assert_eq!(secrets.read("openai").as_deref(), Some("OLD"));
}

#[test]
fn native_update_recovers_staged_orphans_and_committed_previous_slots() {
    let staged_dir = TempDir::new("native-recovery-staged");
    let staged_file = staged_dir.file("providers.json");
    let transaction = CredentialTransaction {
        profile_id: "openai".to_string(),
        new_slot: "native-v1:6:openai:2".to_string(),
        previous_slot: Some("openai".to_string()),
        stage: CredentialTransactionStage::Staged,
    };
    let secrets = FakeSecrets::default();
    secrets.put("openai", "OLD").expect("old secret");
    secrets.put("native-v1:6:openai:2", "NEW").expect("staged secret");
    {
        let mut store = ProviderProfileStore::open(&staged_file).expect("open");
        store.upsert(profile("openai", "OpenAI", "old-model"), None).expect("old profile");
        store.register_credential_transaction(transaction.clone()).expect("register staged transaction");
    }
    let mut reopened = ProviderProfileStore::open(&staged_file).expect("reopen staged transaction");
    let staged = reopened.recover_provider_credentials(&secrets);
    assert_eq!(staged.pending, 0);
    assert_eq!(secrets.read("native-v1:6:openai:2"), None, "an unreferenced staged slot is an orphan");
    assert_eq!(secrets.read("openai").as_deref(), Some("OLD"), "the referenced old slot must survive");

    let committed_dir = TempDir::new("native-recovery-committed");
    let committed_file = committed_dir.file("providers.json");
    secrets.put("native-v1:6:openai:2", "NEW").expect("staged secret again");
    {
        let mut store = ProviderProfileStore::open(&committed_file).expect("open");
        store.upsert(profile("openai", "OpenAI", "old-model"), None).expect("old profile");
        store.register_credential_transaction(transaction).expect("register committed transaction");
        let mut changed = profile("openai", "OpenAI", "new-model");
        changed.secret_ref = Some("native-v1:6:openai:2".to_string());
        changed.credential_endpoint = Some(changed.base_url.clone());
        store.upsert(changed, Some(1)).expect("commit profile before the simulated crash");
    }
    let mut reopened = ProviderProfileStore::open(&committed_file).expect("reopen committed transaction");
    let committed = reopened.recover_provider_credentials(&secrets);
    assert_eq!(committed.pending, 0);
    assert_eq!(secrets.read("native-v1:6:openai:2").as_deref(), Some("NEW"));
    assert_eq!(secrets.read("openai"), None, "the previous slot is cleaned after the committed reference is observed");
}

#[test]
fn native_update_keeps_cleanup_failures_registered_and_retryable() {
    let dir = TempDir::new("native-cleanup-retry");
    let mut store = ProviderProfileStore::open(dir.file("providers.json")).expect("open");
    store.upsert(profile("openai", "OpenAI", "old-model"), None).expect("old profile");
    let mut secrets = FakeSecrets { fail_remove: true, ..FakeSecrets::default() };
    secrets.put("openai", "OLD").expect("old secret");

    let update = update_provider_credentials(&mut store, &secrets, profile("openai", "OpenAI", "new-model"), Some(1), Some("NEW")).expect("profile commit is independent of old-slot cleanup");

    assert!(update.recovery_required);
    assert_eq!(store.pending_credentials().len(), 1);
    assert_eq!(secrets.read("openai").as_deref(), Some("OLD"));
    secrets.fail_remove = false;
    let recovery = store.recover_provider_credentials(&secrets);
    assert_eq!(recovery.pending, 0);
    assert_eq!(secrets.read("openai"), None);
    assert_eq!(secrets.read("native-v1:6:openai:2").as_deref(), Some("NEW"));
}


#[test]
fn native_update_requires_reauthorization_for_endpoint_changes() {
    let dir = TempDir::new("native-endpoint-reauth");
    let mut store = ProviderProfileStore::open(dir.file("providers.json")).expect("open");
    store.upsert(profile("openai", "OpenAI", "old-model"), None).expect("old profile");
    let secrets = FakeSecrets::default();
    secrets.put("openai", "OLD").expect("old secret");
    let mut changed = profile("openai", "OpenAI", "new-model");
    changed.base_url = "https://attacker.example.com/v1".to_string();

    let error = update_provider_credentials(&mut store, &secrets, changed, Some(1), None).expect_err("endpoint change needs a new credential");

    assert_eq!(error.code, "needs_reauthorization");
    let current = store.get("openai").expect("old profile");
    assert_eq!(current.base_url, "https://api.openai.com/v1");
    assert_eq!(current.model_id, "old-model");
    assert_eq!(secrets.read("openai").as_deref(), Some("OLD"));
}

#[test]
fn native_update_secret_store_failure_preserves_the_previous_credential() {
    let dir = TempDir::new("native-secret-failure");
    let mut store = ProviderProfileStore::open(dir.file("providers.json")).expect("open");
    store.upsert(profile("openai", "OpenAI", "old-model"), None).expect("old profile");
    let mut secrets = FakeSecrets::default();
    secrets.put("openai", "OLD").expect("old secret");
    secrets.fail_put = true;

    let error = update_provider_credentials(&mut store, &secrets, profile("openai", "OpenAI", "new-model"), Some(1), Some("NEW")).expect_err("injected secret failure");

    assert!(error.profile_unchanged);
    assert!(error.previous_credential_retained);
    assert!(!error.recovery_required);
    assert_eq!(secrets.read("openai").as_deref(), Some("OLD"));
    assert!(store.pending_credentials().is_empty());
}

#[test]
fn native_update_creates_a_profile_with_an_owned_binding() {
    let dir = TempDir::new("native-create");
    let mut store = ProviderProfileStore::open(dir.file("providers.json")).expect("open");
    let secrets = FakeSecrets::default();

    let update = update_provider_credentials(&mut store, &secrets, profile("openai", "OpenAI", "model"), None, Some("NEW")).expect("create profile");

    assert_eq!(update.profile.revision, 1);
    assert_eq!(update.profile.secret_ref.as_deref(), Some("native-v1:6:openai:1"));
    assert_eq!(update.profile.credential_endpoint.as_deref(), Some("https://api.openai.com/v1"));
    assert_eq!(secrets.read("native-v1:6:openai:1").as_deref(), Some("NEW"));
}

#[test]
fn native_update_without_a_new_secret_preserves_the_versioned_binding() {
    let dir = TempDir::new("native-preserve-binding");
    let mut store = ProviderProfileStore::open(dir.file("providers.json")).expect("open");
    let secrets = FakeSecrets::default();
    let committed = update_provider_credentials(&mut store, &secrets, profile("openai", "OpenAI", "old-model"), None, Some("NEW")).expect("create profile");
    let mut changed = committed.profile.clone();
    changed.model_id = "new-model".to_string();
    changed.base_url = "https://API.OPENAI.COM:443/v1/".to_string();

    let update = update_provider_credentials(&mut store, &secrets, changed, Some(1), None).expect("ordinary profile edit");

    assert_eq!(update.credential_state, CredentialState::Unchanged);
    assert_eq!(update.profile.secret_ref, committed.profile.secret_ref);
    assert_eq!(update.profile.credential_endpoint, committed.profile.credential_endpoint);
    assert_eq!(secrets.read("native-v1:6:openai:1").as_deref(), Some("NEW"));
}

#[test]
fn opens_utf8_bom_and_empty_provider_files_without_panicking() {
    let dir = TempDir::new("bom-and-empty");
    let empty_file = dir.file("empty.json");
    std::fs::write(&empty_file, "   \n").expect("write empty file");
    let empty_store = ProviderProfileStore::open(&empty_file).expect("empty file recovers cleanly");
    assert!(empty_store.list().is_empty());

    let bom_file = dir.file("bom.json");
    std::fs::write(
        &bom_file,
        "\u{feff}{\"schemaVersion\":1,\"profiles\":[],\"health\":{},\"activeProfileId\":null}"
    ).expect("write bom file");
    let bom_store = ProviderProfileStore::open(&bom_file).expect("bom file opens cleanly");
    assert!(bom_store.list().is_empty());
}
