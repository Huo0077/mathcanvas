import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

/**
 * **渲染级退化提示**（2026-10-19，P4-4）：近重合点、全部共线点只发警告，不阻止出图。
 */
const point = (alias: string, x: number, y: number, z: number) => ({
  actionId: "solid.create_point" as const,
  actionKey: alias,
  factIds: [],
  inputs: { alias, label: alias, position: { x, y, z } }
})

function planWith(actions: Extract<PlanEnvelope, { kind: "plan" }>["actions"]): Extract<PlanEnvelope, { kind: "plan" }> {
  return { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "退化检查", factIds: [], actions }
}

describe("render degeneracy warnings", () => {
  it("warns about two coincident labelled points", () => {
    const compiled = compilePlan(planWith([point("A", 0, 0, 0), point("B", 0, 0, 0)]), {
      document: createEmptyDocument("geometry3d"),
      conversationId: "coincident",
      documentGeneration: 0
    })
    expect(compiled.ok).toBe(true)
    expect(compiled.diagnostics.some((entry) => entry.code === "render_near_coincident_points")).toBe(true)
  })

  it("warns when all labelled points are collinear", () => {
    const compiled = compilePlan(planWith([point("A", 0, 0, 0), point("B", 1, 0, 0), point("C", 2, 0, 0)]), {
      document: createEmptyDocument("geometry3d"),
      conversationId: "collinear",
      documentGeneration: 0
    })
    expect(compiled.ok).toBe(true)
    expect(compiled.diagnostics.some((entry) => entry.code === "render_collinear_points")).toBe(true)
  })

  it("stays quiet for a non-degenerate triangle", () => {
    const compiled = compilePlan(planWith([point("A", 0, 0, 0), point("B", 4, 0, 0), point("C", 1, 3, 0)]), {
      document: createEmptyDocument("geometry3d"),
      conversationId: "triangle",
      documentGeneration: 0
    })
    expect(compiled.ok).toBe(true)
    expect(compiled.diagnostics.filter((entry) => entry.code.startsWith("render_"))).toEqual([])
  })
})
