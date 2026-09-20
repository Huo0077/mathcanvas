//! **MathCanvas 桌面外壳**（Task 1.1）。
//!
//! 这一层只做三件事，且每件都必须能被审出来：
//! 1. **起窗口、加载既有的 web 应用**（`tauri.conf.json` 的 `frontendDist` 指向
//!    `build-check/mathcanvas-current`）—— 前端**不重复一份**，几何 store 还是那一份；
//! 2. **只暴露具名 IPC 命令**。计划原文："Rust exposes only named IPC commands;
//!    no generic command accepting JavaScript or shell text." 所以这里
//!    **没有、也不会有** `eval` / `run_shell` / `read_file` 这类命令；
//! 3. **自述**（`get_runtime_info`），见 `runtime.rs`：不带密钥、不带数据根之外的路径。

/// 自述模块对集成测试可见（`tests/shell_smoke.rs` 会读 WebView2 版本作为留档证据）。
pub mod runtime;

use runtime::DesktopRuntimeInfo;

/// **唯一的 IPC 命令**（Task 1.1 Step 4）。
///
/// 它回答"我现在跑在什么上面、哪些部件是好的"，供前端如实显示。
///
/// 取数据根用的是 `app.path().app_data_dir()`（Tauri 自己按应用标识算出来的那一个），
/// 再交给 `build_runtime_info` 只取目录名 —— 于是**绝对路径不会离开 Rust 侧**。
#[tauri::command]
fn get_runtime_info(app: tauri::AppHandle) -> Result<DesktopRuntimeInfo, String> {
    use tauri::Manager;

    let data_root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("cannot resolve the app data directory: {error}"))?;
    let version = app.package_info().version.to_string();
    Ok(runtime::build_runtime_info(&version, &data_root))
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_runtime_info])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
