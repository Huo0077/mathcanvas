import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

/**
 * **等腰直角 + 等边 + 二面角**（2026-10-19，P1-1，trig-23）。
 * 模型坐标不满足 △ABD 等边；解析构造应给出两张正确的面。
 */
const PROMPT = "已知△ABC为等腰直角三角形，AB为斜边，△ABD为等边三角形，若二面角C-AB-D为150°，则直线CD与平面ABC所成角的正切值为。"

function wrongPlan(): Extract<PlanEnvelope, { kind: "plan" }> {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "手写两张面",
    factIds: [],
    actions: [
      {
        actionId: "solid.create_face",
        actionKey: "abc",
        factIds: [],
        inputs: {
          alias: "ABC",
          vertexNames: ["A", "B", "C"],
          vertices: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }]
        }
      },
      {
        actionId: "solid.create_face",
        actionKey: "abd",
        factIds: [],
        inputs: {
          alias: "ABD",
          vertexNames: ["A", "B", "D"],
          vertices: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }]
        }
      }
    ]
  }
}

describe("dihedral triangle rescue", () => {
  it("reconstructs both faces instead of trusting bad coordinates", () => {
    const compiled = compilePlan(wrongPlan(), {
      document: createEmptyDocument("geometry3d"),
      prompt: PROMPT,
      conversationId: "dihedral-triangle",
      documentGeneration: 0,
      diagramWitnessSearch: true
    })

    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    expect(compiled.diagramVerification?.status).not.toBe("failed")
    expect(compiled.assumptions.some((assumption) => assumption.id === "witness.dihedral")).toBe(true)
  })
})
