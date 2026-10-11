import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { compileActions } from "./index"
import type { ActionContext, DraftAction, IdAllocator } from "./types"

/**
 * **`solid.fold`：把一只平面片沿折痕折起来**（2026-10-11 用户现场）。
 *
 * 现场那句话：「平面四边形ABCD中，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3。
 * 点E在AD上，且AE:AD=2:5；点F在AB上，且AF:AB=1:2。将三角形AEF沿EF翻折至三角形PEF，
 * 使得PC=4√3。」—— 连发 7 次、7 次死因各不相同，其中查实的一条是模型**在自己手算折后的
 * 空间坐标**（同一份计划里它给的 `C` 两个条件一个都不满足；后面几次给出四个共线的点）。
 *
 * 这个动作把"算坐标"从模型手里拿走：模型给折前的平面坐标 + 折痕 + 折角，折后坐标由内核算。
 * 本文件钉住三件事：**刚体性**（折前折后等长）、**这个动作真的解得出用户那道题**
 *（90° 时 `PC` 恰为 `4√3`，闭式旁证）、以及**四类拒绝各自不产出半个图元**。
 */
function makeAllocator(): IdAllocator {
  const known = new Map<string, string>()
  let counter = 0
  return {
    allocate(kind, alias) {
      const key = `${kind}:${alias}`
      const existing = known.get(key)
      if (existing) return existing
      counter += 1
      const id = `${kind}-${counter}`
      known.set(key, id)
      return id
    }
  }
}

function context(workspace: "geometry3d" | "conics" = "geometry3d"): ActionContext {
  return { targetDocument: createEmptyDocument(workspace), targetWorkspace: workspace, orderedSelection: [], capabilityRevision: "test.1", idAllocator: makeAllocator() }
}

/**
 * **用户那道题的真坐标**（就是我们自己推出来的那一组）：
 * `A` 在原点、`AB` 沿 x 轴、`AD` 与它成 30°，`AD = 5√3` ⇒ `D = (7.5, 5√3/2)`；
 * `E` 在 `AD` 上且 `AE:AD = 2:5` ⇒ `E = (3, √3)`；`F` 在 `AB` 上且 `AF:AB = 1:2` ⇒ `F = (4, 0)`；
 * `C` 由 `∠ADC = 90°` 与 `CD = 3` 定，取不让四边形自交的那一侧 ⇒ `C = (9, √3)`。
 */
const A = { x: 0, y: 0, z: 0 }
const E = { x: 3, y: Math.sqrt(3), z: 0 }
const F = { x: 4, y: 0, z: 0 }
const C = { x: 9, y: Math.sqrt(3), z: 0 }

function foldAction(overrides: Partial<Record<string, unknown>> = {}, vertices = [A, E, F], vertexNames = ["A", "E", "F"]): DraftAction {
  return {
    actionId: "solid.fold",
    actionKey: "flap",
    factIds: [],
    inputs: { alias: "flap", vertices, vertexNames, hinge: { from: "E", to: "F" }, apex: "A", apexAs: "P", angle: 90, label: "翻折后的三角形 PEF", ...overrides }
  } as unknown as DraftAction
}

type Point3 = { type: "point3"; label?: string; position: { x: number; y: number; z: number } }

function pointsOf(action: DraftAction): Record<string, { x: number; y: number; z: number }> {
  const result = compileActions(createEmptyDocument("geometry3d"), [action], context())
  expect(result.diagnostics).toEqual([])
  const primitives = result.operations.flatMap((operation) => (operation.op === "addPrimitives" ? operation.primitives : []))
  const out: Record<string, { x: number; y: number; z: number }> = {}
  for (const primitive of primitives as unknown as Point3[]) {
    if (primitive.type !== "point3") continue
    expect(primitive.label).toBeTruthy()
    out[primitive.label!] = primitive.position
  }
  return out
}

const distance = (first: { x: number; y: number; z: number }, second: { x: number; y: number; z: number }) =>
  Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z)

describe("solid.fold", () => {
  it("**折是刚体运动**：折痕上的点不动，被带走的点到折痕两端的距离逐字不变", () => {
    const points = pointsOf(foldAction())

    // 折痕两端一点没动。
    expect(points.E).toEqual(E)
    expect(points.F).toEqual(F)
    // 顶点换了名字、也换了位置；但**到折痕两端的距离**是折前的那些。
    expect(points.P).toBeDefined()
    expect(points.A).toBeUndefined()
    expect(distance(points.P!, E)).toBeCloseTo(distance(A, E), 12)
    expect(distance(points.P!, F)).toBeCloseTo(distance(A, F), 12)
    // 90° 折起来：顶点离开了原来的平面（这是"折"与"没折"的分界）。
    expect(Math.abs(points.P!.z)).toBeGreaterThan(1e-9)
  })

  it("**这道题真的解得出**：折 90° 时 PC 恰为 4√3（闭式旁证）", () => {
    /**
     * 手推：`AE ⊥ EF`（`EA·EF = (−3,−√3)·(1,−√3) = 0`），所以 A 到折痕的垂足**恰好是 E**，
     * `P` 就落在以 `E` 为心、半径 `|AE| = 2√3` 的圆上。算出来 `|PC|² = 48 + 36·cos θ`，
     * 于是 `PC = 4√3` 当且仅当 `cos θ = 0`，即 **θ = 90°**。
     *
     * 这条用例是**闭式解与内核实现的对照**：数字对不上就说明旋转轴、方向或原点有一处错了。
     */
    const points = pointsOf(foldAction())
    expect(distance(points.P!, C)).toBeCloseTo(4 * Math.sqrt(3), 9)
  })

  it("折 180° 把顶点翻到折痕另一侧，但仍然等长（边界之内）", () => {
    const flipped = pointsOf(foldAction({ angle: 180 }))
    expect(distance(flipped.P!, E)).toBeCloseTo(distance(A, E), 12)
    expect(distance(flipped.P!, F)).toBeCloseTo(distance(A, F), 12)
    // 与折 90° 的那一个不是同一个位置。
    const right = pointsOf(foldAction({ angle: 90 }))
    expect(distance(flipped.P!, right.P!)).toBeGreaterThan(1e-6)
  })

  it("**折痕两端不在片上** ⇒ 拒绝，且一条图元都不产出", () => {
    const result = compileActions(createEmptyDocument("geometry3d"), [foldAction({ hinge: { from: "E", to: "Z" } })], context())
    expect(result.operations).toEqual([])
    expect(result.diagnostics.map((entry) => entry.code)).toContain("fold_reference_missing")
  })

  it("**被带走的顶点落在折痕上** ⇒ 拒绝（折痕上的点不动，没有可折的顶点）", () => {
    const result = compileActions(createEmptyDocument("geometry3d"), [foldAction({ apex: "E" })], context())
    expect(result.operations).toEqual([])
    expect(result.diagnostics.map((entry) => entry.code)).toContain("fold_apex_on_hinge")
  })

  it("**折角越界** ⇒ 拒绝：0°（没折）、181°、NaN 各自一条", () => {
    for (const angle of [0, 181, Number.NaN, -90]) {
      const result = compileActions(createEmptyDocument("geometry3d"), [foldAction({ angle })], context())
      expect(result.operations, `angle=${angle}`).toEqual([])
      expect(result.diagnostics.map((entry) => entry.code), `angle=${angle}`).toContain("invalid_fold_angle")
    }
  })

  it("**折痕两端重合** ⇒ 拒绝（零向量当轴会把点搬到原点上去）", () => {
    const result = compileActions(createEmptyDocument("geometry3d"), [foldAction({ hinge: { from: "E", to: "E" } })], context())
    expect(result.operations).toEqual([])
    expect(result.diagnostics.map((entry) => entry.code)).toContain("degenerate_fold_axis")
  })

  it("**折前的片本身退化** ⇒ 走 create_face 那一套同一口径的校验", () => {
    // 三个共线的点：折是刚体运动，折不出面积来 —— 拒它的必须是那三条校验，不是这里另写一份。
    const collinear = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }]
    const result = compileActions(createEmptyDocument("geometry3d"), [foldAction({}, collinear)], context())
    expect(result.operations).toEqual([])
    expect(result.diagnostics.map((entry) => entry.code)).toContain("degenerate_face")
  })

  it("**平面几何工作区里不许折**（折产生的是三维构型）", () => {
    const result = compileActions(createEmptyDocument("conics"), [foldAction()], context("conics"))
    expect(result.operations).toEqual([])
    expect(result.diagnostics.map((entry) => entry.code)).toContain("workspace_mismatch")
  })
})
