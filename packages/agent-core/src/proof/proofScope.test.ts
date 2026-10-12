import { describe, expect, it } from "vitest"

import { parseDiagramObligations } from "../diagramObligations"
import { readProofGoal } from "./proofGoalReader"
import { buildProofScopeReport } from "./proofScope"
import { bridgeProofPremises, PLANE_PERPENDICULAR_PROPERTY_THEOREM } from "./proofPremiseBridge"

/**
 * **Task 17：这一次到底证了什么**（计划 `Task 17｜Lean 原题前提与受限引理分级`）。
 *
 * ## 这一层要挡住的是什么
 *
 * 适配器里那四条模板证的都是**受限引理**：一个结论 + 它自己那两条前提。
 * 而一道题还有别的必要条件（底面形状、点在边上、`P` 在面外、给定的角与长度…）。
 * 那些条件**一个字都没进命题** —— 于是"后端验过了"只说明**模板定理成立**，
 * 不说明"这道题证完了"。这一层把这句话变成结构化字段，而不是靠文案自觉。
 *
 * 计划的判据逐条落在这里：
 *
 * - 每一条原题条件给一档：`formalized`（进了命题的假设）/ `dischargedByNamedDerivation`
 *  （由一条**点名定理**从另一条题设推出来）/ `figureAssumption`（只是图这一个实例满足）/
 *  `notRepresented`（连读都没读出来）；
 * - 结局只有 `limited_lemma | whole_problem | unsupported`；**默认是 `limited_lemma`**；
 * - `unsupported` 给"没有这一类模板"与"前提指不出出处"；
 * - `whole_problem` 要调用方**显式声明**这份命题覆盖整道题（今天没有任何产品调用方给得出它，
 *  因为本仓还没有一份完整原题的 Lean 命题产物）；
 * - **不把函数采样、实例图或 `sorry` 当证明**：后端没验过就不可能是 `whole_problem`。
 */

const PERPENDICULAR_PROMPT = "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，AB=2，P 在平面 ABCD 外，求证 PA ⊥ BD"

function scopeOf(prompt: string, goalText: string, extra: Partial<Parameters<typeof buildProofScopeReport>[0]> = {}) {
  const set = parseDiagramObligations(prompt)
  const reading = readProofGoal(goalText, set)
  const bridge = reading.ok ? bridgeProofPremises(reading.reading.goal, set) : null
  return buildProofScopeReport({ reading, set, bridge, backendVerified: true, ...extra })
}

describe("Task 17: what exactly did the Lean run prove", () => {
  it("**题面多一条必要条件 ⇒ 只到受限引理**，并逐条说清它在不在命题里", () => {
    const report = scopeOf(PERPENDICULAR_PROMPT, "求证 PA ⊥ BD")

    expect(report.outcome).toBe("limited_lemma")
    // 目标句自己带 id 与原文区间（复用 IR 的编号口径），不是一句自由文本。
    expect(report.goalSourceId).toBe("obligation-goal-0")
    expect(report.goalSpan).not.toBeNull()
    expect(PERPENDICULAR_PROMPT.slice(report.goalSpan!.start, report.goalSpan!.end)).toContain("PA")
    // 「PA ⊥ 平面 ABCD」是这条命题真正用到的前提 ⇒ 它**进了命题的假设**（`formalized`）。
    const planePremise = report.conditions.find((entry) => entry.sourceText.includes("PA ⊥ 平面 ABCD"))
    expect(planePremise?.scope).toBe("formalized")
    expect(planePremise?.reason).toContain("命题")
    // 每一条条件都带着原话区间（指得回题面）。
    for (const condition of report.conditions) expect(condition.sourceText.length).toBeGreaterThan(0)
    // **`PA ⊥ 平面 ABCD` 之外的东西，一条都不许算进命题**：这一题里有 `AB=2` 之类。
    const outside = report.conditions.filter((entry) => entry.scope !== "formalized" && entry.scope !== "dischargedByNamedDerivation")
    expect(outside.length, "至少有一条原题条件没进命题").toBeGreaterThan(0)
    expect(report.detail).toContain("受限引理")
  })

  it("**由一条点名定理推出来的题设**归到 `dischargedByNamedDerivation`，并写出那一步叫什么", () => {
    // 判定定理要平面内两条相交直线；题面没有直接给这两条垂直，只给了「那**整张平面**」的垂直
    // ⇒ 两条前提都由性质定理一步导出，起点是那条 `⊥ 面` 题设。
    const report = scopeOf("在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，求证 PA ⊥ 平面 ABD", "求证 PA ⊥ 平面 ABD")
    const source = report.conditions.find((entry) => entry.sourceText.includes("PA ⊥ 平面 ABCD"))
    expect(source?.scope).toBe("dischargedByNamedDerivation")
    expect(source?.reason).toContain(PLANE_PERPENDICULAR_PROPERTY_THEOREM)
  })

  it("**四受限目标的正例也只是受限引理**：没有完整命题产物时不许升整题", () => {
    const report = scopeOf("在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，求证 PA ⊥ BD", "求证 PA ⊥ BD")
    expect(report.outcome).toBe("limited_lemma")

    /**
     * 即便调用方**显式声明**这份命题覆盖整道题，只要题面里还有一条没进命题的条件
     *（这一句里的"在四棱锥 P-ABCD 中"就落在那类里），结局仍是受限引理 ——
     * 声明的意思是"我声明了"，不是"我声明了就算数"。
     */
    const declared = scopeOf("在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，求证 PA ⊥ BD", "求证 PA ⊥ BD", {
      wholeProblemProposition: { goalSourceId: "obligation-goal-0", note: "自称覆盖整题" }
    })
    expect(declared.outcome).toBe("limited_lemma")
  })

  it("**缺前提 ⇒ unsupported**（前提指不出出处时连命题都不该生成）", () => {
    const report = scopeOf("在四棱锥 P-ABCD 中，底面 ABCD 是正方形，求证 PA ⊥ BD", "求证 PA ⊥ BD")
    expect(report.outcome).toBe("unsupported")
    expect(report.detail).toContain("前提")
  })

  it("**没有这一类模板 ⇒ unsupported**（面 ⊥ 面与线 ⊥ 面不是一回事，不许混）", () => {
    const report = scopeOf("在正方体中，求证 平面A₁B₁C₁D₁ ⊥ 平面ABCD", "求证 平面A₁B₁C₁D₁ ⊥ 平面ABCD")
    expect(report.outcome).toBe("unsupported")
    expect(report.detail).toContain("模板")
  })

  it("后端没验过 ⇒ 永远不是整题（`sorry` 那一类在这里就被挡住）", () => {
    const report = scopeOf("在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，求证 PA ⊥ BD", "求证 PA ⊥ BD", {
      backendVerified: false,
      wholeProblemProposition: { goalSourceId: "obligation-goal-0", note: "自称覆盖整题" }
    })
    expect(report.outcome).not.toBe("whole_problem")
  })

  it("图上的前提如实标出来，并说清点名有没有真的物化", () => {
    // 「BD 落在平面 ABCD 内」这一条不是题面某句话，而是点名结构蕴含的 ⇒ `figureAssumption`。
    const prompt = "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，求证 PA ⊥ BD"
    const withNames = scopeOf(prompt, "求证 PA ⊥ BD", { materialisedNames: ["P", "A", "B", "C", "D"] })
    const premise = withNames.conditions.find((entry) => entry.scope === "figureAssumption")
    expect(premise, "这一类目标必然带图上蕴含的前提").toBeDefined()
    expect(premise!.reason).toContain("物化")

    // 图上没有这些点名时，**如实说没有** —— 那一条仍然只是假设，不许被当成"图上成立"。
    const withoutNames = scopeOf(prompt, "求证 PA ⊥ BD", { materialisedNames: [] })
    const unbacked = withoutNames.conditions.find((entry) => entry.scope === "figureAssumption")
    expect(unbacked!.reason).toContain("没有物化")
  })

  it("整题级只可能由**完整命题产物**触发，而且**系统补的图上前提也会挡住它**", () => {
    // 判定定理那一类：两条前提都由题面直接给 ⇒ 把"没解析出来的题面"去掉（模拟"这份命题确实覆盖整道题"），
    // 并且调用方显式声明 —— 这时才允许升到 `whole_problem`。
    const set = { ...parseDiagramObligations("在三棱锥 P-ABC 中，PA ⊥ AB，PA ⊥ AC，求证 PA ⊥ 平面 ABC"), unverified: [] }
    const reading = readProofGoal("求证 PA ⊥ 平面 ABC", set)
    const report = buildProofScopeReport({
      reading,
      set,
      bridge: reading.ok ? bridgeProofPremises(reading.reading.goal, set) : null,
      backendVerified: true,
      wholeProblemProposition: { goalSourceId: "obligation-goal-0", note: "完整命题产物" }
    })
    expect(
      report.outcome,
      `档位：${report.conditions.map((entry) => `${entry.scope}:${entry.sourceText}`).join("｜")}；detail=${report.detail}`
    ).toBe("whole_problem")

    /**
     * **反方向**：性质定理那一类（线 ⊥ 线）的命题只用到"线 ⊥ 面"这一条；
     * "目标线落在那个平面内"是**系统按点名结构补的图上前提** —— 计划那句"没有假设"
     * 就是挡它的：有这一条在，条件再怎么删也升不到整题级。
     */
    const perpendicular = { ...parseDiagramObligations("在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，求证 PA ⊥ BD"), unverified: [] }
    const perpendicularReading = readProofGoal("求证 PA ⊥ BD", perpendicular)
    const perpendicularReport = buildProofScopeReport({
      reading: perpendicularReading,
      set: perpendicular,
      bridge: perpendicularReading.ok ? bridgeProofPremises(perpendicularReading.reading.goal, perpendicular) : null,
      backendVerified: true,
      wholeProblemProposition: { goalSourceId: "obligation-goal-0", note: "完整命题产物" }
    })
    expect(perpendicularReport.conditions.some((entry) => entry.scope === "figureAssumption"), "这一类的命题依赖图上补的前提").toBe(true)
    expect(perpendicularReport.outcome, "有系统补的假设 ⇒ 不许升整题级").toBe("limited_lemma")
  })
})
