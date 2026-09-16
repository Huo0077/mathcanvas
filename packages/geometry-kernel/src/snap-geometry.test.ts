import { describe, expect, it } from "vitest"

import type { ArcPrimitive, CirclePrimitive, LinePrimitive, PolylinePrimitive, SegmentPrimitive } from "@draw/dsl"

import { nearestPointOnPrimitive, perpendicularPointOnPrimitive, planarIntersections, quadrantPointsOnPrimitive } from "./snap-geometry"

const segment: SegmentPrimitive = { id: "s", type: "segment", a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }
const line: LinePrimitive = { id: "l", type: "line", a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }
const circle: CirclePrimitive = { id: "c", type: "circle", center: { x: 0, y: 0 }, radius: 5 }
const quarterArc: ArcPrimitive = { id: "a", type: "arc", center: { x: 0, y: 0 }, radius: 5, startAngle: 0, endAngle: Math.PI / 2 }
const polyline: PolylinePrimitive = { id: "p", type: "polyline", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }

const rounded = (points: { x: number; y: number }[]) => points.map((point) => ({ x: Number(point.x.toFixed(6)), y: Number(point.y.toFixed(6)) }))

describe("quadrant snap points", () => {
  it("returns the four quadrant points of a circle", () => {
    expect(rounded(quadrantPointsOnPrimitive(circle))).toEqual([
      { x: 5, y: 0 }, { x: -5, y: 0 }, { x: 0, y: 5 }, { x: 0, y: -5 }
    ])
  })

  it("keeps only the quadrants an arc actually sweeps", () => {
    // 0° → 90° 的圆弧只经过 (5,0) 和 (0,5)
    expect(rounded(quadrantPointsOnPrimitive(quarterArc))).toEqual([{ x: 5, y: 0 }, { x: 0, y: 5 }])
  })
})

describe("nearest point on an entity", () => {
  it("clamps to the endpoints of a bounded segment", () => {
    expect(nearestPointOnPrimitive(segment, { x: -4, y: 3 })).toEqual({ x: 0, y: 0 })
    expect(nearestPointOnPrimitive(segment, { x: 4, y: 3 })).toEqual({ x: 4, y: 0 })
    expect(nearestPointOnPrimitive(segment, { x: 40, y: 3 })).toEqual({ x: 10, y: 0 })
  })

  it("does not clamp an infinite line", () => {
    expect(nearestPointOnPrimitive(line, { x: 40, y: 3 })).toEqual({ x: 40, y: 0 })
  })

  it("projects onto the circle and clamps to the arc endpoints outside its sweep", () => {
    expect(rounded([nearestPointOnPrimitive(circle, { x: 20, y: 0 })!])).toEqual([{ x: 5, y: 0 }])
    // 指针在圆弧扫过范围之外时，收到扫过范围内离它最近的端点 (0, 5)。
    expect(rounded([nearestPointOnPrimitive(quarterArc, { x: -20, y: 1 })!])).toEqual([{ x: 0, y: 5 }])
    expect(rounded([nearestPointOnPrimitive(quarterArc, { x: 20, y: 20 })!])).toEqual([{ x: 3.535534, y: 3.535534 }])
  })

  it("walks every polyline segment", () => {
    expect(nearestPointOnPrimitive(polyline, { x: 4, y: 3 })).toEqual({ x: 4, y: 0 })
    expect(nearestPointOnPrimitive(polyline, { x: 13, y: 4 })).toEqual({ x: 10, y: 4 })
  })
})

describe("perpendicular foot", () => {
  it("drops a foot onto a segment from the creation anchor", () => {
    expect(perpendicularPointOnPrimitive(segment, { x: 4, y: 9 })).toEqual({ x: 4, y: 0 })
  })

  it("returns nothing when the foot falls outside the segment", () => {
    expect(perpendicularPointOnPrimitive(segment, { x: 40, y: 9 })).toBeNull()
  })

  it("uses the radial direction on a circle", () => {
    // 从圆心右上方出发：垂足是圆心→锚点方向与圆的交点，取离锚点最近的那个。
    expect(rounded([perpendicularPointOnPrimitive(circle, { x: 10, y: 0 })!])).toEqual([{ x: 5, y: 0 }])
  })
})

describe("planar intersections", () => {
  it("crosses a segment with a line", () => {
    const vertical: SegmentPrimitive = { id: "v", type: "segment", a: { x: 4, y: -5 }, b: { x: 4, y: 5 } }

    expect(rounded(planarIntersections(segment, vertical))).toEqual([{ x: 4, y: 0 }])
  })

  it("returns nothing when the crossing is outside a bounded segment", () => {
    const far: SegmentPrimitive = { id: "f", type: "segment", a: { x: 4, y: 6 }, b: { x: 4, y: 9 } }

    expect(planarIntersections(segment, far)).toEqual([])
  })

  it("crosses a segment with a circle twice", () => {
    expect(rounded(planarIntersections(line, circle))).toEqual([{ x: -5, y: 0 }, { x: 5, y: 0 }])
  })

  it("crosses two circles", () => {
    const other: CirclePrimitive = { id: "c2", type: "circle", center: { x: 8, y: 0 }, radius: 5 }

    expect(rounded(planarIntersections(circle, other))).toEqual([{ x: 4, y: 3 }, { x: 4, y: -3 }])
  })

  it("respects the arc sweep", () => {
    // 0°–90° 的四分之一圆弧与 x 轴只交于 (5, 0)，不含 (-5, 0)。
    expect(rounded(planarIntersections(line, quarterArc))).toEqual([{ x: 5, y: 0 }])
  })

  it("intersects a polyline with a circle", () => {
    const small: CirclePrimitive = { id: "c3", type: "circle", center: { x: 10, y: 3 }, radius: 4 }

    const points = rounded(planarIntersections(polyline, small))
    expect(points.length).toBeGreaterThanOrEqual(1)
    expect(points.every((point) => point.x <= 10.000001 && point.y >= -0.000001)).toBe(true)
  })
})
