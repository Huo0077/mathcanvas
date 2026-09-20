/**
 * **归一化模型事件**（Task 1.4）。
 *
 * 计划原文：`ModelEvent = Started | Delta | ToolCall | Usage | Completed | Failed`
 * with `requestId`, `attemptId`, and provider metadata。
 *
 * ## 为什么要有这一层，而不是让每个适配器各自返回自己的形状
 *
 * 三家 provider 的流式事件长得完全不一样：OpenAI 兼容是 `choices[0].delta.content`，
 * Anthropic 是 `content_block_delta.delta.text`，Ollama 是一行一个完整 JSON。
 * 如果协调器直接读这些形状，那它就变成了"三家的联合解析器"——
 * 每加一家就要改一次状态机。归一化之后协调器只认下面这六种事件，
 * **providers 的差异被收在适配器里**。
 *
 * ## 三条纪律
 *
 * 1. **`reasoning` 只作为诊断元数据**。计划 Task 1.4 Step 4 原文："Preserve provider-specific
 *    reasoning fields only as diagnostic metadata; **do not treat them as tool results or facts**."
 *    所以它塞进 `Failed.metadata` / `Started.metadata` 这类**不会被当成内容**的位置，
 *    而不是拼进 `Delta.text`。
 * 2. **每个事件都带 `requestId` 与 `attemptId`**。没有它们就无法判断"这条事件属于哪次尝试"，
 *    而重试与修复通道正是靠这个区分。
 * 3. **`Failed` 必须带 `retryable`**。计划 Task 2.3 的恢复策略只重试 429/5xx/连接中断；
 *    认证与权限**绝不**自动重试。这个判断在本层做出，而不是让协调器去猜状态码。
 */

/** 失败分类。**协调器的重试策略直接读它**（不是读 HTTP 状态码）。 */
export const FAILURE_KINDS = ["transport", "rate_limited", "server_error", "auth", "permission", "malformed_output", "cancelled", "unknown"] as const
export type FailureKind = (typeof FAILURE_KINDS)[number]

/** 按分类判断能不能自动重试。**唯一的判据**，协调器与恢复策略共用。 */
export function isRetryable(kind: FailureKind): boolean {
  switch (kind) {
    // 计划 Task 2.3："Retry only transport 429/5xx/connectivity within the shared budget;
    // never retry auth, geometry, permission, or contradictory-fact failures automatically."
    case "transport":
    case "rate_limited":
    case "server_error":
      return true
    case "auth":
    case "permission":
    case "malformed_output":
    case "cancelled":
    case "unknown":
      return false
  }
}

/** 一次尝试的身份。**每个事件都带**（计划逐字要求 `requestId` + `attemptId`）。 */
export interface ModelEventIds {
  requestId: string
  attemptId: string
}

/** provider 给的、**不能被当成内容**的附加信息（推理字段、原始响应片段、限流提示）。 */
export type ModelEventMetadata = Record<string, string | number | boolean>

export type ModelEvent =
  | (ModelEventIds & { kind: "started"; model: string; metadata?: ModelEventMetadata })
  | (ModelEventIds & { kind: "delta"; text: string })
  | (ModelEventIds & { kind: "tool_call"; toolCallId: string; toolId: string; input: unknown })
  | (ModelEventIds & { kind: "usage"; inputTokens?: number; outputTokens?: number })
  | (ModelEventIds & { kind: "completed"; stopReason?: string })
  | (ModelEventIds & { kind: "failed"; failure: FailureKind; message: string; retryable: boolean; metadata?: ModelEventMetadata })

/** 造一个失败事件。`retryable` 由 `failure` 决定 —— **调用方不许自己填**。 */
export function failedEvent(ids: ModelEventIds, failure: FailureKind, message: string, metadata?: ModelEventMetadata): ModelEvent {
  return { ...ids, kind: "failed", failure, message: message.slice(0, 512), retryable: isRetryable(failure), metadata }
}

/**
 * **把一个 HTTP 状态码与响应体变成失败分类**。
 *
 * 三家 provider 都用同一套状态码语义（401 认证、403 权限、429 限流、5xx 服务端），
 * 所以这个映射只有一处 —— 每个适配器各写一遍必然分叉，而分叉的后果是
 * "换了一家 provider，重试策略就变了"。
 */
export function classifyHttpFailure(status: number, body?: string): { failure: FailureKind; message: string } {
  const detail = (body ?? "").slice(0, 200)
  if (status === 401) return { failure: "auth", message: `the provider rejected the credential (401)${detail ? `: ${detail}` : ""}` }
  if (status === 403) return { failure: "permission", message: `the provider refused the request (403)${detail ? `: ${detail}` : ""}` }
  if (status === 429) return { failure: "rate_limited", message: `the provider is rate limiting (429)${detail ? `: ${detail}` : ""}` }
  if (status >= 500) return { failure: "server_error", message: `the provider failed (${status})${detail ? `: ${detail}` : ""}` }
  return { failure: "unknown", message: `the provider returned ${status}${detail ? `: ${detail}` : ""}` }
}

/**
 * **对一串归一化事件做一次"取消后不许再发事件"的过滤**（计划 Task 1.5 Step 5）。
 *
 * 抽成纯函数而不是散在适配器的流循环里：取消是**竞态**（取消信号与下一块数据谁先到不确定），
 * 而"取消之后一个工具事件都不许出去"是一条**安全性质**（模型可能已经拿着半截结果去下判断）。
 * 纯函数让它能被确定性地测，而不是靠时序碰运气。
 */
export function* stopAfterCancel(events: Iterable<ModelEvent>, isCancelled: () => boolean): Generator<ModelEvent> {
  for (const event of events) {
    if (isCancelled()) return
    yield event
  }
}
