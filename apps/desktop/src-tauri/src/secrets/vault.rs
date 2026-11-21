//! **应用私有目录加密凭据库**（Android 端默认持久后端 & 无系统钥匙串 Linux / 受限 Windows 的持久兜底）。
//!
//! 每条凭据使用随机 16 字节盐与 24 字节 XChaCha20 随机 nonce，配合 HMAC-SHA256 独立认证密钥
//! 做 Encrypt-then-MAC，并以常数时间校验 MAC、明文读取后立即 `zeroize`。
//! 主密钥保存在沙盒私有数据目录 `.vault.key`（Unix 强制 `0o600`），密文库原子写入 `secrets.vault`。
//! 任意错误消息都不包含密钥明文、密文或内部键字节。

use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chacha20::ChaCha20;
use cipher::{KeyIvInit as _, StreamCipher};
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use subtle::ConstantTimeEq;
use zeroize::Zeroize;

use super::{validate, SecretError, SecretState, SecretStore};

type HmacSha256 = Hmac<Sha256>;

const KEY_FILE_NAME: &str = ".vault.key";
const VAULT_FILE_NAME: &str = "secrets.vault";
const VAULT_VERSION: u32 = 1;
const MASTER_KEY_LEN: usize = 32;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct VaultDocument {
    version: u32,
    entries: BTreeMap<String, EncryptedEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncryptedEntry {
    salt_hex: String,
    nonce_hex: String,
    ciphertext_hex: String,
    mac_hex: String,
}

pub struct VaultSecretStore {
    root: PathBuf,
    master_key: [u8; MASTER_KEY_LEN],
    lock: Mutex<()>,
}

impl Drop for VaultSecretStore {
    fn drop(&mut self) {
        self.master_key.zeroize();
    }
}

pub fn create(data_root: &Path) -> Result<VaultSecretStore, SecretError> {
    fs::create_dir_all(data_root).map_err(|_| io_error())?;
    let key_path = data_root.join(KEY_FILE_NAME);
    let master_key = load_or_create_master_key(&key_path)?;
    let store = VaultSecretStore {
        root: data_root.to_path_buf(),
        master_key,
        lock: Mutex::new(()),
    };
    // 验证现有 vault 可读写解析，坏文件当场显式报错而不悄然清空。
    let _guard = store.lock.lock().map_err(|_| lock_error())?;
    let _ = store.load_document()?;
    drop(_guard);
    Ok(store)
}

fn io_error() -> SecretError {
    SecretError::Backend {
        detail: "the encrypted credential vault could not access storage".to_string(),
    }
}

fn lock_error() -> SecretError {
    SecretError::Backend {
        detail: "the encrypted credential vault lock is poisoned".to_string(),
    }
}

fn crypto_error() -> SecretError {
    SecretError::Backend {
        detail: "the encrypted credential vault failed integrity verification".to_string(),
    }
}

fn load_or_create_master_key(key_path: &Path) -> Result<[u8; MASTER_KEY_LEN], SecretError> {
    if key_path.exists() {
        let bytes = fs::read(key_path).map_err(|_| io_error())?;
        if bytes.len() != MASTER_KEY_LEN {
            return Err(crypto_error());
        }
        let mut key = [0u8; MASTER_KEY_LEN];
        key.copy_from_slice(&bytes);
        set_owner_only_permissions(key_path)?;
        return Ok(key);
    }
    let mut key = [0u8; MASTER_KEY_LEN];
    rand::rng().fill_bytes(&mut key);
    write_atomic(key_path, &key)?;
    Ok(key)
}

fn write_atomic(target: &Path, bytes: &[u8]) -> Result<(), SecretError> {
    let parent = target.parent().ok_or_else(io_error)?;
    fs::create_dir_all(parent).map_err(|_| io_error())?;
    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(io_error)?;
    let tmp_path = parent.join(format!(".{file_name}.tmp.{}", rand::rng().next_u64()));
    {
        let mut file = create_restricted_temp(&tmp_path)?;
        file.write_all(bytes).map_err(|_| io_error())?;
        file.sync_all().map_err(|_| io_error())?;
    }
    fs::rename(&tmp_path, target).map_err(|_| {
        let _ = fs::remove_file(&tmp_path);
        io_error()
    })?;
    set_owner_only_permissions(target)?;
    Ok(())
}

fn create_restricted_temp(path: &Path) -> Result<File, SecretError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)
            .map_err(|_| io_error())
    }
    #[cfg(not(unix))]
    {
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .map_err(|_| io_error())
    }
}

fn set_owner_only_permissions(path: &Path) -> Result<(), SecretError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|_| io_error())?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

fn encode_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

fn decode_hex(text: &str) -> Result<Vec<u8>, SecretError> {
    if text.len() % 2 != 0 {
        return Err(crypto_error());
    }
    let mut out = Vec::with_capacity(text.len() / 2);
    for idx in (0..text.len()).step_by(2) {
        let byte = u8::from_str_radix(&text[idx..idx + 2], 16).map_err(|_| crypto_error())?;
        out.push(byte);
    }
    Ok(out)
}

fn derive_subkey(master_key: &[u8; MASTER_KEY_LEN], label: &[u8], salt: &[u8], profile_id: &str) -> Result<[u8; 32], SecretError> {
    let mut mac = <HmacSha256 as hmac::KeyInit>::new_from_slice(master_key).map_err(|_| crypto_error())?;
    mac.update(label);
    mac.update(salt);
    mac.update(&(profile_id.len() as u64).to_le_bytes());
    mac.update(profile_id.as_bytes());
    let mut out = [0u8; 32];
    out.copy_from_slice(&mac.finalize().into_bytes());
    Ok(out)
}

fn compute_mac(
    mac_key: &[u8; 32],
    profile_id: &str,
    salt: &[u8],
    nonce: &[u8],
    ciphertext: &[u8],
) -> Result<[u8; 32], SecretError> {
    let mut mac = <HmacSha256 as hmac::KeyInit>::new_from_slice(mac_key).map_err(|_| crypto_error())?;
    mac.update(&VAULT_VERSION.to_le_bytes());
    mac.update(&(profile_id.len() as u64).to_le_bytes());
    mac.update(profile_id.as_bytes());
    mac.update(salt);
    mac.update(nonce);
    mac.update(&(ciphertext.len() as u64).to_le_bytes());
    mac.update(ciphertext);
    let mut out = [0u8; 32];
    out.copy_from_slice(&mac.finalize().into_bytes());
    Ok(out)
}

impl VaultSecretStore {
    fn vault_path(&self) -> PathBuf {
        self.root.join(VAULT_FILE_NAME)
    }

    fn load_document(&self) -> Result<VaultDocument, SecretError> {
        let path = self.vault_path();
        if !path.exists() {
            return Ok(VaultDocument {
                version: VAULT_VERSION,
                entries: BTreeMap::new(),
            });
        }
        let raw = fs::read_to_string(&path).map_err(|_| io_error())?;
        let doc: VaultDocument = serde_json::from_str(&raw).map_err(|_| crypto_error())?;
        if doc.version != VAULT_VERSION {
            return Err(crypto_error());
        }
        Ok(doc)
    }

    fn save_document(&self, document: &VaultDocument) -> Result<(), SecretError> {
        let serialized = serde_json::to_vec_pretty(document).map_err(|_| io_error())?;
        write_atomic(&self.vault_path(), &serialized)
    }

    fn encrypt_entry(&self, profile_id: &str, secret: &str) -> Result<EncryptedEntry, SecretError> {
        let mut salt = [0u8; SALT_LEN];
        let mut nonce = [0u8; NONCE_LEN];
        rand::rng().fill_bytes(&mut salt);
        rand::rng().fill_bytes(&mut nonce);

        let mut enc_key = derive_subkey(&self.master_key, b"mathcanvas-vault-enc-v1", &salt, profile_id)?;
        let mut mac_key = derive_subkey(&self.master_key, b"mathcanvas-vault-mac-v1", &salt, profile_id)?;
        let mut buffer = secret.as_bytes().to_vec();

        let mut cipher = ChaCha20::new(&enc_key.into(), &nonce.into());
        cipher.apply_keystream(&mut buffer);

        let tag = compute_mac(&mac_key, profile_id, &salt, &nonce, &buffer)?;
        enc_key.zeroize();
        mac_key.zeroize();

        let entry = EncryptedEntry {
            salt_hex: encode_hex(&salt),
            nonce_hex: encode_hex(&nonce),
            ciphertext_hex: encode_hex(&buffer),
            mac_hex: encode_hex(&tag),
        };
        buffer.zeroize();
        Ok(entry)
    }

    fn decrypt_entry(&self, profile_id: &str, entry: &EncryptedEntry) -> Result<String, SecretError> {
        let salt = decode_hex(&entry.salt_hex)?;
        let nonce = decode_hex(&entry.nonce_hex)?;
        let mut ciphertext = decode_hex(&entry.ciphertext_hex)?;
        let stored_mac = decode_hex(&entry.mac_hex)?;

        if salt.len() != SALT_LEN || nonce.len() != NONCE_LEN || stored_mac.len() != 32 {
            return Err(crypto_error());
        }
        let mut nonce_arr = [0u8; NONCE_LEN];
        nonce_arr.copy_from_slice(&nonce);

        let mut enc_key = derive_subkey(&self.master_key, b"mathcanvas-vault-enc-v1", &salt, profile_id)?;
        let mut mac_key = derive_subkey(&self.master_key, b"mathcanvas-vault-mac-v1", &salt, profile_id)?;

        let expected_mac = compute_mac(&mac_key, profile_id, &salt, &nonce_arr, &ciphertext)?;
        mac_key.zeroize();
        if !bool::from(expected_mac.ct_eq(&stored_mac)) {
            enc_key.zeroize();
            return Err(crypto_error());
        }

        let mut cipher = ChaCha20::new(&enc_key.into(), &nonce_arr.into());
        cipher.apply_keystream(&mut ciphertext);
        enc_key.zeroize();

        match String::from_utf8(ciphertext) {
            Ok(plaintext) => Ok(plaintext),
            Err(invalid) => {
                let mut bytes = invalid.into_bytes();
                bytes.zeroize();
                Err(crypto_error())
            }
        }
    }
}

impl SecretStore for VaultSecretStore {
    fn put(&self, profile_id: &str, secret: &str) -> Result<SecretState, SecretError> {
        validate(profile_id, Some(secret))?;
        let encrypted = self.encrypt_entry(profile_id, secret)?;
        let _guard = self.lock.lock().map_err(|_| lock_error())?;
        let mut doc = self.load_document()?;
        doc.entries.insert(profile_id.to_string(), encrypted);
        self.save_document(&doc)?;
        Ok(SecretState::Saved)
    }

    fn remove(&self, profile_id: &str) -> Result<(), SecretError> {
        validate(profile_id, None)?;
        let _guard = self.lock.lock().map_err(|_| lock_error())?;
        let mut doc = self.load_document()?;
        if doc.entries.remove(profile_id).is_some() {
            self.save_document(&doc)?;
        }
        Ok(())
    }

    fn has(&self, profile_id: &str) -> Result<bool, SecretError> {
        validate(profile_id, None)?;
        let _guard = self.lock.lock().map_err(|_| lock_error())?;
        let doc = self.load_document()?;
        let Some(entry) = doc.entries.get(profile_id) else {
            return Ok(false);
        };
        // 核验完整性后再汇报 true，防止篡改条目伪装有效。
        let mut plaintext = self.decrypt_entry(profile_id, entry)?;
        plaintext.zeroize();
        Ok(true)
    }

    fn with_secret<T>(&self, profile_id: &str, f: impl FnOnce(&str) -> T) -> Result<Option<T>, SecretError> {
        validate(profile_id, None)?;
        let _guard = self.lock.lock().map_err(|_| lock_error())?;
        let doc = self.load_document()?;
        let Some(entry) = doc.entries.get(profile_id) else {
            return Ok(None);
        };
        let mut plaintext = self.decrypt_entry(profile_id, entry)?;
        let output = f(&plaintext);
        plaintext.zeroize();
        Ok(Some(output))
    }

    fn backend(&self) -> &'static str {
        "encrypted-local-vault"
    }

    fn is_persistent(&self) -> bool {
        true
    }
}
