import { describe, expect, it } from "vitest"

import { parseDiagramObligations } from "./diagramObligations"

describe("T05 faithful source diagnostics without masked blank artifacts", () => {
  it("never exposes blank-gapped leftover masks as sourceText and preserves original clause spans and unrecognizedSpans", () => {
    const prompt = "若双曲线y²-x²/m²=k的渐近线与圆x²+y²-4y+3=0相切，且P在椭圆外。"
    const parsed = parseDiagramObligations(prompt)

    for (const item of parsed.unverified) {
      // Must never replace consumed equations with runs of blank spaces inside user-facing sourceText.
      expect(item.sourceText).not.toMatch(/\s{3,}/)
      expect(prompt).toContain(item.sourceText)
    }

    const tangencyDiag = parsed.unverified.find((entry) => entry.sourceText.includes("渐近线"))
    expect(tangencyDiag).toBeDefined()
    expect(tangencyDiag?.sourceText).toBe("若双曲线y²-x²/m²=k的渐近线与圆x²+y²-4y+3=0相切")
    expect(tangencyDiag?.reasonCode).toBe("symbolic_conic_tangency_unverified")
    expect(tangencyDiag?.recognizedEntities?.some((e) => e.includes("圆"))).toBe(true)
    expect(tangencyDiag?.reason).toContain("圆已识别")
    expect(tangencyDiag?.reason).not.toContain("圆公式没给")
    expect((tangencyDiag?.unrecognizedSpans?.length ?? 0)).toBeGreaterThan(0)
  })

  it("reports specific reasonCode and clean sourceText for unsupported families and invalid conic domains", () => {
    const nonstandard = parseDiagramObligations("曲线 x²+y⁴=1 的切线")
    expect(nonstandard.unverified[0]?.reasonCode).toBe("nonstandard_curve_out_of_scope")
    expect(nonstandard.unverified[0]?.sourceText).toBe("曲线 x²+y⁴=1 的切线")

    const badDomain = parseDiagramObligations("已知椭圆 C：x²/a²+y²/b²=1（a<=0）")
    expect(badDomain.unverified[0]?.reasonCode).toBe("invalid_symbolic_domain")
    expect(badDomain.givens.some((g) => g.kind === "conicAxes")).toBe(false)
  })
})
