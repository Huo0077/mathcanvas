import { describe, expect, it } from "vitest"

import { allFinite, defaultNumericPolicy, nearlyEqual, nearlyZero, scaledTolerance } from "./numeric"

describe("numeric policy", () => {
  it("scales tolerance with operand magnitude", () => {
    expect(scaledTolerance([1, 2], defaultNumericPolicy)).toBeCloseTo(2e-11)
    expect(scaledTolerance([1e9, 2e9], defaultNumericPolicy)).toBeCloseTo(0.02)
  })

  it("compares small and large values consistently", () => {
    expect(nearlyEqual(1, 1 + 5e-12)).toBe(true)
    expect(nearlyEqual(1e9, 1e9 + 0.005)).toBe(true)
    expect(nearlyZero(5e-13, [1])).toBe(true)
  })

  it("rejects non-finite input", () => {
    expect(allFinite([0, 1, Number.NaN])).toBe(false)
    expect(() => scaledTolerance([Number.POSITIVE_INFINITY])).toThrow("numeric inputs must be finite")
  })

  it("freezes the default policy", () => {
    expect(Object.isFrozen(defaultNumericPolicy)).toBe(true)
  })
})
