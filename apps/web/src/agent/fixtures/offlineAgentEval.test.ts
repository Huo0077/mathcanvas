import { describe, expect, it } from "vitest"

import { runOfflineAgentEval } from "./offlineAgentEval"

describe("offline deterministic Agent evaluation", () => {
  it("judges all eight tasks from real isolated candidate documents without pretending to measure a provider", async () => {
    const result = await runOfflineAgentEval(3)
    expect(result.mode).toBe("deterministic_local")
    expect(result.scorecard.passAt1?.total).toBe(8)
    expect(result.scorecard.passAt3?.total).toBe(8)
    /**
     * 不是一个"全过"的评测。`pass@1` 必须小于总数 —— 这份离线口径的价值在于
     * **它敢报失败**；一旦它全绿，要么是本地规划器真的全对了，要么是判题器松了。
     */
    expect(result.scorecard.passAt1!.passed).toBeLessThan(8)
    /**
     * **`visual-fit` 现在是唯一不可判定的任务**（Phase 3 之前是三条）。
     *
     * 它不可判定的原因与"判据没写"无关：它的原话只有"调整视角"、**没有构图动词**，
     * 本地规划器对它产不出候选文档，于是没有东西可判。这是**如实缺口**，不是缺陷。
     *
     * 反过来，`section-after-solid` 与 `modify-section` 曾经也在这一列里，现在
     * **有了判据、并如实报了失败**（本地规划器不会建截面 / 产不出候选文档）——
     * 从 `not_supported` 变成 `failed` 是**信息量增加**：前者是"我们没看"，
     * 后者是"看了，没做到"。
     */
    expect(result.scorecard.unverifiableTaskIds).toEqual(["visual-fit"])
    expect(result.scorecard.unverifiableTaskIds).not.toContain("section-after-solid")
    expect(result.scorecard.unverifiableTaskIds).not.toContain("modify-section")
    expect(result.scorecard.averageCostUsd).toBeNull()
    expect(result.attempts).toHaveLength(24)
  })

  it("does not claim pass@3 from a single deterministic trial", async () => {
    const result = await runOfflineAgentEval(1)
    expect(result.scorecard.passAt3).toBeNull()
    expect(result.attempts).toHaveLength(8)
  })
})
