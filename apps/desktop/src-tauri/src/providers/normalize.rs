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
        // 工具调用**不在这里发**：OpenAI 兼容流式把 `function.arguments` 拆成多帧，
        // 每帧只是一段字符串。它们由 `ToolCallAccumulator` 攒起来，在流结束时一次发出。
        // （旧实现按"一帧一次调用"发事件，于是把半截 JSON 当字符串交给上层，上层的信封校验
        //  只能报一句 `invalid_type@envelope` —— 见 `ToolCallAccumulator` 的说明。）
        if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
            events.push(ModelEvent::Completed { stop_reason: Some(reason.to_string()) });
        }
    }

    Normalized { events }
}

/// **攒 OpenAI 兼容的工具调用分片**。
///
/// ## 为什么必须攒（真实缺陷，2026-09-22 用户现场）
///
/// 这个协议里 `tool_calls[].function.arguments` 是**跨帧**送来的：第一帧通常只有
/// `{"schemaVersion":"math…`，后面几帧接着补齐。旧实现按"收到一帧就当成一次完整调用"处理，
/// 于是每一片都被 `serde_json::from_str` 判为非法 JSON，再按"别丢掉"的规矩**原样当成字符串**
/// 发下去 —— 上层的信封校验看到 `input` 是一个字符串，报 `invalid_type@envelope`，
/// 用户界面上就只有这一句内部码，谁也看不出模型到底回了什么。
///
/// 唯一那条 fixture（`openai-tool-call.sse`）把整份 arguments 放在**一帧**里，
/// 所以真实流式（分片）从来没被测过 —— 这就是它一直没被发现的原因。
///
/// ## 判据
///
/// 用协议自己给的 `index` 当键（同一个 `index` 的分片属于同一次调用），`id` / `name` 取第一个非空值，
/// `arguments` 直接拼接。攒好的调用由调用方在**流结束时**取走（`drain`）—— 这里不发中间事件，
/// 因为"半次调用"没有任何可用的形状。
#[derive(Default)]
pub struct ToolCallAccumulator {
    calls: Vec<PartialToolCall>,
}

#[derive(Default)]
struct PartialToolCall {
    index: u64,
    id: Option<String>,
    name: String,
    arguments: String,
}

impl ToolCallAccumulator {
    /// 吃掉一帧（或一整份非流式正文）里的工具调用；返回是否吃到了。
    ///
    /// 返回 `true` 时调用方**不该**再按"一次调用"解释这一帧 —— 它只是一段分片。
    pub fn absorb(&mut self, payload: &Value) -> bool {
        let Some(choice) = payload.get("choices").and_then(|value| value.get(0)) else { return false };
        // 流式是 `delta.tool_calls`；非流式全量是 `message.tool_calls`。两种都真实存在。
        let streaming = choice.get("delta").and_then(|delta| delta.get("tool_calls")).and_then(Value::as_array);
        let whole = choice.get("message").and_then(|message| message.get("tool_calls")).and_then(Value::as_array);
        let Some(calls) = streaming.or(whole) else { return false };

        for call in calls {
            // 非流式的 `tool_calls` 里没有 `index`（每一次调用各自独立），用已有条数当键即可。
            let index = call.get("index").and_then(Value::as_u64).unwrap_or(self.calls.len() as u64);
            if !self.calls.iter().any(|entry| entry.index == index) {
                self.calls.push(PartialToolCall { index, ..PartialToolCall::default() });
            }
            let Some(entry) = self.calls.iter_mut().find(|entry| entry.index == index) else { continue };

            if let Some(id) = call.get("id").and_then(Value::as_str).filter(|id| !id.is_empty()) {
                entry.id.get_or_insert_with(|| id.to_string());
            }
            if entry.name.is_empty() {
                if let Some(name) = text(call, &["function", "name"]).filter(|name| !name.is_empty()) {
                    entry.name = name;
                }
            }
            match call.get("function").and_then(|function| function.get("arguments")) {
                // 字符串形态：一段分片（OpenAI / DeepSeek 的流式就是这样）。
                Some(Value::String(fragment)) => entry.arguments.push_str(fragment),
                // 对象形态（有些网关直接把参数当对象发）：它已经是完整的，直接序列化留用。
                Some(other) if !other.is_null() => entry.arguments = other.to_string(),
                _ => {}
            }
        }
        true
    }

    /// 流结束：把攒好的调用**一次**发出来（参数解析成对象）。
    pub fn drain(&mut self) -> Vec<ModelEvent> {
        std::mem::take(&mut self.calls)
            .into_iter()
            .enumerate()
            .map(|(position, call)| {
                let id = call.id.unwrap_or_else(|| format!("tool-call-{position}"));
                // 拼完之后**仍然**不是合法 JSON（流被截断，或者服务本身就发了坏参数）就原样当字符串 ——
                // 丢掉会让"模型想调工具"变成"模型什么都没说"。
                let input = serde_json::from_str::<Value>(&call.arguments).unwrap_or(Value::String(call.arguments));
                ModelEvent::ToolCall { tool_call_id: id, tool_id: call.name, input }
            })
            .collect()
    }
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
///
/// `event` 是 SSE 的 `event:` 行（Anthropic 用它区分 `content_block_delta`
/// 与 `content_block_start`）。传 `None` 时退到 payload 里的 `type` 字段 ——
/// 两条路都要留，因为有的实现只给其中一个。
/// 一次性解释一整份正文（测试与非增量调用方）。
///
/// 工具调用在**这一份的最后**取走（`drain`）。增量调用方（`providers::adapter` 的 `RunStream`）
/// 必须改用 `normalize_response_with` 并把它自己的累加器传进来 —— 否则跨帧分片永远拼不起来。
pub fn normalize_response(protocol: &str, body: &str, event: Option<&str>, stream: bool) -> Vec<ModelEvent> {
    let mut tool_calls = ToolCallAccumulator::default();
    let mut events = normalize_response_with(protocol, body, event, stream, &mut tool_calls);
    events.extend(tool_calls.drain());
    events
}

/// 与 `normalize_response` 同一件事，但**工具调用的累加器由调用方持有**（于是能跨帧攒分片）。
pub fn normalize_response_with(protocol: &str, body: &str, event: Option<&str>, stream: bool, tool_calls: &mut ToolCallAccumulator) -> Vec<ModelEvent> {
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
        let mut current_event: Option<String> = event.map(str::to_string);
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
                        // OpenAI 兼容：工具调用的参数是**跨帧分片**，先攒着（见 `ToolCallAccumulator`）。
                        _ => {
                            tool_calls.absorb(&parsed);
                            openai_chunk(&parsed)
                        }
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
                "anthropic" => anthropic_chunk(event, &parsed),
                "ollama" => ollama_line(&parsed),
                // 非流式全量里的 `message.tool_calls` 同样交给累加器（整份一次，攒完照样成立）。
                _ => {
                    tool_calls.absorb(&parsed);
                    openai_chunk(&parsed)
                }
            };
            events.extend(normalized.events);
        }
        Err(error) => events.push(ModelEvent::failed(FailureKind::MalformedOutput, format!("the response was not valid JSON: {error}"))),
    }
    events
}

/**
 * 从一帧 SSE 里取出 `event:` 行的值。
 *
 * ## 为什么要单独一个函数（而不是让归一化器自己扫）
 *
 * 因为**增量解码**发生在 `providers::adapter` 里：它按 `\n\n` 拆帧，然后要么把整帧
 * 交给 `normalize_response`（那里会自己扫 `event:` 行），要么把帧拆成
 * "名字 + 数据"两半再交。两种用法都要成立，所以"怎么取名字"这件事只有一处实现。
 */
pub fn sse_event_name(frame: &str) -> Option<String> {
    frame.lines().find_map(|line| line.trim().strip_prefix("event:").map(|rest| rest.trim().to_string()))
}

/// 去掉一帧里的 `event:` 行，只留 `data:` 那部分。SSE 的其它字段（`id:` / `retry:`）一律忽略。
pub fn strip_sse_event_lines(frame: &str) -> String {
    frame.lines().filter(|line| !line.trim_start().starts_with("event:")).collect::<Vec<_>>().join("\n")
}


/// **给前端用的一次解释**：带上 `requestId` / `attemptId`。
///
/// 参数顺序与 `normalize_response` **逐字一致** —— 两个函数做的是同一件事，
/// 只是这一个多带一份身份。顺序不一致会让"复制粘贴一个调用再改名字"变成一次静默的错位。
pub fn normalize_to_json(protocol: &str, body: &str, event: Option<&str>, stream: bool, ids: &EventIds) -> Vec<Value> {
    normalize_response(protocol, body, event, stream).iter().map(|event| event.to_json(ids)).collect()
}
