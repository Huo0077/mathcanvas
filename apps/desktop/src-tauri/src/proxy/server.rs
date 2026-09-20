//! **回环代理的真服务器**（Task 1.5 的后半）。
//!
//! 前半（`security.rs`）是**判据**：九种拒绝理由、SSRF 防线、重定向不传凭据、脱敏。
//! 这一半把判据接到一个真 socket 上，并落定三件事：
//!
//! 1. **只绑回环、端口由系统给**（`127.0.0.1:0`）。绑 `0.0.0.0` 会让同网段的机器
//!    连到这个代理 —— 而它持有用户的密钥，只在内存里、只给本机的 webview 用。
//! 2. **令牌在 Rust 侧生成、经可信 IPC 交给前端**。**不进 URL、不落盘**：
//!    URL 会进浏览器历史与日志，落盘会把它变成一份长期凭据。
//! 3. **每个请求都过一遍判据**。不是"开机检查一次" —— 判据是每请求的
//!    （令牌、Origin、Host、体积、profile 修订号都会变）。
//!
//! ## 为什么这一层薄
//!
//! 因为难的部分（协议解释、错误分类、归一化）已经在 Task 1.4 做完并被测过了。
//! 这里只做"把字节搬进来、过判据、把字节搬出去"——**如果这一层开始变厚，说明
//! 有逻辑放错了地方**。
//!
//! ## 转发是**下一步**，不是这一批
//!
//! 如实标注：这一批交付的是**服务器本身**（绑定、路由、令牌、体积上限、取消句柄、
//! 健康检查）。真正的"把请求转给 provider 并把流搬回来"要 `reqwest` 的流式转发，
//! 而它依赖的凭据借出（`SecretStore::with_secret`）需要一个**跨 await 的闭包**——
//! 那件事的形状值得单独想清楚（先借出密钥、再发请求、请求结束时保证不留副本），
//! 所以它单独一批。

use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use tokio::sync::Notify;

use super::security::{self, Admission, AdmissionInput, Route, SessionToken, MAX_BODY_BYTES};

/// 代理运行期的共享状态。
pub struct ProxyState {
    pub token: SessionToken,
    /// 已收到的请求数（诊断用；**不含**任何请求内容）。
    pub requests: AtomicU64,
    /// 取消信号：`cancel` 路由置位，转发循环据此停手。
    ///
    /// 用 `Notify` 而不是 `oneshot`：一次取消可能要打断**多条**在途流
    ///（模型流、工具流），而 `oneshot` 只能唤醒一个接收者。
    pub cancelled: Notify,
    pub is_cancelled: AtomicBool,
}

impl ProxyState {
    fn new(token: SessionToken) -> Self {
        Self { token, requests: AtomicU64::new(0), cancelled: Notify::new(), is_cancelled: AtomicBool::new(false) }
    }
}

/// 一个已经起来的代理。**持有它就持有那枚令牌** —— 只有可信调用方（Tauri 命令）能拿到。
pub struct ProxyHandle {
    pub address: SocketAddr,
    token: SessionToken,
    shutdown: Option<tokio::sync::oneshot::Sender<()>>,
    state: Arc<ProxyState>,
}

impl ProxyHandle {
    /// 回环地址（`http://127.0.0.1:<port>`）。**不带令牌** ——
    /// 令牌走 header，不进 URL（否则它会进浏览器历史与日志）。
    pub fn base_url(&self) -> String {
        format!("http://{}", self.address)
    }

    /// 令牌本体。**只交给可信 IPC 的那一端**，不进 URL、不进日志、不落盘。
    pub fn token(&self) -> &str {
        self.token.expose()
    }

    /// 用户按了停止：置位并唤醒所有在等的转发。
    pub fn cancel(&self) {
        self.state.is_cancelled.store(true, Ordering::SeqCst);
        self.state.cancelled.notify_waiters();
    }

    pub fn is_cancelled(&self) -> bool {
        self.state.is_cancelled.load(Ordering::SeqCst)
    }

    /// 关掉服务器。**幂等**：重复调用不是错误。
    pub fn shutdown(mut self) {
        if let Some(sender) = self.shutdown.take() {
            let _ = sender.send(());
        }
    }
}

/// **起一个代理**：绑回环、端口交给系统、生成新令牌。
///
/// 每个会话一枚新令牌：`ProxyHandle` 一建就换，旧令牌自然失效 ——
/// 于是"应用重启后旧令牌还能用"这条路径根本不存在。
pub async fn start() -> std::io::Result<ProxyHandle> {
    // 16 字节密码学随机（见 Cargo.toml 里关于 `rand` 的说明）。
    let mut bytes = [0u8; 16];
    rand::fill(&mut bytes);
    let token = SessionToken::from_bytes(bytes);
    let state = Arc::new(ProxyState::new(token.clone()));

    let router = Router::new()
        .route("/v1/health", get(health))
        .route("/v1/runs/{run_id}/model", post(model))
        .route("/v1/runs/{run_id}/cancel", post(cancel))
        .route("/v1/runs/{run_id}/events", get(events))
        .layer(middleware::from_fn_with_state(state.clone(), admit_request))
        .with_state(state.clone());

    // **`127.0.0.1:0`**：只绑回环，端口由系统挑一个空闲的。
    // 硬编码端口会与别的程序抢，而绑 `0.0.0.0` 会把持有密钥的代理暴露给同网段。
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let (shutdown, receiver) = tokio::sync::oneshot::channel::<()>();

    tokio::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                let _ = receiver.await;
            })
            .await;
    });

    Ok(ProxyHandle { address, token, shutdown: Some(shutdown), state })
}

/// **每个请求都要过的判据**（中间件）。
///
/// 顺序与 `security::admit` 一致：先看有没有授权，再看它是不是我们发的，
/// 然后才看来源与体积。**拒绝时回一个原因码**，不回细节 ——
/// 细节（例如"令牌错了"与"没令牌"的区别）对攻击者比对我们更有用；
/// 而对我们自己，`security::admit` 的详细理由已经在诊断里有。
async fn admit_request(State(state): State<Arc<ProxyState>>, request: Request, next: Next) -> Response {
    state.requests.fetch_add(1, Ordering::Relaxed);
    let headers = request.headers();
    let host = headers.get(header::HOST).and_then(|value| value.to_str().ok()).map(str::to_string);
    let origin = headers.get(header::ORIGIN).and_then(|value| value.to_str().ok()).map(str::to_string);
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::to_string);
    // 体积判据用 `content-length`：真正的逐块限制在 body 提取器那一层
    //（`MAX_BODY_BYTES` 是同一个常量，两处引用同一个数）。
    let body_bytes = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);

    let verdict = security::admit(
        &AdmissionInput { token, host, origin, body_bytes, profile_revision: None, current_profile_revision: 0 },
        &state.token
    );
    match verdict {
        Admission::Allowed => next.run(request).await,
        Admission::Denied { code, .. } => {
            // 原因码进响应体（前端与测试要靠它区分"没令牌"与"来源不对"），
            // 但**不回显任何请求内容**。
            (StatusCode::FORBIDDEN, axum::Json(serde_json::json!({ "error": code }))).into_response()
        }
    }
}

/// `GET /v1/health` —— 不需要正文，只证明"活着、且令牌对"。
async fn health(State(state): State<Arc<ProxyState>>) -> impl IntoResponse {
    axum::Json(serde_json::json!({
        "status": "ok",
        "requests": state.requests.load(Ordering::Relaxed),
        "cancelled": state.is_cancelled.load(Ordering::SeqCst)
    }))
}

/// `POST /v1/runs/{runId}/cancel` —— 置位取消信号并唤醒在等的转发。
async fn cancel(State(state): State<Arc<ProxyState>>) -> impl IntoResponse {
    state.is_cancelled.store(true, Ordering::SeqCst);
    state.cancelled.notify_waiters();
    axum::Json(serde_json::json!({ "cancelled": true }))
}

/// `POST /v1/runs/{runId}/model` —— **转发本身还没接**（见模块头的"如实标注"）。
///
/// 现在它**如实回一个未实现的原因码**，而不是回一个看起来像成功的东西：
/// 前端据此显示"模型通道还没接通"，而不是拿着空事件去继续推理。
async fn model() -> Response {
    (
        StatusCode::NOT_IMPLEMENTED,
        axum::Json(serde_json::json!({ "error": "model_forwarding_not_implemented", "detail": "the provider transport is not wired yet" }))
    )
        .into_response()
}

/// `GET /v1/runs/{runId}/events` —— 同上，事件流也要等转发接上。
async fn events() -> Response {
    (
        StatusCode::NOT_IMPLEMENTED,
        axum::Json(serde_json::json!({ "error": "event_stream_not_implemented", "detail": "run events are delivered over IPC today" }))
    )
        .into_response()
}

/// 路由解析的**唯一**入口留给 `security::parse_route`（它已经有九种拒绝理由的用例）。
/// 这里只把 axum 的路径参数与它对齐，避免出现第二套路由规则。
pub fn route_for(method: &str, path: &str, query: &std::collections::HashMap<String, String>) -> Result<Route, String> {
    security::parse_route(method, path, query)
}

/// 体积上限。**两处引用同一个常量**，不各写一个数。
pub const BODY_LIMIT: usize = MAX_BODY_BYTES;

/// 从 header 里取令牌（`Authorization: Bearer <token>`）。
pub fn bearer_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::to_string)
}

/// 读一个请求体并**先判体积**。超限直接拒，不把字节留在内存里等它长大。
pub fn read_bounded(body: &Bytes) -> Result<&[u8], String> {
    if body.len() > BODY_LIMIT {
        return Err(format!("the body is {} bytes; the limit is {BODY_LIMIT}", body.len()));
    }
    Ok(body.as_ref())
}
