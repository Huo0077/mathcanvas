import { describe, expect, it } from "vitest"

import { parseDiagramObligations } from "./diagramObligations"

/**
 * **用户现场（2026-10-15，翻折那道题）的题面读账** —— 用**用户原话本身**钉住。
 *
 * ```
 * 平面四边形 ABCD 中，AB=8，CD=3，AD=5√3，
 * ∠ADC=90°，∠BAD=30°。
 * 点 E,F 满足 AE=2/5 AD，AF=1/2 AB。
 * 将 △AEF 沿 EF 翻折至 △PEF，使得 PC=4√3。
 * （1）证明：EF⊥PD；
 * （2）求平面 PCD 与平面 PBF 所成二面角的正弦值。
 * ```
 *
 * 现场那份读账（本轮量出来的）里，**五条四边形条件 + `PC=4√3` 都读得出**，而
 * `AE=2/5 AD` / `AF=1/2 AB` **两条落进未核验** —— 因为原先只认 `AE:AD=2:5`（冒号）与
 * `AD=2AB`（倍数），不认**分数**写法。这一组用例把两件事一起钉住：读账长什么样，
 * 以及**补上分数读取器之后**那两条进 `givens`。
 */
const PROMPT = [
  "平面四边形 ABCD 中，AB=8，CD=3，AD=5√3，",
  "∠ADC=90°，∠BAD=30°。",
  "点 E,F 满足 AE=2/5 AD，AF=1/2 AB。",
  "将 △AEF 沿 EF 翻折至 △PEF，使得 PC=4√3。",
  "（1）证明：EF⊥PD；",
  "（2）求平面 PCD 与平面 PBF 所成二面角的正弦值。"
].join("\n")

const ledger = (parsed: ReturnType<typeof parseDiagramObligations>): string =>
  `给定：${JSON.stringify(parsed.givens.map((item) => [item.kind, item.targets, item.value ?? null]))}\n未核验：${JSON.stringify(parsed.unverified.map((entry) => entry.sourceText))}`

describe("翻折那道题：题面读账（用户原话）", () => {
  it("五条四边形条件与 `PC=4√3` 都读得出", () => {
    const parsed = parseDiagramObligations(PROMPT)
    const lengths = parsed.givens.filter((item) => item.kind === "fixedLength").map((item) => [item.targets.join(""), item.value])
    expect(lengths, ledger(parsed)).toEqual([
      ["AB", 8],
      ["CD", 3],
      ["AD", 5 * Math.sqrt(3)],
      ["PC", 4 * Math.sqrt(3)]
    ])
    const angles = parsed.givens.filter((item) => item.kind === "planarAngle").map((item) => [item.targets.join(""), item.value])
    expect(angles, ledger(parsed)).toEqual([["ADC", 90], ["BAD", 30]])
  })

  /**
   * **`AE=2/5 AD` 这一种写法现在读得出**（2026-10-15 补的读取器）。
   *
   * 判据与 `AE:AD=2:5` 是**同一个** `segmentRatio`：四个点名 = 两条线段、值 = **前比后**。
   * 这条断言同时挡住一件很贵的错法：`AE=2/5 AD` 被**长度**读取器半吃成 `AE=2`
   *（`2` 后面是 `/`，不在它的负向断言里）—— 那样会留下 `/5 AD` 半截、且残留扫描器看不见它。
   */
  it("`AE=2/5 AD` / `AF=1/2 AB` 读成 `segmentRatio`（前比后），不再落未核验", () => {
    const parsed = parseDiagramObligations(PROMPT)
    const ratios = parsed.givens.filter((item) => item.kind === "segmentRatio").map((item) => [item.targets, item.value])
    expect(ratios, ledger(parsed)).toEqual([
      [["A", "E", "A", "D"], 2 / 5],
      [["A", "F", "A", "B"], 1 / 2]
    ])
    // 而且**不许**被半吃成长度：`AE=2` 那种假读数一个都不许出现。
    const halfEaten = parsed.givens.filter((item) => item.kind === "fixedLength" && ["AE", "AF"].includes(item.targets.join("")))
    expect(halfEaten, ledger(parsed)).toEqual([])
    // 这两句不许再留在未核验里。
    expect(parsed.unverified.map((entry) => entry.sourceText).join("｜"), ledger(parsed)).not.toContain("AE=2/5")
  })
})
