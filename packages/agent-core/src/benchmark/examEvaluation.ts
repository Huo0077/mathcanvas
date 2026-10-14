import { EXAM_CASES, HELD_OUT_CASES, type ExamCase, type ExamFamily } from "./examSet"
import { assertPaidRunAllowed, frozenSample, FROZEN_THRESHOLDS, type FrozenBenchmarkPlan } from "./frozenThresholds"
import type { PlanStage } from "../contracts"

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
  /** **没画出图来**：模型给的不是计划，或者编译/题设核验没过（具体卡在哪一层见 `failureLayer`）。 */
  | "rejected"
  /** 这一层自己出岔子。 */
  | "error"
  /** 没跑到（预算/墙钟用尽）。 */
  | "not_measured"

export const EXAM_SUCCESS_OUTCOMES: readonly ExamTrialOutcome[] = ["planned"]
export const EXAM_REPAIRED_OUTCOME: ExamTrialOutcome = "planned_after_repair"

/**
 * **失败落在哪一层**（计划点名的五层里，机器判得了的那四层）。
 *
 * 第五层是**可读性**：它只有人真的标过才有值（`ExamTrialObservation.readability`）——
 * 把"没标"塞进这个枚举，就等于替人评编一个读数。
 */
export type ExamFailureLayer = "plan" | "schema" | "construct" | "verify"

/**
 * **六层编译 → 四层验收**（`PlanStage` 的六层并成两层）。
 *
 * 传进来的必须**按编译顺序**排（`compilePlan` 的 `diagnostics` 本来就是那个顺序），
 * 只看**第一条**错误诊断落在哪一层。「卡在哪一层」问的是**最早**卡住的地方 ——
 * 把后面几层一起算进来，会让一条 `transport` 错误被记成"构造也没过"。
 *
 * 合档的理由：六层里没有五、六个验收位。前四层（传输解析 / 字段审计 / 引用解析 /
 * 参数补全）说的是「这份计划根本不是一份合法计划」（`schema`）；后两层
 * （几何语义校验 / 动作编译）说的是「计划合法、但图造不出来」（`construct`）。
 *
 * **空数组 ⇒ `null`**（编译器没给原因）：层名定不出来时报告里就如实少一栏，
 * 不拿一个猜的层名把账凑平。
 */
export function examFailureLayerForStages(stages: readonly PlanStage[]): ExamFailureLayer | null {
  const first = stages[0]
  if (first === undefined) return null
  return first === "geometry_validation" || first === "action_compile" ? "construct" : "schema"
}

/**
 * **同轮修复这一轮有没有被判过**（由调用方声明，这一层不猜）。
 *
 * - `coordinator-driven`：这一跑的 `runCase` 走的是协调器那条**带修复回路**的路径，
 *   所以 `planned_after_repair` 有可能出现；
 * - `not-driven`：只做了「一次规划 + 一次编译」（没有第二次问模型的机会）。这时
 *   `repairedCount` 必为 0，而它的含义是「**这一轮没走协调器**」，**不是**「没有发生过修复」
 *   —— 两句话不能混：前者是关于**这次测量**的事实，后者是关于**产品**的断言。
 */
export type ExamRepairPath = "coordinator-driven" | "not-driven"

/** 一次尝试的**原始事实** —— 映射成结局与失败层所需要的全部输入。 */
export interface ExamAttemptFacts {
  kind: "plan" | "clarification" | "answer" | "error"
  /**
   * **同一轮里修过一次**才成。只有走协调器那条路才可能为 `true`
   * （修复发生在协调器的编译回路里，单次 `plan()` 的端口看不到它）。
   */
  repaired?: boolean
  /**
   * 这份计划在**编译器**那儿的结局。**只有 `kind: "plan"` 时才有**。
   *
   * 缺省 = **没编译过**（端口那一层只看得到规划）：那时按旧口径记 `planned`，
   * 但这**不是**"编译也过了"，而是"压缩机没跑" —— 所以付费那一跑必须给这一栏，
   * 否则报告会把"没量"读成"量了、而且过了"。
   */
  compile?: {
    /** `compilePlan(...).ok`。 */
    accepted: boolean
    /** **按编译顺序**排的错误级诊断层名（`severity === "error"`）。空数组 = 编译器没给原因。 */
    errorStages: readonly PlanStage[]
    /** 题设核验的结局（`compiled.diagramVerification?.status`）；**没有那一栏时不写这个键**。 */
    verification?: "passed" | "failed" | "unverified"
  }
}

export interface ExamAttemptVerdict {
  outcome: ExamTrialOutcome
  /** 失败落在哪一层；**成功、问路、这一层自己出错都不写这一栏**（层名无从谈起）。 */
  failureLayer?: ExamFailureLayer
}

/**
 * **一次尝试的原始事实 → 结局 + 失败层**（Task 20 唯一的一处判定）。
 *
 * 判据的次序就是产品那条链路的次序：
 *
 * 1. 规划器抛了 ⇒ `error`（这一层自己出岔子，谈不到"卡在哪一层"）；
 * 2. 模型反问 ⇒ `clarification`；
 * 3. 模型回了一段解释而不是计划 ⇒ `rejected`，层名 `plan`（**没走到编译器**）；
 * 4. 计划进了编译器：`!accepted` ⇒ `rejected`，层名取自**第一条**错误诊断
 *    （`examFailureLayerForStages`；诊断缺失 ⇒ 不写层名）；
 * 5. 编译过了但**题设核验**不是 `passed` ⇒ `rejected`，层名 `verify` ——
 *    这一条与产品的提交闸同一条判据（`hostBridge`：核验不是 `passed` 就不许提交，
 *    面板上确认按钮也不出现）；
 * 6. 其余 ⇒ `planned`（修过一次才成的记 `planned_after_repair`，**单独一档**）。
 */
export function examTrialVerdictOf(facts: ExamAttemptFacts): ExamAttemptVerdict {
  if (facts.kind === "error") return { outcome: "error" }
  if (facts.kind === "clarification") return { outcome: "clarification" }
  if (facts.kind === "answer") return { outcome: "rejected", failureLayer: "plan" }
  const compiled = facts.compile
  if (compiled !== undefined) {
    if (!compiled.accepted) {
      const layer = examFailureLayerForStages(compiled.errorStages)
      return layer === null ? { outcome: "rejected" } : { outcome: "rejected", failureLayer: layer }
    }
    if (compiled.verification !== undefined && compiled.verification !== "passed") {
      return { outcome: "rejected", failureLayer: "verify" }
    }
  }
  return { outcome: facts.repaired === true ? EXAM_REPAIRED_OUTCOME : "planned" }
}

/**
 * **只要结局**（同一条判据的另一半读法，给不需要层名的调用方）。
 *
 * 保留这个名字是因为它已经在多个调用方与用例里出现；实现**就是**上面那一处判定，
 * 不另写一份 —— 两份判据必然分叉。
 */
export function examTrialOutcomeOf(facts: ExamAttemptFacts): ExamTrialOutcome {
  return examTrialVerdictOf(facts).outcome
}

export interface ExamTrialObservation {
  caseId: string
  family: ExamFamily
  /** 第几次独立试验（1..trialsPerCase）。 */
  trial: number
  outcome: ExamTrialOutcome
  /** 失败落在哪一层（只有非成功结局才可能有；编译器没给原因时**不写这一栏**）。 */
  failureLayer?: ExamFailureLayer
  /** **人评**才填；没标注就没这一栏（不许用模型自评冒充）。 */
  readability?: "readable" | "partly" | "unreadable"
  latencyMs: number
  /**
   * 这一次试验花了多少钱。**没测出来就是 `null`**（不是 0）——
   * 仓里**没有价目表**，从 provider 拿到的只有用量（token 数），拿不到钱；
   * 把"算不出"记成 0 会让费用那条阈值**凭空通过**（0 ≤ $0.25 永远成立）。
   * 与"人评没标就是 `null`"同一条口径：**没测就不算过**。
   */
  costUsd: number | null
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
  /** 这一族的费用合计；**有一次试验算不出钱就是 `null`**（见 `ExamTrialObservation.costUsd`）。 */
  costUsd: number | null
  /** 人评 `unreadable` 的比例；**没标注就是 `null`**。 */
  unreadableShare: number | null
  /** 非成功**结局**的分布（按结局计数：clarification / rejected / error / not_measured）。 */
  failureStages: Record<string, number>
  /**
   * **失败落在哪一层**的分布（按层计数）。与 `failureStages` 是两个问题：
   * 前者说"结局是什么"，这一栏说"**卡在哪一层**"（计划原文点名的五层里的机器那四层）。
   *
   * **它可能比 `failureStages` 里的失败条数少** —— 编译器没给错误诊断时层名定不出来，
   * 那一档如实不出现在这里（宁可少一栏，也不猜一个层名）。
   */
  failureLayers: Partial<Record<ExamFailureLayer, number>>
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
  /** 总计：**费用有一次算不出就是 `null`**（见 `ExamTrialObservation.costUsd`）。 */
  totals: { requests: number; costUsd: number | null; passAt1: number; passAt3: number; repairedCount: number }
  /** 逐条对照**事先冻结**的阈值；过不了线就报过不了。 */
  verdicts: ExamVerdict[]
  /**
   * **同轮修复这一轮有没有被判过**（由调用方声明，报告原样带出来）。
   *
   * `not-driven` 时 `repairedCount` 必为 0 —— 读者据此才能把"这一轮没走协调器"
   * 与"没有修复发生过"分开（前者是关于这次测量的事实，后者是对产品的断言）。
   */
  repairPath: ExamRepairPath
  authorization: { requests: number; maxCostUsd: number; grantedBy: string; grantedOn: string }
}

export interface ExamEvaluationContext {
  provider: string
  model: string
  /** 这一跑的 `runCase` 走没走协调器那条带修复的路径（声明式，见 `ExamRepairPath`）。 */
  repairPath: ExamRepairPath
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
  /**
   * **声明与观测必须自洽**：说了"这一轮没走协调器"，就不可能记下"同轮修复"。
   *
   * 两边矛盾时**抛**而不是取一个：这一条正是适配器那条边界要挡住的事 ——
   * 让 `repairedCount` 的 0 只可能是"没走协调器"，不可能是"修复发生了、但没接上标记"。
   */
  if (context.repairPath === "not-driven" && observations.some((observation) => observation.outcome === EXAM_REPAIRED_OUTCOME)) {
    throw new Error("这一轮声明没走协调器，却记下了「同轮修复」—— 声明与观测必有一处在编。")
  }

  const families: ExamFamilyResult[] = expected.map((entry) => {
    const familyObservations = observations.filter((observation) => observation.family === entry.family)
    const casesWithTrial1Success = entry.cases.filter((caseId) => familyObservations.some((observation) => observation.caseId === caseId && observation.trial === 1 && EXAM_SUCCESS_OUTCOMES.includes(observation.outcome)))
    const casesWithAnySuccess = entry.cases.filter((caseId) => familyObservations.some((observation) => observation.caseId === caseId && EXAM_SUCCESS_OUTCOMES.includes(observation.outcome)))
    const repaired = entry.cases.filter((caseId) => familyObservations.some((observation) => observation.caseId === caseId && observation.outcome === EXAM_REPAIRED_OUTCOME))
    const annotated = familyObservations.filter((observation) => observation.readability !== undefined)
    const failureStages: Record<string, number> = {}
    const failureLayers: Partial<Record<ExamFailureLayer, number>> = {}
    for (const observation of familyObservations) {
      if (EXAM_SUCCESS_OUTCOMES.includes(observation.outcome) || observation.outcome === EXAM_REPAIRED_OUTCOME) continue
      failureStages[observation.outcome] = (failureStages[observation.outcome] ?? 0) + 1
      // 层名定不出来的那一档**不编**（见 `failureLayers` 的注释）：这里只数真的给出了层名的。
      const layer = observation.failureLayer
      if (layer !== undefined) failureLayers[layer] = (failureLayers[layer] ?? 0) + 1
    }
    return {
      family: entry.family,
      cases: entry.cases.length,
      trials: familyObservations.length,
      passAt1: entry.cases.length === 0 ? 0 : casesWithTrial1Success.length / entry.cases.length,
      passAt3: entry.cases.length === 0 ? 0 : casesWithAnySuccess.length / entry.cases.length,
      repairedCount: repaired.length,
      p95LatencyMs: percentile95(familyObservations.map((observation) => observation.latencyMs)),
      /**
       * **有一次算不出钱，这一族的合计就是 `null`** —— 不拿"已有的那几次"求和冒充合计
       *（那会把"没测"摊薄成一个看起来偏小的数，正好往阈值那边靠）。
       */
      costUsd: familyObservations.some((observation) => observation.costUsd === null)
        ? null
        : familyObservations.reduce((sum, observation) => sum + (observation.costUsd ?? 0), 0),
      unreadableShare: annotated.length === 0 ? null : annotated.filter((observation) => observation.readability === "unreadable").length / annotated.length,
      failureStages,
      failureLayers
    }
  })

  const verdicts: ExamVerdict[] = []
  for (const family of families) {
    const freeze = plan.families.find((entry) => entry.family === family.family)!
    const thresholds = freeze.thresholds
    const costPerCase = family.cases === 0 || family.costUsd === null ? null : family.costUsd / family.cases
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
      /** 同上：**有一次算不出钱，总计就是 `null`**（不拿部分和冒充合计）。 */
      costUsd: observations.some((observation) => observation.costUsd === null)
        ? null
        : observations.reduce((sum, observation) => sum + (observation.costUsd ?? 0), 0),
      passAt1: allCases === 0 ? 0 : successesAt1.length / allCases,
      passAt3: allCases === 0 ? 0 : successesAny.length / allCases,
      repairedCount: families.reduce((sum, family) => sum + family.repairedCount, 0)
    },
    verdicts,
    repairPath: context.repairPath,
    authorization: { requests: observations.length, maxCostUsd: plan.authorization.maxCostUsd ?? 0, grantedBy: plan.authorization.grantedBy ?? "", grantedOn: plan.authorization.grantedOn ?? "" }
  }
}

/** **请求清单**（给用户点头用的分母：多少请求、最坏多少钱）。 */export interface ExamRequestPlan {
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
  /** 失败落在哪一层（同一套四层；成功 / 问路 / 出错不写这一栏）。 */
  failureLayer?: ExamFailureLayer
  readability?: ExamTrialObservation["readability"]
  /**
   * 这一次花了多少钱；**算不出来就填 `null`**（仓里没有价目表时这是唯一诚实的写法，
   * 见 `ExamTrialObservation.costUsd`）—— 填 0 会让费用阈值凭空通过。
   */
  costUsd: number | null
  /** 没给就用墙钟实测。 */
  latencyMs?: number
  detail?: string
}

export interface ExamRunRequest {
  plan: FrozenBenchmarkPlan
  /** 这次请求的额度与「谁点的头」——它必须落在 `plan.authorization` 之内。 */
  request: { provider: string; model: string; requests: number; estimatedCostUsd: number; grantedBy: string; grantedOn: string; repairPath: ExamRepairPath }
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
        ...(result.failureLayer === undefined ? {} : { failureLayer: result.failureLayer }),
        ...(result.readability === undefined ? {} : { readability: result.readability }),
        latencyMs: result.latencyMs ?? Date.now() - started,
        costUsd: result.costUsd,
        ...(result.detail === undefined ? {} : { detail: result.detail })
      })
    }
  }
  const report = summarizeExamEvaluation(request.plan, observations, { provider: request.request.provider, model: request.request.model, repairPath: request.request.repairPath })
  const maxCostUsd = request.plan.authorization.maxCostUsd ?? 0
  /**
   * **超支核对只在"钱算得出来"时才做**：`totals.costUsd === null` 表示仓里没有价目表、
   * 这一轮**没有可用的费用读数** —— 那时既不能说"没超"，也不能拿它去拦下整轮
   * （报告照样给你，费用那一栏如实是 `null`、那条阈值如实不通过）。
   */
  if (report.totals.costUsd !== null && report.totals.costUsd > maxCostUsd) {
    return { ok: false, reason: `实际费用 $${report.totals.costUsd} 超过授权的最高费用 $${maxCostUsd} —— 这一轮如实报超支，报告仍然给你（见 detail）。\n${JSON.stringify(report)}` }
  }
  return { ok: true, report }
}
