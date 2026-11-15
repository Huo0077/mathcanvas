use tauri::Manager;

use crate::commands::providers::ProfileStoreState;
use crate::repository::provider_profiles::ProviderProfile;
use crate::secrets::{SecretState, SecretStore, Store};

pub fn legacy_secret_write_allowed(profile: Option<&ProviderProfile>, has_secret: bool) -> Result<(), String> {
    let profile = profile.ok_or("the provider profile must exist before a legacy credential can be added")?;
    if profile.secret_ref.as_deref().unwrap_or(&profile.id) != profile.id || profile.credential_endpoint.is_some() {
        return Err("versioned credentials can only be changed through update_provider_credentials".to_string());
    }
    if has_secret {
        return Err("an existing credential can only be replaced through update_provider_credentials".to_string());
    }
    Ok(())
}

pub fn secret_removal_allowed(profiles: &[ProviderProfile], reference: &str) -> bool {
    !profiles.iter().any(|profile| profile.secret_ref.as_deref().unwrap_or(&profile.id) == reference)
}

/**
 * **密钥命令**（从 `lib.rs` 拆出，评审方案 2）。
 *
 * 三条纪律在文件层面就能看全：**明文没有出口** —— 保存回三态枚举、查询回布尔、删除回单元，
 * 返回类型里没有位置能装下密钥。前端据此显示"已保存 / 未配置 / 出错"，并立刻清空输入框。
 *
 * 密钥库本身（`crate::secrets`）挂在 Tauri 的托管状态上、**只初始化一次**：
 * `create_store()` 在 Windows 上会碰系统凭据管理器，每次 IPC 都新建一遍既是白做的开销，
 * 也会让"后端到底可不可用"每次被重新判定。
 */
/// 密钥库在 Tauri 托管状态里的包装。
pub struct SecretStoreState(pub Store);

/// **保存一个 provider 的密钥**（Task 1.2 Step 4）。
///
/// 返回的是 `SecretState`（三态枚举）—— **不是**明文，也不是原文回显。
/// 前端据此显示"已保存 / 未配置 / 出错"，并**立刻清空输入框**。
#[tauri::command]
pub fn save_secret(app: tauri::AppHandle, profile_id: String, secret: String) -> Result<SecretState, String> {
    let profiles = app.try_state::<ProfileStoreState>().ok_or("the provider store is not initialised")?;
    let store = profiles.store.lock().map_err(|_| "the provider store is poisoned".to_string())?;
    let profile = store.get(&profile_id);
    let legacy = profile.as_ref().is_some_and(|profile| profile.secret_ref.as_deref().unwrap_or(&profile.id) == profile.id && profile.credential_endpoint.is_none());
    let state = app.try_state::<SecretStoreState>().ok_or("the secret store is not initialised")?;
    let has_secret = if legacy { state.0.has(&profile_id).map_err(|error| error.to_string())? } else { false };
    legacy_secret_write_allowed(profile.as_ref(), has_secret)?;
    let result = state.0.put(&profile_id, &secret).map_err(|error| error.to_string());
    drop(store);
    result
}

/// **删除一个 provider 的密钥**。删不存在的条目**不是错误**（按钮可能被点两次）。
#[tauri::command]
pub fn remove_secret(app: tauri::AppHandle, profile_id: String) -> Result<(), String> {
    let profiles = app.try_state::<ProfileStoreState>().ok_or("the provider store is not initialised")?;
    let store = profiles.store.lock().map_err(|_| "the provider store is poisoned".to_string())?;
    if !secret_removal_allowed(&store.list(), &profile_id) {
        return Err("a credential referenced by a profile cannot be removed through the legacy command".to_string());
    }
    let state = app.try_state::<SecretStoreState>().ok_or("the secret store is not initialised")?;
    let result = state.0.remove(&profile_id).map_err(|error| error.to_string());
    drop(store);
    result
}

/// **查一个 provider 有没有配置密钥**。缺 key 回 `false`，不报错。
#[tauri::command]
pub fn has_secret(app: tauri::AppHandle, profile_id: String) -> Result<bool, String> {
    let state = app.try_state::<SecretStoreState>().ok_or("the secret store is not initialised")?;
    state.0.has(&profile_id).map_err(|error| error.to_string())
}
