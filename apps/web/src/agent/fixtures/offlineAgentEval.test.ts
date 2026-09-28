import { describe, expect, it } from "vitest"

import { runOfflineAgentEval } from "./offlineAgentEval"

describe("offline deterministic Agent evaluation", () => {
  it("judges all seven tasks from real isolated candidate documents without pretending to measure a provider", async () => {
    const result = await runOfflineAgentEval(3)
    expect(result.mode).toBe("deterministic_local")
    expect(result.scorecard.passAt1?.total).toBe(7)
    expect(result.scorecard.passAt3?.total).toBe(7)
    expect(result.scorecard.passAt1!.passed).toBeLessThan(7)
    expect(result.scorecard.unverifiableTaskIds).toContain("visual-fit")
    expect(result.scorecard.averageCostUsd).toBeNull()
    expect(result.attempts).toHaveLength(21)
  })

  it("does not claim pass@3 from a single deterministic trial", async () => {
    const result = await runOfflineAgentEval(1)
    expect(result.scorecard.passAt3).toBeNull()
    expect(result.attempts).toHaveLength(7)
  })
})
