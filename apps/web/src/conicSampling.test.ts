import { describe, expect, it } from "vitest"

import { cylinderQuadric3, intersectPlaneQuadric3 } from "@draw/geometry-kernel"

import { MAX_CURVE_SEGMENTS, curveToleranceFor, sampleClosedConic, sampleCurvePieces, sampleOpenCurve, segmentsForSagitta, toleranceBucket } from "./conicSampling"

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

  it("samples a full-turn closed conic piece by the sagitta formula instead of subdividing a degenerate chord", () => {
    /**
     * 交面侧带的解析边界就是这样一个片段：`piecesFromRing` 把整圈网格顶点合成**一个** conic 片段、
     * 参数区间恰好是 `[0, 2π]`（见内核 `intersection-surfaces.ts`）。
     *
     * 这种片段不能走开曲线的自适应二分：首尾是同一点，弦是**退化的**（长度 0），采样点离这条弦
     * 差不多一整个半径 ⇒ 平坦度判据永远不满足，只能一路二分下去，而二分只能给出 **2 的幂**段数：
     * 弦高公式要 40 段时它给 64 段（多 60% 的点，参数间隔还不均匀）。闭曲线有闭式段数公式，直接用。
     */
    const circle = intersectPlaneQuadric3(plane({ x: 0, y: 0, z: 1 }, -1), cylinderQuadric3(cylinder))
    // tol = R(1 − cos(π/40)) ⇒ 公式正好要 40 段；二分只能给 2 的幂。
    const tolerance = 2 * (1 - Math.cos(Math.PI / 40))
    expect(segmentsForSagitta(2, tolerance)).toBe(40)

    const points = sampleCurvePieces([{ kind: "conic", conic: circle, parameterRange: [0, Math.PI * 2] }], tolerance)

    // 40 段、41 个点（首尾重合），一个都不多。
    expect(points).toHaveLength(41)
    expect(Math.hypot(points[0].x - points[points.length - 1].x, points[0].y - points[points.length - 1].y, points[0].z - points[points.length - 1].z)).toBeLessThan(1e-12)
    for (const point of points) {
      expect(Math.abs(Math.hypot(point.x, point.y) - 2)).toBeLessThan(1e-12)
      expect(point.z).toBeCloseTo(1, 12)
    }

    // 半圈（不是整圈）的片段仍然走自适应采样：开曲线的曲率沿参数变，固定段数不划算。
    const half = sampleCurvePieces([{ kind: "conic", conic: circle, parameterRange: [0, Math.PI] }], 0.01)
    expect(half.length).toBeGreaterThan(2)
    // 这半圈真的跨到**对径点**（相距 2R = 4），中途每个点都落在半径 2 上。
    // （末尾那个点是 `sampleCurvePieces` 给闭合环补的环首点，所以取所有点到起点的最大距离。）
    expect(Math.max(...half.map((point) => Math.hypot(point.x - half[0].x, point.y - half[0].y, point.z - half[0].z)))).toBeCloseTo(4, 9)
    for (const point of half) expect(Math.abs(Math.hypot(point.x, point.y) - 2)).toBeLessThan(1e-9)
  })

  it("reports nothing for degenerate inputs instead of inventing points", () => {
    expect(sampleClosedConic({ ...intersectPlaneQuadric3(plane({ x: 0, y: 1, z: 0 }, -3), cylinderQuadric3(cylinder)), kind: "empty", closed: false }, 0.01)).toEqual([])
    expect(sampleOpenCurve(() => null, [0, 1], 0.01)).toEqual([])
    expect(sampleCurvePieces([{ kind: "segment", a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 1, z: 1 } }], 0.01)).toEqual([{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }])
  })

  it("converts the pixel tolerance into world units and quantises it for hysteresis", () => {
    // fov 60°、距离 10、视口高 1000：每像素 2·10·tan30°/1000 = 0.011547 世界单位 ⇒ 0.5px = 0.0057735。
    expect(curveToleranceFor({ fov: 60 }, 10, 1000)).toBeCloseTo(0.5 * 2 * 10 * Math.tan(Math.PI / 6) / 1000, 12)
    // 拉远一倍 ⇒ 容差翻倍；拉近 ⇒ 变小。这正是"段数跟着缩放走"的来源。
    expect(curveToleranceFor({ fov: 60 }, 20, 1000)).toBeCloseTo(2 * curveToleranceFor({ fov: 60 }, 10, 1000), 12)
    expect(curveToleranceFor({ fov: 60 }, 5, 1000)).toBeLessThan(curveToleranceFor({ fov: 60 }, 10, 1000))
    // 视口为 0 或距离非有限时不返回 NaN/0。
    expect(curveToleranceFor({ fov: 60 }, 10, 0)).toBeGreaterThan(0)
    expect(curveToleranceFor({ fov: 60 }, Number.NaN, 1000)).toBeGreaterThan(0)

    // 滞回：容差量化到 2 的幂，缩放不到一档就不触发重建。
    // 2^-8 = 0.00390625 这一档覆盖 (0.001953125, 0.00390625]：0.002 与 0.0035 同档；0.02 落到 2^-5。
    expect(toleranceBucket(0.002)).toBe(toleranceBucket(0.0035))
    expect(toleranceBucket(0.002)).toBeLessThan(toleranceBucket(0.02))
    expect(toleranceBucket(0)).toBe(1)
    expect(toleranceBucket(Number.NaN)).toBe(1)
  })
})
