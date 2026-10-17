import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { parseDiagramObligations } from "./diagramObligations"
import { verifyDiagramObligations } from "./diagramVerification"
import { compilePlan } from "./planCompiler"
import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"

/**
 * **现场回归：模型用 `planar.*` 点画平面四边形、再用 `solid.fold` 折片**（2026-10-17）。
 *
 * 这是 run-1-mvcalq5d 的形状：7 个动作、编译成功，而核验器里 A–D 全“点名缺失”、
 * P/E/F 却在。根因是二维点在 `geometry3d` 里既不画、也不进点名表。
 *
 * 修法（用户裁定）：三维工作区里的平面动作物化成 z = 0 的三维图元。
 * 本用例走**完整编译管线**（不是手搓候选文档）：平面点 A–D 与折前 E、F 都来自
 * `planar.create_point`，再 `solid.fold` 折出 P —— 八条题设必须真的通过。
 */
describe("planar points + fold 的完整编译回归（2026-10-17）", () => {
  const A = { x: 0, y: 0 }
  const B = { x: 8, y: 0 }
  const C = { x: 9, y: Math.sqrt(3) }
  const D = { x: 7.5, y: (5 * Math.sqrt(3)) / 2 }
  const E = { x: 3, y: Math.sqrt(3) }
  const F = { x: 4, y: 0 }
  const PROMPT = "平面四边形 ABCD 中，AB=8，CD=3，AD=5√3，∠ADC=90°，∠BAD=30°。点 E,F 满足 AE=2/5 AD，AF=1/2 AB。将 △AEF 沿 EF 翻折至 △PEF，使得 PC=4√3。"

  const plan = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "平面四边形 ABCD 与翻折片",
    factIds: [],
    actions: [
      { actionId: "planar.create_point", actionKey: "ptA", factIds: [], inputs: { alias: "A", label: "A", points: [A] } },
      { actionId: "planar.create_point", actionKey: "ptB", factIds: [], inputs: { alias: "B", label: "B", points: [B] } },
      { actionId: "planar.create_point", actionKey: "ptC", factIds: [], inputs: { alias: "C", label: "C", points: [C] } },
      { actionId: "planar.create_point", actionKey: "ptD", factIds: [], inputs: { alias: "D", label: "D", points: [D] } },
      { actionId: "planar.create_polyline", actionKey: "quad", factIds: [], inputs: { alias: "quad", points: [A, B, C, D] } },
      { actionId: "planar.create_point", actionKey: "ptE", factIds: [], inputs: { alias: "E", label: "E", points: [E] } },
      { actionId: "planar.create_point", actionKey: "ptF", factIds: [], inputs: { alias: "F", label: "F", points: [F] } },
      {
        actionId: "solid.fold",
        actionKey: "fold",
        factIds: [],
        inputs: {
          alias: "flap",
          vertexNames: ["A", "E", "F"],
          vertices: [{ ...A, z: 0 }, { ...E, z: 0 }, { ...F, z: 0 }],
          hinge: { from: "E", to: "F" },
          apex: "A",
          apexAs: "P",
          angle: 90
        }
      }
    ]
  } as unknown as PlanEnvelope

  it("八条题设全部 passed（A–D 来自 planar.create_point）", () => {
    const document = createEmptyDocument("geometry3d")
    const compiled = compilePlan(plan, { document, prompt: PROMPT, conversationId: "planar-solid-regression", documentGeneration: 0 })

    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    expect(compiled.draftDocument).not.toBeNull()
    // A–D 已经被物化成三维点（否则核验器看不到它们）。
    const point3 = compiled.draftDocument!.primitives.filter((primitive) => primitive.type === "point3")
    expect(point3.map((primitive) => ("label" in primitive ? primitive.label : undefined))).toEqual(expect.arrayContaining(["A", "B", "C", "D"]))

    const report = verifyDiagramObligations(parseDiagramObligations(PROMPT), plan, compiled.draftDocument!)
    expect(report.status, report.checks.map((check) => `${check.sourceText}:${check.status}:${check.reason ?? ""}`).join("\n")).toBe("passed")
  })
})
