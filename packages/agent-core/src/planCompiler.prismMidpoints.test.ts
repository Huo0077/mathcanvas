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

  it("**用户原话整句**：编译 ok、题设核验 `passed`（含「侧面…为正方形」）", () => {
    const result = compile(USER_PROMPT)
    const why = result.diagramVerification === undefined
      ? `没有核验报告；诊断：${result.diagnostics.map((entry) => `${entry.stage}/${entry.code}: ${entry.detail}`).join("；")}`
      : result.diagramVerification.checks.map((check) => `${check.sourceText}:${check.status}${check.status === "unverified" ? `（${check.reason}）` : ""}`).join("；")
    expect(result.diagnostics.filter((entry) => entry.severity === "error").map((entry) => entry.code), why).toEqual([])
    expect(result.ok, why).toBe(true)
    expect(result.diagramVerification?.status, why).toBe("passed")
    /**
     * 「为正方形」读出的是**四条**可核验题设（等长×3 + 垂直×1），不是一条"验不了"的关系。
     *
     * 不去断言"没有 `relation_not_checkable`"：那条是**警告**（关于"计划里没声明 relation"，
     * 与这句话无关，`planCompiler.test.ts` 另有钉住）。这里要的是**正面的**证据 ——
     * 那四条判据真的出现在核验报告里，而且条条通过。
     */
    const squareChecks = result.diagramVerification?.checks.filter((check) => check.sourceText.includes("正方形")) ?? []
    // **六条**：三条边等长 + **三个相邻直角**（2026-10-15 把矩形并进同一条读取器时，
    // 直角从一个补成三个 —— 三个直角才真正定死一个四边形；正方形比矩形多那三条等长）。
    expect(squareChecks.map((check) => check.status), `正方形那六条：${squareChecks.map((check) => `${check.kind}:${check.status}`).join("，")}`).toEqual(["passed", "passed", "passed", "passed", "passed", "passed"])
  })
})
