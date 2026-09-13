import { describe, expect, it } from "vitest"

import { numericalDerivative, numericalIntegral, sampleFunction, sampleFunctionSegments } from "./calculus"

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
})
