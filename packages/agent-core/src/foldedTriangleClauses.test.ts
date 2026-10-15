import { describe, expect, it } from "vitest"

import { parseDiagramObligations } from "./diagramObligations"
import { parseShapeClause } from "./solver/shapeGrammar"

/**
 * **用户现场（2026-10-15，Rt△ABC 折起那道题）**：题面
 *
 * ```
 * Rt△ABC 中，∠C=90°，AC=3，BC=4。
 * D 为 AC 上一点，CD=1。将 △BCD 沿 BD 折起，使 C 到 C'，且 C'D⊥平面 ABD。
 * （1）求 BD 长及折叠后 C' 到平面 ABD 的距离（即 C'D=1，已知垂直）。
 * （2）求二面角 A-BC'-D 的正弦值。
 * ```
 *
 * 现场读数四条 `点名缺失：C`（`AC=3` / `BC=4` / `CD=1`）与一条"形状从句（点名环）认不出来"
 * （`∠C=90°`）。**根因之一是 `Rt△ABC 中` 没被认出来** —— 形状从句的正则只收"三角形"三个字，
 * 既不认 `Rt` 也不认 `△` ⇒ 环不存在 ⇒ 单字母角 `∠C` 不知道是哪两条边。
 *
 * 这一组用例钉住**现在读得出什么**，以及**还读不出什么**（后者照实记，不许假装）。
 */
const PROMPT = [
  "Rt△ABC 中，∠C=90°，AC=3，BC=4。",
  "D 为 AC 上一点，CD=1。将 △BCD 沿 BD 折起，使 C 到 C'，且 C'D⊥平面 ABD。",
  "（1）求 BD 长及折叠后 C' 到平面 ABD 的距离（即 C'D=1，已知垂直）。",
  "（2）求二面角 A-BC'-D 的正弦值。"
].join("\n")

/** 失败时把**完整的**读账带出来（比逐个断言更容易看出真实形状）。 */
function ledger(parsed: ReturnType<typeof parseDiagramObligations>): string {
  return `给定：${JSON.stringify(parsed.givens.map((item) => [item.kind, item.targets, item.value ?? null]))}\n未核验：${JSON.stringify(parsed.unverified.map((entry) => entry.sourceText))}`
}

describe("Rt△ABC 折起那道题：读得出什么、还读不出什么", () => {
  it("`Rt△ABC 中` 现在认得出环 ⇒ `∠C=90°` 落成三个点名的角（不再说「没有点名环」）", () => {
    expect(parseShapeClause(PROMPT)?.base, "环是 A、B、C").toEqual(["A", "B", "C"])
    const parsed = parseDiagramObligations(PROMPT)
    const angle = parsed.givens.find((item) => item.kind === "planarAngle")
    // 环上顶点 C 的邻点是 B 与 A，按"前一个、顶点、后一个"落成三个点名。
    expect(angle?.targets, ledger(parsed)).toEqual(["B", "C", "A"])
    expect(angle?.value).toBe(90)
    expect(parsed.unverified.some((entry) => entry.sourceText.includes("形状从句"))).toBe(false)
  })

  it("三条长度与那条「线 ⊥ 平面」都读得出来", () => {
    const parsed = parseDiagramObligations(PROMPT)
    const lengths = parsed.givens.filter((item) => item.kind === "fixedLength").map((item) => [item.targets.join(""), item.value])
    // `C'D=1` 是括号里那句「（即 C'D=1，已知垂直）」读出来的 —— 一并记着。
    expect(lengths, ledger(parsed)).toEqual([["AC", 3], ["BC", 4], ["CD", 1], ["C'D", 1]])
    const perpendicular = parsed.givens.find((item) => item.kind === "perpendicular")
    // 线的两个点名 + 平面的三个点名（`C'D⊥平面 ABD`）。
    expect(perpendicular?.targets, ledger(parsed)).toEqual(["C'", "D", "A", "B", "D"])
  })

  it("**`D 为 AC 上一点` 不再静默消失**（今天还没有判据，但必须看得见）", () => {
    /**
     * 这一条是本轮**读账摊开之后照出来的第三处缺陷**：`D 为 AC 上一点` 此前既不进给定、
     * 也不进未核验 —— 与当年 `弦 AB 的长为 3`、`P 是椭圆上任意一点` 同一种病。
     * 本轮先把**触发词**接上（不许消失）并给它一句**说得清**的理由；
     * 真判据（与该线段共线且落在线段内）还没做 —— 做到之后这条断言要**翻转**成"读成一条义务"。
     */
    const parsed = parseDiagramObligations(PROMPT)
    const entry = parsed.unverified.find((item) => item.sourceText.includes("AC 上一点"))
    expect(entry, ledger(parsed)).toBeDefined()
    expect(entry!.reason, entry!.reason).toContain("还没有判据")
    expect(parsed.givens.some((item) => item.targets.join("").includes("AC") && item.kind === "segmentRatio"), "今天读不成义务").toBe(false)
  })

  it("**还读不出的**照实留在未核验里（不静默、也不假装读懂）", () => {
    const parsed = parseDiagramObligations(PROMPT)
    const unread = parsed.unverified.map((entry) => entry.sourceText).join("｜")
    // 二面角 `A-BC'-D`（折痕是两个带撇的点名）：读取器还没有这一支。
    expect(unread, ledger(parsed)).toContain("二面角 A-BC'-D")
  })

  it("**如实钉住的第四处缺口**：折起那句不在题设账上（它该是一条**诊断**，不是「未核验」）", () => {
    /**
     * 现状（本轮量出来的）：`将 △BCD 沿 BD 折起，使 C 到 C'` **既不进给定、也不进未核验**。
     *
     * 为什么**没有**顺手把它加进触发词表：它是一条**操作指令**，不是一条"待核验的条件" ——
     * 把它塞进 `unverified` 会给用户一句"折起：未核验"，而真正该说的是
     *「题面说了折起，**计划里却没有折**」。折起在**另一层**已经被读到了
     *（`figureIntent` 的 `readFoldTransformations`，`foldRigidityDiagnostics` 用它判刚体性），
     * 缺的是"计划没折"这条诊断。所以这条断言钉的是**缺口本身**：做到之后要**翻转**。
     */
    const parsed = parseDiagramObligations(PROMPT)
    const accounted = [...parsed.givens.map((item) => item.sourceText), ...parsed.unverified.map((entry) => entry.sourceText)].join("｜")
    expect(accounted, `题设账：${accounted}`).not.toContain("折起")
  })
})
