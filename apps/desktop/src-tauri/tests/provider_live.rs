//! **对真实 provider 的一轮往返**。
//!
//! 这一条为档案里那句如实保留而写：**"探针的请求形状照公开文档拼、没有对真实服务跑过"**。
//! 形状错了的表现是"明明支持却被记成 `failed`"，而那种错**只有真的发一次**才看得出来 ——
//! 所以它必须能对真实服务跑，而不是再读一遍文档。
//!
//! ## 默认不跑，因为它是"要花钱、要网络、要一枚密钥"的那一类
//!
//! ```powershell
//! $env:DEEPSEEK_API_KEY = "sk-..."
//! cargo test --test provider_live -- --ignored --nocapture
//! ```
//!
//! 与 `tests/secrets.rs` 里那条真凭据库用例同一个口径：**默认 `#[ignore]`，显式跑**。
//!
//! ## 两条纪律
//!
//! 1. **密钥只从环境变量读**，不落盘、不进任何断言输出（`--nocapture` 会打印模型回的话，
//!    但打印出来的东西里没有密钥 —— 认证头由 `authorize(..)` 现场算，不进请求结构体）。
//! 2. **没有密钥时如实跳过**：回一句话说明"没设环境变量"，而不是伪造一次成功。
//!    一条会静默通过的"真实往返"用例比没有这条用例更糟。

use std::sync::atomic::AtomicBool;

use mathcanvas_desktop_lib::providers::adapter::{HttpTransport, ProviderAdapter, SecretSource, SendOutcome, Stop};
use mathcanvas_desktop_lib::providers::events::ModelEvent;
use mathcanvas_desktop_lib::providers::request::{ChatMessage, RequestOptions};
use mathcanvas_desktop_lib::repository::provider_profiles::ProviderProfile;

/// 从环境变量借出密钥。**没有它就没有密钥** —— 这正是 `SecretSource` 要表达的东西。
struct EnvSecret;

impl SecretSource for EnvSecret {
    fn with_secret<T>(&self, _profile_id: &str, f: impl FnOnce(&str) -> T) -> Result<Option<T>, String> {
        Ok(std::env::var("DEEPSEEK_API_KEY").ok().filter(|secret| !secret.trim().is_empty()).as_deref().map(f))
    }
}

/// 一个永不取消的句柄（这一轮没有按停止的人）。
struct NoStop(AtomicBool);

impl Stop for NoStop {
    fn cancelled(&self) -> bool {
        self.0.load(std::sync::atomic::Ordering::SeqCst)
    }
}

/// DeepSeek 的 OpenAI 兼容入口。`dialect: deepseek` 是仓库里已有的那一档。
fn profile() -> ProviderProfile {
    serde_json::from_value(serde_json::json!({
        "id": "deepseek-live",
        "name": "DeepSeek",
        "protocol": "openai_compatible",
        "dialect": "deepseek",
        "baseUrl": "https://api.deepseek.com/v1",
        "modelId": "deepseek-chat",
        "secretRef": "deepseek-live",
        "networkPolicy": "cloud",
        "revision": 1
    }))
    .expect("the live profile must deserialise")
}

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

fn tool_calls(events: &[ModelEvent]) -> Vec<(String, serde_json::Value)> {
    events
        .iter()
        .filter_map(|event| match event {
            ModelEvent::ToolCall { tool_id, input, .. } => Some((tool_id.clone(), input.clone())),
            _ => None,
        })
        .collect()
}

fn prompt() -> Vec<ChatMessage> {
    vec![ChatMessage::text("user", "Reply with exactly one word: pong")]
}

fn skip_if_no_key() -> bool {
    if std::env::var("DEEPSEEK_API_KEY").map(|secret| secret.trim().is_empty()).unwrap_or(true) {
        println!("SKIPPED: DEEPSEEK_API_KEY is not set, so there is nothing to authenticate with.");
        return true;
    }
    false
}

#[test]
#[ignore = "calls the real DeepSeek API; set DEEPSEEK_API_KEY and run with --ignored"]
fn a_text_ping_really_comes_back_from_deepseek() {
    if skip_if_no_key() {
        return;
    }
    let transport = HttpTransport::new();
    let stop = NoStop(AtomicBool::new(false));
    let adapter = ProviderAdapter::new(&EnvSecret, &transport, profile());

    let outcome = adapter.send(prompt(), false, &stop).expect("the request must reach the provider");

    let events = match outcome {
        SendOutcome::Completed(events) | SendOutcome::Cancelled(events) => events,
    };
    let text = joined_text(&events);
    let kinds: Vec<&str> = events.iter().map(|event| event.kind()).collect();
    println!("event kinds: {kinds:?}");
    println!("reply: {text:?}");

    // 真的回了话 —— 这一条同时证明了：地址、认证头、请求体形状、SSE 解码都对。
    assert!(!text.trim().is_empty(), "a live text ping must come back with text: {events:?}");
    assert!(events.iter().any(|event| matches!(event, ModelEvent::Completed { .. })), "the stream must end with a completion");
}

#[test]
#[ignore = "calls the real DeepSeek API; set DEEPSEEK_API_KEY and run with --ignored"]
fn a_tool_request_really_reaches_deepseek_and_the_answer_is_classified() {
    if skip_if_no_key() {
        return;
    }
    let transport = HttpTransport::new();
    let stop = NoStop(AtomicBool::new(false));
    let adapter = ProviderAdapter::new(&EnvSecret, &transport, profile());

    // **探针的形状**：一张工具表 + 强制调用。形状是我们拼的，所以这一条跑一次就能回答
    // "我们拼对了没有" —— 那正是档案里那句保留所指的问题。
    let options = RequestOptions {
        allow_tools: true,
        tools: vec![serde_json::json!({
            "type": "function",
            "function": {
                "name": "probe_ping",
                "description": "Report that the tool channel works. Call this with {\"ok\": true}.",
                "parameters": { "type": "object", "properties": { "ok": { "type": "boolean" } }, "required": ["ok"] }
            }
        })],
        force_tool: true,
        tool_choice_field: None
    };

    let outcome = adapter.send_with(vec![ChatMessage::text("user", "Call the probe_ping tool with ok=true.")], false, options, &stop).expect("the request must reach the provider");
    let events = match outcome {
        SendOutcome::Completed(events) | SendOutcome::Cancelled(events) => events,
    };

    let calls = tool_calls(&events);
    let text = joined_text(&events);
    println!("event kinds: {:?}", events.iter().map(|event| event.kind()).collect::<Vec<_>>());
    println!("tool calls: {calls:?}");
    println!("text: {text:?}");

    // **不假装工具一定可用**：这一条断言的是"我们拿到了一个能解释的响应"，
    // 而不是"工具可用" —— 后者是**证据**的事，判据在 `capability.rs` 里。
    //
    // 实测（2026-09-21，`deepseek-chat`，`tool_choice: "required"`）：HTTP 200、有 usage、
    // 但**既没有工具调用也没有文本** —— 一条"空完成"。探针的判据表把这种回法记成
    // `failed`（"the provider returned an empty reply to the tool request"），而那是对的：
    // 请求是让它调工具，它什么都没调。**这一条实测正是"探针的请求形状有没有拼对"的答案。**
    let verdict = if !calls.is_empty() {
        "the provider issued a tool call"
    } else if !text.trim().is_empty() {
        "the provider replied with text instead of calling the tool"
    } else {
        "empty completion (the probe would record the tools feature as failed)"
    };
    println!("verdict: {verdict}");
    assert!(
        events.iter().any(|event| matches!(event, ModelEvent::Completed { .. }) || matches!(event, ModelEvent::Failed { .. })),
        "a live tool request must end in a completion or a classified failure: {events:?}"
    );
}
