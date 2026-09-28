import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type DocumentHandle, type RunContext, type ToolExecutionIdentity, type ToolResult, type VerificationReport } from "./contracts"
import { parseToolExecutionIdentity, parseVerificationReport } from "./toolContracts"

/**
 * 传输契约的**形状守卫**（设计规格 §6 + 计划 Task 0.2 的 Interfaces 段）。
 *
 * 这些用例不测运行时逻辑，只把"契约里必须有的字段"钉住：契约是 Rust 与 TS 两端的共同事实，
 * 少一个字段在编译期才被发现就太晚了（Rust 侧没有同一份类型检查）。
 */
describe("transport contracts", () => {
  it("pins the plan schema version so both sides negotiate the same protocol", () => {
    expect(PLAN_SCHEMA_VERSION).toBe("mathcanvas.plan.v1")
  })

  it("keeps DocumentHandle able to express ABA protection", () => {
    const handle: DocumentHandle = { projectId: "p", documentId: "d", workspace: "cad", epoch: "e", generation: 3, contentHash: "h" }

    // generation 单调递增（含撤销/重做）+ epoch 变更 = 旧授权不会因为"内容又一样了"复活。
    expect(handle.generation).toBeGreaterThan(0)
    expect(handle.epoch).not.toBe("")
    expect(handle.contentHash).not.toBe("")
  })

  it("keeps RunContext carrying the trusted handles the model must not fill in", () => {
    const handle: DocumentHandle = { projectId: "p", documentId: "d", workspace: "conics", epoch: "e", generation: 1, contentHash: "h" }
    const context: RunContext = {
      runId: "run_1",
      conversationId: "c1",
      promptMessageId: "m1",
      target: handle,
      sources: [{ layout: { ...handle, workspace: "cad" }, geometry: { ...handle, workspace: "geometry3d" }, viewId: "front" }],
      textProfileId: "profile-1",
      capabilityRevision: "2026-09-19.1",
      policyRevision: "policy-1"
    }

    // 目标 / 来源 / 能力修订都来自可信上下文，而不是模型输出。
    expect(context.target.documentId).toBe("d")
    expect(context.capabilityRevision).toBe("2026-09-19.1")
    expect(context.sources[0].viewId).toBe("front")
  })

  it("requires every field the plan demands of a tool result", () => {
    const result: ToolResult<{ applied: number }> = {
      status: "warning",
      summary: "预览已生成，尚未提交",
      next_actions: ["确认提交", "调整尺寸"],
      artifacts: [{ kind: "draft", id: "draft_1" }],
      payload: { applied: 0 },
      diagnostics: [{ code: "STALE_HANDLE", severity: "warning", message: "目标版本已变化" }],
      recovery: { rootCauseHint: "用户改过尺寸", safeRetry: "refresh_context", stopCondition: "再次失败则终止该 run" }
    }

    for (const key of ["status", "summary", "next_actions", "artifacts", "payload", "diagnostics"] as const) {
      expect(result[key], `tool result is missing ${key}`).toBeDefined()
    }
    expect(result.recovery?.safeRetry).toBe("refresh_context")
  })
})

describe("tool execution and verification contracts", () => {
  it("requires an execution identity to bind a tool result to one draft version", () => {
    const identity: ToolExecutionIdentity = {
      runId: "run_1",
      stepId: "step_1",
      toolCallId: "call_1",
      draftVersion: 2,
      baseDocumentHash: "sha256:base"
    }

    expect(identity.stepId).toBe("step_1")
    expect(identity.draftVersion).toBe(2)
  })

  it("represents verification as explicit checks instead of a boolean", () => {
    const report: VerificationReport = {
      status: "failed",
      checks: [{ id: "edge-length", status: "failed", detail: "edge length is 2, expected 3", path: "cube.edgeLength" }],
      next_actions: ["update the cube size", "re-run verification"]
    }

    expect(report.status).toBe("failed")
    expect(report.checks[0]?.path).toBe("cube.edgeLength")
  })
})


describe("untrusted tool execution metadata", () => {
  it("accepts a well-formed identity without rewriting its binding", () => {
    const value = { runId: "run_1", stepId: "step_1", toolCallId: "call_1", draftVersion: 2, baseDocumentHash: "sha256:base" }
    expect(parseToolExecutionIdentity(value)).toEqual({ ok: true, value })
  })

  it("rejects an identity without a positive draft version or complete binding", () => {
    const malformed = { runId: "run_1", stepId: "", toolCallId: "call_1", draftVersion: 0, baseDocumentHash: "sha256:base", ignored: true }
    const result = parseToolExecutionIdentity(malformed)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.map((error) => error.path)).toEqual(expect.arrayContaining(["identity.stepId", "identity.draftVersion", "identity.ignored"]))
  })

  it("requires verification checks with known statuses and concrete ids", () => {
    const invalid = { status: "passed", checks: [{ id: "", status: "definitely", detail: "looks fine" }], next_actions: [] }
    const result = parseVerificationReport(invalid)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.map((error) => error.path)).toEqual(expect.arrayContaining(["verification.checks[0].id", "verification.checks[0].status"]))
  })

  it("accepts an explicit not-supported check without claiming it passed", () => {
    const value = { status: "not_supported", checks: [{ id: "render", status: "not_supported", detail: "vision unavailable" }], next_actions: ["ask user to inspect"] }
    expect(parseVerificationReport(value)).toEqual({ ok: true, value })
  })

  it("cannot report overall success with a failed or empty check list", () => {
    const contradictory = parseVerificationReport({ status: "passed", checks: [{ id: "size", status: "failed", detail: "expected 3, got 2" }], next_actions: [] })
    const empty = parseVerificationReport({ status: "passed", checks: [], next_actions: [] })
    expect(contradictory.ok).toBe(false)
    expect(empty.ok).toBe(false)
    if (!contradictory.ok) expect(contradictory.errors).toEqual(expect.arrayContaining([expect.objectContaining({ path: "verification.status" })]))
  })})
