import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"
import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

/**
 * **T5（2026-10-24）：欠定、矛盾、多解都不能被伪装成"通过"**
 *
 * 这一组钉住的就是执行任务书 §7 的三条：
 * - 欠定（题面没给折角、也没有能反求它的终态约束）**可以出静态示意图**，但必须**披露**
 *   那个角度是选的，而不是题设算出来的；
 * - 矛盾条件必须**失败**，而且不能带着 `witness.foldConstruction` 的"已重建"字样；
 * - 多解时留下的那一支有"另有一支同样满足"的披露（既有用例 `planCompiler.foldBranches`
 *   钉住了分支披露，这里只钉"由题设反求"这一档的文字与取值）。
 */
const QUAD = {
  alias: "quad",
  vertexNames: ["A", "B", "C", "D"],
  vertices: [{ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }, { x: 9, y: 1.7, z: 0 }, { x: 7.5, y: 4.3, z: 0 }]
}

function quadPlan(): Extract<PlanEnvelope, { kind: "plan" }> {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "只有四边形",
    factIds: [],
    actions: [{ actionId: "solid.create_face", actionKey: "quad", factIds: [], inputs: QUAD }]
  }
}

function compile(prompt: string, conversationId: string) {
  return compilePlan(quadPlan(), { document: createEmptyDocument("geometry3d"), prompt, conversationId, documentGeneration: 0 })
}

const BASE = "平面四边形 ABCD 中，AB=8，CD=3，AD=5√3，∠ADC=90°，∠BAD=30°。点 E,F 满足 AE=2/5 AD，AF=1/2 AB。"

describe("T5 — underdetermined, contradictory and solved fold angles", () => {
  it("discloses the chosen 90° when the prompt gives neither an angle nor a constraint that could solve one", () => {
    const compiled = compile(`${BASE}将 △AEF 沿 EF 翻折至 △PEF。`, "underdetermined-angle")

    expect(compiled.ok).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("passed")
    // 示意图可以出，但**必须**说明这个角是选的。
    const assumed = compiled.assumptions.find((assumption) => assumption.id === "witness.foldAngleAssumed")
    expect(assumed).toBeDefined()
    expect(assumed?.text).toContain("静态示意")
    const construction = compiled.assumptions.find((assumption) => assumption.id === "witness.foldConstruction")
    expect(construction?.text).toContain("折角方向题面没有给出")
    expect(construction?.text).not.toContain("折角反求")
  })

  it("does not pretend the angle was chosen freely when a condition on the folded point pins it down", () => {
    const compiled = compile(`${BASE}将 △AEF 沿 EF 翻折至 △PEF，使得 PC=4√3。`, "solved-angle")

    expect(compiled.ok).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("passed")
    const construction = compiled.assumptions.find((assumption) => assumption.id === "witness.foldConstruction")
    // 题面点名了折后点（`PC=4√3`）⇒ 折角被整题核验约束住，可以照实说；但**不**谎称单独反求过。
    expect(construction?.text).toContain("整题核验")
    expect(compiled.assumptions.some((assumption) => assumption.id === "witness.foldAngleAssumed")).toBe(false)
  })

  it("fails honestly on contradictory goal conditions, without claiming a reconstructed flap", () => {
    const compiled = compile(`${BASE}将 △AEF 沿 EF 翻折至 △PEF，使得 PC=4√3 且 PC=10。`, "contradictory-goal")

    expect(compiled.ok).toBe(false)
    expect(compiled.diagramVerification?.status).not.toBe("passed")
    expect(compiled.assumptions.some((assumption) => assumption.id === "witness.foldConstruction")).toBe(false)
    // 而且失败要说得出是哪条条件对不上，而不是一句"没找到"。
    expect(compiled.diagnostics.some((diagnostic) => diagnostic.detail.includes("PC"))).toBe(true)
  })

  it("fails honestly on contradictory base lengths", () => {
    const contradictory = "平面四边形 ABCD 中，AB=8 且 AB=10，CD=3，AD=5√3，∠ADC=90°，∠BAD=30°。将 △AEF 沿 EF 翻折至 △PEF。"
    const compiled = compile(contradictory, "contradictory-base")

    expect(compiled.ok).toBe(false)
    expect(compiled.diagramVerification?.status).not.toBe("passed")
    expect(compiled.assumptions.some((assumption) => assumption.id === "witness.foldConstruction")).toBe(false)
    expect(compiled.diagnostics.some((diagnostic) => diagnostic.detail.includes("AB"))).toBe(true)
  })
})
