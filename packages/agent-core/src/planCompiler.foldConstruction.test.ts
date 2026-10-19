import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

/**
 * **折片题的规范重建**（2026-10-19，稳定性复跑）：模型只交了一张四边形，没有 fold；
 * 系统应当用平面见证坐标 + 题面比例 + 折角反求重建整张图，而不是等模型把结构写对。
 */
const PROMPT = "平面四边形 ABCD 中，AB=8，CD=3，AD=5√3，∠ADC=90°，∠BAD=30°。点 E,F 满足 AE=2/5 AD，AF=1/2 AB。将 △AEF 沿 EF 翻折至 △PEF，使得 PC=4√3。"

function incompletePlan(): Extract<PlanEnvelope, { kind: "plan" }> {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "只有四边形",
    factIds: [],
    actions: [{
      actionId: "solid.create_face",
      actionKey: "quad",
      factIds: [],
      inputs: {
        alias: "quad",
        vertexNames: ["A", "B", "C", "D"],
        vertices: [{ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }, { x: 10.098, y: 6.83, z: 0 }, { x: 7.5, y: 4.3301, z: 0 }]
      }
    }]
  }
}

describe("fold construction rescue", () => {
  it("rebuilds the quad, hinges, fold and solved angle from the prompt", () => {
    const compiled = compilePlan(incompletePlan(), {
      document: createEmptyDocument("geometry3d"),
      prompt: PROMPT,
      conversationId: "fold-construction",
      documentGeneration: 0,
      diagramWitnessSearch: true
    })

    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("passed")
    expect(compiled.assumptions.some((assumption) => assumption.id === "witness.foldConstruction")).toBe(true)
  })
})
