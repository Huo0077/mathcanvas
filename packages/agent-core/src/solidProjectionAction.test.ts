import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"
import { parseDraftAction } from "./schemas"

/**
 * **点在平面上的投影**（2026-10-19，P2-1）：源点 + 平面三个点名，内核算垂足。
 */
describe("solid.create_projection", () => {
  it("parses source and plane points", () => {
    const result = parseDraftAction({
      actionId: "solid.create_projection",
      actionKey: "foot",
      factIds: [],
      inputs: { alias: "H", label: "H", source: "A", planePoints: ["B", "C", "D"] }
    })

    expect(result.ok, result.ok ? "" : JSON.stringify(result.errors)).toBe(true)
    if (result.ok) expect(result.value.inputs).toMatchObject({ source: "A", planePoints: ["B", "C", "D"] })
  })

  it("projects onto the z=0 plane", () => {
    const point = (alias: string, position: { x: number; y: number; z: number }) => ({
      actionId: "solid.create_point" as const,
      actionKey: alias,
      factIds: [],
      inputs: { alias, label: alias, position }
    })
    const plan: Extract<PlanEnvelope, { kind: "plan" }> = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "投影",
      factIds: [],
      actions: [
        point("B", { x: 0, y: 0, z: 0 }),
        point("C", { x: 1, y: 0, z: 0 }),
        point("D", { x: 0, y: 1, z: 0 }),
        point("A", { x: 2, y: 2, z: 3 }),
        { actionId: "solid.create_projection", actionKey: "foot", factIds: [], inputs: { alias: "H", label: "H", source: "A", planePoints: ["B", "C", "D"] } }
      ]
    }
    const compiled = compilePlan(plan, {
      document: createEmptyDocument("geometry3d"),
      conversationId: "projection",
      documentGeneration: 0
    })

    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    const foot = compiled.draftDocument?.primitives.find((primitive) => primitive.type === "point3" && (primitive as { label?: string }).label === "H")
    expect(foot).toMatchObject({ type: "point3", position: { x: 2, y: 2, z: 0 } })
  })
})
