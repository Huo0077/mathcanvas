import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"
import { parseDraftAction } from "./schemas"

/**
 * **关于平面的对称点**（2026-10-19，P2-1）：源点 + 平面三个点名，坐标由内核算。
 */
describe("solid.create_reflection", () => {
  it("parses source and plane points", () => {
    const result = parseDraftAction({
      actionId: "solid.create_reflection",
      actionKey: "mirror",
      factIds: [],
      inputs: { alias: "A1", label: "A₁", source: "A", planePoints: ["B", "C", "D"] }
    })

    expect(result.ok, result.ok ? "" : JSON.stringify(result.errors)).toBe(true)
    if (result.ok) expect(result.value.inputs).toMatchObject({ source: "A", planePoints: ["B", "C", "D"] })
  })

  it("reflects across the z=0 plane", () => {
    const point = (alias: string, position: { x: number; y: number; z: number }) => ({
      actionId: "solid.create_point" as const,
      actionKey: alias,
      factIds: [],
      inputs: { alias, label: alias, position }
    })
    const plan: Extract<PlanEnvelope, { kind: "plan" }> = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "反射",
      factIds: [],
      actions: [
        point("B", { x: 0, y: 0, z: 0 }),
        point("C", { x: 1, y: 0, z: 0 }),
        point("D", { x: 0, y: 1, z: 0 }),
        point("A", { x: 0, y: 0, z: 1 }),
        { actionId: "solid.create_reflection", actionKey: "mirror", factIds: [], inputs: { alias: "A1", label: "A₁", source: "A", planePoints: ["B", "C", "D"] } }
      ]
    }
    const compiled = compilePlan(plan, {
      document: createEmptyDocument("geometry3d"),
      conversationId: "reflection",
      documentGeneration: 0
    })

    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    const reflected = compiled.draftDocument?.primitives.find((primitive) => primitive.type === "point3" && (primitive as { label?: string }).label === "A₁")
    expect(reflected).toMatchObject({ type: "point3", position: { x: 0, y: 0, z: -1 } })
  })
})
