import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { parseDiagramObligations } from "./diagramObligations"
import { compilePlan } from "./planCompiler"

/**
 * **锐角三角形**（2026-10-19，P3-2）：把“三角形是锐角”作为不等式判据核验；
 * 直角/钝角是反例，必须失败。
 */
const PROMPT = "在△ABC中，△ABC是锐角三角形"

function triangle(c: { x: number; y: number }): Extract<PlanEnvelope, { kind: "plan" }> {
  const a = { x: 0, y: 0 }
  const b = { x: 4, y: 0 }
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "三角形",
    factIds: [],
    actions: [
      { actionId: "planar.create_point", actionKey: "A", factIds: [], inputs: { alias: "A", points: [a], label: "A" } },
      { actionId: "planar.create_point", actionKey: "B", factIds: [], inputs: { alias: "B", points: [b], label: "B" } },
      { actionId: "planar.create_point", actionKey: "C", factIds: [], inputs: { alias: "C", points: [c], label: "C" } },
      { actionId: "planar.create_segment", actionKey: "AB", factIds: [], inputs: { alias: "AB", points: [a, b] } },
      { actionId: "planar.create_segment", actionKey: "BC", factIds: [], inputs: { alias: "BC", points: [b, c] } },
      { actionId: "planar.create_segment", actionKey: "CA", factIds: [], inputs: { alias: "CA", points: [c, a] } }
    ]
  } as unknown as Extract<PlanEnvelope, { kind: "plan" }>
}

describe("acute triangle verification", () => {
  it("parses the acute condition", () => {
    const parsed = parseDiagramObligations(PROMPT)
    expect(parsed.givens).toContainEqual(expect.objectContaining({ kind: "acuteTriangle", targets: ["A", "B", "C"] }))
    expect(parsed.unverified.some((entry) => entry.sourceText.includes("锐角"))).toBe(false)
  })

  it("accepts an acute triangle", () => {
    const compiled = compilePlan(triangle({ x: 1, y: 3 }), {
      document: createEmptyDocument("conics"),
      prompt: PROMPT,
      conversationId: "acute",
      documentGeneration: 0
    })
    expect(compiled.ok, JSON.stringify(compiled.diagnostics)).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("passed")
  })

  it("rejects a right triangle", () => {
    const compiled = compilePlan(triangle({ x: 0, y: 3 }), {
      document: createEmptyDocument("conics"),
      prompt: PROMPT,
      conversationId: "right",
      documentGeneration: 0
    })
    expect(compiled.diagramVerification?.status).toBe("failed")
  })

  it("accepts a right triangle for the right-triangle condition", () => {
    const compiled = compilePlan(triangle({ x: 0, y: 3 }), {
      document: createEmptyDocument("conics"),
      prompt: "△ABC是直角三角形",
      conversationId: "right-ok",
      documentGeneration: 0
    })
    expect(compiled.diagramVerification?.status).toBe("passed")
  })

  it("accepts an obtuse triangle for the obtuse-triangle condition", () => {
    const compiled = compilePlan(triangle({ x: -1, y: 1 }), {
      document: createEmptyDocument("conics"),
      prompt: "△ABC是钝角三角形",
      conversationId: "obtuse-ok",
      documentGeneration: 0
    })
    expect(compiled.diagramVerification?.status).toBe("passed")
  })
})
