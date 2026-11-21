//! **ProviderAdapter：把协议、凭据、传输、取消、解码缝在一起**（Task 1.4 收尾 + Task 1.5 后半）。
//!
//! 计划原文的接口是
//! `ProviderAdapter::send(request: ProviderRequest, secret: SecretHandle, cancel: CancellationToken) -> Stream<ModelEvent>`。
//!
//! ## 这一层是"缝"，不是"新逻辑"
//!
//! 四件事各有归属，这里只把它们按正确的顺序串起来：
//!
//! | 事 | 归属 | 为什么不在这一层 |
//! | --- | --- | --- |
//! | 拼请求 | `providers::request` | 方言与常量路径的形状已经在那里被测过 |
//! | 解释响应 | `providers::normalize` | 三家形状的差异在那里被测过 |
//! | 借凭据 | `secrets::Store` | 明文的生命周期由凭据库决定 |
//! | 搬字节 | `HttpTransport`（本文件） | 只有这一层碰网络 |
//!
//! ## 三条性质，每条都落在类型或断言上
//!
//! 1. **密钥的借出窗口只覆盖这一次发送**。`send` 里唯一能碰到明文的地方是
//!    `SecretSource::with_secret` 的闭包，而闭包一返回，那个 `&str` 就没了。
//!    发送用的头是 `authorize(..)` **现场算出来的**，`ProviderRequest` 里那个认证头
//!    永远是空值 —— 所以"密钥进了请求结构体"这件事在类型上就不成立。
//! 2. **出站之前还有一道判据**。配置文件是可以被手改的，而"手改过的配置"不该变成一次
//!    SSRF（或一次明文传密钥）。所以真正连接之前要过 `security::allow_upstream`。
//! 3. **取消之后不再产出事件**。`stop` 每块之前都查一次；置位之后连 provider 都不再碰。
//!
//! ## 为什么借密钥这件事要另起一个线程
//!
//! `with_secret` 收的是一个**同步**闭包（那是它的价值：明文只在闭包执行期间存在，
//! 而不是被"取出来"交给调用方）。而 HTTP 是异步的。两个办法：
//! - 把闭包改成"返回一个 Future"—— 那就得让 `SecretStore` 的泛型方法出现在一个 trait object 里，
//!   而 `with_secret<T>` 的泛型正是让 `Store` 当初放弃 `Box<dyn>` 的原因（`E0038`）；
//! - 在**另一个线程**上驱动异步。闭包仍然是同步的，明文的生命周期仍然只覆盖那次调用，
//!   代价只是"一次请求一个线程"（Tauri 的命令线程本来也不该被阻塞）。
//!
//! 选后者。这也顺带让"取消"能真的打断在途的流：`tokio::select!` 需要一个能被 `await` 的信号。

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;

use super::events::{classify_http_failure, FailureKind, ModelEvent};
use super::request::{authorize, build_request, ChatMessage, ProviderRequest, RequestOptions};
use crate::proxy::security::{self, MAX_BODY_BYTES};
use crate::repository::provider_profiles::ProviderProfile;

/// **凭据的来源**。真实实现是 `secrets::Store`；测试里是一个写死的替身。
///
/// 刻意只借出、不返回：`with_secret` 的闭包形态是"明文没有出口"那条性质的落点。
/// 错误是 `String` 而不是 `SecretError`：这一层只关心"借不到"，分类是凭据库的事。
///
/// 闭包**不加 `Send`**：它就在调用它的那个线程上跑完，而"能跨线程"这件事会让
/// 明文的生命周期变得需要额外论证（谁能在闭包执行期间碰它）。不加，是因为不需要。
pub trait SecretSource: Send + Sync {
    fn with_secret<T>(&self, profile_id: &str, f: impl FnOnce(&str) -> T) -> Result<Option<T>, String>;
}

impl SecretSource for crate::secrets::Store {
    fn with_secret<T>(&self, profile_id: &str, f: impl FnOnce(&str) -> T) -> Result<Option<T>, String> {
        <Self as crate::secrets::SecretStore>::with_secret(self, profile_id, f).map_err(|error| error.to_string())
    }
}

/// **取消信号**。同步的 `cancelled()` 给"每块之前查一次"用，异步的 `wait()` 给流式读用。
///
/// 两者都要，是因为它们回答两个不同的问题：同步那个回答"要不要继续"，
/// 异步那个回答"在等下一块的时候怎么醒过来"。
pub trait Stop: Send + Sync {
    fn cancelled(&self) -> bool;

    /// 等到取消为止。
    ///
    /// 默认实现是**轮询**：这样任何一个只实现了 `cancelled()` 的信号（包括测试里的
    /// 一个 `AtomicBool`）都能被 await，不必强迫每个实现都带一个 `Notify`。
    /// 真实实现（`RunCancel`）用自己的 `Notify` 覆盖它 —— 取消是用户点出来的，
    /// 50ms 的延迟没有意义，但它也不该由这一层来规定。
    fn wait(&self) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + '_>> {
        Box::pin(async move {
            while !self.cancelled() {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        })
    }
}

/// 传输层交给适配器的一块信息。**它只是字节**：解释字节是 `normalize` 的事。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransportUpdate {
    Body(Vec<u8>),
    End,
}

/// **出站 HTTP**。这一层只回答"字节怎么进出"，不回答"这些字节是什么意思"。
///
/// 失败**必须**从这里返回（而不是混进 `TransportUpdate`）：混进去的话，
/// "这次请求失败了"与"流里有一块坏数据"就分不开了。
pub trait Transport: Send + Sync {
    fn send(&self, request: &ProviderRequest, authorization: &[(String, String)], stop: &dyn Stop, on_update: &mut dyn FnMut(TransportUpdate)) -> Result<(), ProviderError>;
}

/// 一次发送的结果。
///
/// **失败不在这个 enum 里**：失败走 `Err(ProviderError)`。两者混在一个 enum 里，
/// 调用方会经常忘记处理失败那一支。
#[derive(Debug, Clone, PartialEq)]
pub enum SendOutcome {
    /// 读到了流的结尾。事件按到达顺序排列。
    Completed(Vec<ModelEvent>),
    /// 用户取消。**带回已经产出的那部分**（用户看到的就是它），而不是丢掉。
    Cancelled(Vec<ModelEvent>),
}

/// 适配器的失败。**每一种都能被翻译成 `ModelEvent::Failed`**（见 `to_event`）。
#[derive(Debug, Clone, PartialEq)]
pub enum ProviderError {
    /// 这个 profile 没有配置密钥。**不发** —— 发一次注定 401 的请求只会让用户以为是服务商的问题。
    MissingSecret { profile_id: String },
    /// 凭据库本身出错了（**消息里没有明文**，那是凭据库的责任）。
    SecretStore { detail: String },
    /// 出站判据拒绝了这个地址（SSRF 防线 / 云端必须 HTTPS）。
    RefusedUrl { detail: String },
    /// 连接、超时、TLS、读流之类的传输失败。
    Transport { detail: String },
    /// provider 回了非 2xx。`failure` 由 `classify_http_failure` 给（**同一套词汇**）。
    Http { status: u16, failure: FailureKind, message: String },
    /// **没有这份 profile**。
    ///
    /// 与 `MissingSecret` 分开是刻意的：那两种情况的处置完全不同 ——
    /// "没这份配置"要去设置里建一份，"没密钥"要去设置里填一格。
    /// 合成一条会让界面给出错的下一步。
    NotFound { profile_id: String },
    /// 界面拿的是**另一份**配置（修订号不符）。
    ///
    /// 这不是"用旧配置跑一次"：请求是按某一版 profile 拼出来的，而当前的那一版
    /// 已经不是它了 —— 跑出来的结果没法解释（模型、端点、方言都可能变了）。
    RevisionMismatch { expected: u32, actual: u32 },
    /// **工具支持还没有被验证过**，所以不发工具表。
    ///
    /// 计划 Task 2.3 原文："Do not send a tool schema to providers that failed capability
    /// verification." 这一条**在两端各有一道**（前端按证据选通道，这里再看一次存下来的证据）：
    /// 前端那道是"我们不该请求"，这一道是"就算请求了也不发"。两处都要有，理由与密钥字段
    /// 那条约束一样 —— 只在调用方守着的边界，一旦多出一个调用方就没了。
    ///
    /// **不静默丢掉工具表**：调用方明明给了工具却收到一个"没带工具的请求"，会得到一个
    /// 看起来像"模型不会用工具"的结果，而真实原因是证据没验过。
    ToolsNotVerified { profile_id: String },
}

impl ProviderError {
    /// 失败分类。**前端读它决定重不重试**，而它只有一处判据。
    pub fn failure(&self) -> FailureKind {
        match self {
            ProviderError::MissingSecret { .. } => FailureKind::Auth,
            // "没这份配置"是**使用者的配置问题**，换时机再试还是同一份错误。
            ProviderError::NotFound { .. } => FailureKind::Auth,
            ProviderError::RevisionMismatch { .. } => FailureKind::Auth,
            ProviderError::SecretStore { .. } => FailureKind::Unknown,
            ProviderError::RefusedUrl { .. } => FailureKind::Permission,
            // 与 `RefusedUrl` 同类：**不是"这次运气不好"**，而是"这条路现在不允许" ——
            // 重试一百次还是同一份证据。用户在设置里跑一次能力验证才会改变它。
            ProviderError::ToolsNotVerified { .. } => FailureKind::Permission,
            ProviderError::Transport { .. } => FailureKind::Transport,
            ProviderError::Http { failure, .. } => *failure,
        }
    }

    /// 翻成前端认的失败事件。**重试性由分类决定**，不由这里决定。
    pub fn to_event(&self) -> ModelEvent {
        ModelEvent::failed(self.failure(), self.message())
    }

    /// 给用户看的那句话。**永远不含明文密钥**。
    pub fn message(&self) -> String {
        match self {
            ProviderError::MissingSecret { profile_id } => {
                format!("the profile {profile_id} has no credential stored; add one in Settings before running a model")
            }
            ProviderError::SecretStore { detail } => format!("the credential store is unavailable: {detail}"),
            ProviderError::RefusedUrl { detail } => format!("the endpoint was refused: {detail}"),
            ProviderError::Transport { detail } => format!("the provider could not be reached: {detail}"),
            ProviderError::Http { message, .. } => message.clone(),
            ProviderError::NotFound { profile_id } => format!("no provider profile with id {profile_id}"),
            ProviderError::RevisionMismatch { expected, actual } => {
                format!("the profile is at revision {actual}, the request was built for {expected}; reload the settings before running")
            }
            ProviderError::ToolsNotVerified { profile_id } => {
                format!("the tool support of {profile_id} has not been verified, so no tool schema was sent; run the capability check in Settings first")
            }
        }
    }

    /// **给 IPC 用的形状**（`camelCase`，与 TS 侧 `ModelEvent` 的 `failed` 变体同名）。
    ///
    /// 命令的返回类型是 `Result<Vec<Value>, String>`：失败**必须是 `Err`**，
    /// 否则一个"什么都没说"的空数组看起来就像"模型没说话"。
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "kind": "failed",
            "failure": self.failure(),
            "message": self.message(),
            "retryable": self.failure().retryable()
        })
    }
}

impl std::fmt::Display for ProviderError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.message())
    }
}

impl std::error::Error for ProviderError {}

/// **把字节流拆成帧并归一化**。
///
/// 存在的理由是"TCP 不认识 SSE 帧"：一块 JSON 落在两个 chunk 的边界上是**常态**，
/// 而按"一个 chunk 一帧"解析会在真实网络下随机丢事件 —— 那看起来像"模型偶尔不说话"。
///
/// 两种分隔：
/// - **SSE**（OpenAI 兼容 / Anthropic）：`\n\n` 一帧；
/// - **NDJSON**（Ollama 原生）：`\n` 一行。
///
/// `flush()` 处理"最后一块没有尾随分隔符"的情况：那不是畸形，只是对方没补空行。
struct RunStream {
    protocol: String,
    /// **这次请求要的是流式吗**（`ProviderRequest.stream`）。
    ///
    /// 这个字段是 2026-09-21 补的，补它的原因是一次**真实往返**：探针用 `stream: false` 发请求，
    /// 而这一层**永远**按 SSE 拆帧 —— 一份没有 `data:` 行的正文于是被解析成"零事件"，
    /// 而且**不报错**（`Completed([])`）。症状是能力探针在真实服务上把所有能力都记成
    /// "the provider returned an empty reply"，也就是**一个完全健康的服务看起来什么都不支持**。
    /// 假替身一直没暴露它，因为替身喂的字节**始终是 SSE 形状**（`data: {...}\n\n`），
    /// 不管请求里那个 `stream` 是什么 —— 于是测试与生产的形状对不上。
    stream: bool,
    ndjson: bool,
    buffer: Vec<u8>,
    events: Vec<ModelEvent>,
    /// OpenAI 兼容的工具调用参数是**跨帧分片**，必须由一个**活过单帧**的东西攒着。
    tool_calls: super::normalize::ToolCallAccumulator,
    done: bool,
    /// **这次流里见过结束标记吗**（`[DONE]` / `message_stop` / `finish_reason` / `done:true`）。
    ///
    /// T2（2026-10-24）：TCP 的 EOF **不是**"生成正常完成"的证据 —— 连接被掐断与模型说完话
    /// 在这一层长得一模一样。所以流结束时没见到结束标记，要如实记一条
    /// `MalformedOutput`（上层据此分类为"断流"，而不是把它当成一份完整回答）。
    saw_terminal: bool,
}

impl RunStream {
    fn new(protocol: &str, stream: bool) -> Self {
        Self {
            protocol: protocol.to_string(),
            stream,
            ndjson: protocol == "ollama",
            buffer: Vec::new(),
            events: Vec::new(),
            tool_calls: super::normalize::ToolCallAccumulator::default(),
            done: false,
            saw_terminal: false,
        }
    }

    /// 攒下来的正文看起来像 SSE 吗（有 `data:` 行）。
    ///
    /// 请求说"不要流式"、而对方仍然流式，是真实存在的情况（有些网关只此一种）。
    /// 所以**正文可以推翻那个标志**：形状自己做主，标志只是提示。
    fn looks_like_sse(&self) -> bool {
        self.buffer.windows(5).any(|window| window == b"data:")
    }

    /// 吃掉一帧。
    fn absorb(&mut self, frame: &str) {
        let trimmed = frame.trim();
        if trimmed.is_empty() {
            return;
        }
        // SSE 的结束标记：认它才能让界面停下转圈。
        if super::events::parse_sse_line(trimmed) == super::events::SseLine::Done {
            self.done = true;
            self.saw_terminal = true;
            return;
        }
        // 命名事件（Anthropic 的 `content_block_delta` 等）在 `event:` 行里。
        // 归一化器本来就接受一个 `event` 参数，这里把它从帧里取出来传下去 ——
        // 否则 `content_block_delta` 与 `content_block_start` 会被看成同一个东西。
        let name = super::normalize::sse_event_name(trimmed);
        let payload = super::normalize::strip_sse_event_lines(trimmed);
        let decoded = super::normalize::normalize_response_with(&self.protocol, &payload, name.as_deref(), !self.ndjson, &mut self.tool_calls);
        // Anthropic / Ollama 的结束标记是一个**事件**（`message_stop` / `done:true`），
        // 不在 SSE 的 `[DONE]` 行里 —— 所以两条路都要记进 `saw_terminal`。
        if decoded.iter().any(|event| matches!(event, ModelEvent::Completed { .. })) {
            self.saw_terminal = true;
        }
        self.events.extend(decoded);
    }

    fn feed(&mut self, chunk: &[u8]) {
        self.buffer.extend_from_slice(chunk);
        // **非流式请求先攒着**：整份正文在 `flush()` 里一次解释。
        // 拆帧会把它当成"没有 `data:` 行的 SSE"，于是一条事件都不产出。
        if !self.stream && !self.looks_like_sse() {
            return;
        }
        while let Some((index, sep_len)) = next_frame_delimiter(&self.buffer, self.ndjson) {
            let frame: Vec<u8> = self.buffer.drain(..index).collect();
            // 丢掉分隔符本身（支持 `\n\n` 与代理常见的 `\r\n\r\n`）。
            self.buffer.drain(..sep_len);
            self.absorb(&String::from_utf8_lossy(&frame));
        }
    }

    /// 流结束：**先把剩下的半帧吃进累积器，再发攒好的工具调用**，最后判"有没有收尾"。
    ///
    /// ## 顺序是判据（T2，2026-10-24）
    ///
    /// 旧实现先 `drain()` 再处理残留缓冲：最后一帧若是**没有尾随空行**的工具参数分片
    /// （真实网关常见），它进累积器的那一刻累积器已经交出去了 —— 于是那一段参数**静默丢失**，
    /// 上层看到的是一个"合法但不完整"的工具调用。正确顺序只有一种：
    /// 残留帧 → 累积器 → `drain`。
    ///
    /// ## EOF 不是收尾
    ///
    /// `stream` 请求结束时，如果整个流里**一次结束标记都没见过**（`[DONE]` / `message_stop` /
    /// `finish_reason` / `done:true`），那说明对方是被掐断的：如实记一条 `MalformedOutput`，
    /// 让上游按"断流"分类，而不是把半截回答当成完整回答。
    fn flush(&mut self) {
        // ① 残留的半帧先进累积器（`stream: false` 且不是 SSE 形状时，整份正文一次解释）。
        if !self.buffer.is_empty() {
            let rest: Vec<u8> = std::mem::take(&mut self.buffer);
            let text = String::from_utf8_lossy(&rest).to_string();
            if !self.stream && !text.contains("data:") {
                let decoded = super::normalize::normalize_response_with(&self.protocol, &text, None, false, &mut self.tool_calls);
                self.events.extend(decoded);
            } else {
                self.absorb(&text);
            }
        }
        // ② 攒完再发：一次调用只出现一次，且参数是**完整**的。
        self.events.extend(self.tool_calls.drain());
        // ③ 流式请求没有收尾标记 ⇒ 如实报断流（不是"正常完成"）。
        if self.stream && !self.saw_terminal && !self.done {
            self.events.push(ModelEvent::failed(FailureKind::MalformedOutput, "the stream ended without a completion marker"));
        }
    }

    fn take(&mut self) -> Vec<ModelEvent> {
        std::mem::take(&mut self.events)
    }
}

/// 在字节切片里找下一个帧分隔符及长度：NDJSON 为 `\n`（含 `\r\n`），SSE 同时支持 `\n\n` 与 `\r\n\r\n`。
fn next_frame_delimiter(haystack: &[u8], ndjson: bool) -> Option<(usize, usize)> {
    if ndjson {
        let crlf = find(haystack, b"\r\n").map(|idx| (idx, 2));
        let lf = find(haystack, b"\n").map(|idx| (idx, 1));
        return match (crlf, lf) {
            (Some(a), Some(b)) => Some(if a.0 < b.0 { a } else { b }),
            (a, b) => a.or(b),
        };
    }
    let crlf_crlf = find(haystack, b"\r\n\r\n").map(|idx| (idx, 4));
    let lf_lf = find(haystack, b"\n\n").map(|idx| (idx, 2));
    match (crlf_crlf, lf_lf) {
        (Some(a), Some(b)) => Some(if a.0 <= b.0 { a } else { b }),
        (a, b) => a.or(b),
    }
}

/// 在字节切片里找子切片。不用 `windows(..).position(..)` 是因为它在空 needle 上会 panic，
/// 而"找不到"在这里是一个正常结果（这一块还没凑够一帧）。
fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|window| window == needle)
}

/// 把 reqwest 的错误**连着原因链**写出来。
///
/// 只要顶层的 `to_string()` 会丢掉最有用的那一句：reqwest 的顶层永远是
/// "error sending request for url (...)"，而真正的原因（"connection refused"、
/// "certificate expired"、"invalid peer certificate"）在 `source()` 里。
/// 丢掉它会让所有网络故障看起来是同一个 —— 而它们该被分开处置。
fn describe(error: &(dyn std::error::Error + 'static)) -> String {
    let mut parts = vec![error.to_string()];
    let mut current = error.source();
    while let Some(source) = current {
        parts.push(source.to_string());
        current = source.source();
    }
    parts.join(": ")
}

/// **把一次模型请求从头做到尾**。
pub struct ProviderAdapter<'a, S: SecretSource + ?Sized, T: Transport + ?Sized> {
    secrets: &'a S,
    transport: &'a T,
    profile: ProviderProfile,
}

impl<'a, S: SecretSource + ?Sized, T: Transport + ?Sized> ProviderAdapter<'a, S, T> {
    pub fn new(secrets: &'a S, transport: &'a T, profile: ProviderProfile) -> Self {
        Self { secrets, transport, profile }
    }

    pub fn profile(&self) -> &ProviderProfile {
        &self.profile
    }

    /// **发一次请求**（不带工具表）。
    ///
    /// 顺序是刻意的，每一步都在拦住一种具体的故障：
    /// 1. 出站判据 —— 手改过的 `baseUrl` 不该变成 SSRF，也不该明文传密钥；
    /// 2. 借密钥 —— 借不到就**不发**；
    /// 3. 拼请求（此时认证头是空的）；
    /// 4. 现场算出认证头，交给传输层；
    /// 5. 边到边解码，取消一置位就停手。
    pub fn send(&self, messages: Vec<ChatMessage>, stream: bool, stop: &dyn Stop) -> Result<SendOutcome, ProviderError> {
        self.send_with(messages, stream, RequestOptions::default(), stop)
    }

    /// **发一次请求**，并指定这次要带什么（工具表、是否强制用工具、图片消息）。
    ///
    /// 这个口子是给**能力探针**的：它需要工具表与 `tool_choice`，
    /// 而真运行走上面那个不带工具的默认路径。两者共用下面这条发送路径 ——
    /// 判据、借密钥、解码、取消都只有一处实现。
    pub fn send_with(&self, messages: Vec<ChatMessage>, stream: bool, options: RequestOptions, stop: &dyn Stop) -> Result<SendOutcome, ProviderError> {
        let request = build_request(&self.profile, messages, stream, options);
        // 端点由 `base_url` + 常量路径拼出（调用方给不了它），但那份 `base_url`
        // 来自**可以被手改的配置文件** —— 所以连接之前再过一遍判据。
        security::allow_upstream(&request.endpoint, &self.profile.network_policy).map_err(|detail| ProviderError::RefusedUrl { detail })?;

        let (outcome, events) = {
            let mut sink: Vec<ModelEvent> = Vec::new();
            let outcome = self.send_inner(request, stop, &mut |event| sink.push(event))??;
            (outcome, sink)
        };

        match outcome {
            InnerOutcome::Completed => Ok(SendOutcome::Completed(events)),
            InnerOutcome::Cancelled => Ok(SendOutcome::Cancelled(events)),
        }
    }

    /// **一次发送的内层**。
    ///
    /// 返回 `Result<Result<_, _>, _>` 是刻意的：**外层**是"凭据库这一层能不能借出"，
    /// **内层**是"这次请求本身成不成"（包括"这一格根本没有密钥"）。
    /// 压成一层就得用一个哨兵值表示"没有密钥"，而那会与某一条真实失败混淆。
    fn send_inner(&self, request: ProviderRequest, stop: &dyn Stop, sink: &mut dyn FnMut(ModelEvent)) -> Result<Result<InnerOutcome, ProviderError>, ProviderError> {
        if stop.cancelled() {
            return Ok(Ok(InnerOutcome::Cancelled));
        }

        let profile_id = self.secret_ref();
        if !crate::repository::provider_profiles::credential_reference_belongs(&self.profile.id, &profile_id) {
            return Err(ProviderError::RefusedUrl { detail: "the credential does not belong to this profile".to_string() });
        }
        if self.profile.credential_endpoint.is_none() {
            return Err(ProviderError::RefusedUrl { detail: "the legacy credential has no trusted endpoint binding; enter it again to authorize this endpoint".to_string() });
        }
        crate::repository::provider_profiles::validate_credential_binding(&self.profile).map_err(|detail| ProviderError::RefusedUrl { detail })?;
        let protocol = self.profile.protocol.clone();
        let transport = self.transport;

        // 闭包是**同步**的（见模块头"为什么借密钥这件事要另起一个线程"）。
        // 它返回之后，`secret` 那个 `&str` 就没了 —— 请求结构体里从头到尾没有它。
        let borrowed = self
            .secrets
            .with_secret(&profile_id, move |secret| {
                let authorization = authorize(&request, secret);
                // 解码器要知道**这次请求要的是不是流式**（见 `RunStream::stream` 的说明）：
                // 非流式的正文没有 `data:` 帧，按 SSE 拆会得到"零事件且不报错"。
                let mut stream = RunStream::new(&protocol, request.stream);
                let mut failure: Option<ProviderError> = None;

                let result = transport.send(&request, &authorization, stop, &mut |update| match update {
                    TransportUpdate::Body(bytes) => {
                        // **每块之前查一次取消**：取消之后不再解码，也不再把事件交出去。
                        if stop.cancelled() {
                            return;
                        }
                        stream.feed(&bytes);
                        for event in stream.take() {
                            sink(event);
                        }
                    }
                    TransportUpdate::End => {}
                });

                if let Err(error) = result {
                    failure = Some(error);
                }

                if failure.is_none() && !stop.cancelled() {
                    stream.flush();
                    for event in stream.take() {
                        sink(event);
                    }
                }

                match failure {
                    Some(error) => Err(error),
                    None if stop.cancelled() => Ok(InnerOutcome::Cancelled),
                    None => Ok(InnerOutcome::Completed),
                }
            })
            .map_err(|detail| ProviderError::SecretStore { detail })?;

        // 外层 `Result` 是"凭据库错了"，内层 `Option` 是"这一格没有密钥"。
        match borrowed {
            None => Ok(Err(ProviderError::MissingSecret { profile_id })),
            Some(inner) => Ok(inner),
        }
    }

    /// 从哪一格凭据库借密钥。缺 `secretRef` 时退到 profile id（单一凭据的常见情形）。
    pub fn secret_ref(&self) -> String {
        self.profile.secret_ref.clone().unwrap_or_else(|| self.profile.id.clone())
    }
}

/// `send` 内部的结果。**不带事件**：事件由 `sink` 实时交出去。
enum InnerOutcome {
    Completed,
    Cancelled,
}

/// **真实的 HTTP 传输**（`reqwest` + rustls）。
///
/// 四个刻意的选择：
/// 1. **不跟随重定向**（`Policy::none()`）。跟着走就会把认证头送给 `Location` 指的那个地方 ——
///    那是"代理"这类组件最经典的漏洞形状。302 于是如实变成一个 HTTP 失败。
/// 2. **rustls 而不是系统 TLS**：云端必须验证书这条判据不该随用户机器的 TLS 配置变化。
/// 3. **连接超时 15 秒、总超时 120 秒**：流式响应会长时间占着连接，但没有总超时的话
///    "对端不关连接"会让这次运行永远不结束（界面一直转圈）。
/// 4. **响应体限长**（与入站同一个常量）：对端回一大坨东西不该把内存吃光。
pub trait AddressResolver: Send + Sync {
    fn resolve<'a>(&'a self, host: &'a str, port: u16) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<SocketAddr>, String>> + Send + 'a>>;
}

impl<F> AddressResolver for F
where
    F: Fn(&str, u16) -> Result<Vec<SocketAddr>, String> + Send + Sync,
{
    fn resolve<'a>(&'a self, host: &'a str, port: u16) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<SocketAddr>, String>> + Send + 'a>> {
        let result = self(host, port);
        Box::pin(async move { result })
    }
}

struct SystemResolver;

impl AddressResolver for SystemResolver {
    fn resolve<'a>(&'a self, host: &'a str, port: u16) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<SocketAddr>, String>> + Send + 'a>> {
        let host = host.to_string();
        Box::pin(async move {
            tokio::net::lookup_host((host.as_str(), port)).await
                .map(|addresses| addresses.collect())
                .map_err(|error| error.to_string())
        })
    }
}

pub struct HttpTransport {
    resolver: Arc<dyn AddressResolver>,
}

impl Default for HttpTransport {
    fn default() -> Self {
        Self::new()
    }
}

impl HttpTransport {
    pub fn new() -> Self {
        Self { resolver: Arc::new(SystemResolver) }
    }

    pub fn with_resolver<R: AddressResolver + 'static>(resolver: R) -> Self {
        Self { resolver: Arc::new(resolver) }
    }

    fn client_builder() -> reqwest::ClientBuilder {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(60))
            .timeout(Duration::from_secs(180))
    }

    async fn client_for(&self, endpoint: &str, network_policy: &str) -> Result<reqwest::Client, ProviderError> {
        security::allow_upstream(endpoint, network_policy).map_err(|detail| ProviderError::RefusedUrl { detail })?;
        let url = reqwest::Url::parse(endpoint).map_err(|error| ProviderError::Transport { detail: error.to_string() })?;
        let host = url.host_str().ok_or_else(|| ProviderError::Transport { detail: "the provider URL has no host".to_string() })?;
        let port = url.port_or_known_default().ok_or_else(|| ProviderError::Transport { detail: "the provider URL has no effective port".to_string() })?;
        let direct_ip = host.trim_start_matches('[').trim_end_matches(']').parse::<std::net::IpAddr>().ok();
        let mut candidates = if let Some(ip) = direct_ip {
            vec![SocketAddr::new(ip, port)]
        } else {
            let resolved = self.resolver.resolve(host, port).await.map_err(|error| ProviderError::Transport { detail: format!("DNS resolution failed: {error}") })?;
            resolved.into_iter().map(|address| SocketAddr::new(address.ip(), port)).collect::<Vec<_>>()
        };
        candidates.sort();
        candidates.dedup();
        if candidates.is_empty() {
            return Err(ProviderError::Transport { detail: "DNS resolution returned no candidates".to_string() });
        }
        match network_policy {
            "cloud" if candidates.iter().any(|address| security::is_non_public_ip(address.ip())) => {
                return Err(ProviderError::Transport { detail: "DNS resolution returned a non-public candidate".to_string() });
            }
            "local" if candidates.iter().any(|address| !security::is_loopback_host(&address.ip().to_string())) => {
                return Err(ProviderError::Transport { detail: "a local profile requires loopback candidates".to_string() });
            }
            "lan" if candidates.iter().any(|address| security::is_link_local_host(&address.ip().to_string())) => {
                return Err(ProviderError::Transport { detail: "a LAN profile must not use link-local candidates".to_string() });
            }
            _ => {}
        }
        let mut builder = Self::client_builder();
        if direct_ip.is_none() {
            builder = builder.resolve_to_addrs(host, &candidates);
        }
        builder.build().map_err(|error| ProviderError::Transport { detail: error.to_string() })
    }

    /// 获取接口公开模型目录（OpenAI `/models` / Anthropic `/models` / Ollama `/api/tags`）。
    pub fn fetch_models(&self, protocol: &str, base_url: &str, network_policy: &str, api_key: Option<&str>) -> Result<Vec<String>, String> {
        let trimmed = base_url.trim().trim_end_matches('/');
        if trimmed.is_empty() {
            return Err("请先填写接口地址（Base URL）".to_string());
        }
        let mut endpoints: Vec<String> = if protocol == "ollama" {
            let root = trimmed.strip_suffix("/v1").unwrap_or(trimmed);
            if trimmed.ends_with("/v1") {
                vec![format!("{trimmed}/models"), format!("{root}/api/tags")]
            } else {
                vec![format!("{root}/api/tags"), format!("{trimmed}/v1/models")]
            }
        } else {
            vec![format!("{trimmed}/models")]
        };
        endpoints.dedup();

        let key = api_key.map(str::trim).filter(|value| !value.is_empty()).map(str::to_string);
        let protocol_owned = protocol.to_string();
        let policy_owned = network_policy.to_string();

        drive(async move {
            let mut last_error = "未能从接口获取到任何可用模型".to_string();
            for endpoint in endpoints {
                let client = match self.client_for(&endpoint, &policy_owned).await {
                    Ok(client) => client,
                    Err(error) => {
                        last_error = error.message();
                        continue;
                    }
                };
                let mut builder = client.get(&endpoint).header("Accept", "application/json");
                if let Some(secret) = key.as_deref() {
                    if protocol_owned == "anthropic" {
                        builder = builder
                            .header("x-api-key", secret)
                            .header("anthropic-version", "2023-06-01");
                    } else {
                        builder = builder.header("Authorization", format!("Bearer {secret}"));
                    }
                }
                let response = match builder.send().await {
                    Ok(response) => response,
                    Err(error) => {
                        last_error = format!("请求模型列表失败：{}", describe(&error));
                        continue;
                    }
                };
                let status = response.status();
                if !status.is_success() {
                    last_error = match status.as_u16() {
                        401 => "认证失败（HTTP 401）：请检查 API Key 是否有效".to_string(),
                        403 => "无权限访问（HTTP 403）".to_string(),
                        404 => "该接口未提供 /models 列表端点（HTTP 404），请手动填写模型名".to_string(),
                        429 => "请求过于频繁（HTTP 429），请稍后重试".to_string(),
                        code => format!("服务返回 HTTP {code}"),
                    };
                    continue;
                }
                let bytes = match response.bytes().await {
                    Ok(bytes) => bytes,
                    Err(error) => {
                        last_error = format!("读取响应失败：{error}");
                        continue;
                    }
                };
                if bytes.len() > 2 * 1024 * 1024 {
                    last_error = "模型列表响应过大".to_string();
                    continue;
                }
                let json: serde_json::Value = match serde_json::from_slice(&bytes) {
                    Ok(value) => value,
                    Err(error) => {
                        last_error = format!("解析模型列表 JSON 失败：{error}");
                        continue;
                    }
                };
                let mut ids: Vec<String> = Vec::new();
                if let Some(items) = json.get("data").and_then(|v| v.as_array()).or_else(|| json.as_array()) {
                    for item in items {
                        if let Some(id) = item.get("id").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty()) {
                            ids.push(id.to_string());
                        }
                    }
                }
                if let Some(models) = json.get("models").and_then(|v| v.as_array()) {
                    for item in models {
                        if let Some(name) = item.get("name").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty()) {
                            ids.push(name.to_string());
                        }
                    }
                }
                ids.sort();
                ids.dedup();
                if !ids.is_empty() {
                    return Ok(ids);
                }
                last_error = "接口返回成功但模型列表为空，请手动填写模型名".to_string();
            }
            Err(last_error)
        })
        .unwrap_or_else(|error| Err(error))
    }
}

/// 在**当前线程**上建一个只跑一个 future 的运行时。
///
/// 为什么不用 `futures_util::executor::block_on`：它驱动的是 futures 自己的执行器，
/// 而 `reqwest` 需要一个 **tokio** 反应堆（否则在 connect 时 panic："no reactor running"）。
/// 为什么不用 `Handle::current().block_on`：在 tokio 工作线程上会 panic
///（"cannot block the current thread"）。这里的契约是"调用方在**自己的线程**上调用"，
/// 所以自己建一个运行时最直白，也不与调用方的运行时互相牵制。
fn drive<F: std::future::Future>(future: F) -> Result<F::Output, String> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("cannot initialize async runtime: {error}"))?;
    Ok(runtime.block_on(future))
}

impl Transport for HttpTransport {
    fn send(&self, request: &ProviderRequest, authorization: &[(String, String)], stop: &dyn Stop, on_update: &mut dyn FnMut(TransportUpdate)) -> Result<(), ProviderError> {
        let result = drive(async {
            let wait = stop.wait();
            tokio::pin!(wait);
            let client = tokio::select! {
                biased;
                () = &mut wait => return Ok(()),
                client = self.client_for(&request.endpoint, &request.network_policy) => client?,
            };
            let mut builder = client.post(&request.endpoint);
            for (name, value) in authorization {
                if !value.is_empty() {
                    builder = builder.header(name.as_str(), value.as_str());
                }
            }
            let builder = builder.json(&request.body);
            let response = tokio::select! {
                biased;
                () = &mut wait => return Ok(()),
                response = builder.send() => response.map_err(|error| ProviderError::Transport { detail: describe(&error) })?,
            };
            // **对端是谁**（2026-09-21 加，诊断用）。
            //
            // 为什么值得永久留在错误里：一次实测里，**同一个请求**在控制台（同一份 `HttpTransport`）
            // 拿到了 provider 的真实 JSON，而应用（GUI 进程）拿到一张 HTML `Request Blocked` 页 ——
            // 只看状态码根本分不出"是 provider 在拒绝"还是"有人在中间应答"。
            // 对端地址能把这两件事分开：打到 provider 的真实 IP，与打到本机/网关，是两种完全不同的事故。
            let peer = response.remote_addr().map_or_else(|| "unknown".to_string(), |address| address.to_string());
            let status = response.status().as_u16();
            if !response.status().is_success() {
                const MAX_ERROR_BODY_BYTES: usize = 4096;
                if response.content_length().is_some_and(|length| length > MAX_ERROR_BODY_BYTES as u64) {
                    return Err(ProviderError::Transport { detail: format!("the error response exceeded {MAX_ERROR_BODY_BYTES} bytes") });
                }
                let mut stream = response.bytes_stream();
                let mut body = Vec::new();
                loop {
                    let next = tokio::select! {
                        biased;
                        () = &mut wait => return Ok(()),
                        chunk = stream.next() => chunk,
                    };
                    let Some(chunk) = next else { break };
                    let bytes = chunk.map_err(|error| ProviderError::Transport { detail: error.to_string() })?;
                    if body.len().checked_add(bytes.len()).map_or(true, |length| length > MAX_ERROR_BODY_BYTES) {
                        return Err(ProviderError::Transport { detail: format!("the error response exceeded {MAX_ERROR_BODY_BYTES} bytes") });
                    }
                    body.extend_from_slice(&bytes);
                }
                let body = String::from_utf8_lossy(&body);
                let detail: String = body.chars().take(200).collect();
                let (failure, message) = classify_http_failure(status, Some(&detail));
                return Err(ProviderError::Http { status, failure, message: format!("[peer {peer}] {message}") });
            }

            let mut stream = response.bytes_stream();
            let mut total = 0usize;
            loop {
                // `biased`：取消优先于下一块。反过来的话，一块已经在路上的数据会先被处理，
                // 而那时用户已经按了停止。
                let next = tokio::select! {
                    biased;
                    () = &mut wait => None,
                    chunk = stream.next() => chunk,
                };
                let Some(chunk) = next else { break };
                let bytes = chunk.map_err(|error| ProviderError::Transport { detail: error.to_string() })?;
                total += bytes.len();
                if total > MAX_BODY_BYTES {
                    return Err(ProviderError::Transport { detail: format!("the response exceeded {MAX_BODY_BYTES} bytes") });
                }
                on_update(TransportUpdate::Body(bytes.to_vec()));
            }
            Ok(())
        })
        .map_err(|detail| ProviderError::Transport { detail })
        .and_then(|inner| inner);

        // 不管成功失败都要把"结束"交给上层：它据此 flush 剩下的半帧。
        on_update(TransportUpdate::End);
        result
    }
}

/**
 * **一次运行的完整流程**（命令线程那一层）：查配置 → 对修订号 → 借凭据发请求。
 *
 * ## 为什么它在这里，而不是在 Tauri 命令里
 *
 * 因为它**要能被测**。命令的签名里绑着 `tauri::AppHandle`，而造一个 AppHandle
 * 需要真的起一个 Tauri 应用 —— 于是"缺密钥要说清楚""修订号不符要当场拒"
 * 这几条判据就只能靠手点。抽成一个收 `impl SecretSource` 的函数之后，
 * 它们用内存凭据库就能确定性跑。
 *
 * 命令本身剩下的事只有三件：从托管状态里取 store、调这个函数、把事件交出去。
 */
// 八个参数触发了 clippy 的 `too_many_arguments`（阈值 7）。**不打包成结构体**是刻意的：
// 调用点只有两个（`provider_run` 与测试），而扁平签名里每个参数名本身就是文档 ——
// 打包之后读起来反而要来回跳。`provider_run` / `put_attachment` 出于同一个理由也带这条 allow。
#[allow(clippy::too_many_arguments)]
pub fn run_with_profile<S: SecretSource + ?Sized>(
    secrets: &S,
    transport: &dyn Transport,
    profile: ProviderProfile,
    expected_revision: u32,
    messages: Vec<ChatMessage>,
    stream: bool,
    options: RequestOptions,
    stop: &dyn Stop,
) -> Result<SendOutcome, ProviderError> {
    // **先对修订号，再碰密钥**：用一份界面已经看不到的配置发请求，
    // 就算成功了也没法解释结果（模型、端点、方言都可能已经变了）。
    if profile.revision != expected_revision {
        return Err(ProviderError::RevisionMismatch { expected: expected_revision, actual: profile.revision });
    }
    // `options` 是**透明传下去**的：允许发工具表与否由调用方按已验证证据决定
    //（`allow_tools`），这一层不替它猜，也不替它放宽。
    ProviderAdapter::new(secrets, transport, profile).send_with(messages, stream, options, stop)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn run_stream_decodes_crlf_sse_frames_across_chunks() {
        let mut stream = RunStream::new("openai", true);
        let payload = concat!(
            "data: {\"model\":\"deepseek-chat\",\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\r\n\r\n",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"c1\",\"function\":{\"name\":\"construct_point\",\"arguments\":\"{\\\"id\\\":\\\"P\\\"\"}}]}}]}\r\n",
            "\r\n",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\",\\\"x\\\":0,\\\"y\\\":0}\"}}]},\"finish_reason\":\"tool_calls\"}]}\r\n\r\n",
            "data: [DONE]\r\n\r\n"
        );
        // Feed in small chunks cutting straight through \r\n\r\n and JSON tokens.
        for chunk in payload.as_bytes().chunks(17) {
            stream.feed(chunk);
        }
        stream.flush();
        let events = stream.take();
        assert!(events.iter().any(|event| matches!(event, ModelEvent::Delta { text } if text == "hi")));
        assert!(events.iter().any(|event| matches!(
            event,
            ModelEvent::ToolCall { tool_call_id, tool_id, input }
                if tool_call_id == "c1" && tool_id == "construct_point" && input == &json!({ "id": "P", "x": 0, "y": 0 })
        )));
        assert!(!events.iter().any(|event| matches!(event, ModelEvent::Failed { .. })));
    }
}
