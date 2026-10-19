import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

/**
 * **裸别名自动补成 draft 作用域**（2026-10-19，P1-2）。
 *
 * 模型反复把 `dynamic.create_bound_point.host` 写成 `"quad"`；传输层只把它补成
 * `{scope:"draft",alias:"quad"}` 还不够，编译层必须真的按这个别名找到前面那张面。
 */
describe("bare draft alias in a scoped reference", () => {
  it("binds a point to the face referenced by a bare alias", () => {
    const plan = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "裸别名宿主",
      factIds: [],
      actions: [
        {
          actionId: "solid.create_face",
          actionKey: "quad",
          factIds: [],
          inputs: {
            alias: "quad",
            vertexNames: ["A", "B", "C", "D"],
            vertices: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 3, z: 0 }, { x: 0, y: 3, z: 0 }]
          }
        },
        {
          actionId: "dynamic.create_bound_point",
          actionKey: "pt-e",
          factIds: [],
          inputs: { alias: "E", label: "E", host: "quad", hostEdge: { from: "A", to: "B" }, parameter: 0.5 }
        }
      ]
    } as unknown as Extract<PlanEnvelope, { kind: "plan" }>

    const compiled = compilePlan(plan, {
      document: createEmptyDocument("geometry3d"),
      conversationId: "bare-host",
      documentGeneration: 0
    })

    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    const e = compiled.draftDocument?.primitives.find((primitive) => primitive.type === "point3" && (primitive as { label?: unknown }).label === "E")
    expect(e?.type).toBe("point3")
  })
})
