import { describe, expect, it } from "vitest"

import { parseDiagramObligations } from "./diagramObligations"

/**
 * **面形状：正方形与矩形**（2026-10-15，接用户那句"覆盖所有常见的"）。
 *
 * 两条判据都是**已经有的**（等长 / 垂直），所以这里不新造义务、只按词分派：
 * - 正方形 ⇒ 三条边等长 + 三个相邻直角；
 * - 矩形 / 长方形 ⇒ 三个相邻直角（直角定死，边长不管）。
 *
 * 这一组同时钉住"读得出"与"读成什么"，并且用**用户那道题的原句**做回归。
 */
describe("面形状读取：正方形 / 矩形", () => {
  it("正方形 ⇒ 三条等长 + 三个直角（四条判据）", () => {
    const givens = parseDiagramObligations("在直三棱柱ABC-A₁B₁C₁中，侧面AA₁B₁B为正方形").givens
    expect(givens.filter((item) => item.kind === "equalLength").map((item) => item.targets)).toEqual([
      ["A", "A₁", "A₁", "B₁"],
      ["A₁", "B₁", "B₁", "B"],
      ["B₁", "B", "B", "A"]
    ])
    expect(givens.filter((item) => item.kind === "perpendicular").map((item) => item.targets)).toEqual([
      ["A", "A₁", "A₁", "B₁"],
      ["A₁", "B₁", "B₁", "B"],
      ["B₁", "B", "B", "A"]
    ])
  })

  it("矩形 / 长方形 ⇒ 三个直角，**不**要求边长相等", () => {
    for (const sentence of ["在长方体ABCD-A₁B₁C₁D₁中，侧面ABB₁A₁为矩形", "在四棱柱ABCD-A₁B₁C₁D₁中，面ABCD是长方形"]) {
      const givens = parseDiagramObligations(sentence).givens
      expect(givens.filter((item) => item.kind === "equalLength"), sentence).toEqual([])
      expect(givens.filter((item) => item.kind === "perpendicular").length, sentence).toBe(3)
    }
  })

  it("菱形 ⇒ 四条边等长，**不**要求直角（与矩形正好互补）", () => {
    const givens = parseDiagramObligations("在四棱柱ABCD-A₁B₁C₁D₁中，底面ABCD是菱形").givens
    expect(givens.filter((item) => item.kind === "equalLength").map((item) => item.targets)).toEqual([
      ["A", "B", "B", "C"],
      ["B", "C", "C", "D"],
      ["C", "D", "D", "A"]
    ])
    expect(givens.filter((item) => item.kind === "perpendicular")).toEqual([])
  })

  it("用户那道题的整句照旧（正方形那条不许被矩形分派改坏）", () => {
    const givens = parseDiagramObligations("在直三棱柱ABC-A₁B₁C₁中，侧面AA₁B₁B为正方形，AB=2，BC=2，E、F分别为AC和CC₁的中点，且BF⊥A₁B₁。").givens
    expect(givens.filter((item) => item.kind === "equalLength").length).toBe(3)
    // 正方形自带的三条 + 题面里 `BF⊥A₁B₁` 那一条 = 4。
    expect(givens.filter((item) => item.kind === "perpendicular").length).toBe(4)
    expect(givens.filter((item) => item.kind === "midpoint").length).toBe(2)
  })
})
