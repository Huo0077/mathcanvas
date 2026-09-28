import { describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"
import { compilePlan } from "@draw/agent-core"
import { createLocalPlanner } from "../localPlanner"
import { AGENT_TASK_FIXTURES } from "./agentTaskFixtures"
import { evaluateAgentTask } from "./agentTaskJudge"
import { scoreAgentAttempts } from "./agentEvalRunner"

async function offlineResult(id: string) {
  const fixture = AGENT_TASK_FIXTURES.find((entry) => entry.id === id)!
  const document = createEmptyDocument("geometry3d")
  const plan = (await createLocalPlanner().plan({ userMessage: fixture.prompt } as never)).plan
  const compiled = compilePlan(plan, { document, prompt: fixture.prompt, conversationId: "eval", documentGeneration: document.revision })
  return evaluateAgentTask(fixture, { phase: compiled.ok ? "awaiting_confirmation" : "failed", candidate: compiled.draftDocument })
}

describe("agent task scorecard", () => {
  it("judges real candidate documents and reports unverified tasks as not supported", async () => {
    expect((await offlineResult("create-cube")).status).toBe("passed")
    expect((await offlineResult("create-tetrahedron")).status).toBe("passed")
    expect((await offlineResult("reject-degenerate-cube")).status).toBe("passed")
    expect((await offlineResult("visual-fit")).status).toBe("not_supported")
  })

  it("does not claim pass@3 until three independent trials per task are available", async () => {
    const pass = await offlineResult("create-cube")
    const incomplete = scoreAgentAttempts([AGENT_TASK_FIXTURES[0]], [{ fixtureId: "create-cube", trial: 1, report: pass, toolCalls: ["plan.set_plan"], toolErrors: 0, durationMs: 10 }])
    expect(incomplete.passAt1).toEqual({ passed: 1, total: 1 })
    expect(incomplete.passAt3).toBeNull()
  })

  it("counts three trials, failed tool selection, and missing cost without inventing a zero-dollar result", async () => {
    const pass = await offlineResult("create-cube")
    const failure = { ...pass, status: "failed" as const }
    const report = scoreAgentAttempts([AGENT_TASK_FIXTURES[0]], [
      { fixtureId: "create-cube", trial: 1, report: failure, toolCalls: ["unknown.tool"], toolErrors: 1, durationMs: 20 },
      { fixtureId: "create-cube", trial: 2, report: pass, toolCalls: ["plan.set_plan"], toolErrors: 0, durationMs: 10 },
      { fixtureId: "create-cube", trial: 3, report: failure, toolCalls: ["unknown.tool"], toolErrors: 1, durationMs: 15 }
    ])
    expect(report.passAt1).toEqual({ passed: 0, total: 1 })
    expect(report.passAt3).toEqual({ passed: 1, total: 1 })
    expect(report.toolErrorRate).toEqual({ errors: 2, total: 3 })
    expect(report.averageCostUsd).toBeNull()
  })
})
