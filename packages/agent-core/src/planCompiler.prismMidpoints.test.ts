import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

/**
 * **补点的宿主不该按形状枚举**（2026-10-15 用户现场，直三棱柱那道题）。
 *
 * 现场读数：`E、F 分别为 AC 和 CC₁ 的中点` 读出来了、计划也编译了，最后仍卡在
 * **`点名缺失：F`**。用户当场指出：按形状打补丁，下次是棱锥、再下次是圆锥。
 *
 * 这一组拿**棱柱**当代表，题面用**用户原话**。修到的三处（每一处都有自己的理由注释）：
 * 1. 并列写法的中点读取器（`diagramObligations.ts`）；
 * 2. 宿主判据 = "输入里带 ≥3 个点名"，不再枚举多面体/平面片（`planCompiler.ts`）；
 * 3. **"要么全补、要么不补"只对能补的那几类成立** —— 原先 `BF ⊥ A₁B₁` 这条
 *   **不可构造**的条目（它也点名了 F）会让整批放弃，E、F 一个都建不出来。
 *
 * 坐标是那道题**真正自洽**的一组：A(0,0,0)、B(2,0,0)、C(2,2,0)，侧棱 (0,0,2)。
 */
const PLAN: PlanEnvelope = {
  schemaVersion: PLAN_SCHEMA_VERSION,
  kind: "plan",
  goal: "直三棱柱 ABC-A₁B₁C₁",
  factIds: [],
  actions: [{
    actionId: "solid.create_prism",
    actionKey: "prism",
    factIds: [],
    inputs: {
      alias: "prism",
      vertexNames: ["A", "B", "C", "A₁", "B₁", "C₁"],
      basePolygon: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 2, z: 0 }],
      vector: { x: 0, y: 0, z: 2 },
      label: "直三棱柱 ABC-A₁B₁C₁"
    }
  }]
} as unknown as PlanEnvelope

const USER_PROMPT = "在直三棱柱ABC-A₁B₁C₁中，侧面AA₁B₁B为正方形，AB=2，BC=2，E、F分别为AC和CC₁的中点，且BF⊥A₁B₁。"

function compile(prompt: string) {
  return compilePlan(PLAN, { document: createEmptyDocument("geometry3d"), prompt, conversationId: "prism-midpoints", documentGeneration: 0 })
}

function positionOf(label: string) {
  return (document: NonNullable<ReturnType<typeof compile>["draftDocument"]>) => {
    const primitive = document.primitives.find((candidate) => candidate.type === "point3" && (candidate as { label?: string }).label === label)
    return (primitive as { position?: { x: number; y: number; z: number } } | undefined)?.position
  }
}

describe("棱柱宿主：题面点名的中点由系统补建", () => {
  it("**用户原话**：E、F 真的被补出来，落点由测试自己算（AC 中点 / CC₁ 中点）", () => {
    const result = compile(USER_PROMPT)
    const draft = result.draftDocument
    expect(draft, `没拿到草稿；诊断：${result.diagnostics.map((entry) => `${entry.stage}/${entry.code}`).join(" ")}`).not.toBeNull()

    const labels = draft!.primitives.filter((primitive) => primitive.type === "point3").map((primitive) => (primitive as { label?: string }).label)
    expect(labels, `草稿点名：${labels.join(",")}`).toEqual(expect.arrayContaining(["E", "F"]))
    expect(positionOf("E")(draft!)).toMatchObject({ x: 1, y: 1, z: 0 })
    expect(positionOf("F")(draft!)).toMatchObject({ x: 2, y: 2, z: 1 })
  })

  it("去掉「侧面AA₁B₁B为正方形」⇒ 整轮通过（那句是**另一处**缺口，见下一条）", () => {
    const result = compile("在直三棱柱ABC-A₁B₁C₁中，AB=2，BC=2，E、F分别为AC和CC₁的中点，且BF⊥A₁B₁。")
    const why = result.diagramVerification === undefined
      ? `没有核验报告；诊断：${result.diagnostics.map((entry) => `${entry.stage}/${entry.code}: ${entry.detail}`).join("；")}`
      : result.diagramVerification.checks.map((check) => `${check.sourceText}:${check.status}`).join("；")
    expect(result.ok, why).toBe(true)
    expect(result.diagramVerification?.status, why).toBe("passed")
  })

  it("**如实钉住剩下那一处缺口**：「侧面…为正方形」今天核验不了（`relation_not_checkable`）", () => {
    const codes = compile(USER_PROMPT).diagnostics.map((entry) => entry.code)
    // 这一条不是在"验收通过"，而是把**已知缺口**写成会红的判据：等它被补上时，这条用例会提醒改这里。
    expect(codes, "「侧面…为正方形」今天读得出、验不了 —— 补上之后请把这条断言改成'整轮通过'").toContain("relation_not_checkable")
  })
})
