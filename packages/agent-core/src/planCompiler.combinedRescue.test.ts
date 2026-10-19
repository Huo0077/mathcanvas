import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

/**
 * **组合救援**（2026-10-19，P4-2）：同一份计划同时有
 * ① 线段 `PC` 排在建点/折之前，② 折角写成 0°，③ A–D 坐标错。
 * 结构清洗 + 补折/折角反求必须串起来，不能修好一个又被下一个挡住。
 */
const PROMPT = "平面四边形 ABCD 中，AB=8，CD=3，AD=5√3，∠ADC=90°，∠BAD=30°。点 E,F 满足 AE=2/5 AD，AF=1/2 AB。将 △AEF 沿 EF 翻折至 △PEF，使得 PC=4√3。画立体图形"

function combinedDefects(): Extract<PlanEnvelope, { kind: "plan" }> {
  const a = { x: 0, y: 0, z: 0 }
  const b = { x: 8, y: 0, z: 0 }
  const c = { x: 6.20101, y: 5.74139, z: 0 }
  const d = { x: 7.5, y: 4.33013, z: 0 }
  const e = { x: 3, y: 1.73205, z: 0 }
  const f = { x: 4, y: 0, z: 0 }
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "顺序 + 0° + 坐标错",
    factIds: [],
    actions: [
      { actionId: "solid.create_segment", actionKey: "segPC", factIds: [], inputs: { alias: "segPC", vertexNames: ["P", "C"] } },
      { actionId: "solid.create_face", actionKey: "quad", factIds: [], inputs: { alias: "quad", vertexNames: ["A", "B", "C", "D"], vertices: [a, b, c, d] } },
      { actionId: "dynamic.create_bound_point", actionKey: "ptE", factIds: [], inputs: { alias: "E", label: "E", host: { scope: "draft", alias: "quad" }, hostEdge: { from: "A", to: "D" }, parameter: 2 / 5 } },
      { actionId: "dynamic.create_bound_point", actionKey: "ptF", factIds: [], inputs: { alias: "F", label: "F", host: { scope: "draft", alias: "quad" }, hostEdge: { from: "A", to: "B" }, parameter: 0.5 } },
      { actionId: "solid.fold", actionKey: "fold", factIds: [], inputs: { alias: "flap", vertexNames: ["A", "E", "F"], vertices: [a, e, f], hinge: { from: "E", to: "F" }, apex: "A", apexAs: "P", angle: 0 } }
    ]
  } as unknown as Extract<PlanEnvelope, { kind: "plan" }>
}

describe("combined structural and fold rescue", () => {
  it("clears the segment order, the 0° angle and the bad coordinates together", () => {
    const compiled = compilePlan(combinedDefects(), {
      document: createEmptyDocument("geometry3d"),
      prompt: PROMPT,
      conversationId: "combined",
      documentGeneration: 0,
      diagramWitnessSearch: true
    })

    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("passed")
  })
})
