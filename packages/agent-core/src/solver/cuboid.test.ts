import { describe, expect, it } from "vitest"

import { constructCuboid } from "./cuboid"

/**
 * **长方体解析构造**（P1-1）：长 4、宽 3、高 2 → C₁=(4,3,2)。
 */
describe("cuboid", () => {
  it("places the upper opposite vertex at (length, width, height)", () => {
    const points = constructCuboid(4, 3, 2)
    expect(points).not.toBeNull()
    if (points === null) return
    expect(points.c1).toEqual({ x: 4, y: 3, z: 2 })
    expect(points.a1).toEqual({ x: 0, y: 0, z: 2 })
  })

  it("rejects zero dimensions", () => {
    expect(constructCuboid(4, 0, 2)).toBeNull()
  })
})
