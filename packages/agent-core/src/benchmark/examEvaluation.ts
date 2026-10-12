import { EXAM_CASES, HELD_OUT_CASES, type ExamCase, type ExamFamily } from "./examSet"
import { assertPaidRunAllowed, frozenSample, FROZEN_THRESHOLDS, type FrozenBenchmarkPlan } from "./frozenThresholds"

/**
 * **Task 20 的记账与执行骨架**：授权一到就能跑，而且跑完的账只有一种算法。
 *
 * ## 这一层为什么存在（在授权还没到的时候就先写好）
 *
 * 计划的付费那一步要等用户点头（请求数 + 最高费用），但**"点头之后跑什么、怎么记"**
 * 不需要授权就能定下来 —— 而且正因为它最容易糊，最好在花钱之前就写死：
 *
 * - **pass@1 与 pass@3 是两件事**：前者要"第一次就成"，后者要"三次**独立**试验里至少成一次"；
 * - **同轮修复成功单独计**（计划原文："一次成功、同轮修复成功与独立三次成功分别计"）——
 *   把"修了一次才成"记进 pass@1 是最常见的一种自我美化；
 * - **人评没标就是 `null`**：`unreadableShare` 只有人真的标注过才有值；把"没标"当成 0
 *   会让可读性那一条**凭空白过**；
 * - **阈值只对照、不改写**：过不了线就报过不了。这一层**一个字段都不写回冻结表**。
 *
 * ## 授权闸在**执行入口**上，不在调用方的自觉上
 *
 * `runExamEvaluation` 第一件事就是 `assertPaidRunAllowed`：没有授权（或额度不清、或请求超了）
 * 就**连一次 `runCase` 都不调用**直接返回 `ok: false`。跑完之后还会核对实际费用有没有超授权上限。
 *
 * ## 这一层的边界
 *
 * 它**不碰网络、不认 provider**：真正的调用由注入的 `runCase` 承担（产品路径上是模型规划器）。
 * 所以这一层能在没有授权、没有 provider 的机器上被完整测一遍（假 `runCase`）。
 */

export type ExamTrialOutcome =
  /** 第一次就按题面规划出来了。 */
  | "planned"
  /** **同一轮里修了一次**才规划出来（单独计，不算 pass@1、也不算独立的 pass@3）。 */
  | "planned_after_repair"
  /** 规划器反问（题面读不出唯一构造）。 */
  | "clarification"
  /** 编译/核验不通过。 */
  | "rejected"
  /** 这一层自己出岔子。 */
  | "error"
  /** 没跑到（预算/墙钟用尽）。 */
  | "not_measured"

export const EXAM_SUCCESS_OUTCOMES: readonly ExamTrialOutcome[] = ["planned"]
export const EXAM_REPAIRED_OUTCOME: ExamTrialOutcome = "planned_after_repair"

export interface ExamTrialObservation {
  caseId: string
  family: ExamFamily
  /** 第几次独立试验（1..trialsPerCase）。 */
  trial: number
  outcome: ExamTrialOutcome
  /** **人评**才填；没标注就没这一栏（不许用模型自评冒充）。 */
  readability?: "readable" | "partly" | "unreadable"
  latencyMs: number
  costUsd: number
  detail?: string
}

export interface ExamFamilyResult {
  family: ExamFamily
  cases: number
  trials: number
  /** 第一次就成的题数 ÷ 题数。 */
  passAt1: number
  /** 三次独立里至少成一次的题数 ÷ 题数。 */
  passAt3: number
  /** **同轮修好**的题数（单独一栏，不进上面两个）。 */
  repairedCount: number
  p95LatencyMs: number
  costUsd: number
  /** 人评 `unreadable` 的比例；**没标注就是 `null`**。 */
  unreadableShare: number | null
  /** 非成功结局的分布（失败落在哪一层）。 */
  failureStages: Record<string, number>
}

export interface ExamVerdict {
  family: ExamFamily
  metric: "passAt1" | "passAt3" | "unreadable" | "latencyP95" | "costPerCase"
  threshold: number
  /** 实测值；**没测到就是 `null`**（那时 `passed` 必为 false）。 */
  actual: number | null
  passed: boolean
}

export interface ExamEvaluationReport {
  mode: "real_provider"
  provider: string
  model: string
  cases: number
  trialsPerCase: number
  families: ExamFamilyResult[]
  totals: { requests: number; costUsd: number; passAt1: number; passAt3: number; repairedCount: number }
  /** 逐条对照**事先冻结**的阈值；过不了线就报过不了。 */
  verdicts: ExamVerdict[]
  authorization: { requests: number; maxCostUsd: number; grantedBy: string; grantedOn: string }
}

export interface ExamEvaluationContext {
  provider: string
  model: string
}

function percentile95(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((first, second) => first - second)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!
}

/** 冻结表里的全部题号（按族）。 */
function frozenCasesByFamily(plan: FrozenBenchmarkPlan): { family: ExamFamily; cases: readonly string[] }[] {
  return plan.families.map((entry) => ({ family: entry.family, cases: entry.samples.map((sample) => sample.caseId) }))
}

/**
 * **把跑出来的观测记成一份报告**。
 *
 * 入参观测必须**完整**（每题 `trialsPerCase` 次、题号都在冻结表里）：少跑几条而报一份漂亮的分，
 * 是这一层最该挡住的事 —— 所以缺一次就抛，不是"按有的算"。
 */
export function summarizeExamEvaluation(plan: FrozenBenchmarkPlan, observations: readonly ExamTrialObservation[], context: ExamEvaluationContext): ExamEvaluationReport {
  const expected = frozenCasesByFamily(plan)
  const expectedIds = expected.flatMap((entry) => entry.cases)

  for (const observation of observations) {
    if (frozenSample(observation.caseId, plan) === null) {
      throw new Error(`观测里出现了没有冻结的题号 ${observation.caseId} —— 冻结表之外的结果不进这份报告。`)
    }
    if (observation.trial < 1 || observation.trial > plan.trialsPerCase) {
      throw new Error(`${observation.caseId} 的试次 ${observation.trial} 越界（1..${plan.trialsPerCase}）。`)
    }
  }
  const completExpected = expectedIds.length * plan.trialsPerCase
  if (observations.length !== completExpected) {
    throw new Error(`试次不完整：应有 ${completExpected} 条（${expectedIds.length} 题 × ${plan.trialsPerCase} 次），收到 ${observations.length} 条 —— 少跑的不能当跑完。`)
  }
  for (const caseId of expectedIds) {
    const trials = new Set(observations.filter((entry) => entry.caseId === caseId).map((entry) => entry.trial))
    if (trials.size !== plan.trialsPerCase) throw new Error(`${caseId} 的独立试次只有 ${trials.size} 次，缺 ${plan.trialsPerCase - trials.size} 次。`)
  }

  const families: ExamFamilyResult[] = expected.map((entry) => {
    const familyObservations = observations.filter((observation) => observation.family === entry.family)
    const casesWithTrial1Success = entry.cases.filter((caseId) => familyObservations.some((observation) => observation.caseId === caseId && observation.trial === 1 && EXAM_SUCCESS_OUTCOMES.includes(observation.outcome)))
    const casesWithAnySuccess = entry.cases.filter((caseId) => familyObservations.some((observation) => observation.caseId === caseId && EXAM_SUCCESS_OUTCOMES.includes(observation.outcome)))
    const repaired = entry.cases.filter((caseId) => familyObservations.some((observation) => observation.caseId === caseId && observation.outcome === EXAM_REPAIRED_OUTCOME))
    const annotated = familyObservations.filter((observation) => observation.readability !== undefined)
    const failureStages: Record<string, number> = {}
    for (const observation of familyObservations) {
      if (EXAM_SUCCESS_OUTCOMES.includes(observation.outcome) || observation.outcome === EXAM_REPAIRED_OUTCOME) continue
      failureStages[observation.outcome] = (failureStages[observation.outcome] ?? 0) + 1
    }
    return {
      family: entry.family,
      cases: entry.cases.length,
      trials: familyObservations.length,
      passAt1: entry.cases.length === 0 ? 0 : casesWithTrial1Success.length / entry.cases.length,
      passAt3: entry.cases.length === 0 ? 0 : casesWithAnySuccess.length / entry.cases.length,
      repairedCount: repaired.length,
      p95LatencyMs: percentile95(familyObservations.map((observation) => observation.latencyMs)),
      costUsd: familyObservations.reduce((sum, observation) => sum + observation.costUsd, 0),
      unreadableShare: annotated.length === 0 ? null : annotated.filter((observation) => observation.readability === "unreadable").length / annotated.length,
      failureStages
    }
  })

  const verdicts: ExamVerdict[] = []
  for (const family of families) {
    const freeze = plan.families.find((entry) => entry.family === family.family)!
    const thresholds = freeze.thresholds
    const costPerCase = family.cases === 0 ? null : family.costUsd / family.cases
    verdicts.push({ family: family.family, metric: "passAt1", threshold: thresholds.passAt1, actual: family.passAt1, passed: family.passAt1 >= thresholds.passAt1 })
    verdicts.push({ family: family.family, metric: "passAt3", threshold: thresholds.passAt3, actual: family.passAt3, passed: family.passAt3 >= thresholds.passAt3 })
    verdicts.push({
      family: family.family,
      metric: "unreadable",
      threshold: thresholds.unreadableMax,
      actual: family.unreadableShare,
      // **没标注 ⇒ 不算过**（而不是"没标注所以没问题"）。
      passed: family.unreadableShare !== null && family.unreadableShare <= thresholds.unreadableMax
    })
    verdicts.push({ family: family.family, metric: "latencyP95", threshold: thresholds.latencyP95SecondsMax * 1000, actual: family.p95LatencyMs, passed: family.p95LatencyMs <= thresholds.latencyP95SecondsMax * 1000 })
    verdicts.push({ family: family.family, metric: "costPerCase", threshold: thresholds.costUsdMaxPerCase, actual: costPerCase, passed: costPerCase !== null && costPerCase <= thresholds.costUsdMaxPerCase })
  }

  const allCases = expectedIds.length
  const successesAt1 = expected.flatMap((entry) => entry.cases).filter((caseId) => observations.some((observation) => observation.caseId === caseId && observation.trial === 1 && EXAM_SUCCESS_OUTCOMES.includes(observation.outcome)))
  const successesAny = expected.flatMap((entry) => entry.cases).filter((caseId) => observations.some((observation) => observation.caseId === caseId && EXAM_SUCCESS_OUTCOMES.includes(observation.outcome)))

  return {
    mode: "real_provider",
    provider: context.provider,
    model: context.model,
    cases: allCases,
    trialsPerCase: plan.trialsPerCase,
    families,
    totals: {
      requests: observations.length,
      costUsd: observations.reduce((sum, observation) => sum + observation.costUsd, 0),
      passAt1: allCases === 0 ? 0 : successesAt1.length / allCases,
      passAt3: allCases === 0 ? 0 : successesAny.length / allCases,
      repairedCount: families.reduce((sum, family) => sum + family.repairedCount, 0)
    },
    verdicts,
    authorization: { requests: observations.length, maxCostUsd: plan.authorization.maxCostUsd ?? 0, grantedBy: plan.authorization.grantedBy ?? "", grantedOn: plan.authorization.grantedOn ?? "" }
  }
}

/** **请求清单**（给用户点头用的分母：多少请求、最坏多少钱）。 */
export interface ExamRequestPlan {
  cases: number
  trialsPerCase: number
  requests: number
  worstCaseCostUsd: number
  perFamily: { family: ExamFamily; cases: number; requests: number; costUsdMax: number }[]
}

export function examRequestPlan(plan: FrozenBenchmarkPlan = FROZEN_THRESHOLDS): ExamRequestPlan {
  const perFamily = plan.families.map((entry) => {
    const cases = entry.samples.length
    const requests = cases * plan.trialsPerCase
    return { family: entry.family, cases, requests, costUsdMax: requests * entry.thresholds.costUsdMaxPerCase }
  })
  return {
    cases: perFamily.reduce((sum, entry) => sum + entry.cases, 0),
    trialsPerCase: plan.trialsPerCase,
    requests: perFamily.reduce((sum, entry) => sum + entry.requests, 0),
    worstCaseCostUsd: perFamily.reduce((sum, entry) => sum + entry.costUsdMax, 0),
    perFamily
  }
}

export interface ExamRunCaseResult {
  outcome: ExamTrialOutcome
  readability?: ExamTrialObservation["readability"]
  costUsd: number
  /** 没给就用墙钟实测。 */
  latencyMs?: number
  detail?: string
}

export interface ExamRunRequest {
  plan: FrozenBenchmarkPlan
  /** 这次请求的额度与「谁点的头」——它必须落在 `plan.authorization` 之内。 */
  request: { provider: string; model: string; requests: number; estimatedCostUsd: number; grantedBy: string; grantedOn: string }
  /** 真正的调用（产品路径上是模型规划器）。**授权不过时它一次都不会被调用。** */
  runCase: (examCase: ExamCase, trial: number) => Promise<ExamRunCaseResult>
}

export type ExamRunOutcome = { ok: true; report: ExamEvaluationReport } | { ok: false; reason: string }

/**
 * **跑一次真实评测**（唯一入口）。
 *
 * 顺序是刻意的：**先过授权闸**（`assertPaidRunAllowed` 的四道门），**再碰 provider**；
 * 跑完再核对实际费用有没有超授权上限 —— "先花着再说"在这里没有落点。
 */
export async function runExamEvaluation(request: ExamRunRequest): Promise<ExamRunOutcome> {
  const decision = assertPaidRunAllowed(request.plan, { requests: request.request.requests, estimatedCostUsd: request.request.estimatedCostUsd })
  if (!decision.ok) return { ok: false, reason: decision.reason }
  if (request.plan.authorization.grantedBy !== request.request.grantedBy) {
    return { ok: false, reason: `这次请求声称的授权人（${request.request.grantedBy}）与冻结表里记的（${request.plan.authorization.grantedBy ?? "（没有）"}）不一致。` }
  }

  const cases = [...EXAM_CASES, ...HELD_OUT_CASES]
  const observations: ExamTrialObservation[] = []
  for (const examCase of cases) {
    for (let trial = 1; trial <= request.plan.trialsPerCase; trial += 1) {
      const started = Date.now()
      const result = await request.runCase(examCase, trial)
      observations.push({
        caseId: examCase.id,
        family: examCase.family,
        trial,
        outcome: result.outcome,
        ...(result.readability === undefined ? {} : { readability: result.readability }),
        latencyMs: result.latencyMs ?? Date.now() - started,
        costUsd: result.costUsd,
        ...(result.detail === undefined ? {} : { detail: result.detail })
      })
    }
  }
  const report = summarizeExamEvaluation(request.plan, observations, { provider: request.request.provider, model: request.request.model })
  const maxCostUsd = request.plan.authorization.maxCostUsd ?? 0
  if (report.totals.costUsd > maxCostUsd) {
    return { ok: false, reason: `实际费用 $${report.totals.costUsd} 超过授权的最高费用 $${maxCostUsd} —— 这一轮如实报超支，报告仍然给你（见 detail）。\n${JSON.stringify(report)}` }
  }
  return { ok: true, report }
}
