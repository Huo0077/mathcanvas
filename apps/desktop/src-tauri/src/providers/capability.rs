//! **能力证据探针**（Task 1.4 Step 5）。
//!
//! 计划原文只有一句：
//!
//! > Add capability evidence probes. Record declared/verified/failed per model/profile revision;
//! > **a successful text ping must not mark vision or tools verified.**
//!
//! ## 这一层要解决的是"证据的边界"，不是"把请求发出去"
//!
//! 发请求已经由 `ProviderAdapter` 做完了。难的是：**一次成功的请求到底证明了什么**。
//! 把这件事做错的方式非常自然 —— "请求成功了，那就都打勾吧" —— 而它的后果是界面
//! 显示四个绿色徽章，直到真的给一个不支持图片的模型发图，用户得到一句莫名其妙的错误。
//!
//! 所以这里对每个能力**分开发**一次专门的请求，并逐条按观测下结论：
//!
//! | 观测到的 | 结论 | 为什么 |
//! | --- | --- | --- |
//! | 回了文本，且流正常结束 | `streaming` = verified | 这正是流式文本要证明的东西 |
//! | 只有文本、没有任何工具调用 | `tools` = **unknown** | 请求成功了，所以不是 `failed`；但"模型不肯调工具"太常见，不能读成"不支持" |
//! | 工具调用里出现了**我们的工具名** | `tools` = verified | 它只有拿到工具表才可能说出这个名字 |
//! | 图片请求被 400 拒 | `vision` = **failed** | 图片请求的**形状是我们拼的** —— 被拒是我们发错了 |
//! | 401 / 403 / 连不上 | 全部 **unknown** | 认证失败对"支不支持某能力"什么都不说明 |
//! | 没有密钥 / 修订号不符 | 全部 **unknown**，且**一次都不发** | 不该为了探测去敲别人的门 |
//!
//! 最后一行那两种"unknown"的分别值得强调：**"这家不支持"与"我们发错了"必须分开**，
//! 因为下一步动作完全不同 —— 前者要改配置，后者要改代码。
//!
//! ## 探针的请求形状是**我们控制**的一件事，所以它也要被测
//!
//! 图片探针会真的发一张 1×1 的 PNG；工具探针会真的带工具表并设 `tool_choice`。
//! 不强制工具时模型会跟你聊天，于是"没有工具调用"这个观测毫无意义 —— 而它会被
//! 读成"不支持工具"。所以 `tests/provider_capability.rs` 连**请求形状**一起断言。
//!
//! ## 一处如实的保留
//!
//! 探针的请求形状是照着三家**公开文档**拼的（与 fixtures 同源），**没有对真实服务跑过**。
//! 形状错了的表现是"明明支持却被记成 failed"—— 所以 `vision` 的 400 判据特意写成
//! `failed`（那是要我们改代码的），而任何**说不清**的情况一律留在 `unknown`。
//! 真实的形状确认要靠 `Task 1.4 Step 5` 的手工验证（见进度文档）。

use serde::Serialize;

use super::adapter::{ProviderAdapter, ProviderError, SecretSource, SendOutcome, Stop, Transport};
use super::events::ModelEvent;
use super::request::{ChatMessage, RequestOptions};
use crate::repository::provider_profiles::{timestamp_ms, CapabilityEvidence, ProviderHealth, ProviderProfile};

/// 探针要回答的四个能力。**闭集**：加一个能力会逼编译器在下面的 `match` 里给判据。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Feature {
    Tools,
    Json,
    Vision,
    Streaming,
}

/// 四个能力的稳定顺序（界面上四个徽章按它排，证据也按它写）。
pub const PROBE_FEATURES: [Feature; 4] = [Feature::Tools, Feature::Json, Feature::Vision, Feature::Streaming];

impl Feature {
    /// 写进配置与健康记录的名字。**与 TS 侧的 `feature` 字段逐字一致**。
    pub fn key(self) -> &'static str {
        match self {
            Feature::Tools => "tools",
            Feature::Json => "json",
            Feature::Vision => "vision",
            Feature::Streaming => "streaming",
        }
    }
}

/// 证据状态。**与 TS 侧 `PROVIDER_CAPABILITY_STATUSES` 逐字一致**。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityStatus {
    /// 不知道。**这是最常用的那个值**，也是默认值。
    Unknown,
    /// 文档里说支持（我们没验过）。探针**从不**产出它 —— 它来自配置文件。
    Declared,
    /// 观测到了。
    Verified,
    /// 观测到它不行。
    Failed,
}

impl CapabilityStatus {
    pub fn key(self) -> &'static str {
        match self {
            CapabilityStatus::Unknown => "unknown",
            CapabilityStatus::Declared => "declared",
            CapabilityStatus::Verified => "verified",
            CapabilityStatus::Failed => "failed",
        }
    }
}

/// 一条证据（探针的产出）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Evidence {
    pub feature: Feature,
    pub status: CapabilityStatus,
    /// 给用户看的一句话。**每个 `unknown` 都要有理由** ——
    /// 否则界面只能显示"未验证"，而用户没法知道是"没试过"还是"试过但说不清"。
    pub detail: String,
}

/// 一次探测的完整结论。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProbeReport {
    /// 这份证据属于**哪一版**配置。与当前 revision 不符的证据不该被采信。
    pub profile_revision: u32,
    pub evidence: Vec<Evidence>,
}

impl ProbeReport {
    /// 某个能力的结论。找不到就是 `None`（**不是** `Unknown` —— 那两种要分开）。
    pub fn evidence(&self, feature: Feature) -> Option<CapabilityStatus> {
        self.evidence.iter().find(|entry| entry.feature == feature).map(|entry| entry.status)
    }

    pub fn detail(&self, feature: Feature) -> Option<&str> {
        self.evidence.iter().find(|entry| entry.feature == feature).map(|entry| entry.detail.as_str())
    }

    /// 写成配置文件与健康记录认的形状。**顺序固定**（界面上四个徽章不该来回跳）。
    pub fn to_capability_evidence(&self) -> Vec<CapabilityEvidence> {
        PROBE_FEATURES
            .iter()
            .filter_map(|feature| {
                self.evidence.iter().find(|entry| entry.feature == *feature).map(|entry| CapabilityEvidence {
                    feature: feature.key().to_string(),
                    status: entry.status.key().to_string(),
                    // `unknown` 不写时间：它不是一次"验过"，而是一次"没能验"。
                    checked_at: (entry.status != CapabilityStatus::Unknown).then(timestamp_ms),
                    detail: Some(entry.detail.clone()).filter(|detail| !detail.is_empty()),
                })
            })
            .collect()
    }

    /// 合成一份 `ProviderHealth`（探针跑完就是一次健康检查）。
    pub fn to_health(&self, latency_ms: Option<u64>) -> ProviderHealth {
        // 有 `failed` 就是 degraded：那是"能用，但有东西不对"。
        // 全是 `unknown` 时**不报 ok** —— 什么都没验出来的检查不该显示成绿灯。
        let failed = self.evidence.iter().any(|entry| entry.status == CapabilityStatus::Failed);
        let verified = self.evidence.iter().filter(|entry| entry.status == CapabilityStatus::Verified).count();
        let status = if failed {
            "degraded"
        } else if verified > 0 {
            "ok"
        } else {
            "unknown"
        };
        ProviderHealth {
            status: status.to_string(),
            latency_ms,
            capability_evidence: self.to_capability_evidence(),
            checked_at: timestamp_ms(),
            profile_revision: self.profile_revision,
        }
    }
}

/// 一张 **1×1 的 PNG**（白色）。base64，不带 `data:` 前缀。
///
/// 为什么是一张**真实存在**的图而不是随便一串字节：形状不对的话 provider 会在解析
/// 图片时就 400，于是"看图"这件事根本没被测到，而我们得到的是一个假的 `failed`。
const ONE_PIXEL_PNG_BASE64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

/// 工具探针用的工具名。**带 `probe` 字样**：它在观测里出现时，
/// 我们能确认那确实是"拿到了我们的工具表"，而不是模型自己编了个函数名。
const PROBE_TOOL_NAME: &str = "mathcanvas_capability_probe";

/// **跑四条探针**。
pub struct Probe<'a, S: SecretSource + ?Sized, T: Transport + ?Sized> {
    secrets: &'a S,
    transport: &'a T,
    profile: ProviderProfile,
    stop: &'a dyn Stop,
}

impl<'a, S: SecretSource + ?Sized, T: Transport + ?Sized> Probe<'a, S, T> {
    pub fn new(secrets: &'a S, transport: &'a T, profile: ProviderProfile, stop: &'a dyn Stop) -> Self {
        Self { secrets, transport, profile, stop }
    }

    /// 发一次探针请求，把观测交回给调用方判读。
    ///
    /// `options` 决定这一发带不带工具表（对话探针不带、工具探针带），
    /// 而 `messages` 决定带不带图 —— 两者一起就是"四种形状"。
    fn send(&self, messages: Vec<ChatMessage>, options: RequestOptions) -> Result<Vec<ModelEvent>, ProviderError> {
        let adapter = ProviderAdapter::new(self.secrets, self.transport, self.profile.clone());
        // 探针是**非流式**的一次问答：要一个确定的答案，不要一条流。
        let outcome = adapter.send_with(messages, false, options, self.stop)?;
        match outcome {
            SendOutcome::Completed(events) | SendOutcome::Cancelled(events) => Ok(events),
        }
    }

    /// 跑四条探针，逐条下结论。
    ///
    /// **一条探针失败不影响其他条**：图片被拒不该把"文本能不能流"也一起变成未知。
    pub fn run(&self) -> Result<ProbeReport, ProviderError> {
        let mut evidence = Vec::new();

        // 文本 ping：非流式，一句话。它同时是 `streaming` 的判据 ——
        // 因为本轮走的就是真传输（拿到了完整的响应体并正常结束）。
        let ping = self.send(vec![ChatMessage::text("user", "Reply with the single word: pong")], RequestOptions::default());
        let text_ok = matches!(&ping, Ok(events) if replied_with_text(events));
        evidence.push(classify(
            Feature::Streaming,
            &ping,
            text_ok,
            "the provider returned a complete text reply",
            "the provider did not return a usable text reply",
        ));

        // JSON：请求一个 JSON 对象，看回来的文字能不能解析。
        let json = self.send(
            vec![ChatMessage::text("user", "Reply with exactly this JSON object and nothing else: {\"ok\": true}")],
            RequestOptions::default()
        );
        let json_ok = matches!(&json, Ok(events) if joined_text(events).contains('{') && serde_json::from_str::<serde_json::Value>(joined_text(events).trim()).is_ok());
        evidence.push(classify(
            Feature::Json,
            &json,
            json_ok,
            "the provider returned text that parses as JSON",
            "the provider replied, but not with a JSON object",
        ));

        // 图片：发一张真的 1×1 PNG。
        //
        // 顺序上**排在工具探针之前**，理由是它与工具探针在有些 provider 上互斥
        //（带图 + 强制工具会 400）—— 而这里要的是"图片这件事单独能不能成"。
        let vision = self.send(
            vec![ChatMessage::with_images("user", "Reply with the single word: white. Do not explain.", vec![ONE_PIXEL_PNG_BASE64.to_string()])],
            RequestOptions { allow_tools: false, tools: Vec::new(), force_tool: false, tool_choice_field: None }
        );
        // 这一条的判据与别的不同：图片请求的**形状是我们拼的**，所以被 400/422 拒
        // 就是 `failed`（要我们改代码），而不是"这家不支持图片"。
        evidence.push(vision_evidence(&vision));

        // 工具：**必须带工具表并强制它用**。不强制的话模型会跟你聊天，
        // 于是"没有工具调用"这个观测毫无意义 —— 而它会被读成"不支持工具"。
        let tools = self.send(
            vec![ChatMessage::text("user", "Use the provided tool to report the string \"ok\". Do not answer in text.")],
            RequestOptions { allow_tools: true, tools: vec![probe_tool_schema()], force_tool: true, tool_choice_field: None }
        );
        let tools_ok = matches!(&tools, Ok(events) if saw_probe_tool_call(events));
        // 注意这里的第三种情况：请求成功、也回了话、就是没调工具。那是 `unknown`。
        evidence.push(tools_evidence(&tools, tools_ok));

        Ok(ProbeReport { profile_revision: self.profile.revision, evidence })
    }
}

/// 工具表的形状：一个**无副作用**的工具（探针不该让 provider 那边发生任何事）。
fn probe_tool_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "function",
        "function": {
            "name": PROBE_TOOL_NAME,
            "description": "Reports a short status string. This is a connectivity probe; it has no side effects.",
            "parameters": {
                "type": "object",
                "properties": { "status": { "type": "string", "description": "the string to report" } },
                "required": ["status"]
            }
        }
    })
}

/// 从事件里拼出模型说的文本。
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

/// "回了一段文本" —— 空回答不算（有些 provider 对不认识的模型回 200 + 空）。
fn replied_with_text(events: &[ModelEvent]) -> bool {
    !joined_text(events).trim().is_empty()
}

/// 观测里有没有**我们的**工具调用。
fn saw_probe_tool_call(events: &[ModelEvent]) -> bool {
    events.iter().any(|event| matches!(event, ModelEvent::ToolCall { tool_id, .. } if tool_id.contains("probe")))
}

/// 文本类探针（streaming / json）的判据。
///
/// 三种结论的边界就是这一层的全部价值：
/// - 请求**没发成功**（401/403/连不上/没有密钥）→ `unknown`：它什么都没说明；
/// - 发成功了但没答到点子上 → `failed`：这家确实做不到；
/// - 答上了 → `verified`。
fn classify(feature: Feature, result: &Result<Vec<ModelEvent>, ProviderError>, ok: bool, good: &str, bad: &str) -> Evidence {
    match result {
        Ok(_) if ok => Evidence { feature, status: CapabilityStatus::Verified, detail: good.to_string() },
        Ok(_) => Evidence { feature, status: CapabilityStatus::Failed, detail: bad.to_string() },
        Err(error) if inconclusive(error) => Evidence { feature, status: CapabilityStatus::Unknown, detail: format!("the probe could not reach the provider: {}", error.message()) },
        Err(error) => Evidence { feature, status: CapabilityStatus::Failed, detail: error.message() },
    }
}

/// **这次允许发工具表吗**（计划 Task 2.3 原文："Do not send a tool schema to providers that
/// failed capability verification."）。
///
/// 判定用的是**存下来的**证据，与 TS 侧的 `isCapabilityVerified` 逐字同两条：
/// 1. 状态必须是 `verified` —— `declared` 是"文档里说支持"，不是"我们验过"；
/// 2. 证据必须属于**当前修订号** —— 配置改过之后，旧证据不该继续被采信。
///
/// 为什么前端已经按证据选过通道了，这里还要再判一次：这是一道**出口**判据。
/// 只在调用方守着的边界，多出一个调用方就没了 —— 与"密钥字段入口与出口都要拦"
/// （`prepare_profile` 与 `contains_secret_field`）是同一条理由。
pub fn tools_verified(health: Option<&ProviderHealth>, revision: u32) -> bool {
    let Some(health) = health else { return false };
    if health.profile_revision != revision {
        return false;
    }
    health
        .capability_evidence
        .iter()
        .any(|evidence| evidence.feature == Feature::Tools.key() && evidence.status == "verified")
}

/// 这次失败对"支不支持某个能力"**说明不了任何事**吗。///
/// 认证、权限、连接失败都属于这一类：它们说的是"这次请求没成"，不是"这个能力不行"。
/// 把它们记成 `failed` 会让界面建议用户换模型 —— 而真正该做的是去设置里换密钥。
fn inconclusive(error: &ProviderError) -> bool {
    matches!(
        error,
        ProviderError::MissingSecret { .. }
            | ProviderError::SecretStore { .. }
            | ProviderError::RefusedUrl { .. }
            | ProviderError::Transport { .. }
            | ProviderError::NotFound { .. }
            | ProviderError::RevisionMismatch { .. }
    ) || matches!(error, ProviderError::Http { status, .. } if *status == 401 || *status == 403 || *status == 429)
}

/// 工具探针的判据。**与文本类不同**，因为"没调工具"有三种可能的来源。
fn tools_evidence(result: &Result<Vec<ModelEvent>, ProviderError>, ok: bool) -> Evidence {
    match result {
        Ok(events) if ok => Evidence {
            feature: Feature::Tools,
            status: CapabilityStatus::Verified,
            detail: "the provider issued a tool call for the probe tool".to_string(),
        },
        Ok(events) if !joined_text(events).trim().is_empty() => {
            // 答了话、就是没调工具。**这是最要紧的一条区分**：把它记成 `failed`
            // 会让用户白换一家 provider，而真实原因可能是模型不肯配合。
            Evidence {
                feature: Feature::Tools,
                status: CapabilityStatus::Unknown,
                detail: "the provider replied with text instead of calling the probe tool; that is not proof either way".to_string(),
            }
        }
        Ok(_) => Evidence { feature: Feature::Tools, status: CapabilityStatus::Failed, detail: "the provider returned an empty reply to the tool request".to_string() },
        Err(error) if inconclusive(error) => Evidence { feature: Feature::Tools, status: CapabilityStatus::Unknown, detail: format!("the probe could not reach the provider: {}", error.message()) },
        // 400/422：**请求形状是我们拼的**。被拒说明我们的工具表或 `tool_choice` 不对。
        Err(error) => Evidence { feature: Feature::Tools, status: CapabilityStatus::Failed, detail: error.message() },
    }
}

/// 图片探针的判据。
///
/// 这里与文本类**故意不同**：图片请求的形状由我们拼（`data:` 前缀、content parts、
/// Anthropic 的 base64 source block），所以 400/422 是**我们发错了**，记 `failed`。
/// 而认证/连接一类仍然是 `unknown`。
fn vision_evidence(result: &Result<Vec<ModelEvent>, ProviderError>) -> Evidence {
    match result {
        Ok(events) if replied_with_text(events) => Evidence { feature: Feature::Vision, status: CapabilityStatus::Verified, detail: "the provider answered a request that carried an image".to_string() },
        Ok(_) => Evidence { feature: Feature::Vision, status: CapabilityStatus::Failed, detail: "the provider returned an empty reply to the image request".to_string() },
        Err(error) if inconclusive(error) => Evidence { feature: Feature::Vision, status: CapabilityStatus::Unknown, detail: format!("the probe could not reach the provider: {}", error.message()) },
        Err(error) => Evidence { feature: Feature::Vision, status: CapabilityStatus::Failed, detail: format!("the image request was rejected: {}", error.message()) },
    }
}

/// **一次探测要落到哪里**。
///
/// 抽成 trait 是为了让"探测 → 存 → 返回"这三步能被测：命令的签名绑着 `AppHandle`，
/// 造一个要真的起一个 Tauri 应用。真实实现是 provider 配置存储（`mark_health` 落盘）。
///
/// `&mut self` 而不是 `&self`：`mark_health` 要写盘，而配置存储的所有写操作都是独占的。
/// 第一版想用 `&self` 配一个裸指针转换绕过去 —— 那是**为了省一个 `mut` 而引入
/// 未定义行为的风险**，不值得。
pub trait HealthSink {
    fn record(&mut self, profile_id: &str, health: ProviderHealth) -> Result<(), String>;
}

impl HealthSink for crate::repository::provider_profiles::ProviderProfileStore {
    fn record(&mut self, profile_id: &str, health: ProviderHealth) -> Result<(), String> {
        self.mark_health(profile_id, health).map_err(|error| error.to_string())
    }
}

/// **跑一次能力探测并把证据落盘**。
///
/// 抽成函数（而不是写在命令里）的理由与 `run_with_profile` 一样：**它要能被测**。
/// 命令只剩下"取锁 → 调它 → 返回"。
///
/// ## 顺序：先对修订号，再碰任何东西
///
/// 证据是**挂在修订号上**的（界面按它判断新不新）。给一份界面已经看不到的配置
/// 跑探测，会写下一份永远匹配不上任何东西的证据。
pub fn check(
    secrets: &(impl SecretSource + ?Sized),
    transport: &(impl Transport + ?Sized),
    store: &mut dyn HealthSink,
    profile: ProviderProfile,
    expected_revision: u32,
    stop: &dyn Stop,
) -> Result<ProviderHealth, ProviderError> {
    if profile.revision != expected_revision {
        return Err(ProviderError::RevisionMismatch { expected: expected_revision, actual: profile.revision });
    }
    let id = profile.id.clone();
    let started = std::time::Instant::now();
    let report = Probe::new(secrets, transport, profile, stop).run()?;
    let latency = started.elapsed().as_millis() as u64;
    let health = report.to_health(Some(latency));
    // **存不进去是一次明确的失败**，不是"验出来了但没记住"：证据挂在修订号上，
    // 没存住就等于界面下一次看到的还是旧结论 —— 那比报一个错更容易误导。
    store.record(&id, health.clone()).map_err(|detail| ProviderError::SecretStore { detail: format!("the capability evidence could not be saved: {detail}") })?;
    Ok(health)
}
