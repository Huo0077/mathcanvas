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
/// `Deserialize` 是给 IPC 用的：前端**只发消息**，密钥与端点都不在参数里
///（它们由 Rust 侧从 profile 与凭据库取）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    /// `system` / `user` / `assistant`。
    pub role: String,
    pub content: String,
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
 * **拼出请求**。
 *
 * `allow_tools` 由调用方按**已验证的能力证据**给出（`isCapabilityVerified(..)`）——
 * 不是按方言猜。两者都要满足才真的带工具：方言支持 **且** 证据说支持。
 */
pub fn build_request(profile: &ProviderProfile, messages: Vec<ChatMessage>, stream: bool, allow_tools: bool) -> ProviderRequest {
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
                .map(|message| serde_json::json!({ "role": message.role, "content": message.content }))
                .collect();
            object.insert("messages".into(), serde_json::json!(dialog));
            object.insert("max_tokens".into(), serde_json::json!(4096));
        }
        _ => {
            object.insert("messages".into(), serde_json::json!(messages));
        }
    }

    if allow_tools && plan.tools_by_default {
        if let Some(field) = &plan.tools_field {
            // 工具 schema 的形状由调用方给（`toolRegistry` 的产物）；这里只保证
            // "要不要带"这个决定有两个前置条件（方言 + 已验证证据）。
            object.insert(field.clone(), serde_json::json!([]));
        }
    }

    ProviderRequest { endpoint, model: profile.model_id.clone(), messages, headers, body, stream, plan }
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
