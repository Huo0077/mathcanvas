import { describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"

import { applyOperation, getAffectedPrimitiveIds, recomputeDerivedObjects } from "./index"

/**
 * **由三角形驱动的圆**（Reactive DAG 切片 Task 3；设计规格 §4.3）。
 *
 * `radiusFrom: { kind: "triangle", triangleIds, metric }` 的圆，圆心与半径都是**派生缓存**：
 * 内切圆取内心 + 内切半径、外接圆取外心 + 外接半径。顶点一动，圆就跟着走 —— 没有任何手抄的数字。
 * 这条规则与内核的三角形中心节点是同一份几何（`triangleCenter2` / `triangleRadius2`）。
 */
describe("triangle-derived circles", () => {
  /** 直角三角形 A(0,0) B(4,0) C(0,3)：面积 6、周长 12、内切圆 (1,1) r=1、外接圆 (2,1.5) R=2.5。 */
  function incircleDocument() {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "point-a", type: "point", x: 0, y: 0, label: "A" },
      { id: "point-b", type: "point", x: 4, y: 0, label: "B" },
      { id: "point-c", type: "point", x: 0, y: 3, label: "C" },
      { id: "circle-in", type: "circle", center: { x: 0, y: 0 }, radius: 5, label: "内切圆", radiusFrom: { kind: "triangle", triangleIds: ["point-a", "point-b", "point-c"], metric: "inradius" } }
    ]
    return document
  }

  const circleOf = (document: ReturnType<typeof incircleDocument>) =>
    document.primitives.find((primitive) => primitive.id === "circle-in") as { center: { x: number; y: number }; radius: number }

  it("derives the centre and radius of an incircle from its triangle", () => {
    const circle = circleOf(recomputeDerivedObjects(incircleDocument()))
    expect(circle.center.x).toBeCloseTo(1, 10)
    expect(circle.center.y).toBeCloseTo(1, 10)
    expect(circle.radius).toBeCloseTo(1, 10)
  })

  it("derives a circumcircle from the same triangle", () => {
    const document = incircleDocument()
    document.primitives = document.primitives.map((primitive) => primitive.id === "circle-in"
      ? { ...primitive, radiusFrom: { kind: "triangle" as const, triangleIds: ["point-a", "point-b", "point-c"] as [string, string, string], metric: "circumradius" as const } }
      : primitive)
    const circle = circleOf(recomputeDerivedObjects(document))
    expect(circle.center.x).toBeCloseTo(2, 10)
    expect(circle.center.y).toBeCloseTo(1.5, 10)
    expect(circle.radius).toBeCloseTo(2.5, 10)
  })

  it("moves the derived circle when a vertex moves, and lists it as affected", () => {
    const moved = applyOperation(incircleDocument(), { op: "updatePrimitive", id: "point-c", patch: { y: 6 } })
    const circle = circleOf(moved.document)

    // 独立算一遍：C=(0,6) ⇒ 边长 4、6、2√13 ⇒ 面积 12、半周长 (10+2√13)/2。
    const perimeter = 4 + 6 + 2 * Math.sqrt(13)
    expect(circle.radius).toBeCloseTo(24 / perimeter, 8)
    // 圆心到三边等距（内切圆的定义本身）。
    const distanceToLine = (point: { x: number; y: number }, first: { x: number; y: number }, second: { x: number; y: number }): number =>
      Math.abs((second.x - first.x) * (first.y - point.y) - (first.x - point.x) * (second.y - first.y)) / Math.hypot(second.x - first.x, second.y - first.y)
    const toBase = distanceToLine(circle.center, { x: 0, y: 0 }, { x: 4, y: 0 })
    expect(distanceToLine(circle.center, { x: 0, y: 6 }, { x: 0, y: 0 })).toBeCloseTo(toBase, 8)
    expect(distanceToLine(circle.center, { x: 4, y: 0 }, { x: 0, y: 6 })).toBeCloseTo(toBase, 8)

    // 依赖图必须有"顶点 → 圆"这条边，否则增量重算不会带上它。
    expect([...getAffectedPrimitiveIds(incircleDocument(), ["point-c"])]).toContain("circle-in")
  })

  it("keeps the previous geometry when the triangle is degenerate, instead of inventing a circle", () => {
    // 先让它算出一版几何（(1,1) r=1），再把 C 挪到 AB 上：三点共线，内切圆没有定义。
    const settled = recomputeDerivedObjects(incircleDocument())
    const collapsed = applyOperation(settled, { op: "updatePrimitive", id: "point-c", patch: { x: 2, y: 0 } })
    const circle = circleOf(collapsed.document)
    // 上一次求出来的 (1,1) r=1 原样保留（文档层不伪造坐标；退化诊断由 Reactive DAG 报）。
    expect(circle.center).toEqual({ x: 1, y: 1 })
    expect(circle.radius).toBeCloseTo(1, 10)
  })

  it("drops the rule when a triangle vertex is deleted, keeping the circle at its last geometry", () => {
    const deleted = applyOperation(incircleDocument(), { op: "deleteObject", id: "point-c" })
    const circle = circleOf(deleted.document) as { radiusFrom?: unknown }
    expect(circle.radiusFrom).toBeUndefined()
  })
})
