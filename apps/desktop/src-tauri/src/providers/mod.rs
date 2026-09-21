//! **协议适配器**（Task 1.4）。
//!
//! 计划原文的接口是
//! `ProviderAdapter::send(request: ProviderRequest, secret: SecretHandle, cancel: CancellationToken) -> Stream<ModelEvent>`。
//!
//! ## 四层，各管一件事
//!
//! - **发请求之前**（`request.rs`）：从一份**已校验的 profile + 归一化消息**拼出 provider 请求。
//!   它没有调用方给的任意 URL / header map —— 计划原文："`ProviderRequest` is built from a
//!   validated profile and normalized messages; **it has no caller-supplied arbitrary URL/header map**."
//! - **发请求之后**（`normalize.rs`）：把 provider 的响应/流归一化成 `ModelEvent`。
//! - **把两者接起来**（`adapter.rs`）：借凭据、过出站判据、搬字节、边到边解码、能被取消。
//!   真正的 HTTP（`HttpTransport`）也住在那里。
//! - **问"哪些能力真的成立"**（`capability.rs`，Step 5）：四条探针逐条下结论。
//!   它存在是因为"请求成功了"不等于"这家支持工具"—— 见那个文件的判据表。
//!
//! 前两层是**纯函数**，所以它们能在 fixtures 上逐条测（`tests/providers.rs`）；
//! 后两层要碰网络与凭据，各有自己的一组测试（`tests/provider_adapter.rs` 一半用可编程的
//! 替身、一半真起一个回环 socket；`tests/provider_capability.rs` 全部用可编程的替身）。

pub mod adapter;
/// 能力证据探针（Task 1.4 Step 5）：逐条测出"哪些能力真的成立"，而不是一次性打勾。
pub mod capability;
pub mod events;
pub mod normalize;
pub mod request;

pub use adapter::{HttpTransport, ProviderAdapter, ProviderError, SecretSource, SendOutcome, Stop, Transport, TransportUpdate};
pub use capability::{CapabilityStatus, Evidence, Feature, Probe, ProbeReport, PROBE_FEATURES};
pub use events::{classify_http_failure, EventIds, FailureKind, Metadata, ModelEvent};
pub use request::{build_request, ChatMessage, ProviderRequest, RequestOptions, RequestPlan};
