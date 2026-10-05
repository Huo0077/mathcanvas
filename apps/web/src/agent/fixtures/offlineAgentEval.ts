import { createEmptyDocument } from "@draw/dsl"
import { buildLayoutModel, compilePlan, type PlannerPort } from "@draw/agent-core"
import { createLocalPlanner } from "../localPlanner"
import { AGENT_TASK_FIXTURES } from "./agentTaskFixtures"
import { evaluateAgentTask } from "./agentTaskJudge"
import { scoreAgentAttempts, type AgentEvalAttempt, type AgentEvalScorecard } from "./agentEvalRunner"

export interface OfflineEvalResult {
  mode: "deterministic_local"
  attempts: AgentEvalAttempt[]
  scorecard: AgentEvalScorecard
}

/**
 * **一次尝试**：把一条 fixture 走一遍"规划 → 编译 → 判题"。
 *
 * ## 规划器是**参数**，不是写死的（2026-10-05 抽出）
 *
 * 离线评测与**真实 provider 评测**要跑的是同一件事，唯一区别就是那一个 `PlannerPort`。
 * 抽出之前这段逻辑只在 `runOfflineAgentEval` 里，真实那一侧要么抄一份、要么没有 ——
 * **抄一份就等于两套判题口径**（编译选项、`toolErrors` 怎么算、布局读数从哪来，全都会各自漂）。
 *
 * 参数是**工厂**而不是实例：原来每次尝试都 `createLocalPlanner()` 一个新实例，
 * 这里保持同样的语义（真实规划器那侧也因此每次重新解析 provider、拿新的 runId）。
 */
export async function runOneEvalAttempt(createPlanner: () => PlannerPort, fixtureId: string, trial: 1 | 2 | 3): Promise<AgentEvalAttempt> {
  const fixture = AGENT_TASK_FIXTURES.find((entry) => entry.id === fixtureId)!
  const started = Date.now()
  const document = createEmptyDocument("geometry3d")
  const envelope = (await createPlanner().plan({ userMessage: fixture.prompt } as never)).plan
  const compiled = compilePlan(envelope, { document, prompt: fixture.prompt, conversationId: `eval-${trial}`, documentGeneration: document.revision })
  /**
   * **布局读数来自候选文档本身**（Phase 4）：它是纯本地的，不依赖 provider vision、
   * 不依赖浏览器。因此视觉类任务（"对象有没有被裁掉""标签有没有叠在一起"）
   * 在这里能被真的判定，而不是一律 `not_supported`。
   *
   * 注意它在**编译失败**（`draftDocument` 为 null）时缺省 —— 那种情况下
   * 判题器会如实报 `not_supported`，而不是拿空文档去算一个"没问题"。
   */
  const layout = compiled.ok && compiled.draftDocument ? buildLayoutModel(compiled.draftDocument as never) : undefined
  const report = evaluateAgentTask(fixture, { phase: compiled.ok ? "awaiting_confirmation" : "failed", candidate: compiled.draftDocument, ...(layout === undefined ? {} : { layout }) })
  return { fixtureId, trial, report, toolCalls: fixture.expected.toolIntent, toolErrors: compiled.ok ? 0 : 1, durationMs: Math.max(0, Date.now() - started) }
}

/**
 * **把整套 fixture 跑满轮数**（离线与真实 provider 共用同一条扫描）。
 *
 * `costUsd` 在这里**不填** —— 它要价目表，而仓里没有（见 `providerAgentEval.ts` 的说明）。
 * 填一个猜出来的钱数，比留空坏得多：`scoreAgentAttempts` 只有在**每次成功尝试都带成本**时
 * 才给平均值，所以留空会让报告如实显示 `not measured`。
 */
export async function runEvalSweep(createPlanner: () => PlannerPort, trials: 1 | 3): Promise<AgentEvalAttempt[]> {
  const attempts: AgentEvalAttempt[] = []
  for (const fixture of AGENT_TASK_FIXTURES) {
    for (const trial of (trials === 1 ? [1] as const : [1, 2, 3] as const)) attempts.push(await runOneEvalAttempt(createPlanner, fixture.id, trial))
  }
  return attempts
}

export async function runOfflineAgentEval(trials: 1 | 3 = 3): Promise<OfflineEvalResult> {
  const attempts = await runEvalSweep(() => createLocalPlanner(), trials)
  return { mode: "deterministic_local", attempts, scorecard: scoreAgentAttempts(AGENT_TASK_FIXTURES, attempts) }
}
