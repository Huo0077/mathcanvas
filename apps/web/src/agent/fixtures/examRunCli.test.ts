import { PLAN_SCHEMA_VERSION, type ExamEvaluationReport } from "@draw/agent-core"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { invokeDesktop } from "../../services/desktopRuntime"
import { maybeRunExamFromShell } from "./examRunCli"

// Replace only the external desktop/transport boundaries. The planner, runtime,
// coordinator, authorization gate and report aggregation remain real.
const boundary = vi.hoisted(() => ({ runModel: vi.fn(), resolve: vi.fn() }))
vi.mock("../../services/desktopRuntime", async (importOriginal) => ({ ...await importOriginal<typeof import("../../services/desktopRuntime")>(), invokeDesktop: vi.fn() }))
vi.mock("../modelPlanner", async (importOriginal) => {
  const real = await importOriginal<typeof import("../modelPlanner")>()
  return { ...real, resolveActiveProvider: boundary.resolve,
    createModelPlanner: () => real.createModelPlanner({ resolveProvider: boundary.resolve, runModel: boundary.runModel }) }
})
const CLARIFICATION = { schemaVersion: PLAN_SCHEMA_VERSION, kind: "clarification", goal: "Need the diagram", factIds: [], questions: ["Which diagram is intended?"] }
const INVALID_PLAN = { schemaVersion: "invalid", kind: "plan", goal: "Need repair", factIds: [], actions: [] }
function reply(plan: unknown) {
  return { ok: true, events: [{ kind: "delta", requestId: "smoke", attemptId: "smoke", text: JSON.stringify(plan) }] }
}
let report: { evaluation: { ok: true; report: ExamEvaluationReport } | { ok: false; reason: string }; planned: { requests: number }; frozen: { authorization: { maxRequests: number; maxCostUsd: number } } } | undefined
beforeEach(() => {
  vi.clearAllMocks()
  report = undefined
  boundary.resolve.mockResolvedValue({ ok: true, provider: { id: "synthetic-smoke", modelId: "synthetic-smoke", dialect: "openai", revision: 1, capabilities: { tools: "unknown", json: "unknown", vision: "unknown" } } })
  boundary.runModel.mockImplementation(async () => reply(CLARIFICATION))
  vi.mocked(invokeDesktop).mockImplementation(async (command, args) => {
    if (command === "exam_run_target") return "synthetic-smoke-report.json" as never
    if (command === "exam_run_finish") { report = JSON.parse((args as { report: string }).report); return "ok" as never }
    throw new Error(`unexpected IPC ${command}`)
  })
})
describe("shell exam integration (synthetic transport, no paid provider)", () => {
  it.each([null, "  "])("does not resolve or contact a provider without a shell target (%s)", async (target) => {
    vi.mocked(invokeDesktop).mockResolvedValue(target)
    expect(await maybeRunExamFromShell()).toBe(false)
    expect(boundary.resolve).not.toHaveBeenCalled()
    expect(boundary.runModel).not.toHaveBeenCalled()
    expect(report).toBeUndefined()
  })
  it("returns a coordinator-driven report without inventing readability or dollar costs", async () => {
    expect(await maybeRunExamFromShell()).toBe(true)
    expect(boundary.runModel).toHaveBeenCalledTimes(36)
    expect(report?.planned.requests).toBe(36)
    expect(report?.frozen.authorization).toMatchObject({ maxRequests: 36, maxCostUsd: 12 })
    expect(report?.evaluation.ok).toBe(true)
    if (!report?.evaluation.ok) throw new Error("missing smoke report")
    expect(report.evaluation.report.repairPath).toBe("coordinator-driven")
    expect(report.evaluation.report.totals).toMatchObject({ requests: 36, logicalTrials: 36, costUsd: null })
    const costs = report.evaluation.report.verdicts.filter((verdict) => verdict.metric === "costPerCase")
    expect(costs).toHaveLength(4)
    expect(costs.every((verdict) => verdict.actual === null && !verdict.passed)).toBe(true)
    const readability = report.evaluation.report.verdicts.filter((verdict) => verdict.metric === "unreadable")
    expect(readability).toHaveLength(4)
    expect(readability.every((verdict) => verdict.actual === null && !verdict.passed)).toBe(true)
  })
  it("counts schema repair inside, not beyond, the frozen 36-request authorization", async () => {
    boundary.runModel.mockImplementationOnce(async () => reply(INVALID_PLAN))
    expect(await maybeRunExamFromShell()).toBe(true)
    expect(boundary.runModel).toHaveBeenCalledTimes(36)
    expect(report?.evaluation.ok).toBe(false)
    if (report?.evaluation.ok !== false) throw new Error("repair must exhaust the fixed authorization")
    expect(report.evaluation.reason).toContain("provider")
  })
})
