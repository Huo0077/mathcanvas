import { describe, expect, it } from "vitest"
import { solveFoldSystem } from "./foldSystem"

describe("joint fold-angle numerical search", () => {
  it("solves coupled nonlinear equations in two angles, preserving multiple branches", () => {
    const result = solveFoldSystem(([a, b]) => [a! + b! - 150, a! * b! - 5000], [90, 90])
    expect(result.status).toBe("solved")
    expect(result.complete).toBe(false)
    expect(result.degrees.some(([a, b]) => Math.abs(a! - 50) < 1e-3 && Math.abs(b! - 100) < 1e-3)).toBe(true)
    expect(result.degrees.some(([a, b]) => Math.abs(a! - 100) < 1e-3 && Math.abs(b! - 50) < 1e-3)).toBe(true)
  })
  it("solves three jointly constrained angles", () => {
    const result = solveFoldSystem(([a, b, c]) => [a! + b! + c! - 180, a! - b! + c! - 60, 2 * a! + b! - c! - 30], [90, 90, 90])
    expect(result.status).toBe("solved")
    expect(result.degrees[0]?.[0]).toBeCloseTo(30, 3)
    expect(result.degrees[0]?.[1]).toBeCloseTo(60, 3)
    expect(result.degrees[0]?.[2]).toBeCloseTo(90, 3)
  })
  it("does not pretend dependent or missing constraints determine both angles", () => {
    expect(solveFoldSystem(([a]) => [a! - 60], [90, 90]).status).toBe("underdetermined")
    expect(solveFoldSystem(([a, b]) => [a! + b! - 120, 2 * (a! + b! - 120)], [70, 50]).status).toBe("underdetermined")
  })
  it("does not call a failed finite search proof of impossibility", () => {
    const result = solveFoldSystem(([a, b]) => [a! + b! + 1, a! - b!], [60, 90], { maxEvaluations: 80 })
    expect(result.status).toBe("not-found")
    expect(result.complete).toBe(false)
    expect(result.evaluations).toBeLessThanOrEqual(80)
  })
  it("honors evaluation, cancellation, time and nonfinite-data boundaries", () => {
    let calls = 0
    const budget = solveFoldSystem(() => { calls += 1; return [NaN, Infinity] }, [90, 90], { maxEvaluations: 7 })
    expect(calls).toBe(7)
    expect(budget.termination).toBe("budget-exhausted")
    expect(solveFoldSystem(() => [0, 0], [90, 90], { shouldStop: () => true }).status).toBe("cancelled")
    let time = 0
    expect(solveFoldSystem(() => [1, 1], [90, 90], { now: () => time++, timeoutMs: 1 }).termination).toBe("timeout")
    expect(solveFoldSystem(() => [0], [90], { maxEvaluations: 0 }).status).toBe("invalid-input")
  })
})
