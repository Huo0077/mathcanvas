import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

/**
 * **PA⊥底面 + AD=CD + 垂直平面**（2026-10-19，P1-1，solid-9）。
 * 模型坐标不满足 AD=CD / 平面垂直；解析构造应直接解出 A–D/P。
 */
const PROMPT = "在四棱锥P-ABCD中，PA⊥平面ABCD，PA=AB=BC=2，AD=CD，∠ABC=120°。平面PAC⊥平面PBD。"

function wrongPlan(): Extract<PlanEnvelope, { kind: "plan" }> {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "手写坐标",
    factIds: [],
    actions: [{
      actionId: "solid.create_polyhedron",
      actionKey: "pyramid",
      factIds: [],
      inputs: {
        alias: "pyramid",
        vertexNames: ["A", "B", "C", "D", "P"],
        vertices: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 3, y: 1, z: 0 }, { x: 1, y: 2, z: 0 }, { x: 0, y: 0, z: 2 }],
        faces: [[0, 1, 2, 3], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]]
      }
    }]
  }
}

describe("perpendicular pyramid rescue", () => {
  it("builds coordinates satisfying AD=CD and the perpendicular planes", () => {
    const compiled = compilePlan(wrongPlan(), {
      document: createEmptyDocument("geometry3d"),
      prompt: PROMPT,
      conversationId: "perpendicular-pyramid",
      documentGeneration: 0,
      diagramWitnessSearch: true
    })

    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    expect(compiled.diagramVerification?.status).not.toBe("failed")
    expect(compiled.assumptions.some((assumption) => assumption.id === "witness.perpendicularPyramid")).toBe(true)
  })
})
