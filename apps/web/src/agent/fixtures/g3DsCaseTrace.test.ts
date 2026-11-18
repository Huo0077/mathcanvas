import { createBudget } from "@draw/agent-core"
import { describe, expect, it, vi } from "vitest"
import ds5Summary from "../../../../../docs/audit/2026-11-17-g3-ds5-live-36/summary.json"
import retest92981Summary from "../../../../../docs/audit/2026-11-17-g3-ds-live-retest-92981/summary.json"
import drawingContracts36 from "../../../../../test-fixtures/reliability/drawing-contracts-36.json"
import { createModelPlanner, type ModelPlannerStructuredEvent } from "../modelPlanner"
import {
  auditInputFigureDependency,
  classifyHistoricalDs5SummaryCase,
  classifyRetest92981Case,
  createG3CaseTrace,
  explainFirstFailure,
  recordBoundary,
  recordRequestTrace,
  serializeG3CaseTrace,
  type G3Boundary,
  type G3CaseTrace
} from "./g3DsCaseTrace"

describe("g3DsCaseTrace (Task 0 observability & sanitization)", () => {
  it("records mixed read+plan on GK-S08 as tool_protocol/mixed_read_plan and never overwrites firstFailure", () => {
    let trace: G3CaseTrace = createG3CaseTrace({
      caseId: "GK-S08",
      runId: "run-gks08-1",
      revision: "f7cc9b76"
    })
    trace = recordRequestTrace(trace, {
      index: 1,
      toolNames: ["scene_inspect", "plan_set_plan"],
      responseKind: "tool_calls",
      usageKnown: true
    })
    trace = recordBoundary(trace, {
      boundary: "tool_protocol",
      code: "mixed_read_plan"
    })
    // A downstream contract failure must not erase the root-cause tool_protocol failure.
    trace = recordBoundary(trace, {
      boundary: "contract",
      code: "missing_required_entities"
    })

    expect(trace.modelInvoked).toBe(true)
    expect(trace.requests).toEqual([
      {
        index: 1,
        toolNames: ["scene_inspect", "plan_set_plan"],
        responseKind: "tool_calls",
        usageKnown: true
      }
    ])
    expect(explainFirstFailure(trace)).toEqual({
      boundary: "tool_protocol",
      code: "mixed_read_plan"
    })
  })

  it("preserves fieldPath on GK-P03 schema/dag boundary failures and returns unknown when unset", () => {
    const emptyTrace = createG3CaseTrace({
      caseId: "GK-P03",
      runId: "run-gkp03-0",
      revision: "f7cc9b76"
    })
    expect(explainFirstFailure(emptyTrace)).toBe("unknown")

    const withFailure = recordBoundary(emptyTrace, {
      boundary: "dag",
      code: "cross_scope_violation",
      fieldPath: "subquestions[1].relations[0].entityRef"
    })
    expect(explainFirstFailure(withFailure)).toEqual({
      boundary: "dag",
      code: "cross_scope_violation",
      fieldPath: "subquestions[1].relations[0].entityRef"
    })
  })

  it("rejects trace creation or serialization containing prompt, apiKey, or toolInput leaks", () => {
    const clean = createG3CaseTrace({
      caseId: "GK-P03",
      runId: "run-sanitize-1",
      revision: "f7cc9b76"
    })

    expect(() =>
      serializeG3CaseTrace({ ...clean, prompt: "如图，椭圆 C 方程为..." } as unknown as G3CaseTrace)
    ).toThrow(/forbidden|sanitiz/i)

    expect(() =>
      serializeG3CaseTrace({ ...clean, apiKey: "sk-live-secret-1234567890" } as unknown as G3CaseTrace)
    ).toThrow(/forbidden|sanitiz/i)

    expect(() =>
      serializeG3CaseTrace({
        ...clean,
        requests: [{ index: 1, toolNames: ["plan_set_plan"], responseKind: "tool_calls", usageKnown: true, toolInput: { goal: "secret" } }]
      } as unknown as G3CaseTrace)
    ).toThrow(/forbidden|sanitiz/i)

    const validJson = serializeG3CaseTrace(clean)
    expect(JSON.parse(validJson)).toMatchObject({
      caseId: "GK-P03",
      runId: "run-sanitize-1",
      revision: "f7cc9b76",
      modelInvoked: false
    })
  })

  it("audits R4 figure-dependent cases GK-S02/GK-S03/JT-S06/JT-S07 and flags input_figure_missing without fabricating figures", () => {
    const suite = drawingContracts36 as {
      cases: Array<{
        id: string
        inputMode?: string
        unsupportedReasons?: string[]
      }>
    }

    for (const id of ["GK-S02", "GK-S03", "JT-S06", "JT-S07"]) {
      const item = suite.cases.find((c) => c.id === id)
      expect(item, `missing ${id} in frozen suite`).toBeDefined()
      const audit = auditInputFigureDependency({
        id: item!.id,
        inputMode: item!.inputMode,
        unsupportedReasons: item!.unsupportedReasons
      })
      expect(audit).toEqual({
        ok: false,
        status: "input_figure_missing",
        boundary: "contract",
        code: "input_figure_missing"
      })
    }

    const confirmed = auditInputFigureDependency({
      id: "GK-S02",
      inputMode: "text_with_figure_reference",
      unsupportedReasons: ["The frozen text says 如图 but supplies no reviewed figure hash/regions"],
      confirmedFigureRefs: [{ figureHash: "sha256-verified", reviewed: true }]
    })
    expect(confirmed).toEqual({
      ok: true,
      status: "confirmed_figure"
    })
  })

  it("builds a sanitized stage coverage table from historical DS5 36-case summary and honestly leaves unprovable cases unknown", () => {
    const summary = ds5Summary as {
      revision: string
      byCase: Array<{
        id: string
        requests: number
        contract: string
        primitiveCount: number
        verification: string | null
        certificate: string | null
        mixedReadAndPlan?: boolean
        toolsByRequest?: string[][]
        usageEvents?: number
      }>
    }

    const traces = summary.byCase.map((entry) => classifyHistoricalDs5SummaryCase(entry, summary.revision))
    expect(traces).toHaveLength(36)

    const counts: Record<G3Boundary | "unknown", number> = {
      provider: 0,
      tool_protocol: 0,
      schema: 0,
      dag: 0,
      stage: 0,
      verification: 0,
      contract: 0,
      render: 0,
      delivery: 0,
      unknown: 0
    }
    for (const trace of traces) {
      const first = explainFirstFailure(trace)
      if (first === "unknown") counts.unknown += 1
      else counts[first.boundary] += 1
    }

    // 7 proven mixed_read_plan failures + 10 verification-stage candidates + 19 unprovable zero-candidate runs -> honest unknown.
    expect(counts.tool_protocol).toBe(7)
    expect(counts.verification).toBe(10)
    expect(counts.unknown).toBe(19)
  })

  it("wires modelPlanner.onStructuredDiagnostic into G3CaseTrace for mixed_read_plan without prompt leaks", async () => {
    const events: ModelPlannerStructuredEvent[] = []
    const executeTool = vi.fn()
    const planner = createModelPlanner({
      intentMode: "ds_intent",
      onStructuredDiagnostic: (event) => { events.push(event) },
      resolveProvider: async () => ({
        ok: true,
        provider: {
          id: "ds-test",
          modelId: "deepseek-v4-flash",
          dialect: "openai",
          revision: 2,
          capabilities: { tools: "verified", json: "verified", vision: "unknown" }
        }
      }),
      runModel: async () => ({
        ok: true,
        events: [
          { kind: "started", requestId: "req-1", attemptId: "att-1", model: "deepseek-v4-flash" },
          { kind: "tool_call", requestId: "req-1", attemptId: "att-1", toolCallId: "tc-1", toolId: "scene_inspect", input: {} },
          { kind: "tool_call", requestId: "req-1", attemptId: "att-1", toolCallId: "tc-2", toolId: "plan_set_plan", input: { schemaVersion: "mathcanvas.ds_intent.v1" } },
          { kind: "usage", requestId: "req-1", attemptId: "att-1", inputTokens: 100, outputTokens: 20 },
          { kind: "completed", requestId: "req-1", attemptId: "att-1", stopReason: "tool_calls" }
        ]
      })
    })

    await expect(
      planner.plan({
        run: {
          runId: "run-planner-trace-1",
          conversationId: "conv-1",
          projectId: "proj-1",
          phase: "planning",
          target: { projectId: "proj-1", documentId: "doc-1", workspace: "geometry3d", epoch: "epoch:1", generation: 0, contentHash: "hash-0" }
        },
        userMessage: "敏感原题不应进入脱敏日志",
        signal: new AbortController().signal,
        budget: createBudget(),
        executeTool,
        model: {
          channel: "native_tools",
          tools: [
            { id: "scene.inspect", kind: "read", effect: "read_scene", description: "inspect", phases: ["planning"], workspaces: [] },
            { id: "plan.set_plan", kind: "control", effect: "propose_plan", description: "plan", phases: ["planning"], workspaces: [] }
          ],
          context: {
            preamble: "MathCanvas",
            handles: {
              target: { projectId: "proj-1", documentId: "doc-1", workspace: "geometry3d", epoch: "epoch:1", generation: 0, contentHash: "hash-0" },
              sources: []
            },
            binding: { conversationId: "conv-1", projectId: "proj-1", documentId: "doc-1", generation: 0 },
            workspace: "geometry3d",
            facts: [],
            derived: [],
            selectedRefs: [],
            skills: [],
            availableActions: ["solid.create_polyhedron"],
            warnings: [],
            estimatedCharacters: 64
          }
        }
      } as unknown as Parameters<typeof planner.plan>[0])
    ).rejects.toThrow(/mixes a read tool/i)

    expect(executeTool).not.toHaveBeenCalled()
    let trace = createG3CaseTrace({ caseId: "GK-S08", runId: "run-planner-trace-1", revision: "test" })
    for (const ev of events) {
      trace =
        ev.kind === "request"
          ? recordRequestTrace(trace, {
              index: ev.index,
              toolNames: ev.toolNames,
              responseKind: ev.responseKind,
              usageKnown: ev.usageKnown
            })
          : recordBoundary(trace, {
              boundary: ev.boundary,
              code: ev.code,
              ...(ev.fieldPath === undefined ? {} : { fieldPath: ev.fieldPath })
            })
    }
    expect(trace.requests).toEqual([
      { index: 1, toolNames: ["scene_inspect", "plan_set_plan"], responseKind: "tool_calls", usageKnown: true }
    ])
    expect(explainFirstFailure(trace)).toEqual({ boundary: "tool_protocol", code: "mixed_read_plan" })
    expect(serializeG3CaseTrace(trace)).not.toContain("敏感原题")
  })

  it("Task F0: freezes 92981ebd 36-case retest truth with 100% first-failure boundary coverage (0 unknown, 0 mixed_read_plan)", () => {
    const summary = retest92981Summary as {
      revision: string
      byCase: Array<{
        id: string
        requests: number
        terminal: string
        contract: string
        primitiveCount: number
        verification: string | null
        certificate: string | null
        toolsByRequest?: string[][]
        failureCodes?: string[]
        usageEvents?: number
      }>
    }
    const traces = summary.byCase.map((entry) => classifyRetest92981Case(entry, summary.revision))
    expect(traces).toHaveLength(36)

    const counts: Record<G3Boundary | "unknown", number> = {
      provider: 0,
      tool_protocol: 0,
      schema: 0,
      dag: 0,
      stage: 0,
      verification: 0,
      contract: 0,
      render: 0,
      delivery: 0,
      unknown: 0
    }
    for (const trace of traces) {
      const first = explainFirstFailure(trace)
      if (first === "unknown") counts.unknown += 1
      else counts[first.boundary] += 1
      expect(serializeG3CaseTrace(trace)).not.toContain("sk-")
    }

    expect(counts.unknown).toBe(0)
    expect(counts.tool_protocol).toBe(0)
    expect(counts.schema + counts.dag + counts.verification).toBe(36)
  })
})
