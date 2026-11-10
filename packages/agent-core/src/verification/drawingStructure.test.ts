import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"
import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "../contracts"
import { compilePlan } from "../planCompiler"
import { verifyCubeDrawingStructure, verifyNamedSolidDrawingStructure, verifyFoldedTrapezoidStructure, verifyPointDrawingStructure, verifyAnalyticDrawingStructure, verifyRegularTetrahedronStructure, verifyFunctionDrawingStructure, verifyRectangleFoldStructure } from "./drawingStructure"
import { CASE_1, CASE_2, CASE_3, CASE_4_ORIGINAL, CASE_4_REVISED } from "../fixtures/solidGeometryFourCases"
import { deterministicPlanForPrompt } from "../parametricSolidPlan"
import { tryBuildPolygonFoldPlan } from "../polygonFoldPlan"
import { tryBuildTrigMonotonicityPlan } from "../trigMonotonicityPlan"
import { solveRectangleFold } from "../rectangleFoldPlan"

const base = createEmptyDocument("geometry3d")
const plan: PlanEnvelope = { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "请画一个立方体", factIds: [],
  actions: [{ actionId: "solid.create_template", actionKey: "cube", factIds: [], inputs: { alias: "cube", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } } }] }
function candidate() {
  const result = compilePlan(plan, { document: base, workspace: "geometry3d", capabilityRevision: "test", conversationId: "test", documentGeneration: base.revision })
  if (!result.ok || !result.draftDocument) throw Error("cube failed to compile")
  return result.draftDocument
}

describe("host cubical structure check", () => {
  it("validates the new topology, metric cube, and exact source phrase", () => {
    const checked = verifyCubeDrawingStructure("请画一个立方体。", candidate(), base)
    expect(checked).toMatchObject({ status: "passed", sourceText: "立方体" })
    expect(checked?.entityIds).toHaveLength(1)
  })
  it("does not certify an unrequested extra point on a cube-only instruction", () => {
    const extra = candidate()
    extra.primitives.push({ id: "unexpected-point", type: "point3", position: { x: 8, y: 8, z: 8 } })
    expect(verifyCubeDrawingStructure("\u8bf7\u753b\u4e00\u4e2a\u7acb\u65b9\u4f53\u3002", extra, base)).toBeNull()
  })
  it("rejects a wrong solid family or a distorted cube even if its template label still says cube", () => {
    const drawn = candidate()
    expect(verifyCubeDrawingStructure("请画一个三棱锥。", drawn, base)).toBeNull()
    const tampered = structuredClone(drawn)
    const point = tampered.primitives.find(primitive => primitive.type === "point3")
    if (!point || point.type !== "point3") throw Error("no point")
    point.position.x += 0.3
    expect(verifyCubeDrawingStructure("请画一个立方体。", tampered, base)).toBeNull()
  })
})
describe("named solid topology and shape semantics", () => {
  for (const fixture of [CASE_1, CASE_2, CASE_3]) {
    it(`independently binds ${fixture.id} to the drawn named solid`, () => {
      const plan = deterministicPlanForPrompt(fixture.prompt)
      if (plan?.kind !== "plan") throw Error("no plan")
      const document = createEmptyDocument("geometry3d")
      const compiled = compilePlan(plan, { document, workspace: "geometry3d", capabilityRevision: "test", conversationId: "test", documentGeneration: document.revision })
      if (!compiled.ok || !compiled.draftDocument) throw Error("no candidate")
      const checks = verifyNamedSolidDrawingStructure(fixture.prompt, plan.actions, compiled.draftDocument, document)
      expect(checks.some(check => check.status === "passed" && check.sourceText.includes(fixture.id.includes("prism") ? "棱柱" : "棱锥"))).toBe(true)
      if (fixture.id.includes("trapezoid")) expect(checks.some(check => check.sourceText.includes("直角梯形"))).toBe(true)
      const tampered = structuredClone(compiled.draftDocument)
      const point = tampered.primitives.find(item => item.type === "point3" && item.label === "B")
      if (!point || point.type !== "point3") throw Error("missing B")
      point.position.z += 0.5
      expect(verifyNamedSolidDrawingStructure(fixture.prompt, plan.actions, tampered, document)).toEqual([])
    })
  }
})
describe("folded trapezoid structural evidence", () => {
  for (const fixture of [CASE_4_ORIGINAL, CASE_4_REVISED]) {
    it(`checks the hinge, pre-fold base, moving apex and reference state for ${fixture.id}`, () => {
      const built = tryBuildPolygonFoldPlan({ prompt: fixture.prompt })
      if (built.status !== "ok" || built.plan.kind !== "plan") throw Error("no fold plan")
      const document = createEmptyDocument("geometry3d")
      const compiled = compilePlan(built.plan, { document, workspace: "geometry3d", capabilityRevision: "test", conversationId: "test", documentGeneration: document.revision })
      if (!compiled.ok || !compiled.draftDocument) throw Error("no fold candidate")
      const checks = verifyFoldedTrapezoidStructure(fixture.prompt, built.plan.actions, compiled.draftDocument, document)
      expect(checks.some(check => check.status === "passed" && check.sourceText.includes("直角梯形"))).toBe(true)
      expect(checks.some(check => check.status === "passed" && check.sourceText.includes("D") && check.sourceText.includes("P"))).toBe(true)
      const tampered = structuredClone(compiled.draftDocument)
      const movingPoint = tampered.primitives.find(item => item.type === "point3" && item.label === "P")
      if (!movingPoint || movingPoint.type !== "point3") throw Error("missing P")
      movingPoint.position.z += 0.4
      expect(verifyFoldedTrapezoidStructure(fixture.prompt, built.plan.actions, tampered, document)).toEqual([])
    })
  }
})
describe("point-only structural evidence", () => {
  it("binds an explicit point name and both written coordinates to the newly staged point", () => {
    const document = createEmptyDocument("conics")
    const drawn = structuredClone(document)
    drawn.primitives.push({ id: "point-1", type: "point", x: 1, y: 0, label: "A" })
    expect(verifyPointDrawingStructure("画点A(1,0)", drawn, document)).toEqual({ sourceText: "画点A(1,0)", status: "passed", entityIds: ["point-1"] })
    drawn.primitives[0] = { id: "point-1", type: "point", x: 9, y: 0, label: "A" }
    expect(verifyPointDrawingStructure("画点A(1,0)", drawn, document)).toBeNull()
  })
})
describe("regular tetrahedron semantic structure", () => {
  it("binds four named vertices, six equal edges and four triangular faces", () => {
    const base = createEmptyDocument("geometry3d")
    const vertices = [
      { x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 1.5, y: 3 * Math.sqrt(3) / 2, z: 0 },
      { x: 1.5, y: Math.sqrt(3) / 2, z: Math.sqrt(6) }
    ]
    const candidate = structuredClone(base)
    candidate.primitives.push(...vertices.map((position, i) => ({ id: `v${i}`, type: "point3" as const, position, label: "ABCD"[i] })))
    const pairs: [number, number][] = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]]
    candidate.primitives.push(...pairs.map(([a, b], i) => ({ id: `e${i}`, type: "edge3" as const, pointIds: [`v${a}`, `v${b}`] as [string, string] })))
    const rings = [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]]
    candidate.primitives.push(...rings.map((ring, i) => ({ id: `f${i}`, type: "face3" as const, pointIds: ring.map(j => `v${j}`) })))
    candidate.primitives.push({ id: "tetra", type: "polyhedron3", vertexIds: vertices.map((_, i) => `v${i}`), edgeIds: pairs.map((_, i) => `e${i}`), faceIds: rings.map((_, i) => `f${i}`) })
    expect(verifyRegularTetrahedronStructure("画一个正四面体 ABCD，棱长为 3", candidate, base)).toEqual([{ sourceText: "正四面体 ABCD", status: "passed", entityIds: ["tetra"] }, { sourceText: "棱长为 3", status: "passed", entityIds: ["tetra"] }])
    const changed = structuredClone(candidate)
    const point = changed.primitives.find(x => x.id === "v3")
    if (point?.type !== "point3") throw Error("missing point")
    point.position.z += 0.25
    expect(verifyRegularTetrahedronStructure("画一个正四面体 ABCD，棱长为 3", changed, base)).toEqual([])
  })
})
describe("analytic shape family binding", () => {
  it.each([
    { prompt: "椭圆 x²/9+y²/4=1，画示意图", type: "ellipse" as const, primitive: { id: "e", type: "ellipse" as const, center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2 } },
    { prompt: "双曲线 x²/9−y²/4=1，画示意图", type: "hyperbola" as const, primitive: { id: "h", type: "hyperbola" as const, center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2, axis: "x" as const } },
    { prompt: "抛物线 y²=4x，画示意图", type: "parabola" as const, primitive: { id: "p", type: "parabola" as const, vertex: { x: 0, y: 0 }, focalParameter: 2, axis: "x" as const } }
  ])("binds one nondegenerate $type and rejects a duplicate", ({ prompt, primitive }) => {
    const base = createEmptyDocument("conics")
    const drawn = structuredClone(base)
    drawn.primitives.push(primitive)
    expect(verifyAnalyticDrawingStructure(prompt, drawn, base)).toEqual({ sourceText: prompt.split(" ")[0], status: "passed", entityIds: [primitive.id] })
    drawn.primitives.push({ ...primitive, id: "another" })
    expect(verifyAnalyticDrawingStructure(prompt, drawn, base)).toBeNull()
  })
  it("checks a sphere and rejects a nonfinite or zero radius", () => {
    const base = createEmptyDocument("geometry3d")
    const drawn = structuredClone(base)
    drawn.primitives.push({ id: "s", type: "sphere", center: { x: 0, y: 0, z: 0 }, radius: 5 })
    expect(verifyAnalyticDrawingStructure("画一个球体，半径 5", drawn, base)).toEqual({ sourceText: "球体", status: "passed", entityIds: ["s"] })
    drawn.primitives.push({ id: "s2", type: "sphere", center: { x: 0, y: 0, z: 0 }, radius: 0 })
    expect(verifyAnalyticDrawingStructure("画一个球体，半径 5", drawn, base)).toBeNull()
  })
})
describe("function-graph structural evidence", () => {
  it("binds an original LaTeX function clause to the exact compiled expression", () => {
    const prompt = String.raw`已知函数 $f(x)=4\sin x\cos(x-\frac{\pi}{4})-\sqrt{2}$。
（1）求 $f(x)$ 的单调递增区间；`
    const plan = tryBuildTrigMonotonicityPlan(prompt)
    if (plan?.kind !== "plan") throw Error("missing trig plan")
    const base = createEmptyDocument("conics")
    const built = compilePlan(plan, { document: base, workspace: "conics", capabilityRevision: "test", conversationId: "test", documentGeneration: base.revision, prompt })
    if (!built.ok || !built.draftDocument) throw Error("missing graph")
    const checked = verifyFunctionDrawingStructure(prompt, built.draftDocument, base)
    expect(checked?.status).toBe("passed")
    expect(prompt).toContain(checked!.sourceText)
    const changed = structuredClone(built.draftDocument)
    const graph = changed.primitives.find(item => item.type === "function")
    if (graph?.type !== "function") throw Error("no graph")
    graph.expression = "x"
    expect(verifyFunctionDrawingStructure(prompt, changed, base)).toBeNull()
  })
})
describe("rectangle diagonal fold structural evidence", () => {
  it("matches the literal fold to two staged faces, fixed hinge and rigid 90-degree fold", () => {
    const prompt = "矩形 ABCD 中，AB=4，BC=2，沿对角线 AC 把 △ABC 折起，使平面 ABC ⊥ 平面 ACD。求折后 BD 的长。"
    const built = solveRectangleFold(prompt)
    if (built.status !== "plan") throw Error("no fold plan")
    const base = createEmptyDocument("geometry3d")
    const compiled = compilePlan(built.plan, { document: base, workspace: "geometry3d", capabilityRevision: "test", conversationId: "test", documentGeneration: base.revision, prompt })
    if (!compiled.ok || !compiled.draftDocument || built.plan.kind !== "plan") throw Error("no candidate")
    const checks = verifyRectangleFoldStructure(prompt, built.plan.actions, compiled.draftDocument, base)
    expect(checks).toEqual([{ sourceText: "沿对角线 AC 把 △ABC 折起", status: "passed", entityIds: [expect.any(String), expect.any(String)] }])
    const moved = structuredClone(compiled.draftDocument)
    const apex = moved.primitives.find(item => item.type === "point3" && item.label === "B′")
    if (apex?.type !== "point3") throw Error("missing folded apex")
    apex.position.z += 0.5
    expect(verifyRectangleFoldStructure(prompt, built.plan.actions, moved, base)).toEqual([])
  })
})