import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { parseDiagramObligations } from "./diagramObligations"
import { compilePlan } from "./planCompiler"

const candidatePlan: PlanEnvelope = {
  schemaVersion: PLAN_SCHEMA_VERSION,
  kind: "plan",
  goal: "小问覆盖回归",
  factIds: [],
  actions: [{
    actionId: "solid.create_polyhedron",
    actionKey: "pyramid",
    factIds: [],
    inputs: {
      alias: "pyramid",
      vertexNames: ["P", "A", "B", "C", "D"],
      vertices: [
        { x: 0, y: 0, z: 2 },
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 2, y: 1, z: 0 },
        { x: 1, y: 1, z: 0 }
      ],
      faces: [[1, 2, 3, 4], [0, 2, 1], [0, 3, 2], [0, 4, 3], [0, 1, 4]]
    }
  }]
}

function compile(prompt: string) {
  const document = createEmptyDocument("geometry3d")
  const before = JSON.stringify(document)
  const result = compilePlan(candidatePlan, {
    document,
    prompt,
    conversationId: "scope-regression",
    documentGeneration: document.revision
  })
  return { result, before: () => expect(JSON.stringify(document)).toBe(before) }
}

describe("subquestion condition coverage", () => {
  it.each(["", "设", "且"])("does not certify a wrong candidate for prefix %s", (prefix) => {
    const prompt = `四棱锥P-ABCD中，PA=2。（1）证明AD∥平面PBC；（2）${prefix}AD⊥DC，求AD。`
    const { result, before } = compile(prompt)

    expect(result.diagramVerification?.status).not.toBe("passed")
    before()
  })

  it.each(["", "设", "且", "若"])("keeps both scopes and marks an unselected scope unverified for prefix %s", (prefix) => {
    const prompt = `四棱锥P-ABCD中，PA=2。（1）证明AD∥平面PBC；（2）${prefix}AD⊥DC，求AD。`
    const parsed = parseDiagramObligations(prompt)

    expect(parsed.parts).toHaveLength(2)
    expect(parsed.unverified.length).toBeGreaterThan(0)
  })

  it("accepts an ordinary single-question candidate", () => {
    const { result, before } = compile("四棱锥P-ABCD中，PA=2，画出这个四棱锥。")

    expect(result.ok).toBe(true)
    expect(result.diagramVerification?.status).toBe("passed")
    before()
  })
})
