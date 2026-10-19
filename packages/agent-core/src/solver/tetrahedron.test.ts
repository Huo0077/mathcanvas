import { describe, expect, it } from "vitest"

import { constructTetrahedron, type TetrahedronMeasures } from "./tetrahedron"

/**
 * **六条棱长 → 四面体坐标**（2026-10-19，P1-1）。
 *
 * 模型的坐标心算是当前最大的失败来源（PB=2.08、PC=2.08 这类）。与其让它心算，
 * 不如对“六条棱都给了”的四面体直接解析构造；这里是纯数学层，核验仍由编译器负责。
 */

const MEASURES: TetrahedronMeasures = { ab: 2, ac: 2, bc: 2, pa: 2, pb: 2, pc: Math.sqrt(6) }

function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

describe("constructTetrahedron", () => {
  it("reconstructs a tetrahedron from all six edge lengths", () => {
    const points = constructTetrahedron(MEASURES)
    expect(points).not.toBeNull()
    if (points === null) return
    expect(distance(points.a, points.b)).toBeCloseTo(MEASURES.ab, 12)
    expect(distance(points.a, points.c)).toBeCloseTo(MEASURES.ac, 12)
    expect(distance(points.b, points.c)).toBeCloseTo(MEASURES.bc, 12)
    expect(distance(points.p, points.a)).toBeCloseTo(MEASURES.pa, 12)
    expect(distance(points.p, points.b)).toBeCloseTo(MEASURES.pb, 12)
    expect(distance(points.p, points.c)).toBeCloseTo(MEASURES.pc, 12)
  })

  it("refuses an impossible edge set instead of returning NaN coordinates", () => {
    expect(constructTetrahedron({ ...MEASURES, pa: 0.1, pb: 0.1 })).toBeNull()
  })

  it("refuses non-finite or non-positive lengths", () => {
    expect(constructTetrahedron({ ...MEASURES, bc: 0 })).toBeNull()
    expect(constructTetrahedron({ ...MEASURES, pc: Number.NaN })).toBeNull()
  })
})
