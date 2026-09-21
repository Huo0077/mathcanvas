//! **能力证据探针**（Task 1.4 Step 5）。
//!
//! 计划原文只有一句，但它是这条线上**唯一**能让"已验证"变成真的东西：
//!
//! > Add capability evidence probes. Record declared/verified/failed per model/profile revision;
//! > **a successful text ping must not mark vision or tools verified.**
//!
//! ## 这一条为什么值得一组专门的用例
//!
//! 因为"验证"太容易写成"发一次请求成功了就全打勾"。那种实现看起来一切正常 ——
//! 界面显示四个绿色徽章 —— 直到真的给一个不支持图片的模型发图，用户在界面上
//! 得到的是一句莫名其妙的错误。所以这里逐条钉住**证据的边界**：
//!
//! | 观测到的 | 能得出的结论 |
//! | --- | --- |
//! | 回了一段文本，且请求正常结束 | `streaming` 才算验证过 |
//! | 只回文本、没有任何工具调用 | `tools` = **unknown**（"模型不肯配合"太常见）|
//! | 工具调用里出现**我们的工具名** | `tools` = verified |
//! | 图片请求被 400 拒 | `vision` = **failed**：请求形状是我们控制得住的 |
//! | 401 / 403 / 连不上 | 全部 **unknown**（认证失败对"支不支持"什么都不说明）|
//!
//! ## 一组替身为什么按"这一发长什么样"来回答
//!
//! 第一版替身是"按顺序回脚本"。它有两个假阳性：
//! ①用例断言的是"第几发请求"，于是拆一次请求顺序就红一片 —— 而那和证据判据无关；
//! ②它没法表达"带图的请求会失败、纯文本的请求会成功"，于是**测不出图片这件事**。
//! 现在替身看请求本身（这一发带图吗？带工具表吗？），于是"文本 ping 验证不了 vision"
//! 这条性质才真的被钉住。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use mathcanvas_desktop_lib::providers::adapter::{ProviderError, SecretSource, Stop, Transport, TransportUpdate};
use mathcanvas_desktop_lib::providers::capability::{tools_verified, CapabilityStatus, Feature, Probe, PROBE_FEATURES};
use mathcanvas_desktop_lib::providers::events::FailureKind;
use mathcanvas_desktop_lib::providers::request::ProviderRequest;
use mathcanvas_desktop_lib::repository::provider_profiles::{ProviderHealth, ProviderProfile};

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

fn profile() -> ProviderProfile {
    serde_json::from_value(serde_json::json!({
        "id": "openai",
        "name": "OpenAI",
        "protocol": "openai_compatible",
        "dialect": "openai_native",
        "baseUrl": "http://127.0.0.1:9/v1",
        "modelId": "probe-model",
        "secretRef": "openai",
        "networkPolicy": "local",
        "revision": 4
    }))
    .expect("the test profile must deserialise")
}

/// 一次被记下来的出站请求在**探针眼里**是什么形状。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Shape {
    /// 一次纯文本请求。
    Text,
    /// 带图的请求。
    Image,
    /// 带工具表的请求。
    Tools,
}

fn shape_of(request: &ProviderRequest) -> Shape {
    if request.messages.iter().any(|message| !message.images.is_empty()) {
        return Shape::Image;
    }
    if request.body.get("tools").and_then(|value| value.as_array()).is_some_and(|tools| !tools.is_empty()) {
        return Shape::Tools;
    }
    Shape::Text
}

/// 一句话说明这一发是什么（失败消息里要能一眼看出来）。
fn describe(shape: Shape) -> &'static str {
    match shape {
        Shape::Text => "a text request",
        Shape::Image => "the image request",
        Shape::Tools => "the tool request",
    }
}

/// **按请求形状回答**的替身。
///
/// `answer` 拿到"这一发是什么形状 + 完整的请求"，回一段 SSE 字节或者一个 HTTP 失败。
/// 于是每条用例都能独立表达"带图的会怎样、纯文本的会怎样"。
struct ByShape<T> {
    answer: Box<T>,
    calls: Mutex<Vec<(Shape, ProviderRequest)>>,
}

impl<T: Fn(Shape, &ProviderRequest) -> Result<String, ProviderError> + Send + Sync> ByShape<T> {
    fn new(answer: T) -> Self {
        Self { answer: Box::new(answer), calls: Mutex::new(Vec::new()) }
    }

    fn calls(&self) -> Vec<(Shape, ProviderRequest)> {
        self.calls.lock().expect("not poisoned").clone()
    }

    /// 只取某一形状的那一发（**按形状找，不按第几发** —— 顺序是会变的实现细节）。
    fn request_of(&self, shape: Shape) -> ProviderRequest {
        self.calls()
            .iter()
            .find(|(candidate, _)| *candidate == shape)
            .map(|(_, request)| request.clone())
            .unwrap_or_else(|| panic!("the probe never sent {}", describe(shape)))
    }

    fn sent(&self, shape: Shape) -> bool {
        self.calls().iter().any(|(candidate, _)| *candidate == shape)
    }
}

impl<T: Fn(Shape, &ProviderRequest) -> Result<String, ProviderError> + Send + Sync> Transport for ByShape<T> {
    fn send(&self, request: &ProviderRequest, _authorization: &[(String, String)], _stop: &dyn Stop, on_update: &mut dyn FnMut(TransportUpdate)) -> Result<(), ProviderError> {
        let shape = shape_of(request);
        self.calls.lock().expect("not poisoned").push((shape, request.clone()));
        let body = (self.answer)(shape, request)?;
        on_update(TransportUpdate::Body(body.into_bytes()));
        on_update(TransportUpdate::End);
        Ok(())
    }
}

/// 一次成功的文本流。
fn sse(text: &str) -> String {
    format!("data: {{\"choices\":[{{\"delta\":{{\"content\":{}}}}}]}}\n\ndata: [DONE]\n\n", serde_json::json!(text))
}

/// 一次包含工具调用的流。
fn sse_tool_call() -> String {
    "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"function\":{\"name\":\"mathcanvas_capability_probe\",\"arguments\":\"{\\\"status\\\":\\\"ok\\\"}\"}}]}}]}\n\ndata: [DONE]\n\n".to_string()
}

fn http_failure(status: u16) -> ProviderError {
    ProviderError::Http { status, failure: FailureKind::Auth, message: format!("the provider refused the request ({status})") }
}

struct NoStop(AtomicBool);

impl NoStop {
    fn new() -> Arc<Self> {
        Arc::new(Self(AtomicBool::new(false)))
    }
}

impl Stop for NoStop {
    fn cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// **一个什么都答得上的 provider**：纯文本回文本、被问 JSON 就回 JSON、
/// 带图回文本、带工具就调工具。
///
/// 这条基线代表"这家完全支持四件事"，每一条用例再从它出发**只改一件事**。
fn capable(shape: Shape, request: &ProviderRequest) -> Result<String, ProviderError> {
    match shape {
        Shape::Tools => Ok(sse_tool_call()),
        // JSON 探针由**请求里那句话**认出来（它要的正是一个 JSON 对象）。
        _ if request.body.to_string().contains("JSON object") => Ok(sse("{\"ok\": true}")),
        _ => Ok(sse("pong")),
    }
}

// ---------------------------------------------------------------- 一次文本 ping 不能顺带验证别的

#[test]
fn a_successful_text_ping_never_marks_tools_or_vision_verified() {
    // 这一条就是计划里那句原文。
    //
    // 替身**只答纯文本**：带图的请求回一次 200 但空回答、带工具的请求回一段闲聊。
    // 于是这条用例证明的是"探针没有把'能聊天'当成'能看图'或'能用工具'"。
    let transport = ByShape::new(|shape: Shape, _request: &ProviderRequest| -> Result<String, ProviderError> {
        match shape {
            Shape::Text => Ok(sse("pong")),
            Shape::Image => Ok(String::new()),
            Shape::Tools => Ok(sse("I would rather chat.")),
        }
    });
    let source = FakeSource { secret: Some("sk-live-secret".to_string()) };
    let stop = NoStop::new();

    let report = Probe::new(&source, &transport, profile(), stop.as_ref()).run().expect("the profile must be probed");

    assert_ne!(report.evidence(Feature::Tools), Some(CapabilityStatus::Verified), "text replies are not evidence that tools work");
    assert_ne!(report.evidence(Feature::Vision), Some(CapabilityStatus::Verified), "text replies are not evidence that images work");
    // 而这两条确实被验证了：文本流回来了、也正常结束。
    assert_eq!(report.evidence(Feature::Streaming), Some(CapabilityStatus::Verified));
}

#[test]
fn the_probe_asks_about_the_model_the_profile_names() {
    let transport = ByShape::new(capable);
    let source = FakeSource { secret: Some("sk-live-secret".to_string()) };
    let stop = NoStop::new();

    let report = Probe::new(&source, &transport, profile(), stop.as_ref()).run().expect("the profile must be probed");

    for (shape, request) in transport.calls() {
        assert_eq!(request.body["model"], "probe-model", "{} must name the profile's model", describe(shape));
        assert_eq!(request.body["stream"], false, "{} wants one definitive answer, not a stream", describe(shape));
    }
    // 四发请求、三种形状：文本（streaming 与 json 各一发）、带图、带工具。
    // **两项能力不共用同一发请求** —— 否则"这一发成功了"就会同时点亮两个徽章，
    // 而那正是计划里那句"a successful text ping must not mark vision or tools verified"
    // 想防的事（文本与 JSON 共用形状，但是两次独立的请求）。
    let calls = transport.calls();
    assert_eq!(calls.len(), 4, "every capability needs its own request: {calls:?}");
    assert!(transport.sent(Shape::Image), "vision needs a request that actually carries an image");
    assert!(transport.sent(Shape::Tools), "tools needs a request that actually carries a tool table");
    assert_eq!(report.profile_revision, 4, "the report must say which revision it is evidence for");
}

#[test]
fn a_text_request_never_carries_a_tool_schema_or_an_image() {
    // 这一条守的是"证据的纯度"：如果文本探针顺手带了工具表，那么
    // "文本探针成功"与"工具能用"就分不开了。
    let transport = ByShape::new(capable);
    let source = FakeSource { secret: Some("sk-live-secret".to_string()) };
    let stop = NoStop::new();

    let _ = Probe::new(&source, &transport, profile(), stop.as_ref()).run().expect("the profile must be probed");
    let text = transport.request_of(Shape::Text);

    assert!(text.body.get("tools").is_none(), "the text probe must not carry a tool schema");
    assert!(text.messages.iter().all(|message| message.images.is_empty()), "the text probe must not carry an image");
}

#[test]
fn the_tools_probe_carries_a_tool_schema_and_asks_for_it() {
    // 不强制的话模型会跟你聊天，于是"没有工具调用"这个观测毫无意义 ——
    // 而它会被读成"不支持工具"。所以形状本身要断言。
    let transport = ByShape::new(capable);
    let source = FakeSource { secret: Some("sk-live-secret".to_string()) };
    let stop = NoStop::new();

    let _ = Probe::new(&source, &transport, profile(), stop.as_ref()).run().expect("the profile must be probed");
    let tools = transport.request_of(Shape::Tools);

    let schema = tools.body.get("tools").and_then(|value| value.as_array()).expect("the tool probe must carry a tool schema");
    assert!(!schema.is_empty(), "an empty tool table tells the provider nothing");
    assert_eq!(tools.body["tool_choice"], "required", "the probe must ask for the tool, not hope for it");
    let name = schema[0]["function"]["name"].as_str().unwrap_or_default().to_string();
    assert!(name.contains("probe"), "the tool must be recognisably ours: {name}");
}

#[test]
fn the_image_probe_carries_a_real_png_on_a_message() {
    let transport = ByShape::new(capable);
    let source = FakeSource { secret: Some("sk-live-secret".to_string()) };
    let stop = NoStop::new();

    let _ = Probe::new(&source, &transport, profile(), stop.as_ref()).run().expect("the profile must be probed");
    let image = transport.request_of(Shape::Image);

    // 一张 1×1 的 PNG 必须真的在请求里（不然"看图"这件事根本没发生）。
    let serialized = image.body.to_string();
    assert!(serialized.contains("iVBORw0KGgo"), "the probe must send a real PNG: {serialized}");
    // 消息里存的是**裸 base64**，`data:` 前缀是拼请求时按方言加的（各家位置不同）。
    let message = image.messages.iter().find(|message| !message.images.is_empty()).expect("the image must ride on a message");
    assert!(!message.images[0].starts_with("data:"), "the prefix belongs to the wire shape, not to the message");
    // OpenAI 兼容的线上形状用 data URL 讲图片在哪。
    assert!(serialized.contains("data:image/png;base64,"), "a compatible endpoint needs the data URL form: {serialized}");
}

#[test]
fn the_image_probe_does_not_carry_tools_even_though_the_adapter_can() {
    // 有些 provider 带图 + 强制工具会 400。图片探针要测的是"图片这件事"
    // 能不能成，混进工具就把两件事搅在一起了。
    let transport = ByShape::new(capable);
    let source = FakeSource { secret: Some("sk-live-secret".to_string()) };
    let stop = NoStop::new();

    let _ = Probe::new(&source, &transport, profile(), stop.as_ref()).run().expect("the profile must be probed");

    assert!(transport.request_of(Shape::Image).body.get("tools").is_none(), "the image probe must not carry tools");
}

// ---------------------------------------------------------------- 证据的边界

#[test]
fn every_probe_feature_gets_an_evidence_entry_even_when_nothing_could_be_sent() {
    // "没有证据"与"未知"是两件事：界面要能显示四个徽章，而不是三个。
    let source = FakeSource { secret: None };
    let transport = ByShape::new(capable);
    let stop = NoStop::new();

    let report = Probe::new(&source, &transport, profile(), stop.as_ref()).run().expect("a report without a credential is still a report");

    for feature in PROBE_FEATURES {
        assert_eq!(report.evidence(feature), Some(CapabilityStatus::Unknown), "{feature:?} must be reported as unknown, not omitted");
        assert!(!report.detail(feature).unwrap_or_default().is_empty(), "{feature:?} needs a reason a user can read");
    }
    // **一次都没发**：没有密钥时不该去敲别人的门。
    assert!(transport.calls().is_empty(), "a profile without a credential must not be probed");
    assert_eq!(report.profile_revision, 4);
}

#[test]
fn a_rejected_credential_verifies_nothing_instead_of_reading_as_unsupported() {    let source = FakeSource { secret: Some("sk-live-secret".to_string()) };
    let transport = ByShape::new(|_shape: Shape, _request: &ProviderRequest| -> Result<String, ProviderError> { Err(http_failure(401)) });
    let stop = NoStop::new();

    let report = Probe::new(&source, &transport, profile(), stop.as_ref()).run().expect("the report must come back");

    // 认证失败对"这家支不支持工具"什么都不说明。把它记成 `failed` 会让界面
    // 建议用户换模型，而真正该做的是去设置里换密钥。
    for feature in PROBE_FEATURES {
        assert_eq!(report.evidence(feature), Some(CapabilityStatus::Unknown), "{feature:?} must stay unknown after a 401");
    }
}

#[test]
fn a_rejected_image_request_is_failed_because_the_request_shape_is_ours_to_get_right() {
    // 图片请求的形状由我们拼：被 400 拒掉是我们发错了，不是"这家不支持图片"。
    // 两者必须分开 —— 前者要改代码，后者要改配置。
    let source = FakeSource { secret: Some("sk-live-secret".to_string()) };
    let transport = ByShape::new(|shape: Shape, _request: &ProviderRequest| -> Result<String, ProviderError> {
        if shape == Shape::Image {
            return Err(http_failure(400));
        }
        Ok(sse("pong"))
    });
    let stop = NoStop::new();

    let report = Probe::new(&source, &transport, profile(), stop.as_ref()).run().expect("the report must come back");

    assert_eq!(report.evidence(Feature::Vision), Some(CapabilityStatus::Failed));
    // 而文本那两条不受影响：一条探针失败不该把别的结论一起拖下水。
    assert_eq!(report.evidence(Feature::Streaming), Some(CapabilityStatus::Verified));
}

#[test]
fn an_empty_reply_to_the_image_request_is_failed_not_verified() {
    // "回了 200 但什么都没说"是很常见的一种回法（模型不认识那个模型名、
    // 或者网关吞掉了 body）。把它当成功会让 `vision` 永远绿着。
    let source = FakeSource { secret: Some("sk-live-secret".to_string()) };
    let transport = ByShape::new(|shape: Shape, _request: &ProviderRequest| -> Result<String, ProviderError> {
        if shape == Shape::Image {
            return Ok(String::new());
        }
        Ok(sse("pong"))
    });
    let stop = NoStop::new();

    let report = Probe::new(&source, &transport, profile(), stop.as_ref()).run().expect("the report must come back");

    assert_eq!(report.evidence(Feature::Vision), Some(CapabilityStatus::Failed));
}

// ---------------------------------------------------------------- 工具探针的三种结论

#[test]
fn a_tool_call_proves_the_tools_capability() {
    let transport = ByShape::new(capable);
    let source = FakeSource { secret: Some("sk-live-secret".to_string()) };
    let stop = NoStop::new();

    let report = Probe::new(&source, &transport, profile(), stop.as_ref()).run().expect("the profile must be probed");

    assert_eq!(report.evidence(Feature::Tools), Some(CapabilityStatus::Verified));
}

#[test]
fn a_provider_that_knows_the_tool_but_uses_it_wrongly_still_counts_as_supporting_tools() {
    // 观测到的工具名**只有拿到工具表才可能知道**。那证明的是"它支持工具"，
    // 不是"它不支持" —— 我们自己的参数形状错了而已。
    let transport = ByShape::new(|shape: Shape, _request: &ProviderRequest| -> Result<String, ProviderError> {
        if shape == Shape::Tools {
            // 参数是半截 JSON（故意写坏），但名字对得上。
            return Ok("data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"function\":{\"name\":\"mathcanvas_capability_probe\",\"arguments\":\"{oops\"}}]}}]}\n\ndata: [DONE]\n\n".to_string());
        }
        Ok(sse("pong"))
    });
    let source = FakeSource { secret: Some("sk-live-secret".to_string()) };
    let stop = NoStop::new();

    let report = Probe::new(&source, &transport, profile(), stop.as_ref()).run().expect("the profile must be probed");

    assert_eq!(report.evidence(Feature::Tools), Some(CapabilityStatus::Verified));
}

#[test]
fn a_refusal_to_use_the_tool_is_unknown_not_failed() {
    // 模型聊了两句就是不肯调工具 —— 这在真实世界里天天发生。
    // 把它记成"不支持工具"会让用户白换一家 provider。
    let transport = ByShape::new(|shape: Shape, _request: &ProviderRequest| -> Result<String, ProviderError> {
        if shape == Shape::Tools {
            return Ok(sse("I would rather not call a tool."));
        }
        Ok(sse("pong"))
    });
    let source = FakeSource { secret: Some("sk-live-secret".to_string()) };
    let stop = NoStop::new();

    let report = Probe::new(&source, &transport, profile(), stop.as_ref()).run().expect("the profile must be probed");

    assert_eq!(report.evidence(Feature::Tools), Some(CapabilityStatus::Unknown), "a refusal is not a failure");
    // 而理由要写清楚 —— 否则界面只能显示"未验证"，用户没法知道是"没试过"还是"试过但说不清"。
    assert!(report.detail(Feature::Tools).unwrap_or_default().contains("instead of calling"), "the reason must name what happened: {:?}", report.detail(Feature::Tools));
}

#[test]
fn a_rejected_tool_request_is_failed_because_the_tool_table_is_ours_to_get_right() {
    // 与图片同理：`tools` 字段与 `tool_choice` 都是我们拼的。
    let transport = ByShape::new(|shape: Shape, _request: &ProviderRequest| -> Result<String, ProviderError> {
        if shape == Shape::Tools {
            return Err(http_failure(400));
        }
        Ok(sse("pong"))
    });
    let source = FakeSource { secret: Some("sk-live-secret".to_string()) };
    let stop = NoStop::new();

    let report = Probe::new(&source, &transport, profile(), stop.as_ref()).run().expect("the profile must be probed");

    assert_eq!(report.evidence(Feature::Tools), Some(CapabilityStatus::Failed));
}

// ---------------------------------------------------------------- JSON 探针

#[test]
fn a_json_reply_verifies_the_json_capability_and_prose_does_not() {
    let source = FakeSource { secret: Some("sk-live-secret".to_string()) };
    let stop = NoStop::new();

    let good = ByShape::new(|_shape: Shape, request: &ProviderRequest| -> Result<String, ProviderError> {
        // JSON 探针由**请求里那句话**认出来（它要的正是一个 JSON 对象）。
        let asks_for_json = request.body.to_string().contains("JSON object");
        if asks_for_json {
            return Ok(sse("{\"ok\": true}"));
        }
        Ok(sse("pong"))
    });
    let report = Probe::new(&source, &good, profile(), stop.as_ref()).run().expect("the profile must be probed");
    assert_eq!(report.evidence(Feature::Json), Some(CapabilityStatus::Verified));

    let prose = ByShape::new(|shape: Shape, _request: &ProviderRequest| -> Result<String, ProviderError> { let _ = shape; Ok(sse("Sure! Here is some prose about JSON.")) });
    let report = Probe::new(&source, &prose, profile(), stop.as_ref()).run().expect("the profile must be probed");
    // 一段**提到** JSON 的散文不是 JSON —— 从散文里抠 JSON 正是计划禁止的事。
    assert_eq!(report.evidence(Feature::Json), Some(CapabilityStatus::Failed));
}

// ---------------------------------------------------------------- 写回配置与健康记录

#[test]
fn the_report_writes_four_entries_in_a_stable_order_with_reasons() {
    let transport = ByShape::new(capable);
    let source = FakeSource { secret: Some("sk-live-secret".to_string()) };
    let stop = NoStop::new();

    let report = Probe::new(&source, &transport, profile(), stop.as_ref()).run().expect("the profile must be probed");
    let evidence = report.to_capability_evidence();

    let features: Vec<&str> = evidence.iter().map(|entry| entry.feature.as_str()).collect();
    // 顺序固定：界面上四个徽章不该因为存了一次就换位置。
    assert_eq!(features, vec!["tools", "json", "vision", "streaming"]);
    for entry in &evidence {
        assert!(entry.detail.as_deref().is_some_and(|detail| !detail.is_empty()), "every entry needs a reason: {entry:?}");
    }
    // `verified` 要带时间戳（那是"什么时候验的"）；`unknown` 不带（它不是一次验过）。
    let unknown = evidence.iter().find(|entry| entry.status == "unknown");
    if let Some(entry) = unknown {
        assert!(entry.checked_at.is_none(), "an unknown entry is not a checked thing: {entry:?}");
    }
}

#[test]
fn the_health_record_says_degraded_when_something_is_failed_and_never_says_ok_for_nothing() {
    let source = FakeSource { secret: Some("sk-live-secret".to_string()) };
    let stop = NoStop::new();

    let good = ByShape::new(capable);
    let report = Probe::new(&source, &good, profile(), stop.as_ref()).run().expect("the profile must be probed");
    assert_eq!(report.to_health(Some(120)).status, "ok");
    assert_eq!(report.to_health(Some(120)).latency_ms, Some(120));

    let broken = ByShape::new(|shape: Shape, _request: &ProviderRequest| -> Result<String, ProviderError> {
        if shape == Shape::Tools {
            return Err(http_failure(400));
        }
        Ok(sse("pong"))
    });
    let report = Probe::new(&source, &broken, profile(), stop.as_ref()).run().expect("the profile must be probed");
    assert_eq!(report.to_health(None).status, "degraded", "a failed capability must not read as healthy");

    // **什么都没验出来时不许报 ok**：一次什么都没测成的检查显示成绿灯是最坏的读数。
    let nothing = FakeSource { secret: None };
    let report = Probe::new(&nothing, &good, profile(), stop.as_ref()).run().expect("a report must come back");
    assert_eq!(report.to_health(None).status, "unknown");
}

#[test]
fn every_evidence_entry_fits_the_shape_the_frontend_parses() {
    // 前端与 `agent-core` 都按 `PROVIDER_CAPABILITY_STATUSES` 校验这四档。
    // 拼错一档的后果是**整份配置被拒绝**（不是那一格被忽略）。
    let transport = ByShape::new(capable);
    let source = FakeSource { secret: Some("sk-live-secret".to_string()) };
    let stop = NoStop::new();

    let report = Probe::new(&source, &transport, profile(), stop.as_ref()).run().expect("the profile must be probed");

    for entry in report.to_capability_evidence() {
        assert!(["unknown", "declared", "verified", "failed"].contains(&entry.status.as_str()), "unknown status: {}", entry.status);
        assert!(["tools", "json", "vision", "streaming"].contains(&entry.feature.as_str()), "unknown feature: {}", entry.feature);
        assert!(entry.detail.as_deref().unwrap_or("").len() <= 200, "the frontend truncates at 200; longer means we lost text: {entry:?}");
    }
}

/// 一份健康记录（`capabilityEvidence` 走 serde，与磁盘上那份 JSON 同一个形状）。
fn health(profile_revision: u32, feature: &str, status: &str) -> ProviderHealth {
    serde_json::from_value(serde_json::json!({
        "status": "ok",
        "capabilityEvidence": [{ "feature": feature, "status": status }],
        "checkedAt": 1,
        "profileRevision": profile_revision
    }))
    .expect("the health record must deserialise")
}

/// **工具表的出口判据**：允许发工具表与否，按**存下来的证据**判，不按方言猜。
///
/// 两条与 TS 侧 `isCapabilityVerified` 逐字相同：只有 `verified` 算数，
/// 而且证据必须属于**当前修订号**。这一条是第二道门 —— 前端已经按证据选过通道，
/// 但那道判据在调用方手里；只在调用方守着的边界，多出一个调用方就没了。
#[test]
fn a_tool_schema_is_only_allowed_when_the_evidence_is_verified_and_current() {
    // 没有记录 → 不放行。"没验过"与"验过不支持"在这一点上同解：都不发。
    assert!(!tools_verified(None, 4));
    // `declared` 是"文档里说支持"，不是"我们验过"。
    assert!(!tools_verified(Some(&health(4, "tools", "declared")), 4));
    // `failed` 更不放行。
    assert!(!tools_verified(Some(&health(4, "tools", "failed")), 4));
    // `unknown` 也不放行（模型不肯配合时得到的就是它）。
    assert!(!tools_verified(Some(&health(4, "tools", "unknown")), 4));
    // verified、但属于**上一版**配置 → 不放行：证据挂在修订号上，配置改过就不算数。
    assert!(!tools_verified(Some(&health(3, "tools", "verified")), 4));
    // verified 且属于当前修订号 → 放行。
    assert!(tools_verified(Some(&health(4, "tools", "verified")), 4));
    // **别的能力验证过不算数**：图像验过了，不代表这家会调工具。
    assert!(!tools_verified(Some(&health(4, "vision", "verified")), 4));
}
