import { EXAM_CASES, EXAM_FAMILIES, HELD_OUT_CASES, type ExamCase, type ExamFamily } from "./examSet"

/**
 * **Task 20 的"先冻结"**：在看到任何付费结果**之前**，把四族的样本、阈值与授权额度写死。
 *
 * ## 计划原文（逐字）
 *
 * > "**真实质量验收**：四族 Task 11–16 各有端到端真图后，先离线拆出 plan/schema/构造/核验/
 * > 可读性的失败分布；**在**看到付费结果前冻结每族样本、pass@1/pass@3 与人评/延迟/费用阈值
 * > 并取得用户对请求数及最高费用的授权，方可运行真实 provider。"
 *
 * > **停止条件**：用户未同意请求数和最高费用，**或样本/阈值未预先冻结**，就停在 Task 20。
 *
 * ## 为什么把它写成代码而不是一份文档
 *
 * "阈值是事先定好的"这句话，只有**能证明它与付费观测的顺序**才有意义。文档说不清这件事
 * （谁都能事后改一行），所以冻结做成一个**类型化的常量**：
 *
 * - `frozenOn` 是冻结日期，`paidRuns` 是**冻结时已有的付费观测数** —— 它必须是 `0`，
 *   否则就不是"事先冻结"，而是"看完结果再定线"；
 * - `authorization` 默认 `pending`，而 `assertPaidRunAllowed` 在 `pending` 时**一律拒**：
 *   计划的停止条件由这一个函数承担，不靠谁记得住；
 * - 阈值按**族**给，样本按**题号**（`devCaseIds` / `holdoutCaseIds`）冻结 —— 冻结"8 条"
 *   这种说法挡不住换题（`assertExamSet` 只查来源与泄漏，不查"是不是同一批题"）。
 *
 * ## 已知的边界（如实写在这里）
 *
 * 随仓的真题用例**一条 oracle 都没有**（`verifiedGoldCaseIds` 为空且被钉住）：所以
 * "离线失败分布"只能拆到**能不能规划/编译/核验**这一层，拆不到"答案对不对"那一层。
 * 要判"答案对不对"必须有独立复核过的答案，那是另一件事（不是本任务偷偷造一个金标）。
 */

/** 一道冻结样本。 */
export interface FrozenSample {
  caseId: string
  set: "dev" | "holdout"
  /**
   * **这一道题今天离线能不能碰**（实测值，`apps/web/src/agent/fixtures/frozenThresholds.local.test.ts` 逐条核对）：
   *
   * - `local-fixture`：本地规划器**会回应**这条题面 —— 但它给的是**自己的夹具图**（不是按这条题面
   *   构造的）⇒ 离线**判不了这道题**，这条读数只说明"离线会不会硬答"；
   * - `provider-required`：本地规划器**不回应** ⇒ 只有真实 provider 才谈得上。
   *
   * **同一族里两档都会出现**（实测：立体那一族三条里有一条会被夹具接走），所以这一栏在
   * **每道题**上，不在族上。两档都**不能**当成"离线跑通了"：夹具题面与真题题面不是同一道题。
   */
  offlineAttemptability: "local-fixture" | "provider-required"
}

/** 一族的冻结内容。 */
export interface FamilyFreeze {
  family: ExamFamily
  /** 样本：**逐题**冻住（题号 + 开发/留出 + 离线可跑性）。 */
  samples: readonly FrozenSample[]
  /** **事先定好的**验收线（不是跑完再挑一个好听的数）。 */
  thresholds: {
    /** 一次成功（pass@1）至少要多少。 */
    passAt1: number
    /** 三次独立成功里至少成功一次（pass@3）。 */
    passAt3: number
    /** 人评里 `unreadable` 的比例上限。 */
    unreadableMax: number
    /** 单题延迟上限（秒，p95）。 */
    latencyP95SecondsMax: number
    /** 单题费用上限（美元）。 */
    costUsdMaxPerCase: number
  }
}

export interface FrozenBenchmarkPlan {
  /** 冻结日期。**必须早于任何付费观测。** */
  frozenOn: string
  /** 冻结时已有的**付费**观测数（必须为 `0`）。 */
  paidRuns: number
  /** 每题跑几次（pass@3 要三次**独立**成功，不是同一轮里修三次）。 */
  trialsPerCase: number
  /**
   * **付费授权**。默认 `pending` —— 没点头就一个请求都不发。
   *
   * 用户点头时要填三样：`status: "granted"`、`maxRequests`（请求数上限）、
   * `maxCostUsd`（最高费用）。缺任何一样，`assertPaidRunAllowed` 仍然拒。
   */
  authorization: {
    status: "pending" | "granted"
    maxRequests?: number
    maxCostUsd?: number
    /** 谁点的头（人，不是系统自己）。 */
    grantedBy?: string
    grantedOn?: string
  }
  families: readonly FamilyFreeze[]
}

/**
 * **四族的冻结表**（2026-10-12 冻结，此时付费观测数为 0）。
 *
 * 阈值取得**保守**是有意的：它们是"事先声明的验收线"，跑完再改就是自欺。
 * 四条族线的取值理由写在每一族旁边 —— 一个数字不给理由，下一个人只会照着它改。
 */
export const FROZEN_THRESHOLDS: FrozenBenchmarkPlan = {
  frozenOn: "2026-10-12",
  paidRuns: 0,
  trialsPerCase: 3,
  authorization: { status: "pending" },
  families: [
    {
      family: "triangle",
      samples: [
        { caseId: "exam-triangle-2021-new-gaokao-i-19", set: "dev", offlineAttemptability: "provider-required" },
        { caseId: "exam-triangle-2024-new-curriculum-i-15", set: "dev", offlineAttemptability: "provider-required" },
        { caseId: "held-triangle-2022-new-gaokao-i-18", set: "holdout", offlineAttemptability: "provider-required" }
      ],
      thresholds: { passAt1: 0.5, passAt3: 0.75, unreadableMax: 0.2, latencyP95SecondsMax: 120, costUsdMaxPerCase: 0.25 }
    },
    {
      family: "conic",
      samples: [
        { caseId: "exam-conic-2022-new-gaokao-i-21", set: "dev", offlineAttemptability: "provider-required" },
        { caseId: "exam-conic-2024-new-curriculum-i-16", set: "dev", offlineAttemptability: "provider-required" },
        { caseId: "held-conic-2025-new-gaokao-ii-16", set: "holdout", offlineAttemptability: "provider-required" }
      ],
      thresholds: { passAt1: 0.5, passAt3: 0.75, unreadableMax: 0.2, latencyP95SecondsMax: 120, costUsdMaxPerCase: 0.25 }
    },
    {
      family: "function",
      samples: [
        { caseId: "exam-function-2021-new-gaokao-i-7", set: "dev", offlineAttemptability: "provider-required" },
        { caseId: "exam-function-2024-new-curriculum-i-13", set: "dev", offlineAttemptability: "provider-required" },
        { caseId: "held-function-2025-new-gaokao-ii-18", set: "holdout", offlineAttemptability: "provider-required" }
      ],
      thresholds: { passAt1: 0.5, passAt3: 0.75, unreadableMax: 0.2, latencyP95SecondsMax: 150, costUsdMaxPerCase: 0.25 }
    },
    {
      family: "solid",
      samples: [
        /**
         * **实测（2026-10-12）**：`正四棱柱中多条棱上的点构成的空间关系。` 会命中本地规划器的
         * 棱柱夹具 ⇒ `local-fixture`。它给的是**夹具那只正棱柱**，不是这道题；而这条用例自己的
         * `requiredFigure` 恰好写着"不能用假定立方体遮蔽原题条件" —— 直接照"离线有回应"记成
         * "跑通"就会踩中它。同族另两条本地不回应。
         */
        { caseId: "exam-solid-2023-new-curriculum-i-18", set: "dev", offlineAttemptability: "local-fixture" },
        { caseId: "exam-solid-2025-new-gaokao-ii-17", set: "dev", offlineAttemptability: "provider-required" },
        { caseId: "held-solid-2021-zhejiang-19", set: "holdout", offlineAttemptability: "provider-required" }
      ],
      // 立体那一族最贵（题面长、动作多、见证搜索会多跑几代）⇒ 延迟与费用上限放宽一档。
      thresholds: { passAt1: 0.5, passAt3: 0.75, unreadableMax: 0.2, latencyP95SecondsMax: 240, costUsdMaxPerCase: 0.4 }
    }
  ]
}

/** 冻结表覆盖到的全部样本（开发集 + 留出集）。 */
export function frozenCaseIds(plan: FrozenBenchmarkPlan = FROZEN_THRESHOLDS): string[] {
  return plan.families.flatMap((entry) => entry.samples.map((sample) => sample.caseId))
}

/** 某道冻结样本（找不到返回 `null`）。 */
export function frozenSample(caseId: string, plan: FrozenBenchmarkPlan = FROZEN_THRESHOLDS): FrozenSample | null {
  for (const entry of plan.families) {
    const found = entry.samples.find((sample) => sample.caseId === caseId)
    if (found !== undefined) return found
  }
  return null
}

export interface PaidRunRequest {
  requests: number
  estimatedCostUsd: number
}

export type PaidRunDecision = { ok: true; granted: { maxRequests: number; maxCostUsd: number } } | { ok: false; reason: string }

/**
 * **这一次能不能真的去打 provider**（Task 20 的停止条件，落成函数）。
 *
 * 四道门，缺一不可：
 *
 * 1. **先冻结**：`paidRuns` 必须为 `0`（否则阈值是看完结果再定的）；
 * 2. **先授权**：`authorization.status` 必须是 `granted`；
 * 3. **额度要写清**：`maxRequests` 与 `maxCostUsd` 都得是正数，且 `grantedBy` 得有人；
 * 4. **这次请求不许超**. 请求数或预估费用超一个，就拒 —— 不是"先花着再说"。
 */
export function assertPaidRunAllowed(plan: FrozenBenchmarkPlan, request: PaidRunRequest): PaidRunDecision {
  if (plan.paidRuns !== 0) {
    return { ok: false, reason: `阈值不是事先冻结的：冻结时已经有 ${plan.paidRuns} 次付费观测 —— 看完结果再定的线不算验收线。` }
  }
  const authorization = plan.authorization
  if (authorization.status !== "granted") {
    return { ok: false, reason: "还没有拿到付费授权（`authorization.status` 仍是 pending）—— 计划的停止条件：未同意请求数与最高费用就不跑真实 provider，也不跳到 Task 21。" }
  }
  const maxRequests = authorization.maxRequests
  const maxCostUsd = authorization.maxCostUsd
  if (typeof maxRequests !== "number" || !Number.isFinite(maxRequests) || maxRequests <= 0 || typeof maxCostUsd !== "number" || !Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
    return { ok: false, reason: "授权里没有写清请求数上限与最高费用（两个都要正数）—— 缺一个就不跑。" }
  }
  if (typeof authorization.grantedBy !== "string" || authorization.grantedBy.trim().length === 0) {
    return { ok: false, reason: "授权没写是谁点的头（`grantedBy`）—— 系统不许自己给自己授权。" }
  }
  if (!Number.isInteger(request.requests) || request.requests <= 0) {
    return { ok: false, reason: `请求数必须是不小于 1 的整数，收到 ${request.requests}。` }
  }
  if (request.requests > maxRequests) {
    return { ok: false, reason: `这次要发 ${request.requests} 个请求，超过授权的 ${maxRequests} 个。` }
  }
  if (request.estimatedCostUsd > maxCostUsd) {
    return { ok: false, reason: `这次预估 $${request.estimatedCostUsd}，超过授权的最高费用 $${maxCostUsd}。` }
  }
  return { ok: true, granted: { maxRequests, maxCostUsd } }
}

/** 冻结表里那一族（找不到返回 `null`）。 */
export function familyFreeze(family: ExamFamily, plan: FrozenBenchmarkPlan = FROZEN_THRESHOLDS): FamilyFreeze | null {
  return plan.families.find((entry) => entry.family === family) ?? null
}

/** 某个题号属于哪一族的冻结样本（不属于任何一族返回 `null`）。 */
export function frozenFamilyOf(caseId: string, plan: FrozenBenchmarkPlan = FROZEN_THRESHOLDS): ExamFamily | null {
  for (const entry of plan.families) {
    if (entry.samples.some((sample) => sample.caseId === caseId)) return entry.family
  }
  return null
}

/** 冻结表引用的题号在**随仓的题集**里对应的用例（找不到返回 `null`）—— 判据用它核对"是不是同一批题"。 */
export function examCaseFor(caseId: string): ExamCase | null {
  return [...EXAM_CASES, ...HELD_OUT_CASES].find((entry) => entry.id === caseId) ?? null
}

/** 族的闭集（与 `examSet` 同一份，不另写一遍）。 */
export const FROZEN_FAMILIES: readonly ExamFamily[] = EXAM_FAMILIES
