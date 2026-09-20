import { describe, expect, it } from "vitest"

import { classifyHttpFailure, failedEvent, isRetryable, stopAfterCancel, type FailureKind, type ModelEvent } from "./modelEvents"

/**
 * 归一化模型事件（Task 1.4 Step 5）。
 *
 * 最要紧的一条性质：**重试策略读的是分类，不是 HTTP 状态码** ——
 * 计划 Task 2.3 的原话是 "Retry only transport 429/5xx/connectivity within the shared budget;
 * never retry auth, geometry, permission, or contradictory-fact failures automatically."
 */
const ids = { requestId: "req-1", attemptId: "attempt-1" }

describe("failure classification drives the retry policy", () => {
  it("marks only the failures the plan allows to be retried", () => {
    for (const kind of ["transport", "rate_limited", "server_error"] as FailureKind[]) {
      expect(isRetryable(kind), kind).toBe(true)
    }
    // 认证与权限**绝不**自动重试：密钥错了再试一百次也还是错的，只会把预算烧光。
    for (const kind of ["auth", "permission", "malformed_output", "cancelled", "unknown"] as FailureKind[]) {
      expect(isRetryable(kind), kind).toBe(false)
    }
  })

  it("turns the shared HTTP status codes into the same classifications for every provider", () => {
    // 三家 provider 的状态码语义是同一套；映射只有一处，否则"换一家 provider 重试策略就变了"。
    expect(classifyHttpFailure(401).failure).toBe("auth")
    expect(classifyHttpFailure(403).failure).toBe("permission")
    expect(classifyHttpFailure(429).failure).toBe("rate_limited")
    expect(classifyHttpFailure(500).failure).toBe("server_error")
    expect(classifyHttpFailure(503).failure).toBe("server_error")
    expect(classifyHttpFailure(400).failure).toBe("unknown")
  })

  it("keeps a bounded piece of the provider's message for the user", () => {
    const classified = classifyHttpFailure(429, `{"error":{"message":"${"x".repeat(500)}"}}`)

    // 有界：这段文本会进界面与日志。
    expect(classified.message.length).toBeLessThan(300)
    expect(classified.message).toContain("429")
  })

  it("lets the failure kind decide whether a failure event is retryable", () => {
    const auth = failedEvent(ids, "auth", "bad key")
    const limited = failedEvent(ids, "rate_limited", "slow down")

    expect(auth.kind).toBe("failed")
    if (auth.kind === "failed") expect(auth.retryable).toBe(false)
    if (limited.kind === "failed") expect(limited.retryable).toBe(true)
  })

  it("carries the attempt identity on every event it builds", () => {
    const event = failedEvent(ids, "server_error", "boom")

    expect(event.requestId).toBe("req-1")
    expect(event.attemptId).toBe("attempt-1")
  })
})

describe("cancellation stops the stream", () => {
  const stream: ModelEvent[] = [
    { ...ids, kind: "started", model: "m" },
    { ...ids, kind: "delta", text: "a" },
    { ...ids, kind: "tool_call", toolCallId: "t1", toolId: "scene.inspect", input: {} },
    { ...ids, kind: "completed" }
  ]

  it("stops emitting as soon as the run is cancelled", () => {
    let cancelled = false
    const seen: string[] = []
    for (const event of stopAfterCancel(stream, () => cancelled)) {
      seen.push(event.kind)
      // 用户在第一块内容之后按了停止。
      if (event.kind === "delta") cancelled = true
    }

    // **工具事件一个都不许出去**：模型可能已经拿着半截结果去下判断。
    expect(seen).toEqual(["started", "delta"])
  })

  it("passes everything through when the run is not cancelled", () => {
    const seen = [...stopAfterCancel(stream, () => false)].map((event) => event.kind)

    expect(seen).toEqual(["started", "delta", "tool_call", "completed"])
  })

  it("emits nothing when the run was already cancelled", () => {
    expect([...stopAfterCancel(stream, () => true)]).toEqual([])
  })
})
