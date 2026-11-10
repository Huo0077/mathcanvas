import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { applyOperation } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import { compilePlan } from "./planCompiler"
import { tryBuildParametricSolidPlan } from "./parametricSolidPlan"
import { CASE_1, CASE_2, CASE_3 } from "./fixtures/solidGeometryFourCases"

/**
 * **T5：确定性计划适配与命名分点**（2026-11-05 四题修复）。
 *
 * 判据不看"动作数量"，而是看**编译后的实际文档**：
 *
 * - 主实体（多面体 / 棱柱）在不在、顶点名是不是题面的名字；
 * - 辅助点（`E` / `D` / `M` / `O`）在不在、是不是**绑定点**（`binding.kind === "onHost"`）；
 * - 绑定的**宿主边**与**参数**对不对（中点 1/2；`BE=1` 且 `AA₁=3` ⇒ 1/3；反向写法 ⇒ 2/3）；
 * - 宿主顶点动了以后，绑定点是不是**跟着走**（这就是"绑定点"与"自由点"的分界）。
 */

const context = (prompt: string, document: GeometryDocument = createEmptyDocument("geometry3d")) => ({
  document,
  prompt,
  workspace: "geometry3d" as const,
  conversationId: "parametric-solid",
  documentGeneration: document.revision
})

type PointOf = { id: string; position: { x: number; y: number; z: number }; binding?: { kind: string; hostId?: string; parameter?: number } }

function pointsOf(document: GeometryDocument | null): Map<string, PointOf> {
  const map = new Map<string, PointOf>()
  for (const primitive of document?.primitives ?? []) {
    if (primitive.type !== "point3") continue
    const label = (primitive as { label?: unknown }).label
    if (typeof label !== "string") continue
    map.set(label, {
      id: primitive.id,
      position: primitive.position,
      binding: primitive.binding as PointOf["binding"]
    })
  }
  return map
}

function compilePrompt(prompt: string) {
  const built = tryBuildParametricSolidPlan({ prompt })
  expect(built.status, JSON.stringify(built)).toBe("ok")
  if (built.status !== "ok") throw new Error("没有产出计划")
  const compiled = compilePlan(built.plan, context(prompt))
  const detail = compiled.diagnostics.map((entry) => `${entry.code}@${entry.path}: ${entry.detail}`).join("；")
  expect(compiled.ok, detail).toBe(true)
  expect(compiled.diagramVerification?.status, JSON.stringify(compiled.diagramVerification)).toBe("passed")
  return { built, compiled }
}

describe("T5 参数化立体计划：四题的命名分点都落成绑定点", () => {
  it("Case 1：E 绑在 PB 上、参数 1/2，编译后坐标就是 PB 中点", () => {
    const { compiled } = compilePrompt(CASE_1.prompt)
    const points = pointsOf(compiled.draftDocument)
    for (const name of ["A", "B", "C", "D", "P", "E"]) expect(points.has(name), `缺 ${name}`).toBe(true)
    const e = points.get("E")!
    expect(e.binding?.kind, "E 必须是绑定点，不是自由坐标点").toBe("onHost")
    expect(e.binding?.parameter).toBeCloseTo(0.5, 9)
    const p = points.get("P")!.position
    const b = points.get("B")!.position
    expect(e.position.x).toBeCloseTo((p.x + b.x) / 2, 9)
    expect(e.position.y).toBeCloseTo((p.y + b.y) / 2, 9)
    expect(e.position.z).toBeCloseTo((p.z + b.z) / 2, 9)
  })

  it("Case 2：D 是 AC 中点（1/2）、E 在有向边 B→B₁ 上参数 1/3 —— 都不是中点", () => {
    const { built, compiled } = compilePrompt(CASE_2.prompt)
    const points = pointsOf(compiled.draftDocument)
    for (const name of ["A", "B", "C", "A₁", "B₁", "C₁", "D", "E"]) expect(points.has(name), `缺 ${name}`).toBe(true)

    const d = points.get("D")!
    expect(d.binding?.kind).toBe("onHost")
    expect(d.binding?.parameter).toBeCloseTo(0.5, 9)

    const e = points.get("E")!
    expect(e.binding?.kind).toBe("onHost")
    /** **不是中点**：`BE=1`、`BB₁=3` ⇒ 1/3。 */
    expect(e.binding?.parameter).toBeCloseTo(1 / 3, 9)
    const b = points.get("B")!.position
    const b1 = points.get("B₁")!.position
    expect(e.position.x).toBeCloseTo(b.x + (b1.x - b.x) / 3, 9)
    expect(e.position.z).toBeCloseTo(b.z + (b1.z - b.z) / 3, 9)

    /** 动作链里 `hostEdge` 就是 `{from:"B",to:"B₁"}` —— 题面那条真实命名边。 */
    const actions = (built.plan.kind === "plan" ? built.plan.actions : []) as {
      actionId: string
      actionKey?: string
      inputs: { hostEdge?: { from: string; to: string }; parameter?: number }
    }[]
    const boundAction = actions.find((action) => action.actionKey === "E")
    expect(boundAction?.actionId).toBe("dynamic.create_bound_point")
    expect(boundAction?.inputs.hostEdge).toEqual({ from: "B", to: "B₁" })
    expect(boundAction?.inputs.parameter).toBeCloseTo(1 / 3, 9)
  })

  it("反向边写法（点 E 在 B₁B 上、B₁E=2）与正向写法落到**同一个点**（方向不颠倒）", () => {
    const reversed = CASE_2.prompt.replace("点E在棱BB₁上，且BE=1", "点E在棱B₁B上，且B₁E=2")
    const forward = compilePrompt(CASE_2.prompt).compiled.draftDocument
    const { compiled } = compilePrompt(reversed)
    const e = pointsOf(compiled.draftDocument).get("E")!
    expect(e.binding?.kind).toBe("onHost")
    const forwardE = pointsOf(forward).get("E")!
    /** 同一个物理点：两种写法量出来的坐标必须一致（参数方向不能反）。 */
    expect(e.position.x).toBeCloseTo(forwardE.position.x, 9)
    expect(e.position.y).toBeCloseTo(forwardE.position.y, 9)
    expect(e.position.z).toBeCloseTo(forwardE.position.z, 9)
  })

  it("Case 3：M 是 PC 中点（1/2），O 绑在 AC 上（1/2）且不是环顶点", () => {
    const { compiled } = compilePrompt(CASE_3.prompt)
    const points = pointsOf(compiled.draftDocument)
    for (const name of ["A", "B", "C", "D", "P", "M", "O"]) expect(points.has(name), `缺 ${name}`).toBe(true)
    const m = points.get("M")!
    expect(m.binding?.kind).toBe("onHost")
    expect(m.binding?.parameter).toBeCloseTo(0.5, 9)
    const p = points.get("P")!.position
    const c = points.get("C")!.position
    expect(m.position.x).toBeCloseTo((p.x + c.x) / 2, 9)
    expect(m.position.z).toBeCloseTo((p.z + c.z) / 2, 9)

    const o = points.get("O")!
    expect(o.binding?.kind).toBe("onHost")
    expect(o.binding?.parameter).toBeCloseTo(0.5, 9)
    const a = points.get("A")!.position
    expect(o.position.x).toBeCloseTo((a.x + c.x) / 2, 9)
  })

  it("宿主动了，绑定点跟着走（这就是绑定点与自由点的分界）", () => {
    const { compiled } = compilePrompt(CASE_1.prompt)
    const document = compiled.draftDocument!
    const before = pointsOf(document).get("E")!
    const solid = document.primitives.find((primitive) => primitive.type === "polyhedron3")
    if (solid === undefined) throw new Error("没有多面体")
    /** 整只实体沿 +z 挪 3：`E` 是绑定点，必须跟着走（参数不变）。 */
    const moved = applyOperation(document, { op: "translatePrimitive3", id: solid.id, delta: { x: 0, y: 0, z: 3 } }).document
    const after = pointsOf(moved).get("E")!
    expect(after.position.z - before.position.z).toBeCloseTo(3, 6)
    expect(after.position.x).toBeCloseTo(before.position.x, 6)
    expect(after.binding?.kind).toBe("onHost")
    expect(after.binding?.parameter).toBeCloseTo(0.5, 9)
  })

  it("负测：参数落在端点/越界时如实拒绝，不悄悄夹回", () => {
    /** `BE = 3 = |BB₁|` ⇒ 参数 1，E 与 B₁ 重合：那不是"分点"。 */
    const atEnd = CASE_2.prompt.replace("BE=1", "BE=3")
    const builtAtEnd = tryBuildParametricSolidPlan({ prompt: atEnd })
    expect(builtAtEnd.status).not.toBe("ok")
    if (builtAtEnd.status === "clarification") expect(builtAtEnd.reason).toContain("(0,1)")

    /** `BE = 5 > |BB₁|` ⇒ 参数 5/3，落在线段外。 */
    const beyond = CASE_2.prompt.replace("BE=1", "BE=5")
    const builtBeyond = tryBuildParametricSolidPlan({ prompt: beyond })
    expect(builtBeyond.status).not.toBe("ok")
  })

  it("负测：辅助点与已有顶点重名 ⇒ 拒绝，不覆盖底点", () => {
    const duplicate = CASE_1.prompt.replace("点E为棱PB的中点", "点A为棱PB的中点")
    const built = tryBuildParametricSolidPlan({ prompt: duplicate })
    expect(built.status).not.toBe("ok")
    if (built.status === "clarification") expect(built.reason).toMatch(/重名|duplicate/)
  })

  it("入口认不出的题面 ⇒ not-applicable（不是本层的活，不猜）", () => {
    const built = tryBuildParametricSolidPlan({ prompt: "画一个圆，半径 3" })
    expect(built.status).toBe("not-applicable")
  })
})

it("derives the rhombus midpoint theorem for Case 3 without treating instance geometry as proof", () => {
  const prompt = CASE_3.prompt + "请画题设示意图。"
  const built = tryBuildParametricSolidPlan({ prompt })
  expect(built.status).toBe("ok")
  if (built.status !== "ok" || built.plan.kind !== "plan") return
  expect(built.plan.answer).toContain("OM ∥ PA")
  expect(built.plan.answer).toContain("PA ∥ 平面 BDM")
  expect(built.plan.answer).not.toContain("这是实例证据")
  const changed = tryBuildParametricSolidPlan({ prompt: prompt.replace("点M为棱PC的中点", "点M在棱PC上") })
  if (changed.status === "ok" && changed.plan.kind === "plan") expect(changed.plan.answer).not.toContain("OM ∥ PA")
})

it("derives PA perpendicular to a base diagonal from the given plane relation, not just a single instance", () => {
  const stem = "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，BC ∥ AD，AB ⊥ AD，画出这个四棱锥，求证 PA ⊥ BD"
  const good = tryBuildParametricSolidPlan({ prompt: stem })
  expect(good.status).toBe("ok")
  if (good.status !== "ok" || good.plan.kind !== "plan") return
  expect(good.plan.answer).toContain("BD 在该平面内")
  expect(good.plan.answer).not.toContain("实例证据")
  const wrong = tryBuildParametricSolidPlan({ prompt: stem.replace("求证 PA ⊥ BD", "求证 PA ⊥ PC") })
  if (wrong.status === "ok" && wrong.plan.kind === "plan") expect(wrong.plan.answer).not.toContain("PC 在该平面内")
})
