import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

/**
 * **直四棱柱 + 梯形底**（2026-10-19，P1-1，solid-20）。
 * 模型把底面写成矩形、高写成 1；解析构造应按梯形面积和体积解出高 4。
 */
const PROMPT = "已知直四棱柱ABCD-A₁B₁C₁D₁，AB⊥AD，AB//CD，AB=2，AD=3，CD=4。已经证明得到直线A₁B//平面DCC₁D₁，若该四棱柱的体积为36，求二面角A₁-BD-A的大小。"

function wrongPlan(): Extract<PlanEnvelope, { kind: "plan" }> {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "矩形底、高 1",
    factIds: [],
    actions: [{
      actionId: "solid.create_prism",
      actionKey: "prism",
      factIds: [],
      inputs: {
        alias: "prism",
        basePolygon: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 3, z: 0 }, { x: 0, y: 3, z: 0 }],
        vector: { x: 0, y: 0, z: 1 },
        vertexNames: ["A", "B", "C", "D", "A₁", "B₁", "C₁", "D₁"]
      }
    }]
  }
}

describe("trapezoid prism rescue", () => {
  it("derives the height from the trapezoid area and the volume", () => {
    const compiled = compilePlan(wrongPlan(), {
      document: createEmptyDocument("geometry3d"),
      prompt: PROMPT,
      conversationId: "trapezoid-prism",
      documentGeneration: 0,
      diagramWitnessSearch: true
    })

    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    expect(compiled.diagramVerification?.status).not.toBe("failed")
    expect(compiled.assumptions.some((assumption) => assumption.id === "witness.trapezoidPrism")).toBe(true)
  })
})
