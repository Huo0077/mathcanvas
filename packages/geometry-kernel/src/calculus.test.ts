import { describe, expect, it } from "vitest"

import { adaptiveSampleFunctionSegments, findExtrema, findInflectionPoints, findZeros, numericalDerivative, numericalIntegral, numericalIntegralWithDiagnostics, numericalSecondDerivative, sampleFunction, sampleFunctionSegments } from "./calculus"

describe("calculus numerical MVP", () => {
  it("samples functions and estimates derivatives and integrals", () => {
    expect(sampleFunction((x) => x * x, [-1, 1], 4)).toHaveLength(5)
    expect(numericalDerivative((x) => x * x, 3)).toBeCloseTo(6, 3)
    expect(numericalIntegral((x) => x, [0, 2], 100)).toBeCloseTo(2, 4)
  })

  it("keeps discontinuous function samples in separate segments", () => {
    const segments = sampleFunctionSegments((x) => x === 0 ? Number.NaN : 1 / x, [-1, 1], 4)

    expect(segments).toEqual([
      [{ x: -1, y: -1 }, { x: -0.5, y: -2 }],
      [{ x: 0.5, y: 2 }, { x: 1, y: 1 }]
    ])
  })

  it("splits a vertical asymptote that falls between finite samples", () => {
    const segments = sampleFunctionSegments((x) => 1 / (x - 0.1), [-1, 1], 4)

    expect(segments).toHaveLength(2)
    expect(segments[0].at(-1)?.x).toBe(0)
    expect(segments[1][0].x).toBe(0.5)
  })

  it("keeps a continuous narrow peak in one sampled segment", () => {
    const segments = sampleFunctionSegments((x) => 10 * Math.exp(-10000 * (x - 0.0625) ** 2), [0, 0.5], 4)

    expect(segments).toHaveLength(1)
  })

  /**
   * 体检发现的真缺陷：公开的 `sampleFunctionSegments` **不校验** `steps`（同一个文件里的
   * `adaptiveSampleFunctionSegments` 与 `numericalDerivative` 都校验）。`steps = 0` 会算出 `x = NaN`、
   * 采样全被丢掉 → 返回空（"这条函数没有图像"而不是"采样参数不对"）；负数 / NaN 同样静默返回空；
   * 而 `steps = 1e9` 会真的跑十亿次求值。
   */
  it("normalises the step count instead of returning NaN samples or looping forever", () => {
    const line = (x: number) => x

    for (const steps of [0, -5, Number.NaN, 0.4]) {
      const segments = sampleFunctionSegments(line, [0, 1], steps)
      const points = segments.flat()
      expect(points.length, `steps=${steps}`).toBeGreaterThan(1)
      expect(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true)
      expect(points[0].x).toBe(0)
      expect(points.at(-1)!.x).toBe(1)
    }

    // 荒谬的巨大步数被夹到上限（不会真的去跑十亿次求值）。
    expect(sampleFunctionSegments(line, [0, 1], 1e9).flat().length).toBeLessThanOrEqual(4097)
    // 非有限定义域：明确的空结果，不产生 NaN 坐标。
    expect(sampleFunctionSegments(line, [Number.NaN, 1], 4)).toEqual([])
    expect(sampleFunction(line, [0, 1], 0).length).toBeGreaterThan(1)
  })

  it("adds samples around a narrow feature without inventing a discontinuity", () => {
    const segments = adaptiveSampleFunctionSegments((x) => 10 * Math.exp(-10000 * (x - 0.0625) ** 2), [0, 0.5], { initialSteps: 4, maxSteps: 64 })

    expect(segments).toHaveLength(1)
    expect(segments[0].some((point) => Math.abs(point.x - 0.0625) < 0.01 && point.y > 9)).toBe(true)
  })

  it("estimates second derivatives and reports undefined neighborhoods", () => {
    expect(numericalSecondDerivative((x) => x ** 3, 2)).toBeCloseTo(12, 3)
    expect(numericalDerivative((x) => x < 0 ? Number.NaN : x, 0)).toBeNaN()
    expect(numericalSecondDerivative((x) => x < 0 ? Number.NaN : x, 0)).toBeNaN()
  })

  it("finds approximate zeros, extrema, and inflection points", () => {
    expect(findZeros((x) => x ** 2 - 1, [-2, 2], 64).map((point) => point.x)).toEqual([-1, 1])
    expect(findExtrema((x) => x ** 2, [-2, 2], 64)).toEqual([expect.objectContaining({ kind: "minimum", x: 0, approximate: true })])
    expect(findExtrema((x) => -(x ** 2), [-2, 2], 64)).toEqual([expect.objectContaining({ kind: "maximum", x: 0, approximate: true })])
    expect(findInflectionPoints((x) => x ** 3, [-2, 2], 64)).toEqual([expect.objectContaining({ kind: "inflection", x: 0, approximate: true })])
  })

  it("reports explicit statuses for numerical integration", () => {
    expect(numericalIntegralWithDiagnostics((x) => x ** 2, [0, 1], 64)).toMatchObject({ status: "approximate", value: expect.closeTo(1 / 3, 0.001), steps: 64 })
    expect(numericalIntegralWithDiagnostics((x) => x === 0 ? Number.NaN : x, [0, 1], 64)).toMatchObject({ status: "undefined", value: null })
  })
})
