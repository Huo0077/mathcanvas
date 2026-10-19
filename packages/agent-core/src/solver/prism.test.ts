import { describe, expect, it } from "vitest"

import { constructRightPrism } from "./prism"

/**
 * **右三棱柱的解析坐标**（2026-10-19，P1-1，solid-13）。
 *
 * 底面直角三角形（∠ACB=90°），棱 AA₁=L，A₁C⊥底面，A₁ 到底面 BCC₁B₁ 的距离 d1，
 * 直线 AA₁ 与 BB₁ 的距离 d2。把 C 放原点、A 在 x 轴、B 在 y 轴，则侧棱向量
 * v=(-x,0,h)，x²+h²=L²、xh/L=d1，直线距离恰为 y=d2。
 */
function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

describe("constructRightPrism", () => {
  it("reconstructs the prism from the lateral length and the two distances", () => {
    const points = constructRightPrism({ lateralLength: 2, apexToPlane: 1, lateralLineDistance: 2 })
    expect(points).not.toBeNull()
    if (points === null) return
    expect(distance(points.a1, points.a)).toBeCloseTo(2, 12)
    expect(points.a1.x).toBeCloseTo(0, 12)
    expect(points.a1.y).toBeCloseTo(0, 12)
    expect(points.b.y).toBeCloseTo(2, 12)
  })

  it("refuses impossible measures", () => {
    expect(constructRightPrism({ lateralLength: 2, apexToPlane: 2, lateralLineDistance: 2 })).toBeNull()
    expect(constructRightPrism({ lateralLength: 0, apexToPlane: 1, lateralLineDistance: 2 })).toBeNull()
  })
})
