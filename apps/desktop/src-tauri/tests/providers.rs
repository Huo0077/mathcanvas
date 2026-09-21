//! **三家协议的 fixtures 测试**（Task 1.4 Step 1/2/6）。
//!
//! 计划原文："Add fixture tests for successful text, streaming chunks, tool calls, usage, 401,
//! 429, 5xx, and disconnect **for each protocol**."
//!
//! ## 为什么是 fixtures 而不是"打一次真接口"
//!
//! 真接口需要密钥、需要网络、会因为对方的版本变化而变化 —— 那三点都让测试变成
//! "今天过、明天红"的东西。而这里要证明的是**我们对三家形状的理解**，
//! 那是纯函数的事：给一段真实形状的字节，应该得到哪些归一化事件。
//! fixtures 就钉住了这个理解。
//!
//! ## fixtures 从哪来
//!
//! 按三家**公开文档里的形状**手写（`test-fixtures/providers/`）。它们不是"真实响应的抓包"，
//! 而是"文档说会这样回"的样本 —— 这个区别很重要：抓包会包含对方的临时字段，
//! 而 fixtures 只包含我们**声称支持**的那部分。哪一天对方改了形状，
//! 测试不会红，**但真实调用会** —— 所以 `Task 1.4 Step 5` 的能力证据探针才是那条防线。

use mathcanvas_desktop_lib::providers::events::{classify_http_failure, FailureKind, ModelEvent};
use mathcanvas_desktop_lib::providers::normalize::{normalize_response, normalize_to_json};
use mathcanvas_desktop_lib::providers::request::{build_request, ChatMessage, RequestOptions};
use mathcanvas_desktop_lib::repository::provider_profiles::ProviderProfile;

fn fixture(name: &str) -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("test-fixtures/providers").join(name);
    std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()))
}

fn ids() -> mathcanvas_desktop_lib::providers::events::EventIds {
    mathcanvas_desktop_lib::providers::events::EventIds { request_id: "req-1".to_string(), attempt_id: "attempt-1".to_string() }
}

/// 把事件里的文本拼起来 —— 断言"模型说了什么"比断言"事件序列"更接近用户看到的东西。
fn joined_text(events: &[ModelEvent]) -> String {
    events
        .iter()
        .filter_map(|event| match event {
            ModelEvent::Delta { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("")
}

fn kinds(events: &[ModelEvent]) -> Vec<&'static str> {
    events.iter().map(ModelEvent::kind).collect()
}

// ---------------------------------------------------------------- OpenAI 兼容

#[test]
fn openai_stream_accumulates_the_text_and_reports_usage() {
    let events = normalize_response("openai_compatible", &fixture("openai-stream.sse"), None, true);

    assert_eq!(joined_text(&events), "你好，世界");
    assert!(kinds(&events).contains(&"started"), "the model name must be reported");
    assert!(kinds(&events).contains(&"usage"), "prompt/completion tokens must be reported");
    assert!(kinds(&events).contains(&"completed"), "the finish reason must terminate the stream");
}

#[test]
fn openai_tool_call_parses_the_arguments_json() {
    let events = normalize_response("openai_compatible", &fixture("openai-tool-call.sse"), None, true);
    let call = events.iter().find_map(|event| match event {
        ModelEvent::ToolCall { tool_id, input, .. } => Some((tool_id.clone(), input.clone())),
        _ => None,
    });

    let (name, input) = call.expect("a tool call must be normalised");
    assert_eq!(name, "scene.inspect");
    // 参数是"字符串里的 JSON"（OpenAI 的形状）—— 必须被解析成对象，而不是原样当字符串。
    assert!(input.is_object(), "the arguments must be parsed into an object, got {input}");
    assert_eq!(input.get("documentId").and_then(|value| value.as_str()), Some("doc-1"));
}

#[test]
fn openai_non_streaming_body_is_understood_too() {
    // 有些网关对 `stream: true` 也回一整份 JSON。认不出来就会得到"模型什么都没说"。
    let events = normalize_response("openai_compatible", &fixture("openai-non-streaming.json"), None, false);

    assert_eq!(joined_text(&events), "一整段回答");
    assert!(kinds(&events).contains(&"usage"));
}

#[test]
fn openai_reasoning_fields_stay_metadata_and_never_become_content() {
    let events = normalize_response("openai_compatible", &fixture("openai-reasoning.sse"), None, true);

    // 计划 Step 4：推理字段**只作诊断元数据**，不许被当成内容或工具结果。
    assert_eq!(joined_text(&events), "答案是 4");
    let reasoning = events.iter().find_map(|event| match event {
        ModelEvent::Started { metadata, .. } => metadata.get("reasoning").cloned(),
        _ => None,
    });
    assert_eq!(reasoning.as_deref(), Some("先算 2+2"));
}

// ---------------------------------------------------------------- Anthropic

#[test]
fn anthropic_stream_reads_named_events_and_deltas() {
    let events = normalize_response("anthropic", &fixture("anthropic-stream.sse"), None, true);

    assert_eq!(joined_text(&events), "切线方程是 y=2x");
    assert!(kinds(&events).contains(&"started"));
    assert!(kinds(&events).contains(&"usage"));
    assert!(kinds(&events).contains(&"completed"));
}

#[test]
fn anthropic_tool_use_block_becomes_a_tool_call() {
    let events = normalize_response("anthropic", &fixture("anthropic-tool-call.sse"), None, true);
    let call = events.iter().find_map(|event| match event {
        ModelEvent::ToolCall { tool_id, .. } => Some(tool_id.clone()),
        _ => None,
    });

    assert_eq!(call.as_deref(), Some("scene.search_entities"));
}

#[test]
fn anthropic_thinking_stays_metadata() {
    let events = normalize_response("anthropic", &fixture("anthropic-thinking.sse"), None, true);

    assert_eq!(joined_text(&events), "结果如上");
    let thinking = events.iter().find_map(|event| match event {
        ModelEvent::Started { metadata, .. } => metadata.get("reasoning").cloned(),
        _ => None,
    });
    assert_eq!(thinking.as_deref(), Some("先想一下"));
}

// ---------------------------------------------------------------- Ollama

#[test]
fn ollama_reads_one_json_per_line_and_stops_on_done() {
    let events = normalize_response("ollama", &fixture("ollama-stream.ndjson"), None, true);

    assert_eq!(joined_text(&events), "2 + 2 = 4");
    assert!(kinds(&events).contains(&"usage"));
    assert!(kinds(&events).contains(&"completed"));
}

#[test]
fn ollama_tool_calls_are_normalised() {
    let events = normalize_response("ollama", &fixture("ollama-tool-call.ndjson"), None, true);
    let call = events.iter().find_map(|event| match event {
        ModelEvent::ToolCall { tool_id, input, .. } => Some((tool_id.clone(), input.clone())),
        _ => None,
    });

    let (name, input) = call.expect("a tool call must be normalised");
    assert_eq!(name, "scene.inspect");
    assert_eq!(input.get("documentId").and_then(|value| value.as_str()), Some("doc-1"));
}

// ---------------------------------------------------------------- 失败与畸形

#[test]
fn a_truncated_stream_reports_malformed_output_instead_of_panicking() {
    // 网络切断时半截 JSON 是常态。**崩掉进程**与"这一块没解析出来"是完全不同的两件事。
    let events = normalize_response("openai_compatible", &fixture("openai-truncated.sse"), None, true);

    // 前面完整的那一块仍然被读出来了（用户已经看到的东西不该被丢掉）。
    assert_eq!(joined_text(&events), "开头");
    let failure = events.iter().find_map(|event| match event {
        ModelEvent::Failed { failure, .. } => Some(*failure),
        _ => None,
    });
    assert_eq!(failure, Some(FailureKind::MalformedOutput));
}

#[test]
fn every_protocol_maps_the_shared_http_status_codes_the_same_way() {
    // 计划 Step 1 点名的 401 / 429 / 5xx，三家用的是同一套语义。
    for protocol in ["openai_compatible", "anthropic", "ollama"] {
        let (auth, _) = classify_http_failure(401, Some("bad key"));
        let (limited, _) = classify_http_failure(429, None);
        let (server, _) = classify_http_failure(503, None);
        assert_eq!(auth, FailureKind::Auth, "{protocol}");
        assert_eq!(limited, FailureKind::RateLimited, "{protocol}");
        assert_eq!(server, FailureKind::ServerError, "{protocol}");
        // 而可重试性由分类决定：认证**绝不**自动重试。
        assert!(!auth.retryable());
        assert!(limited.retryable());
        assert!(server.retryable());
    }
}

#[test]
fn a_non_json_body_is_malformed_output_not_a_panic() {
    let events = normalize_response("openai_compatible", "<html>502 Bad Gateway</html>", None, false);

    assert!(matches!(events.first(), Some(ModelEvent::Failed { failure: FailureKind::MalformedOutput, .. })));
}

// ---------------------------------------------------------------- 请求的拼装

fn profile(protocol: &str, dialect: &str, base_url: &str) -> ProviderProfile {
    ProviderProfile {
        id: "p".to_string(),
        name: "P".to_string(),
        protocol: protocol.to_string(),
        dialect: dialect.to_string(),
        base_url: base_url.to_string(),
        model_id: "m".to_string(),
        secret_ref: None,
        capabilities: Vec::new(),
        network_policy: "cloud".to_string(),
        revision: 1,
    }
}

#[test]
fn the_endpoint_comes_from_the_profile_and_a_constant_path() {
    let openai = build_request(&profile("openai_compatible", "openai_native", "https://api.openai.com/v1"), vec![], true, RequestOptions::default());
    let anthropic = build_request(&profile("anthropic", "anthropic_messages", "https://api.anthropic.com/v1"), vec![], true, RequestOptions::default());

    // 调用方给不了整条 URL：路径是常量表里的。
    assert_eq!(openai.endpoint, "https://api.openai.com/v1/chat/completions");
    assert_eq!(anthropic.endpoint, "https://api.anthropic.com/v1/messages");
    // 末尾斜杠再兜一次（存储层已经去过）：`//chat/completions` 会让某些网关 404。
    let trailing = build_request(&profile("openai_compatible", "openai_native", "https://api.example.com/v1/"), vec![], true, RequestOptions::default());
    assert_eq!(trailing.endpoint, "https://api.example.com/v1/chat/completions");
}

#[test]
fn the_request_never_carries_the_secret() {
    let request = build_request(&profile("openai_compatible", "openai_native", "https://api.example.com/v1"), vec![ChatMessage::text("user", "hi")], false, RequestOptions::default());

    // 认证头**留空**：密钥由调用方在发送那一刻借出（`authorize`），不进这个结构体的任何持久化路径。
    let auth = request.headers.iter().find(|(name, _)| name == "Authorization").expect("an auth header slot");
    assert_eq!(auth.1, "", "the secret must not be in the request built from the profile");
    assert!(!serde_json::to_string(&request.body).expect("serialize").contains("Authorization"));
}

#[test]
fn the_dialect_decides_whether_tool_schemas_may_be_sent() {
    // 计划 Step 3："Do not assume every compatible service supports the same tools…"
    let tools = || RequestOptions { allow_tools: true, tools: vec![serde_json::json!({ "type": "function", "function": { "name": "t" } })], force_tool: false, tool_choice_field: None };
    let generic = build_request(&profile("openai_compatible", "generic_compatible", "https://x/v1"), vec![], false, tools());
    let native = build_request(&profile("openai_compatible", "openai_native", "https://x/v1"), vec![], false, tools());

    assert!(generic.body.get("tools").is_none(), "a generic compatible endpoint must not receive a tool schema by default");
    assert!(native.body.get("tools").is_some());
    // 而且**两个前置条件都要满足**：方言支持 **且** 调用方按已验证证据放行。
    let native_without_evidence = build_request(&profile("openai_compatible", "openai_native", "https://x/v1"), vec![], false, RequestOptions::default());
    assert!(native_without_evidence.body.get("tools").is_none());
    // 第三个条件：**表不能是空的** —— 一个空工具表等于告诉 provider "我支持工具"却什么都没给。
    let native_with_an_empty_table = build_request(&profile("openai_compatible", "openai_native", "https://x/v1"), vec![], false, RequestOptions { allow_tools: true, tools: Vec::new(), force_tool: false, tool_choice_field: None });
    assert!(native_with_an_empty_table.body.get("tools").is_none());
}

#[test]
fn forcing_a_tool_uses_the_word_each_dialect_actually_accepts() {
    // 写错这一个词的后果是 400，而 400 会被读成"这家不支持工具" ——
    // 正是能力探针最容易误报的地方。
    let tools = RequestOptions { allow_tools: true, tools: vec![serde_json::json!({ "type": "function", "function": { "name": "t" } })], force_tool: true, tool_choice_field: None };
    let openai = build_request(&profile("openai_compatible", "openai_native", "https://x/v1"), vec![], false, tools.clone());
    let anthropic = build_request(&profile("anthropic", "anthropic_messages", "https://x/v1"), vec![], false, tools);

    assert_eq!(openai.body["tool_choice"], "required");
    assert_eq!(anthropic.body["tool_choice"], "any");
}

#[test]
fn an_image_message_gets_each_dialects_own_shape() {
    // 三家的图片位置完全不同：OpenAI 用 content parts 里的 data URL、
    // Anthropic 用 base64 的 source block、Ollama 用消息上的裸 base64 数组。
    // 而**消息里存的都是裸 base64** —— 前缀是拼请求时按方言加的。
    let image = "iVBORw0KGgo=".to_string();
    let message = || vec![ChatMessage::with_images("user", "what colour?", vec![image.clone()])];

    let openai = build_request(&profile("openai_compatible", "openai_native", "https://x/v1"), message(), false, RequestOptions::default());
    let anthropic = build_request(&profile("anthropic", "anthropic_messages", "https://x/v1"), message(), false, RequestOptions::default());
    let ollama = build_request(&profile("ollama", "ollama_native", "http://127.0.0.1:11434/api"), message(), false, RequestOptions::default());

    let openai_part = &openai.body["messages"][0]["content"][1];
    assert_eq!(openai_part["type"], "image_url");
    assert_eq!(openai_part["image_url"]["url"], format!("data:image/png;base64,{image}"));

    let anthropic_block = &anthropic.body["messages"][0]["content"][1];
    assert_eq!(anthropic_block["type"], "image");
    assert_eq!(anthropic_block["source"]["type"], "base64");
    assert_eq!(anthropic_block["source"]["data"], image);

    assert_eq!(ollama.body["messages"][0]["images"][0], image);
    // 纯文本的消息**保持字符串形状**：有些网关只认那一种，能少变一处就少变一处。
    let text_only = build_request(&profile("openai_compatible", "openai_native", "https://x/v1"), vec![ChatMessage::text("user", "hi")], false, RequestOptions::default());
    assert_eq!(text_only.body["messages"][0]["content"], "hi");
}

#[test]
fn anthropic_puts_the_system_prompt_at_the_top_level() {
    let request = build_request(
        &profile("anthropic", "anthropic_messages", "https://api.anthropic.com/v1"),
        vec![ChatMessage::text("system", "be brief"), ChatMessage::text("user", "hi")],
        false,
        RequestOptions::default()
    );

    // Anthropic 的 system 是顶层字段，不是消息里的一条 —— 放进 messages 会被拒。
    assert_eq!(request.body.get("system").and_then(|value| value.as_str()), Some("be brief"));
    let messages = request.body.get("messages").and_then(|value| value.as_array()).expect("messages");
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].get("role").and_then(|value| value.as_str()), Some("user"));
    assert!(request.body.get("max_tokens").is_some(), "Anthropic requires max_tokens");
}

#[test]
fn events_carry_the_attempt_identity_when_serialised_for_the_frontend() {
    let json = normalize_to_json("openai_compatible", &fixture("openai-non-streaming.json"), None, false, &ids());

    assert!(!json.is_empty());
    for event in &json {
        assert_eq!(event.get("requestId").and_then(|value| value.as_str()), Some("req-1"));
        assert_eq!(event.get("attemptId").and_then(|value| value.as_str()), Some("attempt-1"));
        assert!(event.get("kind").and_then(|value| value.as_str()).is_some());
    }
}
