//! **回环代理的真服务器测试**（Task 1.5 Step 1/2/3/5）。
//!
//! ## 为什么这里**真的起一个 socket**
//!
//! 判据层（`tests/proxy.rs`，16 例）已经把九种拒绝理由测透了，而且那是纯函数级别、
//! 确定性地跑。但那测不到三件**只有真服务器才成立**的事：
//! 1. **只绑回环**（绑 `0.0.0.0` 的版本在纯函数里看不出来）；
//! 2. **端口由系统给、且每次不同**（硬编码端口会与别的程序抢）；
//! 3. **判据真的挂在每个请求上**（不是"开机检查一次"）。
//!
//! ## 为什么手写 HTTP 而不用客户端库
//!
//! 因为要**伪造 `Host` 与 `Origin`** —— 那正是要测的东西。客户端库会"帮我们"把 Host
//! 设成连接的目标，于是"Host 不对必须被拒"这条用例根本写不出来。
//! 手写几行请求字节就够了，而且**不给测试树再加一个依赖**。

use std::io::{Read, Write};
use std::net::TcpStream;

use mathcanvas_desktop_lib::proxy::server::{ProxyHandle, start};

/// 一次原始的 HTTP/1.1 请求。`extra_headers` 用来伪造 Host / Origin / Authorization。
fn raw_request(handle: &ProxyHandle, method: &str, path: &str, extra_headers: &[(&str, &str)], body: &str) -> (u16, String) {
    let mut stream = TcpStream::connect(handle.address).expect("connect to the proxy");
    stream.set_read_timeout(Some(std::time::Duration::from_secs(5))).expect("timeout");
    let mut request = format!("{method} {path} HTTP/1.1\r\nConnection: close\r\nContent-Length: {}\r\n", body.len());
    for (name, value) in extra_headers {
        request.push_str(&format!("{name}: {value}\r\n"));
    }
    request.push_str("\r\n");
    request.push_str(body);
    stream.write_all(request.as_bytes()).expect("write");

    let mut response = String::new();
    stream.read_to_string(&mut response).expect("read");
    let status = response
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse::<u16>().ok())
        .unwrap_or(0);
    (status, response)
}

/// 一组**合法**的请求头。注意它同时带 Host 与 Origin —— 判据要求两者都在。
fn valid_headers(handle: &ProxyHandle) -> Vec<(String, String)> {
    vec![
        ("Host".to_string(), handle.address.to_string()),
        ("Origin".to_string(), "tauri://localhost".to_string()),
        ("Authorization".to_string(), format!("Bearer {}", handle.token())),
    ]
}

fn headers_as_refs(headers: &[(String, String)]) -> Vec<(&str, &str)> {
    headers.iter().map(|(name, value)| (name.as_str(), value.as_str())).collect()
}

/// 用 tokio 的运行时跑同步的 socket 调用：测试很短，不值得为它把整个测试包写成 async。
fn with_handle<T>(f: impl FnOnce(&ProxyHandle) -> T) -> T {
    let runtime = tokio::runtime::Runtime::new().expect("runtime");
    let handle = runtime.block_on(start()).expect("start the proxy");
    let result = f(&handle);
    handle.shutdown();
    result
}

#[test]
fn binds_to_loopback_only_and_lets_the_system_pick_the_port() {
    let runtime = tokio::runtime::Runtime::new().expect("runtime");
    let first = runtime.block_on(start()).expect("first proxy");
    let second = runtime.block_on(start()).expect("second proxy");

    // **只绑回环**：`0.0.0.0` 会把持有密钥的代理暴露给同网段。
    assert!(first.address.ip().is_loopback(), "the proxy must bind loopback only, got {}", first.address.ip());
    // **端口由系统给**：硬编码端口会与别的程序抢。
    assert_ne!(first.address.port(), 0);
    assert_ne!(first.address.port(), second.address.port(), "each session must get its own ephemeral port");
    // **每个会话一枚新令牌**：重启之后旧令牌自然失效。
    assert_ne!(first.token(), second.token());

    first.shutdown();
    second.shutdown();
}

#[test]
fn the_base_url_never_carries_the_token() {
    with_handle(|handle| {
        // 令牌进 URL 会进浏览器历史与日志 —— 它只能走 header。
        assert!(!handle.base_url().contains(handle.token()));
        assert!(handle.base_url().starts_with("http://127.0.0.1:"));
    });
}

#[test]
fn a_request_without_a_token_is_refused() {
    with_handle(|handle| {
        let (status, body) = raw_request(handle, "GET", "/v1/health", &[("Host", &handle.address.to_string())], "");

        // 回环地址**不是**授权：任何本机进程都能连 127.0.0.1。
        assert_eq!(status, 403);
        assert!(body.contains("missing_token") || body.contains("missing_origin"), "the reason must be named: {body}");
    });
}

#[test]
fn a_request_with_a_wrong_token_is_refused() {
    with_handle(|handle| {
        let host = handle.address.to_string();
        let (status, body) = raw_request(
            handle,
            "GET",
            "/v1/health",
            &[("Host", &host), ("Origin", "tauri://localhost"), ("Authorization", "Bearer 00000000000000000000000000000000")],
            ""
        );

        assert_eq!(status, 403);
        assert!(body.contains("wrong_token"), "the reason must be named: {body}");
    });
}

#[test]
fn a_foreign_origin_is_refused() {
    with_handle(|handle| {
        let host = handle.address.to_string();
        let token = format!("Bearer {}", handle.token());
        let (status, body) = raw_request(
            handle,
            "GET",
            "/v1/health",
            &[("Host", &host), ("Origin", "https://evil.example"), ("Authorization", &token)],
            ""
        );

        // 浏览器里的任意网页都能发跨源请求；没有 Origin 检查就等于把这个代理暴露给它。
        assert_eq!(status, 403);
        assert!(body.contains("wrong_origin"), "the reason must be named: {body}");
    });
}

#[test]
fn a_foreign_host_is_refused_even_with_a_valid_token_and_origin() {
    with_handle(|handle| {
        let token = format!("Bearer {}", handle.token());
        // **精确匹配**：`127.0.0.1.evil.com` 这种"包含"式判据会被骗过去。
        let (status, body) = raw_request(
            handle,
            "GET",
            "/v1/health",
            &[("Host", "127.0.0.1.evil.com"), ("Origin", "tauri://localhost"), ("Authorization", &token)],
            ""
        );

        assert_eq!(status, 403);
        assert!(body.contains("wrong_host"), "the reason must be named: {body}");
    });
}

#[test]
fn a_fully_admitted_request_reaches_the_handler() {
    with_handle(|handle| {
        let headers = valid_headers(handle);
        let (status, body) = raw_request(handle, "GET", "/v1/health", &headers_as_refs(&headers), "");

        assert_eq!(status, 200, "a valid request must be served: {body}");
        assert!(body.contains("\"status\":\"ok\""));
        // **诊断读数里不含任何请求内容**（只有计数与取消状态）。
        assert!(!body.contains(handle.token()));
    });
}

#[test]
fn the_model_and_event_routes_report_that_forwarding_is_not_wired_yet() {
    with_handle(|handle| {
        let headers = valid_headers(handle);

        let (model_status, model_body) = raw_request(handle, "POST", "/v1/runs/r1/model", &headers_as_refs(&headers), "{}");
        let (events_status, events_body) = raw_request(handle, "GET", "/v1/runs/r1/events", &headers_as_refs(&headers), "");

        // **如实回"未实现"**，而不是回一个看起来像成功的东西。
        //
        // 这条断言是刻意的：如果哪天有人把转发接上了，这两条会红 ——
        // 那一刻正是"该把前端从'未接通'切到'已接通'"的有意决定。
        // 反过来，若它们悄悄返回 200 + 空事件，前端会拿着空结果继续推理。
        assert_eq!(model_status, 501, "{model_body}");
        assert_eq!(events_status, 501, "{events_body}");
        assert!(model_body.contains("model_forwarding_not_implemented"));
        assert!(events_body.contains("event_stream_not_implemented"));
    });
}

#[test]
fn cancel_sets_the_flag_and_wakes_waiters() {
    with_handle(|handle| {
        assert!(!handle.is_cancelled());
        let headers = valid_headers(handle);

        let (status, body) = raw_request(handle, "POST", "/v1/runs/r1/cancel", &headers_as_refs(&headers), "");

        assert_eq!(status, 200, "{body}");
        assert!(body.contains("\"cancelled\":true"));
        // 取消是**可见的**：转发循环据此停手，而不必等下一次轮询。
        assert!(handle.is_cancelled());
    });
}

#[test]
fn an_unknown_route_is_refused() {
    with_handle(|handle| {
        let headers = valid_headers(handle);

        let (status, _) = raw_request(handle, "GET", "/v1/runs/r1/whatever", &headers_as_refs(&headers), "");

        // 未知路径一律拒绝（404 由 axum 给），**不转发、不猜**。
        assert_eq!(status, 404);
    });
}

#[test]
fn shutdown_is_idempotent_in_the_sense_that_the_handle_is_consumed_once() {
    // 「关掉」不是一个可以重复做的动作：`shutdown(self)` 拿走所有权，
    // 于是"关两次"在类型上就不存在 —— 这比运行时判一个标志可靠。
    let runtime = tokio::runtime::Runtime::new().expect("runtime");
    let handle = runtime.block_on(start()).expect("start");
    let address = handle.address;
    handle.shutdown();

    // 关掉之后端口应当不再接受连接（给服务器一点时间收尾）。
    std::thread::sleep(std::time::Duration::from_millis(200));
    let refused = TcpStream::connect(address).is_err();
    assert!(refused, "a shut-down proxy must stop accepting connections on {address}");
}
