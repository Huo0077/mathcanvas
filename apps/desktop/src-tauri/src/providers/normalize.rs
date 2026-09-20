//! **把 provider 的响应归一化成 `ModelEvent`**（Task 1.4 Step 3/4）。
//!
//! 三家的形状差别就在这里被吃掉：
//!
//! | | 增量文本在哪 | 工具调用在哪 | 用量在哪 | 结束标记 |
//! | --- | --- | --- | --- | --- |
//! | OpenAI 兼容 | `choices[0].delta.content` | `choices[0].delta.tool_calls[]` | `usage` | `[DONE]` |
//! | Anthropic | `content_block_delta.delta.text` | `content_block_start`(tool_use) + `input_json_delta` | `message_delta.usage` | `message_stop` |
//! | Ollama | `message.content`（一行一个完整 JSON） | `message.tool_calls[]` | `prompt_eval_count` / `eval_count` | `done: true` |
//!
//! ## 三条纪律
//!
//! 1. **`reasoning` 只作诊断元数据**（计划 Step 4 原文）。它进 `metadata`，
//!    **绝不**拼进 `Delta.text` —— 那会让模型的自述文本变成"内容"。
//! 2. **畸形 JSON 是 `MalformedOutput` 而不是 panic**。流里出现半截 JSON 是常态
//!    （网络切断），而"进程崩了"与"这一块没解析出来"是完全不同的两件事。
//! 3. **`[DONE]` / `message_stop` / `done:true` 都要认**。漏认一家就会让 UI 一直转圈。

use serde_json::Value;

use super::events::{EventIds, FailureKind, Metadata, ModelEvent};

/// 一段流里解析出来的东西：事件 + 可选的新 stop reason。
pub struct Normalized {
    pub events: Vec<ModelEvent>,
}

fn metadata(entries: Vec<(&str, String)>) -> Metadata {
    entries.into_iter().map(|(key, value)| (key.to_string(), value)).collect()
}

/// 从 JSON 里取一个数字字段（`u64`），取不到就是 `None`。
fn number(value: &Value, key: &str) -> Option<u64> {
    value.get(key).and_then(Value::as_u64)
}

/// 从 JSON 里取一个字符串字段。
fn text(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_str().map(str::to_string)
}

/**
 * **OpenAI 兼容**的一段数据。
 *
 * 支持两种形状（都真实存在）：
 * - 流式增量：`choices[0].delta.content`；
 * - 非流式全量：`choices[0].message.content`（有些网关对 `stream:true` 也这么回）。
 *   两者都认，是因为**认错一种就会得到空回答**，而空回答看起来像"模型没说话"。
 */
pub fn openai_chunk(payload: &Value) -> Normalized {
    let mut events = Vec::new();

    if let Some(model) = payload.get("model").and_then(Value::as_str) {
        events.push(ModelEvent::Started { model: model.to_string(), metadata: Metadata::new() });
    }

    if let Some(usage) = payload.get("usage").filter(|value| !value.is_null()) {
        events.push(ModelEvent::Usage { input_tokens: number(usage, "prompt_tokens"), output_tokens: number(usage, "completion_tokens") });
    }

    let choice = payload.get("choices").and_then(|value| value.get(0));
    if let Some(choice) = choice {
        if let Some(content) = text(choice, &["delta", "content"]).or_else(|| text(choice, &["message", "content"])) {
            if !content.is_empty() {
                events.push(ModelEvent::Delta { text: content });
            }
        }
        // DeepSeek / 一些网关把推理内容单独放在这里。**只进元数据**。
        if let Some(reasoning) = text(choice, &["delta", "reasoning_content"]).or_else(|| text(choice, &["delta", "reasoning"])) {
            events.push(ModelEvent::Started { model: String::new(), metadata: metadata(vec![("reasoning", reasoning)]) });
        }
        if let Some(calls) = choice.get("delta").and_then(|delta| delta.get("tool_calls")).and_then(Value::as_array) {
            for (index, call) in calls.iter().enumerate() {
                let id = call.get("id").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| format!("tool-call-{index}"));
                let name = text(call, &["function", "name"]).unwrap_or_default();
                // 参数是**字符串里的 JSON**（OpenAI 的形状）；解析失败就原样当字符串传下去，
                // 而不是丢掉 —— 丢掉会让"模型想调工具"变成"模型什么都没说"。
                let arguments = text(call, &["function", "arguments"]).unwrap_or_default();
                let input = serde_json::from_str::<Value>(&arguments).unwrap_or(Value::String(arguments));
                events.push(ModelEvent::ToolCall { tool_call_id: id, tool_id: name, input });
            }
        }
        if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
            events.push(ModelEvent::Completed { stop_reason: Some(reason.to_string()) });
        }
    }

    Normalized { events }
}

/**
 * **Anthropic Messages** 的一段数据。
 *
 * 事件名来自 SSE 的 `event:` 行（`content_block_delta` / `message_delta` / `message_stop` …），
 * 而内容在 `data:` 行里。这里按"事件名 + 数据"一起判断：只看数据会认不出
 * `content_block_delta` 与 `content_block_start` 的区别（前者是增量、后者是块的开头）。
 */
pub fn anthropic_chunk(event: Option<&str>, payload: &Value) -> Normalized {
    let mut events = Vec::new();
    let kind = event.or_else(|| payload.get("type").and_then(Value::as_str)).unwrap_or("");

    match kind {
        "message_start" => {
            let model = text(payload, &["message", "model"]).unwrap_or_default();
            events.push(ModelEvent::Started { model, metadata: Metadata::new() });
            if let Some(usage) = payload.get("message").and_then(|message| message.get("usage")) {
                events.push(ModelEvent::Usage { input_tokens: number(usage, "input_tokens"), output_tokens: number(usage, "output_tokens") });
            }
        }
        "content_block_start" => {
            // 工具调用在 Anthropic 里是"一个 tool_use 块"：名字在这里，参数在后面的增量里。
            if let Some(block) = payload.get("content_block") {
                if block.get("type").and_then(Value::as_str) == Some("tool_use") {
                    let id = block.get("id").and_then(Value::as_str).unwrap_or("tool-use").to_string();
                    let name = block.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
                    events.push(ModelEvent::ToolCall { tool_call_id: id, tool_id: name, input: block.get("input").cloned().unwrap_or(Value::Null) });
                }
            }
        }
        "content_block_delta" => {
            if let Some(delta) = payload.get("delta") {
                match delta.get("type").and_then(Value::as_str) {
                    Some("text_delta") => {
                        if let Some(content) = delta.get("text").and_then(Value::as_str) {
                            if !content.is_empty() {
                                events.push(ModelEvent::Delta { text: content.to_string() });
                            }
                        }
                    }
                    // 工具参数是**分片**来的（`input_json_delta`）；这里如实标成元数据，
                    // 而不是把半截 JSON 当参数用 —— 半截 JSON 会解析失败并让整次调用作废。
                    Some("thinking_delta") => {
                        if let Some(thinking) = delta.get("thinking").and_then(Value::as_str) {
                            events.push(ModelEvent::Started { model: String::new(), metadata: metadata(vec![("reasoning", thinking.to_string())]) });
                        }
                    }
                    _ => {}
                }
            }
        }
        "message_delta" => {
            if let Some(usage) = payload.get("usage") {
                events.push(ModelEvent::Usage { input_tokens: number(usage, "input_tokens"), output_tokens: number(usage, "output_tokens") });
            }
            if let Some(reason) = text(payload, &["delta", "stop_reason"]) {
                events.push(ModelEvent::Completed { stop_reason: Some(reason) });
            }
        }
        "message_stop" => {
            events.push(ModelEvent::Completed { stop_reason: None });
        }
        "error" => {
            let message = text(payload, &["error", "message"]).unwrap_or_else(|| "the provider reported an error".to_string());
            events.push(ModelEvent::failed(FailureKind::Unknown, message));
        }
        _ => {}
    }

    Normalized { events }
}

/**
 * **Ollama 原生**的一行 JSON。
 *
 * Ollama 的形状最简单：一行一个完整 JSON，`done: true` 收尾，用量在
 * `prompt_eval_count` / `eval_count`。
 */
pub fn ollama_line(payload: &Value) -> Normalized {
    let mut events = Vec::new();

    if let Some(model) = payload.get("model").and_then(Value::as_str) {
        events.push(ModelEvent::Started { model: model.to_string(), metadata: Metadata::new() });
    }

    if let Some(message) = payload.get("message") {
        if let Some(content) = message.get("content").and_then(Value::as_str) {
            if !content.is_empty() {
                events.push(ModelEvent::Delta { text: content.to_string() });
            }
        }
        if let Some(thinking) = message.get("thinking").and_then(Value::as_str) {
            events.push(ModelEvent::Started { model: String::new(), metadata: metadata(vec![("reasoning", thinking.to_string())]) });
        }
        if let Some(calls) = message.get("tool_calls").and_then(Value::as_array) {
            for (index, call) in calls.iter().enumerate() {
                let function = call.get("function").cloned().unwrap_or(Value::Null);
                let name = function.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
                let input = function.get("arguments").cloned().unwrap_or(Value::Null);
                events.push(ModelEvent::ToolCall { tool_call_id: format!("ollama-tool-{index}"), tool_id: name, input });
            }
        }
    }

    if payload.get("done").and_then(Value::as_bool) == Some(true) {
        let input_tokens = number(payload, "prompt_eval_count");
        let output_tokens = number(payload, "eval_count");
        if input_tokens.is_some() || output_tokens.is_some() {
            events.push(ModelEvent::Usage { input_tokens, output_tokens });
        }
        events.push(ModelEvent::Completed { stop_reason: payload.get("done_reason").and_then(Value::as_str).map(str::to_string) });
    }

    Normalized { events }
}

/// **按协议解释一整段响应体**。
///
/// `stream` 为真时按 SSE 拆帧（`data:` 行），否则按整份 JSON 解释。
/// 两种都走同一批 `*_chunk` 函数 —— 因为"流式与非流式的形状差异"已经在那些函数里吃掉了。
pub fn normalize_response(protocol: &str, body: &str, stream: bool) -> Vec<ModelEvent> {
    let mut events = Vec::new();

    // **Ollama 原生不是 SSE**：它一行一个完整 JSON（NDJSON），没有 `data:` 前缀。
    //
    // 第一版把三家都按 SSE 处理，于是 Ollama 的 fixtures **一行事件都解析不出来** ——
    // 而"没有事件"在界面上表现为"模型什么都没说"，看起来像模型的问题。
    // 这条分支就是那次失败的落点：协议不同就要按不同格式拆。
    if protocol == "ollama" {
        for line in body.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            match serde_json::from_str::<Value>(trimmed) {
                Ok(parsed) => events.extend(ollama_line(&parsed).events),
                // 畸形 JSON 不是 panic（见下面 SSE 分支的同一条理由）。
                Err(error) => events.push(ModelEvent::failed(FailureKind::MalformedOutput, format!("the stream contained invalid JSON: {error}"))),
            }
        }
        return events;
    }

    if stream {
        let mut current_event: Option<String> = None;
        for line in body.lines() {
            match super::events::parse_sse_line(line) {
                super::events::SseLine::Event(name) => current_event = Some(name),
                super::events::SseLine::Done => {
                    current_event = None;
                }
                super::events::SseLine::Data(payload) => {
                    let parsed = match serde_json::from_str::<Value>(&payload) {
                        Ok(value) => value,
                        // **畸形 JSON 不是 panic**：网络切断时半截数据是常态，
                        // 而"进程崩了"与"这一块没解析出来"是完全不同的两件事。
                        Err(error) => {
                            events.push(ModelEvent::failed(FailureKind::MalformedOutput, format!("the stream contained invalid JSON: {error}")));
                            current_event = None;
                            continue;
                        }
                    };
                    let normalized = match protocol {
                        "anthropic" => anthropic_chunk(current_event.as_deref(), &parsed),
                        "ollama" => ollama_line(&parsed),
                        _ => openai_chunk(&parsed),
                    };
                    events.extend(normalized.events);
                    current_event = None;
                }
                super::events::SseLine::Ignore => {}
            }
        }
        return events;
    }

    match serde_json::from_str::<Value>(body) {
        Ok(parsed) => {
            let normalized = match protocol {
                "anthropic" => anthropic_chunk(None, &parsed),
                "ollama" => ollama_line(&parsed),
                _ => openai_chunk(&parsed),
            };
            events.extend(normalized.events);
        }
        Err(error) => events.push(ModelEvent::failed(FailureKind::MalformedOutput, format!("the response was not valid JSON: {error}"))),
    }
    events
}

/// **给前端用的一次解释**：带上 `requestId` / `attemptId`。
pub fn normalize_to_json(protocol: &str, body: &str, stream: bool, ids: &EventIds) -> Vec<Value> {
    normalize_response(protocol, body, stream).iter().map(|event| event.to_json(ids)).collect()
}
