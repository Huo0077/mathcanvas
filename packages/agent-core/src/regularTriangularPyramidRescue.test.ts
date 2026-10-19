import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

/**
 * **正三棱锥解析救援**（P1-1）：题面只给底边和侧棱，不再让模型心算顶点。
 */
describe("regular triangular pyramid rescue", () => {
  it("replaces a bare plan with the analytic pyramid", () => {
    const plan: Extract<PlanEnvelope, { kind: "plan" }> = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "正三棱锥",
      factIds: [],
      actions: [{ actionId: "solid.create_point", actionKey: "seed", factIds: [], inputs: { alias: "seed", label: "seed", position: { x: 0, y: 0, z: 0 } } }]
    }
    const compiled = compilePlan(plan, {
      document: createEmptyDocument("geometry3d"),
      conversationId: "regular-triangular-pyramid",
      documentGeneration: 0,
      prompt: "已知正三棱锥的侧棱长为√3,底面边长为2,求它的高"
    })

    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    expect(compiled.actions[0]?.actionId).toBe("solid.create_polyhedron")
    const apex = compiled.draftDocument?.primitives.find((primitive) => primitive.type === "point3" && (primitive as { label?: string }).label === "P") as { position: { z: number } } | undefined
    expect(apex?.position.z).toBeCloseTo(Math.sqrt(3 - 4 / 3), 6)
  })
})
