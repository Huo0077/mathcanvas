import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"
import { parseDraftAction } from "./schemas"

/**
 * **自由空间点**（2026-10-19，P2-1）：立体里点不由实体/折片/绑点产生时，
 * 需要一笔显式坐标；它是后续旋转/反射/投影算子的落点。
 */
describe("solid.create_point", () => {
  it("parses position and label", () => {
    const result = parseDraftAction({
      actionId: "solid.create_point",
      actionKey: "P",
      factIds: [],
      inputs: { alias: "P", label: "P", position: { x: 1, y: 2, z: 3 } }
    })

    expect(result.ok, result.ok ? "" : JSON.stringify(result.errors)).toBe(true)
    if (result.ok) expect(result.value.inputs).toMatchObject({ position: { x: 1, y: 2, z: 3 }, label: "P" })
  })

  it("compiles to a labelled point3 primitive", () => {
    const plan: Extract<PlanEnvelope, { kind: "plan" }> = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "自由点",
      factIds: [],
      actions: [{
        actionId: "solid.create_point",
        actionKey: "P",
        factIds: [],
        inputs: { alias: "P", label: "P", position: { x: 1, y: 2, z: 3 } }
      }]
    }
    const compiled = compilePlan(plan, {
      document: createEmptyDocument("geometry3d"),
      conversationId: "free-point",
      documentGeneration: 0
    })

    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    const point = compiled.draftDocument?.primitives.find((primitive) => primitive.type === "point3")
    expect(point).toMatchObject({ type: "point3", position: { x: 1, y: 2, z: 3 }, label: "P" })
  })
})
