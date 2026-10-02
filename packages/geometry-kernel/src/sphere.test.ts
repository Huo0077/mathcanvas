import { describe, expect, it } from "vitest"

import { conic3PointAt } from "./quadrics"
import { spherePlaneSection3 } from "./sphere"

/**
 * 球 ∩ 平面（实施计划 Task 2）。
 *
 * 判据不是"数看着圆"，而是两件事同时成立：
 * ① **交圆上的点真的落在球面上**（`|X − C|² = r²`，逐点残差接近 0）；
 * ② **退化分类按模型尺度判定**（相对容差），不是拿一个绝对阈值去卡。
 *
 * 第 ② 条是这一片最容易被"顺手写个 1e-9"毁掉的地方：同一个 1e-12 的绝对间隙，在半径 1e-6 的球上
 * 是"真的没碰上"，在半径 1e6 的球上却是"数值噪声、就是相切"。下面两个方向各有一条用例钉住。
 */

const SPHERE = { center: { x: 1, y: 2, z: 3 }, radius: 5 }
const plane = (normal: { x: number; y: number; z: number }, constant: number) => ({ normal, constant })

/** `|X − C|² − r²`：交圆上的点代进去必须接近 0（不是"坐标看起来是整数"）。 */
function sphereResidual(point: { x: number; y: number; z: number }, sphere = SPHERE): number {
  return Math.abs(
    (point.x - sphere.center.x) ** 2 + (point.y - sphere.center.y) ** 2 + (point.z - sphere.center.z) ** 2 - sphere.radius * sphere.radius
  )
}

describe("exact sphere ∩ plane", () => {
  it("cuts a perpendicular circle and puts every sampled point on the sphere", () => {
    const result = spherePlaneSection3(SPHERE, plane({ x: 0, y: 0, z: 1 }, -6))

    expect(result.kind).toBe("circle")
    if (result.kind !== "circle") return
    // z = 6 截 C=(1,2,3)、r=5：圆心 (1,2,6)、半径 √(25−9) = 4
    expect(result.center).toEqual({ x: 1, y: 2, z: 6 })
    expect(result.radius).toBeCloseTo(4, 12)
    expect(result.conic.kind).toBe("circle")
    expect(result.conic.center).toEqual({ x: 1, y: 2, z: 6 })
    expect(result.conic.semiMajor).toBeCloseTo(4, 12)
    expect(result.conic.semiMinor).toBeCloseTo(4, 12)
    expect(result.conic.eccentricity).toBe(0)
    expect(result.conic.closed).toBe(true)
    // 平面标架里的系数 s² + t² = 16 —— 就是"半径 4 的圆"，不是折线拟合出来的东西。
    expect(result.conic.coefficients).toEqual([1, 0, 1, 0, 0, -16])
    // 交圆**整条**都在球面上：这是"解析"二字的实质，采样点逐个代回球面方程。
    for (let step = 0; step < 16; step += 1) {
      const point = conic3PointAt(result.conic, (step / 16) * Math.PI * 2)
      expect(point).not.toBeNull()
      expect(sphereResidual(point!)).toBeLessThan(1e-9)
    }
  })

  it("returns the whole circle as one closed [0, 2π] piece because a ball has no caps to clip against", () => {
    const result = spherePlaneSection3(SPHERE, plane({ x: 0, y: 0, z: 1 }, -6))

    expect(result.kind).toBe("circle")
    if (result.kind !== "circle") return
    expect(result.loops).toHaveLength(1)
    expect(result.loops[0]).toHaveLength(1)
    const piece = result.loops[0][0]
    expect(piece.kind).toBe("conic")
    if (piece.kind !== "conic") return
    expect(piece.parameterRange).toEqual([0, Math.PI * 2])
  })

  it("cuts a great circle through the centre with radius equal to the sphere radius", () => {
    const result = spherePlaneSection3(SPHERE, plane({ x: 0, y: 0, z: 1 }, -3))

    expect(result.kind).toBe("circle")
    if (result.kind !== "circle") return
    expect(result.center).toEqual({ x: 1, y: 2, z: 3 })
    expect(result.radius).toBeCloseTo(5, 12)
  })

  it("reports a single tangent point exactly at z = 8", () => {
    const result = spherePlaneSection3(SPHERE, plane({ x: 0, y: 0, z: 1 }, -8))

    expect(result.kind).toBe("point")
    if (result.kind !== "point") return
    expect(result.point).toEqual({ x: 1, y: 2, z: 8 })
    // 切点必须**在球面上**（残差 0），不是"离球心差不多 r"。
    expect(sphereResidual(result.point)).toBeLessThan(1e-9)
  })

  it("reports no intersection at z = 9 and does not leak the previous circle", () => {
    const result = spherePlaneSection3(SPHERE, plane({ x: 0, y: 0, z: 1 }, -9))

    expect(result.kind).toBe("empty")
    if (result.kind !== "empty") return
    expect(result).not.toHaveProperty("radius")
    expect(result).not.toHaveProperty("conic")
  })

  it("treats a non-unit normal with the proportionally scaled constant as the same plane", () => {
    const unit = spherePlaneSection3(SPHERE, plane({ x: 0, y: 0, z: 1 }, -6))
    const scaled = spherePlaneSection3(SPHERE, plane({ x: 0, y: 0, z: 2 }, -12))

    expect(scaled.kind).toBe("circle")
    if (scaled.kind !== "circle" || unit.kind !== "circle") return
    // 只把法向归一化而不同步缩放常数，会把这个平面整体挪走（在球上正好是"切歪"）。
    expect(scaled.center).toEqual(unit.center)
    expect(scaled.radius).toBeCloseTo(unit.radius, 12)
  })

  it("treats an oblique plane by its signed distance, not by any axis-aligned special case", () => {
    // n = (1,1,1)（|n| = √3），n·C = 1+2+3 = 6。
    // 过球心 ⇒ 6 + constant = 0 ⇒ constant = −6；此时是大圆，半径仍是 5。
    const throughCentre = spherePlaneSection3(SPHERE, plane({ x: 1, y: 1, z: 1 }, -6))
    expect(throughCentre.kind).toBe("circle")
    if (throughCentre.kind !== "circle") return
    expect(throughCentre.radius).toBeCloseTo(5, 12)
    expect(throughCentre.center).toEqual({ x: 1, y: 2, z: 3 })
    // 斜截圆半径 3 ⇒ 球心到平面 4 ⇒ (6 + constant)/√3 = 4 ⇒ constant = 4√3 − 6。
    const oblique = spherePlaneSection3(SPHERE, plane({ x: 1, y: 1, z: 1 }, 4 * Math.sqrt(3) - 6))
    expect(oblique.kind).toBe("circle")
    if (oblique.kind !== "circle") return
    expect(oblique.radius).toBeCloseTo(3, 12)
    expect(oblique.distance).toBeCloseTo(4, 12)
    for (let step = 0; step < 16; step += 1) {
      const point = conic3PointAt(oblique.conic, (step / 16) * Math.PI * 2)
      expect(sphereResidual(point!)).toBeLessThan(1e-9)
    }
  })

  describe("scale-aware degeneracy (the same absolute gap means different things on different models)", () => {
    const origin = { center: { x: 0, y: 0, z: 0 } }
    const atDistance = (distance: number) => plane({ x: 0, y: 0, z: 1 }, distance)

    it("calls a 1e-12 absolute gap on a 1e-6 sphere a real gap, not a tangency", () => {
      // 相对间隙 1e-6（远大于数值噪声）：真的没碰上。绝对阈值 1e-9 会在这里误报"相切"。
      const result = spherePlaneSection3({ ...origin, radius: 1e-6 }, atDistance(1e-6 * (1 + 1e-6)))
      expect(result.kind).toBe("empty")
    })

    it("calls a 1e-6 absolute gap on a 1e6 sphere numerical noise, so it is a tangency", () => {
      // 相对间隙 1e-12（在双精度噪声量级）：就是相切。绝对阈值 1e-9 会在这里误报"不相交"。
      const result = spherePlaneSection3({ ...origin, radius: 1e6 }, atDistance(1e6 * (1 + 1e-12)))
      expect(result.kind).toBe("point")
    })
  })

  describe("rejects invalid input instead of inventing a section", () => {
    it("rejects a zero normal", () => {
      const result = spherePlaneSection3(SPHERE, plane({ x: 0, y: 0, z: 0 }, -6))
      expect(result.kind).toBe("invalid")
      if (result.kind !== "invalid") return
      expect(result.code).toBe("invalid_plane")
    })

    it("rejects a non-finite normal and a non-finite constant", () => {
      expect(spherePlaneSection3(SPHERE, plane({ x: 0, y: 0, z: Number.NaN }, -6)).kind).toBe("invalid")
      expect(spherePlaneSection3(SPHERE, plane({ x: 0, y: 0, z: 1 }, Number.POSITIVE_INFINITY)).kind).toBe("invalid")
    })

    it("rejects a zero, negative or non-finite radius", () => {
      for (const radius of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const result = spherePlaneSection3({ center: SPHERE.center, radius }, plane({ x: 0, y: 0, z: 1 }, -6))
        expect(result.kind, `radius=${radius}`).toBe("invalid")
        if (result.kind !== "invalid") continue
        expect(result.code).toBe("invalid_sphere")
      }
    })

    it("rejects a non-finite centre", () => {
      const result = spherePlaneSection3({ center: { x: 1, y: Number.NaN, z: 3 }, radius: 5 }, plane({ x: 0, y: 0, z: 1 }, -6))
      expect(result.kind).toBe("invalid")
    })
  })
})
