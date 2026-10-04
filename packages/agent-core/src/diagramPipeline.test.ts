import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION } from "./contracts"
import { compilePlan } from "./planCompiler"

function pyramid(names: string[] | undefined = ["A", "B", "C", "D"]) {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "画三棱锥示意图", factIds: [],
    actions: [{ actionId: "solid.create_polyhedron", actionKey: "tetrahedron", factIds: [], inputs: {
      alias: "tetrahedron",
      vertices: [{ x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 0 }, { x: 0.5, y: Math.sqrt(3) / 2, z: 0 }, { x: 1, y: 0, z: 0 }],
      faces: [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]],
      ...(names ? { vertexNames: names } : {})
    } }]
  }
}

const context = (prompt: string) => ({ document: createEmptyDocument("geometry3d"), conversationId: "diagram-run", prompt })

describe("diagram acceptance in plan compilation", () => {
  it("keeps a condition-valid underdetermined diagram and a traceable verification report", () => {
    const compiled = compilePlan(pyramid(), context("在三棱锥A-BCD中，BD=2，AB=AD，画一张示意图"))
    expect(compiled.ok).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("passed")
    expect(compiled.diagramVerification?.checks.map((item) => item.sourceText)).toEqual(["BD=2", "AB=AD"])
  })

  it("refuses a wrong numeric given and offers the existing single repair", () => {
    const compiled = compilePlan(pyramid(), context("在三棱锥A-BCD中，BD=3，画一张示意图"))
    expect(compiled.ok).toBe(false)
    expect(compiled.diagnostics.some((item) => item.code === "diagram_condition_failed" && item.detail.includes("BD=3"))).toBe(true)
    expect(compiled.repair?.attempt).toBe(1)
  })

  it("compiles the complete real-task topology and checks all seven givens on materialized points", () => {
    const vertices = [
      { x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 0 }, { x: 0.5, y: Math.sqrt(3) / 2, z: 0 },
      { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1 / 3, y: 0, z: 2 / 3 }
    ]
    const plan = { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "画一张满足题设的示意图", factIds: [], actions: [{
      actionId: "solid.create_polyhedron", actionKey: "pyramid", factIds: [], inputs: {
        alias: "pyramid", vertexNames: ["A", "B", "C", "D", "O", "E"], vertices,
        faces: [[1, 2, 3, 4], [0, 1, 4, 3, 5], [0, 1, 2], [0, 2, 3, 5]]
      }
    }] }
    const prompt = "在三棱锥A-BCD中，BD=2，△OCD为等边三角形，AB=AD，O为BD的中点，DE=2EA，平面ABD⊥平面BCD，二面角E-BC-D=45°。求证OA⊥CD"
    const compiled = compilePlan(plan, context(prompt))
    expect(compiled.ok, compiled.diagnostics.map((item) => item.detail).join("; ")).toBe(true)
    expect(compiled.diagramVerification?.checks).toHaveLength(7)
    expect(compiled.diagramVerification?.status).toBe("passed")
    expect(compiled.draftDocument?.primitives.some((item) => item.type === "polyhedron3")).toBe(true)

    const wrong = structuredClone(plan)
    wrong.actions[0].inputs.vertices[0].z = 0.64
    wrong.actions[0].inputs.vertices[5].z = 2 * 0.64 / 3
    const rejected = compilePlan(wrong, context(prompt))
    expect(rejected.ok).toBe(false)
    expect(rejected.diagnostics.some((item) => item.code === "diagram_condition_failed" && item.detail.includes("二面角E-BC-D=45°"))).toBe(true)
  })
  it("does not accuse a valid shape of wrong geometry when vertex order lacks names", () => {
    const original = [
      { x: 0, y: 0, z: 4 }, { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 },
      { x: 2, y: 3, z: 0 }, { x: 0, y: 3, z: 0 }
    ]
    // Coordinates B and C are swapped, with face rings remapped to keep the same valid solid.
    const plan = { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "画四棱锥", factIds: [], actions: [{
      actionId: "solid.create_polyhedron", actionKey: "pyramid", factIds: [], inputs: {
        alias: "pyramid", vertices: [original[0], original[1], original[3], original[2], original[4]],
        faces: [[1, 3, 2, 4], [0, 3, 1], [0, 2, 3], [0, 4, 2], [0, 1, 4]]
      }
    }] }
    const result = compilePlan(plan, context("在四棱锥P-ABCD中，PA⊥平面ABCD，BC∥AD，AB⊥AD，画示意图"))
    expect(result.ok, result.diagnostics.map((item) => item.detail).join("; ")).toBe(true)
    expect(result.diagramVerification?.status).toBe("unverified")
    expect(result.diagnostics.some((item) => item.code === "relation_not_satisfied")).toBe(false)
  })
  it("retains a preview as unverified instead of declaring unsupported conditions passed", () => {
    const compiled = compilePlan(pyramid(), context("在三棱锥A-BCD中，∠ABC=60°，画一张示意图"))
    expect(compiled.ok).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("unverified")
    expect(compiled.diagramVerification?.checks[0].sourceText).toBe("∠ABC=60°")
  })
})
