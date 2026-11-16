import { describe, expect, it } from "vitest"

import { constructParameterizedPrism, constructRightPrism } from "./prism"

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

describe("P4 / T09 constructParameterizedPrism (right vs oblique preservation)", () => {
  const base = [
    { x: 0, y: 0, z: 0 },
    { x: 3, y: 0, z: 0 },
    { x: 3, y: 2, z: 0 },
    { x: 0, y: 2, z: 0 }
  ]

  it("constructs a right prism cleanly along base unit normal with aligned V_i -> V_i'", () => {
    const res = constructParameterizedPrism({ kind: "right", base, height: 4 })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.top).toHaveLength(4)
    for (let i = 0; i < 4; i += 1) {
      expect(res.top[i]!.x).toBeCloseTo(base[i]!.x, 9)
      expect(res.top[i]!.y).toBeCloseTo(base[i]!.y, 9)
      expect(res.top[i]!.z).toBeCloseTo(4, 9)
    }
    expect(res.signedVolume).toBeCloseTo(24, 9)
  })

  it("preserves oblique direction without coercing oblique prism into right prism", () => {
    const res = constructParameterizedPrism({ kind: "oblique", base, direction: { x: 1, y: 0.5, z: 4 } })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.top[0]).toEqual({ x: 1, y: 0.5, z: 4 })
    expect(res.signedVolume).toBeCloseTo(24, 9)

    // Rejects calling oblique prism without lateral tilt (or missing direction), and rejects passing oblique vector to kind: "right"
    const uprightMarkedOblique = constructParameterizedPrism({ kind: "oblique", base, direction: { x: 0, y: 0, z: 4 } })
    expect(uprightMarkedOblique.ok).toBe(false)

    const tiltedMarkedRight = constructParameterizedPrism({ kind: "right", base, height: 4, direction: { x: 1, y: 0, z: 4 } })
    expect(tiltedMarkedRight.ok).toBe(false)

    // Rejects zero-volume / coplanar lateral direction
    const flatTilt = constructParameterizedPrism({ kind: "oblique", base, direction: { x: 2, y: 1, z: 0 } })
    expect(flatTilt.ok).toBe(false)
  })
})
