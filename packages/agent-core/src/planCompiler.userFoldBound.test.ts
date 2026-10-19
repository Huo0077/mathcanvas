import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

/**
 * **用户翻折题的第二种结构**（2026-10-19）：模型把 AEF 直接写成平面片 + fold，
 * 没有 bound point。救援先把 E/F 物化成宿主边上的 bound point，再让见证坐标替换、
 * 剪角与折角反求依次接上。
 */
const PROMPT = "平面四边形 ABCD 中，AB=8，CD=3，AD=5√3，∠ADC=90°，∠BAD=30°。点 E,F 满足 AE=2/5 AD，AF=1/2 AB。将 △AEF 沿 EF 翻折至 △PEF，使得 PC=4√3。"

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

describe("user fold with a redundant AEF face", () => {
  it("materialises E/F and solves the fold", () => {
    const compiled = compilePlan(userPlan(), {
      document: createEmptyDocument("geometry3d"),
      prompt: PROMPT,
      conversationId: "user-fold-materialised-hinges",
      documentGeneration: 0,
      diagramWitnessSearch: true
    })

    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("passed")
  })
})
