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

use repository::projects::{CommitReceipt, CommitRequest, DocumentSnapshot, ProjectRepository};
use repository::provider_profiles::{ProviderHealth, ProviderProfile, ProviderProfileStore, StoreError};
use secrets::{SecretState, SecretStore, Store};
use std::sync::Mutex;
use tauri::Manager;

/// 密钥库在 Tauri 托管状态里的包装。
struct SecretStoreState(Store);

/**
 * 项目仓储在 Tauri 托管状态里的包装（Task 1.6）。
 *
 * `Mutex`：`commit` 需要 `&mut`（它开一个事务），而 IPC 命令可能在任意线程上跑。
 * 与 provider 配置同理，用 `std::sync::Mutex` 而不是 tokio 的 —— 这些是同步的
 * SQLite 调用，快且不阻塞在 IO 上（本地文件）。
 */
pub struct RepositoryState {
    repository: Mutex<ProjectRepository>,
}

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

// ---------------------------------------------------------------- 项目仓储（Task 1.6）

/// **读一份文档的 head**。找不到时**如实报错**，不回一份空文档 ——
/// 空文档会让前端以为"这份文档是空的"，而不是"它还不存在"。
#[tauri::command]
fn read_document_head(app: tauri::AppHandle, project_id: String, document_id: String) -> Result<DocumentSnapshot, String> {
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository.read_head(&project_id, &document_id).map_err(|error| error.to_string())
}

/// **建一份文档**（首次写入）。
///
/// 内容哈希**由前端算好传进来**：规则在 `scene-graph` 的 `contentFingerprint` 里
///（要剔掉 `revision` / `updatedAt`、把 `visible: true` 视同缺省）。
/// 在 Rust 里再实现一遍必然分叉，而分叉的后果是**同一份文档有两个哈希** ——
/// CAS 会永远失败，且看起来像"并发冲突"。
#[tauri::command]
fn create_document(app: tauri::AppHandle, project_id: String, document_id: String, epoch: String, content: String, content_hash: String) -> Result<DocumentSnapshot, String> {
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let mut repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository.create(&project_id, &document_id, &epoch, &content, &content_hash).map_err(|error| error.to_string())
}

/// **提交一次改动**（CAS + 幂等 + 原子写三张表）。
///
/// `idempotency_key` 由调用方给：这样"网络重试"与"用户点了两次"都会落到同一条记录上，
/// 而不会推进两次 generation。
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn commit_document(
    app: tauri::AppHandle,
    idempotency_key: String,
    project_id: String,
    document_id: String,
    expected_epoch: String,
    expected_generation: i64,
    expected_content_hash: String,
    content: String,
    content_hash: String,
    actions: usize
) -> Result<CommitReceipt, String> {
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let mut repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository
        .commit(CommitRequest {
            idempotency_key,
            project_id,
            document_id,
            expected_epoch,
            expected_generation,
            expected_content_hash,
            content,
            content_hash,
            actions
        })
        .map_err(|error| error.to_string())
}

/// **按幂等键查提交状态**（"DB 已提交、响应丢了"那条路径）。
#[tauri::command]
fn lookup_commit(app: tauri::AppHandle, idempotency_key: String) -> Result<Option<CommitReceipt>, String> {
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository.lookup_commit(&idempotency_key).map_err(|error| error.to_string())
}

/// 读历史里某一版的内容（撤销 / 重做靠它）。
#[tauri::command]
fn read_document_snapshot(app: tauri::AppHandle, project_id: String, document_id: String, generation: i64) -> Result<DocumentSnapshot, String> {
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository.read_snapshot(&project_id, &document_id, generation).map_err(|error| error.to_string())
}

/// 历史里有多少版（含 head）。
#[tauri::command]
fn document_history_length(app: tauri::AppHandle, project_id: String, document_id: String) -> Result<i64, String> {
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository.history_length(&project_id, &document_id).map_err(|error| error.to_string())
}

/// **换一世**：导入 / 打开文件之后，把 head 的 epoch 换掉并写入新内容。
///
/// 为什么这是一个**独立**的原语，而不是"删掉再建"或"当成一次普通提交"：
/// - 删掉再建会**丢掉历史** —— 而"打开文件之后还能撤销回上一次"是这条路径的应有之义；
/// - 当成普通提交则该不了 epoch，于是**在途的旧保存仍然能写进来**
///   （它携带的期望与新 head 匹配）—— 用户刚打开的文档会被上一次编辑覆盖。
///
/// epoch 一变，所有在途请求的 CAS 立刻失败。这正是它存在的意义。
#[tauri::command]
fn replace_document_epoch(app: tauri::AppHandle, project_id: String, document_id: String, epoch: String, content: String, content_hash: String) -> Result<DocumentSnapshot, String> {
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let mut repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository.replace_epoch(&project_id, &document_id, &epoch, &content, &content_hash).map_err(|error| error.to_string())
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
            // 项目仓储放在应用数据根下的 `projects.db`（Task 1.6）。
            // **打不开就如实失败**：前端会退回到"只在会话内保存"，并在界面上说明原因 ——
            // 那比"以为存住了、关掉才发现没了"好得多。
            let database = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("cannot resolve the app data directory: {error}"))?
                .join("projects.db");
            let repository = ProjectRepository::open(&database).map_err(|error| format!("cannot open the project repository at {}: {error}", database.display()))?;
            app.manage(RepositoryState { repository: Mutex::new(repository) });
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
            provider_health,
            read_document_head,
            create_document,
            commit_document,
            lookup_commit,
            read_document_snapshot,
            document_history_length,
            replace_document_epoch
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}



