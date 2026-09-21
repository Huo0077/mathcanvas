//! **从一份已校验的 profile 拼出 provider 请求**（Task 1.4 Step 3/4）。
//!
//! 计划原文："`ProviderRequest` is built from a validated profile and normalized messages;
//! it has **no caller-supplied arbitrary URL/header map**."
//!
//! ## 这条约束为什么必须落在类型上
//!
//! 如果请求类型里有 `url: String` 与 `headers: HashMap<String, String>`，那么"不许任意 URL"
//! 就只是一句规矩 —— 而规矩会被绕过（"临时加一个 header"是最常见的滑坡）。
//! 所以这里：
//! - `endpoint` **由 `base_url` + 常量路径拼出**，调用方给不了整条 URL；
//! - header **只有两份白名单**（认证 + 内容类型），没有"额外 header"这个口子；
//! - **方言决定形状**：`generic_compatible` 默认**不带工具**（计划 Step 3："Do not assume
//!   every compatible service supports the same tools, JSON, vision, or streaming shape."）。

use serde::{Deserialize, Serialize};

use crate::repository::provider_profiles::ProviderProfile;

/// 一条归一化消息。三家 provider 的"消息"只有这两种角色，差异在适配器里处理。
///
/// `images`：**base64 的图片字节**（不带 `data:` 前缀）。目前只有能力探针会带它 ——
/// 真模型运行里的图片输入是另一条线（附件两阶段写），但请求形状是同一个位置。
///
/// `Deserialize` 是给 IPC 用的：前端**只发消息**，密钥与端点都不在参数里
///（它们由 Rust 侧从 profile 与凭据库取）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    /// `system` / `user` / `assistant`。
    pub role: String,
    pub content: String,
    /// 附在**这一条**消息上的图片（base64，不带前缀）。空数组不进请求体。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<String>,
}

impl ChatMessage {
    /// 纯文本的一条。绝大多数调用点要的是这个，所以给它一个不用写 `images: Vec::new()` 的写法。
    pub fn text(role: impl Into<String>, content: impl Into<String>) -> Self {
        Self { role: role.into(), content: content.into(), images: Vec::new() }
    }

    /// 一条带图的用户消息。`images` 是 base64（不带 `data:` 前缀）。
    pub fn with_images(role: impl Into<String>, content: impl Into<String>, images: Vec<String>) -> Self {
        Self { role: role.into(), content: content.into(), images }
    }
}

/// 一次 provider 请求的**计划**（还缺密钥 —— 密钥在 `Task 1.2` 的凭据库里，
/// 由调用方在真正发送的那一刻借出，**不进这个结构体**）。
#[derive(Debug, Clone, PartialEq)]
pub struct ProviderRequest {
    /// 完整端点。**由 `base_url` + 常量路径拼出**，不是调用方给的。
    pub endpoint: String,
    pub model: String,
    pub messages: Vec<ChatMessage>,
    /// 只在这一份白名单里。没有"额外 header"这个口子。
    pub headers: Vec<(String, String)>,
    pub body: serde_json::Value,
    pub stream: bool,
    /// 方言带来的**显式差异**：允许发工具 schema 吗、允许带图吗。
    pub plan: RequestPlan,
}

/// 方言决定的能力**形状**（不是"支不支持"——那是能力证据的事，见 `Task 1.4 Step 5`）。
///
/// 这里说的是"这个方言的**请求**长什么样"：路径、认证头名、工具字段名。
/// 支不支持由运行时的**已验证证据**决定（`isCapabilityVerified`）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestPlan {
    pub dialect: String,
    /// 认证头的名字（`Authorization` / `x-api-key`）。
    pub auth_header: String,
    /// 认证值的前缀（`Bearer ` / 空）。
    pub auth_prefix: String,
    /// 工具 schema 放在哪个字段里（`tools` / 无）。
    pub tools_field: Option<String>,
    /// 这条路径是否**默认**允许发工具 schema。
    ///
    /// `generic_compatible` 是 `false` —— 那正是计划 Step 3 要求的"不要假设每一家兼容服务
    /// 都支持同一套工具"的落点。要用工具，得先有**已验证**的能力证据。
    pub tools_by_default: bool,
}

/// 路径按方言定。**常量表**，调用方给不了。
fn path_for(protocol: &str) -> &'static str {
    match protocol {
        "anthropic" => "/messages",
        // OpenAI 兼容与 Ollama 都用 `/chat/completions`（Ollama 的 OpenAI 兼容层）。
        _ => "/chat/completions",
    }
}

fn plan_for(protocol: &str, dialect: &str) -> RequestPlan {
    match protocol {
        "anthropic" => RequestPlan {
            dialect: dialect.to_string(),
            auth_header: "x-api-key".to_string(),
            auth_prefix: String::new(),
            tools_field: Some("tools".to_string()),
            // Anthropic 的工具调用是官方能力，但**仍然要已验证证据**才真的发（见 `build_request`）。
            tools_by_default: true,
        },
        "ollama" => RequestPlan {
            dialect: dialect.to_string(),
            auth_header: "Authorization".to_string(),
            auth_prefix: "Bearer ".to_string(),
            tools_field: Some("tools".to_string()),
            tools_by_default: true,
        },
        _ => RequestPlan {
            dialect: dialect.to_string(),
            auth_header: "Authorization".to_string(),
            auth_prefix: "Bearer ".to_string(),
            tools_field: Some("tools".to_string()),
            // **唯一**默认不发工具的一档：泛化的"OpenAI 兼容"。
            tools_by_default: dialect != "generic_compatible",
        },
    }
}

/**
 * **拼请求时能带的东西**。
 *
 * 为什么不是一串 `bool` 参数：`allow_tools` 与 `tool_choice` 都是布尔，位置一换就会
 * 静默反了 —— 而"要不要带工具"与"要不要强制它用工具"是**两个**决定（探针要后者、
 * 真运行通常不要）。（第一版就是 `build_request(.., allow_tools, force_tool)`，
 * 在调用点读起来完全分不出谁是谁。）
 */
#[derive(Debug, Clone, PartialEq, Default)]
pub struct RequestOptions {
    /// 允许发工具 schema 吗。由调用方按**已验证的能力证据**给出，不是按方言猜。
    pub allow_tools: bool,
    /// 工具 schema 本体。空数组时按"这个能力还没被验证过"处理 ——
    /// 也就是说**不会**因为 `allow_tools` 为真就发一个空工具表（那等于告诉 provider
    /// "我支持工具"却什么工具都没给）。
    pub tools: Vec<serde_json::Value>,
    /// 强制使用工具（`tool_choice: "required"`）。
    ///
    /// 只有**能力探针**用它：不强制的话，模型会跟你聊天而不是调工具，
    /// 于是"没有工具调用"这个观测会被误读成"不支持工具"。
    pub force_tool: bool,
    /// 图片请求时把 `tool_choice` 设成 `none`（有些 provider 带图时拒绝工具）。
    /// 目前没用上；留它是因为"图片请求与工具请求互斥"这条规则会需要它。
    pub tool_choice_field: Option<String>,
}

/// 只放行工具、不带 schema 的写法（绝大多数调用点的意思就是这个）。
pub fn allow_tools() -> RequestOptions {
    RequestOptions { allow_tools: true, ..RequestOptions::default() }
}

/**
 * **拼出请求**。
 *
 * `options.allow_tools` 由调用方按**已验证的能力证据**给出（`isCapabilityVerified(..)`）——
 * 不是按方言猜。三个条件都要满足才真的带工具：方言支持 **且** 证据说支持 **且**
 * 调用方给了工具表。
 */
pub fn build_request(profile: &ProviderProfile, messages: Vec<ChatMessage>, stream: bool, options: RequestOptions) -> ProviderRequest {
    let plan = plan_for(&profile.protocol, &profile.dialect);
    // 末尾斜杠已经在存储层去过（`providerContracts.normalizeBaseUrl`），这里再兜一次：
    // 拼接出 `//chat/completions` 会让某些网关 404，而那种失败看起来像"地址不对"。
    let base = profile.base_url.trim_end_matches('/');
    let endpoint = format!("{base}{}", path_for(&profile.protocol));

    let mut headers = vec![("content-type".to_string(), "application/json".to_string())];
    // 认证头**在这里留空值**：真正的密钥由调用方在发送那一刻借出并填入。
    // 这样"请求体里有没有密钥"这个问题在类型层就有答案：没有。
    headers.push((plan.auth_header.clone(), String::new()));

    let mut body = serde_json::json!({
        "model": profile.model_id,
        "stream": stream
    });
    let object = body.as_object_mut().expect("object");
    match profile.protocol.as_str() {
        "anthropic" => {
            // Anthropic 的 system 是**顶层字段**，不是消息里的一条。
            let system: Vec<&ChatMessage> = messages.iter().filter(|message| message.role == "system").collect();
            if let Some(first) = system.first() {
                object.insert("system".into(), serde_json::json!(first.content));
            }
            let dialog: Vec<serde_json::Value> = messages
                .iter()
                .filter(|message| message.role != "system")
                .map(anthropic_message)
                .collect();
            object.insert("messages".into(), serde_json::json!(dialog));
            object.insert("max_tokens".into(), serde_json::json!(4096));
        }
        "ollama" => {
            // Ollama 原生的图片在消息的 `images` 数组里（**裸 base64**，没有 `data:` 前缀）。
            let dialog: Vec<serde_json::Value> = messages
                .iter()
                .map(|message| {
                    if message.images.is_empty() {
                        serde_json::json!({ "role": message.role, "content": message.content })
                    } else {
                        serde_json::json!({ "role": message.role, "content": message.content, "images": message.images })
                    }
                })
                .collect();
            object.insert("messages".into(), serde_json::json!(dialog));
        }
        _ => {
            let dialog: Vec<serde_json::Value> = messages.iter().map(openai_message).collect();
            object.insert("messages".into(), serde_json::json!(dialog));
        }
    }

    if options.allow_tools && plan.tools_by_default && !options.tools.is_empty() {
        if let Some(field) = &plan.tools_field {
            object.insert(field.clone(), serde_json::json!(options.tools));
        }
        if options.force_tool {
            // 三种方言都认 `tool_choice`，但取值不同：OpenAI 兼容与 Ollama 用 `required`，
            // Anthropic 用 `any`。写错那一个的后果是 **400**，而 400 会被读成"这家不支持工具" ——
            // 正是探针最容易误报的地方。
            let required = if profile.protocol == "anthropic" { "any" } else { "required" };
            object.insert("tool_choice".into(), serde_json::json!(required));
        }
    }

    ProviderRequest { endpoint, model: profile.model_id.clone(), messages, headers, body, stream, plan }
}

/// OpenAI 兼容的一条消息。带图时 `content` 变成 **parts 数组**（纯文本时保持字符串 ——
/// 有些网关只认字符串那种形状，能少变一处就少变一处）。
fn openai_message(message: &ChatMessage) -> serde_json::Value {
    if message.images.is_empty() {
        return serde_json::json!({ "role": message.role, "content": message.content });
    }
    let mut parts: Vec<serde_json::Value> = vec![serde_json::json!({ "type": "text", "text": message.content })];
    for image in &message.images {
        // `data:` 前缀是必须的：裸 base64 在这里会被当成一个 URL 去取。
        parts.push(serde_json::json!({
            "type": "image_url",
            "image_url": { "url": format!("data:image/png;base64,{image}") }
        }));
    }
    serde_json::json!({ "role": message.role, "content": parts })
}

/// Anthropic Messages 的一条消息。图片是 content block 里的 `source`（base64 **裸值**）。
fn anthropic_message(message: &ChatMessage) -> serde_json::Value {
    if message.images.is_empty() {
        return serde_json::json!({ "role": message.role, "content": message.content });
    }
    let mut blocks: Vec<serde_json::Value> = vec![serde_json::json!({ "type": "text", "text": message.content })];
    for image in &message.images {
        blocks.push(serde_json::json!({
            "type": "image",
            "source": { "type": "base64", "media_type": "image/png", "data": image }
        }));
    }
    serde_json::json!({ "role": message.role, "content": blocks })
}

/// 把密钥填进认证头。**只在真正发送之前调用**，而且返回值不落到任何持久化的地方。
pub fn authorize(request: &ProviderRequest, secret: &str) -> Vec<(String, String)> {
    request
        .headers
        .iter()
        .map(|(name, value)| {
            if name == &request.plan.auth_header && value.is_empty() {
                (name.clone(), format!("{}{secret}", request.plan.auth_prefix))
            } else {
                (name.clone(), value.clone())
            }
        })
        .collect()
}
