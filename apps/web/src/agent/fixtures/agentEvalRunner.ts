import type { VerificationReport } from "@draw/agent-core"
import type { AgentTaskFixture } from "./agentTaskFixtures"

export interface AgentEvalAttempt {
  fixtureId: string
  trial: 1 | 2 | 3
  report: VerificationReport
  toolCalls: readonly string[]
  toolErrors: number
  durationMs: number
  costUsd?: number
}

export interface AgentEvalScorecard {
  passAt1: { passed: number; total: number } | null
  passAt3: { passed: number; total: number } | null
  toolErrorRate: { errors: number; total: number }
  toolSelection: { matched: number; total: number }
  averageLatencyMs: number | null
  averageCostUsd: number | null
  unverifiableTaskIds: string[]
}

/** A passed receipt without passed checks is not a completed drawing. */
function passed(attempt: AgentEvalAttempt): boolean {
  return attempt.report.status === "passed" && attempt.report.checks.length > 0 && attempt.report.checks.every((check) => check.status === "passed")
}

export function scoreAgentAttempts(fixtures: readonly AgentTaskFixture[], attempts: readonly AgentEvalAttempt[]): AgentEvalScorecard {
  const fixtureIds = new Set(fixtures.map((fixture) => fixture.id))
  const byTask = new Map<string, Map<number, AgentEvalAttempt>>()
  for (const attempt of attempts) {
    if (!fixtureIds.has(attempt.fixtureId) || ![1, 2, 3].includes(attempt.trial) || !Number.isFinite(attempt.durationMs) || attempt.durationMs < 0 || attempt.toolErrors < 0 || attempt.toolErrors > attempt.toolCalls.length) {
      throw new Error(`invalid agent evaluation attempt: ${attempt.fixtureId} trial ${attempt.trial}`)
    }
    const trials = byTask.get(attempt.fixtureId) ?? new Map<number, AgentEvalAttempt>()
    if (trials.has(attempt.trial)) throw new Error(`duplicate independent trial: ${attempt.fixtureId} ${attempt.trial}`)
    trials.set(attempt.trial, attempt)
    byTask.set(attempt.fixtureId, trials)
  }
  const oneComplete = fixtures.every((fixture) => byTask.get(fixture.id)?.has(1) === true)
  const threeComplete = fixtures.every((fixture) => [1, 2, 3].every((trial) => byTask.get(fixture.id)?.has(trial)))
  const successes = attempts.filter(passed)
  const toolCalls = attempts.reduce((sum, attempt) => sum + attempt.toolCalls.length, 0)
  const toolErrors = attempts.reduce((sum, attempt) => sum + attempt.toolErrors, 0)
  const matched = attempts.reduce((sum, attempt) => {
    const expected = fixtures.find((fixture) => fixture.id === attempt.fixtureId)!.expected.toolIntent
    return sum + expected.filter((toolId) => attempt.toolCalls.includes(toolId)).length
  }, 0)
  const expectedTools = attempts.reduce((sum, attempt) => sum + fixtures.find((fixture) => fixture.id === attempt.fixtureId)!.expected.toolIntent.length, 0)
  return {
    passAt1: oneComplete ? { passed: fixtures.filter((fixture) => passed(byTask.get(fixture.id)!.get(1)!)).length, total: fixtures.length } : null,
    passAt3: threeComplete ? { passed: fixtures.filter((fixture) => [...byTask.get(fixture.id)!.values()].some(passed)).length, total: fixtures.length } : null,
    toolErrorRate: { errors: toolErrors, total: toolCalls },
    toolSelection: { matched, total: expectedTools },
    averageLatencyMs: successes.length === 0 ? null : successes.reduce((sum, attempt) => sum + attempt.durationMs, 0) / successes.length,
    averageCostUsd: successes.length === 0 || successes.some((attempt) => attempt.costUsd === undefined) ? null
      : successes.reduce((sum, attempt) => sum + attempt.costUsd!, 0) / successes.length,
    unverifiableTaskIds: fixtures.filter((fixture) => [...(byTask.get(fixture.id)?.values() ?? [])].some((attempt) => attempt.report.status === "not_supported")).map((fixture) => fixture.id)
  }
}
