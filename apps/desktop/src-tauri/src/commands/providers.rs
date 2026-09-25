use std::sync::Mutex;

use tauri::Manager;

use crate::commands::proxy::ProxyState;
use crate::commands::secrets::SecretStoreState;
use crate::repository::provider_profiles::{ProviderHealth, ProviderProfile, ProviderProfileStore, StoreError};
use crate::secrets::SecretStore;
use crate::{providers, repository, runtime, RepositoryState};

/**
 * **模型通道与 provider 配置的命令**（从 `lib.rs` 拆出，评审方案 2）。
 *
 * 这一组是唯一会**碰到密钥明文**的地方，所以它的形状本身就是一条纪律：
 * `provider_run` 的参数里只有 `profileId`，密钥在 Rust 侧由 `ProviderAdapter` 从凭据库借出，
 * 借出窗口只覆盖那一次 HTTP；失败回的是**带分类的错误契约**（`failure` + `retryable`），
 * 而不是一句丢了重试判据的话。`ProfileStoreState` 与 `store_error` 也归这里 ——
 * 它们只被这一组用。这些说明随代码一起搬过来，别删。
 */

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
pub fn provider_run(
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
pub fn provider_cancel(app: tauri::AppHandle, run_id: String) -> Result<bool, String> {
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

/// Provider 配置存储 + 它所在的配置文件路径。
///
/// `Mutex`：IPC 命令可能在任意线程上跑，而 `&mut` 只能有一个。
/// 用 `std::sync::Mutex` 而不是 tokio 的：这些操作都是**同步的文件 IO**，
/// 而配置文件只有几 KB —— 为它引入异步锁是把简单问题复杂化。
pub struct ProfileStoreState {
    pub(crate) store: Mutex<ProviderProfileStore>,
}

fn store_error(error: StoreError) -> String {
    error.to_string()
}

/// **列出全部 provider 配置**（不含密钥 —— 它只有引用）。
#[tauri::command]
pub fn list_provider_profiles(app: tauri::AppHandle) -> Result<Vec<ProviderProfile>, String> {
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
pub fn upsert_provider_profile(app: tauri::AppHandle, profile: serde_json::Value, expected_revision: Option<u32>) -> Result<ProviderProfile, String> {
    let prepared = repository::provider_profiles::prepare_profile(&profile).map_err(store_error)?;
    let state = app.try_state::<ProfileStoreState>().ok_or("the provider store is not initialised")?;
    let mut store = state.store.lock().map_err(|_| "the provider store is poisoned".to_string())?;
    store.upsert(prepared, expected_revision).map_err(store_error)
}

/// **删除一份 provider 配置**（健康记录一并删除）。
#[tauri::command]
pub fn remove_provider_profile(app: tauri::AppHandle, profile_id: String) -> Result<(), String> {
    let state = app.try_state::<ProfileStoreState>().ok_or("the provider store is not initialised")?;
    let mut store = state.store.lock().map_err(|_| "the provider store is poisoned".to_string())?;
    store.remove(&profile_id).map_err(store_error)
}

/// 读一份 profile 的健康记录（**带上它对应的 revision**）。
#[tauri::command]
pub fn provider_health(app: tauri::AppHandle, profile_id: String) -> Result<Option<ProviderHealth>, String> {
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
pub fn select_provider_profile(app: tauri::AppHandle, profile_id: String) -> Result<String, String> {
    let state = app.try_state::<ProfileStoreState>().ok_or("the provider store is not initialised")?;
    let mut store = state.store.lock().map_err(|_| "the provider store is poisoned".to_string())?;
    store.select(&profile_id).map_err(store_error)
}

/// **现在在用哪一份配置**。`None` 表示还没选过（不是"选了第一份"）。
#[tauri::command]
pub fn active_provider_profile(app: tauri::AppHandle) -> Result<Option<String>, String> {
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
pub fn provider_check(app: tauri::AppHandle, profile_id: String, profile_revision: u32) -> Result<ProviderHealth, String> {
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
pub fn get_runtime_info(app: tauri::AppHandle) -> Result<runtime::DesktopRuntimeInfo, String> {
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
