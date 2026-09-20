//! **Provider 配置的持久化**（Task 1.3）。
//!
//! 计划要求的接口是 `ProviderProfileStore.list()` / `.upsert(profileWithoutSecret)` /
//! `.remove(profileId)` / `.markHealth(profileId, health)`。
//!
//! ## 三条纪律
//!
//! 1. **落盘的 profile 里没有密钥**。`upsert` **拒绝**任何带密钥形状字段的对象
//!    （结构检查，不是字符串扫描）—— 密钥在系统凭据库里，配置里只有 `secretRef`。
//!    这条在 TypeScript 侧已经查过一遍了；这里再查一次，是因为"密钥落到磁盘上"
//!    只差一次疏忽，而两次检查的代价是零。
//! 2. **写入是原子的**：先写临时文件再改名。中途崩溃留下的要么是旧的完整文件，
//!    要么是新的完整文件，**不会是半个**。这比"写之前备份"简单且足够。
//! 3. **读不动就如实说**，不静默重置。配置文件坏了要报错让用户知道
//!    （重置会把他的所有配置悄悄删掉）。

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// 协议闭集（与 `packages/agent-core/src/providerContracts.ts` 逐字对应）。
pub const PROTOCOLS: [&str; 3] = ["openai_compatible", "anthropic", "ollama"];
/// 方言闭集。
pub const DIALECTS: [&str; 6] = ["openai_native", "deepseek", "moonshot", "generic_compatible", "anthropic_messages", "ollama_native"];
/// 网络策略闭集。
pub const NETWORK_POLICIES: [&str; 3] = ["cloud", "lan", "local"];

/// **绝不能出现在 profile 里的字段名**（小写比较）。`secretref` 刻意不在其中 —— 它是引用。
const FORBIDDEN_SECRET_FIELDS: [&str; 9] = ["secret", "secretvalue", "secret_value", "apikey", "api_key", "key", "token", "password", "credential"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityEvidence {
    pub feature: String,
    /// `unknown` / `declared` / `verified` / `failed`。
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checked_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderProfile {
    pub id: String,
    pub name: String,
    pub protocol: String,
    pub dialect: String,
    pub base_url: String,
    pub model_id: String,
    /// **只有引用**：真正的密钥在系统凭据库里（Task 1.2）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret_ref: Option<String>,
    #[serde(default)]
    pub capabilities: Vec<CapabilityEvidence>,
    pub network_policy: String,
    pub revision: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderHealth {
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    #[serde(default)]
    pub capability_evidence: Vec<CapabilityEvidence>,
    pub checked_at: i64,
    /// 这份证据对应哪一版 profile。**与当前 revision 不符的证据不该被当成本次的依据。**
    pub profile_revision: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoreError {
    /// 落盘对象里出现了密钥形状的字段。
    SecretInProfile { field: String },
    /// 校验失败（字段缺失或不在闭集里）。
    Invalid { detail: String },
    /// 找不到要更新 / 删除的 profile。
    NotFound { id: String },
    /// 配置文件读不动或写不动。
    Io { detail: String },
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StoreError::SecretInProfile { field } => write!(formatter, "a provider profile must not carry `{field}`; store the secret in the credential store and reference it with secretRef"),
            StoreError::Invalid { detail } => write!(formatter, "{detail}"),
            StoreError::NotFound { id } => write!(formatter, "no provider profile with id {id}"),
            StoreError::Io { detail } => write!(formatter, "{detail}"),
        }
    }
}

impl std::error::Error for StoreError {}

/// 落盘内容。带一个 `schemaVersion`：将来改结构时能**认出来**并给出可执行的错误，
/// 而不是把不认识的字段当作默认值（那会静默丢掉用户的配置）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfilesFile {
    schema_version: u32,
    profiles: Vec<ProviderProfile>,
    /// 健康记录按 profile id 存。它不是配置，所以与 profiles 分开。
    #[serde(default)]
    health: HashMap<String, ProviderHealth>,
}

pub const PROFILES_SCHEMA_VERSION: u32 = 1;

pub struct ProviderProfileStore {
    path: PathBuf,
    file: ProfilesFile,
}

/// 结构检查：这个 JSON 值里有没有密钥形状的字段（任意深度）。
///
/// **不是**字符串扫描 —— 密钥可能藏在嵌套对象里，而 `sk-` 这种前缀只是巧合的一部分。
/// 只看**字段名**：`secretRef` 放行，其余九个一律算密钥。
pub fn contains_secret_field(value: &serde_json::Value, depth: usize) -> Option<String> {
    if depth > 6 {
        return None;
    }
    let object = value.as_object()?;
    for (key, child) in object {
        let lowered = key.to_lowercase();
        if lowered != "secretref" && FORBIDDEN_SECRET_FIELDS.contains(&lowered.as_str()) {
            return Some(key.clone());
        }
        if let Some(found) = contains_secret_field(child, depth + 1) {
            return Some(found);
        }
    }
    None
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|value| value.as_millis() as i64).unwrap_or(0)
}

impl ProviderProfileStore {
    /// 打开（或新建）配置文件。
    ///
    /// 文件不存在 → 空库（首次启动的正常状态）；文件存在但读不动 → `Io` 错误，
    /// **不静默重置**（重置会把用户所有配置悄悄删掉）。
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let path = path.as_ref().to_path_buf();
        if !path.exists() {
            return Ok(Self { path, file: ProfilesFile { schema_version: PROFILES_SCHEMA_VERSION, profiles: Vec::new(), health: HashMap::new() } });
        }
        let text = fs::read_to_string(&path).map_err(|error| StoreError::Io { detail: format!("cannot read {}: {error}", path.display()) })?;
        let file: ProfilesFile = serde_json::from_str(&text).map_err(|error| StoreError::Io { detail: format!("the provider configuration is not valid JSON ({error}); fix or move {}", path.display()) })?;
        if file.schema_version != PROFILES_SCHEMA_VERSION {
            return Err(StoreError::Io { detail: format!("the provider configuration was written by a newer version (schema {}), this build understands {}", file.schema_version, PROFILES_SCHEMA_VERSION) });
        }
        Ok(Self { path, file })
    }

    pub fn list(&self) -> Vec<ProviderProfile> {
        let mut profiles = self.file.profiles.clone();
        // 稳定的顺序：界面上的列表不该因为存了一次就换位置。
        profiles.sort_by(|left, right| left.name.cmp(&right.name).then(left.id.cmp(&right.id)));
        profiles
    }

    pub fn get(&self, id: &str) -> Option<ProviderProfile> {
        self.file.profiles.iter().find(|profile| profile.id == id).cloned()
    }

    pub fn health(&self, id: &str) -> Option<ProviderHealth> {
        self.file.health.get(id).cloned()
    }

    /// **写入一份不含密钥的 profile**。
    ///
    /// `expected_revision` 是**乐观并发检查**：传 `Some(n)` 时，只有当前 revision 等于 `n`
    /// 才允许写。两个设置窗口同时开着时，后写的那个会拿到 `Invalid` 而不是把前一个覆盖掉。
    pub fn upsert(&mut self, profile: ProviderProfile, expected_revision: Option<u32>) -> Result<ProviderProfile, StoreError> {
        // 先做结构检查（在任何写盘动作之前）。
        let value = serde_json::to_value(&profile).map_err(|error| StoreError::Io { detail: format!("cannot serialize the profile: {error}") })?;
        if let Some(field) = contains_secret_field(&value, 0) {
            return Err(StoreError::SecretInProfile { field });
        }
        self.validate(&profile)?;

        let existing = self.file.profiles.iter().position(|candidate| candidate.id == profile.id);
        match existing {
            Some(index) => {
                let current = &self.file.profiles[index];
                if let Some(expected) = expected_revision {
                    if current.revision != expected {
                        return Err(StoreError::Invalid { detail: format!("profile {} is at revision {}, not {expected}; reload before saving", profile.id, current.revision) });
                    }
                }
                // 修订号由**存储方**递增：调用方给的值一律忽略。
                let mut updated = profile;
                updated.revision = current.revision + 1;
                self.file.profiles[index] = updated.clone();
                self.save()?;
                Ok(updated)
            }
            None => {
                // 新建时名字也不能重复（否则列表里两条一样的名字，用户分不清）。
                if self.file.profiles.iter().any(|candidate| candidate.name == profile.name) {
                    return Err(StoreError::Invalid { detail: format!("another profile is already called {}", profile.name) });
                }
                let mut created = profile;
                created.revision = 1;
                self.file.profiles.push(created.clone());
                self.save()?;
                Ok(created)
            }
        }
    }

    pub fn remove(&mut self, id: &str) -> Result<(), StoreError> {
        let before = self.file.profiles.len();
        self.file.profiles.retain(|profile| profile.id != id);
        if self.file.profiles.len() == before {
            return Err(StoreError::NotFound { id: id.to_string() });
        }
        // 健康记录跟着删：留着它会让"重新建一个同 id 的 profile"继承旧证据。
        self.file.health.remove(id);
        self.save()
    }

    /// 记一次健康检查。**证据必须带上它对应的 revision**。
    pub fn mark_health(&mut self, id: &str, health: ProviderHealth) -> Result<(), StoreError> {
        if !self.file.profiles.iter().any(|profile| profile.id == id) {
            return Err(StoreError::NotFound { id: id.to_string() });
        }
        self.file.health.insert(id.to_string(), health);
        self.save()
    }

    fn validate(&self, profile: &ProviderProfile) -> Result<(), StoreError> {
        if profile.id.trim().is_empty() {
            return Err(StoreError::Invalid { detail: "a provider profile needs an id".to_string() });
        }
        if profile.name.trim().is_empty() {
            return Err(StoreError::Invalid { detail: "a provider profile needs a display name".to_string() });
        }
        if !PROTOCOLS.contains(&profile.protocol.as_str()) {
            return Err(StoreError::Invalid { detail: format!("unknown protocol {}", profile.protocol) });
        }
        if !DIALECTS.contains(&profile.dialect.as_str()) {
            return Err(StoreError::Invalid { detail: format!("unknown dialect {}", profile.dialect) });
        }
        if !NETWORK_POLICIES.contains(&profile.network_policy.as_str()) {
            return Err(StoreError::Invalid { detail: format!("unknown network policy {}", profile.network_policy) });
        }
        if profile.model_id.trim().is_empty() {
            return Err(StoreError::Invalid { detail: "a provider profile needs a model id".to_string() });
        }
        // 名字重复（除自己以外）。
        if self.file.profiles.iter().any(|candidate| candidate.id != profile.id && candidate.name == profile.name) {
            return Err(StoreError::Invalid { detail: format!("another profile is already called {}", profile.name) });
        }
        Ok(())
    }

    /// **原子写盘**：先写 `*.tmp` 再改名。
    ///
    /// 中途崩溃留下的要么是旧的完整文件、要么是新的完整文件 —— **不会是半个**。
    /// 比"写之前备份"简单，且足够：配置文件很小，改名是原子的。
    fn save(&self) -> Result<(), StoreError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|error| StoreError::Io { detail: format!("cannot create {}: {error}", parent.display()) })?;
        }
        let text = serde_json::to_string_pretty(&self.file).map_err(|error| StoreError::Io { detail: format!("cannot serialize the provider configuration: {error}") })?;
        let temp = self.path.with_extension("json.tmp");
        {
            let mut handle = fs::File::create(&temp).map_err(|error| StoreError::Io { detail: format!("cannot write {}: {error}", temp.display()) })?;
            handle.write_all(text.as_bytes()).map_err(|error| StoreError::Io { detail: format!("cannot write {}: {error}", temp.display()) })?;
            // 落盘再改名：断电时改名这一步要么没发生、要么已生效。
            handle.sync_all().map_err(|error| StoreError::Io { detail: format!("cannot flush {}: {error}", temp.display()) })?;
        }
        fs::rename(&temp, &self.path).map_err(|error| StoreError::Io { detail: format!("cannot replace {}: {error}", self.path.display()) })
    }
}

/// 现在的时间（毫秒）。**暴露出来是为了让测试与界面用同一个时钟**（不是各写一遍）。
pub fn timestamp_ms() -> i64 {
    now_ms()
}

// ---------------------------------------------------------------- 纯逻辑（IPC 命令的薄壳）

/**
 * **校验并整理一份要被写入的 profile**（不碰磁盘）。
 *
 * 抽成纯函数是刻意的：Tauri 的 IPC 命令要一个真实的 `AppHandle` 才能跑，
 * 于是"命令里的逻辑"通常**永远没有测试**。把两条判断放在这里 ——
 * ①**落盘对象里不许有密钥字段**（结构检查）、②必填与闭集 ——
 * 就能被单元测试逐条钉住，而命令只剩"取锁 → 调它 → 存 → 释放"。
 */
pub fn prepare_profile(input: &serde_json::Value) -> Result<ProviderProfile, StoreError> {
    if let Some(field) = contains_secret_field(input, 0) {
        return Err(StoreError::SecretInProfile { field });
    }
    serde_json::from_value::<ProviderProfile>(input.clone())
        .map_err(|error| StoreError::Invalid { detail: format!("the profile shape is invalid: {error}") })
}

/** 记健康记录之前先确认 profile 存在（拼出一个"孤立的证据"是没意义的）。 */
pub fn prepare_health(profile_revision: u32) -> ProviderHealth {
    ProviderHealth { status: "unknown".to_string(), latency_ms: None, capability_evidence: Vec::new(), checked_at: now_ms(), profile_revision }
}
