import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"
import { parseDraftAction } from "./schemas"

/**
 * **直线与平面的交点**（2026-10-19，P2-1）：线两点 + 平面三点。
 */
describe("solid.create_intersection", () => {
  it("parses line and plane points", () => {
    const result = parseDraftAction({
      actionId: "solid.create_intersection",
      actionKey: "hit",
      factIds: [],
      inputs: { alias: "H", label: "H", lineFrom: "A", lineTo: "B", planePoints: ["O", "X", "Y"] }
    })

    expect(result.ok, result.ok ? "" : JSON.stringify(result.errors)).toBe(true)
    if (result.ok) expect(result.value.inputs).toMatchObject({ lineFrom: "A", lineTo: "B", planePoints: ["O", "X", "Y"] })
  })

  it("intersects a slanted line with the z=0 plane", () => {
    const point = (alias: string, position: { x: number; y: number; z: number }) => ({
      actionId: "solid.create_point" as const,
      actionKey: alias,
      factIds: [],
      inputs: { alias, label: alias, position }
    })
    const plan: Extract<PlanEnvelope, { kind: "plan" }> = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "线面交点",
      factIds: [],
      actions: [
        point("O", { x: 0, y: 0, z: 0 }),
        point("X", { x: 1, y: 0, z: 0 }),
        point("Y", { x: 0, y: 1, z: 0 }),
        point("A", { x: 0, y: 0, z: 1 }),
        point("B", { x: 1, y: 0, z: -1 }),
        { actionId: "solid.create_intersection", actionKey: "hit", factIds: [], inputs: { alias: "H", label: "H", lineFrom: "A", lineTo: "B", planePoints: ["O", "X", "Y"] } }
      ]
    }
    const compiled = compilePlan(plan, {
      document: createEmptyDocument("geometry3d"),
      conversationId: "intersection",
      documentGeneration: 0
    })

    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    const hit = compiled.draftDocument?.primitives.find((primitive) => primitive.type === "point3" && (primitive as { label?: string }).label === "H") as { position: { x: number; y: number; z: number } } | undefined
    expect(hit?.position.x).toBeCloseTo(0.5, 9)
    expect(hit?.position.y).toBeCloseTo(0, 9)
    expect(hit?.position.z).toBeCloseTo(0, 9)
  })
})
