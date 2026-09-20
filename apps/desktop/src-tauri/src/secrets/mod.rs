//! **密钥库**（Task 1.2）。
//!
//! 计划的要求逐条落在这里：
//! - 内存后端用于测试、Windows 凭据管理器用于生产；
//! - 前端只能**写入 / 查询状态 / 删除**，**拿不回明文**；
//! - 序列化日志与 IPC 响应里都不能出现密钥字节。
//!
//! ## 三条设计决定的理由
//!
//! 1. **明文没有出口**。`put` 返回 `SecretState`（三态枚举）、`has` 返回 `bool`、
//!    `remove` 返回 `()`、`with_secret` 收一个闭包。**没有任何一个位置能装下明文** ——
//!    这比"记得不要返回它"可靠：将来有人想加 `get_secret`，必须**先改这些类型**，
//!    而那是一次看得见的改动。
//! 2. **没有后端时不假装成功**。内存后端出现在生产代码里不是为了测试方便，而是因为
//!    某些环境（非 Windows、凭据管理器不可用）需要一个能**如实回答"我存在但一会儿就没了"**的
//!    替身；否则调用方只能在"崩"与"假装成功"之间选。`ACTIVE_BACKEND` 就是这个自述。
//! 3. **空 id / 空密钥当场拒**。空 profile id 会让两个 provider 抢同一格；
//!    空密钥会把"没填"变成"存了一个空密钥"，于是界面显示已配置、而请求必然 401。

pub mod memory;
#[cfg(windows)]
pub mod windows;

use std::fmt;

/// 密钥的**状态**。这是唯一会跨 IPC 边界回到前端的"关于密钥"的信息。
///
/// 三个值都是**非明文**的：界面拿它决定显示"已保存 / 未配置"，仅此而已。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SecretState {
    /// 已保存（**不保证**下次启动还在 —— 那取决于后端，见 `ACTIVE_BACKEND`）。
    Saved,
    /// 没有配置。这是**正常状态**，不是错误。
    Missing,
    /// 后端出错了。消息里**不含**密钥。
    Error,
}

/// 密钥库的错误。**永远不会**包含密钥内容。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SecretError {
    /// profile id 为空或只有空白。
    EmptyProfileId,
    /// 密钥为空。
    EmptySecret,
    /// 后端拒绝或不可用。`detail` 由后端给出，**后端负责不把密钥写进去**。
    Backend { detail: String },
}

impl fmt::Display for SecretError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SecretError::EmptyProfileId => write!(formatter, "a profile id must be a non-empty identifier"),
            SecretError::EmptySecret => write!(formatter, "an empty secret must not be stored as if it were configured"),
            SecretError::Backend { detail } => write!(formatter, "the secret backend failed: {detail}"),
        }
    }
}

impl std::error::Error for SecretError {}

/// 密钥库。
///
/// `with_secret` 的闭包形态是刻意的：调用方要"**用一次**密钥"（例如签一次请求），
/// 而不是"拿到密钥"。明文只在闭包执行期间存在。
pub trait SecretStore: Send + Sync {
    fn put(&self, profile_id: &str, secret: &str) -> Result<SecretState, SecretError>;
    fn remove(&self, profile_id: &str) -> Result<(), SecretError>;
    fn has(&self, profile_id: &str) -> Result<bool, SecretError>;
    /// 借出密钥给闭包。**缺 key 时闭包不执行**，返回 `Ok(None)` ——
    /// 调用方据此走"没有配置"的分支，而不是拿到空字符串去发一次注定 401 的请求。
    fn with_secret<T>(&self, profile_id: &str, f: impl FnOnce(&str) -> T) -> Result<Option<T>, SecretError>;

    /// 这个后端把密钥放在哪。会进界面与诊断，所以**只描述形态，不含任何密钥信息**。
    fn backend(&self) -> &'static str;
}

/// 当前生效的后端名。
#[cfg(windows)]
pub const ACTIVE_BACKEND: &str = "windows-credential-manager";
#[cfg(not(windows))]
pub const ACTIVE_BACKEND: &str = "memory";

/// 内存后端必须被如实描述的那句话（会显示给用户）。
pub const MEMORY_BACKED_MESSAGE: &str = "this build keeps secrets in memory only: they are gone when the app exits";

/// 校验 profile id 与密钥。**两个后端共用**，所以规则只有一处。
pub(crate) fn validate(profile_id: &str, secret: Option<&str>) -> Result<(), SecretError> {
    if profile_id.trim().is_empty() {
        return Err(SecretError::EmptyProfileId);
    }
    if matches!(secret, Some(value) if value.is_empty()) {
        return Err(SecretError::EmptySecret);
    }
    Ok(())
}

/// 造一个当前平台该用的后端。
///
/// ## 为什么是一个 `enum` 而不是 `Box<dyn SecretStore>`（第一版就是那样，编译不过）
///
/// `with_secret<T>` 是**泛型方法**，泛型方法让 trait 失去 dyn 兼容性 —— 于是
/// `Box<dyn SecretStore>` 根本不成立（`E0038`）。两条出路：把泛型挪走（那就得把"借出明文"
/// 拆成两步，明文会在两步之间存在于调用方手里），或者**用 enum 做静态分派**。
/// 选后者：`with_secret` 的闭包形态正是"明文没有出口"那条性质的落点，不能为了 dyn 牺牲它。
///
/// enum 还带来一个副作用：**新增后端时编译器会逼你把每个方法都实现一遍**
///（`match` 必须穷尽），而 trait object 会默默走到某个默认实现上去。
pub enum Store {
    Memory(memory::MemorySecretStore),
    #[cfg(windows)]
    Windows(windows::WindowsSecretStore),
}

impl SecretStore for Store {
    fn put(&self, profile_id: &str, secret: &str) -> Result<SecretState, SecretError> {
        match self {
            Store::Memory(store) => store.put(profile_id, secret),
            #[cfg(windows)]
            Store::Windows(store) => store.put(profile_id, secret),
        }
    }

    fn remove(&self, profile_id: &str) -> Result<(), SecretError> {
        match self {
            Store::Memory(store) => store.remove(profile_id),
            #[cfg(windows)]
            Store::Windows(store) => store.remove(profile_id),
        }
    }

    fn has(&self, profile_id: &str) -> Result<bool, SecretError> {
        match self {
            Store::Memory(store) => store.has(profile_id),
            #[cfg(windows)]
            Store::Windows(store) => store.has(profile_id),
        }
    }

    fn with_secret<T>(&self, profile_id: &str, f: impl FnOnce(&str) -> T) -> Result<Option<T>, SecretError> {
        match self {
            Store::Memory(store) => store.with_secret(profile_id, f),
            #[cfg(windows)]
            Store::Windows(store) => store.with_secret(profile_id, f),
        }
    }

    fn backend(&self) -> &'static str {
        match self {
            Store::Memory(store) => store.backend(),
            #[cfg(windows)]
            Store::Windows(store) => store.backend(),
        }
    }
}

/// 造一个当前平台该用的后端。
///
/// Windows 上用凭据管理器；它不可用时（极少见：企业策略可能禁用）**退到内存后端而不是崩**，
/// 但 `backend()` 会说 `memory`，界面据此告诉用户"这次会话有效，重启要重新填"。
pub fn create_store() -> Store {
    #[cfg(windows)]
    {
        if let Ok(store) = windows::create() {
            return Store::Windows(store);
        }
    }
    Store::Memory(memory::create())
}
