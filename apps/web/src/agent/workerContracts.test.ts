import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { createWorkerRequest, parseWorkerRequest, parseWorkerResponse, WORKER_SCHEMA_VERSION } from "./workerContracts"

/**
 * Task 0.8 的 worker 边界。
 *
 * 两条计划原文各自有用例守着：
 * - "always carry runId, draftId, draftVersion, requestId, and schemaVersion"；
 * - "unknown message kinds are dropped and diagnosed"（**丢弃**，不是抛异常、也不是静默）。
 */
const envelope = { runId: "run-1", requestId: "req-1", draftId: "draft_1", draftVersion: 2 }

function compileRequest() {
  return createWorkerRequest("geometry.compile", envelope, {
    base: createEmptyDocument("conics"),
    actions: [{ actionId: "planar.create_point", actionKey: "p", factIds: [], inputs: { alias: "p", points: [{ x: 1, y: 0 }] } }]
  })
}

describe("worker request contract", () => {
  it("accepts a well-formed request and carries all five envelope fields", () => {
    const parsed = parseWorkerRequest(compileRequest())

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error("expected a valid request")
    expect(parsed.message).toMatchObject({ kind: "geometry.compile", schemaVersion: WORKER_SCHEMA_VERSION, ...envelope })
  })

  it("drops an unknown message kind instead of throwing", () => {
    // 关键：不抛异常。抛出去会让一条不认识的广播把整条管道打死。
    const parsed = parseWorkerRequest({ ...compileRequest(), kind: "geometry.explode" })

    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error("expected a drop")
    expect(parsed.dropped).toBe(true)
    expect(parsed.diagnostic.code).toBe("unknown_message_kind")
    // 诊断里要带上被拒的 kind，否则"发错了通道"这件事无从查起。
    expect(parsed.diagnostic.detail).toContain("geometry.explode")
  })

  it("rejects a request that is missing any envelope field", () => {
    for (const field of ["runId", "requestId", "draftId", "draftVersion", "schemaVersion"] as const) {
      const request = compileRequest() as unknown as Record<string, unknown>
      delete request[field]

      const parsed = parseWorkerRequest(request)
      expect(parsed.ok).toBe(false)
      if (parsed.ok) throw new Error("expected a rejection")
      expect(parsed.dropped).toBe(false)
    }
  })

  it("rejects a non-integer draft version instead of accepting a meaningless one", () => {
    // 小数版本号会让"这条结果对应哪一版"失去意义，表现为"预览偶尔串版"这种极难复现的故障。
    for (const bad of [1.5, Number.NaN, -1, "2"] as const) {
      const parsed = parseWorkerRequest({ ...compileRequest(), draftVersion: bad })
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.diagnostic.code).toBe("invalid_draft_version")
    }
  })

  it("rejects a message built against a different schema version", () => {
    const parsed = parseWorkerRequest({ ...compileRequest(), schemaVersion: "mathcanvas.worker.v2" })

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.diagnostic.code).toBe("schema_version_mismatch")
  })

  it("rejects an empty or oversized compile payload", () => {
    const empty = parseWorkerRequest({ ...compileRequest(), actions: [] })
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.diagnostic.code).toBe("empty_actions")

    // 32 是每条请求的上限（与动作层的单步上限一致）：一次塞 1000 笔会让 worker 长时间不可取消。
    const oversized = parseWorkerRequest({ ...compileRequest(), actions: Array.from({ length: 33 }, () => compileRequest().actions[0]) })
    expect(oversized.ok).toBe(false)
    if (!oversized.ok) expect(oversized.diagnostic.code).toBe("too_many_actions")
  })

  it("requires the base document, because compiling against an implicit one would drift", () => {
    const request = compileRequest() as unknown as Record<string, unknown>
    delete request.base

    const parsed = parseWorkerRequest(request)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.diagnostic.code).toBe("missing_base_document")
  })
})

describe("worker response contract", () => {
  it("accepts a result for the request the caller is waiting on", () => {
    const document = createEmptyDocument("conics")
    const parsed = parseWorkerResponse({ kind: "geometry.compile.result", schemaVersion: WORKER_SCHEMA_VERSION, requestId: "req-1", operations: [], document }, "req-1")

    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.message.requestId).toBe("req-1")
  })

  it("rejects a stale result that answers a different request", () => {
    // "迟到结果"唯一的识别手段就是 requestId；这条必须在边界上强制，而不是靠调用点自觉。
    const document = createEmptyDocument("conics")
    const parsed = parseWorkerResponse({ kind: "geometry.compile.result", schemaVersion: WORKER_SCHEMA_VERSION, requestId: "req-old", operations: [], document }, "req-1")

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.diagnostic.code).toBe("unexpected_request_id")
  })

  it("accepts a failure response and clamps its detail", () => {
    const parsed = parseWorkerResponse({ kind: "geometry.error", schemaVersion: WORKER_SCHEMA_VERSION, requestId: "req-1", code: "compile_failed", detail: "x".repeat(900) }, "req-1")

    expect(parsed.ok).toBe(true)
    if (parsed.ok && parsed.message.kind === "geometry.error") {
      expect(parsed.message.code).toBe("compile_failed")
      // 诊断文本不能无限长：它会进日志与界面，必须有界。
      expect(parsed.message.detail.length).toBeLessThanOrEqual(512)
    }
  })

  it("drops an unknown response kind instead of throwing", () => {
    const parsed = parseWorkerResponse({ kind: "geometry.party", schemaVersion: WORKER_SCHEMA_VERSION, requestId: "req-1" })

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.dropped).toBe(true)
      expect(parsed.diagnostic.code).toBe("unknown_message_kind")
    }
  })

  it("rejects a result with no document or no operations", () => {
    const noDocument = parseWorkerResponse({ kind: "geometry.compile.result", schemaVersion: WORKER_SCHEMA_VERSION, requestId: "req-1", operations: [] }, "req-1")
    expect(noDocument.ok).toBe(false)
    if (!noDocument.ok) expect(noDocument.diagnostic.code).toBe("missing_document")

    const noOperations = parseWorkerResponse({ kind: "geometry.compile.result", schemaVersion: WORKER_SCHEMA_VERSION, requestId: "req-1", document: createEmptyDocument("conics") }, "req-1")
    expect(noOperations.ok).toBe(false)
    if (!noOperations.ok) expect(noOperations.diagnostic.code).toBe("invalid_operations")
  })
})
