import type { PlannerPort } from "@draw/agent-core"

import { createModelPlanner, resolveActiveProvider, type ProviderResolution } from "../modelPlanner"
import { AGENT_TASK_FIXTURES } from "./agentTaskFixtures"
import { scoreAgentAttempts, type AgentEvalAttempt, type AgentEvalScorecard } from "./agentEvalRunner"
import { runEvalSweep } from "./offlineAgentEval"

/**
 * **真实 provider 的评测 harness**（发布门禁第 2 条；方案 C：harness 在应用内跑）。
 *
 * ## 它补的是哪个洞
 *
 * 记分卡那一行 `Real provider | not measured` —— 因为评测一直只有
 * `deterministic_local` 一条腿（本地规划器，不是模型）。这里把**同一条扫描**接到真实规划器上：
 * `createModelPlanner` → 回环代理（`/v1/runs/{id}/model`）→ provider，
 * **密钥在 Rust 侧从凭据库借出**，前端与这个 harness 都碰不到它。
 *
 * ## 三条不许含糊的规矩
 *
 * 1. **取不到 provider 就一次请求都不发**，并**如实报原因码**（`no_active_profile` / `no_secret` /
 *    `no_desktop_shell` / `ipc_failed` / `secret_not_allowed`）。没配好就发请求，既浪费钱，
 *    又会让"没测"变成"测了但没数"；
 * 2. **成本不许编**：这条通道里有 `usage`（`kind: "usage"` 带 inputTokens/outputTokens），
 *    但**仓里没有价目表**，所以 `costUsd` 一律不填 ⇒ 报告显示 `not measured`。
 *    （记分卡的 `REAL_PROVIDER_GAPS` 已经把 "provider-billed cost" 列为未测项，两者一致。）
 * 3. **它不发请求除非被显式调用** —— 没有定时器、没有模块级副作用；触发点在界面上，
 *    而且要先告诉用户会发几次请求（8 题 × 轮数）。
 */
export interface ProviderEvalResult {
  mode: "real_provider"
  /** provider 是谁（解析成功时）；解析失败时 `null`。 */
  provider: { id: string; modelId: string } | null
  /** **没测的原因**（解析失败时）。成功时 `null` —— 这两个字段互斥，不会两个都空。 */
  unavailable: { code: string; detail: string } | null
  /** 一次请求都没发时这里是**空数组**（不是"跑了 0 分"）。 */
  attempts: AgentEvalAttempt[]
  /** 没测时是 `null`，**不是**一个 0 分的记分卡。 */
  scorecard: AgentEvalScorecard | null
}

export interface ProviderEvalDependencies {
  /** 现取「使用中」的那一份。缺省走真实 IPC（`resolveActiveProvider`）。 */
  resolveProvider?: () => Promise<ProviderResolution>
  /** 造一个规划器。缺省接真实 provider；用例注入本地规划器就能确定性地跑完整条扫描。 */
  createPlanner?: (resolution: Extract<ProviderResolution, { ok: true }>) => PlannerPort
}

/**
 * 跑一轮真实 provider 评测。
 *
 * **先解析 provider，再决定要不要跑** —— 顺序是刻意的：解析失败时连规划器都不造，
 * 于是"没配好"这件事在**类型上**就不可能变成一次网络请求。
 */
export async function runProviderAgentEval(trials: 1 | 3 = 3, dependencies: ProviderEvalDependencies = {}): Promise<ProviderEvalResult> {
  const resolveProvider = dependencies.resolveProvider ?? resolveActiveProvider
  const resolution = await resolveProvider()

  if (!resolution.ok) {
    return { mode: "real_provider", provider: null, unavailable: { code: resolution.code, detail: resolution.detail }, attempts: [], scorecard: null }
  }

  const createPlanner = dependencies.createPlanner ?? ((resolved) => createModelPlanner({ resolveProvider: async () => resolved }))
  const attempts = await runEvalSweep(() => createPlanner(resolution), trials)

  return {
    mode: "real_provider",
    provider: { id: resolution.provider.id, modelId: resolution.provider.modelId },
    unavailable: null,
    attempts,
    scorecard: scoreAgentAttempts(AGENT_TASK_FIXTURES, attempts)
  }
}
