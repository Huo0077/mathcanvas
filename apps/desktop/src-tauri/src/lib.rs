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
/// Provider 协议适配器（Task 1.4）：请求拼装与事件归一化（不含 HTTP —— 那属于 Task 1.5 的代理）。
pub mod providers;
/// 回环代理（Task 1.5）：传输安全的判据层。
pub mod proxy;
/// 仓储（Task 1.3 起：provider 配置；Task 1.6 会在这里加 SQLite 项目仓储）。
pub mod repository;
/// 密钥库（Task 1.2）。**明文没有出口** —— 见 `secrets/mod.rs` 的三条设计决定。
pub mod secrets;

use repository::provider_profiles::{ProviderHealth, ProviderProfile, ProviderProfileStore, StoreError};
use secrets::{SecretState, SecretStore, Store};
use std::sync::Mutex;
use tauri::Manager;

/// 密钥库在 Tauri 托管状态里的包装。
struct SecretStoreState(Store);

/// Provider 配置存储 + 它所在的配置文件路径。
///
/// `Mutex`：IPC 命令可能在任意线程上跑，而 `&mut` 只能有一个。
/// 用 `std::sync::Mutex` 而不是 tokio 的：这些操作都是**同步的文件 IO**，
/// 而配置文件只有几 KB —— 为它引入异步锁是把简单问题复杂化。
struct ProfileStoreState {
    store: Mutex<ProviderProfileStore>,
}

fn store_error(error: StoreError) -> String {
    error.to_string()
}

/// **列出全部 provider 配置**（不含密钥 —— 它只有引用）。
#[tauri::command]
fn list_provider_profiles(app: tauri::AppHandle) -> Result<Vec<ProviderProfile>, String> {
    let state = app.try_state::<ProfileStoreState>().ok_or("the provider store is not initialised")?;
    let store = state.store.lock().map_err(|_| "the provider store is poisoned".to_string())?;
    Ok(store.list())
}

/**
 * **新增或更新一份 provider 配置**。
 *
 * 收的是**原始 JSON** 而不是 `ProviderProfile`：Tauri 反序列化会**忽略未知字段**，
 * 于是一个带着 `apiKey` 的对象会被悄悄削成合法的 profile —— 而"悄悄削掉"正是
 * 最危险的那种处理（调用方以为密钥存进去了）。所以先看原始值，再谈转换。
 *
 * `expectedRevision` 是乐观并发：两个设置窗口同时开着时，后写的会拿到错误而不是覆盖前一个。
 */
#[tauri::command]
fn upsert_provider_profile(app: tauri::AppHandle, profile: serde_json::Value, expected_revision: Option<u32>) -> Result<ProviderProfile, String> {
    let prepared = repository::provider_profiles::prepare_profile(&profile).map_err(store_error)?;
    let state = app.try_state::<ProfileStoreState>().ok_or("the provider store is not initialised")?;
    let mut store = state.store.lock().map_err(|_| "the provider store is poisoned".to_string())?;
    store.upsert(prepared, expected_revision).map_err(store_error)
}

/// **删除一份 provider 配置**（健康记录一并删除）。
#[tauri::command]
fn remove_provider_profile(app: tauri::AppHandle, profile_id: String) -> Result<(), String> {
    let state = app.try_state::<ProfileStoreState>().ok_or("the provider store is not initialised")?;
    let mut store = state.store.lock().map_err(|_| "the provider store is poisoned".to_string())?;
    store.remove(&profile_id).map_err(store_error)
}

/// 读一份 profile 的健康记录（**带上它对应的 revision**）。
#[tauri::command]
fn provider_health(app: tauri::AppHandle, profile_id: String) -> Result<Option<ProviderHealth>, String> {
    let state = app.try_state::<ProfileStoreState>().ok_or("the provider store is not initialised")?;
    let store = state.store.lock().map_err(|_| "the provider store is poisoned".to_string())?;
    Ok(store.health(&profile_id))
}

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
            // Provider 配置放在应用数据根下的 `providers.json`（Task 1.3）。
            // 打不开时**如实失败**：设置界面的所有写入都会因此报错，
            // 而不是让用户以为"存好了"。
            let path = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("cannot resolve the app data directory: {error}"))?
                .join("providers.json");
            let store = ProviderProfileStore::open(&path).map_err(|error| format!("cannot open the provider configuration at {}: {error}", path.display()))?;
            app.manage(ProfileStoreState { store: Mutex::new(store) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_runtime_info,
            save_secret,
            remove_secret,
            has_secret,
            list_provider_profiles,
            upsert_provider_profile,
            remove_provider_profile,
            provider_health
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


