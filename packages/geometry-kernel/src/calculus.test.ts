import { describe, expect, it } from "vitest"

import { adaptiveSampleFunctionSegments, numericalDerivative, numericalIntegral, sampleFunction, sampleFunctionSegments } from "./calculus"

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

  it("adds samples around a narrow feature without inventing a discontinuity", () => {
    const segments = adaptiveSampleFunctionSegments((x) => 10 * Math.exp(-10000 * (x - 0.0625) ** 2), [0, 0.5], { initialSteps: 4, maxSteps: 64 })

    expect(segments).toHaveLength(1)
    expect(segments[0].some((point) => Math.abs(point.x - 0.0625) < 0.01 && point.y > 9)).toBe(true)
  })
})
