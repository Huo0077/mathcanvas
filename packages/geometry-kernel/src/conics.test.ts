import { describe, expect, it } from "vitest"

import { sampleEllipse, sampleHyperbola, sampleHyperbolaBranches, sampleParabola } from "./conics"

describe("conic sampling", () => {
  it("samples finite parabola, ellipse, and hyperbola points", () => {
    expect(sampleParabola({ id: "p", type: "parabola", vertex: { x: 0, y: 0 }, focalParameter: 2, axis: "y" }, [-2, 2], 8)).toHaveLength(9)
    expect(sampleEllipse({ id: "e", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2 }, 16)).toHaveLength(17)
    expect(sampleHyperbola({ id: "h", type: "hyperbola", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2, axis: "x" }, [-3, 3], 8)).toHaveLength(9)
  })

  it("rotates sampled conics around their vertex or center", () => {
    const [ellipsePoint] = sampleEllipse({ id: "e", type: "ellipse", center: { x: 1, y: 2 }, radiusX: 3, radiusY: 2, rotation: Math.PI / 2 }, 4)
    const [parabolaPoint] = sampleParabola({ id: "p", type: "parabola", vertex: { x: 1, y: 2 }, focalParameter: 2, axis: "x", rotation: Math.PI / 2 }, [0, 0], 1)

    expect(ellipsePoint.x).toBeCloseTo(1)
    expect(ellipsePoint.y).toBeCloseTo(5)
    expect(parabolaPoint.x).toBeCloseTo(1)
    expect(parabolaPoint.y).toBeCloseTo(2)
  })

  it("keeps both hyperbola branches on the rotated local axis", () => {
    const [first, second] = sampleHyperbolaBranches({ id: "h", type: "hyperbola", center: { x: 1, y: 2 }, radiusX: 3, radiusY: 2, axis: "x", rotation: Math.PI / 4 }, [2, 2], 1)

    expect(second[0].x).toBeCloseTo(2 - first[0].x)
    expect(second[0].y).toBeCloseTo(4 - first[0].y)
  })
})
