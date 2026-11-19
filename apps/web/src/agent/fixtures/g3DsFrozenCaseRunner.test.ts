import { createBudget } from "@draw/agent-core"
import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"
import drawingContracts36 from "../../../../../test-fixtures/reliability/drawing-contracts-36.json"
import type { DrawingContractCase } from "../../../../../scripts/reliability-eval/drawingContracts"
import { createModelPlanner } from "../modelPlanner"
import {
  aggregateTask6FunnelReport,
  compareLegacySingleVsMultiSliceReplay,
  evaluateFrozenCandidateSet,
  evaluateTask6LivePreflight,
  projectPublicFrozenCaseInput,
  runFrozenDsCase,
  runFrozenDsCaseTraced,
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

  it("binds distinct documentHash/candidateHash per pre_fold/post_fold/mirror lineage and unifies live vs offline CandidateSet evaluation", async () => {
    const gkp06 = getCase("GK-P06")
    const pub = projectPublicFrozenCaseInput(gkp06)
    const validSlices = [
      makeGkp06Slice(0, "zero"),
      makeGkp06Slice(1, "positive"),
      makeGkp06Slice(-1, "negative")
    ]

    const liveRes = await runFrozenDsCase(
      pub,
      async () => ({ modelInvoked: true, slices: validSlices }),
      createBudget(),
      { contract: gkp06 }
    )
    const offlineEval = evaluateFrozenCandidateSet(pub, validSlices, gkp06)
    expect(offlineEval.contractStatus).toBe(liveRes.contractStatus)
    expect(offlineEval.candidateSet.map((c) => c.candidateHash)).toEqual(
      liveRes.candidateSet.map((c) => c.candidateHash)
    )
    expect(offlineEval.candidateSet.every((c) => c.documentHash.length > 10 && c.lineageKey.length > 0)).toBe(true)

    const duplicateMirrorDoc = makeGkp06Slice(1, "mirror").document
    const collidingSlices: CandidateSliceArtifact[] = [
      { scopeId: "(2)", stateId: "pre_fold", branchId: "primary", document: duplicateMirrorDoc },
      { scopeId: "(2)", stateId: "post_fold", branchId: "mirror", document: duplicateMirrorDoc }
    ]
    const collisionEval = evaluateFrozenCandidateSet(pub, collidingSlices, gkp06)
    expect(collisionEval.contractStatus).toBe("failed")
    expect(collisionEval.candidateSet.some((c) => c.certificateStatus === "blocked")).toBe(true)
  })

  it("Task 4 executes live ds_action multi-state fold (GK-S02) into independent CandidateSet slices passing contract evaluation", async () => {
    const gks02 = getCase("GK-S02")
    const pub = projectPublicFrozenCaseInput(gks02)
    const r = Math.sqrt(3)
    const calls = [
      { id: "d1", name: "construct_point", input: { id: "D", label: "D", x: 0, y: 0, z: 0, scopeId: "(2)", stateId: "before_fold" } },
      { id: "d2", name: "construct_point", input: { id: "C", label: "C", x: 0, y: 3, z: 0, scopeId: "(2)", stateId: "before_fold" } },
      { id: "d3", name: "construct_point", input: { id: "B", label: "B", x: r, y: 4, z: 0, scopeId: "(2)", stateId: "before_fold" } },
      { id: "d4", name: "construct_point", input: { id: "A", label: "A", x: 5 * r, y: 0, z: 0, scopeId: "(2)", stateId: "before_fold" } },
      { id: "d5", name: "construct_point", input: { id: "E", label: "E", from: "A", to: "D", ratio: 0.4, scopeId: "(2)", stateId: "before_fold" } },
      { id: "d6", name: "construct_point", input: { id: "F", label: "F", from: "A", to: "B", ratio: 0.5, scopeId: "(2)", stateId: "before_fold" } },
      {
        id: "d7",
        name: "construct_fold_state",
        input: {
          id: "fold",
          label: "PEF",
          vertexNames: ["A", "E", "F"],
          hinge: { from: "E", to: "F" },
          apex: "A",
          apexAs: "P",
          angle: 90,
          scopeId: "(2)",
          preStateId: "before_fold",
          stateId: "after_fold"
        }
      },
      {
        id: "d8",
        name: "construct_face",
        input: {
          id: "base",
          label: "EDCBEF",
          vertexNames: ["E", "D", "C", "B", "F"],
          scopeId: "(2)",
          stateId: "after_fold"
        }
      },
      { id: "d9", name: "finish_candidate", input: { goal: "GK-S02 fold construction" } }
    ]

    const providerStub = {
      id: "deepseek",
      modelId: "deepseek-v4-flash",
      dialect: "openai" as const,
      revision: 2,
      capabilities: { tools: "verified" as const, json: "verified" as const, vision: "unknown" as const }
    }
    let idx = 0
    const seenRequests: unknown[] = []
    const planner = createModelPlanner({
      intentMode: "ds_action",
      resolveProvider: async () => ({ ok: true, provider: providerStub }),
      async runModel(req) {
        seenRequests.push(req)
        const next = calls[idx++]!
        return {
          ok: true,
          events: [{ kind: "tool_call", requestId: `r-${idx}`, attemptId: `a-${idx}`, toolCallId: next.id, toolId: next.name, input: next.input }]
        }
      }
    })

    const res = await runFrozenDsCase(pub, planner, createBudget({ network: 20, generation: 20, tool: 30 }), { contract: gks02 })
    expect(JSON.stringify(seenRequests)).not.toContain("requiredObligations")
    expect(JSON.stringify(seenRequests)).not.toContain("expectedResult")
    expect(res.candidateSet.map((s) => s.stateId)).toEqual(["before_fold", "after_fold"])
    expect(new Set(res.candidateSet.map((s) => s.candidateHash)).size).toBe(2)
    expect(res.candidateSet.every((s) => s.certificateStatus === "passed"), JSON.stringify(res.candidateSet)).toBe(true)
    expect(res.contractStatus).toBe("passed")
  })

  it("Task 4 executes live ds_action multi-branch (GK-P06) into independent CandidateSet slices and rejects missing branches", async () => {
    const gkp06 = getCase("GK-P06")
    const pub = projectPublicFrozenCaseInput(gkp06)
    const providerStub = {
      id: "deepseek",
      modelId: "deepseek-v4-flash",
      dialect: "openai" as const,
      revision: 2,
      capabilities: { tools: "verified" as const, json: "verified" as const, vision: "unknown" as const }
    }
    const buildBranchCalls = (d: number, branchId: string, prefix: string) => {
      const aX = d + Math.sqrt(d * d + 1)
      const bX = d - Math.sqrt(d * d + 1)
      return [
        { id: `${prefix}-1`, name: "construct_point", input: { id: "D", label: "D", x: d, y: -0.5, scopeId: "(2)", branchId } },
        { id: `${prefix}-2`, name: "construct_point", input: { id: "A", label: "A", x: aX, y: (aX * aX) / 2, scopeId: "(2)", branchId } },
        { id: `${prefix}-3`, name: "construct_point", input: { id: "B", label: "B", x: bX, y: (bX * bX) / 2, scopeId: "(2)", branchId } },
        { id: `${prefix}-4`, name: "construct_point", input: { id: "M", label: "M", x: d, y: d * d + 0.5, scopeId: "(2)", branchId } },
        { id: `${prefix}-5`, name: "construct_point", input: { id: "E_pt", label: "E", x: 0, y: 2.5, scopeId: "(2)", branchId } },
        { id: `${prefix}-6`, name: "construct_circle", input: { id: "E", label: "E", cx: 0, cy: 2.5, radius: Math.hypot(d, 2 - d * d), scopeId: "(2)", branchId } },
        { id: `${prefix}-7`, name: "construct_line", input: { id: "DA", label: "DA", from: "D", to: "A", scopeId: "(2)", branchId } },
        { id: `${prefix}-8`, name: "construct_line", input: { id: "DB", label: "DB", from: "D", to: "B", scopeId: "(2)", branchId } },
        { id: `${prefix}-9`, name: "construct_line", input: { id: "AB", label: "AB", from: "A", to: "B", scopeId: "(2)", branchId } }
      ]
    }
    const calls = [
      { id: "c0", name: "construct_conic", input: { id: "C", label: "C", conicType: "parabola", focalParameter: 1, scopeId: "(2)" } },
      ...buildBranchCalls(0, "zero", "b0"),
      ...buildBranchCalls(1, "positive", "b1"),
      ...buildBranchCalls(-1, "negative", "b2"),
      { id: "done", name: "finish_candidate", input: { goal: "GK-P06 3 branches" } }
    ]

    let idx = 0
    const planner = createModelPlanner({
      intentMode: "ds_action",
      resolveProvider: async () => ({ ok: true, provider: providerStub }),
      async runModel() {
        const next = calls[idx++]!
        return {
          ok: true,
          events: [{ kind: "tool_call", requestId: `r-${idx}`, attemptId: `a-${idx}`, toolCallId: next.id, toolId: next.name, input: next.input }]
        }
      }
    })

    const res = await runFrozenDsCase(pub, planner, createBudget({ network: 40, generation: 40, tool: 60 }), { contract: gkp06 })
    expect(res.candidateSet.map((s) => s.branchId)).toEqual(["zero", "positive", "negative"])
    expect(new Set(res.candidateSet.map((s) => s.candidateHash)).size).toBe(3)
    expect(res.candidateSet.every((s) => s.certificateStatus === "passed"), JSON.stringify(res.candidateSet)).toBe(true)
    expect(res.contractStatus).toBe("passed")

    // Counterexample: omitting one branch must produce incomplete (not pass).
    const twoBranchCalls = [
      { id: "c0", name: "construct_conic", input: { id: "C", label: "C", conicType: "parabola", focalParameter: 1, scopeId: "(2)" } },
      ...buildBranchCalls(0, "zero", "b0"),
      ...buildBranchCalls(1, "positive", "b1"),
      { id: "done", name: "finish_candidate", input: { goal: "GK-P06 missing negative" } }
    ]
    let idx2 = 0
    const plannerMissing = createModelPlanner({
      intentMode: "ds_action",
      resolveProvider: async () => ({ ok: true, provider: providerStub }),
      async runModel() {
        const next = twoBranchCalls[idx2++]!
        return {
          ok: true,
          events: [{ kind: "tool_call", requestId: `m-${idx2}`, attemptId: `ma-${idx2}`, toolCallId: next.id, toolId: next.name, input: next.input }]
        }
      }
    })
    const resMissing = await runFrozenDsCase(pub, plannerMissing, createBudget({ network: 40, generation: 40, tool: 60 }), { contract: gkp06 })
    expect(resMissing.contractStatus).toBe("incomplete")
  })

  it("Task 5 zero-cost gate replays GK-S08 via ds_action (construct_point -> construct_solid -> query_measurement -> finish_candidate) with passed certificate, contract, and bounded budget", async () => {
    const gks08 = getCase("GK-S08")
    const pub = projectPublicFrozenCaseInput(gks08)
    const providerStub = {
      id: "deepseek",
      modelId: "deepseek-v4-flash",
      dialect: "openai" as const,
      revision: 2,
      capabilities: { tools: "verified" as const, json: "verified" as const, vision: "unknown" as const }
    }
    const calls = [
      { id: "k1", name: "construct_point", input: { id: "A", label: "A", x: 0, y: 0, z: 0 } },
      { id: "k2", name: "construct_point", input: { id: "B", label: "B", x: 2, y: 0, z: 0 } },
      { id: "k3", name: "construct_point", input: { id: "C", label: "C", x: 1.5, y: Math.sqrt(3) / 2, z: 0 } },
      { id: "k4", name: "construct_point", input: { id: "D", label: "D", x: 0.5, y: Math.sqrt(3) / 2, z: 0 } },
      {
        id: "k5",
        name: "construct_solid",
        input: {
          id: "P_ABCD",
          kind: "perpendicular_pyramid",
          baseVertexNames: ["A", "B", "C", "D"],
          apexName: "P",
          footName: "D",
          height: Math.sqrt(3)
        }
      },
      { id: "k6", name: "query_measurement", input: { metric: "distance", targets: ["D", "P"] } },
      { id: "k7", name: "finish_candidate", input: { goal: "GK-S08 perpendicular trapezoid pyramid" } }
    ]

    let idx = 0
    let seenDpDistance = Number.NaN
    const budget = createBudget({ network: 7, generation: 7, tool: 12 })
    const planner = createModelPlanner({
      intentMode: "ds_action",
      resolveProvider: async () => ({ ok: true, provider: providerStub }),
      async runModel(req) {
        const last = req.messages.at(-1)
        if (last?.role === "tool_result" && idx === 6) {
          const parsed = JSON.parse(last.content) as { ok?: boolean; measurement?: { value?: number } }
          if (parsed.ok && typeof parsed.measurement?.value === "number") {
            seenDpDistance = parsed.measurement.value
          }
        }
        const next = calls[idx++]!
        return {
          ok: true,
          events: [{ kind: "tool_call", requestId: `s08-r-${idx}`, attemptId: `s08-a-${idx}`, toolCallId: next.id, toolId: next.name, input: next.input }]
        }
      }
    })

    const res = await runFrozenDsCase(pub, planner, budget, { contract: gks08 })
    expect(seenDpDistance).toBeCloseTo(Math.sqrt(3), 6)
    expect(res.modelInvoked).toBe(true)
    expect(res.renderStatus).toBe("pending")
    expect(res.commitStatus).toBe("pending")
    expect(res.candidateSet).toHaveLength(1)
    expect(res.candidateSet[0]?.certificateStatus).toBe("passed")
    expect(res.candidateSet[0]?.candidateHash.length).toBeGreaterThan(10)
    expect(res.contractStatus).toBe("passed")
    expect(budget.remaining("network")).toBe(0)
    expect(budget.remaining("generation")).toBe(1)
  })
})


describe("figure-dependent native DS preflight (zero cost)", () => {
  it.each(["GK-S01", "GK-S02", "JT-S07"])("refuses to call the model for missing image %s even when unsupportedReasons is empty", async (id) => {
    const frozen = getCase(id)
    let requests = 0
    const traces: import("./g3DsCaseTrace").G3CaseTrace[] = []
    const result = await runFrozenDsCaseTraced(
      { id, prompt: frozen.prompt, workspace: frozen.workspace },
      createBudget({ network: 10, generation: 10, tool: 10 }),
      { intentMode: "ds_action", runModel: async () => { requests += 1; throw new Error("must not call provider") } },
      { contract: frozen, revision: "image-gate", runId: `missing-${id}`, onTrace: (trace) => traces.push(trace) }
    )
    expect(requests).toBe(0)
    expect(result).toMatchObject({ modelInvoked: false, contractStatus: "incomplete", candidateSet: [], renderStatus: "pending", commitStatus: "pending" })
    expect(traces).toHaveLength(1)
    expect(traces[0]).toMatchObject({ requests: [], firstFailure: { boundary: "contract", code: "input_figure_missing" } })
  })
  it("keeps all 13 figure-reference cases blocked until actual image transport exists", async () => {
    const figureCases = suite.cases.filter((entry) => entry.inputMode === "text_with_figure_reference")
    expect(figureCases).toHaveLength(13)
    let calls = 0
    for (const entry of figureCases) {
      const result = await runFrozenDsCaseTraced(entry, createBudget(),
        { intentMode: "ds_action", runModel: async () => { calls++; throw new Error("unexpected provider call") } },
        { contract: entry, revision: "image-gate", runId: `blocked-${entry.id}`, onTrace: () => {} })
      expect(result.modelInvoked, entry.id).toBe(false)
      expect(result.contractStatus, entry.id).toBe("incomplete")
    }
    expect(calls).toBe(0)
  })
  it("does not treat untransmitted confirmedFigureRefs as image bytes", async () => {
    const frozen = getCase("GK-S02")
    let requests = 0
    const result = await runFrozenDsCaseTraced({ id: frozen.id, prompt: frozen.prompt, workspace: frozen.workspace,
      confirmedFigureRefs: [{ figureHash: "fake-hash", reviewed: true }] }, createBudget(),
    { intentMode: "ds_action", runModel: async () => { requests++; throw new Error("unexpected model invocation") } },
    { contract: frozen, revision: "image-gate", runId: "fake-ref", onTrace: () => {} })
    expect(requests).toBe(0)
    expect(result.modelInvoked).toBe(false)
  })
})

describe("GK-S09 action receipt runner bridge (zero cost)", () => {
  it("captures terminal receipts without implying feedback was delivered", async () => {
    let n = 0
    const traces: import("./g3DsCaseTrace").G3CaseTrace[] = []
    await runFrozenDsCaseTraced(
      { id: "GK-S09", prompt: "Draw a right triangular prism", workspace: "geometry3d" },
      createBudget({ network: 5, generation: 5, tool: 8 }),
      {
        intentMode: "ds_action",
        resolveProvider: async () => ({ ok: true, provider: {
          id: "ds-test", modelId: "deepseek-v4-flash", dialect: "openai", revision: 2,
          capabilities: { tools: "verified", json: "verified", vision: "unknown" }
        } }),
        runModel: async () => {
          n += 1
          return { ok: true, events: [{ kind: "tool_call", requestId: `r-${n}`, attemptId: `a-${n}`,
            toolCallId: `tc-${n}`, toolId: n === 1 ? "construct_solid" : "finish_candidate",
            input: n === 1
              ? { id: "prism", kind: "triangular_prism", sideLength: 1, height: 1, vertexNames: ["A", "B", "C", "A1", "B1", "C1"] }
              : { goal: "right triangular prism" } }] }
        }
      },
      { revision: "test", runId: "run-s09-success", onTrace: (trace) => traces.push(trace) }
    )
    expect(traces[0]?.actionReceipts).toHaveLength(2)
    expect(traces[0]?.actionReceipts?.[0]).toMatchObject({ resultStatus: "accepted", candidateHashChanged: false, feedbackDelivered: true })
    expect(traces[0]?.actionReceipts?.[1]).toMatchObject({ toolName: "finish_candidate", feedbackDelivered: false })
    expect(JSON.stringify(traces[0])).not.toMatch(/sideLength|vertexNames|right triangular prism/)
  })

  it("captures first repairable blocker from real planner execution without tool input", async () => {
    let requestCount = 0
    const traces: import("./g3DsCaseTrace").G3CaseTrace[] = []
    const result = await runFrozenDsCaseTraced(
      { id: "GK-S09", prompt: "Draw a right triangular prism with six equal edges", workspace: "geometry3d" },
      createBudget({ network: 5, generation: 5, tool: 8 }),
      {
        intentMode: "ds_action",
        resolveProvider: async () => ({ ok: true, provider: {
          id: "ds-test", modelId: "deepseek-v4-flash", dialect: "openai", revision: 2,
          capabilities: { tools: "verified", json: "verified", vision: "unknown" }
        } }),
        runModel: async () => {
          requestCount += 1
          return { ok: true, events: [{ kind: "tool_call", requestId: `r-${requestCount}`, attemptId: `a-${requestCount}`,
            toolCallId: `tc-${requestCount}`, toolId: "construct_solid", input: { kind: "triangular_prism", sideLength: 1 } }] }
        }
      },
      { contract: getCase("GK-S09"), revision: "test", runId: "run-s09-1", onTrace: (trace) => traces.push(trace) }
    )
    expect(result.contractStatus).not.toBe("passed")
    expect(traces).toHaveLength(1)
    expect(traces[0]?.requests).toHaveLength(2)
    expect(traces[0]?.actionReceipts).toHaveLength(2)
    expect(traces[0]?.actionReceipts?.[0]).toMatchObject({
      requestIndex: 1, toolName: "construct_solid", resultStatus: "repairable",
      blockerCode: "missing_required_parameter", primitiveCountBefore: 0, primitiveCountAfter: 0,
      candidateHashChanged: false, feedbackDelivered: true
    })
    expect(JSON.stringify(traces[0])).not.toMatch(/sideLength|toolInput|Draw a right|apiKey/)
  })
})

describe("GK-S09 recorded ds_action whole-case gate (zero cost)", () => {
  it("accepts symbolic a from actual GK-S09 text at two display scales with genuine spheres", async () => {
    const realCase = getCase("GK-S09")
    for (const displayScale of [1, 2]) {
      let turn = 0
      const result = await runFrozenDsCaseTraced(
        { id: realCase.id, prompt: realCase.prompt, workspace: "geometry3d" },
        createBudget({ network: 8, generation: 8, tool: 12 }),
        {
          intentMode: "ds_action",
          resolveProvider: async () => ({ ok: true, provider: {
            id: "ds-test", modelId: "deepseek-v4-flash", dialect: "openai", revision: 2,
            capabilities: { tools: "verified", json: "verified", vision: "unknown" }
          } }),
          runModel: async () => {
            turn += 1
            const calls = [
              { toolId: "construct_solid", input: { id: "prism", kind: "triangular_prism", symbol: "a", displayScale,
                vertexNames: ["A", "B", "C", "A\u2081", "B\u2081", "C\u2081"] } },
              { toolId: "construct_circumsphere", input: { id: "sphere", solidId: "prism" } },
              { toolId: "finish_candidate", input: { goal: "symbolic right triangular prism and circumsphere" } }
            ] as const
            const action = calls[Math.min(turn - 1, calls.length - 1)]!
            return { ok: true, events: [{ kind: "tool_call" as const, requestId: `r-${turn}`, attemptId: `a-${turn}`,
              toolCallId: `tc-${turn}`, toolId: action.toolId, input: action.input }] }
          }
        },
        { contract: realCase, revision: "recorded-replay", runId: `gks09-symbolic-${displayScale}`, onTrace: () => {} }
      )
      expect(result.contractStatus, `displayScale ${displayScale}`).toBe("passed")
      expect(result.candidateSet[0]?.certificateStatus).toBe("passed")
      expect(turn).toBe(3)
    }
  })

  it("does not label a certificate-only candidate as independently verified without the frozen contract", async () => {
    const input = { id: "GK-S09", prompt: "draw a prism", workspace: "geometry3d" as const }
    const candidates: import("./g3DsFrozenCaseRunner").VerifiedFrozenCandidate[] = []
    const result = await runFrozenDsCase(input,
      async () => ({ modelInvoked: false, slices: [{ scopeId: "shared", plan: {
        schemaVersion: "mathcanvas.plan.v1", kind: "plan", goal: "simple prism", factIds: [],
        actions: [{ actionId: "solid.create_prism", actionKey: "prism", factIds: [],
          inputs: { alias: "prism", basePolygon: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }], vector: { x: 0, y: 0, z: 1 } } }]
      } }] }), createBudget(), { onVerifiedCandidate: (candidate) => candidates.push(candidate) })
    expect(result.candidateSet).toHaveLength(1)
    expect(candidates).toHaveLength(0)
  })

  it("never exposes a verified render artifact when the GK-S09 sphere is absent", async () => {
    const realCase = getCase("GK-S09")
    let turn = 0
    const exposed: import("./g3DsFrozenCaseRunner").VerifiedFrozenCandidate[] = []
    const result = await runFrozenDsCaseTraced(
      { id: realCase.id, prompt: realCase.prompt, workspace: "geometry3d" },
      createBudget({ network: 6, generation: 6, tool: 8 }),
      {
        intentMode: "ds_action",
        resolveProvider: async () => ({ ok: true, provider: {
          id: "recorded", modelId: "recorded", dialect: "openai", revision: 1,
          capabilities: { tools: "verified", json: "verified", vision: "unknown" }
        } }),
        runModel: async () => {
          turn += 1
          return { ok: true, events: [{ kind: "tool_call" as const,
            requestId: `r-${turn}`, attemptId: `a-${turn}`, toolCallId: `tc-${turn}`,
            toolId: turn === 1 ? "construct_solid" : "finish_candidate",
            input: turn === 1
              ? { id: "prism", kind: "triangular_prism", symbol: "a", displayScale: 2,
                vertexNames: ["A", "B", "C", "A\u2081", "B\u2081", "C\u2081"] }
              : { goal: "prism without sphere" } }] }
        }
      },
      { contract: realCase, revision: "recorded", runId: "gks09-no-sphere", onTrace: () => {},
        onVerifiedCandidate: (candidate) => exposed.push(candidate) }
    )
    expect(result.contractStatus).not.toBe("passed")
    expect(exposed).toHaveLength(0)
  })

  it("requires prism and derived sphere to satisfy the independent frozen contract", async () => {
    const realCase = getCase("GK-S09")
    let turn = 0
    const input = { id: realCase.id, prompt: realCase.prompt, workspace: "geometry3d" as const }
    const traces: import("./g3DsCaseTrace").G3CaseTrace[] = []
    const renderedCandidates: Array<{ document: import("@draw/dsl").GeometryDocument; candidateHash: string }> = []
    const result = await runFrozenDsCaseTraced(input, createBudget({ network: 8, generation: 8, tool: 12 }), {
      intentMode: "ds_action",
      resolveProvider: async () => ({ ok: true, provider: {
        id: "ds-test", modelId: "deepseek-v4-flash", dialect: "openai", revision: 2,
        capabilities: { tools: "verified", json: "verified", vision: "unknown" }
      } }),
      runModel: async () => {
        turn += 1
        const calls = [
          { toolId: "construct_solid", input: { id: "prism", kind: "triangular_prism", symbol: "a", displayScale: 1,
            vertexNames: ["A", "B", "C", "A\u2081", "B\u2081", "C\u2081"] } },
          { toolId: "construct_circumsphere", input: { id: "circumsphere", solidId: "prism" } },
          { toolId: "finish_candidate", input: { goal: "right triangular prism and circumsphere" } }
        ] as const
        const action = calls[Math.min(turn - 1, calls.length - 1)]!
        return { ok: true, events: [{ kind: "tool_call" as const, requestId: `r-${turn}`, attemptId: `a-${turn}`,
          toolCallId: `tc-${turn}`, toolId: action.toolId, input: action.input }] }
      }
    }, { contract: realCase, revision: "recorded-replay", runId: "gks09-recorded", onTrace: (trace) => traces.push(trace),
      onVerifiedCandidate: (artifact) => renderedCandidates.push(artifact) })
    expect(renderedCandidates).toHaveLength(1)
    expect(renderedCandidates[0]?.candidateHash).toBe(result.candidateSet[0]?.candidateHash)
    expect(renderedCandidates[0]?.document.primitives.some((p) => p.type === "sphere")).toBe(true)
    expect(result.candidateSet).toHaveLength(1)
    expect(result.candidateSet[0]?.certificateStatus, JSON.stringify(result.candidateSet)).toBe("passed")
    expect(result.contractStatus).toBe("passed")
    expect(traces[0]?.actionReceipts?.map((a) => a.toolName)).toEqual([
      "construct_solid", "construct_circumsphere", "finish_candidate"
    ])
  })
})
