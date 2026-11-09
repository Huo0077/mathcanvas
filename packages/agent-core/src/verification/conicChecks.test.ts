import { describe, expect, it } from "vitest"

import { checkEllipseVertexBound, checkHyperbolaFoot } from "./conicChecks"

/**
 * **W6-A：圆锥曲线的精确反例（2026-11-09）**。
 *
 * 两条必须钉住的机制：
 * ① 双曲线垂足**不是**"落在渐近线上"就够了 —— 还必须与焦点连线垂直；
 * ② 椭圆 `PB ≤ 2b` 这条全称结论只在 `e ≤ √2/2` 时成立；`a=2,b=1`（`e=√3/2`）必须被否证，
 *    `a=√2,b=1` 恰好是边界（成立）。
 */

describe("W6-A 双曲线焦点到渐近线的垂足", () => {
  it("supports the exact foot for a=3,b=4 and reports |OP| = 3", () => {
    const result = checkHyperbolaFoot({ a: 3, b: 4, point: { x: 9 / 5, y: 12 / 5 } })
    expect(result.decision).toBe("supported")
    expect(result.distance).toBeCloseTo(3, 12)
    expect(result.foot).toMatchObject({ x: 9 / 5, y: 12 / 5 })
    expect(result.reasonCodes).toContain("line_and_perpendicular")
  })

  it("refutes a point that lies on the asymptote but is not perpendicular", () => {
    // (3,4) 在渐近线 y=(4/3)x 上，但 F₂P 不与渐近线垂直 —— 必须否证。
    const result = checkHyperbolaFoot({ a: 3, b: 4, point: { x: 3, y: 4 } })
    expect(result.decision).toBe("refuted")
    expect(result.reasonCodes).toContain("not_perpendicular")
    expect(result.reasonCodes).not.toContain("not_on_asymptote")
    expect(result.residuals.perpendicular).toBeGreaterThan(1)
  })

  it("refutes an off-line point even when the perpendicular condition looks fine", () => {
    const result = checkHyperbolaFoot({ a: 3, b: 4, point: { x: 1, y: 0 } })
    expect(result.decision).toBe("refuted")
    expect(result.reasonCodes).toContain("not_on_asymptote")
  })

  it.each([
    [{ a: 0, b: 4, point: { x: 1, y: 1 } }],
    [{ a: 3, b: -4, point: { x: 1, y: 1 } }],
    [{ a: 3, b: 4, point: { x: Number.NaN, y: 1 } }]
  ])("returns unknown outside the declared domain (%o)", (input) => {
    expect(checkHyperbolaFoot(input).decision).toBe("unknown")
  })
})

describe("W6-A 椭圆顶点距离上界", () => {
  it("refutes 'all P satisfy PB ≤ 2b' when a=2,b=1 (e=√3/2)", () => {
    const result = checkEllipseVertexBound({ a: 2, b: 1 })
    expect(result.decision).toBe("refuted")
    expect(result.counterexample?.sinU).toBeCloseTo(-1 / 3, 12)
    expect(result.counterexample!.distance).toBeCloseTo(4 / Math.sqrt(3), 12)
    expect(result.counterexample!.distance).toBeGreaterThan(2)
  })

  it("supports the bound exactly at the boundary a=√2,b=1", () => {
    const result = checkEllipseVertexBound({ a: Math.SQRT2, b: 1 })
    expect(result.decision).toBe("supported")
    expect(result.maximum).toBeCloseTo(2, 12)
    expect(result.reasonCodes).toContain("bound_at_lower_vertex")
  })

  it("supports the bound for a small eccentricity", () => {
    expect(checkEllipseVertexBound({ a: 1.1, b: 1 }).decision).toBe("supported")
  })

  it("returns unknown outside the declared domain (a ≤ b or non-finite)", () => {
    expect(checkEllipseVertexBound({ a: 1, b: 1 }).decision).toBe("unknown")
    expect(checkEllipseVertexBound({ a: 2, b: 0 }).decision).toBe("unknown")
    expect(checkEllipseVertexBound({ a: Number.POSITIVE_INFINITY, b: 1 }).decision).toBe("unknown")
  })
})
