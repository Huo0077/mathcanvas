import { describe, expect, it } from "vitest"

import type { CirclePrimitive, PolylinePrimitive, PrimitiveSpec, SegmentPrimitive } from "@draw/dsl"

import { pointInSelectionBox, primitiveCrossesSelectionBox, primitiveInSelectionBox, selectPrimitivesInBox } from "./selection"

const box = { minX: -10, minY: -10, maxX: 10, maxY: 10 }
const inside: SegmentPrimitive = { id: "in", type: "segment", a: { x: -5, y: -5 }, b: { x: 5, y: 5 } }
const pokingOut: SegmentPrimitive = { id: "out", type: "segment", a: { x: 0, y: 0 }, b: { x: 30, y: 0 } }
const passingThrough: SegmentPrimitive = { id: "through", type: "segment", a: { x: -30, y: 0 }, b: { x: 30, y: 0 } }
const farAway: SegmentPrimitive = { id: "far", type: "segment", a: { x: 40, y: 40 }, b: { x: 50, y: 50 } }

describe("window selection (left → right: only fully enclosed objects)", () => {
  it("keeps points inside the box", () => {
    expect(pointInSelectionBox({ x: 0, y: 0 }, box)).toBe(true)
    expect(pointInSelectionBox({ x: 10, y: 10 }, box)).toBe(true)
    expect(pointInSelectionBox({ x: 10.5, y: 0 }, box)).toBe(false)
  })

  it("requires both endpoints of a bounded segment", () => {
    expect(primitiveInSelectionBox(inside, box)).toBe(true)
    expect(primitiveInSelectionBox(pokingOut, box)).toBe(false)
    expect(primitiveInSelectionBox(passingThrough, box)).toBe(false)
  })

  it("judges unbounded lines and rays by their defining endpoints", () => {
    // 历史语义：无限直线/射线无法被真正框住，按定义它的两个端点判定。
    expect(primitiveInSelectionBox({ id: "l", type: "line", a: { x: -5, y: 0 }, b: { x: 5, y: 0 } }, box)).toBe(true)
    expect(primitiveInSelectionBox({ id: "r", type: "ray", a: { x: 0, y: 0 }, b: { x: 5, y: 5 } }, box)).toBe(true)
  })

  it("requires every polyline vertex", () => {
    const polyline: PolylinePrimitive = { id: "p", type: "polyline", points: [{ x: -5, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }] }
    const straying: PolylinePrimitive = { id: "p2", type: "polyline", points: [{ x: -5, y: 0 }, { x: 50, y: 0 }] }

    expect(primitiveInSelectionBox(polyline, box)).toBe(true)
    expect(primitiveInSelectionBox(straying, box)).toBe(false)
  })

  it("requires the whole circle, not just its centre", () => {
    expect(primitiveInSelectionBox({ id: "c", type: "circle", center: { x: 0, y: 0 }, radius: 4 }, box)).toBe(true)
    // 圆心在框内但半径越界：按"完全包含"语义不算选中（旧实现只看圆心，这里刻意收紧）。
    expect(primitiveInSelectionBox({ id: "c2", type: "circle", center: { x: 0, y: 0 }, radius: 15 }, box)).toBe(false)
  })

  /**
   * 体检发现的真缺陷：圆弧只检查了每条采样弦的**起点**，弧的终点从不参与判定。
   * 于是终点戳出框外的弧仍被判为"完全在框内"（误差可达一个弦长 = 张角/24）。
   */
  it("tests an arc's end point, not only the start of each sampled chord", () => {
    const arc = { id: "arc", type: "arc" as const, center: { x: 0, y: 0 }, radius: 1, startAngle: 0, endAngle: Math.PI / 2 + 0.1 }
    const tight = { minX: -0.05, minY: -0.05, maxX: 1.1, maxY: 1.1 }

    // 弧的终点是 (-0.0998, 0.995)，在框外（minX = -0.05）。
    expect(pointInSelectionBox({ x: 1 * Math.cos(arc.endAngle), y: 1 * Math.sin(arc.endAngle) }, tight)).toBe(false)
    expect(primitiveInSelectionBox(arc, tight)).toBe(false)

    // 收进框内后照常选中。
    const roomy = { minX: -0.2, minY: -0.2, maxX: 1.2, maxY: 1.2 }
    expect(primitiveInSelectionBox(arc, roomy)).toBe(true)
  })
})

describe("crossing selection (right → left: anything the box touches)", () => {
  it("selects everything the window mode would select", () => {
    expect(primitiveCrossesSelectionBox(inside, box)).toBe(true)
    expect(primitiveCrossesSelectionBox(pokingOut, box)).toBe(true)
  })

  it("selects an entity that merely passes through", () => {
    expect(primitiveCrossesSelectionBox(passingThrough, box)).toBe(true)
  })

  it("ignores entities that never touch the box", () => {
    expect(primitiveCrossesSelectionBox(farAway, box)).toBe(false)
  })

  it("tells a ring passing through the box apart from a ring that encloses it", () => {
    expect(primitiveCrossesSelectionBox({ id: "ring", type: "circle", center: { x: 0, y: 0 }, radius: 14 }, box)).toBe(true)
    // 大圆把整个框套在里面，但圆周并不经过框：相交框选不应选中它。
    expect(primitiveCrossesSelectionBox({ id: "huge", type: "circle", center: { x: 0, y: 0 }, radius: 60 }, box)).toBe(false)
  })

  it("samples arcs and polylines", () => {
    expect(primitiveCrossesSelectionBox({ id: "a", type: "arc", center: { x: -30, y: 0 }, radius: 25, startAngle: -0.5, endAngle: 0.5 }, box)).toBe(true)
    expect(primitiveCrossesSelectionBox({ id: "p", type: "polyline", points: [{ x: -30, y: 0 }, { x: 30, y: 0 }] }, box)).toBe(true)
  })
})

describe("selecting a whole document", () => {
  const primitives: PrimitiveSpec[] = [
    inside,
    pokingOut,
    { id: "c", type: "circle" as const, center: { x: 0, y: 0 }, radius: 4 },
    { id: "point-1", type: "point" as const, x: 1, y: 1 },
    { id: "point3-1", type: "point3" as const, position: { x: 0, y: 0, z: 0 } }
  ]

  it("differs between the two directions", () => {
    expect(selectPrimitivesInBox(primitives, box, "window")).toEqual(["in", "c", "point-1"])
    expect(selectPrimitivesInBox(primitives, box, "crossing")).toEqual(["in", "out", "c", "point-1"])
  })

  it("skips types that have no planar box semantics instead of guessing", () => {
    expect(selectPrimitivesInBox(primitives, box, "crossing")).not.toContain("point3-1")
  })
})

describe("circle box maths", () => {
  it("treats a circle tangent to the box border as touching", () => {
    const tangent: CirclePrimitive = { id: "t", type: "circle", center: { x: 0, y: 0 }, radius: 10 }

    expect(primitiveCrossesSelectionBox(tangent, box)).toBe(true)
  })
})
