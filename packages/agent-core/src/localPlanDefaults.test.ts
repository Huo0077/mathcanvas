import { describe, expect, it } from "vitest"

import { DEFAULT_SOLID_SEGMENTS } from "@draw/geometry-kernel"

import { roundFrustumChordError, roundFrustumPolyhedron } from "./localPlanDefaults"

/**
 * **圆台的多边形近似**（S4.3）。
 *
 * 判据一律从**返回的那组顶点**自己算 —— 不读内核的构造过程：
 * ① 顶点数 = 两环 `2N`，下底到中心轴等距 `R` 且同高，上底等距 `r` 且 `z + h`；
 * ② 面数 = `N + 2` 且每个侧面都是**四边形**（三角形的话那是圆锥）；
 * ③ **体积**与解析公式 `πh(R² + Rr + r²)/3` 相符，且多边形近似**略小**（< 2%）；
 * ④ 弦高误差 = `R(1 − cos(π/N))` —— 它就是"如实声明是近似"要交出去的那个数；
 * ⑤ 两个半径相等 ⇒ **构造失败要抛出来**（那是圆柱；静默画一只叫"圆台"的圆柱是不行的）。
 */
describe("roundFrustumPolyhedron", () => {
  const radiusBottom = 2
  const radiusTop = 1
  const height = 3

  it("returns two rings that really are circles' inscribed polygons, plus the chord error", () => {
    const shape = roundFrustumPolyhedron({ radiusBottom, radiusTop, height })
    const segments = DEFAULT_SOLID_SEGMENTS
    expect(shape.segments).toBe(segments)
    expect(shape.vertices).toHaveLength(segments * 2)
    for (const point of shape.vertices.slice(0, segments)) {
      expect(Math.hypot(point.x, point.y)).toBeCloseTo(radiusBottom, 9)
      expect(point.z).toBeCloseTo(0, 9)
    }
    for (const point of shape.vertices.slice(segments)) {
      expect(Math.hypot(point.x, point.y)).toBeCloseTo(radiusTop, 9)
      expect(point.z).toBeCloseTo(height, 9)
    }
    expect(shape.faces).toHaveLength(segments + 2)
    expect(shape.faces.filter((ring) => ring.length === 4)).toHaveLength(segments)
    expect(shape.chordError).toBeCloseTo(radiusBottom * (1 - Math.cos(Math.PI / segments)), 12)
  })

  it("has the volume of a frustum, slightly under the analytic value because the faces are flat", () => {
    const shape = roundFrustumPolyhedron({ radiusBottom, radiusTop, height })
    let total = 0
    for (const ring of shape.faces) {
      for (let index = 1; index + 1 < ring.length; index += 1) {
        const first = shape.vertices[ring[0]!]!
        const second = shape.vertices[ring[index]!]!
        const third = shape.vertices[ring[index + 1]!]!
        total += (first.x * (second.y * third.z - second.z * third.y) + first.y * (second.z * third.x - second.x * third.z) + first.z * (second.x * third.y - second.y * third.x)) / 6
      }
    }
    const analytic = Math.PI * height * (radiusBottom ** 2 + radiusBottom * radiusTop + radiusTop ** 2) / 3
    const volume = Math.abs(total)
    expect(volume).toBeLessThan(analytic)
    expect(analytic - volume).toBeLessThan(analytic * 0.02)
  })

  it("throws with the kernel's own reason when the two radii are equal, instead of quietly drawing a cylinder", () => {
    // 理由来自内核（`roundFrustumShape` 返回 null ⇒ 注册表那句），所以这里只钉"它说得出是圆柱"。
    expect(() => roundFrustumPolyhedron({ radiusBottom: 2, radiusTop: 2, height: 3 })).toThrow(/cylinder/)
  })

  /**
   * **弦高误差按两个半径里较大的那一个算**（2026-10-10，§3-F 的近似口径）。
   *
   * 原实现写死按**下底**半径算，并且理由写着"它是两个环里较大的那个风险" —— 那句话只在
   * `R下 > R上` 时成立。题面完全可以给一只**上底更大**的圆台（合法），那时按小的那一环报误差
   * 就是**少报**：用户据此判断"这张图够不够用"会被误导。
   *
   * 公式本身抽成 `roundFrustumChordError`，夹具那条路与编译期那条路共用一个真源。
   */
  it("measures the chord error at the larger of the two rings, and shares one formula", () => {
    const flipped = roundFrustumPolyhedron({ radiusBottom: 1, radiusTop: 2, height: 3 })
    expect(flipped.chordError).toBeCloseTo(roundFrustumChordError(2, DEFAULT_SOLID_SEGMENTS), 12)
    // 与"下底更大"那一版**同一个数**（只是环换了一个）—— 说明它真的取了较大的那个。
    const normal = roundFrustumPolyhedron({ radiusBottom: 2, radiusTop: 1, height: 3 })
    expect(flipped.chordError).toBeCloseTo(normal.chordError, 12)
  })
})
