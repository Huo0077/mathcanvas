import { describe, expect, it } from "vitest"
import { searchFoldAngles } from "./rotation3d"

// These expectations are hand-picked roots, not derived through the search implementation.
describe("bounded fold-relation search", () => {
  it("finds both sign-changing branches and verifies their residuals", () => {
    const outcome = searchFoldAngles(angle => (angle - 67) * (angle - 143))
    expect(outcome.status).toBe("solved")
    expect(outcome.degrees).toHaveLength(2)
    expect(outcome.degrees[0]).toBeCloseTo(67, 5)
    expect(outcome.degrees[1]).toBeCloseTo(143, 5)
    expect(outcome.complete).toBe(false)
  })

  it("does not describe a missed tangential root as proof of impossibility", () => {
    const outcome = searchFoldAngles(angle => (angle - 67.123) ** 2)
    expect(outcome.status).toBe("not-found")
    expect(outcome.complete).toBe(false)
    expect(outcome.termination).toBe("sampled")
  })

  it("never accepts a sign change across a pole as a root", () => {
    const outcome = searchFoldAngles(angle => 1 / (angle - 91.234))
    expect(outcome.status).toBe("not-found")
    expect(outcome.degrees).toEqual([])
  })

  it("treats nonfinite intervals as unmeasurable, not as roots", () => {
    const outcome = searchFoldAngles(() => Number.NaN)
    expect(outcome.status).toBe("not-found")
    expect(outcome.complete).toBe(false)
  })

  it("stops before the next evaluation would exceed the budget", () => {
    let calls = 0
    const outcome = searchFoldAngles(angle => { calls += 1; return angle - 67 }, { maxEvaluations: 7 })
    expect(calls).toBe(7)
    expect(outcome.evaluations).toBe(7)
    expect(outcome.termination).toBe("budget-exhausted")
    expect(outcome.status).toBe("not-found")
  })

  it.each([
    { maxEvaluations: NaN }, { maxEvaluations: 0 }, { maxEvaluations: 1.5 },
    { minimumDegrees: 90, maximumDegrees: 30 }, { maximumDegrees: Infinity },
    { residualTolerance: -1 }, { residualTolerance: 0 }, { segments: 0 }, { segments: 1.5 }
  ])("rejects invalid limits without evaluating: %j", options => {
    let calls = 0
    const outcome = searchFoldAngles(() => { calls += 1; return 0 }, options)
    expect(outcome.status).toBe("invalid-input")
    expect(calls).toBe(0)
  })

  it("excludes the unfolded lower endpoint but permits the upper endpoint", () => {
    expect(searchFoldAngles(angle => angle).status).toBe("not-found")
    expect(searchFoldAngles(angle => angle - 180).degrees).toEqual([180])
  })
})
