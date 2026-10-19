import { describe, expect, it } from "vitest"

import { constructRegularTriangularPyramid } from "./regularTriangularPyramid"

/**
 * **正三棱锥解析构造**（P1-1）：底边 2、侧棱 √3 → 高 √(5/3)。
 */
describe("regular triangular pyramid", () => {
  it("places the apex above the base centroid", () => {
    const points = constructRegularTriangularPyramid(2, Math.sqrt(3))
    expect(points).not.toBeNull()
    if (points === null) return
    expect(points.p.x).toBeCloseTo(1, 9)
    expect(points.p.y).toBeCloseTo(Math.sqrt(3) / 3, 9)
    expect(points.p.z).toBeCloseTo(Math.sqrt(3 - 4 / 3), 9)
  })

  it("rejects a lateral edge shorter than the base circumradius", () => {
    expect(constructRegularTriangularPyramid(2, 1)).toBeNull()
  })
})
