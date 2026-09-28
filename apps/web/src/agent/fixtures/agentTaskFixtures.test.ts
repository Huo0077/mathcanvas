import { describe, expect, it } from "vitest"

import { AGENT_TASK_FIXTURES, type AgentTaskCategory } from "./agentTaskFixtures"
import { evaluateAgentTask } from "./agentTaskJudge"
import { createEmptyDocument } from "@draw/dsl"
import { compilePlan, type PlanEnvelope } from "@draw/agent-core"
import { createLocalPlanner } from "../localPlanner"

describe("agent evaluation task fixtures", () => {
  it("covers every Phase 0 task category exactly at least once", () => {
    const categories = new Set<AgentTaskCategory>(AGENT_TASK_FIXTURES.map((fixture) => fixture.category))

    expect([...categories].sort()).toEqual(["create", "dependency", "modify", "recovery", "reject", "visual"])
  })

  it("gives every fixture a unique id and executable acceptance checks", () => {
    const ids = AGENT_TASK_FIXTURES.map((fixture) => fixture.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(AGENT_TASK_FIXTURES.length).toBeGreaterThanOrEqual(6)
    for (const fixture of AGENT_TASK_FIXTURES) {
      expect(fixture.prompt.trim()).not.toBe("")
      expect(fixture.expected.acceptance.length).toBeGreaterThan(0)
      expect(fixture.expected.toolIntent.length).toBeGreaterThan(0)
    }
  })
})


describe("deterministic task acceptance", () => {
  const cube = AGENT_TASK_FIXTURES.find((fixture) => fixture.id === "create-cube")!
  const rejected = AGENT_TASK_FIXTURES.find((fixture) => fixture.id === "reject-degenerate-cube")!
  const visual = AGENT_TASK_FIXTURES.find((fixture) => fixture.id === "visual-fit")!
  const plan = (origin: number): PlanEnvelope => ({
    schemaVersion: "mathcanvas.plan.v1", kind: "plan", goal: "one cube", factIds: [],
    actions: [{ actionId: "solid.create_template", actionKey: "cube", factIds: [], inputs: { alias: "cube", template: "cube", origin: { x: origin, y: origin, z: origin }, size: { x: 3, y: 3, z: 3 } } }]
  })

  it("passes only a cube whose actual solid dimensions and center match the request", () => {
    const document = createEmptyDocument("geometry3d")
    const good = compilePlan(plan(-1.5), { document, prompt: cube.prompt, conversationId: "eval", documentGeneration: document.revision })
    const wrong = compilePlan(plan(0), { document, conversationId: "eval", documentGeneration: document.revision })
    expect(evaluateAgentTask(cube, { phase: "awaiting_confirmation", candidate: good.draftDocument }).status).toBe("passed")
    expect(evaluateAgentTask(cube, { phase: "awaiting_confirmation", candidate: wrong.draftDocument }).status).toBe("failed")
  })

  it("checks the real tetrahedron topology rather than assuming any edge has the right length", async () => {
    const fixture = AGENT_TASK_FIXTURES.find((entry) => entry.id === "create-tetrahedron")!
    const document = createEmptyDocument("geometry3d")
    const envelope = (await createLocalPlanner().plan({ userMessage: fixture.prompt } as never)).plan
    const result = compilePlan(envelope, { document, prompt: fixture.prompt, conversationId: "eval", documentGeneration: document.revision })
    expect(result.ok).toBe(true)
    expect(evaluateAgentTask(fixture, { phase: "awaiting_confirmation", candidate: result.draftDocument }).status).toBe("passed")
    const missing = createEmptyDocument("geometry3d")
    expect(evaluateAgentTask(fixture, { phase: "awaiting_confirmation", candidate: missing }).status).toBe("failed")
  })
  it("passes the reject task only when no draft was staged", () => {
    expect(evaluateAgentTask(rejected, { phase: "failed", candidate: null }).status).toBe("passed")
    const document = createEmptyDocument("geometry3d")
    const wrong = compilePlan(plan(0), { document, conversationId: "eval", documentGeneration: document.revision })
    expect(evaluateAgentTask(rejected, { phase: "awaiting_confirmation", candidate: wrong.draftDocument }).status).toBe("failed")
  })

  it("never marks a visual task passed without bound render evidence", () => {
    expect(evaluateAgentTask(visual, { phase: "awaiting_confirmation", candidate: createEmptyDocument("geometry3d") }).status).toBe("not_supported")
  })
})
