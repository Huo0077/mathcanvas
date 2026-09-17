import { describe, expect, it } from "vitest"

import { cylinderQuadric3, intersectPlaneQuadric3 } from "@draw/geometry-kernel"

import { MAX_CURVE_SEGMENTS, sampleClosedConic, sampleCurvePieces, sampleOpenCurve, segmentsForSagitta } from "./conicSampling"

const cylinder = { id: "cylinder-1", type: "cylinder" as const, center: { x: 0, y: 0, z: 0 }, radius: 2, height: 3, segments: 48 }
const plane = (normal: { x: number; y: number; z: number }, constant: number) => ({ normal, constant })
const degrees = (value: number) => (value * Math.PI) / 180

describe("screen-error driven curve sampling", () => {
  it("picks the segment count from the sagitta bound", () => {
    // 48 段的弦高上界正好是 R(1 − cos(π/48)) ⇒ 要满足它至少还得要 48 段（浮点边界可能给 49）。
    const tolerance = 2 * (1 - Math.cos(Math.PI / 48))
    expect(segmentsForSagitta(2, tolerance)).toBeGreaterThanOrEqual(48)
    expect(segmentsForSagitta(2, tolerance)).toBeLessThanOrEqual(49)

    // 单调：容差越松段数越少。
    expect(segmentsForSagitta(2, 0.5)).toBeLessThan(segmentsForSagitta(2, 0.01))
    // 上限与下限，绝不返回 NaN / 无穷。
    expect(segmentsForSagitta(2, 1e-12)).toBe(MAX_CURVE_SEGMENTS)
    expect(segmentsForSagitta(2, 1)).toBe(3)
    expect(segmentsForSagitta(0, 0.01)).toBe(3)
    expect(segmentsForSagitta(2, 0)).toBe(3)
    expect(segmentsForSagitta(2, Number.NaN)).toBe(3)
  })

  it("keeps every chord within tolerance on a circle", () => {
    const circle = intersectPlaneQuadric3(plane({ x: 0, y: 0, z: 1 }, -1), cylinderQuadric3(cylinder))
    const points = sampleClosedConic(circle, 0.01)

    // R=2、tol=0.01 ⇒ n = ceil(π / acos(1 − 0.005)) = 32 段（33 个点）。
    expect(points.length).toBeGreaterThanOrEqual(32)
    // 首尾重合（浮点残差量级），闭合折线一次画完。
    const first = points[0]
    const last = points[points.length - 1]
    expect(Math.hypot(last.x - first.x, last.y - first.y, last.z - first.z)).toBeLessThan(1e-12)
    for (let index = 0; index < points.length - 1; index += 1) {
      const first = points[index]
      const second = points[index + 1]
      const middle = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2, z: (first.z + second.z) / 2 }
      // 中点离真圆（中心 (0,0,1)、半径 2）的距离必须小于容差。
      expect(Math.abs(Math.hypot(middle.x, middle.y) - 2)).toBeLessThan(0.01)
    }
  })

  it("uses the largest radius of curvature on an ellipse, not the semi-major axis", () => {
    // 30° 斜切：a = 2/cos30 = 2.309、b = 2，最大曲率半径 = a²/b = 2.667 > a。
    const ellipse = intersectPlaneQuadric3(plane({ x: Math.sin(degrees(30)), y: 0, z: Math.cos(degrees(30)) }, 0), cylinderQuadric3(cylinder))
    const points = sampleClosedConic(ellipse, 0.02)
    const naive = segmentsForSagitta(ellipse.semiMajor!, 0.02)

    expect(points.length).toBeGreaterThan(naive)   // 保守取最大曲率半径 ⇒ 段数更多
    for (let index = 0; index < points.length - 1; index += 1) {
      const first = points[index]
      const second = points[index + 1]
      const middle = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2, z: (first.z + second.z) / 2 }
      // 中点代回圆锥曲线方程，偏差随容差有界（用相对量级断言，不手算椭圆几何）。
      const scale = ellipse.semiMajor!
      expect(Math.abs(middle.x) / scale).toBeLessThan(2)
      expect(Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z)).toBeLessThan(scale)
    }
  })

  it("samples an open curve adaptively: every chord stays within tolerance and the gaps vary with curvature", () => {
    /**
     * 用 `y = x³`（`x` 就是参数）：它的二阶导 `6x` 随位置变，所以"弯的地方密、直的地方疏"是**真性质**。
     * （`y = x²` 不行：它的弦高偏差只取决于参数间隔、与位置无关，实测两种采样都会给均匀网格。）
     */
    const pointAt = (parameter: number) => ({ x: parameter, y: parameter * parameter * parameter, z: 0 })
    const points = sampleOpenCurve(pointAt, [-2, 2], 0.01)

    expect(points.length).toBeGreaterThan(8)
    expect(points[0]).toEqual({ x: -2, y: -8, z: 0 })
    expect(points[points.length - 1]).toEqual({ x: 2, y: 8, z: 0 })

    const gaps: number[] = []
    for (let index = 1; index < points.length; index += 1) {
      const first = points[index - 1]
      const second = points[index]
      gaps.push(second.x - first.x)
      // 参数严格递增，不来回跳。
      expect(second.x).toBeGreaterThan(first.x)
      // 中点偏差 ≤ 容差：解析上就是 (3/8)h²|2a + h|（h 是参数间隔、a 是起点）。
      const middle = (first.x + second.x) / 2
      expect(Math.abs(middle ** 3 - (first.y + second.y) / 2)).toBeLessThanOrEqual(0.01)
    }
    // 曲率随 |x| 增大 ⇒ 两端比中间密，网格**不均匀**。
    expect(Math.max(...gaps)).toBeGreaterThan(Math.min(...gaps))
  })

  it("reports nothing for degenerate inputs instead of inventing points", () => {
    expect(sampleClosedConic({ ...intersectPlaneQuadric3(plane({ x: 0, y: 1, z: 0 }, -3), cylinderQuadric3(cylinder)), kind: "empty", closed: false }, 0.01)).toEqual([])
    expect(sampleOpenCurve(() => null, [0, 1], 0.01)).toEqual([])
    expect(sampleCurvePieces([{ kind: "segment", a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 1, z: 1 } }], 0.01)).toEqual([{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }])
  })
})
