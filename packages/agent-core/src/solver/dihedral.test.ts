import { describe, expect, it } from "vitest"

import { dihedralAngleDetail3 } from "@draw/geometry-kernel"

import { constructDihedralTriangle } from "./dihedral"

/**
 * **等腰直角 + 等边 + 二面角**（2026-10-19，P1-1，trig-23）。
 *
 * AB 为等腰直角三角形 ABC 的斜边，△ABD 为等边三角形，二面角 C-AB-D=150°。
 * 把 AB 放在 x 轴，C 在 xy 平面；D 由等边三角形绕 AB 旋转 150° 得到。
 */
function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

describe("constructDihedralTriangle", () => {
  it("keeps both triangles rigid and puts the dihedral on the requested side", () => {
    const points = constructDihedralTriangle({ ab: 2, dihedralDegrees: 150 })
    expect(points).not.toBeNull()
    if (points === null) return
    expect(distance(points.a, points.b)).toBeCloseTo(2, 12)
    expect(distance(points.a, points.c)).toBeCloseTo(Math.SQRT2, 12)
    expect(distance(points.b, points.c)).toBeCloseTo(Math.SQRT2, 12)
    expect(distance(points.a, points.d)).toBeCloseTo(2, 12)
    expect(distance(points.b, points.d)).toBeCloseTo(2, 12)
    expect(points.c.z).toBeCloseTo(0, 12)
    expect(points.d.z).toBeLessThan(0)
    const detail = dihedralAngleDetail3([points.a, points.b, points.c], [points.a, points.b, points.d], points.a, points.b)
    expect(detail).not.toBeNull()
    expect(detail?.interiorDegrees).toBeCloseTo(150, 6)
  })

  it("refuses a non-positive side or a dihedral outside (0,180)", () => {
    expect(constructDihedralTriangle({ ab: 0, dihedralDegrees: 150 })).toBeNull()
    expect(constructDihedralTriangle({ ab: 2, dihedralDegrees: 180 })).toBeNull()
  })
})
