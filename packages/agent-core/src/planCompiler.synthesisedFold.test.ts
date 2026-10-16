import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { readFoldTransformations } from "./figureIntent"
import { compilePlan } from "./planCompiler"

/**
 * **选项②（2026-10-15）：题面说要折、计划里没有折 ⇒ 系统按题面补上那一笔。**
 *
 * 现场那道题卡在**模型写不对计划**上（两轮都在拼一只"折后的闭合体"）。而题面那句翻折
 * **一直是可读的**（`readFoldTransformations`，Task 13 起），只是那份解析此前**只**被用来判
 * "折是不是刚体运动" —— 没有人拿它去**补那一笔动作**。这一组用例钉住：补上之后整条链真的通过，
 * 而且"补了什么"要**说出来**（`assumptions`）。
 */
const PROMPT = [
  "平面四边形 ABCD 中，AB=8，CD=3，AD=5√3，",
  "∠ADC=90°，∠BAD=30°。",
  "点 E,F 满足 AE=2/5 AD，AF=1/2 AB。",
  "将 △AEF 沿 EF 翻折至 △PEF，使得 PC=4√3。",
  "（1）证明：EF⊥PD；",
  "（2）求平面 PCD 与平面 PBF 所成二面角的正弦值。"
].join("\n")

/** 折前的平面片 + 两个定比分点 —— **没有折那一笔**（现场模型那一版的形状）。 */
function flatPlan(): PlanEnvelope {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "平面四边形 ABCD 与折前的三角形 AEF",
    factIds: [],
    actions: [
      {
        actionId: "solid.create_face",
        actionKey: "quad",
        factIds: [],
        inputs: {
          alias: "quad",
          vertexNames: ["A", "B", "C", "D"],
          vertices: [{ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }, { x: 9, y: Math.sqrt(3), z: 0 }, { x: 7.5, y: (5 * Math.sqrt(3)) / 2, z: 0 }],
          label: "四边形 ABCD"
        }
      },
      { actionId: "dynamic.create_bound_point", actionKey: "E", factIds: [], inputs: { alias: "E", host: { scope: "draft", alias: "quad" }, hostEdge: { from: "A", to: "D" }, parameter: 2 / 5, label: "E" } },
      { actionId: "dynamic.create_bound_point", actionKey: "F", factIds: [], inputs: { alias: "F", host: { scope: "draft", alias: "quad" }, hostEdge: { from: "A", to: "B" }, parameter: 1 / 2, label: "F" } }
    ]
  } as unknown as PlanEnvelope
}

const compile = (plan: PlanEnvelope, prompt: string) =>
  compilePlan(plan, { document: createEmptyDocument("geometry3d"), prompt, conversationId: "synthesised-fold", documentGeneration: 0 })

describe("题面说要折、计划里没有折", () => {
  /**
   * **`△AEF` 这种写法也要读得出**（本轮实测踩到的第一处）。
   *
   * 解析器的正则只认 `三角形AEF` 与裸 `AEF` —— 而**卷面上最常见的是 `△`**（用户原话就是 `△AEF`）。
   * 读不出就没有折可补，选项② 整条都落空。这条判据同时钉住两种写法。
   */
  it("`△AEF 沿 EF 翻折至 △PEF` 与 `三角形AEF…` 都读得出", () => {
    const withTriangleSign = readFoldTransformations(PROMPT)
    expect(withTriangleSign.map((fold) => [fold.face, fold.hinge.from, fold.hinge.to, fold.apex, fold.apexAs]), PROMPT).toEqual([["AEF", "E", "F", "A", "P"]])
    const withWord = readFoldTransformations("将三角形AEF沿EF翻折至三角形PEF，使得PC=4√3。")
    expect(withWord.map((fold) => [fold.face, fold.apex, fold.apexAs])).toEqual([["AEF", "A", "P"]])
  })

  it("系统按题面把折补上，第二遍核验 `passed`，并写出它补了什么", () => {
    const result = compile(flatPlan(), PROMPT)
    const why = `ok=${result.ok}；诊断：${result.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join(" || ")}；核验：${(result.diagramVerification?.checks ?? []).map((check) => `${check.sourceText} => ${check.status}`).join(" | ")}`

    expect(result.diagramVerification?.status, why).toBe("passed")
    // 补的那一笔真的在计划里：折前的三个点名 + 折痕 + 被带走的点与它折后叫什么。
    const fold = result.plan?.kind === "plan" ? result.plan.actions.find((action) => action.actionId === "solid.fold") : undefined
    expect(fold, why).toBeDefined()
    const inputs = fold?.inputs as { vertexNames?: string[]; hinge?: { from: string; to: string }; apex?: string; apexAs?: string; angle?: number } | undefined
    expect(inputs?.vertexNames, why).toEqual(["A", "E", "F"])
    expect({ hinge: inputs?.hinge, apex: inputs?.apex, apexAs: inputs?.apexAs }, why).toEqual({ hinge: { from: "E", to: "F" }, apex: "A", apexAs: "P" })
    /**
     * 折角是一个**真的折角**（不是退化的 0/180）。
     *
     * 这里**不**断言它一定被"反求"过：本题的真值恰好是 90°，与那一笔的占位值相同 ——
     * 于是第二遍**直接通过**（核验器按最终坐标说了算，这正是"只救不抢"的含义）。
     * 反求那条路本身由既有的折角用例覆盖（夹具里那个 30° 是**故意填错的**）。
     */
    expect(inputs?.angle, why).toBeGreaterThan(0)
    expect(inputs?.angle, why).toBeLessThan(180)
    // 补了什么要说出来（`assumptions` 是给人看的那一栏）。
    expect(result.assumptions.map((entry) => entry.text).join("｜"), why).toContain("计划里没有折这一笔")
  })

  /**
   * **只救不抢**：计划里已经有折时这一支一步都不动（否则会给同一只片补出第二笔折）。
   */
  it("计划里已经有折：不补第二笔", () => {
    const withFold = flatPlan() as Extract<PlanEnvelope, { kind: "plan" }>
    const plan: Extract<PlanEnvelope, { kind: "plan" }> = {
      ...withFold,
      actions: [...withFold.actions, {
        actionId: "solid.fold",
        actionKey: "flap",
        factIds: [],
        inputs: { alias: "flap", vertexNames: ["A", "E", "F"], hinge: { from: "E", to: "F" }, apex: "A", apexAs: "P", angle: 30, label: "折片" }
      }] as typeof withFold.actions
    }
    const result = compile(plan, PROMPT)
    expect(result.assumptions.map((entry) => entry.text).join("｜")).not.toContain("系统按题面把这一笔补上")
  })
})
