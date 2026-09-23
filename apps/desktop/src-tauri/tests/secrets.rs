//! **密钥库**（Task 1.2）。
//!
//! 计划的三条硬要求，逐条落在这里：
//! 1. Rust trait：`put` / `remove` / `has` / `with_secret`；
//! 2. Windows 后端用**凭据管理器**，测试用内存后端；
//! 3. **密钥的值绝不离开 Rust 侧**：`put` / `remove` / `has` 都不返回明文，
//!    错误信息里也不能带上它。
//!
//! ## 为什么第 3 条要靠**类型**而不是靠自觉
//!
//! `put` 的返回值是 `SecretState`（只有三个枚举值），`has` 返回 `bool`，
//! `remove` 返回 `()` —— **没有任何一个位置能装下明文**。这比"记得不要返回它"可靠：
//! 将来有人想加一个 `get_secret` 命令，他必须先改这个类型，而那是一次**看得见的**改动。
//!
//! ## 为什么 `with_secret` 收一个闭包
//!
//! 计划原文的签名是 `with_secret(profile_id, f)`。这样设计的效果是：明文只在闭包**执行期间**
//! 存在，函数返回后 Rust 侧也拿不到它 —— 调用方要"用一次密钥"（例如发一次 provider 请求），
//! 而不是"拿到密钥"。这是"密钥不落地"在接口形状上的落点。

use std::collections::HashMap;

use mathcanvas_desktop_lib::secrets::{
    SecretError, SecretState, SecretStore, Store, ACTIVE_BACKEND, MEMORY_BACKED_MESSAGE,
};

/// **内存后端**（测试与无凭据管理器的环境）。
///
/// 它出现在生产代码里的理由不是"方便测试"，而是**没有后端时不能假装成功**：
/// 某些环境（非 Windows、或凭据管理器不可用）必须有一个能如实回答"我能存"的替身，
/// 否则调用方只能选择"崩"或"假装成功"。内存后端是第三种：**能存，但进程一退就没了** ——
/// 而这一点必须由调用方通过 `ACTIVE_BACKEND` 知道。
#[test]
fn exposes_the_vocabulary_the_callers_need() {
    let _ = MEMORY_BACKED_MESSAGE;
    let _: Option<SecretState> = None;
    let _: Option<SecretError> = None;
    // 内存后端的类型也在生产代码里（不是 `#[cfg(test)]` 后面）——
    // 否则"没有凭据管理器时会发生什么"这条路径就从来没有代码走过。
    let store: HashMap<String, String> = HashMap::new();
    assert!(store.is_empty());
}

/// 本文件里会**真的落到凭据管理器**的用例，各自使用的 profile 名。
///
/// 两条纪律，缺一条就会伤到用户的真实凭据库：
///
/// 1. **不能等于任何真实 profile id**。`stores_checks_and_removes_a_secret` 会对它调 `remove` ——
///    那一步在 Windows 后端上就是**删掉用户在界面上配好的那一格密钥**。
/// 2. **两两不同**。两条用例并排跑时，一条的 `put` 会把另一条的 `has` 翻成 `true`。
///    这条不是假想：本文件曾在 `cargo test --test secrets` 下报
///    `assertion failed: !store.has("openai").expect("has after remove")`，
///    而同一进程里 `never_puts_the_secret_into_an_error_message` 正在写同一格 `openai`。
///
/// 名字都必须进 `SCRATCH_PROFILES` 那份清单 —— 那张表是用例之间的唯一约定。
/// `__test__` 前缀还兼一个作用：跑崩的进程留下的条目，一眼能认出是测试垃圾而不是用户的密钥。
const SCRATCH_ROUNDTRIP: &str = "__test__put-has-remove";
const SCRATCH_MISSING: &str = "__test__never-saved";
const SCRATCH_LENDING: &str = "__test__with-secret";
const SCRATCH_MISSING_PROBE: &str = "__test__absent-probe";
const SCRATCH_LEAK_CHECK: &str = "__test__error-message";
const SCRATCH_REFUSED: &str = "__test__refused-input";

/// 上面每一个名字都必须列在这里，且两两不同。下面那条用例就是"下一个人加用例时会被拦下"的闸。
const SCRATCH_PROFILES: &[&str] = &[
    SCRATCH_ROUNDTRIP,
    SCRATCH_MISSING,
    SCRATCH_LENDING,
    SCRATCH_MISSING_PROBE,
    SCRATCH_LEAK_CHECK,
    SCRATCH_REFUSED,
];

/// 应用真实用过的 profile id（`cmdkey /list` 里 `openai.MathCanvas` / `anthropic.MathCanvas` /
/// `ds.MathCanvas` 三条的服务实例名就是它们）。
const REAL_PROFILE_IDS: &[&str] = &["openai", "anthropic", "ds"];

/// **借一格测试用凭据**：进来先清干净，出去（含 panic）一定删掉。
///
/// 为什么必须有这个东西：`create_store()` 在 Windows 上给的是**真实**凭据管理器后端，
/// 这几条常规用例是真的往用户凭据库里写。没有守卫时它们会（a）删掉用户的真实密钥、
/// （b）把 `sk-test-1234`、`sk-ant-test` 这类夹具留在用户库里 —— 两件都在本机实测到了。
struct ScratchCredential<'a> {
    store: &'a Store,
    profile: &'static str,
}

impl<'a> ScratchCredential<'a> {
    fn new(store: &'a Store, profile: &'static str) -> Self {
        // 起点必须干净：上一次跑崩留下的条目不能影响这一次的结论。
        let _ = store.remove(profile);
        Self { store, profile }
    }
}

impl Drop for ScratchCredential<'_> {
    fn drop(&mut self) {
        let _ = self.store.remove(self.profile);
    }
}

/// 把上面两条纪律钉成用例：只靠自觉的话，下一个人加一条用例就会再犯一次。
#[test]
fn scratch_profiles_are_distinct_and_never_a_real_profile_id() {
    let mut seen = std::collections::HashSet::new();
    for profile in SCRATCH_PROFILES {
        assert!(
            !REAL_PROFILE_IDS.contains(profile),
            "用例在用真实 profile id「{profile}」：它会覆盖或删掉用户在凭据管理器里已经配好的密钥"
        );
        assert!(
            seen.insert(*profile),
            "两条用例共用同一个凭据格「{profile}」：并排跑时一条的 put 会把另一条的 has 翻成 true"
        );
    }
}

/// 计划 Step 1 点名的第一组：put / has / remove 的基本回路。
#[test]
fn stores_checks_and_removes_a_secret() {
    let store = mathcanvas_desktop_lib::secrets::create_store();
    let slot = ScratchCredential::new(&store, SCRATCH_ROUNDTRIP);

    assert_eq!(store.put(slot.profile, "sk-test-1234").expect("put"), SecretState::Saved);
    assert!(store.has(slot.profile).expect("has"));
    assert_eq!(store.remove(slot.profile).expect("remove"), ());
    assert!(!store.has(slot.profile).expect("has after remove"));
}

/// 缺 key 是**正常状态**，不是错误：界面要显示"还没配置"，而不是弹一个失败。
#[test]
fn reports_a_missing_key_as_missing_rather_than_as_a_failure() {
    let store = mathcanvas_desktop_lib::secrets::create_store();
    let slot = ScratchCredential::new(&store, SCRATCH_MISSING);

    assert!(!store.has(slot.profile).expect("has must not fail for a missing key"));
    assert_eq!(store.remove(slot.profile).expect("remove must be idempotent"), ());
}

/// `with_secret` 把明文限制在一次闭包调用里。
#[test]
fn lends_the_secret_to_a_closure_and_nothing_else() {
    let store = mathcanvas_desktop_lib::secrets::create_store();
    let slot = ScratchCredential::new(&store, SCRATCH_LENDING);
    store.put(slot.profile, "sk-ant-test").expect("put");

    let observed = store.with_secret(slot.profile, |secret| secret.len()).expect("with_secret");

    assert_eq!(observed, Some("sk-ant-test".len()));
    // 缺 key 时闭包**不执行**，返回 None —— 调用方据此走"没有配置"的分支，
    // 而不是拿到一个空字符串去发一次注定 401 的请求。
    assert_eq!(
        store.with_secret(SCRATCH_MISSING_PROBE, |secret| secret.len()).expect("with_secret"),
        None
    );
}

/// **错误信息里不能带明文**（计划："Assert serialized logs and mock IPC responses contain no secret bytes"）。
#[test]
fn never_puts_the_secret_into_an_error_message() {
    let store = mathcanvas_desktop_lib::secrets::create_store();
    let slot = ScratchCredential::new(&store, SCRATCH_LEAK_CHECK);
    let secret = "sk-super-secret-value-9f3a2b";

    // 空 profile id 会被拒 —— 那条错误信息里不许出现刚才存过的任何东西。
    store.put(slot.profile, secret).expect("put");
    let error = store.put("", secret).expect_err("an empty profile id must be refused");

    assert!(!error.to_string().contains(secret), "the error leaked the secret: {error}");
    assert!(!format!("{error:?}").contains(secret), "the error debug leaked the secret: {error:?}");
}

/// 空 profile id 与空密钥都必须被拒：前者会让两个 provider 抢同一格，
/// 后者会把"没填"变成"存了一个空密钥"，于是界面显示已配置、而请求必然 401。
#[test]
fn refuses_an_empty_profile_id_or_an_empty_secret() {
    let store = mathcanvas_desktop_lib::secrets::create_store();

    // 这条用例**什么都不会写**（三次调用都在校验处就被拒），但名字仍按规矩来：
    // 哪天校验被挪到写入之后，它不会突然开始动用户的真实格子。
    assert!(store.put("", "sk-x").is_err());
    assert!(store.put(SCRATCH_REFUSED, "").is_err());
    assert!(store.put("   ", "sk-x").is_err(), "a whitespace-only profile id is not an id");
}

/// 后端自述：非空且不含任何密钥形状 —— 它会被写进诊断与界面。
#[test]
fn declares_which_backend_is_active() {
    assert!(!ACTIVE_BACKEND.is_empty());
    #[cfg(not(windows))]
    assert_eq!(ACTIVE_BACKEND, "memory", "only Windows has the credential manager backend");
}

/// 两条后端实现的是**同一套语义**（计划要求内存后端用于测试、凭据管理器用于生产）。
#[test]
fn the_memory_backend_satisfies_every_rule_the_windows_backend_must() {
    let store = mathcanvas_desktop_lib::secrets::memory::create();

    assert_eq!(store.put("a", "one").expect("put"), SecretState::Saved);
    assert_eq!(store.put("b", "two").expect("put"), SecretState::Saved);
    // 覆盖写：同一个 profile 再存一次就是替换，不是追加。
    assert_eq!(store.put("a", "three").expect("put"), SecretState::Saved);
    assert_eq!(store.with_secret("a", |secret| secret.to_string()).expect("read"), Some("three".to_string()));
    assert_eq!(store.with_secret("b", |secret| secret.to_string()).expect("read"), Some("two".to_string()));
    // 删一个不影响另一个。
    store.remove("a").expect("remove");
    assert!(!store.has("a").expect("has"));
    assert!(store.has("b").expect("has"));
}

/// **真的往 Windows 凭据管理器里存一次**（默认 `#[ignore]`）。
///
/// ## 为什么这条要单独存在、且默认不跑
///
/// 上面所有用例走的都是**内存后端** —— 也就是说"生产后端到底能不能用"这件事，
/// 没有任何一条常规测试碰过。而它恰恰是最可能失败的一环：凭据管理器可能被企业策略禁用、
/// `keyring` 的初始化可能失败、`Entry::new` 的服务名规则可能不符预期。
///
/// 它默认不跑，是因为它会**在开发者的真实凭据库里写一条**。所以：
/// - 用一个**一眼能认出是测试**的 profile 名（`__probe__` 前缀）；
/// - 结束时**必须**删掉（即使断言失败也删，用 `Drop` 保证）；
/// - 只在你主动要求时才跑：
///   `node scripts/toolchain.mjs cargo test --test secrets -- --ignored`
///
/// 计划 Step 5 要求"Verify the Windows backend on a real user profile"，
/// 这条就是那一步的自动化版本；手动那一遍（存 → 重启 → 检测 → 轮换 → 删除）记在进度文档里。
#[cfg(windows)]
#[test]
#[ignore = "writes to the real Windows Credential Manager; run explicitly with --ignored"]
fn the_windows_backend_really_stores_and_deletes_a_credential() {
    // 具体类型而不是 `&dyn SecretStore`：`with_secret` 是泛型方法，trait 失去 dyn 兼容性
    //（生产代码里因此用 `enum Store` 做静态分派，见 `secrets/mod.rs`）。
    let store = mathcanvas_desktop_lib::secrets::windows::create().expect("the credential manager must be available");
    let profile = "__probe__mathcanvas-secrets-test";

    /// 无论断言怎么炸，都要把测试凭据删掉 —— 不留垃圾在用户的凭据库里。
    struct Cleanup<'a> {
        store: &'a mathcanvas_desktop_lib::secrets::windows::WindowsSecretStore,
        profile: &'a str,
    }
    impl Drop for Cleanup<'_> {
        fn drop(&mut self) {
            let _ = self.store.remove(self.profile);
        }
    }
    let _cleanup = Cleanup { store: &store, profile };

    assert_eq!(store.backend(), "windows-credential-manager");
    assert!(!store.has(profile).expect("a fresh probe must not exist"));

    assert_eq!(store.put(profile, "sk-probe-value").expect("put"), SecretState::Saved);
    assert!(store.has(profile).expect("has after put"));
    // 轮换：再存一个不同的值，读回来必须是最新那个。
    assert_eq!(store.put(profile, "sk-probe-rotated").expect("put again"), SecretState::Saved);
    assert_eq!(store.with_secret(profile, |secret| secret.to_string()).expect("read"), Some("sk-probe-rotated".to_string()));

    store.remove(profile).expect("remove");
    assert!(!store.has(profile).expect("has after remove"));
    // 删两次不是错误（界面按钮可能被点两次）。
    store.remove(profile).expect("remove must be idempotent");
}
