import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

/**
 * **长方体解析救援**（P1-1）：AB/AD/AA₁ 给全时，顶点坐标由内核算。
 */
describe("cuboid rescue", () => {
  it("replaces a bare plan with the analytic cuboid", () => {
    const plan: Extract<PlanEnvelope, { kind: "plan" }> = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "长方体",
      factIds: [],
      actions: [{ actionId: "solid.create_point", actionKey: "seed", factIds: [], inputs: { alias: "seed", label: "seed", position: { x: 0, y: 0, z: 0 } } }]
    }
    const compiled = compilePlan(plan, {
      document: createEmptyDocument("geometry3d"),
      conversationId: "cuboid",
      documentGeneration: 0,
      prompt: "在长方体 ABCD-A₁B₁C₁D₁ 中，AB=4，AD=3，AA₁=2，求体对角线"
    })

    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    expect(compiled.actions[0]?.actionId).toBe("solid.create_polyhedron")
    const c1 = compiled.draftDocument?.primitives.find((primitive) => primitive.type === "point3" && (primitive as { label?: string }).label === "C₁") as { position: { x: number; y: number; z: number } } | undefined
    expect(c1?.position).toEqual({ x: 4, y: 3, z: 2 })
  })
})
