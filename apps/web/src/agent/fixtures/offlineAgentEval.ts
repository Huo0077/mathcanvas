import { createEmptyDocument } from "@draw/dsl"
import { compilePlan } from "@draw/agent-core"
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
  const report = evaluateAgentTask(fixture, { phase: compiled.ok ? "awaiting_confirmation" : "failed", candidate: compiled.draftDocument })
  return { fixtureId, trial, report, toolCalls: fixture.expected.toolIntent, toolErrors: compiled.ok ? 0 : 1, durationMs: Math.max(0, Date.now() - started) }
}

export async function runOfflineAgentEval(trials: 1 | 3 = 3): Promise<OfflineEvalResult> {
  const attempts: AgentEvalAttempt[] = []
  for (const fixture of AGENT_TASK_FIXTURES) {
    for (const trial of (trials === 1 ? [1] as const : [1, 2, 3] as const)) attempts.push(await oneAttempt(fixture.id, trial))
  }
  return { mode: "deterministic_local", attempts, scorecard: scoreAgentAttempts(AGENT_TASK_FIXTURES, attempts) }
}
