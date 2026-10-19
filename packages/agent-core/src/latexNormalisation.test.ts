import { describe, expect, it } from "vitest"

import { parseObligationWithLegacy } from "./obligationIR"
import { normalizeGeometryPrompt } from "./latexNormalisation"

/**
 * **真实考试题入口的 LaTeX 归一化**（2026-10-19，任务 P5-1）。
 *
 * 12 道评测里，原始 LaTeX 题面能编译但条件大多“未核验”；归一化之后检查才真正跑起来。
 * 这里钉住三件事：常见命令能转、纯文本题面逐字不变、解析器能读懂归一化后的题面。
 */

describe("normalizeGeometryPrompt", () => {
  it("converts the common exam commands", () => {
    expect(normalizeGeometryPrompt("在 $\\triangle ABC$ 中，$AB=2$，$\\angle A=60^\\circ$")).toBe("在△ABC中，AB=2，∠A=60°")
    expect(normalizeGeometryPrompt("$PC=\\sqrt{6}$，$CD=3$")).toBe("PC=√6，CD=3")
    expect(normalizeGeometryPrompt("$\\frac{\\sqrt{2}}{2}$")).toBe("√2/2")
    expect(normalizeGeometryPrompt("$A_{1}B_{1}$，$SA\\perp$ 平面 $ABC$")).toBe("A₁B₁，SA⊥平面ABC")
    expect(normalizeGeometryPrompt("$\\overrightarrow{AB}\\cdot\\overrightarrow{AC}=0$")).toBe("AB·AC=0")
  })

  it("repairs the OCR variants seen in the dataset", () => {
    expect(normalizeGeometryPrompt("三棱雉 $P-ABC$。圆雉的体积")).toBe("三棱锥P-ABC。圆锥的体积")
  })

  it("leaves a plain prompt byte-for-byte unchanged", () => {
    const plain = "平面四边形 ABCD 中，AB=8，CD=3，AD=5√3，∠ADC=90°。"
    expect(normalizeGeometryPrompt(plain)).toBe(plain)
  })
})

describe("the parser reads a normalised exam prompt", () => {
  it("reads a radical length that the raw LaTeX leaves unparsed", () => {
    const parsed = parseObligationWithLegacy("在三棱锥 P-ABC 中，PC=\\sqrt{6}。")

    expect(parsed.ir.obligations.some((obligation) =>
      obligation.kind.toLowerCase().includes("length")
      && obligation.targets.includes("P") && obligation.targets.includes("C"))).toBe(true)
  })
})
