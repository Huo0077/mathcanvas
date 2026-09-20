//! **Windows 凭据管理器后端**（Task 1.2 的生产后端）。
//!
//! 计划原文：`put` / `remove` / `has` / `with_secret`，生产用 **Windows Credential Manager**。
//!
//! ## 为什么用 `keyring` crate 而不是自己写 FFI
//!
//! Windows 凭据管理器是 `CredReadW` / `CredWriteW` / `CredDeleteW` 三个 Win32 调用加一个
//! 复合结构体。自己写要碰 `unsafe`、要手算宽字符串、要处理 `GetLastError` 的每一条 ——
//! 而这一段**没有测试能覆盖**（单元测试跑在构建机上，不能真往用户凭据库里写东西）。
//! `keyring` 是这件事上被广泛使用的实现，把那段 `unsafe` 收在它自己的测试后面。
//! 这里只写"本项目需要的语义"，并且把 `get_password()` 的明文**立刻**交给 `with_secret` 的闭包，
//! 不让它在本模块里多存一步。
//!
//! ## 两条必须守住的纪律
//!
//! 1. **错误信息里不含明文**。`keyring` 的错误只会说明"没找到 / 后端失败"，不含密码；
//!    这里再把它压成一句固定的话，避免将来某个版本的错误信息变宽。
//! 2. **`missing` 不是错误**。凭据库里没有这一条时 `has` 回 `false`、`with_secret` 回 `None` ——
//!    界面要显示"还没配置"，而不是弹一个失败。

use keyring::Entry;

use super::{validate, SecretError, SecretState, SecretStore};

/// 凭据在凭据管理器里的"服务名"。
///
/// 加前缀是刻意的：凭据管理器的服务名是**全局**的，直接用 `openai` 会与别的应用
/// 抢同一格（用户可能在别处也用这个名字）。前缀让"谁写的"一目了然，也让卸载时能一眼找到。
const SERVICE: &str = "MathCanvas";

pub struct WindowsSecretStore;

/// 凭据管理器不可用时（极少见：企业策略可能禁用）如实报出来，
/// 由 `create_store` 决定退到内存后端 —— **不蹦、也不假装成功**。
pub fn create() -> Result<WindowsSecretStore, SecretError> {
    // 建一个探针条目以确认后端可用（`Entry::new` 在后端不可用时返回 `NoDefaultStore`）。
    Entry::new(SERVICE, "probe").map(|_| WindowsSecretStore).map_err(to_backend_error)
}

/// 把 `keyring` 的错误压成我们自己的错误。**只保留形态，不转发任何可能是密钥的内容。**
fn to_backend_error(error: keyring::Error) -> SecretError {
    let kind = match error {
        keyring::Error::NoEntry => return SecretError::Backend { detail: "no entry".to_string() },
        keyring::Error::NoDefaultStore => "the platform credential store is unavailable",
        keyring::Error::Ambiguous(_) => "the credential store matched more than one entry",
        _ => "the credential store refused the operation",
    };
    SecretError::Backend { detail: kind.to_string() }
}

fn entry(profile_id: &str) -> Result<Entry, SecretError> {
    Entry::new(SERVICE, profile_id).map_err(to_backend_error)
}

impl SecretStore for WindowsSecretStore {
    fn put(&self, profile_id: &str, secret: &str) -> Result<SecretState, SecretError> {
        validate(profile_id, Some(secret))?;
        // 覆盖写：凭据管理器里同名条目会被替换（`Entry::set_password` 的语义）。
        entry(profile_id)?.set_password(secret).map_err(to_backend_error)?;
        Ok(SecretState::Saved)
    }

    fn remove(&self, profile_id: &str) -> Result<(), SecretError> {
        validate(profile_id, None)?;
        match entry(profile_id)?.delete_credential() {
            Ok(()) => Ok(()),
            // 删不存在的条目不是错误：界面上的"删除"按钮可能被点两次。
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(other) => Err(to_backend_error(other)),
        }
    }

    fn has(&self, profile_id: &str) -> Result<bool, SecretError> {
        validate(profile_id, None)?;
        match entry(profile_id)?.get_password() {
            Ok(_) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(other) => Err(to_backend_error(other)),
        }
    }

    fn with_secret<T>(&self, profile_id: &str, f: impl FnOnce(&str) -> T) -> Result<Option<T>, SecretError> {
        validate(profile_id, None)?;
        match entry(profile_id)?.get_password() {
            // 明文只在闭包执行期间存在：这一行之后本模块不再持有它。
            Ok(secret) => Ok(Some(f(&secret))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(other) => Err(to_backend_error(other)),
        }
    }

    fn backend(&self) -> &'static str {
        "windows-credential-manager"
    }
}
