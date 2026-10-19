import { describe, expect, it } from "vitest"

import { constructRegularSquarePyramid } from "./regularPyramid"

/**
 * **正四棱锥解析构造**（P1-1）：侧棱 √5、底边 2 → 高 √3。
 */
describe("regular square pyramid", () => {
  it("places the apex above the base centre", () => {
    const points = constructRegularSquarePyramid(2, Math.sqrt(5))
    expect(points).not.toBeNull()
    if (points === null) return
    expect(points.p.x).toBeCloseTo(1, 9)
    expect(points.p.y).toBeCloseTo(1, 9)
    expect(points.p.z).toBeCloseTo(Math.sqrt(3), 9)
  })

  it("rejects a lateral edge shorter than the circumradius", () => {
    expect(constructRegularSquarePyramid(2, 1)).toBeNull()
  })
})
