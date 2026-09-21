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

use repository::projects::{CommitReceipt, CommitRequest, DocumentSnapshot, ProjectRepository};
use repository::provider_profiles::{ProviderHealth, ProviderProfile, ProviderProfileStore, StoreError};
use repository::BlobStore;
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
    blobs: BlobStore,
}

/**
 * 回环代理的会话（Task 1.5）。
 *
 * **持有它就持有那枚令牌** —— 所以它只挂在 Tauri 的托管状态里，只有可信 IPC 能读到。
 * 令牌不进 URL、不进日志、不落盘：它随 `ProxyHandle` 一起活，应用一退就没了。
 *
 * 用 `std::sync::Mutex` 而不是 tokio 的：这里的临界区只是"读两个字段"，
 * 没有任何 await 在里面 —— 异步锁在无 await 的临界区里只带来额外开销。
 */
pub struct ProxyState {
    session: Mutex<Option<proxy::server::ProxyHandle>>,
}

/**
 * 代理的 tokio 运行时。
 *
 * 它必须被**持有住**：`Runtime` 一被 drop，跑在它上面的服务器任务就停了 ——
 * 而"服务器莫名其妙不响应了"这种故障极难查（应用没崩、日志没报错、只是连不上）。
 * 挂进托管状态 = 生命周期跟着应用走。
 */
pub struct ProxyRuntime {
    #[allow(dead_code)]
    runtime: tokio::runtime::Runtime,
}

/// **用某个 profile 发一次模型请求**（Task 1.4 Step 3/4 + Task 1.5 Step 3/5）。
///
/// ## 取消为什么要一枚**独立**的句柄
///
/// 而不是用代理那枚全局的 `is_cancelled`：全局信号只能回答"有没有人按过停止"，
/// 而按下之后新开的一次运行会被上一次的停止立刻掐掉。每次运行一枚句柄，
/// 才让"取消这一次"这个语义立得住。句柄本体留在代理的 `RunRegistry` 里
///（那是权威的那一份），`provider_run` 与 `provider_cancel` 都从那里取 ——
/// 于是"谁在跑"与"谁在问"看到的是同一枚信号。
///
/// ## 返回的是**归一化事件**，不是 provider 的原始响应
///
/// 前端拿到的是 `kind: "delta" | "usage" | "completed" | "failed" …` 那一套
/// （与 `packages/agent-core/src/modelEvents.ts` 同一个形状）。三家的形状差异
/// 在 `providers::normalize` 里被吃掉了；**失败被映射到错误契约**
/// （`failure` + `retryable`），而不是抛一个裸错误 —— 调用方要按 `retryable` 决定重试与否。
///
/// ## 三条纪律在这条命令上的落点
///
/// 1. **密钥不到前端来**。参数里只有 `profileId`；密钥在 Rust 侧由 `ProviderAdapter`
///    从凭据库借出，借出窗口只覆盖那一次 HTTP。
/// 2. **修订号要对得上**。`profileRevision` 与当前 profile 不符时**当场拒绝**：
///    那不是"用旧配置跑一次"，而是"界面拿的是另一份配置"，跑出来的结果没法解释。
/// 3. **失败是 `Err` 且带分类**。回一个空数组会让"什么都没说"看起来像"模型没说话"；
///    只回一句话则会让前端丢掉 `retryable`，而那是重试策略**唯一**的判据。
///
/// ## 为什么它是**同步**命令
///
/// 因为它必须阻塞：凭据库借出明文用的是同步闭包（见 `providers::adapter` 的模块头），
/// 而那条约束让这次发送不能被打断成若干次 await。Tauri 的同步命令跑在线程池上，
/// 阻塞它不会卡住界面 —— 而把它写成 `async` 再在里面阻塞，才会真的占住异步线程。
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn provider_run(
    app: tauri::AppHandle,
    run_id: String,
    profile_id: String,
    profile_revision: u32,
    messages: Vec<providers::request::ChatMessage>,
    stream: Option<bool>,
    tools: Option<Vec<serde_json::Value>>,
) -> Result<Vec<serde_json::Value>, serde_json::Value> {
    let proxy = app.try_state::<ProxyState>().ok_or_else(|| missing_state("the proxy"))?;
    // 锁**一直持有到这次发送结束**：它保护的是 `ProxyHandle` 的生命周期，
    // 而句柄正是这次转发的凭据来源。放开锁会让"代理被关掉"与"正在用它的令牌"重叠。
    let session = proxy.session.lock().map_err(|_| missing_state("the proxy state is poisoned"))?;
    // 取消句柄从代理的注册表里取（那里是权威的那一份）。没有代理时给一枚孤立句柄：
    // 它永远不会被置位，于是那次运行会照常跑完 —— 这比"永远取消不了"要好。
    let cancel = session.as_ref().map(|handle| handle.cancel_handle(&run_id)).unwrap_or_default();

    let profile = {
        let state = app.try_state::<ProfileStoreState>().ok_or_else(|| missing_state("the provider store"))?;
        let store = state.store.lock().map_err(|_| missing_state("the provider store is poisoned"))?;
        store.get(&profile_id).ok_or_else(|| providers::adapter::ProviderError::NotFound { profile_id: profile_id.clone() }.to_json())?
    };

    // **工具表的出口判据**（Task 2.3："Do not send a tool schema to providers that failed
    // capability verification."）。
    //
    // 前端已经按能力证据选过通道（`planModelRequest` / `selectChannel`），但那道判据在**调用方**手里。
    // 这里再看一次**存下来的**证据：调用方说"这家支持工具"不算数，跑过一次能力验证才算数。
    // 证据没验过时**不是静默丢掉工具表**，而是拒绝 —— 静默丢掉会让调用方拿到一个"没带工具的请求"，
    // 于是"模型不会用工具"变成一个看起来像模型的问题。
    let requested_tools = tools.unwrap_or_default();
    let allow_tools = if requested_tools.is_empty() {
        false
    } else {
        let state = app.try_state::<ProfileStoreState>().ok_or_else(|| missing_state("the provider store"))?;
        let store = state.store.lock().map_err(|_| missing_state("the provider store is poisoned"))?;
        if !providers::capability::tools_verified(store.health(&profile_id).as_ref(), profile.revision) {
            return Err(providers::adapter::ProviderError::ToolsNotVerified { profile_id: profile_id.clone() }.to_json());
        }
        true
    };

    let secrets = app.try_state::<SecretStoreState>().ok_or_else(|| missing_state("the secret store"))?;
    let transport = providers::adapter::HttpTransport::new();
    // 查配置 → 对修订号 → 借凭据发请求。**这一段住在 `providers::adapter` 里**
    // 而不是在这里，因为那里能测（见 `run_with_profile` 的说明）。
    // `force_tool: false`：真运行里模型**可以不调工具**（它可以只回答问题），
    // 强制它调工具是**探针**才需要的事（不强制就测不出"支持工具"）。
    let options = providers::request::RequestOptions { allow_tools, tools: requested_tools, force_tool: false, tool_choice_field: None };
    let outcome = providers::adapter::run_with_profile(&secrets.0, &transport, profile, profile_revision, messages, stream.unwrap_or(true), options, cancel.as_ref())
        .map_err(|error| error.to_json())?;
    let events: Vec<serde_json::Value> = match outcome {
        providers::adapter::SendOutcome::Completed(events) | providers::adapter::SendOutcome::Cancelled(events) => {
            events.iter().map(providers::events::ModelEvent::to_json_plain).collect()
        }
    };

    // 留档：`/v1/runs/{runId}/events` 要看得到这一轮产出了什么。
    if let Some(handle) = session.as_ref() {
        handle.record_events(&run_id, &events, true);
    }

    Ok(events)
}

/// **取消一次运行**。幂等：重复取消不是错误（用户可能点了两次）。
///
/// `runId` 指的是**某一次**运行，而不是"所有运行"：取消全部会让
/// "上一轮点了停止、这一轮刚开就被掐掉"。
#[tauri::command]
fn provider_cancel(app: tauri::AppHandle, run_id: String) -> Result<bool, String> {
    let proxy = app.try_state::<ProxyState>().ok_or("the proxy is not initialised")?;
    let session = proxy.session.lock().map_err(|_| "the proxy state is poisoned".to_string())?;
    match session.as_ref() {
        Some(handle) => {
            handle.cancel_handle(&run_id).cancel();
            Ok(true)
        }
        None => Ok(false),
    }
}

/// 一句**能被前端读懂**的失败（`ModelEvent` 的 `failed` 形状）。
///
/// 命令的 `Err` 类型用它而不是 `String`：前端要靠 `retryable` 决定重试与否，
/// 而"把分类塞进一句话里"必然会在某次重试里丢。
fn missing_state(detail: &str) -> serde_json::Value {
    serde_json::json!({
        "kind": "failed",
        "failure": "unknown",
        "message": detail,
        "retryable": false
    })
}

/// **把回环代理的地址与令牌交给前端**（计划 Step 3："pass it over trusted IPC"）。
///
/// 返回的 `baseUrl` **不含令牌**（它进 URL 就会进浏览器历史与日志）；
/// 令牌单独一个字段，前端每次现取、不缓存。
#[tauri::command]
fn proxy_session(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    let state = app.try_state::<ProxyState>().ok_or("the proxy is not initialised")?;
    let session = state.session.lock().map_err(|_| "the proxy state is poisoned".to_string())?;
    Ok(session.as_ref().map(|handle| {
        serde_json::json!({
            "baseUrl": handle.base_url(),
            "token": handle.token(),
            "cancelled": handle.is_cancelled()
        })
    }))
}

/// **取消当前运行**（用户按了停止）。幂等：重复取消不是错误。
#[tauri::command]
fn proxy_cancel(app: tauri::AppHandle) -> Result<bool, String> {
    let state = app.try_state::<ProxyState>().ok_or("the proxy is not initialised")?;
    let session = state.session.lock().map_err(|_| "the proxy state is poisoned".to_string())?;
    match session.as_ref() {
        Some(handle) => { handle.cancel(); Ok(true) }
        // 没有会话时**如实回 false**，不假装取消成功。
        None => Ok(false)
    }
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

/// **切换当前使用的模型服务**（Task 1.3 Step 5）。
///
/// 只动一个字段，**不碰任何 profile 的修订号** —— 切换不是修改配置。
/// 而"能力证据挂在修订号上"那条规则意味着：如果切换顺带把修订号推高，
/// 四个能力徽章会在每次切换后全部变回"未验证"，而那显然不是用户做的改动。
#[tauri::command]
fn select_provider_profile(app: tauri::AppHandle, profile_id: String) -> Result<String, String> {
    let state = app.try_state::<ProfileStoreState>().ok_or("the provider store is not initialised")?;
    let mut store = state.store.lock().map_err(|_| "the provider store is poisoned".to_string())?;
    store.select(&profile_id).map_err(store_error)
}

/// **现在在用哪一份配置**。`None` 表示还没选过（不是"选了第一份"）。
#[tauri::command]
fn active_provider_profile(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let state = app.try_state::<ProfileStoreState>().ok_or("the provider store is not initialised")?;
    let store = state.store.lock().map_err(|_| "the provider store is poisoned".to_string())?;
    Ok(store.active_profile_id())
}

/**
 * **跑一次能力探测**（Task 1.4 Step 5）。
 *
 * ## 它回答的是"哪些能力真的成立"，而不是"这家活着吗"
 *
 * 四条探针各发各的请求，逐条下结论（判据表在 `providers::capability` 的模块头）。
 * 最要紧的一条：**一次成功的文本 ping 不许把 tools 或 vision 打勾** ——
 * 那种实现看起来一切正常（四个绿徽章），直到真的给一个不支持图片的模型发图。
 *
 * ## 它会花掉几次真请求（如实）
 *
 * 四发：文本、JSON、一张 1×1 的 PNG、一次带工具表的请求。所以这是一个**用户按下去才发生**
 * 的动作，不是打开设置就自动跑的 —— 那会悄悄花掉别人的额度。
 *
 * ## 证据挂在修订号上
 *
 * 请求带 `profileRevision`，与当前不符时**当场拒绝**：给一份界面已经看不到的配置
 * 跑探测，会写下一份永远匹配不上任何东西的证据。
 */
#[tauri::command]
fn provider_check(app: tauri::AppHandle, profile_id: String, profile_revision: u32) -> Result<ProviderHealth, String> {
    let profile = {
        let state = app.try_state::<ProfileStoreState>().ok_or("the provider store is not initialised")?;
        let store = state.store.lock().map_err(|_| "the provider store is poisoned".to_string())?;
        store.get(&profile_id).ok_or_else(|| format!("no provider profile with id {profile_id}"))?
    };
    let secrets = app.try_state::<SecretStoreState>().ok_or("the secret store is not initialised")?;
    // 取消句柄按 `probe-<profile>` 取：用户点了停止之后这一发也能被打断
    //（探针在真网络下可能等很久，而"停不下来"是最难受的一种）。
    let cancel = {
        let proxy = app.try_state::<ProxyState>().ok_or("the proxy is not initialised")?;
        let session = proxy.session.lock().map_err(|_| "the proxy state is poisoned".to_string())?;
        session.as_ref().map(|handle| handle.cancel_handle(&format!("probe-{profile_id}"))).unwrap_or_default()
    };

    let transport = providers::adapter::HttpTransport::new();
    let state = app.try_state::<ProfileStoreState>().ok_or("the provider store is not initialised")?;
    let mut store = state.store.lock().map_err(|_| "the provider store is poisoned".to_string())?;
    providers::capability::check(&secrets.0, &transport, &mut *store, profile, profile_revision, cancel.as_ref())
        // 与 `provider_run` 同一套口径：失败**带分类**（`failure` / `retryable`）到前端，
        // 而不是一句话。前端从文本里重新猜分类是一次必然会漏的判断。
        .map_err(|error| error.to_json().to_string())
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
    //
    // 三个部件**各自**现问实况。密钥库那一条见下；仓储与回环代理在 2026-09-21 之前
    // 是**写死**的 `not_implemented`，而它们当时已经实现 —— 那是一次"过时的自述"，
    // 靠 `runtime.rs` 里那条改成"三字段各自跟输入走"的用例才发现。
    let secret_store_ready = app
        .try_state::<SecretStoreState>()
        .is_some_and(|state| state.0.backend() == "windows-credential-manager");
    let repository_ready = app.try_state::<RepositoryState>().is_some();
    let transport_ready = app
        .try_state::<ProxyState>()
        .is_some_and(|state| state.session.lock().map(|session| session.is_some()).unwrap_or(false));
    Ok(runtime::build_runtime_info(&version, &data_root, secret_store_ready, repository_ready, transport_ready))
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

// ---------------------------------------------------------------- 附件与 .mcanvas（Task 1.6 Step 4/5）

/**
 * **存一份附件**（两阶段写的第一阶段 + 引用）。
 *
 * ## 两阶段的顺序**必须由这一条命令保证**，不能交给调用方
 *
 * 计划原文："Hash/size-check and atomically rename the blob first, then insert the DB reference."
 * 所以这里的顺序写死成：①按声明的哈希校验并原子落盘（`blobs.write`）→
 * ②记附件元数据 → ③记"这一版快照引用了它"。
 *
 * 崩溃可能落在任何两步之间，而两阶段的取舍是**故意的**：
 * - 落在 ① 与 ② 之间 → 磁盘上多一个没人引用的 blob（**孤儿**，GC 会收掉它）；
 * - 反过来先写库 → 库里说有这么个附件、文件却不在，用户打开文档会看到"附件丢失"。
 *
 * 前者只是浪费空间，后者是用户可见的损坏。
 */
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn put_attachment(
    app: tauri::AppHandle,
    project_id: String,
    document_id: String,
    generation: i64,
    content_hash: String,
    media_type: String,
    base64_bytes: String
) -> Result<serde_json::Value, String> {
    let bytes = decode_base64(&base64_bytes).ok_or("the attachment is not valid base64")?;
    let blobs = app.try_state::<BlobState>().ok_or("the attachment store is not initialised")?;
    // **① 落盘**（哈希门在里面：对不上就一字节都不写）。
    let staged = blobs.blobs.write(&bytes, &content_hash).map_err(|error| error.to_string())?;

    // **② + ③ 记引用**。
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let mut repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository
        .record_attachment(&staged.content_hash, staged.byte_size as i64, &media_type)
        .map_err(|error| error.to_string())?;
    repository
        .reference_attachments(&project_id, &document_id, generation, std::slice::from_ref(&staged.content_hash))
        .map_err(|error| error.to_string())?;

    Ok(serde_json::json!({ "contentHash": staged.content_hash, "byteSize": staged.byte_size }))
}

/// **读一份附件**（base64）。找不到时回 `null` —— 与"出错了"分开。
#[tauri::command]
fn read_attachment(app: tauri::AppHandle, content_hash: String) -> Result<Option<String>, String> {
    let blobs = app.try_state::<BlobState>().ok_or("the attachment store is not initialised")?;
    let bytes = blobs.blobs.read(&content_hash).map_err(|error| error.to_string())?;
    Ok(bytes.map(|bytes| encode_base64(&bytes)))
}

/**
 * **回收孤儿附件**（两阶段的清理那一半）。
 *
 * 判据只有一个：**数据库里没有被任何快照引用**。宽限期由 `blobs::GC_GRACE_MS` 定，
 * 因为正常操作里"文件已写、引用还没写"的窗口是存在的（毫秒级），
 * 而一次并发的 GC 落在那个窗口里就会删掉一份**正在被引用**的附件。
 */
#[tauri::command]
fn collect_attachments(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let referenced = {
        let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
        let repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
        repository.referenced_blobs().map_err(|error| error.to_string())?
    };
    let blobs = app.try_state::<BlobState>().ok_or("the attachment store is not initialised")?;
    blobs.blobs.collect_garbage(&referenced, repository::blobs::GC_GRACE_MS).map_err(|error| error.to_string())
}

/// **导出 `.mcanvas`**，写到给定的路径。
///
/// 文档由调用方给（`documentId` / `epoch` / `content`），附件按哈希列出。
/// **导出是只读的**：它不改仓库里的任何东西 —— 于是"导出失败"永远不会损坏文档。
#[tauri::command]
fn export_package(app: tauri::AppHandle, project_id: String, documents: Vec<serde_json::Value>, attachments: Vec<String>, destination: String) -> Result<serde_json::Value, String> {
    let exported: Vec<repository::package::ExportDocument> = documents
        .iter()
        .map(|document| {
            Ok(repository::package::ExportDocument {
                document_id: document["documentId"].as_str().ok_or("a document needs a documentId")?.to_string(),
                epoch: document["epoch"].as_str().unwrap_or_default().to_string(),
                generation: document["generation"].as_i64().unwrap_or(0),
                content: document["content"].as_str().ok_or("a document needs its content")?.to_string()
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let media: Vec<(String, String)> = attachments.iter().map(|hash| (hash.clone(), "application/octet-stream".to_string())).collect();

    let blobs = app.try_state::<BlobState>().ok_or("the attachment store is not initialised")?;
    let (bytes, report) = repository::package::export(&project_id, &exported, &media, &[], &blobs.blobs, repository::provider_profiles::timestamp_ms(), None)
        .map_err(|error| error.to_string())?;
    repository::package::write_to_file(&destination, &bytes).map_err(|error| error.to_string())?;

    Ok(serde_json::json!({
        "destination": destination,
        "byteSize": bytes.len(),
        "documentCount": report.document_count,
        "attachmentCount": report.attachment_count
    }))
}

/**
 * **导入 `.mcanvas`**。
 *
 * ## 顺序：先把整包验完，再落下任何东西
 *
 * `package::import` 自己保证这一点（见它的注释）：验到一半失败**不会**留下
 * 一半已经写进仓库的文档。文档本体由这一条命令在验完之后写进库，
 * 而"换一世"用的是 `replace_epoch` —— 于是**在途的旧保存会自动 CAS 失败**
 *（用户刚打开的文档不会被上一次编辑覆盖）。
 */
#[tauri::command]
fn import_package(app: tauri::AppHandle, path: String, project_id: String, epoch: String) -> Result<serde_json::Value, String> {
    let bytes = repository::package::read_from_file(&path).map_err(|error| error.to_string())?;
    let blobs = app.try_state::<BlobState>().ok_or("the attachment store is not initialised")?;
    let outcome = repository::package::import(&bytes, &blobs.blobs).map_err(|error| error.to_string())?;

    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let mut repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    let mut written = Vec::new();
    for (document_id, content) in &outcome.documents {
        // 内容的哈希由**我们**算（包里的那个已经在上一步核对过了）。
        let content_hash = repository::blobs::sha256_hex(content.as_bytes());
        // 文档不存在时会走 `create`：`replace_epoch` 要求先有一份 head。
        match repository.read_head(&project_id, document_id) {
            Ok(_) => {
                repository.replace_epoch(&project_id, document_id, &epoch, content, &content_hash).map_err(|error| error.to_string())?;
            }
            Err(_) => {
                repository.create(&project_id, document_id, &epoch, content, &content_hash).map_err(|error| error.to_string())?;
            }
        }
        written.push(document_id.clone());
    }

    Ok(serde_json::json!({
        "projectId": outcome.manifest.project_id,
        "schemaVersion": outcome.manifest.schema_version,
        "documents": written,
        "attachmentCount": outcome.stored_attachments.len(),
        "missingSources": outcome.missing_sources
    }))
}

// ---------------------------------------------------------------- 运行账本（Task 2.6）

/// **追加一条运行事件**。
///
/// 收**原始 JSON** 再自己转换，而不是让 Tauri 直接反序列化成 `RunEventInput`：
/// 后者在遇到未知字段时的行为取决于类型定义，而这里要的是**明确的拒绝** ——
/// `RunEventInput` 带 `deny_unknown_fields`，所以一个带着 `reasoning` 或 `imageBytes`
/// 的事件会在**入口**被拒（计划 Task 2.6："never stores raw model reasoning or image bytes"）。
/// 静默削掉那个字段比拒绝更危险：调用方会以为它存进去了。
///
/// 返回"这次真的写了一行吗"：同一个 `event_id` 第二次返回 `false`（幂等，重放不是错误）。
#[tauri::command]
fn append_run_event(app: tauri::AppHandle, event: serde_json::Value) -> Result<bool, String> {
    let parsed: repository::run_events::RunEventInput = serde_json::from_value(event).map_err(|error| format!("the run event was refused: {error}"))?;
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository.append_run_event(&parsed).map_err(|error| error.to_string())
}

/// **读一条运行的事件**（有界、按写入顺序，供界面的开发者详细视图）。
#[tauri::command]
fn read_run_events(app: tauri::AppHandle, run_id: String) -> Result<Vec<repository::run_events::RunEventRecord>, String> {
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository.run_events(&run_id).map_err(|error| error.to_string())
}

/// 账本里一共多少条（自述与诊断用）。
#[tauri::command]
fn run_event_count(app: tauri::AppHandle) -> Result<i64, String> {
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository.run_event_count().map_err(|error| error.to_string())
}

/// 把 base64 解成字节。**不用 crate**：这里只有解码与编码两个方向，而它们的形状是固定的。
fn decode_base64(text: &str) -> Option<Vec<u8>> {
    const TABLE: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::with_capacity(text.len() / 4 * 3);
    let mut buffer = 0u32;
    let mut bits = 0u32;
    for byte in text.bytes() {
        if byte == b'\n' || byte == b'\r' || byte == b'=' {
            continue;
        }
        let value = TABLE.find(byte as char)? as u32;
        buffer = (buffer << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buffer >> bits) & 0xff) as u8);
        }
    }
    Some(out)
}

/// 把字节编成 base64。
fn encode_base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let mut buffer = 0u32;
        for (index, byte) in chunk.iter().enumerate() {
            buffer |= u32::from(*byte) << (16 - index * 8);
        }
        for slot in 0..4 {
            if slot <= chunk.len() {
                out.push(TABLE[((buffer >> (18 - slot * 6)) & 0x3f) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
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
            app.manage(ProxyState { session: Mutex::new(session.ok()) });
            // 运行时自己要被**持有住**，否则它一 drop 服务器就停了。
            app.manage(ProxyRuntime { runtime });
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
            provider_check,
            select_provider_profile,
            active_provider_profile,
            provider_run,
            provider_cancel,
            read_document_head,
            create_document,
            commit_document,
            lookup_commit,
            read_document_snapshot,
            document_history_length,
            replace_document_epoch,
            put_attachment,
            read_attachment,
            collect_attachments,
            export_package,
            import_package,
            append_run_event,
            read_run_events,
            run_event_count,
            proxy_session,
            proxy_cancel
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}




