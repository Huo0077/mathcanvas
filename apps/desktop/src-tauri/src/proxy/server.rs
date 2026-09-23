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
//!    （令牌、Origin、Host、体积都会变）。
//!
//!    **如实标注这一条今天到哪为止**（外部审查 M10）：中间件确实每请求跑
//!    `security::admit`，但有两项**判据没有接在活路径上**：
//!    - `security::admit` 的 `stale_profile_revision` 分支：中间件传的是
//!      `profile_revision: None, current_profile_revision: 0`，所以那一支**永远不可能触发** ——
//!      `ProxyState` 里根本没有"当前 profile 修订号"这个东西，要接就得先定
//!      "请求里的修订号从哪来"（查询串？会话建立时钉住？），那是一个**产品决定**，不是补丁；
//!    - `security::parse_route` 里"没有任何路由接受上游 URL"那条：axum 直接按路径匹配，
//!      中间件从不解析路由与查询串，所以它**也不在线上**（判断层与测试里有，socket 上没有）。
//!
//!    今天影响为零 —— 这一批**没有任何东西被转发**（`model` / `events` 如实回 501）。
//!    但一个文件讲的安全故事比 socket 真正执行的更强，本身就是缺陷：**上面那两句原先
//!    把"profile 修订号"与"每请求判据"写成了已经成立的事实。** 先把它说准，
//!    等转发真的接上（或有人决定修订号从哪来）再把这两条挂到活路径上。
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

use std::collections::HashMap;
use std::collections::VecDeque;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use serde::Serialize;
use tokio::sync::Notify;

use super::security::{self, Admission, AdmissionInput, Route, SessionToken, MAX_BODY_BYTES};

/// **最多留档多少次运行**。超出之后最旧的被丢：这个记录是"回看这一次"，不是历史库。
pub const MAX_TRACKED_RUNS: usize = 16;
/// **每次运行最多留档多少条事件**。超出之后不再追加，并置 `truncated`。
///
/// 为什么是留档上限而不是流的上限：流本身照常流完（该给前端的一条不少），
/// 这里管的是"运行结束之后还能查到什么"。不封顶的话，一次长运行会把内存一直吃下去。
pub const MAX_RUN_EVENTS: usize = 64;

/// **一次运行的取消信号**。
///
/// 它同时给两种消费者用：
/// - 同步的"每块之前查一次"（`Stop::cancelled`，`ProviderAdapter` 用）；
/// - 异步的"等下一块的时候怎么醒"（`Stop::wait`，流式读用）。
///
/// `Notify` 而不是 `oneshot`：一次取消可能要打断**多条**在途流（模型流、工具流），
/// 而 `oneshot` 只能唤醒一个接收者。
pub struct RunCancel {
    flag: AtomicBool,
    notify: Notify,
}

impl Default for RunCancel {
    fn default() -> Self {
        Self::new()
    }
}

impl RunCancel {
    pub fn new() -> Self {
        Self { flag: AtomicBool::new(false), notify: Notify::new() }
    }

    /// 用户按了停止。**幂等**。
    pub fn cancel(&self) {
        self.flag.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    pub fn cancelled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }
}

impl crate::providers::adapter::Stop for RunCancel {
    fn cancelled(&self) -> bool {
        self.cancelled()
    }

    fn wait(&self) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + '_>> {
        Box::pin(async move {
            // **先查标志再等通知**：只等通知会在"置位与等待之间"漏掉那次取消，
            // 而那条路径的表现是"用户按了停止、界面一直转圈"。
            if self.cancelled() {
                return;
            }
            self.notify.notified().await;
        })
    }
}

/// 一次运行留下的记录。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunEvents {
    pub run_id: String,
    /// 已经产出的归一化事件（`camelCase`，与 TS 侧同一个形状）。
    pub events: Vec<serde_json::Value>,
    /// 这个运行**已经停止产出**了吗。前端据此决定还要不要轮询。
    pub finished: bool,
    /// 记录被上限截断过吗。截断了就得**说出来** —— 悄悄少几条会让界面显示一份不完整的回答。
    pub truncated: bool,
    pub cancelled: bool,
}

struct RunRecord {
    events: VecDeque<serde_json::Value>,
    finished: bool,
    truncated: bool,
    cancel: Arc<RunCancel>,
}

/// **运行记录 + 取消句柄**。
///
/// 它挂在代理状态上（而不是某个命令线程上），因为 `/v1/runs/{runId}/events`
/// 要从 HTTP 那一侧读到它。于是"谁在跑"和"谁在问"能分开。
#[derive(Default)]
pub struct RunRegistry {
    runs: Mutex<HashMap<String, RunRecord>>,
    order: Mutex<VecDeque<String>>,
}

impl RunRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// 拿一次运行的取消句柄（没有就建）。**同一个 runId 拿到同一枚** ——
    /// 否则"取消"会取消到一个没人听的信号上。
    pub fn cancel_handle(&self, run_id: &str) -> Arc<RunCancel> {
        let mut runs = self.runs.lock().expect("the run registry is not poisoned");
        if let Some(record) = runs.get(run_id) {
            return record.cancel.clone();
        }
        let cancel = Arc::new(RunCancel::new());
        runs.insert(run_id.to_string(), RunRecord { events: VecDeque::new(), finished: false, truncated: false, cancel: cancel.clone() });
        drop(runs);
        self.touch(run_id);
        cancel
    }

    /// 记一批事件。`finished` 为真表示这次运行不再产出。
    ///
    /// 事件是**攒够一批再记**（而不是一条一条）：一次网络读会解出若干事件，
    /// 逐条加锁既没必要，也让"这一批属于同一次读"这个信息丢掉。
    pub fn record(&self, run_id: &str, events: &[serde_json::Value], finished: bool) {
        let mut runs = self.runs.lock().expect("the run registry is not poisoned");
        let record = runs
            .entry(run_id.to_string())
            .or_insert_with(|| RunRecord { events: VecDeque::new(), finished: false, truncated: false, cancel: Arc::new(RunCancel::new()) });
        for event in events {
            if record.events.len() >= MAX_RUN_EVENTS {
                record.truncated = true;
                continue;
            }
            record.events.push_back(event.clone());
        }
        if finished {
            record.finished = true;
        }
        drop(runs);
        self.touch(run_id);
    }

    /// 这个运行有记录吗。
    pub fn has(&self, run_id: &str) -> bool {
        self.runs.lock().expect("the run registry is not poisoned").contains_key(run_id)
    }

    /// 读一次运行的记录。**没有记录就回 `None`** —— 与"记录里有零条事件"分开。
    pub fn read(&self, run_id: &str) -> Option<RunEvents> {
        let runs = self.runs.lock().expect("the run registry is not poisoned");
        runs.get(run_id).map(|record| RunEvents {
            run_id: run_id.to_string(),
            events: record.events.iter().cloned().collect(),
            finished: record.finished,
            truncated: record.truncated,
            cancelled: record.cancel.cancelled(),
        })
    }

    /// 把刚碰过的运行放到队尾，并按上限丢掉最旧的。
    ///
    /// "最旧"按**最后一次被碰**算（LRU），不是按创建时间：长运行会持续被碰，
    /// 于是它不会被后来的一堆短运行挤掉。
    fn touch(&self, run_id: &str) {
        let mut order = self.order.lock().expect("the run order is not poisoned");
        order.retain(|existing| existing != run_id);
        order.push_back(run_id.to_string());
        while order.len() > MAX_TRACKED_RUNS {
            if let Some(evicted) = order.pop_front() {
                self.runs.lock().expect("the run registry is not poisoned").remove(&evicted);
            }
        }
    }
}

/// 代理运行期的共享状态。
pub struct ProxyState {
    pub token: SessionToken,
    /// 已收到的请求数（诊断用；**不含**任何请求内容）。
    pub requests: AtomicU64,
    /// 取消信号：`cancel` 路由置位，转发循环据此停手。
    pub cancelled: Notify,
    pub is_cancelled: AtomicBool,
    /// 运行记录 + 每次运行的取消句柄。
    pub runs: RunRegistry,
}

impl ProxyState {
    fn new(token: SessionToken) -> Self {
        Self { token, requests: AtomicU64::new(0), cancelled: Notify::new(), is_cancelled: AtomicBool::new(false), runs: RunRegistry::new() }
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

    /// **记一批运行事件**（给 `/v1/runs/{runId}/events` 用）。
    pub fn record_events(&self, run_id: &str, events: &[serde_json::Value], finished: bool) {
        self.state.runs.record(run_id, events, finished);
    }

    /// 这个运行有记录吗。
    pub fn run_recorded(&self, run_id: &str) -> bool {
        self.state.runs.has(run_id)
    }

    /// 读一次运行的记录。**没有记录回 `None`**（与"零条事件"分开）。
    pub fn run_events(&self, run_id: &str) -> Option<RunEvents> {
        self.state.runs.read(run_id)
    }

    /// 拿这次运行的取消句柄。**同一个 runId 拿到同一枚**。
    pub fn cancel_handle(&self, run_id: &str) -> Arc<RunCancel> {
        self.state.runs.cancel_handle(run_id)
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

    // **这里没有评估的两项，写在调用点上**（外部审查 M10）—— 免得下一个人从
    // `admit` 的签名以为它们在跑：
    //
    // - `profile_revision` / `current_profile_revision` 恒为 `None` / `0` ⇒
    //   `stale_profile_revision` 那一支**不可能触发**。`ProxyState` 里没有"当前修订号"，
    //   要接得先定"请求里的修订号从哪来"（产品决定）。
    // - `parse_route` 没有被调用 ⇒ "没有任何路由接受上游 URL"那条判据不在活路径上
    //   （axum 直接按路径匹配）。真正转发之前必须把它接进来。
    //
    // 两项都已在模块头如实标注；今天没有任何东西被转发（`model`/`events` 回 501），影响为零。
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

/// `GET /v1/runs/{runId}/events` —— **运行记录已经在代理里了**，但它由**命令线程**写入。
///
/// 这条路由本身仍然如实回"未接通"，原因不是偷懒，而是**这件事不该在这里做**：
/// 真正发请求的是 Tauri 命令（凭据库的同步闭包约束，见 `providers::adapter` 的模块头），
/// 它把运行记录写进 `RunRegistry`。若在这里再转发一次，就会有两个地方
/// 各持一份"这次运行在跑什么"，而它们必然分叉。
///
/// 所以：**数据在这里，动作不在这里**。接法只有一种不带歧义的做法 ——
/// 把运行搬进代理（那要先把凭据借出改成异步形状），那是一次有意的重构，不是一行的改动。
async fn events() -> Response {
    (
        StatusCode::NOT_IMPLEMENTED,
        axum::Json(serde_json::json!({
            "error": "event_stream_not_implemented",
            "detail": "run events live in the trusted IPC layer (see the proxy `RunRegistry`); this route would need the run itself, not the record"
        }))
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
