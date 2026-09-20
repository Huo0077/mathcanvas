import { describe, expect, it } from "vitest"

import { createRunEvent, createRunEventLedger, MAX_EVENTS_PER_RUN, redactDiagnostic, type RunEventRecord } from "./events"

/**
 * Task 2.6 Step 1/2：**事件顺序**与**脱敏**。
 *
 * 脱敏的核心不是"能替换已知密钥"（那太容易），而是**没有已知清单时也不漏** ——
 * 脱敏不能依赖调用方记得把每个密钥都传进来。
 */
function event(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    eventId: "e1",
    sequence: 1,
    at: 1_000,
    runId: "run-1",
    conversationId: "conv-1",
    promptMessageId: "msg-1",
    requestId: null,
    attemptId: null,
    toolCallId: null,
    draftId: null,
    consentNonce: null,
    commitId: null,
    phase: "observing",
    status: "ok",
    versions: { capability: "c1", toolCatalogue: "t1", planSchema: "mathcanvas.plan.v1" },
    diagnostics: [],
    ...overrides
  }
}

describe("diagnostic redaction", () => {
  it("removes a known secret wherever it appears", () => {
    const secret = "hunter2-super-secret-value"

    const text = redactDiagnostic(`failed with key ${secret} in the header`, [secret])

    expect(text).not.toContain(secret)
    expect(text).toContain("[redacted]")
  })

  it("removes an Authorization header value even without a known-secret list", () => {
    // 这条是"默认拒绝"：脱敏不能靠调用方记得把密钥传进来。
    const text = redactDiagnostic("Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345")

    expect(text).not.toContain("abcdefghijklmnopqrstuvwxyz012345")
    expect(text).toContain("Authorization")
  })

  it("removes a JSON apiKey field", () => {
    const text = redactDiagnostic('{"apiKey":"sk-abcdefghijklmnopqrstuvwxyz","model":"m"}')

    expect(text).not.toContain("sk-abcdefghijklmnopqrstuvwxyz")
    expect(text).toContain("model")
  })

  it("removes a secret query parameter from a URL", () => {
    const text = redactDiagnostic("POST https://api.example.com/v1/chat?key=abc123secret&stream=true failed")

    expect(text).not.toContain("abc123secret")
    expect(text).toContain("stream=true")
  })

  it("removes a sk- prefixed key with no list and no header context", () => {
    // 前缀规则：真实密钥几乎都长这样，而普通诊断不会。
    const text = redactDiagnostic("provider rejected sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFF")

    expect(text).not.toContain("sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFF")
  })

  it("removes a long random-looking token", () => {
    const text = redactDiagnostic("proxy token 8f3a9b2c7d1e4f6a0b5c8d2e9f1a3b7c rejected")

    expect(text).not.toContain("8f3a9b2c7d1e4f6a0b5c8d2e9f1a3b7c")
  })

  it("leaves ordinary diagnostics readable", () => {
    // 脱敏过度会让日志毫无用处 —— 普通文本必须原样保留。
    const text = redactDiagnostic("compile_failed at envelope.actions[0].inputs.radius: expected a finite number")

    expect(text).toBe("compile_failed at envelope.actions[0].inputs.radius: expected a finite number")
  })

  it("bounds the diagnostic length", () => {
    const text = redactDiagnostic("x".repeat(900))

    expect(text.length).toBeLessThanOrEqual(512)
  })

  it("does not throw on a circular value, because it runs on error paths", () => {
    const circular: Record<string, unknown> = { name: "boom" }
    circular.self = circular

    expect(() => redactDiagnostic(circular)).not.toThrow()
  })
})

describe("append-only, idempotent ledger", () => {
  it("appends in order and never rewrites earlier records", () => {
    const ledger = createRunEventLedger()

    ledger.append(event({ eventId: "e1", sequence: 1, phase: "preflight" }))
    ledger.append(event({ eventId: "e2", sequence: 2, phase: "observing" }))
    ledger.append(event({ eventId: "e3", sequence: 3, phase: "planning" }))

    expect(ledger.events().map((record) => record.phase)).toEqual(["preflight", "observing", "planning"])
  })

  it("treats a repeated event id as a no-op instead of a duplicate row", () => {
    // 幂等是"重试/恢复"能用的前提：同一条事件重放不该让账本变长。
    const ledger = createRunEventLedger()
    ledger.append(event({ eventId: "e1" }))

    const second = ledger.append(event({ eventId: "e1", status: "error" }))

    expect(second).toMatchObject({ ok: true, appended: false, reason: "duplicate" })
    expect(ledger.size()).toBe(1)
    // 先到的那条没有被后来者改写。
    expect(ledger.byId("e1")?.status).toBe("ok")
  })

  it("recovers a commit receipt by event id", () => {
    // 计划 Step 1 的 "commit-receipt recovery"：应用中断之后靠事件 id 找回提交结果。
    const ledger = createRunEventLedger()
    ledger.append(event({ eventId: "commit-1", phase: "committing", commitId: "commit-abc", status: "ok" }))
    ledger.append(event({ eventId: "after-1", phase: "completed", commitId: "commit-abc" }))

    expect(ledger.byId("commit-1")?.commitId).toBe("commit-abc")
  })

  it("refuses an event without an id", () => {
    const ledger = createRunEventLedger()

    const outcome = ledger.append(event({ eventId: "" }))

    expect(outcome).toMatchObject({ ok: false, reason: "invalid_event" })
  })

  it("keeps the ledger bounded", () => {
    const ledger = createRunEventLedger()
    for (let index = 0; index < MAX_EVENTS_PER_RUN + 10; index += 1) ledger.append(event({ eventId: `e${index}`, sequence: index }))

    expect(ledger.size()).toBe(MAX_EVENTS_PER_RUN)
  })
})

describe("prohibited content", () => {
  it("refuses to store raw model reasoning", () => {
    // 比"记得不要传"可靠：将来有人顺手把整条推理塞进事件，这里当场拦下。
    const ledger = createRunEventLedger()

    const outcome = ledger.append(event({ diagnostics: ["ok"] , ...{ reasoning: "the model thought about it at length" } } as never))

    expect(outcome).toMatchObject({ ok: false, reason: "prohibited_field" })
    expect(ledger.size()).toBe(0)
  })

  it("refuses to store image bytes nested anywhere in the event", () => {
    const ledger = createRunEventLedger()
    const withBytes = event()
    ;(withBytes as unknown as Record<string, unknown>).payload = { attachment: { imageBytes: "AAAA" } }

    const outcome = ledger.append(withBytes)

    expect(outcome).toMatchObject({ ok: false, reason: "prohibited_field" })
  })

  it("redacts diagnostics when building an event", () => {
    const record = createRunEvent({
      ...event(),
      diagnostics: ["Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345"],
      knownSecrets: []
    })

    expect(record.diagnostics[0]).toContain("[redacted]")
  })

  it("carries every identifier the plan names", () => {
    const record = createRunEvent({
      ...event({ requestId: "req-1", attemptId: "attempt-1", toolCallId: "tool-1", draftId: "draft_1", consentNonce: "nonce-1", commitId: "commit-1" }),
      diagnostics: []
    })

    for (const key of ["runId", "conversationId", "promptMessageId", "requestId", "attemptId", "toolCallId", "draftId", "consentNonce", "commitId"] as const) {
      expect(record, key).toHaveProperty(key)
    }
    expect(record.versions.planSchema).toBe("mathcanvas.plan.v1")
  })
})
