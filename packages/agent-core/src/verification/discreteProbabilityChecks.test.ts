import { describe, expect, it } from "vitest"

import {
  checkDrawProbability,
  combinations,
  exactProbability,
  reduceFraction
} from "./discreteProbabilityChecks"
import { checkRightTriangle } from "./planeGeometryChecks"

/**
 * **W6-D：有限概率与平面基础（2026-11-09）**。
 *
 * 三条机制：
 * ① 精确约分（`bigint`，不用浮点）；越界/零总数被拒绝；
 * ② 有放回与无放回是**两种模型**（3红2蓝取2全红：3/10 vs 9/25）；
 * ③ 只有题面条件真的绑定过才可能支持/否证，否则 `unknown`。
 */

describe("W6-D 精确概率", () => {
  it("reduces a fair die's even outcomes to 1/2", () => {
    expect(exactProbability(6n, 3n)).toEqual({ numerator: 1n, denominator: 2n })
  })

  it("refuses a zero sample space and an out-of-range favorable count", () => {
    expect(() => exactProbability(0n, 0n)).toThrow(RangeError)
    expect(() => exactProbability(6n, 7n)).toThrow(RangeError)
    expect(() => exactProbability(6n, -1n)).toThrow(RangeError)
  })

  it("computes combinations exactly for big values", () => {
    expect(combinations(5n, 2n)).toBe(10n)
    expect(combinations(3n, 2n)).toBe(3n)
    expect(combinations(100n, 3n)).toBe(161700n)
    expect(combinations(2n, 3n)).toBe(0n)
  })

  it("normalises a negative denominator instead of changing the value", () => {
    expect(reduceFraction({ numerator: -6n, denominator: -8n })).toEqual({ numerator: 3n, denominator: 4n })
    expect(() => reduceFraction({ numerator: 1n, denominator: 0n })).toThrow(RangeError)
  })
})

describe("W6-D 无放回与有放回不能混用", () => {
  const without = { red: 3, blue: 2, draws: 2, replacement: "without" as const }
  const withReplacement = { red: 3, blue: 2, draws: 2, replacement: "with" as const }

  it("supports 3/10 for drawing two reds without replacement", () => {
    const result = checkDrawProbability({ condition: without, candidate: { numerator: 3n, denominator: 10n }, boundToProblem: true })
    expect(result.decision).toBe("supported")
    expect(result.expected).toEqual({ numerator: 3n, denominator: 10n })
  })

  it("refutes 9/25 (the with-replacement answer) for a without-replacement question", () => {
    const result = checkDrawProbability({ condition: without, candidate: { numerator: 9n, denominator: 25n }, boundToProblem: true })
    expect(result.decision).toBe("refuted")
    expect(result.candidate).not.toEqual(result.expected)
  })

  it("accepts 9/25 only when the question is with replacement", () => {
    expect(checkDrawProbability({ condition: withReplacement, candidate: { numerator: 9n, denominator: 25n }, boundToProblem: true }).decision).toBe("supported")
  })

  it("stays unknown when the conditions were never bound to the problem text", () => {
    const result = checkDrawProbability({ condition: without, candidate: { numerator: 3n, denominator: 10n }, boundToProblem: false })
    expect(result.decision).toBe("unknown")
    expect(result.reasonCodes).toContain("conditions_not_bound")
  })

  it("stays unknown for an impossible draw count and a malformed candidate", () => {
    expect(checkDrawProbability({ condition: { ...without, draws: 9 }, candidate: { numerator: 1n, denominator: 2n }, boundToProblem: true }).decision).toBe("unknown")
    expect(checkDrawProbability({ condition: without, candidate: { numerator: 1n, denominator: 0n }, boundToProblem: true }).decision).toBe("unknown")
  })
})

describe("W6-D 直角三角形面积", () => {
  const triangle = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 4 }] as const

  it("supports the exact area 6 and refutes 12", () => {
    const supported = checkRightTriangle(triangle, 6)
    expect(supported.decision).toBe("supported")
    expect(supported.area).toBeCloseTo(6, 12)
    expect(checkRightTriangle(triangle, 12).decision).toBe("refuted")
  })

  it("returns unknown for a non-right triangle instead of applying ½·base·height", () => {
    const result = checkRightTriangle([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }], 0.5)
    expect(result.decision).toBe("unknown")
    expect(result.reasonCodes).toContain("not_right_triangle")
  })

  it("returns unknown for a degenerate triangle and a non-finite candidate", () => {
    expect(checkRightTriangle([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 3, y: 4 }], 6).decision).toBe("unknown")
    expect(checkRightTriangle([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 6, y: 0 }], 0).decision).toBe("unknown")
    expect(checkRightTriangle(triangle, Number.NaN).decision).toBe("unknown")
  })
})
