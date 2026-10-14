import { describe, expect, it } from "vitest"

import { parseDiagramObligations } from "./diagramObligations"

/**
 * **并列写法的中点**（2026-10-14 用户现场，直三棱柱那道题）。
 *
 * 现场读数：`E、F 分别为 AC 和 CC₁ 的中点` 整句落进"尚未被可靠解析的几何条件"，
 * 于是 E、F 都没被点名，运行最后卡在 `点名缺失：F` 那道门上（系统不肯把没核验的图当核验过的提交）。
 *
 * 这一组按**用户原话**钉住：一句话要读出**两条** `midpoint`，而且点名要对得上。
 */
const USER_PROMPT = [
  "在直三棱柱 ABC-A₁B₁C₁ 中，侧面 AA₁B₁B 为正方形，AB=2，BC=2，",
  "E、F 分别为 AC 和 CC₁ 的中点，且 BF ⊥ A₁B₁。",
  "（1）证明：BF ⊥ 平面 A₁EB₁。"
].join("")

describe("并列写法的中点", () => {
  it("用户原话那半句读出**两条** midpoint，点名分别是 E(AC) 与 F(CC₁)", () => {
    const parsed = parseDiagramObligations(USER_PROMPT)
    const midpoints = parsed.givens.filter((item) => item.kind === "midpoint")
    expect(midpoints.map((item) => item.targets)).toEqual(
      expect.arrayContaining([
        ["E", "A", "C"],
        ["F", "C", "C₁"]
      ])
    )
    // **不许再落进"没被可靠解析"**：这正是现场卡住的那一句。
    expect(parsed.unverified.filter((entry) => entry.sourceText.includes("分别")), `未核验：${JSON.stringify(parsed.unverified)}`).toEqual([])
  })

  it("几种常见变体都认（和/与/顿号、有没有“分别”）", () => {
    for (const sentence of [
      "在直三棱柱ABC-A₁B₁C₁中，E、F分别为AC和CC₁的中点",
      "在直三棱柱ABC-A₁B₁C₁中，E 和 F 分别为 AC 与 CC₁ 的中点",
      "在直三棱柱ABC-A₁B₁C₁中，E、F为AC、CC₁的中点",
      "在直三棱柱ABC-A₁B₁C₁中，E、F分别是AC和CC₁的中点"
    ]) {
      const midpoints = parseDiagramObligations(sentence).givens.filter((item) => item.kind === "midpoint")
      expect(midpoints.map((item) => item.targets), sentence).toEqual([
        ["E", "A", "C"],
        ["F", "C", "C₁"]
      ])
    }
  })

  it("单写法照旧（并列那条不许把它吃掉）", () => {
    const midpoints = parseDiagramObligations("在三棱锥A-BCD中，O为BD的中点").givens.filter((item) => item.kind === "midpoint")
    expect(midpoints.map((item) => item.targets)).toEqual([["O", "B", "D"]])
  })
})
