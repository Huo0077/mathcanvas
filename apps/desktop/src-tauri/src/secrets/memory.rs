//! **内存后端**。
//!
//! 它**不是**"测试专用的假货"：非 Windows 平台、以及凭据管理器被企业策略禁用的 Windows
//! 上，它就是**真的后端** —— 只不过进程一退密钥就没了。所以 `backend()` 会如实回 `"memory"`，
//! 界面据此告诉用户"这次会话有效，重启要重新填"。
//!
//! 这也是为什么它住在生产代码里而不是 `#[cfg(test)]` 后面：如果它在测试里，
//! "没有后端时会发生什么"这条路径就**从来没有代码走过**。

use std::collections::HashMap;
use std::sync::Mutex;

use super::{validate, SecretError, SecretState, SecretStore};

/// 内存后端的存储。用 `Mutex` 而不是 `RwLock`：读写都极短，而 `with_secret` 需要
/// 在闭包执行**期间**持有锁 —— 用读写锁会诱使人把锁拆开，那段窗口就是密钥可能被换掉的窗口。
#[derive(Default)]
pub struct MemorySecretStore {
    values: Mutex<HashMap<String, String>>,
}

pub fn create() -> MemorySecretStore {
    MemorySecretStore::default()
}

impl SecretStore for MemorySecretStore {
    fn put(&self, profile_id: &str, secret: &str) -> Result<SecretState, SecretError> {
        validate(profile_id, Some(secret))?;
        let mut values = self.values.lock().map_err(|_| SecretError::Backend { detail: "the in-memory store is poisoned".to_string() })?;
        values.insert(profile_id.to_string(), secret.to_string());
        Ok(SecretState::Saved)
    }

    fn remove(&self, profile_id: &str) -> Result<(), SecretError> {
        validate(profile_id, None)?;
        let mut values = self.values.lock().map_err(|_| SecretError::Backend { detail: "the in-memory store is poisoned".to_string() })?;
        // 删不存在的 key **不是错误**：界面上的"删除"按钮可能被点两次。
        values.remove(profile_id);
        Ok(())
    }

    fn has(&self, profile_id: &str) -> Result<bool, SecretError> {
        validate(profile_id, None)?;
        let values = self.values.lock().map_err(|_| SecretError::Backend { detail: "the in-memory store is poisoned".to_string() })?;
        Ok(values.contains_key(profile_id))
    }

    fn with_secret<T>(&self, profile_id: &str, f: impl FnOnce(&str) -> T) -> Result<Option<T>, SecretError> {
        validate(profile_id, None)?;
        let values = self.values.lock().map_err(|_| SecretError::Backend { detail: "the in-memory store is poisoned".to_string() })?;
        Ok(values.get(profile_id).map(|secret| f(secret)))
    }

    fn backend(&self) -> &'static str {
        "memory"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn says_it_is_the_memory_backend_so_the_interface_can_warn_the_user() {
        assert_eq!(create().backend(), "memory");
    }

    #[test]
    fn never_returns_the_secret_from_put_or_has() {
        let store = create();
        // 这两个的返回类型里**没有位置**能装明文 —— 这条断言只是把那个事实写下来。
        let state: SecretState = store.put("p", "sk-secret").expect("put");
        let present: bool = store.has("p").expect("has");

        assert_eq!(state, SecretState::Saved);
        assert!(present);
    }
}
