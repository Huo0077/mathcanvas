import { describe, expect, it } from "vitest"

import { intersectCircles, intersectCirclesDetailed, intersectLineCircle, intersectLineCircleDetailed, intersectLines, intersectLinesDetailed, intersectPolylineCircleDetailed, intersectPolylineLineDetailed, intersectRayCircleDetailed, intersectRayLineDetailed, intersectSampledPrimitives } from "./index"
import type { PolylinePrimitive, RayPrimitive } from "@draw/dsl"

describe("line intersections", () => {
  it("finds sampled intersections between a function and an ellipse", () => {
    const result = intersectSampledPrimitives(
      { id: "function", type: "function", expression: "x*x", domain: [-4, 4], samples: 256 },
      { id: "ellipse", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 4, radiusY: 2 }
    )

    expect(result.kind).toBe("points")
    if (result.kind === "points") {
      expect(result.points[0].y).toBeGreaterThan(1)
      expect(result.points[1].y).toBeGreaterThan(1)
      expect(Math.abs(result.points[0].x)).toBeCloseTo(Math.abs(result.points[1].x), 1)
    }
  })

  it("filters ray-line intersections to the forward half-line", () => {
    const ray: RayPrimitive = { id: "ray", type: "ray", a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }
    expect(intersectRayLineDetailed(ray, { id: "line", type: "line", a: { x: 2, y: -1 }, b: { x: 2, y: 1 } })).toEqual({ kind: "point", point: { x: 2, y: 0 } })
    expect(intersectRayLineDetailed(ray, { id: "line", type: "line", a: { x: -2, y: -1 }, b: { x: -2, y: 1 } })).toEqual({ kind: "none", reason: "intersection lies behind ray origin" })
  })

  it("filters ray-circle intersections and deduplicates polyline vertices", () => {
    const ray: RayPrimitive = { id: "ray", type: "ray", a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }
    expect(intersectRayCircleDetailed(ray, { id: "circle", type: "circle", center: { x: 2, y: 0 }, radius: 1 })).toMatchObject({ kind: "points" })
    expect(intersectRayCircleDetailed({ ...ray, a: { x: 4, y: 0 }, b: { x: 5, y: 0 } }, { id: "circle", type: "circle", center: { x: 2, y: 0 }, radius: 1 })).toEqual({ kind: "none", reason: "intersection lies behind ray origin" })
    const polyline: PolylinePrimitive = { id: "polyline", type: "polyline", points: [{ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }] }
    expect(intersectPolylineLineDetailed(polyline, { id: "line", type: "line", a: { x: 0, y: -1 }, b: { x: 0, y: 1 } })).toEqual({ kind: "point", point: { x: 0, y: 0 } })
    expect(intersectPolylineCircleDetailed(polyline, { id: "circle", type: "circle", center: { x: 0, y: 0 }, radius: 1 })).toEqual({ kind: "points", points: [{ x: -1, y: 0 }, { x: 1, y: 0 }] })
  })
  it("returns the intersection of two non-parallel lines", () => {
    expect(
      intersectLines(
        { id: "a", type: "line", a: { x: 0, y: 0 }, b: { x: 2, y: 2 } },
        { id: "b", type: "line", a: { x: 0, y: 2 }, b: { x: 2, y: 0 } }
      )
    ).toEqual({ x: 1, y: 1 })
  })

  it("returns no point for parallel lines", () => {
    expect(intersectLines(
      { id: "a", type: "line", a: { x: 0, y: 0 }, b: { x: 2, y: 2 } },
      { id: "b", type: "line", a: { x: 0, y: 1 }, b: { x: 2, y: 3 } }
    )).toBeNull()
  })

  it.each([1e-9, 1, 1e9])("classifies scaled line intersections at scale %s", (scale) => {
    const result = intersectLinesDetailed(
      { id: "a", type: "line", a: { x: 0, y: 0 }, b: { x: 2 * scale, y: 2 * scale } },
      { id: "b", type: "line", a: { x: 0, y: 2 * scale }, b: { x: 2 * scale, y: 0 } }
    )

    expect(result.kind).toBe("point")
    if (result.kind === "point") {
      expect(result.point.x).toBeCloseTo(scale)
      expect(result.point.y).toBeCloseTo(scale)
    }
  })

  it("distinguishes parallel and coincident lines", () => {
    expect(intersectLinesDetailed(
      { id: "a", type: "line", a: { x: 0, y: 0 }, b: { x: 2, y: 2 } },
      { id: "b", type: "line", a: { x: 0, y: 1 }, b: { x: 2, y: 3 } }
    )).toEqual({ kind: "none", reason: "parallel" })
    expect(intersectLinesDetailed(
      { id: "a", type: "line", a: { x: 0, y: 0 }, b: { x: 2, y: 2 } },
      { id: "b", type: "line", a: { x: 4, y: 4 }, b: { x: 6, y: 6 } }
    )).toEqual({ kind: "coincident" })
  })

  it("does not call near-parallel lines coincident when only one endpoint is shared", () => {
    const result = intersectLinesDetailed(
      { id: "a", type: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 0 } },
      { id: "b", type: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 5e-12 } }
    )

    expect(result).toEqual({ kind: "none", reason: "parallel" })
  })

  it("classifies zero-length and non-finite lines as degenerate", () => {
    expect(intersectLinesDetailed(
      { id: "a", type: "line", a: { x: 1, y: 1 }, b: { x: 1, y: 1 } },
      { id: "b", type: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }
    ).kind).toBe("degenerate")
    expect(intersectLinesDetailed(
      { id: "a", type: "line", a: { x: Number.NaN, y: 0 }, b: { x: 1, y: 1 } },
      { id: "b", type: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }
    ).kind).toBe("degenerate")
  })

  it("preserves line classification under a large translation", () => {
    const origin = 1e9
    const scale = 1e-3
    const result = intersectLinesDetailed(
      { id: "a", type: "line", a: { x: origin, y: origin }, b: { x: origin + 2 * scale, y: origin + 2 * scale } },
      { id: "b", type: "line", a: { x: origin, y: origin + 2 * scale }, b: { x: origin + 2 * scale, y: origin } }
    )

    expect(result.kind).toBe("point")
  })

  it("avoids far-anchor cancellation for line-circle intersections", () => {
    const result = intersectLineCircleDetailed(
      { id: "line", type: "line", a: { x: 1e9, y: 0 }, b: { x: 1e9 + 1, y: 0 } },
      { id: "circle", type: "circle", center: { x: 0, y: 0 }, radius: 1 }
    )

    expect(result.kind).toBe("points")
    if (result.kind === "points") expect(result.points).toEqual([{ x: -1, y: 0 }, { x: 1, y: 0 }])
  })

  it("classifies overflowing line-circle intermediates as degenerate", () => {
    const result = intersectLineCircleDetailed(
      { id: "line", type: "line", a: { x: Number.MAX_VALUE, y: 0 }, b: { x: Number.MAX_VALUE, y: 1 } },
      { id: "circle", type: "circle", center: { x: -Number.MAX_VALUE, y: 0 }, radius: 1 }
    )

    expect(result.kind).toBe("degenerate")
  })

  it("finds both intersections between a line and a circle", () => {
    expect(intersectLineCircle(
      { id: "line", type: "line", a: { x: -2, y: 0 }, b: { x: 2, y: 0 } },
      { id: "circle", type: "circle", center: { x: 0, y: 0 }, radius: 1 }
    )).toEqual([{ x: -1, y: 0 }, { x: 1, y: 0 }])
  })

  it.each([1e-9, 1, 1e9])("classifies line-circle tangency at scale %s", (scale) => {
    const result = intersectLineCircleDetailed(
      { id: "line", type: "line", a: { x: -2 * scale, y: scale }, b: { x: 2 * scale, y: scale } },
      { id: "circle", type: "circle", center: { x: 0, y: 0 }, radius: scale }
    )

    expect(result.kind).toBe("tangent")
    if (result.kind === "tangent") {
      expect(result.point.x).toBeCloseTo(0)
      expect(result.point.y).toBeCloseTo(scale)
    }
  })

  it("orders two line-circle points by the line parameter", () => {
    expect(intersectLineCircleDetailed(
      { id: "line", type: "line", a: { x: 2, y: 0 }, b: { x: -2, y: 0 } },
      { id: "circle", type: "circle", center: { x: 0, y: 0 }, radius: 1 }
    )).toEqual({ kind: "points", points: [{ x: 1, y: 0 }, { x: -1, y: 0 }] })
  })

  it("finds both intersections between two circles", () => {
    expect(intersectCircles(
      { id: "first", type: "circle", center: { x: 0, y: 0 }, radius: 2 },
      { id: "second", type: "circle", center: { x: 2, y: 0 }, radius: 2 }
    )).toEqual([{ x: 1, y: Math.sqrt(3) }, { x: 1, y: -Math.sqrt(3) }])
  })

  it("distinguishes tangent, coincident, and disjoint circles", () => {
    const first = { id: "first", type: "circle" as const, center: { x: 0, y: 0 }, radius: 2 }

    expect(intersectCirclesDetailed(first, { id: "tangent", type: "circle", center: { x: 4, y: 0 }, radius: 2 }).kind).toBe("tangent")
    expect(intersectCirclesDetailed(first, { id: "same", type: "circle", center: { x: 0, y: 0 }, radius: 2 })).toEqual({ kind: "coincident" })
    expect(intersectCirclesDetailed(first, { id: "inside", type: "circle", center: { x: 0.5, y: 0 }, radius: 0.25 })).toEqual({ kind: "none", reason: "disjoint" })
  })

  it("keeps circle classification scale invariant", () => {
    const result = intersectCirclesDetailed(
      { id: "first", type: "circle", center: { x: 0, y: 0 }, radius: 1e-9 },
      { id: "second", type: "circle", center: { x: 0.5e-9, y: 0 }, radius: 1e-9 }
    )

    expect(result.kind).toBe("points")
  })

  it("keeps extreme finite circle results finite", () => {
    const result = intersectCirclesDetailed(
      { id: "first", type: "circle", center: { x: 0, y: 0 }, radius: 5e199 },
      { id: "second", type: "circle", center: { x: 1e200, y: 0 }, radius: 5e199 }
    )

    expect(result.kind).toBe("tangent")
    if (result.kind === "tangent") expect(Number.isFinite(result.point.x) && Number.isFinite(result.point.y)).toBe(true)
  })

  it("rejects invalid circle geometry", () => {
    expect(intersectCirclesDetailed(
      { id: "first", type: "circle", center: { x: 0, y: 0 }, radius: 0 },
      { id: "second", type: "circle", center: { x: 2, y: 0 }, radius: 1 }
    ).kind).toBe("degenerate")
  })

  it("keeps infinite-line sampled intersections independent of endpoint length", () => {
    const result = intersectSampledPrimitives(
      { id: "short-line", type: "line", a: { x: -0.05, y: 0 }, b: { x: 0.05, y: 0 } },
      { id: "circle", type: "circle", center: { x: 0, y: 0 }, radius: 10 }
    )

    expect(result.kind).toBe("points")
  })
})
