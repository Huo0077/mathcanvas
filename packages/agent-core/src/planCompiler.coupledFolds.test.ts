import { createEmptyDocument } from "@draw/dsl"
import { commitTransaction } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"
import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

function plan(): Extract<PlanEnvelope, { kind: "plan" }> {
  return { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "coupled folds", factIds: [], actions: [
    ...[
      { name: "A", position: { x: 0, y: 1, z: 0 } }, { name: "E", position: { x: 0, y: 0, z: 0 } },
      { name: "F", position: { x: 1, y: 0, z: 0 } }, { name: "B", position: { x: 0, y: 0, z: 2 } },
      { name: "C", position: { x: 0, y: 2, z: 0 } }
    ].map(({ name, position }) => ({ actionId: "solid.create_point" as const, actionKey: name, factIds: [], inputs: { alias: name, label: name, position } })),
    { actionId: "solid.fold", actionKey: "first", factIds: [], inputs: { alias: "first", vertexNames: ["A", "E", "F"], apex: "A", apexAs: "P", hinge: { from: "E", to: "F" }, angle: 15 } },
    { actionId: "solid.fold", actionKey: "second", factIds: [], inputs: { alias: "second", vertexNames: ["P", "E", "F"], apex: "E", apexAs: "Q", hinge: { from: "P", to: "F" }, angle: 20 } }
  ] }
}

// Independent closed form for A=(0,1,0), E=(0,0,0), F=(1,0,0).
// P=(0,cos(a),sin(a)); Q follows by rotating E about PF, with |QF|=1.
const a = Math.PI / 3
const b = 70 * Math.PI / 180
const qx = (1 - Math.cos(b)) / 2
const qy = Math.cos(a) * qx + Math.sin(a) * Math.sin(b) / Math.sqrt(2)
const qz = Math.sin(a) * qx - Math.cos(a) * Math.sin(b) / Math.sqrt(2)
const qb = Math.hypot(qx, qy, qz - 2)
const qc = Math.hypot(qx, qy - 2, qz)
const CHAIN = "先将△AEF沿EF翻折至△PEF，再将△PEF沿PF折叠至△QPF。"
const END = `使QB=${qb.toFixed(12)}，QC=${qc.toFixed(12)}。`
function compile(prompt: string, options = {}) {
  return compilePlan(plan(), { document: createEmptyDocument("geometry3d"), conversationId: "joint", documentGeneration: 0, prompt, foldSystemOptions: options })
}

describe("joint fold angles in the real compiler", () => {
  it("rebuilds an incomplete base plan and solves both previously missing folds", () => {
    const input: PlanEnvelope = { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "only base", factIds: [], actions: [{
      actionId: "solid.create_face", actionKey: "base", factIds: [], inputs: { alias: "base", vertexNames: ["A", "B", "C", "D"],
        vertices: [{ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }, { x: 9, y: 1.7, z: 0 }, { x: 7.5, y: 4.3, z: 0 }] }
    }] }
    const prompt = "平面四边形ABCD中，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3。点E在AD上，且AE=2/5 AD；点F在AB上，且AF=1/2 AB。" + CHAIN + "使QB=5.982610851975，QC=7.185772613248。"
    const result = compilePlan(input, { document: createEmptyDocument("geometry3d"), prompt, conversationId: "joint-rebuild", documentGeneration: 0 })
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true)
    expect(result.assumptions.some(s => s.id === "joint-fold-angles")).toBe(true)
    expect(result.materialisedActions?.filter(s => s.actionId === "solid.fold")).toHaveLength(2)
    expect(result.diagramVerification?.status).toBe("passed")
    const replay = commitTransaction({ base: createEmptyDocument("geometry3d"), operations: result.operations })
    expect(replay.errors).toEqual([])
    expect(replay.changed).toBe(true)
    expect(replay.document.primitives).toEqual(result.draftDocument?.primitives)
  })
  it("jointly changes both angles and independently satisfies two coupled terminal distances", () => {
    const input = plan()
    const before = JSON.stringify(input)
    const base = createEmptyDocument("geometry3d")
    const result = compilePlan(input, { document: base, conversationId: "joint", documentGeneration: 0, prompt: CHAIN + END })
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true)
    expect(result.diagramVerification?.status).toBe("passed")
    expect(result.assumptions.some(s => s.id === "joint-fold-angles")).toBe(true)
    const q = result.draftDocument?.primitives.find(p => p.type === "point3" && p.label === "Q")
    if (q?.type !== "point3") throw new Error("missing Q")
    expect(Math.hypot(q.position.x, q.position.y, q.position.z - 2)).toBeCloseTo(qb, 5)
    expect(Math.hypot(q.position.x, q.position.y - 2, q.position.z)).toBeCloseTo(qc, 5)
    const angles = result.materialisedActions?.filter(s => s.actionId === "solid.fold").map(s => (s.inputs as { angle: number }).angle)
    expect(angles?.[0]).not.toBe(15)
    expect(angles?.[1]).not.toBe(20)
    expect(base.primitives).toHaveLength(0)
    expect(JSON.stringify(input)).toBe(before)
  })
  it("keeps an explicitly stated angle fixed while solving the remaining angle", () => {
    const result = compile(CHAIN.replace("沿EF翻折至", "沿EF翻折60°至") + END)
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true)
    expect(result.materialisedActions?.find(s => s.actionId === "solid.fold")?.inputs).toMatchObject({ angle: 60 })
  })
  it("jointly solves a third fold using three independent terminal distances", () => {
    const input = plan()
    input.actions.splice(5, 0, { actionId: "solid.create_point", actionKey: "D", factIds: [], inputs: {
      alias: "D", label: "D", position: { x: 2, y: 1, z: 3 }
    } })
    input.actions.push({ actionId: "solid.fold", actionKey: "third", factIds: [], inputs: {
      alias: "third", vertexNames: ["Q", "P", "F"], apex: "F", apexAs: "R", hinge: { from: "Q", to: "P" }, angle: 25
    } })
    // Independently computed by Rodrigues at (60°, 70°, 40°):
    // R=(1.2701220641832318, 0.5770591208347712, 0.24889346167554224).
    const prompt = CHAIN + "再将△QPF沿QP翻折至△RQP。使RB=2.238879495513，RC=1.923517288404，RD=2.877531576486。"
    const result = compilePlan(input, { document: createEmptyDocument("geometry3d"), conversationId: "three", documentGeneration: 0, prompt })
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true)
    expect(result.diagramVerification?.status).toBe("passed")
    expect(result.assumptions.find(s => s.id === "joint-fold-angles")?.value).toMatchObject({ actionIndices: [6, 7, 8], complete: false })
  })
  it("rejects insufficient constraints even when the initial default angles happen to pass", () => {
    const input = plan()
    const initialQx = (1 - Math.cos(20 * Math.PI / 180)) / 2
    const initialQy = Math.cos(15 * Math.PI / 180) * initialQx + Math.sin(15 * Math.PI / 180) * Math.sin(20 * Math.PI / 180) / Math.sqrt(2)
    const initialQz = Math.sin(15 * Math.PI / 180) * initialQx - Math.cos(15 * Math.PI / 180) * Math.sin(20 * Math.PI / 180) / Math.sqrt(2)
    const prompt = CHAIN + `使QB=${Math.hypot(initialQx, initialQy, initialQz - 2).toFixed(12)}。`
    const result = compilePlan(input, { document: createEmptyDocument("geometry3d"), conversationId: "passing-default", documentGeneration: 0, prompt })
    expect(result.ok).toBe(false)
    expect(result.diagnostics.some(d => d.code === "fold_system_underdetermined")).toBe(true)
  })
  it("asks for independent conditions rather than claiming a default solves an underdetermined system", () => {
    const result = compile(CHAIN + `使QB=${qb.toFixed(12)}。`)
    expect(result.ok).toBe(false)
    expect(result.draftDocument).toBeNull()
    expect(result.diagnostics.some(d => d.code === "fold_system_underdetermined")).toBe(true)
  })
  it("never ignores a conflicting base condition to publish a subset solution", () => {
    const result = compile(CHAIN + END + "AB=1000。")
    expect(result.ok).toBe(false)
    expect(result.draftDocument).toBeNull()
  })
  it("reports unsuccessful bounded search without claiming mathematical impossibility", () => {
    const result = compile(CHAIN + "使QB=1000，QC=1000。", { maxEvaluations: 40 })
    expect(result.ok).toBe(false)
    expect(result.diagnostics.some(d => d.code === "fold_system_not_found" && d.detail.includes("不等于证明无解"))).toBe(true)
  })
  it("honors cancellation before publishing a candidate", () => {
    const result = compile(CHAIN + END, { shouldStop: () => true })
    expect(result.ok).toBe(false)
    expect(result.diagnostics.some(d => d.code === "fold_system_cancelled")).toBe(true)
  })
})
