//! **MathCanvas 桌面外壳**（Task 1.1 / 1.2 / 1.4 / 1.5 / 1.6）。
//!
//! 这一层只做几件事，且每件都必须能被审出来：
//! 1. **起窗口、加载既有的 web 应用**（`tauri.conf.json` 的 `frontendDist` 指向
//!    `build-check/mathcanvas-current`）—— 前端**不重复一份**，几何 store 还是那一份；
//! 2. **只暴露具名 IPC 命令**。计划原文："Rust exposes only named IPC commands;
//!    no generic command accepting JavaScript or shell text." 所以这里
//!    **没有、也不会有** `eval` / `run_shell` / `read_file` 这类命令。
//!    命令清单**逐字列在** `tests/shell_smoke.rs` 里：新增一个命令会逼你在那里
//!    写下它的名字 —— 那一刻就是一次有意的决定；
//! 3. **密钥的明文没有出口**：三个密钥命令的返回类型里**没有位置**能装下明文
//!    （见 `secrets/mod.rs` 的三条设计决定），而 `provider_run` 的参数里
//!    只有 `profileId` —— 密钥在 Rust 侧借出，借出窗口只覆盖那一次 HTTP。
//!
//! ## 为什么密钥库挂在 `App` 的托管状态上
//!
//! `create_store()` 在 Windows 上会去碰系统凭据管理器（`Entry::new` 会初始化后端）。
//! 每次 IPC 都新建一个 store 等于每次都重新初始化一遍 —— 那是可以避免的开销，
//! 也会让"后端到底可不可用"这件事每次都被重新判定。挂上去之后**只初始化一次**，
//! 且 `get_runtime_info` 与三个密钥命令看到的是**同一个**后端。

pub mod runtime;
/// Provider 协议适配器（Task 1.4 + Task 1.5）：请求拼装、事件归一化、凭据借出、真实转发。
pub mod providers;
/// 回环代理（Task 1.5）：传输安全的判据层。
pub mod proxy;
/// 仓储（Task 1.3 起：provider 配置；Task 1.6 会在这里加 SQLite 项目仓储）。
pub mod repository;
/// 密钥库（Task 1.2）。**明文没有出口** —— 见 `secrets/mod.rs` 的三条设计决定。
pub mod secrets;
/// IPC 命令的分组（按"它碰的是哪一份托管状态"分文件）：代理、密钥，其余仍在根模块。
pub mod commands;

use repository::projects::ProjectRepository;
use repository::provider_profiles::ProviderProfileStore;
use repository::BlobStore;
use commands::providers::ProfileStoreState;
use std::sync::Mutex;
use tauri::Manager;

/**
 * 项目仓储在 Tauri 托管状态里的包装（Task 1.6）。
 *
 * `Mutex`：`commit` 需要 `&mut`（它开一个事务），而 IPC 命令可能在任意线程上跑。
 * 与 provider 配置同理，用 `std::sync::Mutex` 而不是 tokio 的 —— 这些是同步的
 * SQLite 调用，快且不阻塞在 IO 上（本地文件）。
 */
pub struct RepositoryState {
    pub(crate) repository: Mutex<ProjectRepository>,
}

/**
 * **附件仓库**（Task 1.6 Step 4）。
 *
 * 它与项目仓储**分开**托管，因为两者是不同的东西：一个在 SQLite 里（有事务），
 * 一个在磁盘上的目录里（名字就是内容的 SHA-256）。GC 需要**同时**问两边
 *（"哪些被引用"来自库、"磁盘上有什么"来自这里），所以命令那一层要把两个锁都拿住。
 *
 * `BlobStore` 自身不需要 `Mutex`：它只持有根路径，方法是 `&self`，
 * 每次操作各自开文件 —— 而"用不用锁"的判据是"有没有跨调用的可变状态"，这里没有。
 */
pub struct BlobState {
    pub(crate) blobs: BlobStore,
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
            app.manage(commands::secrets::SecretStoreState(secrets::create_store()));
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
            // **附件仓库**放在应用数据根下的 `attachments/`（Task 1.6 Step 4）。
            // 与库分开的理由：几十兆的字节塞进 SQLite 会让每次备份与每次读 head 都变贵。
            let blob_root = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("cannot resolve the app data directory: {error}"))?
                .join("attachments");
            let blobs = BlobStore::open(&blob_root).map_err(|error| format!("cannot open the attachment store at {}: {error}", blob_root.display()))?;
            app.manage(BlobState { blobs });
            // **起回环代理**（Task 1.5）。
            //
            // 它需要一个 tokio 运行时，所以这里建一个**常驻**的（不是每次用一次性的）：
            // 代理要活到应用退出，而它的任务是长驻的。运行时一被丢弃，服务器就没了 ——
            // 所以它必须挂进托管状态，让生命周期跟着应用走，而不是靠"记得别 drop 它"。
            //
            // **起不来不崩**：如实把会话留成 `None`，前端据此显示"模型通道不可用"，
            // 而手动工作台照常能用（一个可选组件的失败不该让整个应用打不开）。
            let runtime = tokio::runtime::Runtime::new().map_err(|error| format!("cannot start the proxy runtime: {error}"))?;
            let session = runtime.block_on(proxy::server::start());
            app.manage(commands::proxy::ProxyState::new(session.ok()));
            // 运行时自己要被**持有住**，否则它一 drop 服务器就停了。
            app.manage(commands::proxy::ProxyRuntime::new(runtime));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::providers::get_runtime_info,
            commands::secrets::save_secret,
            commands::secrets::remove_secret,
            commands::secrets::has_secret,
            commands::providers::list_provider_profiles,
            commands::providers::upsert_provider_profile,
            commands::providers::remove_provider_profile,
            commands::providers::provider_health,
            commands::providers::provider_check,
            commands::providers::select_provider_profile,
            commands::providers::active_provider_profile,
            commands::providers::provider_run,
            commands::providers::provider_cancel,
            commands::repository::read_document_head,
            commands::repository::read_latest_document_head,
            commands::repository::create_document,
            commands::repository::commit_document,
            commands::repository::lookup_commit,
            commands::repository::read_document_snapshot,
            commands::repository::document_history_length,
            commands::repository::replace_document_epoch,
            commands::repository::put_attachment,
            commands::repository::read_attachment,
            commands::repository::read_document_attachments,
            commands::repository::collect_attachments,
            commands::repository::export_package,
            commands::repository::import_package,
            commands::repository::append_run_event,
            commands::repository::read_run_events,
            commands::repository::run_event_count,
            commands::conversations::create_conversation,
            commands::conversations::list_conversations,
            commands::conversations::read_conversation,
            commands::conversations::append_conversation_message,
            commands::conversations::update_conversation_summary,
            commands::conversations::update_conversation_fact,
            commands::conversations::archive_conversation,
            commands::conversations::delete_conversation,
            commands::proxy::proxy_session,
            commands::proxy::proxy_cancel
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

