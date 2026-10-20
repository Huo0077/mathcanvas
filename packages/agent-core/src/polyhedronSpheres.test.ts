import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { parseDiagramObligations } from "./diagramObligations"
import { compilePlan } from "./planCompiler"

/**
 * **一般多面体的外接球 / 内切球半径**（2026-10-20，"派生球"这条线的通用路径）。
 *
 * 前两批接的是**有闭式子**的两类（长方体的三条棱、正 N 棱锥的底环 + 锥顶）。这一批接
 * **任意闭合多面体**（`polyhedron3`）—— 判据从**网格**算，不再要求形状正规：
 *
 * | 度量 | 怎么算 |
 * | --- | --- |
 * | 体积 | 散度定理：`V = ｜Σ (a · (b × c))｜ / 6`（对每个三角形面片） |
 * | 表面积 | `S = Σ` 每个三角形面片的面积 |
 * | 内切球半径 | `3V / S`（内切球存在时 `V = ⅓·r·S` 是恒等式） |
 * | 外接球半径 | 解出**到所有顶点等距**的球心（最小二乘），`R = √(｜c｜² + k)` |
 *
 * ## 一条比"半径对不对"更强的判据
 *
 * 外接球那条的残余取**两件事的较大者**：① 顶点**是不是真的在同一个球面上**
 * （`max ｜ ｜vᵢ − c｜ − R ｜`）；② 这个 `R` 与题面写的数差多少。两个都是长度量。
 * 少了①的话，一个"顶点根本不共球"的图会被最小二乘凑出一个像模像样的 `R` 混过去。
 */
const stated = (prompt: string) =>
  parseDiagramObligations(prompt).givens
    .filter((item) => item.kind === "solidDimension")
    .map((item) => `${item.solid?.shape}:${item.solid?.metric}`)

describe("一般多面体的派生球半径读取器", () => {
  it("`三棱锥的内切球半径为1` ⇒ polyhedron:inradius", () => {
    expect(stated("三棱锥的内切球半径为1。")).toEqual(["polyhedron:inradius"])
  })

  it("`四面体的外接球半径为2` 也读得出（同义词）", () => {
    expect(stated("四面体的外接球半径为2。")).toEqual(["polyhedron:circumradius"])
  })

  /** **`正`N 棱锥仍然走 `pyramid`**（它有闭式子，比网格更准也更便宜）。 */
  it("`正三棱锥的内切球半径为1` 仍归 pyramid（不回归）", () => {
    expect(stated("正三棱锥的内切球半径为1。")).toEqual(["pyramid:inradius"])
  })
})

/**
 * **接缝层**：棱长 2 的**正四面体**（它既是 `polyhedron3`，也是"棱长都相等"的特例）。
 *
 * 自己算：体积 `a³√2/12 = 8√2/12`、表面积 `a²√3 = 4√3` ⇒ 内切球 `3V/S = 2√2/(4√3) = √6/6`；
 * 外接球 `a√6/4 = √6/2`。两个都写成 12 位小数进题面，避免拿被测代码的输出当期望。
 */
describe("一般多面体的派生球半径量得出来", () => {
  const VERTICES = [
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
    { x: 1, y: Math.sqrt(3), z: 0 },
    { x: 1, y: Math.sqrt(3) / 3, z: (2 * Math.sqrt(6)) / 3 }
  ]
  const FACES = [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]]
  const INNER = Math.sqrt(6) / 6
  const OUTER = Math.sqrt(6) / 2

  const run = (prompt: string) => {
    const plan = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "正四面体",
      factIds: [],
      actions: [{ actionId: "solid.create_polyhedron", actionKey: "tetrahedron", factIds: [], inputs: { alias: "tetrahedron", vertices: VERTICES, faces: FACES, vertexNames: ["A", "B", "C", "D"] } }]
    } as unknown as PlanEnvelope
    return compilePlan(plan, { document: createEmptyDocument("geometry3d"), prompt, conversationId: "polyhedron-spheres", documentGeneration: 0 })
  }

  const describeChecks = (result: ReturnType<typeof run>) =>
    (result.diagramVerification?.checks ?? []).map((check) => `${check.kind}:${check.status}:${check.reason}`).join("；")

  it(`内切球半径 √6/6（写成 ${INNER.toPrecision(12)}）⇒ passed`, () => {
    const result = run(`三棱锥的内切球半径为${INNER.toPrecision(12)}。`)
    expect(result.diagramVerification?.status, describeChecks(result)).toBe("passed")
  })

  it("内切球半径写 1 ⇒ failed", () => {
    expect(run("三棱锥的内切球半径为1。").diagramVerification?.status).toBe("failed")
  })

  it(`外接球半径 √6/2（写成 ${OUTER.toPrecision(12)}）⇒ passed`, () => {
    const result = run(`三棱锥的外接球半径为${OUTER.toPrecision(12)}。`)
    expect(result.diagramVerification?.status, describeChecks(result)).toBe("passed")
  })

  it("外接球半径写 1 ⇒ failed", () => {
    expect(run("三棱锥的外接球半径为1。").diagramVerification?.status).toBe("failed")
  })

  /**
   * **顶点不共球时必须判不满足**（哪怕最小二乘能凑出一个 `R`）：把顶点 D 挪高一点，
   * 四条棱就不再等长，最小二乘仍会给出一个 `R` —— 判据得靠"顶点是否真的在球面上"那一项挡住。
   */
  it("把顶点挪歪（顶点不共球）⇒ 即使用同一个 R 也 failed", () => {
    const skewed = structuredClone(VERTICES)
    skewed[3]!.z += 0.35
    const plan = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "歪掉的四面体",
      factIds: [],
      actions: [{ actionId: "solid.create_polyhedron", actionKey: "tetrahedron", factIds: [], inputs: { alias: "tetrahedron", vertices: skewed, faces: FACES, vertexNames: ["A", "B", "C", "D"] } }]
    } as unknown as PlanEnvelope
    const result = compilePlan(plan, { document: createEmptyDocument("geometry3d"), prompt: `三棱锥的外接球半径为${OUTER.toPrecision(12)}。`, conversationId: "polyhedron-skewed", documentGeneration: 0 })
    expect(result.diagramVerification?.status, describeChecks(result as ReturnType<typeof run>)).toBe("failed")
  })
})
