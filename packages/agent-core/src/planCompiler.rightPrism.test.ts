import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

/**
 * **右三棱柱**（2026-10-19，P1-1，solid-13）。
 * 模型坐标不满足 AA₁=2 / A₁C⊥底面；解析构造应当生成可编译的图。
 * 两个距离条件目前解析器读不出，所以允许 `unverified`，但绝不允许 `failed`。
 */
const PROMPT = "在三棱柱ABC-A₁B₁C₁中，AA₁=2，A₁C⊥底面ABC，∠ACB=90°，A₁到平面BCC₁B₁的距离为1。直线AA₁与BB₁距离为2。"

function wrongPlan(): Extract<PlanEnvelope, { kind: "plan" }> {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "手写棱柱坐标",
    factIds: [],
    actions: [{
      actionId: "solid.create_prism",
      actionKey: "prism",
      factIds: [],
      inputs: {
        alias: "prism",
        basePolygon: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }],
        vector: { x: 0, y: 0, z: 1 },
        vertexNames: ["A", "B", "C", "A₁", "B₁", "C₁"]
      }
    }]
  }
}

describe("right prism rescue", () => {
  it("reconstructs the prism instead of trusting bad coordinates", () => {
    const compiled = compilePlan(wrongPlan(), {
      document: createEmptyDocument("geometry3d"),
      prompt: PROMPT,
      conversationId: "right-prism",
      documentGeneration: 0,
      diagramWitnessSearch: true
    })

    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    expect(compiled.diagramVerification?.status).not.toBe("failed")
    expect(compiled.assumptions.some((assumption) => assumption.id === "witness.rightPrism")).toBe(true)
  })
})
