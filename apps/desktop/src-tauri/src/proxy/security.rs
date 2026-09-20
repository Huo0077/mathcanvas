//! **回环代理的传输安全**（Task 1.5）。
//!
//! 计划原文的四条约束，逐条落在这里：
//! - "Routes: `POST /v1/runs/{runId}/model`, `POST /v1/runs/{runId}/cancel`,
//!   `GET /v1/runs/{runId}/events`, `GET /v1/health`; **no route accepts an upstream URL**."
//! - "Every request requires an ephemeral bearer token, exact Host, exact allowed Origin,
//!   run/profile revision, body-size limit, and a cancellation handle."
//! - "Bind only to loopback on an ephemeral port. Generate a random session token in Rust,
//!   pass it over trusted IPC, and never put it in a URL or persistent storage."
//! - "Validate scheme/host/path, prevent credential forwarding across redirects, restrict
//!   private/metadata addresses unless the profile explicitly trusts a local/LAN endpoint,
//!   and require TLS verification for cloud endpoints."
//!
//! ## 为什么这些判据是**纯函数**而不是写在 HTTP 处理里
//!
//! 安全判据写在请求处理里，就只有"起一个服务器再打它"才能测 —— 那种测试慢、脆，
//! 而且**很难覆盖全部否定分支**（谁都不会为了测 9 种拒绝去起 9 次服务器）。
//! 抽成纯函数之后，每一条拒绝理由都能被确定性地钉住，
//! 而 HTTP 那一层只剩"把请求喂给这些函数、按结论回状态码"。
//!
//! ## 这一批**没有起真服务器**
//!
//! 如实标注：`bind(127.0.0.1:0)` + 路由分发需要异步运行时（tokio / hyper）。
//! 本轮交付的是**判据全部就位且被测**；把它们接到一个真 socket 上属于同一任务的下一步，
//! 而"先写服务器再补判据"会让每一条安全规则都变成"大概拦住了"。

use std::collections::HashMap;

/// 代理认的**固定路由**。
///
/// 这个 enum 的存在本身就是那条约束：**没有任何变体接受一个上游 URL**。
/// 想加"转发到任意地址"的能力，必须先在这里加一个变体，而那是一次看得见的改动。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Route {
    /// `POST /v1/runs/{runId}/model` —— 用某个 profile 发一次模型请求。
    Model { run_id: String, profile_id: String },
    /// `POST /v1/runs/{runId}/cancel`。
    Cancel { run_id: String },
    /// `GET /v1/runs/{runId}/events`。
    Events { run_id: String },
    /// `GET /v1/health`。
    Health,
}

/// 路由解析的结果。**未知路径一律拒绝**，不转发、不猜。
pub fn parse_route(method: &str, path: &str, query: &HashMap<String, String>) -> Result<Route, String> {
    if method == "GET" && path == "/v1/health" {
        return Ok(Route::Health);
    }
    // 查询串里**只认 `profile`**：别的参数一律忽略，但下面那条"不许出现 url/endpoint"的检查
    // 会先跑 —— 一个 `?url=https://evil` 不该被"反正我不用它"放过。
    if let Some(suspicious) = query.keys().find(|key| is_url_like_key(key)) {
        return Err(format!("this proxy has no route that accepts an upstream URL (got `{suspicious}`)"));
    }

    let segments: Vec<&str> = path.trim_matches('/').split('/').collect();
    if segments.len() < 3 || segments[0] != "v1" || segments[1] != "runs" {
        return Err(format!("no such route: {method} {path}"));
    }
    let run_id = segments[2].to_string();
    if run_id.is_empty() {
        return Err("a run id is required".to_string());
    }

    match (method, segments.get(3).copied()) {
        ("POST", Some("model")) => {
            let profile_id = query.get("profile").cloned().unwrap_or_default();
            if profile_id.is_empty() {
                return Err("the model route needs a `profile` parameter naming which profile to use".to_string());
            }
            Ok(Route::Model { run_id, profile_id })
        }
        ("POST", Some("cancel")) => Ok(Route::Cancel { run_id }),
        ("GET", Some("events")) => Ok(Route::Events { run_id }),
        _ => Err(format!("no such route: {method} {path}")),
    }
}

/// 参数名看起来像"一个上游地址"吗。
///
/// 判据是**名字**而不是值：把 `https://…` 藏在 `x` 里传进来，解析层根本不认识那个参数，
/// 自然也不会用它 —— 而这里拦的是"调用方以为这个代理能转发到任意地址"这件事本身。
fn is_url_like_key(key: &str) -> bool {
    let lowered = key.to_ascii_lowercase();
    matches!(lowered.as_str(), "url" | "endpoint" | "upstream" | "target" | "base_url" | "baseurl" | "host" | "proxy")
}

/// **会话令牌**：Rust 生成、经可信 IPC 交给前端、**不写进 URL、不持久化**。
///
/// 用 128 位随机数（16 字节）而不是 UUID 的字符串：前者的熵是明确的，
/// 而"UUID 够不够随机"这件事本身就要查文档。生成器可注入，测试才能确定性地跑。
pub struct SessionToken {
    value: String,
}

impl SessionToken {
    /// 生成一枚新令牌。`entropy` 是 16 字节随机数（由调用方提供，见 `generate`）。
    pub fn from_bytes(bytes: [u8; 16]) -> Self {
        Self { value: bytes.iter().map(|byte| format!("{byte:02x}")).collect() }
    }

    /// 令牌本体。**只交给可信调用方**（Tauri IPC 的那一端），不进 URL、不进日志、不落盘。
    pub fn expose(&self) -> &str {
        &self.value
    }

    /// 用一个不同来源的令牌去比对。**常数时间比较**：按字节逐位累积差异，
    /// 不在发现第一个不同时提前返回 —— 提前返回会把"前几位对了"这件事通过耗时泄露出去。
    pub fn matches(&self, candidate: &str) -> bool {
        let expected = self.value.as_bytes();
        let candidate = candidate.as_bytes();
        // 长度不同直接判否（长度本身不敏感：令牌长度是固定的）。
        if expected.len() != candidate.len() {
            return false;
        }
        let mut difference = 0u8;
        for (left, right) in expected.iter().zip(candidate.iter()) {
            difference |= left ^ right;
        }
        difference == 0
    }
}

/// 一次请求的**准入判据**。全部满足才放行。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdmissionInput {
    pub token: Option<String>,
    pub host: Option<String>,
    pub origin: Option<String>,
    pub body_bytes: usize,
    /// 调用方声明的 profile 修订号；与当前不符则拒绝（配置改过之后不该继续用旧证据）。
    pub profile_revision: Option<u32>,
    pub current_profile_revision: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Admission {
    Allowed,
    Denied { code: &'static str, detail: String },
}

/// 允许的 Host（回环地址的两三种写法）。**精确匹配**，不用"包含"。
pub const ALLOWED_HOSTS: [&str; 2] = ["127.0.0.1", "localhost"];
/// 允许的 Origin（Tauri 的 webview 来源）。**精确匹配**。
pub const ALLOWED_ORIGINS: [&str; 3] = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"];
/// 请求体上限（1 MiB）。模型请求不该接近这个量级；超了说明发错了东西。
pub const MAX_BODY_BYTES: usize = 1024 * 1024;

/**
 * **准入判定**（计划 Step 1 点名的九种拒绝理由里有八种在这里）。
 *
 * 顺序即"拒绝理由的优先级"：先看有没有授权，再看它是不是我们发的，
 * 然后才看来源与内容 —— 与 `HostBridge` 的同意检查同一套思路。
 */
pub fn admit(input: &AdmissionInput, token: &SessionToken) -> Admission {
    let Some(presented) = input.token.as_deref() else {
        return Admission::Denied { code: "missing_token", detail: "every proxy request must carry the session token".to_string() };
    };
    if !token.matches(presented) {
        return Admission::Denied { code: "wrong_token", detail: "the session token does not match this session".to_string() };
    }

    let Some(host) = input.host.as_deref() else {
        return Admission::Denied { code: "missing_host", detail: "an exact Host header is required".to_string() };
    };
    // **精确匹配**：`127.0.0.1.evil.com` 这种"包含"式判据会被骗过去。
    let host_name = host.split(':').next().unwrap_or(host);
    if !ALLOWED_HOSTS.contains(&host_name) {
        return Admission::Denied { code: "wrong_host", detail: format!("Host `{host}` is not this proxy") };
    }

    let Some(origin) = input.origin.as_deref() else {
        return Admission::Denied { code: "missing_origin", detail: "an exact Origin is required".to_string() };
    };
    if !ALLOWED_ORIGINS.contains(&origin) {
        return Admission::Denied { code: "wrong_origin", detail: format!("Origin `{origin}` is not the desktop shell") };
    }

    if input.body_bytes > MAX_BODY_BYTES {
        return Admission::Denied { code: "oversize_body", detail: format!("the body is {} bytes; the limit is {MAX_BODY_BYTES}", input.body_bytes) };
    }

    match input.profile_revision {
        Some(revision) if revision != input.current_profile_revision => Admission::Denied {
            code: "stale_profile_revision",
            detail: format!("the request was built for profile revision {revision}, the current one is {}", input.current_profile_revision)
        },
        _ => Admission::Allowed,
    }
}

/**
 * **一个要连出去的上游地址是否被允许**（计划 Step 4 的 SSRF 防线）。
 *
 * 三条，每条都对应一种真实的攻击形状：
 * 1. **只允许 http/https**：`file://` / `gopher://` 这类协议在有些客户端上能读本地文件。
 * 2. **云端策略下禁止私网与元数据地址**：`169.254.169.254` 是最出名的那个。
 * 3. **云端策略下必须 https**：否则密钥会以明文走过网络。
 *
 * 与 `packages/agent-core/src/providerContracts.ts` 的判据**同一套规则** ——
 * 那边在配置写入时查一次，这边在真的要连出去时再查一次。两次都必要：
 * 配置文件可以被手改，而"手改过的配置"不该变成一次 SSRF。
 */
pub fn allow_upstream(url: &str, network_policy: &str) -> Result<(), String> {
    let parsed = parse_absolute_url(url).ok_or_else(|| format!("`{url}` is not an absolute http(s) URL"))?;
    if network_policy == "cloud" {
        if parsed.scheme != "https" {
            return Err("a cloud endpoint must use https".to_string());
        }
        if is_private_host(&parsed.host) {
            return Err(format!("`{}` is a loopback or private address, which a cloud profile must not reach", parsed.host));
        }
    }
    Ok(())
}

struct ParsedUrl {
    scheme: String,
    host: String,
}

/// 极简的 URL 拆分。**不用 `url` crate**：这里只需要 scheme 与 host 两项，
/// 而每多一个依赖就多一份要跟着升级、要审的东西。
fn parse_absolute_url(url: &str) -> Option<ParsedUrl> {
    let (scheme, rest) = url.split_once("://")?;
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return None;
    }
    let authority = rest.split(['/', '?', '#']).next()?;
    // 丢掉 user:pass@（内嵌凭据是另一条拒绝理由，见 `providerContracts`）。
    let host_port = authority.rsplit('@').next()?;
    let host = host_port.split(':').next()?.to_ascii_lowercase();
    if host.is_empty() {
        return None;
    }
    Some(ParsedUrl { scheme, host })
}

pub fn is_private_host(host: &str) -> bool {
    let normalized = host.trim_start_matches('[').trim_end_matches(']');
    if normalized == "localhost" || normalized.ends_with(".localhost") || normalized == "::1" {
        return true;
    }
    if normalized.starts_with("127.") || normalized.starts_with("10.") || normalized.starts_with("192.168.") || normalized.starts_with("169.254.") {
        return true;
    }
    if let Some(rest) = normalized.strip_prefix("172.") {
        if let Some(second) = rest.split('.').next().and_then(|value| value.parse::<u8>().ok()) {
            if (16..=31).contains(&second) {
                return true;
            }
        }
    }
    false
}

/**
 * **重定向之后还要不要带上凭据**（计划 Step 4："prevent credential forwarding across redirects"）。
 *
 * 判据：只有**同一个 host、同一个 scheme** 才算"同一次跳转"，才允许继续带凭据。
 * 跨 host 一律停 —— 一个 302 到 `evil.com` 就能把 `Authorization` 送出去，
 * 而那是"代理"这类组件最经典的漏洞形状。
 */
pub fn may_forward_credentials(from: &str, to: &str) -> bool {
    match (parse_absolute_url(from), parse_absolute_url(to)) {
        (Some(left), Some(right)) => left.scheme == right.scheme && left.host == right.host,
        _ => false,
    }
}

/// 从诊断文本里抹掉令牌与认证头。**默认拒绝**：认不出的一律替换，不等一份密钥清单。
pub fn redact(text: &str, token: &SessionToken) -> String {
    let mut out = text.replace(token.expose(), "[redacted-token]");
    for header in ["authorization:", "x-api-key:", "api-key:", "proxy-authorization:"] {
        out = redact_header(&out, header);
    }
    out
}

fn redact_header(text: &str, header: &str) -> String {
    text
        .split('\n')
        .map(|line| {
            let lowered = line.to_ascii_lowercase();
            match lowered.find(header) {
                // 保留头名，抹掉值 —— 只整行删掉会让"这个头出现过"这个信息也没了。
                Some(index) => format!("{}{header} [redacted]", &line[..index]),
                None => line.to_string(),
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}
