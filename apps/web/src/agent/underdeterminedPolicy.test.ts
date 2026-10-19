import { describe, expect, it } from "vitest"

import { buildPolicyText } from "./systemPrompt"

/**
 * **欠定题的一般位置策略**（2026-10-19，P5-3）：不默认等边/等腰/整数，选一般位置并写进 assumptions。
 */
describe("underdetermined policy", () => {
  it("asks for a general position instead of special values", () => {
    const policy = buildPolicyText({ channel: "strict_json", canPlan: true, actionIds: [] })

    expect(policy).toContain("一般位置")
    expect(policy).toContain("等边")
    expect(policy).toContain("assumptions")
  })
})
