import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"
import { parseDraftAction } from "./schemas"

/**
 * **点绕轴旋转**（2026-10-19，P2-1）：源点 + 轴两点 + 角度，内核用 Rodrigues 公式。
 */
describe("solid.create_rotation", () => {
  it("parses source, axis and angle", () => {
    const result = parseDraftAction({
      actionId: "solid.create_rotation",
      actionKey: "turn",
      factIds: [],
      inputs: { alias: "A1", label: "A₁", source: "A", axisFrom: "O", axisTo: "C", angle: 90 }
    })

    expect(result.ok, result.ok ? "" : JSON.stringify(result.errors)).toBe(true)
    if (result.ok) expect(result.value.inputs).toMatchObject({ source: "A", axisFrom: "O", axisTo: "C", angle: 90 })
  })

  it("rotates ninety degrees about the z axis", () => {
    const point = (alias: string, position: { x: number; y: number; z: number }) => ({
      actionId: "solid.create_point" as const,
      actionKey: alias,
      factIds: [],
      inputs: { alias, label: alias, position }
    })
    const plan: Extract<PlanEnvelope, { kind: "plan" }> = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "旋转",
      factIds: [],
      actions: [
        point("O", { x: 0, y: 0, z: 0 }),
        point("C", { x: 0, y: 0, z: 1 }),
        point("A", { x: 1, y: 0, z: 0 }),
        { actionId: "solid.create_rotation", actionKey: "turn", factIds: [], inputs: { alias: "A1", label: "A₁", source: "A", axisFrom: "O", axisTo: "C", angle: 90 } }
      ]
    }
    const compiled = compilePlan(plan, {
      document: createEmptyDocument("geometry3d"),
      conversationId: "rotation",
      documentGeneration: 0
    })

    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    const turned = compiled.draftDocument?.primitives.find((primitive) => primitive.type === "point3" && (primitive as { label?: string }).label === "A₁") as { position: { x: number; y: number; z: number } } | undefined
    expect(turned?.position.x).toBeCloseTo(0, 9)
    expect(turned?.position.y).toBeCloseTo(1, 9)
    expect(turned?.position.z).toBeCloseTo(0, 9)
  })
})
