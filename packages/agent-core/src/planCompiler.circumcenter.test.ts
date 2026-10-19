import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

/**
 * **外心条件**（2026-10-19，trig-89 现场）：`2AB·AO=|AB|²` 与 `2AC·AO=|AC|²`
 * 等价于 O 在 AB、AC 的垂直平分线上，即外心。模型给的 O 常错；这里直接从题面重建。
 */
const PROMPT = "已知点O为△ABC所在平面内一点，在△ABC中，满足2AB·AO=|AB|²，2AC·AO=|AC|²，则点O为该三角形的外心。"

function wrongPlan(): Extract<PlanEnvelope, { kind: "plan" }> {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "手写 O",
    factIds: [],
    actions: [{ actionId: "planar.create_point", actionKey: "o", factIds: [], inputs: { alias: "O", points: [{ x: 2, y: 1.5 }], label: "O" } }]
  }
}

describe("circumcenter rescue", () => {
  it("replaces a wrong O with the circumcenter", () => {
    const compiled = compilePlan(wrongPlan(), {
      document: createEmptyDocument("conics"),
      prompt: PROMPT,
      conversationId: "circumcenter",
      documentGeneration: 0
    })

    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("passed")
    expect(compiled.assumptions.some((assumption) => assumption.id === "witness.circumcenter")).toBe(true)
  })
})
