import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "../contracts"
import { materialiseFoldHinges } from "./foldHinges"

/**
 * **AEF 平面片 + fold → bound point E/F**（2026-10-19）。
 *
 * 只测结构变换：删冗余面、生成 bound point、去掉 fold 的旧 vertices。
 * 坐标是否满足题设由编译/核验层负责，这里不算几何。
 */

function userPlan(): Extract<PlanEnvelope, { kind: "plan" }> {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "四边形 + AEF 平面片 + fold",
    factIds: [],
    actions: [
      {
        actionId: "solid.create_face",
        actionKey: "quad_abcd",
        factIds: [],
        inputs: {
          alias: "ABCD",
          vertices: [{ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }, { x: 10.098, y: 6.83, z: 0 }, { x: 7.5, y: 4.3301, z: 0 }],
          vertexNames: ["A", "B", "C", "D"]
        }
      },
      {
        actionId: "solid.create_face",
        actionKey: "tri_aef",
        factIds: [],
        inputs: {
          alias: "AEF",
          vertices: [{ x: 0, y: 0, z: 0 }, { x: 3, y: 1.7321, z: 0 }, { x: 4, y: 0, z: 0 }],
          vertexNames: ["A", "E", "F"]
        }
      },
      {
        actionId: "solid.fold",
        actionKey: "fold_aef",
        factIds: [],
        inputs: {
          alias: "PEF",
          vertices: [{ x: 0, y: 0, z: 0 }, { x: 3, y: 1.7321, z: 0 }, { x: 4, y: 0, z: 0 }],
          vertexNames: ["A", "E", "F"],
          hinge: ["E", "F"],
          apex: "A",
          apexAs: "P",
          angle: 120
        }
      }
    ]
  } as unknown as Extract<PlanEnvelope, { kind: "plan" }>
}

describe("materialiseFoldHinges", () => {
  it("drops the flat AEF face and creates bound E/F before the fold", () => {
    const plan = materialiseFoldHinges(userPlan())
    const ids = plan.actions.map((action) => action.actionId)

    expect(ids).toEqual(["solid.create_face", "dynamic.create_bound_point", "dynamic.create_bound_point", "solid.fold"])
    const faces = plan.actions.filter((action) => action.actionId === "solid.create_face")
    expect(faces).toHaveLength(1)

    const bounds = plan.actions.filter((action) => action.actionId === "dynamic.create_bound_point")
    expect(bounds).toHaveLength(2)
    const [e, f] = bounds
    expect((e!.inputs as { hostEdge?: unknown }).hostEdge).toEqual({ from: "A", to: "D" })
    expect((e!.inputs as { parameter?: unknown }).parameter).toBeCloseTo(0.4, 12)
    expect((f!.inputs as { hostEdge?: unknown }).hostEdge).toEqual({ from: "A", to: "B" })
    expect((f!.inputs as { parameter?: unknown }).parameter).toBeCloseTo(0.5, 12)

    const fold = plan.actions.find((action) => action.actionId === "solid.fold")
    expect((fold!.inputs as { vertices?: unknown }).vertices).toBeUndefined()
  })
})
