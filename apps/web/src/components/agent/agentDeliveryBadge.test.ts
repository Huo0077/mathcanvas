import { describe, expect, it } from "vitest"

import { deliveryBadge, deliverySummary } from "./agentDeliveryBadge"

/**
 * **W9：交付徽标只认宿主证据（2026-11-09）**。
 *
 * 这一组钉的是"别把部分说成全部、别把正文说成核验"：
 * ① 两问只核验一问 → 不能整题绿色；
 * ② 旧消息/空证据 → 未核验；
 * ③ 有反例 → 失败（不是"部分"）；
 * ④ 采样通过只是 sampled，不算已核验；
 * ⑤ 缺答的目标单独列出（不是"未核验"）。
 */

describe("W9 交付徽标", () => {
  it("does not turn one verified goal out of two into a verified delivery", () => {
    const badge = deliveryBadge({ status: "answered", requiredGoals: 2, verifiedGoals: 1, refutedGoals: 0 })
    expect(badge).not.toBe("verified")
    expect(badge).toBe("partial")
  })

  it("stays unverified when there is no host evidence at all", () => {
    expect(deliveryBadge({ status: "answered", requiredGoals: 2, verifiedGoals: 0, refutedGoals: 0 })).toBe("unverified")
    expect(deliveryBadge({ status: "partial", requiredGoals: 1, verifiedGoals: 0, refutedGoals: 0 })).toBe("unverified")
  })

  it("reports failed whenever a goal was refuted, even with other goals verified", () => {
    expect(deliveryBadge({ status: "answered", requiredGoals: 2, verifiedGoals: 1, refutedGoals: 1 })).toBe("failed")
    expect(deliveryBadge({ status: "failed", requiredGoals: 1, verifiedGoals: 1, refutedGoals: 0 })).toBe("failed")
    expect(deliveryBadge({ status: "inconsistent", requiredGoals: 1, verifiedGoals: 0, refutedGoals: 0 })).toBe("failed")
  })

  it("only calls a delivery verified when every required goal is verified and answered", () => {
    expect(deliveryBadge({ status: "answered", requiredGoals: 2, verifiedGoals: 2, refutedGoals: 0 })).toBe("verified")
    expect(deliveryBadge({ status: "partial", requiredGoals: 2, verifiedGoals: 2, refutedGoals: 0 })).toBe("partial")
    expect(deliveryBadge({ status: "answered", requiredGoals: 0, verifiedGoals: 0, refutedGoals: 0 })).toBe("unverified")
  })
})

describe("W9 交付汇总按逐问统计", () => {
  const result = (overrides: Record<string, unknown> = {}) => ({
    schemaVersion: "mathcanvas.solve.v1" as const,
    problemRevision: "p".repeat(64),
    status: "answered" as const,
    answers: [
      { goalId: "g1", kind: "numeric" as const, displayText: "BC=2", value: { kind: "numeric" as const, expression: "2" }, evidenceRefs: [] }
    ],
    unansweredGoalIds: ["g2"],
    evidence: [
      { id: "e1", goalId: "g1", problemRevision: "p".repeat(64), producer: "host_verifier" as const, method: "quadratic-interval",
        evidence: { status: "verified_instance" as const, solver: "model" as const, residuals: {}, degreesOfFreedom: null, nextActions: [] } }
    ],
    reasonCodes: [],
    clarificationQuestions: [],
    ...overrides
  })

  it("lists the missing goal separately from the unverified ones", () => {
    const summary = deliverySummary(result())
    expect(summary.badge).toBe("partial")
    expect(summary.requiredGoals).toBe(2)
    expect(summary.verifiedGoalIds).toEqual(["g1"])
    expect(summary.missingGoalIds).toEqual(["g2"])
    expect(summary.unverifiedGoalIds).toEqual(["g2"])
  })

  it("does not treat sampled evidence as verified", () => {
    const summary = deliverySummary(result({
      answers: [{ goalId: "g1", kind: "numeric", displayText: "1/2", value: { kind: "numeric", expression: "1/2" }, evidenceRefs: [] }],
      unansweredGoalIds: [],
      evidence: [{ id: "e1", goalId: "g1", problemRevision: "p".repeat(64), producer: "host_verifier", method: "function-sampling",
        evidence: { status: "sampled", solver: "model", residuals: {}, degreesOfFreedom: null, nextActions: [] } }]
    }))
    expect(summary.badge).toBe("unverified")
    expect(summary.verifiedGoalIds).toEqual([])
    expect(summary.sampledGoalIds).toEqual(["g1"])
  })

  it("ignores evidence for goals that are not part of this delivery", () => {
    const summary = deliverySummary(result({
      evidence: [{ id: "e9", goalId: "g9", problemRevision: "p".repeat(64), producer: "host_verifier", method: "x",
        evidence: { status: "verified_instance", solver: "model", residuals: {}, degreesOfFreedom: null, nextActions: [] } }]
    }))
    expect(summary.badge).toBe("unverified")
    expect(summary.verifiedGoalIds).toEqual([])
  })
})
