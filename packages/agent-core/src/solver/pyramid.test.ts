import { describe, expect, it } from "vitest"

import { constructSquarePyramid } from "./pyramid"

/**
 * **正方形底 + 顶点到 C/D 等距 + ∠PCA**（2026-10-19，P1-1）。
 *
 * 现场：四棱锥 P-ABCD，底面正方形 AB=4，PC=PD=3，∠PCA=45°。
 * 模型的坐标不满足题设；这类“底面规则 + 两个距离 + 一个角”的构型可以解析解出。
 */
function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

describe("constructSquarePyramid", () => {
  it("places the apex from the equal distances and the base-diagonal angle", () => {
    const points = constructSquarePyramid({ side: 4, apexToC: 3, apexToD: 3, anglePcaDegrees: 45 })
    expect(points).not.toBeNull()
    if (points === null) return
    expect(distance(points.p, points.c)).toBeCloseTo(3, 12)
    expect(distance(points.p, points.d)).toBeCloseTo(3, 12)
    const ca = { x: points.a.x - points.c.x, y: points.a.y - points.c.y, z: points.a.z - points.c.z }
    const cp = { x: points.p.x - points.c.x, y: points.p.y - points.c.y, z: points.p.z - points.c.z }
    const cosine = (ca.x * cp.x + ca.y * cp.y + ca.z * cp.z) / (Math.hypot(ca.x, ca.y, ca.z) * Math.hypot(cp.x, cp.y, cp.z))
    expect(cosine).toBeCloseTo(Math.cos(Math.PI / 4), 12)
  })

  it("refuses an impossible distance/angle instead of returning NaN", () => {
    expect(constructSquarePyramid({ side: 4, apexToC: 1, apexToD: 1, anglePcaDegrees: 89 })).toBeNull()
    expect(constructSquarePyramid({ side: 0, apexToC: 3, apexToD: 3, anglePcaDegrees: 45 })).toBeNull()
  })
})
