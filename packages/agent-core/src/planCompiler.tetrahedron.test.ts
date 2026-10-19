import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

/**
 * **六条棱长 → 四面体坐标的救援**（2026-10-19，P1-1）。
 *
 * 现场：三棱锥 P-ABC，底面等边 2，PA=PB=2，PC=√6；模型把坐标写错，核验失败。
 * 六条棱都给了，坐标应由解析构造给出，而不是让模型心算。
 */
const PROMPT = "在三棱锥P-ABC中，△ABC是边长为2的等边三角形，PA=PB=2，PC=√6。"

function wrongPlan(): Extract<PlanEnvelope, { kind: "plan" }> {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "手写坐标但算错",
    factIds: [],
    actions: [
      {
        actionId: "solid.create_polyhedron",
        actionKey: "tetra",
        factIds: [],
        inputs: {
          alias: "tetra",
          vertexNames: ["A", "B", "C", "P"],
          vertices: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }],
          faces: [[0, 1, 2], [0, 1, 3], [1, 2, 3], [2, 0, 3]]
        }
      }
    ]
  }
}

describe("tetrahedron edge rescue", () => {
  it("builds the tetrahedron from six edge lengths when the model coordinates fail", () => {
    const compiled = compilePlan(wrongPlan(), {
      document: createEmptyDocument("geometry3d"),
      prompt: PROMPT,
      conversationId: "tetrahedron-edges",
      documentGeneration: 0,
      diagramWitnessSearch: true
    })

    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("passed")
    expect(compiled.assumptions.some((assumption) => assumption.id === "witness.tetrahedron")).toBe(true)
  })
})
