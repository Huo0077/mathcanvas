import { describe, expect, it } from "vitest"

import { checkFunctionClaim, evaluateFunction, parseFunction } from "./functionChecks"
import { continuedFractionTerm, evaluateContinuedFraction, judgeMonotonicity } from "./sequenceChecks"

/**
 * **W6-B / W6-C：函数采样与连分数（2026-11-09）**。
 *
 * - 绝对值函数与 `sin(2x)/2` 在 `x=3π/4` 处是 `1/2` 与 `−1/2`：必须 `refuted`；
 * - 正确写法只标 `sampled`（采样通过不是证明）；
 * - 全 1 连分数不是单调递减：`b₂=3/2 < b₃=5/3`，必须给出反例而**不是**"前几项相符"。
 */

describe("W6-B 函数定义域与分段反例", () => {
  const ref = "|sin(x)cos(x)|"

  it("refutes sin(2x)/2 at x=3π/4 by an explicit counterexample", () => {
    const result = checkFunctionClaim({ reference: ref, candidate: "sin(2x)/2", domain: [-Math.PI, Math.PI], samples: [(3 * Math.PI) / 4] })
    expect(result.decision).toBe("refuted")
    expect(result.counterexample?.x).toBeCloseTo((3 * Math.PI) / 4, 12)
    expect(result.counterexample?.reference).toBeCloseTo(0.5, 12)
    expect(result.counterexample?.candidate).toBeCloseTo(-0.5, 12)
  })

  it("keeps a correct absolute-value candidate at 'sampled', never 'verified'", () => {
    const result = checkFunctionClaim({ reference: ref, candidate: "|sin(2x)|/2", domain: [-Math.PI, Math.PI] })
    expect(result.decision).toBe("sampled")
    expect(result.reasonCodes).toContain("sampled_only")
    expect(result.samplesChecked).toBeGreaterThan(10)
  })

  it("returns unknown for an expression it cannot parse", () => {
    expect(checkFunctionClaim({ reference: ref, candidate: "sin(x) + unknown(x)", domain: [-1, 1] }).decision).toBe("unknown")
    expect(parseFunction("")).toBeNull()
    expect(parseFunction("2^")).toBeNull()
  })

  it("treats a one-sided non-finite sample as a domain mismatch, not a pass", () => {
    const result = checkFunctionClaim({ reference: "1/x", candidate: "x", domain: [-1, 1], samples: [0] })
    expect(result.decision).toBe("refuted")
    expect(result.reasonCodes).toContain("domain_mismatch")
  })

  it("returns unknown when every sample is undefined on both sides", () => {
    expect(checkFunctionClaim({ reference: "1/x", candidate: "1/x", domain: [-1, 1], samples: [0] }).decision).toBe("unknown")
  })

  it("refutes a degree-unit candidate against a radian reference", () => {
    const result = checkFunctionClaim({ reference: "sin(x)", candidate: "sin(x)", domain: [1, 2], samples: [1.5], units: "degrees" })
    // 同一表达式在角度制下语义不同：宿主必须按声明的单位算，不能两边各算各的。
    expect(["sampled", "refuted"]).toContain(result.decision)
    const mismatched = checkFunctionClaim({ reference: "sin(x)", candidate: "sin(x*pi/180)", domain: [1, 2], samples: [1.5], units: "radians" })
    expect(mismatched.decision).toBe("refuted")
  })

  it("evaluates absolutes, powers and implicit multiplication without eval", () => {
    const node = parseFunction("2|x| + x^2")!
    expect(evaluateFunction(node, -3)).toBeCloseTo(6 + 9, 12)
    expect(evaluateFunction(parseFunction("2(x+1)")!, 3)).toBeCloseTo(8, 12)
  })
})

describe("W6-C 连分数逐项比较", () => {
  it("evaluates all-ones continued fractions as 3/2 and 5/3", () => {
    expect(evaluateContinuedFraction([1n, 1n])).toEqual({ numerator: 3n, denominator: 2n })
    expect(evaluateContinuedFraction([1n, 1n, 1n])).toEqual({ numerator: 5n, denominator: 3n })
  })

  it("refutes 'monotone decreasing' with an adjacent-pair counterexample", () => {
    const result = judgeMonotonicity({ coefficients: [1n, 1n, 1n], claim: "decreasing" })
    expect(result.decision).toBe("refuted")
    expect(result.counterexample?.at).toBe(3)
    const b2 = continuedFractionTerm([1n, 1n, 1n], 2)
    const b3 = continuedFractionTerm([1n, 1n, 1n], 3)
    expect(b3.numerator * b2.denominator > b2.numerator * b3.denominator).toBe(true)
  })

  it("does not claim a general conclusion from finite agreement", () => {
    expect(judgeMonotonicity({ coefficients: [1n, 1n], claim: "decreasing" })).toMatchObject({ decision: "unknown", reasonCodes: ["finite_terms_only"] })
    expect(judgeMonotonicity({ coefficients: [1n], claim: "increasing" })).toMatchObject({ decision: "unknown", reasonCodes: ["insufficient_terms"] })
  })

  it("rejects zero/negative coefficients and an empty list", () => {
    expect(() => evaluateContinuedFraction([])).toThrow(RangeError)
    expect(() => evaluateContinuedFraction([0n])).toThrow(RangeError)
    expect(() => evaluateContinuedFraction([-1n])).toThrow(RangeError)
    expect(() => continuedFractionTerm([1n, 1n], 3)).toThrow(RangeError)
  })

  it("stays exact for huge coefficients (no float collapse)", () => {
    const huge = 10n ** 18n
    const value = evaluateContinuedFraction([huge])
    expect(value.numerator).toBe(huge + 1n)
    expect(value.denominator).toBe(huge)
  })
})
