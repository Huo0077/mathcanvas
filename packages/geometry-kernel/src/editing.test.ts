import { describe, expect, it } from "vitest"

import type { PrimitiveSpec, SegmentPrimitive } from "@draw/dsl"

import { extendPrimitive, offsetPrimitive, trimPrimitive } from "./editing"

const horizontal: SegmentPrimitive = { id: "s", type: "segment", a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }
const verticalCut: SegmentPrimitive = { id: "cut", type: "segment", a: { x: 4, y: -5 }, b: { x: 4, y: 5 } }
const farCut: SegmentPrimitive = { id: "far", type: "segment", a: { x: 40, y: -5 }, b: { x: 40, y: 5 } }
const round = (value: number) => Number(value.toFixed(6))

describe("offset", () => {
  it("shifts a segment to the left of its direction and back for a negative distance", () => {
    expect(offsetPrimitive(horizontal, 2)).toEqual({ kind: "line-like", a: { x: 0, y: 2 }, b: { x: 10, y: 2 } })
    expect(offsetPrimitive(horizontal, -2)).toEqual({ kind: "line-like", a: { x: 0, y: -2 }, b: { x: 10, y: -2 } })
  })

  it("uses the direction of travel, not the screen axis", () => {
    const upward: SegmentPrimitive = { id: "u", type: "segment", a: { x: 0, y: 0 }, b: { x: 0, y: 10 } }

    expect(offsetPrimitive(upward, 2)).toEqual({ kind: "line-like", a: { x: -2, y: 0 }, b: { x: -2, y: 10 } })
  })

  it("grows a circle and an arc radius, and refuses to collapse them", () => {
    expect(offsetPrimitive({ id: "c", type: "circle", center: { x: 0, y: 0 }, radius: 5 }, 2)).toEqual({ kind: "radius", radius: 7 })
    expect(offsetPrimitive({ id: "a", type: "arc", center: { x: 0, y: 0 }, radius: 5, startAngle: 0, endAngle: Math.PI / 2 }, -2)).toEqual({ kind: "radius", radius: 3 })
    expect(offsetPrimitive({ id: "c", type: "circle", center: { x: 0, y: 0 }, radius: 5 }, -5)).toBeNull()
  })

  it("miters a polyline corner instead of leaving a gap", () => {
    const corner: PrimitiveSpec = { id: "p", type: "polyline", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }

    const result = offsetPrimitive(corner as never, 2)

    expect(result).toEqual({ kind: "polyline", points: [{ x: 0, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 10 }] })
  })

  it("falls back to the shifted vertex when a corner has no miter", () => {
    // 折返（180°）时两条偏移线平行，没有斜接点：退回把顶点直接平移。
    const reversal: PrimitiveSpec = { id: "r", type: "polyline", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }] }

    const result = offsetPrimitive(reversal as never, 2)

    expect(result?.kind).toBe("polyline")
    expect(round((result as { points: { x: number; y: number }[] }).points[1].x)).toBe(10)
  })

  it("has no offset for a bare point", () => {
    expect(offsetPrimitive({ id: "pt", type: "point", x: 0, y: 0 } as never, 2)).toBeNull()
  })
})

describe("trim", () => {
  it("cuts off the half away from the picked side", () => {
    expect(trimPrimitive(horizontal, verticalCut, { x: 1, y: 0 })).toEqual({ kind: "line-like", a: { x: 0, y: 0 }, b: { x: 4, y: 0 } })
    expect(trimPrimitive(horizontal, verticalCut, { x: 8, y: 0 })).toEqual({ kind: "line-like", a: { x: 4, y: 0 }, b: { x: 10, y: 0 } })
  })

  it("returns nothing when the boundary does not actually cross", () => {
    expect(trimPrimitive(horizontal, farCut, { x: 1, y: 0 })).toBeNull()
  })

  it("trims a ray by moving its far point", () => {
    const ray: PrimitiveSpec = { id: "r", type: "ray", a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }

    expect(trimPrimitive(ray as never, verticalCut, { x: 1, y: 0 })).toEqual({ kind: "line-like", a: { x: 0, y: 0 }, b: { x: 4, y: 0 } })
  })
})

describe("extend", () => {
  it("stretches the end nearest the picked side out to the boundary", () => {
    const short: SegmentPrimitive = { id: "short", type: "segment", a: { x: 0, y: 0 }, b: { x: 4, y: 0 } }
    const boundary: SegmentPrimitive = { id: "b", type: "segment", a: { x: 10, y: -5 }, b: { x: 10, y: 5 } }

    expect(extendPrimitive(short, boundary, { x: 3, y: 0 })).toEqual({ kind: "line-like", a: { x: 0, y: 0 }, b: { x: 10, y: 0 } })
  })

  it("extends the start end when that side is picked", () => {
    const right: SegmentPrimitive = { id: "right", type: "segment", a: { x: 6, y: 0 }, b: { x: 10, y: 0 } }
    const boundary: SegmentPrimitive = { id: "b", type: "segment", a: { x: 4, y: -5 }, b: { x: 4, y: 5 } }

    expect(extendPrimitive(right, boundary, { x: 7, y: 0 })).toEqual({ kind: "line-like", a: { x: 4, y: 0 }, b: { x: 10, y: 0 } })
  })

  it("only accepts intersections beyond the current span", () => {
    // x=2 的边界落在线段内部：那是修剪该干的事，不算延伸。
    const boundary: PrimitiveSpec = { id: "inside", type: "segment", a: { x: 2, y: -5 }, b: { x: 2, y: 5 } }

    expect(extendPrimitive(horizontal, boundary as never, { x: 3, y: 0 })).toBeNull()
  })

  it("returns nothing when the picked side has no boundary ahead", () => {
    const short: SegmentPrimitive = { id: "short", type: "segment", a: { x: 0, y: 0 }, b: { x: 4, y: 0 } }
    const behind: SegmentPrimitive = { id: "behind", type: "segment", a: { x: -10, y: -5 }, b: { x: -10, y: 5 } }

    expect(extendPrimitive(short, behind, { x: 3, y: 0 })).toBeNull()
  })
})
