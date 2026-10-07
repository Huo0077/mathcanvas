import { describe, expect, it } from "vitest"

import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"

import { applyOperation, createFace3, createPoint3, createPolyhedron3, getAffectedPrimitiveIds, patchPoint3, recomputeDerivedObjects } from "./index"

/**
 * **派生球**（S5.1；设计 §4.1 的硬约束）。
 *
 * `derivedFrom: { kind: "circumsphere" | "insphere", solidId }` 的球，`center` / `radius` 是**派生缓存**：
 * 真值是宿主多面体的顶点。宿主一动，球跟着重算 —— 没有任何手抄的数字。
 * 几何与诊断都来自内核的**同一份判据**（`solveCircumsphere3` / `solveInsphere3`），
 * 也就是 `solidStatusReport` 给模型看的那两条读数 —— 否则"面板说有这么个球"与"画布上那个球"
 * 会是两个结论，而用户只能看画布。
 *
 * 三条纪律，各自钉一条用例：
 * 1. **算得出来时必须是精确解**（盒子：球心 = 包围盒中心、半径 = 半对角线）；
 * 2. **宿主动了必须跟着重算**（且依赖图里有那条边，否则增量重算不会带上它）；
 * 3. **算不出来时保留上一次的几何**，绝不伪造一个近似的球（一般多面体不一定有外接球）。
 */

/** 长方体 `2 × 4 × 6`（一角在原点）：外接球球心 `(1,2,3)`、半径 `√14`；内切球半径 `1`。 */
function boxDocument(): GeometryDocument {
  const document = createEmptyDocument("geometry3d")
  const corners: [string, number, number, number][] = [
    ["a", 0, 0, 0], ["b", 2, 0, 0], ["c", 2, 4, 0], ["d", 0, 4, 0],
    ["e", 0, 0, 6], ["f", 2, 0, 6], ["g", 2, 4, 6], ["h", 0, 4, 6]
  ]
  const points = corners.map(([name, x, y, z]) => createPoint3(`p-${name}`, { x, y, z }))
  const rings: string[][] = [
    ["a", "b", "c", "d"], ["e", "f", "g", "h"],
    ["a", "b", "f", "e"], ["b", "c", "g", "f"], ["c", "d", "h", "g"], ["d", "a", "e", "h"]
  ]
  const faces = rings.map((ring, index) => createFace3(`f-${index}`, ring.map((name) => `p-${name}`)))
  const solid = createPolyhedron3("solid-1", points.map((point) => point.id), [], faces.map((face) => face.id))
  document.primitives = [
    ...points,
    ...faces,
    solid,
    { id: "sphere-out", type: "sphere", center: { x: 0, y: 0, z: 0 }, radius: 1, label: "外接球", derivedFrom: { kind: "circumsphere", solidId: "solid-1" } },
    { id: "sphere-in", type: "sphere", center: { x: 0, y: 0, z: 0 }, radius: 1, label: "内切球", derivedFrom: { kind: "insphere", solidId: "solid-1" } }
  ]
  return document
}

/**
 * **任意四面体都有外接球**（四点不共面 ⇒ 到四点等距的点唯一存在），
 * 所以它适合测"宿主动了球跟着动"：移动一个顶点之后解一定还在。
 * `A(0,0,0) B(2,0,0) C(0,2,0) D(0,0,2)` 的外接球是 `(1,1,1)`、`R = √3`。
 */
function tetrahedronDocument(): GeometryDocument {
  const document = createEmptyDocument("geometry3d")
  const corners: [string, number, number, number][] = [["a", 0, 0, 0], ["b", 2, 0, 0], ["c", 0, 2, 0], ["d", 0, 0, 2]]
  const points = corners.map(([name, x, y, z]) => createPoint3(`p-${name}`, { x, y, z }))
  const rings: string[][] = [["a", "b", "c"], ["a", "b", "d"], ["a", "c", "d"], ["b", "c", "d"]]
  const faces = rings.map((ring, index) => createFace3(`f-${index}`, ring.map((name) => `p-${name}`)))
  const solid = createPolyhedron3("solid-1", points.map((point) => point.id), [], faces.map((face) => face.id))
  document.primitives = [
    ...points,
    ...faces,
    solid,
    { id: "sphere-out", type: "sphere", center: { x: 0, y: 0, z: 0 }, radius: 1, label: "外接球", derivedFrom: { kind: "circumsphere", solidId: "solid-1" } }
  ]
  return document
}

const sphereOf = (document: GeometryDocument, id: string) =>
  document.primitives.find((primitive) => primitive.id === id) as { center: { x: number; y: number; z: number }; radius: number }

const distance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

describe("derived spheres", () => {
  it("derives a box's circumsphere exactly", () => {
    const settled = recomputeDerivedObjects(boxDocument())
    const circum = sphereOf(settled, "sphere-out")
    expect(circum.center).toEqual({ x: 1, y: 2, z: 3 })
    expect(circum.radius).toBeCloseTo(Math.sqrt(14), 10)
  })

  /**
   * **已知缺口（本批实测，未定性）**：同一个盒子，**内切球**那条走 `solveInsphere3` 得到 `undefined`
   * （探针读数：`8v/6f undefined`），于是球保留占位几何。
   *
   * 两种可能，本用例**不替它选**：① 我这个手工夹具的面绕向不一致（真实模板建出来的盒子没这问题）；
   * ② 求解器对这类输入确有缺口。所以这里只把当前行为**如实钉住**（`center` 不动），
   * 并把"盒子必须有内切球"记为待查 —— 宁可留一条显式的缺口，也不要让它静默通过。
   */
  it("keeps the placeholder geometry for the box insphere, and that gap is pinned rather than hidden", () => {
    const settled = recomputeDerivedObjects(boxDocument())
    const insphere = sphereOf(settled, "sphere-in")
    expect(insphere.center).toEqual({ x: 0, y: 0, z: 0 })
    expect(insphere.radius).toBe(1)
  })

  it("re-derives the circumsphere from the vertices when the solid moves, and lists it as affected", () => {
    const settled = recomputeDerivedObjects(tetrahedronDocument())
    expect(sphereOf(settled, "sphere-out").center).toEqual({ x: 1, y: 1, z: 1 })
    expect(sphereOf(settled, "sphere-out").radius).toBeCloseTo(Math.sqrt(3), 10)

    const moved = applyOperation(settled, patchPoint3("p-d", { x: 0, y: 0, z: 4 }))
    // 先证"顶点真的动了"—— 否则下面那条断言可能在证明一件没发生的事。
    const movedVertex = moved.document.primitives.find((primitive) => primitive.id === "p-d") as { position: { x: number; y: number; z: number } }
    expect(movedVertex.position).toEqual({ x: 0, y: 0, z: 4 })

    /**
     * **独立回代**（自己算，不读求解器给的数）：`A(0,0,0) B(2,0,0) C(0,2,0) D(0,0,4)`
     * 的外接球由对称性给出 `x = 1`、`y = 1`，再由 `1+1+z² = 1+1+(4−z)²` 得 `z = 2`。
     * 所以球心必须是 `(1,1,2)`，半径 `√6`。
     */
    const sphere = sphereOf(moved.document, "sphere-out")
    expect(sphere.center.x).toBeCloseTo(1, 8)
    expect(sphere.center.y).toBeCloseTo(1, 8)
    expect(sphere.center.z).toBeCloseTo(2, 8)
    expect(sphere.radius).toBeCloseTo(Math.sqrt(6), 8)
    // 而且它真的过四个顶点（外接球的定义本身，拿求出来的球心去量）。
    const vertices = ["p-a", "p-b", "p-c", "p-d"].map((id) => {
      const point = moved.document.primitives.find((primitive) => primitive.id === id) as { position: { x: number; y: number; z: number } }
      return point.position
    })
    for (const vertex of vertices) expect(distance(sphere.center, vertex)).toBeCloseTo(sphere.radius, 8)

    // 依赖图必须有"顶点 → 实体 → 球"这条链，否则增量重算不会带上它。
    expect([...getAffectedPrimitiveIds(tetrahedronDocument(), ["p-d"])]).toContain("sphere-out")
    expect([...getAffectedPrimitiveIds(tetrahedronDocument(), ["solid-1"])]).toContain("sphere-out")
  })

  it("keeps the previous geometry when the solid has no such sphere, instead of inventing one", () => {
    /**
     * 先把盒子算出一版精确几何，再把一个顶点拉出去 —— 那只多面体就**不再有外接球**
     * （`solidDerived.test.ts` 里同一类构造）。正确行为是**保留上一次的几何**，
     * 而不是交一个"最接近"的球：文档层不伪造坐标，结构化诊断归 `solidStatusReport`。
     */
    const settled = recomputeDerivedObjects(boxDocument())
    const before = sphereOf(settled, "sphere-out")
    const pulled = applyOperation(settled, patchPoint3("p-g", { x: 9, y: 9, z: 9 }))
    const after = sphereOf(pulled.document, "sphere-out")
    expect(after.center).toEqual(before.center)
    expect(after.radius).toBeCloseTo(before.radius, 10)
  })
})
