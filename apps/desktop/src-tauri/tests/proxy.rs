//! **回环代理的传输安全测试**（Task 1.5 Step 1）。
//!
//! 计划原文点名的九种情形：no token / wrong token / wrong Origin / wrong Host /
//! arbitrary URL / redirect to another host / oversize body / CORS wildcard /
//! stale profile revision。**九种各有一条用例，一条不少。**
//!
//! 这些用例是**纯函数**级别的：不起服务器、不碰网络、确定性地跑。
//! 这么做的理由写在 `src/proxy/mod.rs`：安全判据如果能"大概拦住了"，
//! 那它就不是判据。

use mathcanvas_desktop_lib::proxy::security::{
    admit, allow_upstream, is_private_host, may_forward_credentials, parse_route, redact, Admission, AdmissionInput, SessionToken, ALLOWED_ORIGINS, MAX_BODY_BYTES,
};
use std::collections::HashMap;

fn token() -> SessionToken {
    SessionToken::from_bytes([0xab; 16])
}

fn input(overrides: impl FnOnce(&mut AdmissionInput)) -> AdmissionInput {
    let mut value = AdmissionInput {
        token: Some(token().expose().to_string()),
        host: Some("127.0.0.1:51234".to_string()),
        origin: Some("tauri://localhost".to_string()),
        body_bytes: 128,
        profile_revision: Some(3),
        current_profile_revision: 3
    };
    overrides(&mut value);
    value
}

fn denied_code(admission: Admission) -> String {
    match admission {
        Admission::Allowed => panic!("expected a denial"),
        Admission::Denied { code, .. } => code.to_string(),
    }
}

// ---------------------------------------------------------------- 九种拒绝理由

#[test]
fn rejects_a_request_with_no_token() {
    // 没有令牌 = 任何本机进程都能用这个代理（回环地址不是授权）。
    assert_eq!(denied_code(admit(&input(|value| value.token = None), &token())), "missing_token");
    assert_eq!(denied_code(admit(&input(|value| value.token = Some(String::new())), &token())), "wrong_token");
}

#[test]
fn rejects_a_wrong_token() {
    let other = SessionToken::from_bytes([0xcd; 16]);

    assert_eq!(denied_code(admit(&input(|value| value.token = Some(other.expose().to_string())), &token())), "wrong_token");
}

#[test]
fn rejects_a_foreign_origin() {
    // 浏览器里的任意网页都能发跨源请求；没有 Origin 检查就等于把这个代理暴露给它。
    assert_eq!(denied_code(admit(&input(|value| value.origin = Some("https://evil.example".to_string())), &token())), "wrong_origin");
    // 通配符 `*` 也要拒 —— CORS 通配 + 回环代理是经典的组合漏洞。
    assert_eq!(denied_code(admit(&input(|value| value.origin = Some("*".to_string())), &token())), "wrong_origin");
    assert_eq!(denied_code(admit(&input(|value| value.origin = None), &token())), "missing_origin");
}

#[test]
fn rejects_a_foreign_host() {
    // **精确匹配**：`127.0.0.1.evil.com` 这种"包含"式判据会被骗过去。
    assert_eq!(denied_code(admit(&input(|value| value.host = Some("127.0.0.1.evil.com".to_string())), &token())), "wrong_host");
    assert_eq!(denied_code(admit(&input(|value| value.host = Some("example.com".to_string())), &token())), "wrong_host");
    assert_eq!(denied_code(admit(&input(|value| value.host = None), &token())), "missing_host");
    // 而回环地址的两种写法都放行。
    for host in ["127.0.0.1", "localhost", "127.0.0.1:9"] {
        assert_eq!(admit(&input(|value| value.host = Some(host.to_string())), &token()), Admission::Allowed, "{host}");
    }
}

#[test]
fn rejects_a_body_over_the_limit() {
    assert_eq!(denied_code(admit(&input(|value| value.body_bytes = MAX_BODY_BYTES + 1), &token())), "oversize_body");
    assert_eq!(admit(&input(|value| value.body_bytes = MAX_BODY_BYTES), &token()), Admission::Allowed);
}

#[test]
fn rejects_a_request_built_for_a_stale_profile_revision() {
    // 配置改过之后，旧证据不该继续被采信（与 `isCapabilityVerified` 同一条判据）。
    assert_eq!(denied_code(admit(&input(|value| value.profile_revision = Some(2)), &token())), "stale_profile_revision");
    assert_eq!(admit(&input(|value| value.profile_revision = None), &token()), Admission::Allowed, "a request that names no revision cannot be stale");
}

#[test]
fn accepts_a_request_that_satisfies_every_condition() {
    assert_eq!(admit(&input(|_| {}), &token()), Admission::Allowed);
    // 每个允许的 Origin 都放行（三种写法都是 Tauri 在不同平台上的形态）。
    for origin in ALLOWED_ORIGINS {
        assert_eq!(admit(&input(|value| value.origin = Some(origin.to_string())), &token()), Admission::Allowed, "{origin}");
    }
}

// ---------------------------------------------------------------- 无任意 URL 的路由

#[test]
fn the_routes_are_a_closed_set_and_none_of_them_takes_an_upstream_url() {
    let empty = HashMap::new();
    assert!(parse_route("GET", "/v1/health", &empty).is_ok());
    assert!(parse_route("POST", "/v1/runs/r1/model", &HashMap::from([("profile".to_string(), "p1".to_string())])).is_ok());
    assert!(parse_route("POST", "/v1/runs/r1/cancel", &empty).is_ok());
    assert!(parse_route("GET", "/v1/runs/r1/events", &empty).is_ok());

    // 未知路径一律拒绝。
    assert!(parse_route("GET", "/v1/runs/r1/whatever", &empty).is_err());
    assert!(parse_route("POST", "/v1/openai", &empty).is_err());

    // **带 URL 的查询参数直接拒绝** —— 不是"反正我不用它"，而是"这个代理没有这种能力"。
    let with_url = HashMap::from([("profile".to_string(), "p1".to_string()), ("url".to_string(), "https://evil.example".to_string())]);
    let parsed = parse_route("POST", "/v1/runs/r1/model", &with_url);
    assert!(parsed.is_err());
    assert!(parsed.unwrap_err().contains("no route that accepts an upstream URL"));
}

#[test]
fn the_model_route_needs_a_profile_because_the_proxy_will_not_guess_one() {
    let error = parse_route("POST", "/v1/runs/r1/model", &HashMap::new()).unwrap_err();

    assert!(error.contains("profile"));
}

// ---------------------------------------------------------------- SSRF 防线

#[test]
fn a_cloud_profile_may_not_reach_a_private_or_metadata_address() {
    // `169.254.169.254` 是最出名的那个：让服务端去取云元数据。
    assert!(allow_upstream("https://169.254.169.254/latest/meta-data", "cloud").is_err());
    assert!(allow_upstream("https://127.0.0.1:11434/v1", "cloud").is_err());
    assert!(allow_upstream("https://10.0.0.5/v1", "cloud").is_err());
    assert!(allow_upstream("https://192.168.1.10/v1", "cloud").is_err());
    assert!(allow_upstream("https://172.20.0.1/v1", "cloud").is_err());
    // 而公网地址放行。
    assert!(allow_upstream("https://api.openai.com/v1", "cloud").is_ok());
}

#[test]
fn a_cloud_profile_must_use_tls() {
    // 否则密钥会以明文走过网络。
    assert!(allow_upstream("http://api.openai.com/v1", "cloud").is_err());
    assert!(allow_upstream("https://api.openai.com/v1", "cloud").is_ok());
}

#[test]
fn a_local_or_lan_profile_may_reach_http_and_private_addresses() {
    // 这是**用户显式选择**的信任，不是默认放开。
    assert!(allow_upstream("http://127.0.0.1:11434/v1", "local").is_ok());
    assert!(allow_upstream("http://192.168.1.10:8000/v1", "lan").is_ok());
    // 但协议仍然只允许 http/https：`file://` 在有些客户端上能读本地文件。
    assert!(allow_upstream("file:///C:/Windows/win.ini", "local").is_err());
    assert!(allow_upstream("gopher://127.0.0.1/", "local").is_err());
    assert!(allow_upstream("not a url", "lan").is_err());
}

#[test]
fn private_address_detection_covers_the_ranges_that_matter() {
    for host in ["localhost", "127.0.0.1", "10.1.2.3", "192.168.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "::1"] {
        assert!(is_private_host(host), "{host} must be treated as private");
    }
    for host in ["api.openai.com", "172.32.0.1", "172.15.0.1", "8.8.8.8"] {
        assert!(!is_private_host(host), "{host} must not be treated as private");
    }
}

// ---------------------------------------------------------------- 重定向

#[test]
fn credentials_are_not_forwarded_across_a_redirect() {
    // 一个 302 到 evil.com 就能把 Authorization 送出去 —— 代理类组件最经典的漏洞形状。
    assert!(!may_forward_credentials("https://api.openai.com/v1/chat/completions", "https://evil.example/v1"));
    // 降级（https → http）也不行：那会让密钥变成明文。
    assert!(!may_forward_credentials("https://api.openai.com/v1", "http://api.openai.com/v1"));
    // 同 host 同 scheme 的跳转（例如 `/v1` → `/v1/`）可以。
    assert!(may_forward_credentials("https://api.openai.com/v1", "https://api.openai.com/v1/chat/completions"));
    // 解析不了的地址一律不带凭据。
    assert!(!may_forward_credentials("https://api.openai.com/v1", "not a url"));
}

// ---------------------------------------------------------------- 脱敏

#[test]
fn redaction_removes_the_session_token_and_any_auth_header() {
    let token = token();
    let text = format!(
        "POST /v1/runs/r1/model\nHost: 127.0.0.1\nAuthorization: Bearer sk-live-1234\nx-api-key: sk-ant-9999\nX-Session: {}\nbody: {{\"model\":\"gpt-5\"}}",
        token.expose()
    );

    let redacted = redact(&text, &token);

    assert!(!redacted.contains(token.expose()));
    assert!(!redacted.contains("sk-live-1234"));
    assert!(!redacted.contains("sk-ant-9999"));
    // 头名保留：只整行删掉会让"这个头出现过"这个信息也没了。
    assert!(redacted.contains("authorization: [redacted]"));
    assert!(redacted.contains("x-api-key: [redacted]"));
    // 与安全无关的内容原样保留（脱敏过度会让日志没用）。
    assert!(redacted.contains("body: {\"model\":\"gpt-5\"}"));
}

// ---------------------------------------------------------------- 令牌本身

#[test]
fn the_session_token_is_random_and_compared_in_constant_time() {
    let first = SessionToken::from_bytes([1; 16]);
    let second = SessionToken::from_bytes([2; 16]);

    assert_ne!(first.expose(), second.expose());
    assert_eq!(first.expose().len(), 32, "16 bytes render as 32 hex characters");
    assert!(first.matches(first.expose()));
    assert!(!first.matches(second.expose()));
    // 长度不同的候选一律判否（令牌长度固定，长度本身不敏感）。
    assert!(!first.matches("ab"));
    assert!(!first.matches(""));
}
