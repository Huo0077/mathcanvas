import { describe, expect, it, vi } from "vitest"

import { assertExamSet, EXAM_CASES, HELD_OUT_CASES } from "./examSet"
import { examRequestPlan, examTrialOutcomeOf, examTrialVerdictOf, runExamEvaluation, summarizeExamEvaluation, type ExamTrialObservation } from "./examEvaluation"
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

const CONTEXT = { provider: "deepseek", model: "deepseek-chat", requests: 36, estimatedCostUsd: 9, repairPath: "not-driven" as const }

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
    // 「有修复」这件事**必须由调用方声明**：这一跑走的是协调器那条带修复回路的路径。
    const repairedRun = { ...CONTEXT, repairPath: "coordinator-driven" as const }
    const report = summarizeExamEvaluation(granted(), observations(() => "planned_after_repair"), repairedRun)
    const triangle = report.families.find((entry) => entry.family === "triangle")!
    expect(triangle.passAt1, "修好不等于一次成功").toBe(0)
    expect(triangle.passAt3, "同轮修复不是独立试验").toBe(0)
    expect(triangle.repairedCount, "但它是另一个读数").toBe(3) // triangle 是 2 道开发集 + 1 道留出集，三道都要同轮修复
    expect(report.totals.repairedCount).toBeGreaterThan(0)
  })

  it("**「没走协调器」与「同轮修复」不许同时成立**：声明与观测矛盾就抛，不取一个", () => {
    expect(() => summarizeExamEvaluation(granted(), observations(() => "planned_after_repair"), CONTEXT)).toThrow(/协调器/)
    // 同一份观测，声明对了就照记（这一条是上一条的反面，保证抛的是"矛盾"而不是"修复"）。
    expect(() => summarizeExamEvaluation(granted(), observations(() => "planned_after_repair"), { ...CONTEXT, repairPath: "coordinator-driven" })).not.toThrow()
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

  /**
   * **Task 20 的第二块（2026-10-14）：失败落在哪一层**。
   *
   * 计划原文要的是 plan / schema / 构造 / 核验 / 可读性**五层**的失败分布，而上一次交付
   * 只覆盖了 planning 一层 —— 剩下的四层连"落点"都没有。这一组用例钉住四层的判定：
   * 每一档的**层名**都从 `compilePlan` 的原始读数来（诊断层名 / 核验结局），而判定只在一处。
   */
  it("**失败落在哪一层**：模型没给计划 / schema / 构造 / 核验四档各有层名", () => {
    // ① 模型回了解释（没进编译器）⇒ `plan`。
    expect(examTrialVerdictOf({ kind: "answer" })).toEqual({ outcome: "rejected", failureLayer: "plan" })
    // ② 计划在**前四层**被拒（传输解析 / 字段审计 / 引用解析 / 参数补全）⇒ `schema`。
    expect(examTrialVerdictOf({ kind: "plan", compile: { accepted: false, errorStages: ["transport"] } })).toEqual({ outcome: "rejected", failureLayer: "schema" })
    expect(examTrialVerdictOf({ kind: "plan", compile: { accepted: false, errorStages: ["field_audit", "geometry_validation"] } })).toEqual({ outcome: "rejected", failureLayer: "schema" })
    // ③ 计划合法但**图造不出来**（几何语义校验 / 动作编译）⇒ `construct`。
    expect(examTrialVerdictOf({ kind: "plan", compile: { accepted: false, errorStages: ["geometry_validation"] } })).toEqual({ outcome: "rejected", failureLayer: "construct" })
    expect(examTrialVerdictOf({ kind: "plan", compile: { accepted: false, errorStages: ["action_compile"] } })).toEqual({ outcome: "rejected", failureLayer: "construct" })
    // ④ 编译过了、**题设核验**没过 ⇒ `verify`（与产品提交闸同一条判据：核验不是 passed 就不许提交）。
    expect(examTrialVerdictOf({ kind: "plan", compile: { accepted: true, errorStages: [], verification: "unverified" } })).toEqual({ outcome: "rejected", failureLayer: "verify" })
    expect(examTrialVerdictOf({ kind: "plan", compile: { accepted: true, errorStages: [], verification: "failed" } })).toEqual({ outcome: "rejected", failureLayer: "verify" })
    // ⑤ 编译过 + 核验 passed（或这一轮根本没有核验报告）⇒ 成功。
    expect(examTrialVerdictOf({ kind: "plan", compile: { accepted: true, errorStages: [], verification: "passed" } })).toEqual({ outcome: "planned" })
    expect(examTrialVerdictOf({ kind: "plan", compile: { accepted: true, errorStages: [] } })).toEqual({ outcome: "planned" })
    // ⑥ **诊断缺失就不编层名**：`ok:false` 却一条错误诊断都没有时，只记结局、不猜层。
    expect(examTrialVerdictOf({ kind: "plan", compile: { accepted: false, errorStages: [] } })).toEqual({ outcome: "rejected" })
    // ⑦ 规划器自己抛了 ⇒ `error`：谈不到"卡在哪一层"。
    expect(examTrialVerdictOf({ kind: "error" })).toEqual({ outcome: "error" })
    expect(examTrialVerdictOf({ kind: "clarification" })).toEqual({ outcome: "clarification" })
  })

  it("**层名与结局分开数**：`failureLayers` 只数给出了层名的那些，层名定不出来的不猜", () => {
    const cases = [...EXAM_CASES, ...HELD_OUT_CASES]
    const withLayers: ExamTrialObservation[] = cases.flatMap((entry) => [1, 2, 3].map((trial) => ({
      caseId: entry.id,
      family: entry.family,
      trial,
      // 第一族：三次都卡在构造层；其余族：三次都撞上"编译器没给原因"（只记结局、不记层）。
      outcome: "rejected" as const,
      ...(entry.family === "triangle" ? { failureLayer: "construct" as const } : {}),
      latencyMs: 1000,
      costUsd: 0.1
    })))
    const report = summarizeExamEvaluation(granted(), withLayers, CONTEXT)
    const triangle = report.families.find((entry) => entry.family === "triangle")!
    // 三角族 3 道样本 × 3 次 = 9 条观测，条条都是"卡在构造层"。
    expect(triangle.failureLayers).toEqual({ construct: 9 })
    expect(triangle.failureStages).toEqual({ rejected: 9 })
    const conic = report.families.find((entry) => entry.family === "conic")!
    // 结局照数，层名一栏**空着**（不是 0 猜成一个层名）。
    expect(conic.failureStages).toEqual({ rejected: 9 })
    expect(conic.failureLayers).toEqual({})
  })

  it("**报告带出这一跑有没有走协调器**（`not-driven` 时 `repairedCount` 只能是 0）", () => {
    const report = summarizeExamEvaluation(granted(), observations(() => "rejected"), CONTEXT)
    expect(report.repairPath).toBe("not-driven")
    expect(report.totals.repairedCount).toBe(0)
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
