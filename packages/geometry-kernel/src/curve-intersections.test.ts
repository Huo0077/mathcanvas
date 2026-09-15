import { describe, expect, it } from "vitest"

import type { LinePrimitive, PolylinePrimitive } from "@draw/dsl"

import { intersectSampledPrimitives } from "./curve-intersections"
import { intersectPolylineCircleDetailed, intersectPolylineLineDetailed } from "./intersections"

const xAxis: LinePrimitive = { id: "axis", type: "line", a: { x: -8, y: 0 }, b: { x: 8, y: 0 } }

function pointsOf(result: ReturnType<typeof intersectSampledPrimitives>) {
  return result.kind === "points" ? result.points : result.kind === "point" || result.kind === "tangent" ? [result.point] : []
}

describe("sampled curve intersections", () => {
  it("keeps every crossing of a function and a line", () => {
    const sine = { id: "sine", type: "function" as const, expression: "sin(x)", domain: [-7, 7] as [number, number], samples: 256 }

    const points = pointsOf(intersectSampledPrimitives(sine, xAxis))

    // sin(x) = 0 five times inside [-7, 7]; a two-point cap used to drop three of them.
    for (const zero of [-2 * Math.PI, -Math.PI, 0, Math.PI, 2 * Math.PI]) {
      expect(points.some((point) => Math.abs(point.x - zero) < 0.02)).toBe(true)
    }
    expect(points).toHaveLength(5)
  })

  it("keeps every crossing of a function that meets a line four times", () => {
    const quartic = { id: "quartic", type: "function" as const, expression: "x^4 - 5*x^2 + 4", domain: [-4, 4] as [number, number], samples: 256 }

    const points = pointsOf(intersectSampledPrimitives(quartic, xAxis))

    for (const root of [-2, -1, 1, 2]) {
      expect(points.some((point) => Math.abs(point.x - root) < 0.02)).toBe(true)
    }
    expect(points).toHaveLength(4)
  })
})

describe("polyline intersections with an unbounded number of crossings", () => {
  it("keeps three polyline-line crossings", () => {
    const zigzag: PolylinePrimitive = { id: "zigzag", type: "polyline", points: [{ x: -3, y: 1 }, { x: -1, y: -1 }, { x: 1, y: 1 }, { x: 3, y: -1 }] }

    const result = intersectPolylineLineDetailed(zigzag, xAxis)

    expect(result.kind).toBe("points")
    expect(result.kind === "points" ? result.points : []).toHaveLength(3)
  })

  it("keeps three polyline-circle crossings", () => {
    const path: PolylinePrimitive = { id: "path", type: "polyline", points: [{ x: 2, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 2 }, { x: 0, y: -2 }] }

    const result = intersectPolylineCircleDetailed(path, { id: "unit", type: "circle", center: { x: 0, y: 0 }, radius: 1 })

    expect(result.kind).toBe("points")
    expect(result.kind === "points" ? result.points : []).toHaveLength(3)
  })
})
