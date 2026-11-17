import { createBudget } from "@draw/agent-core"
import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"
import drawingContracts36 from "../../../../../test-fixtures/reliability/drawing-contracts-36.json"
import type { DrawingContractCase } from "../../../../../scripts/reliability-eval/drawingContracts"
import { createModelPlanner } from "../modelPlanner"
import {
  aggregateTask6FunnelReport,
  compareLegacySingleVsMultiSliceReplay,
  evaluateTask6LivePreflight,
  projectPublicFrozenCaseInput,
  runFrozenDsCase,
  type CandidateSliceArtifact
} from "./g3DsFrozenCaseRunner"

const suite = drawingContracts36 as { cases: DrawingContractCase[] }

function getCase(id: string): DrawingContractCase {
  const found = suite.cases.find((c) => c.id === id)
  if (!found) throw new Error(`Missing frozen case ${id}`)
  return found
}

function makeGkp06Slice(d: number, branchId: string): CandidateSliceArtifact {
  const aX = d + Math.sqrt(d * d + 1)
  const bX = d - Math.sqrt(d * d + 1)
  const D = { x: d, y: -0.5 }
  const A = { x: aX, y: (aX * aX) / 2 }
  const B = { x: bX, y: (bX * bX) / 2 }
  const M = { x: d, y: d * d + 0.5 }
  const base = createEmptyDocument("conics")
  return {
    scopeId: "(2)",
    branchId,
    document: {
      ...base,
      primitives: [
        { id: "c", type: "parabola", label: "C", vertex: { x: 0, y: 0 }, axis: "y", focalParameter: 1 },
        { id: "d", type: "point", label: "D", ...D },
        { id: "a", type: "point", label: "A", ...A },
        { id: "b", type: "point", label: "B", ...B },
        { id: "m", type: "point", label: "M", ...M },
        { id: "e-pt", type: "point", label: "E", x: 0, y: 2.5 },
        { id: "e", type: "circle", label: "E", center: { x: 0, y: 2.5 }, radius: Math.hypot(d, 2 - d * d) },
        { id: "da", type: "line", label: "DA", a: D, b: A },
        { id: "db", type: "line", label: "DB", a: D, b: B },
        { id: "ab", type: "line", label: "AB", a: A, b: B }
      ]
    }
  }
}

describe("g3DsFrozenCaseRunner (Task 4 unified multi-scope/state/branch entry, zero cost)", () => {
  it("projects strictly public fields and never leaks requiredObligations or expected gold answers into planner requests", () => {
    const jts04 = getCase("JT-S04")
    const pub = projectPublicFrozenCaseInput({
      ...jts04,
      confirmedFigureRefs: [{ figureHash: "fig-1", reviewed: true }]
    })

    expect(Object.keys(pub).sort()).toEqual(["confirmedFigureRefs", "id", "prompt", "workspace"])
    const serialized = JSON.stringify(pub)
    expect(serialized).not.toContain("requiredObligations")
    expect(serialized).not.toContain("requiredEntityIds")
    expect(serialized).not.toContain("expectedResult")
    expect(serialized).not.toContain("displayPolicy")
  })

  it("evaluates multi-branch GK-P06 (zero/positive/negative) and rejects missing branch, shared-only figure, or tampered candidateHash", async () => {
    const gkp06 = getCase("GK-P06")
    const pub = projectPublicFrozenCaseInput(gkp06)
    const seenRequests: unknown[] = []

    const validSlices = [
      makeGkp06Slice(0, "zero"),
      makeGkp06Slice(1, "positive"),
      makeGkp06Slice(-1, "negative")
    ]

    const passRes = await runFrozenDsCase(
      pub,
      async (req) => {
        seenRequests.push(req)
        return { modelInvoked: true, slices: validSlices }
      },
      createBudget(),
      { contract: gkp06 }
    )
    expect(JSON.stringify(seenRequests)).not.toContain("requiredObligations")
    expect(passRes.modelInvoked).toBe(true)
    expect(passRes.renderStatus).toBe("pending")
    expect(passRes.commitStatus).toBe("pending")
    expect(passRes.candidateSet).toHaveLength(3)
    expect(passRes.candidateSet.every((c) => c.certificateStatus === "passed" && c.candidateHash.length > 10), JSON.stringify(passRes.candidateSet)).toBe(true)
    expect(passRes.contractStatus).toBe("passed")

    // 1. Delete one branch -> incomplete / must fail
    const missingBranchRes = await runFrozenDsCase(
      pub,
      async () => ({ modelInvoked: true, slices: validSlices.slice(0, 2) }),
      createBudget(),
      { contract: gkp06 }
    )
    expect(missingBranchRes.contractStatus).toBe("incomplete")

    // 2. Only draw shared main diagram (missing branches & branch scope) -> must fail
    const sharedOnlyRes = await runFrozenDsCase(
      pub,
      async () => ({
        modelInvoked: true,
        slices: [{ scopeId: "shared", document: validSlices[0]!.document }]
      }),
      createBudget(),
      { contract: gkp06 }
    )
    expect(sharedOnlyRes.contractStatus).not.toBe("passed")

    // 3. Tamper candidateHash / stale certificate on one mathematically valid slice -> overall MUST fail
    const tamperedSlices = [
      { ...validSlices[0]!, overrideCertificateHash: "stale-hash-mismatch" },
      validSlices[1]!,
      validSlices[2]!
    ]
    const tamperedRes = await runFrozenDsCase(
      pub,
      async () => ({ modelInvoked: true, slices: tamperedSlices }),
      createBudget(),
      { contract: gkp06 }
    )
    expect(tamperedRes.candidateSet[0]?.certificateStatus).toBe("blocked")
    expect(tamperedRes.contractStatus).toBe("failed")
  })

  it("evaluates multi-state JT-S04 (before_fold/after_fold) and JT-S08 (t0/t1) and fails when stateIds are swapped or truncated", async () => {
    const jts04 = getCase("JT-S04")
    const jts08 = getCase("JT-S08")

    const beforeDoc = createEmptyDocument("geometry3d")
    beforeDoc.primitives = [
      { id: "a", type: "point3", label: "A", position: { x: 0, y: 0, z: 0 } },
      { id: "b", type: "point3", label: "B", position: { x: 0, y: 5, z: 0 } },
      { id: "c", type: "point3", label: "C", position: { x: 3, y: 5, z: 0 } },
      { id: "d", type: "point3", label: "D", position: { x: 3, y: 0, z: 0 } }
    ]
    const afterDoc = createEmptyDocument("geometry3d")
    afterDoc.primitives = [
      { id: "a", type: "point3", label: "A", position: { x: 0, y: 0, z: 5 } },
      { id: "b", type: "point3", label: "B", position: { x: 0, y: 5, z: 5 } }
    ]

    // Swapping before_fold <-> after_fold MUST NOT pass even with mocked incomplete geometry
    const swappedRes = await runFrozenDsCase(
      projectPublicFrozenCaseInput(jts04),
      async () => ({
        modelInvoked: true,
        slices: [
          { scopeId: "(1)", stateId: "before_fold", document: afterDoc },
          { scopeId: "(1)", stateId: "after_fold", document: beforeDoc }
        ]
      }),
      createBudget(),
      { contract: jts04 }
    )
    expect(swappedRes.contractStatus).not.toBe("passed")

    // Deleting t1 on JT-S08 -> incomplete, must NOT pass
    const jts08MissingT1 = await runFrozenDsCase(
      projectPublicFrozenCaseInput(jts08),
      async () => ({
        modelInvoked: true,
        slices: [{ scopeId: "(2)", branchId: "t0", document: beforeDoc }]
      }),
      createBudget(),
      { contract: jts08 }
    )
    expect(jts08MissingT1.contractStatus).toBe("incomplete")

    // Zero-cost replay comparison: old single-candidate vs multi-slice GK-P06 divergence
    const gkp06 = getCase("GK-P06")
    const replayDiv = compareLegacySingleVsMultiSliceReplay(
      gkp06,
      makeGkp06Slice(0, "zero").document,
      [
        { scopeId: "(2)", branchId: "zero", candidate: makeGkp06Slice(0, "zero").document },
        { scopeId: "(2)", branchId: "positive", candidate: makeGkp06Slice(1, "positive").document },
        { scopeId: "(2)", branchId: "negative", candidate: makeGkp06Slice(-1, "negative").document }
      ]
    )
    expect(replayDiv.multiSliceStatus).toBe("passed")
  })

  it("wires plan.set_plan in PlannerPort requests and enforces fail-closed Task 6 live preflight & funnel accounting", async () => {
    const jts01 = getCase("JT-S01")
    const observedToolIds: string[] = []
    const capturedToolsInModel: string[][] = []
    const planner = createModelPlanner({
      intentMode: "ds_intent",
      resolveProvider: async () => ({
        ok: true,
        provider: {
          id: "deepseek",
          modelId: "deepseek-v4-flash",
          dialect: "openai",
          revision: 2,
          capabilities: { tools: "verified", json: "verified", vision: "unknown" }
        }
      }),
      runModel: async (req) => {
        capturedToolsInModel.push(
          req.tools.map((t) => (t as { function?: { name?: string } }).function?.name ?? "unknown")
        )
        return {
          ok: true,
          events: [
            {
              kind: "tool_call",
              requestId: "r-planner",
              attemptId: "a-planner",
              toolCallId: "tc-planner",
              toolId: "plan_set_plan",
              input: {
                schemaVersion: "mathcanvas.ds_intent.v1",
                goal: "clarify",
                entities: [],
                givenRelations: [],
                subquestions: [],
                constructionStrategies: [],
                unknowns: [{ kind: "underdetermined", scopeId: "shared", detail: "need details", blocking: true }]
              }
            }
          ]
        }
      }
    })

    const wrappedPlanner = {
      async plan(req: Parameters<typeof planner.plan>[0]) {
        for (const t of req.model.tools) observedToolIds.push(t.id)
        return planner.plan(req)
      }
    }

    await runFrozenDsCase(projectPublicFrozenCaseInput(jts01), wrappedPlanner, createBudget())
    expect(observedToolIds).toContain("plan.set_plan")
    expect(capturedToolsInModel[0]).toEqual(["plan_set_plan"])

    // Missing pricingSource or maxUsd MUST refuse Task 6 live execution (0 paid calls allowed).
    const unauthPreflight = evaluateTask6LivePreflight({
      revision: "b776d609",
      suiteHash: "c3671cc8",
      modelId: "deepseek-v4-flash",
      profileRevision: 2,
      selectedCaseIds: ["GK-S08", "GK-S05", "GK-P03"],
      maxRequests: 12,
      maxPerCase: 3,
      maxInputBytes: 80000,
      maxOutputTokens: 4096,
      maxUsd: 2.0,
      pricingSource: "",
      failureStopThreshold: 2,
      estimatedMaxCostUsd: 0.45
    })
    expect(unauthPreflight.authorized).toBe(false)
    if (!unauthPreflight.authorized) {
      expect(unauthPreflight.reason).toBe("missing_pricing_source")
    }

    const overCapPreflight = evaluateTask6LivePreflight({
      revision: "b776d609",
      suiteHash: "c3671cc8",
      modelId: "deepseek-v4-flash",
      profileRevision: 2,
      selectedCaseIds: ["GK-S08", "GK-S05", "GK-P03"],
      maxRequests: 12,
      maxPerCase: 3,
      maxInputBytes: 80000,
      maxOutputTokens: 4096,
      maxUsd: 1.0,
      pricingSource: "https://api-docs.deepseek.com/quick_start/pricing (2026-11-17)",
      failureStopThreshold: 2,
      estimatedMaxCostUsd: 1.25
    })
    expect(overCapPreflight.authorized).toBe(false)
    if (!overCapPreflight.authorized) {
      expect(overCapPreflight.reason).toBe("estimated_cost_exceeds_cap")
    }

    // Funnel report marks costKnown=false when usageEvents < requestsCount and trips circuit breaker on mixed protocol recurrence.
    const report = aggregateTask6FunnelReport(
      [
        {
          caseId: "GK-S08",
          modelInvoked: true,
          firstAttemptPassed: false,
          contractStatus: "failed",
          certificateStatus: "blocked",
          renderStatus: "pending",
          commitStatus: "pending",
          requestsUsed: 1,
          usageEventsReported: 0,
          inputBytes: 1200,
          inputTokens: 0,
          outputTokens: 0,
          firstBoundary: "tool_protocol",
          firstCode: "mixed_read_plan"
        }
      ],
      { failureStopThreshold: 2 }
    )
    expect(report.costKnown).toBe(false)
    expect(report.costUsd).toBeNull()
    expect(report.shouldStopBatch).toBe(true)
    expect(report.stopReason).toBe("mixed_read_plan_recurrence")
  })
})
