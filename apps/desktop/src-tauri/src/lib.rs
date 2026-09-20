//! **MathCanvas 桌面外壳**（Task 1.1 / 1.2）。
//!
//! 这一层只做几件事，且每件都必须能被审出来：
//! 1. **起窗口、加载既有的 web 应用**（`tauri.conf.json` 的 `frontendDist` 指向
//!    `build-check/mathcanvas-current`）—— 前端**不重复一份**，几何 store 还是那一份；
//! 2. **只暴露具名 IPC 命令**。计划原文："Rust exposes only named IPC commands;
//!    no generic command accepting JavaScript or shell text." 所以这里
//!    **没有、也不会有** `eval` / `run_shell` / `read_file` 这类命令。
//!    目前一共四个，全部是具名且窄的：`get_runtime_info` / `save_secret` /
//!    `remove_secret` / `has_secret`；
//! 3. **密钥的明文没有出口**：三个密钥命令的返回类型里**没有位置**能装下明文
//!   （见 `secrets/mod.rs` 的三条设计决定）。
//!
//! ## 为什么密钥库挂在 `App` 的托管状态上
//!
//! `create_store()` 在 Windows 上会去碰系统凭据管理器（`Entry::new` 会初始化后端）。
//! 每次 IPC 都新建一个 store 等于每次都重新初始化一遍 —— 那是可以避免的开销，
//! 也会让"后端到底可不可用"这件事每次都被重新判定。挂上去之后**只初始化一次**，
//! 且 `get_runtime_info` 与三个密钥命令看到的是**同一个**后端。

pub mod runtime;
/// 密钥库（Task 1.2）。**明文没有出口** —— 见 `secrets/mod.rs` 的三条设计决定。
pub mod secrets;

use secrets::{SecretState, SecretStore, Store};
use tauri::Manager;

/// 密钥库在 Tauri 托管状态里的包装。
struct SecretStoreState(Store);

/// **唯一的自述命令**（Task 1.1 Step 4）。
///
/// 它回答"我现在跑在什么上面、哪些部件是好的"，供前端如实显示。
///
/// 取数据根用的是 `app.path().app_data_dir()`（Tauri 自己按应用标识算出来的那一个），
/// 再交给 `build_runtime_info` 只取目录名 —— 于是**绝对路径不会离开 Rust 侧**。
///
/// 密钥库的状态**现问后端**（而不是写死）：只有 `windows-credential-manager`
/// 才是"关掉应用之后还在"；退到内存后端时必须如实说"还没实现"（界面据此提醒用户）。
#[tauri::command]
fn get_runtime_info(app: tauri::AppHandle) -> Result<runtime::DesktopRuntimeInfo, String> {
    let data_root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("cannot resolve the app data directory: {error}"))?;
    let version = app.package_info().version.to_string();
    // 没有托管状态时按"不可用"处理：自述宁可说"还没有"，也不许猜"有"。
    let secret_store_ready = app
        .try_state::<SecretStoreState>()
        .is_some_and(|state| state.0.backend() == "windows-credential-manager");
    Ok(runtime::build_runtime_info(&version, &data_root, secret_store_ready))
}

/// **保存一个 provider 的密钥**（Task 1.2 Step 4）。
///
/// 返回的是 `SecretState`（三态枚举）—— **不是**明文，也不是原文回显。
/// 前端据此显示"已保存 / 未配置 / 出错"，并**立刻清空输入框**。
#[tauri::command]
fn save_secret(app: tauri::AppHandle, profile_id: String, secret: String) -> Result<SecretState, String> {
    let state = app.try_state::<SecretStoreState>().ok_or("the secret store is not initialised")?;
    state.0.put(&profile_id, &secret).map_err(|error| error.to_string())
}

/// **删除一个 provider 的密钥**。删不存在的条目**不是错误**（按钮可能被点两次）。
#[tauri::command]
fn remove_secret(app: tauri::AppHandle, profile_id: String) -> Result<(), String> {
    let state = app.try_state::<SecretStoreState>().ok_or("the secret store is not initialised")?;
    state.0.remove(&profile_id).map_err(|error| error.to_string())
}

/// **查一个 provider 有没有配置密钥**。缺 key 回 `false`，不报错。
#[tauri::command]
fn has_secret(app: tauri::AppHandle, profile_id: String) -> Result<bool, String> {
    let state = app.try_state::<SecretStoreState>().ok_or("the secret store is not initialised")?;
    state.0.has(&profile_id).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // **只初始化一次**：Windows 上这一步会去碰系统凭据管理器。
            app.manage(SecretStoreState(secrets::create_store()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_runtime_info, save_secret, remove_secret, has_secret])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
