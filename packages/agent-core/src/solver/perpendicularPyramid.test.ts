import { describe, expect, it } from "vitest"

import { constructPerpendicularPyramid } from "./perpendicularPyramid"

/**
 * **PA⊥底面 + AD=CD + ∠ABC=120° + 平面PAC⊥平面PBD**（2026-10-19，P1-1，solid-9）。
 *
 * 把 A 放原点、AB 在 x 轴、P 在 z 轴；C 由 BC 与 ∠ABC 定出。D 在 AC 的垂直平分线上，
 * 取到平面条件成立的位置。纯数学层，返回 null 而不是 NaN。
 */
function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

describe("constructPerpendicularPyramid", () => {
  it("satisfies PA, the base angle, AD=CD and the perpendicular planes", () => {
    const points = constructPerpendicularPyramid({ ab: 2, bc: 2, angleABC: 120, pa: 2 })
    expect(points).not.toBeNull()
    if (points === null) return
    expect(distance(points.p, points.a)).toBeCloseTo(2, 12)
    expect(distance(points.a, points.b)).toBeCloseTo(2, 12)
    expect(distance(points.b, points.c)).toBeCloseTo(2, 12)
    expect(distance(points.a, points.d)).toBeCloseTo(distance(points.c, points.d), 12)
    const ba = { x: points.a.x - points.b.x, y: points.a.y - points.b.y, z: 0 }
    const bc = { x: points.c.x - points.b.x, y: points.c.y - points.b.y, z: 0 }
    const cosine = (ba.x * bc.x + ba.y * bc.y) / (Math.hypot(ba.x, ba.y) * Math.hypot(bc.x, bc.y))
    expect(cosine).toBeCloseTo(Math.cos((120 * Math.PI) / 180), 12)
  })

  it("refuses impossible measures", () => {
    expect(constructPerpendicularPyramid({ ab: 0, bc: 2, angleABC: 120, pa: 2 })).toBeNull()
    expect(constructPerpendicularPyramid({ ab: 2, bc: 2, angleABC: 180, pa: 2 })).toBeNull()
  })
})
