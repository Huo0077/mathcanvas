import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

/**
 * **面环自交**（2026-10-19，solid-9/20 现场）：模型给了正确的顶点，但某张面的环顺序
 * 写成蝴蝶结 `[0,2,1,3]`。核验器只认“环不自交”，这里应当按平面角序重排后重编。
 */
function bowTieCube(): Extract<PlanEnvelope, { kind: "plan" }> {
  const vertices = [
    { x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 3, z: 0 }, { x: 0, y: 3, z: 0 },
    { x: 0, y: 0, z: 2 }, { x: 4, y: 0, z: 2 }, { x: 4, y: 3, z: 2 }, { x: 0, y: 3, z: 2 }
  ]
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "面环顺序错",
    factIds: [],
    actions: [{
      actionId: "solid.create_polyhedron",
      actionKey: "cube",
      factIds: [],
      inputs: {
        alias: "cube",
        vertexNames: ["A", "B", "C", "D", "A1", "B1", "C1", "D1"],
        vertices,
        // 底面写成蝴蝶结；其余面正常。
        faces: [[0, 2, 1, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
      }
    }]
  }
}

describe("face ring sorting rescue", () => {
  it("reorders a self-intersecting ring into angular order", () => {
    const compiled = compilePlan(bowTieCube(), {
      document: createEmptyDocument("geometry3d"),
      conversationId: "bow-tie-ring",
      documentGeneration: 0
    })

    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    expect(compiled.assumptions.some((assumption) => assumption.id === "witness.sortedFaceRings")).toBe(true)
  })
})
