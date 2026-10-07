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
 * ## "内切球"是**到每个面都等距**，不是"最大的内接球"
 *
 * 这条口径是本轮一脚踩出来的（红读数把它逼出来）：长方体 `2 × 4 × 6` 到三对面的距离是 `1 / 2 / 3`，
 * 所以**它根本没有内切球** —— 内核如实报 `undefined`，而**不是**把半径 1 的最大内接球交出来
 * （规格 §3.4："不满足时返回 `undefined`"，因为"没有内切球"与"这是带残差的数值解"必须分得开）。
 * 所以正例只能用**立方体**（到六面等距）这类真有内切球的实体。
 *
 * 三条纪律各钉一条用例：① 算得出来时必须是精确解；② 宿主动了必须跟着重算（依赖图里有那条边）；
 * ③ **算不出来时保留上一次的几何**，绝不伪造一个近似球。
 */

/** 立方体（棱长 2、一角在原点）：外接球 `(1,1,1)`/`√3`，内切球 `(1,1,1)`/`1` —— 两个都精确。 */
function cubeDocument(): GeometryDocument {
  const document = createEmptyDocument("geometry3d")
  const corners: [string, number, number, number][] = [
    ["a", 0, 0, 0], ["b", 2, 0, 0], ["c", 2, 2, 0], ["d", 0, 2, 0],
    ["e", 0, 0, 2], ["f", 2, 0, 2], ["g", 2, 2, 2], ["h", 0, 2, 2]
  ]
  const points = corners.map(([name, x, y, z]) => createPoint3(`p-${name}`, { x, y, z }))
  /**
   * 面环的绕向**不影响**这两条读数：内切球求解器按"面心相对形心的方向"把每个面法向**翻成朝外**
   * （`solidDerived.ts` 的那一步），所以我第一版担心的"底面绕反了"并不是缺口的原因（实测如此）。
   */
  const rings: string[][] = [
    ["a", "b", "c", "d"], ["e", "f", "g", "h"],
    ["a", "b", "f", "e"], ["b", "c", "g", "f"], ["c", "d", "h", "g"], ["d", "a", "e", "h"]
  ]
  return withSpheres(document, points, rings)
}

/**
 * 长方体 `2 × 4 × 6`：**外接球精确**（包围盒中心 + 半对角线），但**没有内切球**（见文件头那段）。
 * 它是"算不出来时保留上一次几何"那条纪律的正例素材。
 */
function brickDocument(): GeometryDocument {
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
  return withSpheres(document, points, rings)
}

/** 顶点 + 面 + 一只实体 + 外接球 / 内切球各一只（两个夹具共用）。 */
function withSpheres(document: GeometryDocument, points: ReturnType<typeof createPoint3>[], rings: string[][]): GeometryDocument {
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
 * **任意四面体都有外接球**（四点不共面 ⇒ 到四点等距的点唯一存在），适合测"宿主动了球跟着动"。
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

const vertexOf = (document: GeometryDocument, id: string) =>
  (document.primitives.find((primitive) => primitive.id === id) as { position: { x: number; y: number; z: number } }).position

const distance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

describe("derived spheres", () => {
  it("derives a cube's circumsphere and insphere exactly", () => {
    const settled = recomputeDerivedObjects(cubeDocument())
    const circum = sphereOf(settled, "sphere-out")
    expect(circum.center).toEqual({ x: 1, y: 1, z: 1 })
    expect(circum.radius).toBeCloseTo(Math.sqrt(3), 10)

    const insphere = sphereOf(settled, "sphere-in")
    expect(insphere.center).toEqual({ x: 1, y: 1, z: 1 })
    expect(insphere.radius).toBeCloseTo(1, 10)
  })

  it("solves a brick's circumsphere but reports no insphere, keeping the placeholder instead of the largest inscribed ball", () => {
    const settled = recomputeDerivedObjects(brickDocument())
    const circum = sphereOf(settled, "sphere-out")
    expect(circum.center).toEqual({ x: 1, y: 2, z: 3 })
    expect(circum.radius).toBeCloseTo(Math.sqrt(14), 10)

    /**
     * 到三对面的距离是 `1 / 2 / 3` ⇒ **没有到六面等距的点** ⇒ 没有内切球。
     * 正确行为是保留上一次的几何（这里是占位值），**不是**把半径 1 的最大内接球交出来 ——
     * 后者会被用户读成"这个盒子的内切球半径是 1"，而那句话是错的。
     */
    const insphere = sphereOf(settled, "sphere-in")
    expect(insphere.center).toEqual({ x: 0, y: 0, z: 0 })
    expect(insphere.radius).toBe(1)
  })

  it("re-derives the circumsphere from the vertices when the solid moves, and lists it as affected", () => {
    const settled = recomputeDerivedObjects(tetrahedronDocument())
    expect(sphereOf(settled, "sphere-out").center).toEqual({ x: 1, y: 1, z: 1 })
    expect(sphereOf(settled, "sphere-out").radius).toBeCloseTo(Math.sqrt(3), 10)

    const moved = applyOperation(settled, patchPoint3("p-d", { x: 0, y: 0, z: 4 }))
    // 先证"顶点真的动了"—— 否则下面那条断言可能在证明一件没发生的事（本轮踩过这个坑）。
    expect(vertexOf(moved.document, "p-d")).toEqual({ x: 0, y: 0, z: 4 })

    /**
     * **独立回代**（自己算，不读求解器给的数）：`A(0,0,0) B(2,0,0) C(0,2,0) D(0,0,4)`
     * 的外接球由对称性给出 `x = 1`、`y = 1`，再由 `1+1+z² = 1+1+(4−z)²` 得 `z = 2`，
     * 于是球心 `(1,1,2)`、半径 `√6`。再拿这个球心去量四个顶点，证明它真的过它们。
     */
    const sphere = sphereOf(moved.document, "sphere-out")
    expect(sphere.center.x).toBeCloseTo(1, 8)
    expect(sphere.center.y).toBeCloseTo(1, 8)
    expect(sphere.center.z).toBeCloseTo(2, 8)
    expect(sphere.radius).toBeCloseTo(Math.sqrt(6), 8)
    for (const id of ["p-a", "p-b", "p-c", "p-d"]) expect(distance(sphere.center, vertexOf(moved.document, id))).toBeCloseTo(sphere.radius, 8)

    // 依赖图必须有"顶点 → 实体 → 球"这条链，否则增量重算不会带上它。
    expect([...getAffectedPrimitiveIds(tetrahedronDocument(), ["p-d"])]).toContain("sphere-out")
    expect([...getAffectedPrimitiveIds(tetrahedronDocument(), ["solid-1"])]).toContain("sphere-out")
  })

  it("keeps the previous geometry when the solid has no circumsphere any more, instead of inventing one", () => {
    /**
     * 先把盒子算出一版精确几何，再把一个顶点拉出去 —— 那只多面体就**不再有外接球**
     * （与 `solidDerived.test.ts` 里"把立方体一个顶点往外拉"同一类构造）。
     * 正确行为是**保留上一次的几何**：文档层不伪造坐标，结构化诊断归 `solidStatusReport`。
     */
    const settled = recomputeDerivedObjects(brickDocument())
    const before = sphereOf(settled, "sphere-out")
    const pulled = applyOperation(settled, patchPoint3("p-g", { x: 9, y: 9, z: 9 }))
    const after = sphereOf(pulled.document, "sphere-out")
    expect(after.center).toEqual(before.center)
    expect(after.radius).toBeCloseTo(before.radius, 10)
  })
})
