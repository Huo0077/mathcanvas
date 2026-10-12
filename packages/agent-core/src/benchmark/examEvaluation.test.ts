import { describe, expect, it, vi } from "vitest"

import { assertExamSet, EXAM_CASES, HELD_OUT_CASES } from "./examSet"
import { examRequestPlan, examTrialOutcomeOf, runExamEvaluation, summarizeExamEvaluation, type ExamTrialObservation } from "./examEvaluation"
import { FROZEN_THRESHOLDS, type FrozenBenchmarkPlan } from "./frozenThresholds"

/**
 * **Task 20 的"授权一到就能跑"**（计划的先决条件 + 停止条件都落在这一层）。
 *
 * 这一组用例**一个请求都不发**：真正的 provider 调用由注入的 `runCase` 承担，
 * 测试里给的是假实现。要钉的是**最容易被写错、也最会骗人的那几条**：
 *
 * - **pass@1 与 pass@3 的定义**（一次成功 / 三次**独立**试验里至少一次成功），而且
 *   **同轮修复成功**要单独计（计划原文："一次成功、同轮修复成功与独立三次成功分别计"）；
 * - **人评没标就是 `null`**，不许拿"没标"当"可读"或"不可读"；
 * - **阈值只对照、不改写**：过不了线就报过不了，不许回头改冻结表；
 * - **缺一次试验 / 冒出一个没冻结的题号** ⇒ 抛，而不是"少跑几条也算跑完"；
 * - **没有授权就跑不起来**：`runExamEvaluation` 必须先过 `assertPaidRunAllowed`。
 */

/** 一份"用户已经点头"的复制品（只在这份用例里造；仓库里的冻结表仍是 pending）。 */
function granted(overrides: Partial<FrozenBenchmarkPlan["authorization"]> = {}): FrozenBenchmarkPlan {
  return { ...FROZEN_THRESHOLDS, authorization: { status: "granted", maxRequests: 36, maxCostUsd: 12, grantedBy: "用户", grantedOn: "2026-10-13", ...overrides } }
}

const CONTEXT = { provider: "deepseek", model: "deepseek-chat", requests: 36, estimatedCostUsd: 9 }

/** 造一份"跑完了"的观测：每题三次，结局由调用方按题给。 */
function observations(outcomeFor: (caseId: string, trial: number) => ExamTrialObservation["outcome"]): ExamTrialObservation[] {
  const cases = [...EXAM_CASES, ...HELD_OUT_CASES]
  return cases.flatMap((entry) => [1, 2, 3].map((trial) => ({
    caseId: entry.id,
    family: entry.family,
    trial,
    outcome: outcomeFor(entry.id, trial),
    latencyMs: 1000 * trial,
    costUsd: 0.1
  })))
}

describe("Task 20: 真实 provider 那一跑怎么记账", () => {
  it("**pass@1 与 pass@3 是两件事**：三次独立里只有一次成功 ⇒ pass@3 记它、pass@1 不记", () => {
    const report = summarizeExamEvaluation(granted(), observations((_, trial) => (trial === 3 ? "planned" : "clarification")), CONTEXT)
    const triangle = report.families.find((entry) => entry.family === "triangle")!
    expect(triangle.passAt1).toBe(0)
    expect(triangle.passAt3).toBe(1)
    // 逐族都对得上：四族里每族都是"第三次才成"。
    for (const family of report.families) {
      expect(family.passAt1).toBe(0)
      expect(family.passAt3).toBe(1)
    }
  })

  it("**同轮修复成功单独计**，不许混进 pass@1 或 pass@3", () => {
    const report = summarizeExamEvaluation(granted(), observations(() => "planned_after_repair"), CONTEXT)
    const triangle = report.families.find((entry) => entry.family === "triangle")!
    expect(triangle.passAt1, "修好不等于一次成功").toBe(0)
    expect(triangle.passAt3, "同轮修复不是独立试验").toBe(0)
    expect(triangle.repairedCount, "但它是另一个读数").toBe(3) // triangle 是 2 道开发集 + 1 道留出集，三道都要同轮修复
    expect(report.totals.repairedCount).toBeGreaterThan(0)
  })

  it("**人评没标就是 null**（不许拿「没标」当可读/不可读）", () => {
    const report = summarizeExamEvaluation(granted(), observations(() => "planned"), CONTEXT)
    for (const family of report.families) expect(family.unreadableShare).toBeNull()
    // 标了才算：给三角形族的观测补上人评。
    const annotated = observations(() => "planned").map((entry) => (entry.family === "triangle" ? { ...entry, readability: "unreadable" as const } : entry))
    const withReadability = summarizeExamEvaluation(granted(), annotated, CONTEXT)
    expect(withReadability.families.find((entry) => entry.family === "triangle")!.unreadableShare).toBe(1)
    expect(withReadability.families.find((entry) => entry.family === "conic")!.unreadableShare).toBeNull()
  })

  it("**阈值只对照、不改写**：过不了线就报过不了，冻结表逐字不变", () => {
    const before = JSON.stringify(FROZEN_THRESHOLDS)
    const report = summarizeExamEvaluation(granted(), observations(() => "clarification"), CONTEXT)
    const failed = report.verdicts.filter((entry) => !entry.passed)
    expect(failed.length).toBeGreaterThan(0)
    expect(failed.some((entry) => entry.metric === "passAt1")).toBe(true)
    expect(failed.map((entry) => entry.metric)).toContain("unreadable") // 没标人评 ⇒ 这一条也过不了（不许当 0）
    expect(JSON.stringify(FROZEN_THRESHOLDS), "冻结表一个字节都不许动").toBe(before)
  })

  it("**缺一次试验 / 多出一个没冻结的题号 ⇒ 抛**（少跑几条不算跑完）", () => {
    const full = observations(() => "planned")
    expect(() => summarizeExamEvaluation(granted(), full.slice(0, -1), CONTEXT)).toThrow(/试次|试验|36/)
    expect(() => summarizeExamEvaluation(granted(), [...full, { ...full[0]!, caseId: "not-frozen" }], CONTEXT)).toThrow(/没有冻结/)
  })

  it("**没有授权就跑不起来**：执行入口先过授权闸", async () => {
    const runCase = vi.fn(async () => ({ outcome: "planned" as const, costUsd: 0.1 }))
    const pending = await runExamEvaluation({ plan: FROZEN_THRESHOLDS, request: { ...CONTEXT, grantedBy: "用户", grantedOn: "2026-10-13" }, runCase })
    expect(pending.ok).toBe(false)
    if (pending.ok) throw new Error("未授权不许跑")
    expect(pending.reason).toContain("付费授权")
    expect(runCase, "连一次 provider 调用都不该发生").not.toHaveBeenCalled()
  })

  it("**授权之后**跑满 36 次并把报告交出来（这里用假 provider，一个网络请求都没有）", async () => {
    const runCase = vi.fn(async (examCase: { id: string }, trial: number) => ({ outcome: trial === 1 ? ("planned" as const) : ("clarification" as const), costUsd: 0.08, latencyMs: 500 }))
    const result = await runExamEvaluation({ plan: granted(), request: { ...CONTEXT, grantedBy: "用户", grantedOn: "2026-10-13" }, runCase: runCase as never })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(runCase).toHaveBeenCalledTimes(36)
    expect(result.report.totals.requests).toBe(36)
    expect(result.report.totals.costUsd).toBeCloseTo(36 * 0.08, 9)
    // 每次都第一次就成 ⇒ 各族 pass@1 = 1。
    for (const family of result.report.families) expect(family.passAt1).toBe(1)
  })

  it("**单次规划请求的结局映射只有一处**（含「修复过就单独记」）", () => {
    expect(examTrialOutcomeOf({ kind: "plan" })).toBe("planned")
    expect(examTrialOutcomeOf({ kind: "plan", repaired: true })).toBe("planned_after_repair")
    expect(examTrialOutcomeOf({ kind: "clarification" })).toBe("clarification")
    // 模型回了一段解释而不是计划 ⇒ 这一次没画出图（记 `rejected`，不是"成功"也不是"问路"）。
    expect(examTrialOutcomeOf({ kind: "answer" })).toBe("rejected")
    expect(examTrialOutcomeOf({ kind: "error" })).toBe("error")
  })

  it("**请求清单**：36 个请求、最坏 $10.35（这是给用户点头用的分母）", () => {
    const plan = examRequestPlan(FROZEN_THRESHOLDS)
    expect(plan.requests).toBe(36)
    expect(plan.cases).toBe([...EXAM_CASES, ...HELD_OUT_CASES].length)
    expect(plan.trialsPerCase).toBe(3)
    expect(plan.worstCaseCostUsd).toBeCloseTo(10.35, 6)
    expect(plan.perFamily.map((entry) => entry.family)).toEqual(["triangle", "conic", "function", "solid"])
    // 题集本身也要是合法的（否则清单是在算一份不成立的样本）。
    expect(() => assertExamSet(EXAM_CASES, HELD_OUT_CASES)).not.toThrow()
    // 打出来：这是**授权请求**的全部数字（谁都能复算一遍）。
    console.log(`EXAM-REQUEST-PLAN ${JSON.stringify({ ...plan, authorization: FROZEN_THRESHOLDS.authorization.status })}`)
  })
})
