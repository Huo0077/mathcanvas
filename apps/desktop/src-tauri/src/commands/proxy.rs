use std::sync::Mutex;

use tauri::Manager;

use crate::proxy;

/**
 * **回环代理的命令与会话状态**（从 `lib.rs` 拆出，评审方案 2）。
 *
 * 两个命令只做两件事：把代理的地址与令牌交给前端（**令牌单独一个字段**，不进 URL、不进日志、
 * 不落盘），以及取消当前运行（**幂等**：重复取消不是错误）。状态本身的两条设计决定随代码一起
 * 搬过来 —— 它们是"为什么这里能读到令牌"与"为什么服务器不会莫名其妙不响应"的全部答案。
 */
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
    pub(crate) session: Mutex<Option<proxy::server::ProxyHandle>>,
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

impl ProxyState {
    /// 由 `run()` 在 setup 里建。`None` = 代理没起来：**如实留空**，前端据此显示
    /// "模型通道不可用"，而手动工作台照常能用（一个可选组件的失败不该让整个应用打不开）。
    pub fn new(session: Option<proxy::server::ProxyHandle>) -> Self {
        Self { session: Mutex::new(session) }
    }
}

impl ProxyRuntime {
    /// 由 `run()` 持有：它一 drop，跑在它上面的服务器任务就停了。
    pub fn new(runtime: tokio::runtime::Runtime) -> Self {
        Self { runtime }
    }
}

/// **把回环代理的地址与令牌交给前端**（计划 Step 3："pass it over trusted IPC"）。
///
/// 返回的 `baseUrl` **不含令牌**（它进 URL 就会进浏览器历史与日志）；
/// 令牌单独一个字段，前端每次现取、不缓存。
#[tauri::command]
pub fn proxy_session(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
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
pub fn proxy_cancel(app: tauri::AppHandle) -> Result<bool, String> {
    let state = app.try_state::<ProxyState>().ok_or("the proxy is not initialised")?;
    let session = state.session.lock().map_err(|_| "the proxy state is poisoned".to_string())?;
    match session.as_ref() {
        Some(handle) => { handle.cancel(); Ok(true) }
        // 没有会话时**如实回 false**，不假装取消成功。
        None => Ok(false)
    }
}
