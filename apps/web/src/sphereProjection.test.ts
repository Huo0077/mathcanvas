import { describe, expect, it } from "vitest"

import { createEmptyDocument, type PrimitiveSpec } from "@draw/dsl"

import { resolveProjectedDrawing } from "./projectionVisuals"

/**
 * **球在工程图里的投影**（实施计划 Task 7）。
 *
 * 判据是球区别于所有多面体的那条性质：**正投影下球的轮廓永远是一个圆，半径等于球半径，与视线方向无关**。
 * 所以四个视图（前 / 顶 / 左 / 轴测）必须给出**同样大**的圆 —— 而立方体在四个视图里是三个不同的矩形。
 *
 * 另外两条：
 * ② **只投影轮廓，不投影显示网格** —— 拿网格三角形去投影会得到几十条多余的线（spec 明令：网格不是数学来源）；
 * ③ **隐藏的球不出现**。
 */

const SPHERE = { id: "sphere-1", type: "sphere" as const, center: { x: 1, y: 2, z: 3 }, radius: 5 }

const documentWith = (...primitives: readonly PrimitiveSpec[]) => {
  const document = createEmptyDocument("geometry3d")
  document.primitives = [...primitives]
  return document
}

const views = ["front", "top", "left", "axonometric"] as const

/** 球那一条投影（应当**只有一条**）。 */
const outlinesFor = (view: (typeof views)[number], primitives: readonly PrimitiveSpec[] = [SPHERE]) =>
  resolveProjectedDrawing(documentWith(...primitives), view).primitives.filter((primitive) => primitive.sourceId === "sphere-1")

/** 从采样点反推圆心与半径：均匀采样的整圆，其点集形心就是圆心。 */
function circleOf(points: { x: number; y: number }[]) {
  // 采样在闭合处重复了第一个点（避免浮点缝），算形心时要先去掉。
  const unique = points.slice(0, -1)
  const mean = unique.reduce((sum, point) => ({ x: sum.x + point.x / unique.length, y: sum.y + point.y / unique.length }), { x: 0, y: 0 })
  return { mean, radii: unique.map((point) => Math.hypot(point.x - mean.x, point.y - mean.y)) }
}

describe("a sphere projects to a circle", () => {
  it("emits one closed polyline for the ball, and no mesh edges", () => {
    const outlines = outlinesFor("front")

    // ② 只有轮廓这一条：把显示网格的三角形也投影出来的话这里会有几十条。
    expect(outlines).toHaveLength(1)
    expect(outlines[0]).toMatchObject({ kind: "polyline", sourceId: "sphere-1", closed: true })
  })

  it("puts the projected centre exactly where the sphere centre projects, with radius = the sphere radius", () => {
    const outline = outlinesFor("front")[0]
    if (outline.kind !== "polyline") throw new Error("expected a polyline")

    // front 视图：horizontal = x、vertical = y ⇒ 球心 (1,2,3) 投影到 (1,2)。
    const { mean, radii } = circleOf(outline.points)
    expect(mean.x).toBeCloseTo(1, 9)
    expect(mean.y).toBeCloseTo(2, 9)
    expect(outline.points.length).toBeGreaterThanOrEqual(12)
    for (const radius of radii) expect(radius).toBeCloseTo(5, 9)
    // 闭合：首尾是同一个点。
    expect(outline.points[0]).toEqual(outline.points.at(-1))
  })

  it("gives the same radius in all four views — a ball has no preferred direction", () => {
    for (const view of views) {
      const outline = outlinesFor(view)[0]
      if (outline?.kind !== "polyline") throw new Error(`expected a polyline for ${view}`)
      const { radii } = circleOf(outline.points)
      for (const radius of radii) expect(radius, `${view} 视图的交圆半径`).toBeCloseTo(5, 9)
    }
  })

  it("scales with the radius instead of reusing one hard-coded number", () => {
    const small = outlinesFor("top", [{ ...SPHERE, radius: 2 }])[0]
    if (small.kind !== "polyline") throw new Error("expected a polyline")

    for (const radius of circleOf(small.points).radii) expect(radius).toBeCloseTo(2, 9)
  })

  it("draws a visible sphere but not a hidden one", () => {
    expect(outlinesFor("front", [{ ...SPHERE, visible: false }])).toHaveLength(0)

    /**
     * **反向对照**：同一份文档里放一个隐藏的球 + 一个可见的空间点 —— 点必须照常投影。
     * 少了这条，"球压根不投影"的现状也能让上面那句 `toHaveLength(0)` 变绿（它什么都没钉住）。
     */
    const document = documentWith(
      { ...SPHERE, visible: false },
      { id: "point-a", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "free" } }
    )
    const projected = resolveProjectedDrawing(document, "front").primitives
    expect(projected.some((primitive) => primitive.sourceId === "point-a")).toBe(true)
    expect(projected.some((primitive) => primitive.sourceId === "sphere-1")).toBe(false)
  })
})
