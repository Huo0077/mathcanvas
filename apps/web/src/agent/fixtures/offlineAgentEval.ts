import { createEmptyDocument } from "@draw/dsl"
import { buildLayoutModel, compilePlan } from "@draw/agent-core"
import { createLocalPlanner } from "../localPlanner"
import { AGENT_TASK_FIXTURES } from "./agentTaskFixtures"
import { evaluateAgentTask } from "./agentTaskJudge"
import { scoreAgentAttempts, type AgentEvalAttempt, type AgentEvalScorecard } from "./agentEvalRunner"

export interface OfflineEvalResult {
  mode: "deterministic_local"
  attempts: AgentEvalAttempt[]
  scorecard: AgentEvalScorecard
}

async function oneAttempt(fixtureId: string, trial: 1 | 2 | 3): Promise<AgentEvalAttempt> {
  const fixture = AGENT_TASK_FIXTURES.find((entry) => entry.id === fixtureId)!
  const started = Date.now()
  const document = createEmptyDocument("geometry3d")
  const envelope = (await createLocalPlanner().plan({ userMessage: fixture.prompt } as never)).plan
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

export async function runOfflineAgentEval(trials: 1 | 3 = 3): Promise<OfflineEvalResult> {
  const attempts: AgentEvalAttempt[] = []
  for (const fixture of AGENT_TASK_FIXTURES) {
    for (const trial of (trials === 1 ? [1] as const : [1, 2, 3] as const)) attempts.push(await oneAttempt(fixture.id, trial))
  }
  return { mode: "deterministic_local", attempts, scorecard: scoreAgentAttempts(AGENT_TASK_FIXTURES, attempts) }
}
