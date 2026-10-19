import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

/**
 * **点在三角形内部**（2026-10-19，P3-2）：用重心/同侧符号判据核验；
 * 内部通过，外部失败。
 */
const PROMPT = "点P在△ABC内部"

function withPoint(p: { x: number; y: number }): Extract<PlanEnvelope, { kind: "plan" }> {
  const a = { x: 0, y: 0 }
  const b = { x: 4, y: 0 }
  const c = { x: 0, y: 3 }
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "三角形 + 点",
    factIds: [],
    actions: [
      { actionId: "planar.create_point", actionKey: "A", factIds: [], inputs: { alias: "A", points: [a], label: "A" } },
      { actionId: "planar.create_point", actionKey: "B", factIds: [], inputs: { alias: "B", points: [b], label: "B" } },
      { actionId: "planar.create_point", actionKey: "C", factIds: [], inputs: { alias: "C", points: [c], label: "C" } },
      { actionId: "planar.create_point", actionKey: "P", factIds: [], inputs: { alias: "P", points: [p], label: "P" } },
      { actionId: "planar.create_segment", actionKey: "AB", factIds: [], inputs: { alias: "AB", points: [a, b] } },
      { actionId: "planar.create_segment", actionKey: "BC", factIds: [], inputs: { alias: "BC", points: [b, c] } },
      { actionId: "planar.create_segment", actionKey: "CA", factIds: [], inputs: { alias: "CA", points: [c, a] } }
    ]
  } as unknown as Extract<PlanEnvelope, { kind: "plan" }>
}

describe("point inside triangle", () => {
  it("accepts an interior point", () => {
    const compiled = compilePlan(withPoint({ x: 1, y: 1 }), {
      document: createEmptyDocument("conics"),
      prompt: PROMPT,
      conversationId: "inside",
      documentGeneration: 0
    })
    expect(compiled.diagramVerification?.status).toBe("passed")
  })

  it("rejects an exterior point", () => {
    const compiled = compilePlan(withPoint({ x: 5, y: 5 }), {
      document: createEmptyDocument("conics"),
      prompt: PROMPT,
      conversationId: "outside",
      documentGeneration: 0
    })
    expect(compiled.diagramVerification?.status).toBe("failed")
  })
})
