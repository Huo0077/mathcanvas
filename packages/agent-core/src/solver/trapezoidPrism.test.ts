import { describe, expect, it } from "vitest"

import { constructRightTrapezoidPrism } from "./trapezoidPrism"

/**
 * **直四棱柱 + 梯形底**（2026-10-19，P1-1，solid-20）。
 *
 * AB⊥AD、AB//CD、AB=2、AD=3、CD=4，体积 36 ⇒ 高 = 36 / ((2+4)/2·3) = 4。
 * 把 A 放原点、AB 在 x 轴、AD 在 y 轴；C=(CD,AD)。
 */
describe("constructRightTrapezoidPrism", () => {
  it("derives the prism height from the trapezoid area and the volume", () => {
    const points = constructRightTrapezoidPrism({ ab: 2, ad: 3, cd: 4, volume: 36 })
    expect(points).not.toBeNull()
    if (points === null) return
    expect(points.a).toEqual({ x: 0, y: 0, z: 0 })
    expect(points.b.x).toBeCloseTo(2, 12)
    expect(points.d.y).toBeCloseTo(3, 12)
    expect(points.c.x).toBeCloseTo(4, 12)
    expect(points.a1.z).toBeCloseTo(4, 12)
    expect(points.c1.z).toBeCloseTo(4, 12)
  })

  it("refuses a non-positive volume or side", () => {
    expect(constructRightTrapezoidPrism({ ab: 2, ad: 3, cd: 4, volume: 0 })).toBeNull()
    expect(constructRightTrapezoidPrism({ ab: 0, ad: 3, cd: 4, volume: 36 })).toBeNull()
  })
})
