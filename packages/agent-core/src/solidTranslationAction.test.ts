import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"
import { parseDraftAction } from "./schemas"

/**
 * **按向量平移点**（2026-10-19，P2-1）：源点 + vector，坐标由内核算。
 */
describe("solid.create_translation", () => {
  it("parses source and vector", () => {
    const result = parseDraftAction({
      actionId: "solid.create_translation",
      actionKey: "move",
      factIds: [],
      inputs: { alias: "B1", label: "B₁", source: "B", vector: { x: 1, y: 2, z: 3 } }
    })

    expect(result.ok, result.ok ? "" : JSON.stringify(result.errors)).toBe(true)
    if (result.ok) expect(result.value.inputs).toMatchObject({ source: "B", vector: { x: 1, y: 2, z: 3 } })
  })

  it("adds the vector to the source point", () => {
    const plan: Extract<PlanEnvelope, { kind: "plan" }> = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "平移",
      factIds: [],
      actions: [
        { actionId: "solid.create_point", actionKey: "B", factIds: [], inputs: { alias: "B", label: "B", position: { x: 1, y: 1, z: 1 } } },
        { actionId: "solid.create_translation", actionKey: "move", factIds: [], inputs: { alias: "B1", label: "B₁", source: "B", vector: { x: 2, y: 0, z: -1 } } }
      ]
    }
    const compiled = compilePlan(plan, {
      document: createEmptyDocument("geometry3d"),
      conversationId: "translation",
      documentGeneration: 0
    })

    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    const moved = compiled.draftDocument?.primitives.find((primitive) => primitive.type === "point3" && (primitive as { label?: string }).label === "B₁")
    expect(moved).toMatchObject({ type: "point3", position: { x: 3, y: 1, z: 0 } })
  })
})
