import { describe, expect, it } from "vitest"

import { EXAM_CASES, HELD_OUT_CASES } from "./examSet"
import { assertPaidRunAllowed, examCaseFor, FROZEN_FAMILIES, FROZEN_THRESHOLDS, frozenCaseIds, frozenFamilyOf, frozenSample, type FrozenBenchmarkPlan } from "./frozenThresholds"

/**
 * **Task 20 的"先冻结"+ 停止条件**（计划原文见 `frozenThresholds.ts` 的文件头）。
 *
 * 这一组用例只钉一件事：**阈值与样本必须是在看到付费结果之前定的，而且授权没点头之前
 * 一个请求都不许发**。计划的停止条件由 `assertPaidRunAllowed` 承担 —— 这句话如果只写在
 * 文档里，下一个跑评测的人（或下一轮的我）就会"顺手跑一下看看"。
 */

/** 一份"用户已经点头"的复制品（**只在这份用例里造**，不改仓库里的冻结表）。 */
function grantedPlan(overrides: Partial<FrozenBenchmarkPlan["authorization"]> = {}): FrozenBenchmarkPlan {
  return { ...FROZEN_THRESHOLDS, authorization: { status: "granted", maxRequests: 48, maxCostUsd: 12, grantedBy: "用户", grantedOn: "2026-10-13", ...overrides } }
}

describe("Task 20: 事先冻结的样本与阈值", () => {
  it("四族齐，而且**样本冻结到题号**（不是'8 条'这种说法）", () => {
    expect(FROZEN_THRESHOLDS.families.map((entry) => entry.family).sort()).toEqual([...FROZEN_FAMILIES].sort())
    for (const entry of FROZEN_THRESHOLDS.families) {
      expect(entry.samples.filter((sample) => sample.set === "dev").length, `${entry.family} 的开发集样本`).toBeGreaterThan(0)
      expect(entry.samples.filter((sample) => sample.set === "holdout").length, `${entry.family} 的留出集样本`).toBeGreaterThan(0)
    }
    // 题号不许重复（同一题被冻进两族是笔误，不是覆盖）。
    const all = frozenCaseIds()
    expect(new Set(all).size).toBe(all.length)
  })

  it("**每一条冻结的题号都真的在随仓题集里，而且族对得上**（换题就红）", () => {
    for (const entry of FROZEN_THRESHOLDS.families) {
      for (const sample of entry.samples) {
        const examCase = examCaseFor(sample.caseId)
        expect(examCase, `冻结表里的 ${sample.caseId} 不在 examSet 里`).not.toBeNull()
        expect(examCase!.family, `${sample.caseId} 的族与冻结表不一致`).toBe(entry.family)
        expect(frozenFamilyOf(sample.caseId)).toBe(entry.family)
        // 开发集/留出集的分组也要与题集一致（`exam-` 前缀是开发集、`held-` 是留出集）。
        expect(sample.set, `${sample.caseId} 的 dev/holdout 分组`).toBe(sample.caseId.startsWith("held-") ? "holdout" : "dev")
      }
    }
    // 反方向：随仓题集里的每一条都在冻结表里（新加一道真题而不冻结它 ⇒ 红）。
    const repoIds = [...EXAM_CASES, ...HELD_OUT_CASES].map((entry) => entry.id).sort()
    expect(frozenCaseIds().slice().sort()).toEqual(repoIds)
    expect(frozenCaseIds().filter((id) => frozenSample(id) === null)).toEqual([])
  })

  it("**冻结发生在任何付费观测之前**（看完结果再定线不算验收线）", () => {
    expect(FROZEN_THRESHOLDS.frozenOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(FROZEN_THRESHOLDS.paidRuns, "冻结时已有的付费观测数必须是 0").toBe(0)
    expect(FROZEN_THRESHOLDS.trialsPerCase, "pass@3 要三次**独立**成功").toBe(3)
    // 阈值都是正数且落在合理区间（一个 0 或负数会把验收线变成空话）。
    for (const entry of FROZEN_THRESHOLDS.families) {
      expect(entry.thresholds.passAt1).toBeGreaterThan(0)
      expect(entry.thresholds.passAt1).toBeLessThanOrEqual(1)
      expect(entry.thresholds.passAt3).toBeGreaterThanOrEqual(entry.thresholds.passAt1)
      expect(entry.thresholds.unreadableMax).toBeGreaterThanOrEqual(0)
      expect(entry.thresholds.latencyP95SecondsMax).toBeGreaterThan(0)
      expect(entry.thresholds.costUsdMaxPerCase).toBeGreaterThan(0)
    }
  })

  it("**授权还没点头 ⇒ 一个请求都不许发**（计划写死的停止条件）", () => {
    expect(FROZEN_THRESHOLDS.authorization.status).toBe("pending")
    const decision = assertPaidRunAllowed(FROZEN_THRESHOLDS, { requests: 36, estimatedCostUsd: 9 })
    expect(decision.ok).toBe(false)
    if (decision.ok) throw new Error("未授权时不许放行")
    expect(decision.reason).toContain("付费授权")
    // 也不许"不给请求数就当 0 个"这类绕过：任何请求都被拒。
    expect(assertPaidRunAllowed(FROZEN_THRESHOLDS, { requests: 1, estimatedCostUsd: 0.01 }).ok).toBe(false)
  })

  it("点头之后**仍受请求数与费用上限约束**，而且缺一栏照样拒", () => {
    // 额度之内 ⇒ 放行。
    expect(assertPaidRunAllowed(grantedPlan(), { requests: 36, estimatedCostUsd: 9 })).toMatchObject({ ok: true })
    // 请求数超一个 ⇒ 拒。
    const tooMany = assertPaidRunAllowed(grantedPlan(), { requests: 49, estimatedCostUsd: 9 })
    expect(tooMany.ok).toBe(false)
    if (tooMany.ok) throw new Error("超请求数必须拒")
    expect(tooMany.reason).toContain("49")
    // 费用超一分 ⇒ 拒。
    expect(assertPaidRunAllowed(grantedPlan(), { requests: 36, estimatedCostUsd: 12.01 }).ok).toBe(false)
    // 没写额度 / 没写谁点头 ⇒ 拒（"点了头"不等于"额度随便"）。
    expect(assertPaidRunAllowed(grantedPlan({ maxRequests: undefined }), { requests: 1, estimatedCostUsd: 0.1 }).ok).toBe(false)
    expect(assertPaidRunAllowed(grantedPlan({ maxCostUsd: undefined }), { requests: 1, estimatedCostUsd: 0.1 }).ok).toBe(false)
    expect(assertPaidRunAllowed(grantedPlan({ grantedBy: "" }), { requests: 1, estimatedCostUsd: 0.1 }).ok).toBe(false)
    // 请求数必须是正整数。
    expect(assertPaidRunAllowed(grantedPlan(), { requests: 1.5, estimatedCostUsd: 0.1 }).ok).toBe(false)
  })

  it("**已经跑过付费观测之后再谈'事先冻结'也没用**（顺序错了就拒）", () => {
    const afterPaid = { ...grantedPlan(), paidRuns: 3 }
    const decision = assertPaidRunAllowed(afterPaid, { requests: 1, estimatedCostUsd: 0.1 })
    expect(decision.ok).toBe(false)
    if (decision.ok) throw new Error("顺序错了必须拒")
    expect(decision.reason).toContain("事先")
  })

  it("每一道样本的离线可跑性都有实测判据（写错就红）", () => {
    // 真实核对在 `apps/web/src/agent/fixtures/frozenThresholds.local.test.ts` 里
    //（它拿得到 `matchLocalIntent`）；这里只钉住取值是闭集里的一个。
    for (const entry of FROZEN_THRESHOLDS.families) {
      for (const sample of entry.samples) expect(["local-fixture", "provider-required"]).toContain(sample.offlineAttemptability)
    }
  })
})
