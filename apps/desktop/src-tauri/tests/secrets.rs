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
    SecretError, SecretState, SecretStore, ACTIVE_BACKEND, MEMORY_BACKED_MESSAGE,
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

/// 计划 Step 1 点名的第一组：put / has / remove 的基本回路。
#[test]
fn stores_checks_and_removes_a_secret() {
    let store = mathcanvas_desktop_lib::secrets::create_store();

    assert_eq!(store.put("openai", "sk-test-1234").expect("put"), SecretState::Saved);
    assert!(store.has("openai").expect("has"));
    assert_eq!(store.remove("openai").expect("remove"), ());
    assert!(!store.has("openai").expect("has after remove"));
}

/// 缺 key 是**正常状态**，不是错误：界面要显示"还没配置"，而不是弹一个失败。
#[test]
fn reports_a_missing_key_as_missing_rather_than_as_a_failure() {
    let store = mathcanvas_desktop_lib::secrets::create_store();

    assert!(!store.has("never-saved").expect("has must not fail for a missing key"));
    assert_eq!(store.remove("never-saved").expect("remove must be idempotent"), ());
}

/// `with_secret` 把明文限制在一次闭包调用里。
#[test]
fn lends_the_secret_to_a_closure_and_nothing_else() {
    let store = mathcanvas_desktop_lib::secrets::create_store();
    store.put("anthropic", "sk-ant-test").expect("put");

    let observed = store.with_secret("anthropic", |secret| secret.len()).expect("with_secret");

    assert_eq!(observed, Some("sk-ant-test".len()));
    // 缺 key 时闭包**不执行**，返回 None —— 调用方据此走"没有配置"的分支，
    // 而不是拿到一个空字符串去发一次注定 401 的请求。
    assert_eq!(store.with_secret("nope", |secret| secret.len()).expect("with_secret"), None);
}

/// **错误信息里不能带明文**（计划："Assert serialized logs and mock IPC responses contain no secret bytes"）。
#[test]
fn never_puts_the_secret_into_an_error_message() {
    let store = mathcanvas_desktop_lib::secrets::create_store();
    let secret = "sk-super-secret-value-9f3a2b";

    // 空 profile id 会被拒 —— 那条错误信息里不许出现刚才存过的任何东西。
    store.put("openai", secret).expect("put");
    let error = store.put("", secret).expect_err("an empty profile id must be refused");

    assert!(!error.to_string().contains(secret), "the error leaked the secret: {error}");
    assert!(!format!("{error:?}").contains(secret), "the error debug leaked the secret: {error:?}");
}

/// 空 profile id 与空密钥都必须被拒：前者会让两个 provider 抢同一格，
/// 后者会把"没填"变成"存了一个空密钥"，于是界面显示已配置、而请求必然 401。
#[test]
fn refuses_an_empty_profile_id_or_an_empty_secret() {
    let store = mathcanvas_desktop_lib::secrets::create_store();

    assert!(store.put("", "sk-x").is_err());
    assert!(store.put("openai", "").is_err());
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
