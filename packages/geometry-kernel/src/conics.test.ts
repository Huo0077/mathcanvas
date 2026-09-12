import { describe, expect, it } from "vitest"

import { sampleEllipse, sampleHyperbola, sampleParabola } from "./conics"

describe("conic sampling", () => {
  it("samples finite parabola, ellipse, and hyperbola points", () => {
    expect(sampleParabola({ id: "p", type: "parabola", vertex: { x: 0, y: 0 }, focalParameter: 2, axis: "y" }, [-2, 2], 8)).toHaveLength(9)
    expect(sampleEllipse({ id: "e", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2 }, 16)).toHaveLength(17)
    expect(sampleHyperbola({ id: "h", type: "hyperbola", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2, axis: "x" }, [-3, 3], 8)).toHaveLength(9)
  })
})
