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

/**
 * A1 的框选适配：圆弧的"完全在框内"必须走解析判定。
 *
 * 采样弦是**内接**折线：它永远躲在真实曲线里面。真实曲线在极值角处鼓出的那一小段
 * （r·(1 − cos(π/24)) ≈ 0.00857·r）会让"所有采样点都在框内"的判定悄悄放过一个出框的弧。
 * 下面第一组用例就是这个缺陷的回归。
 */
describe("analytic window containment for arcs (no chord sampling)", () => {
  const quarterish = { id: "arc", type: "arc" as const, center: { x: 0, y: 0 }, radius: 1, startAngle: Math.PI / 4, endAngle: (3 * Math.PI) / 4 }
  /**
   * 同样的弧，但起止角特意避开 90°：24 段采样里**没有**哪一段的采样点正好落在弧顶，
   * 采样点因此整体低于真实弧顶（内接折线）。这是采样判定唯一会出错的那类输入。
   */
  const bulging = { id: "bulge", type: "arc" as const, center: { x: 0, y: 0 }, radius: 1, startAngle: 0.9, endAngle: 2 }

  it("rejects an arc whose chords all fit but whose true apex leaves the box", () => {
    // 半径 1、24 段采样的拱高：h = r·(1 − cos(π/24)) ≈ 0.00856，弧顶 (0, 1)。
    // 这条弧的采样点最高只到 0.99982（见下面的断言），框的上边取 0.9999 便"采样点全在框内、弧顶在框外"。
    const bulge = { minX: -0.5, minY: 0.7, maxX: 0.7, maxY: 0.9999 }

    // 先证明这个 fixture 有意义：旧的 24 段采样点确实全在框内。
    const sampled = Array.from({ length: 25 }, (_, index) => {
      const angle = bulging.startAngle + (bulging.endAngle - bulging.startAngle) * (index / 24)
      return { x: Math.cos(angle), y: Math.sin(angle) }
    })
    expect(Math.min(...sampled.map((point) => point.x))).toBeCloseTo(Math.cos(bulging.endAngle), 12)
    expect(Math.max(...sampled.map((point) => point.y))).toBeLessThan(0.9999)
    expect(sampled.every((point) => pointInSelectionBox(point, bulge))).toBe(true)

    // 真实弧顶 (0, 1) 在框外。
    expect(pointInSelectionBox({ x: 0, y: 1 }, bulge)).toBe(false)
    expect(primitiveInSelectionBox(bulging, bulge)).toBe(false)
  })

  it("accepts the same arc once the box covers its true apex", () => {
    expect(primitiveInSelectionBox(bulging, { minX: -0.5, minY: 0.7, maxX: 0.7, maxY: 1 })).toBe(true)
    expect(primitiveInSelectionBox(quarterish, { minX: -1, minY: 0, maxX: 1, maxY: 1 })).toBe(true)
  })

  it("rejects an arc that leaves the box through a bulge with both endpoints inside", () => {
    // 两个端点 (±0.7071, 0.7071) 都在框内，只有弧顶 (0, 1) 出框。
    const clip = { minX: -0.75, minY: 0, maxX: 0.75, maxY: 0.995 }

    expect(pointInSelectionBox({ x: Math.cos(Math.PI / 4), y: Math.sin(Math.PI / 4) }, clip)).toBe(true)
    expect(pointInSelectionBox({ x: Math.cos((3 * Math.PI) / 4), y: Math.sin((3 * Math.PI) / 4) }, clip)).toBe(true)
    expect(primitiveInSelectionBox(quarterish, clip)).toBe(false)
  })

  it("accepts an arc that is genuinely inside, including a wrapped-around one", () => {
    const box = { minX: -1.2, minY: -1.2, maxX: 1.2, maxY: 1.2 }

    expect(primitiveInSelectionBox(quarterish, box)).toBe(true)
    // 跨 0° 的弧：Δ = -20°，弧上有 (1, 0)，弧顶 (0, 1) 不在弧上。
    expect(primitiveInSelectionBox({ id: "wrap", type: "arc", center: { x: 0, y: 0 }, radius: 1, startAngle: -0.35, endAngle: 0.35 }, box)).toBe(true)
  })

  it("looks at the axis tangent directions that fall inside the arc, and not the others", () => {
    /**
     * 圆心 (−1, 1)、半径 1、跨 0° 的弧（θ ∈ [−0.4, 0.4]）：
     * `x = −1 + r·cos θ`、`y = 1 + r·sin θ`，所以弧的 x 范围是 `[−0.079, 0]`、y 范围是 `[0.611, 1.389]`。
     * 弧内的轴向切点是 θ = 0（给出 (0, 1)）；θ = 180° 的 (−2, 1) **不在弧上**。
     * （上一版用例把端点 x 写成了 `−1 − r·cos θ`，符号反了——围着错值造的框测不出这条规则，已重写。）
     */
    const wrapped = { id: "wrap", type: "arc" as const, center: { x: -1, y: 1 }, radius: 1, startAngle: -0.4, endAngle: 0.4 }
    const endpoint = (radius: number, angle: number) => ({ x: -1 + radius * Math.cos(angle), y: 1 + radius * Math.sin(angle) })

    // 框住整条弧，但**排除**弧外的切点 (−2, 1)：只有"范围感知"的实现才会判"完全在框内"。
    const containsArc = { minX: -0.5, minY: 0.5, maxX: 0.5, maxY: 1.5 }
    expect(pointInSelectionBox(endpoint(1, -0.4), containsArc)).toBe(true)
    expect(pointInSelectionBox(endpoint(1, 0.4), containsArc)).toBe(true)
    expect(pointInSelectionBox({ x: -2, y: 1 }, containsArc)).toBe(false)
    expect(primitiveInSelectionBox(wrapped, containsArc)).toBe(true)

    // 反过来：框住两个端点、但**排除**弧内的切点 (0, 1)。只看端点的实现会漏判，范围感知的实现必须判否。
    const clipApex = { minX: -0.5, minY: 0.5, maxX: -0.05, maxY: 1.5 }
    expect(pointInSelectionBox(endpoint(1, -0.4), clipApex)).toBe(true)
    expect(pointInSelectionBox(endpoint(1, 0.4), clipApex)).toBe(true)
    expect(pointInSelectionBox({ x: 0, y: 1 }, clipApex)).toBe(false)
    expect(primitiveInSelectionBox(wrapped, clipApex)).toBe(false)

    // 半径变大后两个端点也出框（同一套候选点判定，不依赖采样密度）。
    expect(primitiveInSelectionBox({ ...wrapped, radius: 1.3 }, containsArc)).toBe(false)
  })

  it("keeps a box that contains the circle's bounding square containing the circle (regression guard)", () => {
    const circle = { id: "c", type: "circle" as const, center: { x: 1, y: -2 }, radius: 3 }

    // 包住外接正方形 [-2, 4] × [-5, 1] 的框：一定包含整个圆。
    expect(primitiveInSelectionBox(circle, { minX: -2, minY: -5, maxX: 4, maxY: 1 })).toBe(true)
    // 圆心在框内、但框比圆小：window 语义下不算选中。
    expect(primitiveInSelectionBox(circle, { minX: -1, minY: -4, maxX: 3, maxY: 0 })).toBe(false)
    // 大框套小圆：包含。
    expect(primitiveInSelectionBox(circle, { minX: -100, minY: -100, maxX: 100, maxY: 100 })).toBe(true)
  })
})

describe("degenerate arcs in window mode", () => {
  const zeroRadius = { id: "r0", type: "arc" as const, center: { x: 0, y: 0 }, radius: 0, startAngle: 0, endAngle: Math.PI / 2 }
  const emptyRange = { id: "empty", type: "arc" as const, center: { x: 0, y: 0 }, radius: 1, startAngle: 1, endAngle: 1 }
  const nonFinite = { id: "nan", type: "arc" as const, center: { x: Number.NaN, y: 0 }, radius: 1, startAngle: 0, endAngle: 1 }

  it("handles the whole range even when no angle is returned", () => {
    expect(primitiveInSelectionBox(zeroRadius, box)).toBe(true)
    expect(primitiveInSelectionBox(zeroRadius, { minX: 1, minY: 1, maxX: 2, maxY: 2 })).toBe(false)
  })

  it("rejects an empty angular range instead of inventing a curve", () => {
    expect(primitiveInSelectionBox(emptyRange, box)).toBe(false)
  })

  it("stays safe on non-finite input", () => {
    expect(primitiveInSelectionBox(nonFinite, box)).toBe(false)
    expect(primitiveInSelectionBox({ ...nonFinite, center: { x: 0, y: 0 }, radius: Number.NaN }, box)).toBe(false)
    expect(primitiveInSelectionBox({ ...nonFinite, center: { x: 0, y: 0 }, radius: Number.POSITIVE_INFINITY }, box)).toBe(false)
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

  it("still reports intersection for a box that cuts the circle", () => {
    const circle = { id: "c", type: "circle" as const, center: { x: 0, y: 0 }, radius: 1 }

    // 框切开圆周：既不是"完全在框内"，又确实与框相交。
    expect(primitiveInSelectionBox(circle, { minX: 0.5, minY: -2, maxX: 3, maxY: 2 })).toBe(false)
    expect(primitiveCrossesSelectionBox(circle, { minX: 0.5, minY: -2, maxX: 3, maxY: 2 })).toBe(true)
    // 小框整个落在圆内，圆周不经过它：相交框选不选（沿用既有语义）。
    expect(primitiveCrossesSelectionBox(circle, { minX: -0.1, minY: -0.1, maxX: 0.1, maxY: 0.1 })).toBe(false)
    // 小框在圆外：不相交。
    expect(primitiveCrossesSelectionBox(circle, { minX: 3, minY: 3, maxX: 4, maxY: 4 })).toBe(false)
  })

  it("keeps the permissive chord test for arcs in crossing mode", () => {
    // 交叉框选是"碰到就算"，弦是内接折线：它可能把"只是贴近"误报成相交，
    // 这是偏宽松的一侧（多选而不是漏选），与旧行为一致。
    expect(primitiveCrossesSelectionBox({ id: "a", type: "arc", center: { x: 0, y: 0 }, radius: 1, startAngle: 0, endAngle: Math.PI / 2 }, { minX: 0.4, minY: 0.4, maxX: 0.6, maxY: 0.6 })).toBe(false)
    expect(primitiveCrossesSelectionBox({ id: "b", type: "arc", center: { x: 0, y: 0 }, radius: 1, startAngle: Math.PI / 4, endAngle: (3 * Math.PI) / 4 }, { minX: -0.5, minY: 0.5, maxX: 0.5, maxY: 2 })).toBe(true)
  })

  it("handles degenerate arcs without crashing", () => {
    expect(primitiveCrossesSelectionBox({ id: "empty", type: "arc", center: { x: 0, y: 0 }, radius: 1, startAngle: 1, endAngle: 1 }, box)).toBe(true)
    expect(primitiveCrossesSelectionBox({ id: "empty-out", type: "arc", center: { x: 50, y: 0 }, radius: 1, startAngle: 1, endAngle: 1 }, box)).toBe(false)
    expect(primitiveCrossesSelectionBox({ id: "nan", type: "arc", center: { x: Number.NaN, y: 0 }, radius: 1, startAngle: 0, endAngle: 1 }, box)).toBe(false)
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
