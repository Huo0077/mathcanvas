import { EXAM_CASES, PLAN_SCHEMA_VERSION, type ExamCase, type PlanEnvelope, type PlannerPort, type PlanRequest } from "@draw/agent-core"
import { afterEach, describe, expect, it } from "vitest"

import { resetGeometryWorkerForTests } from "../geometryWorkerHost"
import { createModelPlanner, PLAN_TOOL_NAME, type ProviderResolution } from "../modelPlanner"
import { inlineWorker } from "../testing/inlineWorker"
import { handleGeometryRequest } from "../workerRuntime"
import { createExamRunCase } from "./examRunAdapter"

// Synthetic smoke prompts only: these are not frozen-exam quality observations or gold.
const CASE: ExamCase = { ...EXAM_CASES.find((entry) => entry.family === "solid")!, prompt: "Create a cube." }
const CUBE: PlanEnvelope = {
  schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "Create a cube", factIds: [],
  actions: [{ actionId: "solid.create_template", actionKey: "cube", factIds: [], inputs: { alias: "cube", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } } }]
}
const DEGENERATE: PlanEnvelope = {
  schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "Create a prism", factIds: [],
  actions: [{ actionId: "solid.create_prism", actionKey: "prism", factIds: [], inputs: {
    alias: "prism", basePolygon: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }], vector: { x: 0, y: 0, z: 0 }
  } }]
}

function scripted(plans: unknown[]) {
  const requests: PlanRequest[] = []
  const planner: PlannerPort = { async plan(request) {
    requests.push(request)
    const plan = plans[Math.min(requests.length - 1, plans.length - 1)] as PlanEnvelope
    return { plan, requestId: `request-${requests.length}`, attemptId: `attempt-${requests.length}` }
  } }
  return { planner, requests }
}
function runWith(planner: PlannerPort) {
  return createExamRunCase({ planner, costOf: () => null, repairPath: "coordinator-driven", geometryWorkerFactory: () => inlineWorker((request) => handleGeometryRequest(request as never)) })
}
afterEach(resetGeometryWorkerForTests)

describe("coordinator-driven exam adapter (zero provider network)", () => {
  it("repairs invalid envelopes through the product coordinator with schema hints", async () => {
    const { planner, requests } = scripted([{ ...CUBE, schemaVersion: "invalid" }, CUBE])
    const result = await runWith(planner)(CASE, 1)
    expect(result.outcome, result.detail).toBe("planned_after_repair")
    expect(requests).toHaveLength(2)
    expect(requests[1]!.repair?.reason).toBe("schema_invalid")
    expect(requests[1]!.repair?.errors.some((error) => error.path.includes("schemaVersion"))).toBe(true)
    expect(result.costUsd).toBeNull()
  })

  it("uses real worker compilation failure diagnostics in the repair request", async () => {
    const { planner, requests } = scripted([DEGENERATE, CUBE])
    const result = await runWith(planner)(CASE, 1)
    expect(result.outcome, result.detail).toBe("planned_after_repair")
    expect(requests).toHaveLength(2)
    expect(requests[1]!.repair?.diagnostics?.some((entry) => entry.stage === "geometry_validation")).toBe(true)
  })

  it("preserves clarification and answer outcomes from the real coordinator", async () => {
    const clarification: PlanEnvelope = { schemaVersion: PLAN_SCHEMA_VERSION, kind: "clarification", goal: "Need a detail", factIds: [], questions: ["Which detail?"] }
    const answer: PlanEnvelope = { schemaVersion: PLAN_SCHEMA_VERSION, kind: "answer", goal: "Explain", factIds: [], answer: "I need more information.", toolResultRefs: [] }
    expect((await runWith(scripted([clarification]).planner)(CASE, 1)).outcome).toBe("clarification")
    expect((await runWith(scripted([answer]).planner)(CASE, 1)).failureLayer).toBe("plan")
  })

  it("rejects a compiled candidate whose diagram verification is unverified", async () => {
    const unsupported = { ...CASE, prompt: "在三棱锥A-BCD中，sin∠ABC=0.5，画示意图" }
    const namedSolid: PlanEnvelope = { ...CUBE, actions: [{ actionId: "solid.create_polyhedron", actionKey: "tetrahedron", factIds: [], inputs: {
      alias: "tetrahedron", vertexNames: ["A", "B", "C", "D"],
      vertices: [{ x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 0 }, { x: 0.5, y: Math.sqrt(3) / 2, z: 0 }, { x: 1, y: 0, z: 0 }],
      faces: [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]]
    } }] }
    const result = await runWith(scripted([namedSolid]).planner)(unsupported, 1)
    expect(result.outcome, result.detail).toBe("rejected")
    expect(result.failureLayer).toBe("verify")
  })

  it("does not infer success from a valid plan when required facts were never observed", async () => {
    const { planner } = scripted([{ ...CUBE, factIds: ["not-in-this-scene"] }])
    const result = await runWith(planner)(CASE, 1)
    expect(result.outcome, result.detail).toBe("rejected")
    expect(result.failureLayer).toBe("plan")
    expect(result.detail).toContain("not-in-this-scene")
  })

  it("keeps schema exhaustion distinct from construction failure", async () => {
    const invalid = await runWith(scripted([{ ...CUBE, schemaVersion: "invalid" }]).planner)(CASE, 1)
    expect(invalid.outcome).toBe("rejected")
    expect(invalid.failureLayer).toBe("schema")
    const degenerate = await runWith(scripted([DEGENERATE]).planner)(CASE, 1)
    expect(degenerate.outcome).toBe("rejected")
    expect(degenerate.failureLayer, degenerate.detail).toBe("construct")
  })

  it("charges coordinator repair and provider retry against the same outer cap", async () => {
    const resolution = { ok: true, provider: { id: "smoke", modelId: "smoke", dialect: "openai", revision: 1, capabilities: { tools: "unknown", json: "unknown", vision: "unknown" } } } satisfies ProviderResolution
    let transports = 0
    const planner = createModelPlanner({
      resolveProvider: async () => resolution,
      runModel: async () => {
        transports += 1
        return { ok: true, events: [{ kind: "delta", requestId: "r", attemptId: "a", text: JSON.stringify(DEGENERATE) }] }
      }
    })
    let spent = 0
    const budget = { consumeRequest(amount = 1) { if (spent + amount > 1) return false; spent += amount; return true }, remainingRequests: () => 1 - spent }
    const result = await runWith(planner)(CASE, 1, budget)
    expect(result.outcome, result.detail).toBe("error")
    expect(transports).toBe(1)
    expect(spent).toBe(1)
    expect(result.detail).toContain("budget")
  })

  it("switches the isolated evaluation document without touching a user canvas", async () => {
    const result = await runWith(scripted([CUBE]).planner)({ ...CASE, family: "triangle" }, 1)
    expect(result.outcome, result.detail).toBe("planned")
  })

  it("does not double-charge the reserved initial request and compile repair", async () => {
    let transports = 0
    const resolution = { ok: true, provider: { id: "smoke", modelId: "smoke", dialect: "openai", revision: 1, capabilities: { tools: "unknown", json: "unknown", vision: "unknown" } } } satisfies ProviderResolution
    const planner = createModelPlanner({ resolveProvider: async () => resolution, runModel: async () => {
      transports += 1
      return { ok: true, events: [{ kind: "delta", requestId: `r${transports}`, attemptId: `a${transports}`, text: JSON.stringify(transports === 1 ? DEGENERATE : CUBE) }] }
    } })
    let spent = 0
    const result = await runWith(planner)(CASE, 1, { consumeRequest(amount = 1) { if (spent + amount > 2) return false; spent += amount; return true }, remainingRequests: () => 2 - spent })
    expect(result.outcome, result.detail).toBe("planned_after_repair")
    expect(transports).toBe(2)
    expect(spent).toBe(2)
  })

  it.each([0, 1, 2])("caps retrying real planner transports at %i requests", async (limit) => {
    let transports = 0
    const resolution = { ok: true, provider: { id: "smoke", modelId: "smoke", dialect: "openai", revision: 1, capabilities: { tools: "unknown", json: "unknown", vision: "unknown" } } } satisfies ProviderResolution
    const planner = createModelPlanner({ resolveProvider: async () => resolution, runModel: async () => {
      transports += 1
      return { ok: false, failure: "rate_limited", message: "429", retryable: true }
    } })
    let spent = 0
    const result = await runWith(planner)(CASE, 1, { consumeRequest(amount = 1) { if (spent + amount > limit) return false; spent += amount; return true }, remainingRequests: () => limit - spent })
    expect(result.outcome).toBe("error")
    expect(transports).toBeLessThanOrEqual(limit)
    expect(spent).toBe(transports)
  })

  it.each([1, 2])("shares the request cap with native read-tool continuation (cap %i)", async (limit) => {
    let transports = 0
    const resolution = { ok: true, provider: { id: "smoke", modelId: "smoke", dialect: "openai", revision: 1, capabilities: { tools: "verified", json: "unknown", vision: "unknown" } } } satisfies ProviderResolution
    const planner = createModelPlanner({ resolveProvider: async () => resolution, runModel: async () => {
      transports += 1
      return { ok: true, events: transports === 1
        ? [{ kind: "tool_call", requestId: "r1", attemptId: "a1", toolCallId: "read", toolId: "scene_inspect", input: { documentId: "missing-document" } }]
        : [{ kind: "tool_call", requestId: "r2", attemptId: "a2", toolCallId: "plan", toolId: PLAN_TOOL_NAME, input: CUBE }]
      }
    } })
    let spent = 0
    const result = await runWith(planner)(CASE, 1, { consumeRequest(amount = 1) { if (spent + amount > limit) return false; spent += amount; return true }, remainingRequests: () => limit - spent })
    expect(result.outcome, result.detail).toBe(limit === 1 ? "error" : "planned")
    expect(transports).toBe(limit)
    expect(spent).toBe(limit)
  })

  it("gives cost accounting all repair attempts, not just the last answer", async () => {
    const counts: number[] = []
    const runCase = createExamRunCase({ planner: scripted([DEGENERATE, CUBE]).planner, repairPath: "coordinator-driven", costOf: ({ attempts }) => { counts.push(attempts?.length ?? 0); return null }, geometryWorkerFactory: () => inlineWorker((request) => handleGeometryRequest(request as never)) })
    const result = await runCase(CASE, 1)
    expect(result.outcome, result.detail).toBe("planned_after_repair")
    expect(counts).toEqual([2])
    expect(result.costUsd).toBeNull()
  })

})
