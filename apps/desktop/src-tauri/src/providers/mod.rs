//! **协议适配器**（Task 1.4）。
//!
//! 计划原文的接口是
//! `ProviderAdapter::send(request: ProviderRequest, secret: SecretHandle, cancel: CancellationToken) -> Stream<ModelEvent>`。
//!
//! ## 这一批交付的是"发请求之前与之后"的两半，**不含 HTTP 本身**
//!
//! 这不是省事，而是**顺序**的问题：
//! - **发请求之前**（`request.rs`）：从一份**已校验的 profile + 归一化消息**拼出 provider 请求。
//!   它没有调用方给的任意 URL / header map —— 计划原文："`ProviderRequest` is built from a
//!   validated profile and normalized messages; **it has no caller-supplied arbitrary URL/header map**."
//! - **发请求之后**（`normalize.rs`）：把 provider 的响应/流归一化成 `ModelEvent`。
//! - **HTTP 本身**（连接、超时、重定向、TLS、取消）属于 **Task 1.5 的回环代理**：
//!   那里才有"绑定回环 + 临时令牌 + 精确 Origin/Host 检查"的整套约束。
//!
//! 把这两半先做出来、并用 **fixtures 逐条测**，有一个直接好处：Task 1.5 接上真实传输时，
//! 需要新写的只有"怎么把字节搬回来"，而**协议解释与错误分类已经是被测过的纯函数**。

pub mod events;
pub mod normalize;
pub mod request;

pub use events::{classify_http_failure, EventIds, FailureKind, Metadata, ModelEvent};
pub use request::{build_request, ChatMessage, ProviderRequest, RequestPlan};
