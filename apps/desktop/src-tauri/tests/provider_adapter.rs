//! **适配器 + 真实转发**（Task 1.4 收尾 / Task 1.5 另一半）。
//!
//! ## 这个文件要钉住的四件事
//!
//! 1. **密钥在 Rust 侧借出、用完即弃**。`ProviderAdapter::send` 是唯一碰凭据库的地方，
//!    而它借密钥的窗口**只覆盖这一次 HTTP**：发送用的认证头是 `authorize(..)` 现场算出来的，
//!    `ProviderRequest` 里那个认证头**永远是空值**。所以"密钥进了请求结构体"这件事
//!    在类型与断言两层都不成立。
//! 2. **出站还有一道 URL 判据**。配置文件可以被手改，而"手改过的配置"不该变成一次 SSRF ——
//!    真正连出去之前还要过 `proxy::security::allow_upstream`。
//! 3. **取消之后不再产出事件**（计划 Task 1.5 Step 5 的安全性质），而且**不再碰 provider**。
//! 4. **增量解码**。SSE 帧会被 TCP 切成任意大小 —— 一块 JSON 落在两个 chunk 的边界上是常态，
//!    所以解码器必须能跨 chunk 拼帧。第一版按"一个 chunk 一帧"处理的话，
//!    真实网络下会**随机丢事件**，而那看起来像"模型偶尔不说话"。
//!
//! ## 为什么要真的起一个 socket
//!
//! `FakeTransport`（本文件）能钉住适配器的语义与失败分类，但它证明不了
//! **`reqwest` 那一半真的把字节搬回来了**：端点路径对不对、认证头有没有上线、状态码怎么读、
//! 重定向跟不跟。那几件事只有真 socket 能证明，所以这个文件里也有一个小小的
//! 回环 HTTP 服务器（与 `proxy_server.rs` 同一套手写思路）。

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use mathcanvas_desktop_lib::providers::adapter::{
    run_with_profile, HttpTransport, ProviderAdapter, ProviderError, SecretSource, SendOutcome, Stop, Transport, TransportUpdate,
};
use mathcanvas_desktop_lib::providers::events::{FailureKind, ModelEvent};
use mathcanvas_desktop_lib::providers::request::{ChatMessage, ProviderRequest};
use mathcanvas_desktop_lib::repository::provider_profiles::ProviderProfile;

// ---------------------------------------------------------------- 测试替身

/// 只借出一枚写死的密钥的凭据源。真实实现是 `secrets::Store`。
struct FakeSource {
    secret: Option<String>,
}

impl SecretSource for FakeSource {
    fn with_secret<T>(&self, _profile_id: &str, f: impl FnOnce(&str) -> T) -> Result<Option<T>, String> {
        Ok(self.secret.as_deref().map(f))
    }
}

/// 可以被测试置位的取消信号。
struct AtomicStop(AtomicBool);
impl AtomicStop {
    fn new() -> Arc<Self> {
        Arc::new(Self(AtomicBool::new(false)))
    }

    fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

impl Stop for AtomicStop {
    fn cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// 拿到一个 profile，**不碰文件系统、不校验** —— 校验是存储层的事，这里只造数据。
fn profile(json: serde_json::Value) -> ProviderProfile {
    serde_json::from_value(json).expect("the test profile must deserialise")
}

fn openai_profile() -> ProviderProfile {
    profile(serde_json::json!({
        "id": "openai",
        "name": "OpenAI",
        "protocol": "openai_compatible",
        "dialect": "generic_compatible",
        "baseUrl": "https://api.example.com/v1",
        "modelId": "gpt-4o-mini",
        "secretRef": "openai",
        "networkPolicy": "cloud",
        "revision": 1
    }))
}

fn messages() -> Vec<ChatMessage> {
    vec![ChatMessage::text("user", "画一个圆")]
}

/// 一次被记录下来的出站请求。
#[derive(Clone)]
struct Recorded {
    request: ProviderRequest,
    authorization: Vec<(String, String)>,
}

/// 按脚本回放的传输层：它不认识 provider、不做分类 —— 它只是字节。
struct FakeTransport {
    script: Mutex<Vec<Vec<u8>>>,
    calls: AtomicUsize,
    seen: Mutex<Vec<Recorded>>,
}

impl FakeTransport {
    fn streaming(script: Vec<Vec<u8>>) -> Self {
        Self { script: Mutex::new(script), calls: AtomicUsize::new(0), seen: Mutex::new(Vec::new()) }
    }

    fn last(&self) -> Recorded {
        self.seen.lock().expect("the record is not poisoned").last().cloned().expect("the transport was called")
    }
}

impl Transport for FakeTransport {
    fn send(&self, request: &ProviderRequest, authorization: &[(String, String)], _stop: &dyn Stop, on_update: &mut dyn FnMut(TransportUpdate)) -> Result<(), ProviderError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.seen.lock().expect("the record is not poisoned").push(Recorded { request: request.clone(), authorization: authorization.to_vec() });

        for chunk in self.script.lock().expect("the script is not poisoned").iter() {
            on_update(TransportUpdate::Body(chunk.clone()));
        }
        on_update(TransportUpdate::End);
        Ok(())
    }
}

/// 一次都不该被调用的传输层。
struct NeverCalled {
    calls: Arc<AtomicUsize>,
}

impl Transport for NeverCalled {
    fn send(&self, _request: &ProviderRequest, _authorization: &[(String, String)], _stop: &dyn Stop, _on_update: &mut dyn FnMut(TransportUpdate)) -> Result<(), ProviderError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

/// 一个可编程的 `Stop`：`Transport` 实现可以在收到第 N 块时把它置位。
struct Signal {
    flag: AtomicBool,
    notify: tokio::sync::Notify,
}

impl Signal {
    fn new() -> Arc<Self> {
        Arc::new(Self { flag: AtomicBool::new(false), notify: tokio::sync::Notify::new() })
    }

    fn cancel(&self) {
        self.flag.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
    }
}

impl Stop for Signal {
    fn cancelled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }

    fn wait(&self) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + '_>> {
        Box::pin(async move {
            // 先查标志再等通知：只等通知会在"置位与等待之间"漏掉那次取消。
            if self.cancelled() {
                return;
            }
            self.notify.notified().await;
        })
    }
}

/// 第一块是**一帧完整的 SSE**，然后置位取消：于是第二帧必须在解码**之前**就被丢弃。
///
/// 为什么第一块要凑成一整帧：不凑的话它只是缓冲区里的半个 JSON，而"取消之后不许再解码"
/// 这条性质会变成"连取消之前收到的东西都没了" —— 那不是这条用例要证的东西。
struct CancelsAfterFirstChunk {
    signal: Arc<Signal>,
}

impl Transport for CancelsAfterFirstChunk {
    fn send(&self, _request: &ProviderRequest, _authorization: &[(String, String)], _stop: &dyn Stop, on_update: &mut dyn FnMut(TransportUpdate)) -> Result<(), ProviderError> {
        on_update(TransportUpdate::Body("data: {\"choices\":[{\"delta\":{\"content\":\"前半\"}}]}\n\n".as_bytes().to_vec()));
        self.signal.cancel();
        on_update(TransportUpdate::Body("data: {\"choices\":[{\"delta\":{\"content\":\"后半\"}}]}\n\n".as_bytes().to_vec()));
        on_update(TransportUpdate::End);
        Ok(())
    }
}

fn send<S: SecretSource + ?Sized, T: Transport + ?Sized>(adapter: &ProviderAdapter<'_, S, T>, stop: &Arc<AtomicStop>) -> Result<SendOutcome, ProviderError> {
    adapter.send(messages(), true, stop.as_ref())
}

fn text_of(events: &[ModelEvent]) -> String {
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

// ---------------------------------------------------------------- 密钥的窗口

#[test]
fn the_secret_is_borrowed_for_one_request_and_never_lands_in_the_request_itself() {
    let source = FakeSource { secret: Some("sk-live-secret".to_string()) };
    let transport = FakeTransport::streaming(vec![br#"data: {"choices":[{"delta":{"content":"ok"}}]}"#.to_vec(), b"\n\n".to_vec()]);
    let adapter = ProviderAdapter::new(&source, &transport, openai_profile());
    let stop = AtomicStop::new();

    let outcome = send(&adapter, &stop).expect("the gateway must be admitted");

    assert!(matches!(outcome, SendOutcome::Completed(_)));
    let recorded = transport.last();
    // 认证头是**发送那一刻**算出来的。
    assert_eq!(recorded.authorization.iter().find(|(name, _)| name == "Authorization").map(|(_, value)| value.as_str()), Some("Bearer sk-live-secret"));
    // 而请求本体里那个头**永远是空值**：密钥不进请求结构体。
    assert_eq!(recorded.request.headers.iter().find(|(name, _)| name == "Authorization").map(|(_, value)| value.as_str()), Some(""));
    // 请求体里也不该有它 —— 密钥混进提示词是最难查的一类泄漏。
    let serialized = recorded.request.body.to_string();
    assert!(!serialized.contains("sk-live-secret"), "the body must not carry the secret: {serialized}");
    assert_eq!(recorded.request.endpoint, "https://api.example.com/v1/chat/completions");
}

#[test]
fn a_missing_secret_is_reported_instead_of_sending_an_anonymous_request() {
    let source = FakeSource { secret: None };
    let transport = FakeTransport::streaming(vec![b"data: {}\n\n".to_vec()]);
    let adapter = ProviderAdapter::new(&source, &transport, openai_profile());
    let stop = AtomicStop::new();

    let error = send(&adapter, &stop).expect_err("a profile without a secret must not be sent");

    assert!(matches!(error, ProviderError::MissingSecret { .. }), "got {error:?}");
    // **一次都没发**：发一次注定 401 的请求只会让用户以为是服务商的问题。
    assert_eq!(transport.calls.load(Ordering::SeqCst), 0);
    // 而且报错要说清是哪一个 profile 缺密钥。
    assert!(error.to_string().contains("openai"));
}

#[test]
fn a_secret_backend_failure_is_reported_without_any_plaintext() {
    struct Broken;
    impl SecretSource for Broken {
        fn with_secret<T>(&self, _profile_id: &str, _f: impl FnOnce(&str) -> T) -> Result<Option<T>, String> {
            Err("the credential store is unavailable".to_string())
        }
    }

    let transport = FakeTransport::streaming(vec![b"data: {}\n\n".to_vec()]);
    let adapter = ProviderAdapter::new(&Broken, &transport, openai_profile());
    let stop = AtomicStop::new();

    let error = send(&adapter, &stop).expect_err("a broken secret backend must not be swallowed");

    assert!(matches!(error, ProviderError::SecretStore { .. }), "got {error:?}");
    assert_eq!(transport.calls.load(Ordering::SeqCst), 0);
}

// ---------------------------------------------------------------- 取消

#[test]
fn a_cancelled_run_emits_nothing_and_never_reaches_the_provider() {
    let source = FakeSource { secret: Some("sk-live-secret".to_string()) };
    let calls = Arc::new(AtomicUsize::new(0));
    let transport = NeverCalled { calls: calls.clone() };
    let adapter = ProviderAdapter::new(&source, &transport, openai_profile());
    let stop = AtomicStop::new();
    stop.cancel();

    let outcome = send(&adapter, &stop).expect("a cancelled run is not an error");

    assert!(matches!(outcome, SendOutcome::Cancelled(_)), "got {outcome:?}");
    assert_eq!(calls.load(Ordering::SeqCst), 0, "a cancelled run must not touch the provider");
}

#[test]
fn cancelling_mid_stream_stops_decoding_at_the_next_chunk() {
    let signal = Signal::new();
    let transport = CancelsAfterFirstChunk { signal: signal.clone() };
    let source = FakeSource { secret: Some("sk-live-secret".to_string()) };
    let adapter = ProviderAdapter::new(&source, &transport, openai_profile());

    let outcome = adapter.send(messages(), true, signal.as_ref()).expect("a cancelled run is not an error");
    let SendOutcome::Cancelled(events) = outcome else { panic!("expected a cancelled run, got {outcome:?}") };

    // 第一块**已经**到了（用户看到的就是它），第二块**不再**解码。
    assert_eq!(text_of(&events), "前半", "nothing may be decoded after the cancellation");
}

// ---------------------------------------------------------------- 增量解码

#[test]
fn a_json_payload_split_across_two_chunks_is_still_decoded() {
    let source = FakeSource { secret: Some("sk-live-secret".to_string()) };
    // 帧被 TCP 切在 JSON 中间 —— 真实网络下的常态。
    let transport = FakeTransport::streaming(vec![
        br#"data: {"choices":[{"delta":{"con"#.to_vec(),
        "tent\":\"你好\"}}]}".as_bytes().to_vec(),
        b"\n\ndata: [DONE]\n\n".to_vec(),
    ]);
    let adapter = ProviderAdapter::new(&source, &transport, openai_profile());
    let stop = AtomicStop::new();

    let outcome = send(&adapter, &stop).expect("the gateway must be admitted");
    let SendOutcome::Completed(events) = outcome else { panic!("expected a completed run, got {outcome:?}") };

    assert_eq!(text_of(&events), "你好", "a payload split across chunks must still be decoded");
}

#[test]
fn anthropic_frames_carry_their_event_name_across_the_decode() {
    let source = FakeSource { secret: Some("sk-live-secret".to_string()) };
    let mut anthropic = openai_profile();
    anthropic.protocol = "anthropic".to_string();
    anthropic.dialect = "anthropic_messages".to_string();
    anthropic.base_url = "https://api.anthropic.com/v1".to_string();
    let transport = FakeTransport::streaming(vec![
        b"event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"model\":\"claude-3\"}}\n\n".to_vec(),
        b"event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"circle\"}}\n\n".to_vec(),
        b"event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n".to_vec(),
    ]);
    let adapter = ProviderAdapter::new(&source, &transport, anthropic);
    let stop = AtomicStop::new();

    let outcome = send(&adapter, &stop).expect("the gateway must be admitted");
    let SendOutcome::Completed(events) = outcome else { panic!("expected a completed run, got {outcome:?}") };

    // 认证头按方言走 `x-api-key`，且**不带** `Bearer ` 前缀。
    let recorded = transport.last();
    assert_eq!(recorded.authorization.iter().find(|(name, _)| name == "x-api-key").map(|(_, value)| value.as_str()), Some("sk-live-secret"));
    assert_eq!(recorded.request.endpoint, "https://api.anthropic.com/v1/messages");
    assert_eq!(text_of(&events), "circle");
    assert!(kinds(&events).contains(&"completed"));
}

#[test]
fn a_truncated_frame_at_the_end_of_the_stream_is_flushed_not_dropped() {
    let source = FakeSource { secret: Some("sk-live-secret".to_string()) };
    // 没有尾随空行：最后一块是"半帧"，但它其实是一份完整 JSON（对方没补空行）。
    let transport = FakeTransport::streaming(vec![br#"data: {"choices":[{"delta":{"content":"tail"}}]}"#.to_vec()]);
    let adapter = ProviderAdapter::new(&source, &transport, openai_profile());
    let stop = AtomicStop::new();

    let outcome = send(&adapter, &stop).expect("the gateway must be admitted");
    let SendOutcome::Completed(events) = outcome else { panic!("expected a completed run, got {outcome:?}") };

    assert_eq!(text_of(&events), "tail", "a trailing frame without a blank line must not be dropped");
}

#[test]
fn ollama_lines_are_decoded_without_a_data_prefix() {
    let source = FakeSource { secret: Some("sk-live-secret".to_string()) };
    let mut ollama = openai_profile();
    ollama.protocol = "ollama".to_string();
    ollama.dialect = "ollama_native".to_string();
    ollama.base_url = "http://127.0.0.1:11434/api".to_string();
    ollama.network_policy = "local".to_string();
    let transport = FakeTransport::streaming(vec![
        br#"{"model":"llama3","message":{"role":"assistant","content":"one"}}"#.to_vec(),
        b"\n{\"model\":\"llama3\",\"message\":{\"content\":\"two\"},\"done\":true}\n".to_vec(),
    ]);
    let adapter = ProviderAdapter::new(&source, &transport, ollama);
    let stop = AtomicStop::new();

    let outcome = send(&adapter, &stop).expect("the gateway must be admitted");
    let SendOutcome::Completed(events) = outcome else { panic!("expected a completed run, got {outcome:?}") };

    // NDJSON：**没有** `data:` 前缀，按行拆。
    assert_eq!(text_of(&events), "onetwo");
    assert!(kinds(&events).contains(&"completed"));
}

// ---------------------------------------------------------------- 出站判据

#[test]
fn a_cloud_profile_whose_base_url_was_edited_to_http_is_refused_before_connecting() {
    let source = FakeSource { secret: Some("sk-live-secret".to_string()) };
    let mut edited = openai_profile();
    // 配置文件是**可以被手改的** —— 手改之后不该变成一次明文传密钥。
    edited.base_url = "http://api.example.com/v1".to_string();
    let calls = Arc::new(AtomicUsize::new(0));
    let transport = NeverCalled { calls: calls.clone() };
    let adapter = ProviderAdapter::new(&source, &transport, edited);
    let stop = AtomicStop::new();

    let error = send(&adapter, &stop).expect_err("an http cloud endpoint must be refused");

    assert!(matches!(error, ProviderError::RefusedUrl { .. }), "got {error:?}");
    assert_eq!(calls.load(Ordering::SeqCst), 0, "the refusal must happen before connecting");
}

#[test]
fn a_cloud_profile_pointing_at_a_private_address_is_refused() {
    let source = FakeSource { secret: Some("sk-live-secret".to_string()) };
    let mut edited = openai_profile();
    // 元数据地址是最出名的那个：SSRF 的经典落点。
    edited.base_url = "https://169.254.169.254/latest".to_string();
    let calls = Arc::new(AtomicUsize::new(0));
    let transport = NeverCalled { calls: calls.clone() };
    let adapter = ProviderAdapter::new(&source, &transport, edited);
    let stop = AtomicStop::new();

    let error = send(&adapter, &stop).expect_err("a metadata address must be refused");

    assert!(matches!(error, ProviderError::RefusedUrl { .. }), "got {error:?}");
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

// ---------------------------------------------------------------- 命令线程那一层

/// 命令那一层要**先对修订号，再碰密钥**：用一份界面已经看不到的配置发请求，
/// 就算成功了也没法解释结果。
#[test]
fn a_stale_profile_revision_is_refused_before_the_credential_is_borrowed() {
    let source = FakeSource { secret: Some("sk-live-secret".to_string()) };
    let calls = Arc::new(AtomicUsize::new(0));
    let transport = NeverCalled { calls: calls.clone() };
    let stop = AtomicStop::new();
    let mut stale = openai_profile();
    stale.revision = 7;

    let error = run_with_profile(&source, &transport, stale, 3, messages(), true, stop.as_ref()).expect_err("a stale revision must be refused");

    assert_eq!(error, ProviderError::RevisionMismatch { expected: 3, actual: 7 });
    // 分类是 `auth`（配置问题，换时机再试还是同一份错误）—— **不该重试**。
    assert!(!error.failure().retryable(), "a revision mismatch must not be retried");
    assert_eq!(calls.load(Ordering::SeqCst), 0, "nothing may be sent");
}

#[test]
fn the_command_layer_reports_a_missing_credential_with_a_classification_the_frontend_can_act_on() {
    let source = FakeSource { secret: None };
    let transport = FakeTransport::streaming(vec![b"data: {}\n\n".to_vec()]);
    let stop = AtomicStop::new();

    let error = run_with_profile(&source, &transport, openai_profile(), 1, messages(), true, stop.as_ref()).expect_err("no credential");

    // 前端拿到的必须**带分类**（`to_json`），而不是一句话：重试策略只认那两项。
    let json = error.to_json();
    assert_eq!(json["kind"], "failed");
    assert_eq!(json["failure"], "auth");
    assert_eq!(json["retryable"], false);
    assert_eq!(transport.calls.load(Ordering::SeqCst), 0, "no request may be sent without a credential");
}

// ---------------------------------------------------------------- 真实传输层

/// 一个只会走一趟请求的回环 HTTP 服务器。
///
/// 手写而不是用框架：这里只需要"回一段固定的字节、记下收到的请求"，
/// 而**手写的 302** 正是"重定向跟不跟"那条用例的要点 —— 客户端库不会替我们造 302。
///
/// ## 这台服务器踩过的两个坑（都留着注释，因为它们会再踩）
///
/// 1. **只读一次就回响应**：请求头与请求体常分成两个 TCP 段到达，于是服务器在客户端
///    **还在写**的时候就把连接关了 —— 客户端看到 `IncompleteMessage`，
///    看起来像"传输层有 bug"，其实是服务器太急。现在按 `content-length` 收完再回。
/// 2. **不关连接**：那会让客户端一直等（测试跑了 120 秒才超时）。
///    `connection: close` 得**算数** —— 回完之后关掉写半边，客户端据此判定报文结束。
struct TestServer {
    address: SocketAddr,
    request: Arc<Mutex<String>>,
}

fn serve_once(status: &str, extra_headers: &str, body: &str) -> TestServer {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind a loopback listener");
    let address = listener.local_addr().expect("read the port");
    let request = Arc::new(Mutex::new(String::new()));
    let recorded = request.clone();
    // 注意结尾只有一个 `\r\n` 在 header 与 body 之间：写成两个会在 header 里留一个空行，
    // 于是 body 变成"长于 content-length"，客户端读到的就是半截报文。
    let response = format!("HTTP/1.1 {status}\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n{extra_headers}\r\n{body}", body.len());

    std::thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut raw = Vec::new();
            let mut buffer = [0u8; 4096];
            // 先把请求收完：header 段落结束 + content-length 指定的那么多字节。
            loop {
                let read = stream.read(&mut buffer).unwrap_or(0);
                if read == 0 {
                    break;
                }
                raw.extend_from_slice(&buffer[..read]);
                let text = String::from_utf8_lossy(&raw).into_owned();
                if let Some((head, rest)) = text.split_once("\r\n\r\n") {
                    let length: usize = head
                        .lines()
                        .find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            name.eq_ignore_ascii_case("content-length").then(|| value.trim().parse::<usize>().ok())?
                        })
                        .unwrap_or(0);
                    if rest.len() >= length {
                        break;
                    }
                }
            }
            *recorded.lock().expect("the record is not poisoned") = String::from_utf8_lossy(&raw).into_owned();
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
            // 关掉**写半边**：客户端据此判定报文结束（`connection: close` 要算数）。
            let _ = stream.shutdown(std::net::Shutdown::Write);
            // 然后等客户端关（读会立刻回 0）—— 不主动 drop，避免在读端发出 RST。
            let _ = stream.read(&mut buffer);
        }
    });

    TestServer { address, request }
}

fn local_profile(base_url: &str) -> ProviderProfile {
    profile(serde_json::json!({
        "id": "local",
        "name": "Local",
        "protocol": "openai_compatible",
        "dialect": "generic_compatible",
        "baseUrl": base_url,
        "modelId": "local-model",
        "secretRef": "local",
        "networkPolicy": "local",
        "revision": 1
    }))
}

#[test]
fn the_real_transport_reads_a_streamed_body_over_a_socket() {
    let server = serve_once("200 OK", "", "data: {\"choices\":[{\"delta\":{\"content\":\"real\"}}]}\n\ndata: [DONE]\n\n");
    let source = FakeSource { secret: Some("sk-live-secret".to_string()) };
    let transport = HttpTransport::new();
    let adapter = ProviderAdapter::new(&source, &transport, local_profile(&format!("http://{}", server.address)));
    let stop = AtomicStop::new();

    let outcome = send(&adapter, &stop).expect("a loopback gateway must be admitted");
    let SendOutcome::Completed(events) = outcome else { panic!("expected a completed run, got {outcome:?}") };

    assert_eq!(text_of(&events), "real");
    // 认证头**真的**上了线（读到的那份原始请求里有它）。
    let raw = server.request.lock().expect("the record is not poisoned").clone();
    assert!(raw.to_lowercase().contains("authorization: bearer sk-live-secret"), "the credential must reach the wire: {raw}");
    assert!(raw.starts_with("POST /chat/completions"), "the endpoint path must be the constant one: {raw}");
}

#[test]
fn the_real_transport_classifies_an_http_failure_instead_of_returning_empty_events() {
    let server = serve_once("429 Too Many Requests", "", "{\"error\":\"slow down\"}");
    let source = FakeSource { secret: Some("sk-live-secret".to_string()) };
    let transport = HttpTransport::new();
    let adapter = ProviderAdapter::new(&source, &transport, local_profile(&format!("http://{}", server.address)));
    let stop = AtomicStop::new();

    let error = send(&adapter, &stop).expect_err("a 429 must be reported as a failure");

    match error {
        ProviderError::Http { status, failure, .. } => {
            assert_eq!(status, 429);
            assert_eq!(failure, FailureKind::RateLimited, "the shared vocabulary must classify it");
        }
        other => panic!("expected an HTTP failure, got {other:?}"),
    }
}

#[test]
fn the_real_transport_does_not_follow_a_redirect_with_the_credential() {
    // 302 到别处：跟着走就会把认证头送给对方。
    // 每条额外 header **自己带 `\r\n` 结尾**，而且冒号后**只留一个空格** ——
    // 多一个空格、或少一个换行都会让报文非法（hyper 报 `Header(Token)`），
    // 而那个错误看起来像"客户端解析不了"，其实是这台测试服务器把报文写坏了。
    let server = serve_once("302 Found", "location: http://127.0.0.1:9/\r\n", "moved");
    let source = FakeSource { secret: Some("sk-live-secret".to_string()) };
    let transport = HttpTransport::new();
    let adapter = ProviderAdapter::new(&source, &transport, local_profile(&format!("http://{}", server.address)));
    let stop = AtomicStop::new();

    let error = send(&adapter, &stop).expect_err("a redirect must not be followed with the credential");

    match error {
        ProviderError::Http { status, .. } => assert_eq!(status, 302),
        other => panic!("expected the redirect to surface as an HTTP failure, got {other:?}"),
    }
}
