//! **Linux Secret Service 凭据库后端**（GNOME Keyring / KWallet 等 DBus Secret Service）。
//!
//! 桌面 Linux（Ubuntu / Fedora / KDE / GNOME 等）在安装并运行 Secret Service 守护进程时，
//! 优先使用系统钥匙串持久化模型 API 密钥；若处于无桌面/未启动 keyring 守护进程的精简 Linux 环境，
//! `create()` 探测失败后由上层自动降级到应用私有加密存储（`vault`），绝不假装保存成功。

use keyring::Entry;

use super::{validate, SecretError, SecretState, SecretStore};

const SERVICE: &str = "MathCanvas";

pub struct LinuxKeyringSecretStore;

/// 探测 Linux Secret Service 守护进程是否可用。
/// 与 Windows 不同，Linux 上部分发行版或无头环境下 `Entry::new` 不会立刻连接 DBus，
/// 因此主动执行一次 `get_password` 探针，仅当返回 `Ok` 或 `NoEntry` 时认定系统钥匙串可用。
pub fn create() -> Result<LinuxKeyringSecretStore, SecretError> {
    let probe = Entry::new(SERVICE, "__probe__mathcanvas").map_err(to_backend_error)?;
    match probe.get_password() {
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(LinuxKeyringSecretStore),
        Err(error) => Err(to_backend_error(error)),
    }
}

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

impl SecretStore for LinuxKeyringSecretStore {
    fn put(&self, profile_id: &str, secret: &str) -> Result<SecretState, SecretError> {
        validate(profile_id, Some(secret))?;
        entry(profile_id)?.set_password(secret).map_err(to_backend_error)?;
        Ok(SecretState::Saved)
    }

    fn remove(&self, profile_id: &str) -> Result<(), SecretError> {
        validate(profile_id, None)?;
        match entry(profile_id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
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
            Ok(secret) => Ok(Some(f(&secret))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(other) => Err(to_backend_error(other)),
        }
    }

    fn backend(&self) -> &'static str {
        "linux-secret-service"
    }

    fn is_persistent(&self) -> bool {
        true
    }
}
