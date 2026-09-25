use tauri::Manager;

use crate::secrets::{SecretState, SecretStore, Store};

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
    let state = app.try_state::<SecretStoreState>().ok_or("the secret store is not initialised")?;
    state.0.put(&profile_id, &secret).map_err(|error| error.to_string())
}

/// **删除一个 provider 的密钥**。删不存在的条目**不是错误**（按钮可能被点两次）。
#[tauri::command]
pub fn remove_secret(app: tauri::AppHandle, profile_id: String) -> Result<(), String> {
    let state = app.try_state::<SecretStoreState>().ok_or("the secret store is not initialised")?;
    state.0.remove(&profile_id).map_err(|error| error.to_string())
}

/// **查一个 provider 有没有配置密钥**。缺 key 回 `false`，不报错。
#[tauri::command]
pub fn has_secret(app: tauri::AppHandle, profile_id: String) -> Result<bool, String> {
    let state = app.try_state::<SecretStoreState>().ok_or("the secret store is not initialised")?;
    state.0.has(&profile_id).map_err(|error| error.to_string())
}
