//! **归一化模型事件**（Task 1.4）。
//!
//! 与 `packages/agent-core/src/modelEvents.ts` **逐字对应**：同一个词汇、同一套判据。
//! 为什么要写两遍而不是只写一遍：归一化发生在 **Rust 侧**（密钥不能到前端来，
//! 所以流也必须由 Rust 读），而**重试策略在前端/协调器侧**决定 ——
//! 两边都要认识这套词汇。类型上的重复是刻意的，判据上的分叉是**测试要盯的**
//!（`tests/providers.rs` 会逐条核对分类与可重试性）。

use serde::{Deserialize, Serialize};

/// 失败分类。**重试策略读它，不读 HTTP 状态码。**
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureKind {
    Transport,
    RateLimited,
    ServerError,
    Auth,
    Permission,
    MalformedOutput,
    Cancelled,
    Unknown,
}

impl FailureKind {
    /// 能不能自动重试。计划 Task 2.3："Retry only transport 429/5xx/connectivity within the
    /// shared budget; **never retry auth, geometry, permission, or contradictory-fact failures
    /// automatically**."
    pub fn retryable(self) -> bool {
        matches!(self, FailureKind::Transport | FailureKind::RateLimited | FailureKind::ServerError)
    }
}

/// 一次尝试的身份。**每个事件都带**（计划逐字要求 `requestId` + `attemptId`）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EventIds {
    pub request_id: String,
    pub attempt_id: String,
}

/// provider 给的、**不能被当成内容**的附加信息（推理字段、限流提示、结束原因）。
pub type Metadata = std::collections::BTreeMap<String, String>;

/// 归一化事件。`camelCase` 序列化给前端（与 TS 侧同名）。
#[derive(Debug, Clone, PartialEq)]
pub enum ModelEvent {
    Started { model: String, metadata: Metadata },
    Delta { text: String },
    ToolCall { tool_call_id: String, tool_id: String, input: serde_json::Value },
    Usage { input_tokens: Option<u64>, output_tokens: Option<u64> },
    Completed { stop_reason: Option<String> },
    Failed { failure: FailureKind, message: String, retryable: bool, metadata: Metadata },
}

impl ModelEvent {
    pub fn kind(&self) -> &'static str {
        match self {
            ModelEvent::Started { .. } => "started",
            ModelEvent::Delta { .. } => "delta",
            ModelEvent::ToolCall { .. } => "tool_call",
            ModelEvent::Usage { .. } => "usage",
            ModelEvent::Completed { .. } => "completed",
            ModelEvent::Failed { .. } => "failed",
        }
    }

    /// 造一个失败事件。`retryable` 由分类决定 —— **调用方不许自己填**（那样会分叉）。
    pub fn failed(failure: FailureKind, message: impl Into<String>) -> Self {
        ModelEvent::Failed { failure, message: message.into().chars().take(512).collect(), retryable: failure.retryable(), metadata: Metadata::new() }
    }

    /// 转成前端认的 JSON 形状（带 `requestId` / `attemptId` / `kind`）。
    pub fn to_json(&self, ids: &EventIds) -> serde_json::Value {
        let mut value = self.to_json_plain();
        let object = value.as_object_mut().expect("object");
        object.insert("requestId".into(), serde_json::json!(ids.request_id));
        object.insert("attemptId".into(), serde_json::json!(ids.attempt_id));
        value
    }

    /**
     * 转成前端认的 JSON 形状，**不带身份**。
     *
     * 身份（`requestId` / `attemptId`）由**协调器**决定，而不是由适配器决定：
     * 一次请求可能重试若干次，每次尝试的身份只有协调器知道。适配器只回答
     * "provider 说了什么"，所以它产出的形状里没有这两项。
     */
    pub fn to_json_plain(&self) -> serde_json::Value {
        let mut value = serde_json::json!({ "kind": self.kind() });
        let object = value.as_object_mut().expect("object");
        match self {
            ModelEvent::Started { model, metadata } => {
                object.insert("model".into(), serde_json::json!(model));
                if !metadata.is_empty() {
                    object.insert("metadata".into(), serde_json::json!(metadata));
                }
            }
            ModelEvent::Delta { text } => {
                object.insert("text".into(), serde_json::json!(text));
            }
            ModelEvent::ToolCall { tool_call_id, tool_id, input } => {
                object.insert("toolCallId".into(), serde_json::json!(tool_call_id));
                object.insert("toolId".into(), serde_json::json!(tool_id));
                object.insert("input".into(), input.clone());
            }
            ModelEvent::Usage { input_tokens, output_tokens } => {
                object.insert("inputTokens".into(), serde_json::json!(input_tokens));
                object.insert("outputTokens".into(), serde_json::json!(output_tokens));
            }
            ModelEvent::Completed { stop_reason } => {
                object.insert("stopReason".into(), serde_json::json!(stop_reason));
            }
            ModelEvent::Failed { failure, message, retryable, metadata } => {
                object.insert("failure".into(), serde_json::json!(failure));
                object.insert("message".into(), serde_json::json!(message));
                object.insert("retryable".into(), serde_json::json!(retryable));
                if !metadata.is_empty() {
                    object.insert("metadata".into(), serde_json::json!(metadata));
                }
            }
        }
        value
    }
}

/// **把 HTTP 状态码与响应体变成失败分类**（三家 provider 共用一套语义）。
///
/// 只此一处：每个适配器各写一遍必然分叉，而分叉的后果是"换一家 provider，重试策略就变了"。
pub fn classify_http_failure(status: u16, body: Option<&str>) -> (FailureKind, String) {
    let detail: String = body.unwrap_or("").chars().take(200).collect();
    let suffix = if detail.is_empty() { String::new() } else { format!(": {detail}") };
    match status {
        401 => (FailureKind::Auth, format!("the provider rejected the credential (401){suffix}")),
        403 => (FailureKind::Permission, format!("the provider refused the request (403){suffix}")),
        429 => (FailureKind::RateLimited, format!("the provider is rate limiting (429){suffix}")),
        500..=599 => (FailureKind::ServerError, format!("the provider failed ({status}){suffix}")),
        _ => (FailureKind::Unknown, format!("the provider returned {status}{suffix}")),
    }
}

/// **一行 SSE 的解析结果**。
#[derive(Debug, Clone, PartialEq)]
pub enum SseLine {
    /// `data: …` —— 一块数据。
    Data(String),
    /// `[DONE]`（OpenAI 兼容流的结束标记）。
    Done,
    /// `event: …` —— 有些 provider 用命名事件（Anthropic 的 `content_block_delta` 等）。
    Event(String),
    /// 空行 / 注释 / 我们不关心的字段。
    Ignore,
}

/// 解析一行 SSE。**不猜、不拼**：只认它认识的三类前缀。
///
/// 为什么不用一个 SSE 库：这个格式在这里只用到三个前缀，而"多一个依赖"意味着
/// 多一份需要跟着升级的东西；更重要的是**解析结果要是纯数据**，
/// 这样它能在 fixtures 上逐条测（`tests/providers.rs`）。
pub fn parse_sse_line(line: &str) -> SseLine {
    let trimmed = line.trim_end_matches(['\r', '\n']);
    // SSE 注释（`:` 开头）是保活用的，不含数据。
    if trimmed.is_empty() || trimmed.starts_with(':') {
        return SseLine::Ignore;
    }
    if let Some(rest) = trimmed.strip_prefix("data:") {
        let payload = rest.trim_start();
        return if payload == "[DONE]" { SseLine::Done } else { SseLine::Data(payload.to_string()) };
    }
    if let Some(rest) = trimmed.strip_prefix("event:") {
        return SseLine::Event(rest.trim().to_string());
    }
    SseLine::Ignore
}

/// 把一段可能是"累计式"也可能是"增量式"的流拆成块。
///
/// 为什么要处理两种：OpenAI 兼容与 Anthropic 都给**增量**（每块只有新增的字），
/// 而某些兼容实现（以及非流式响应）给**累计**全量文本。直接拼接会在后者上
/// 出现"重复很多遍"的经典故障 —— 所以这里**只做拆分，不做合并判断**，
/// 由调用方按 `mode` 决定（`append` / `replace`）。
pub fn split_stream_frames(body: &str) -> Vec<String> {
    body.split("\n\n").map(|frame| frame.trim().to_string()).filter(|frame| !frame.is_empty()).collect()
}
