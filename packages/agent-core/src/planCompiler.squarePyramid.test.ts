import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

/**
 * **正方形底四棱锥**（2026-10-19，P1-1，solid-10）。
 * 模型坐标不满足 ∠PCA=45°；解析构造应当直接解出 P 并重编核验。
 */
const PROMPT = "在四棱锥P-ABCD中，底面ABCD为正方形，AB=4，PC=PD=3，∠PCA=45°。"

function wrongPlan(): Extract<PlanEnvelope, { kind: "plan" }> {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "手写坐标但角度错",
    factIds: [],
    actions: [{
      actionId: "solid.create_polyhedron",
      actionKey: "pyramid",
      factIds: [],
      inputs: {
        alias: "pyramid",
        vertexNames: ["P", "A", "B", "C", "D"],
        vertices: [{ x: 2, y: 2, z: 1 }, { x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 4, z: 0 }, { x: 0, y: 4, z: 0 }],
        faces: [[1, 2, 3, 4], [1, 2, 0], [2, 3, 0], [3, 4, 0], [4, 1, 0]]
      }
    }]
  }
}

describe("square pyramid edge rescue", () => {
  it("builds the apex from PC=PD and the base-diagonal angle", () => {
    const compiled = compilePlan(wrongPlan(), {
      document: createEmptyDocument("geometry3d"),
      prompt: PROMPT,
      conversationId: "square-pyramid",
      documentGeneration: 0,
      diagramWitnessSearch: true
    })

    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("passed")
    expect(compiled.assumptions.some((assumption) => assumption.id === "witness.squarePyramid")).toBe(true)
  })
})
