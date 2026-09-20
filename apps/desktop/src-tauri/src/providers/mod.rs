//! **协议适配器**（Task 1.4）。
//!
//! 计划原文的接口是
//! `ProviderAdapter::send(request: ProviderRequest, secret: SecretHandle, cancel: CancellationToken) -> Stream<ModelEvent>`。
//!
//! ## 三层，各管一件事
//!
//! - **发请求之前**（`request.rs`）：从一份**已校验的 profile + 归一化消息**拼出 provider 请求。
//!   它没有调用方给的任意 URL / header map —— 计划原文："`ProviderRequest` is built from a
//!   validated profile and normalized messages; **it has no caller-supplied arbitrary URL/header map**."
//! - **发请求之后**（`normalize.rs`）：把 provider 的响应/流归一化成 `ModelEvent`。
//! - **把两者接起来**（`adapter.rs`）：借凭据、过出站判据、搬字节、边到边解码、能被取消。
//!   真正的 HTTP（`HttpTransport`）也住在那里。
//!
//! 前两层是**纯函数**，所以它们能在 fixtures 上逐条测（`tests/providers.rs`）；
//! 第三层要碰网络与凭据，所以它有自己的一组测试（`tests/provider_adapter.rs`，
//! 一半用可编程的替身、一半真起一个回环 socket）。

pub mod adapter;
pub mod events;
pub mod normalize;
pub mod request;

pub use adapter::{HttpTransport, ProviderAdapter, ProviderError, SecretSource, SendOutcome, Stop, Transport, TransportUpdate};
pub use events::{classify_http_failure, EventIds, FailureKind, Metadata, ModelEvent};
pub use request::{build_request, ChatMessage, ProviderRequest, RequestPlan};
