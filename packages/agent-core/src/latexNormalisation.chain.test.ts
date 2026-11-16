import { describe, expect, it } from "vitest"

import {
  expandExamShorthand,
  mapNormalizedRangeToOriginal,
  normalizeGeometryPrompt,
  normalizeGeometryPromptWithSourceMap
} from "./latexNormalisation"

/**
 * **连等不再由 LaTeX 入口改写**（2026-10-26）。
 *
 * 旧实现用一条只认"纯线段 + 值"的正则把 `PA=PB=2` 展开成两条；遇到
 * `AD=AB=2CD=2` 时它从 `AB` 开始吃，把 AD 改成 2、把乘数当成整条等式的值。
 * 现在连等由 `lengthEquality.ts` 整条解析，这一层只保留**不改变语义**的清理
 *（OCR 错字、数字后接中文、行首"若"、等边三角形展开）。
 */
describe("expandExamShorthand leaves chains to the deterministic parser", () => {
  it("does not rewrite a chain whose segment names contain subscripts", () => {
    expect(expandExamShorthand("AB=AA₁=2")).toBe("AB=AA₁=2")
  })

  it("does not rewrite plain chains either", () => {
    expect(expandExamShorthand("PA=AB=BC=2")).toBe("PA=AB=BC=2")
  })

  it("does not rewrite a chain with a coefficient", () => {
    expect(expandExamShorthand("AD=AB=2CD=4")).toBe("AD=AB=2CD=4")
  })

  it("splits a number followed by a Chinese sentence and strips a leading 若", () => {
    expect(expandExamShorthand("CD=4.已经证明")).toBe("CD=4，已经证明")
    expect(expandExamShorthand("若二面角C-AB-D为150°")).toBe("二面角C-AB-D为150°")
  })

  it("expands an equilateral triangle with an explicit side", () => {
    expect(expandExamShorthand("△ABC是边长为3的等边三角形")).toBe("AB=3，AC=3，BC=3")
  })
})

describe("T04 LaTeX lowering and sourceMap roundtrips", () => {
  it("lowers higher powers and nested fractions while preserving sourceMap spans", () => {
    const polyPrompt = "设函数 $f(x)=x^{4}-2x^{3}$，在 $x=1$ 处作切线。"
    const mappedPoly = normalizeGeometryPromptWithSourceMap(polyPrompt)
    expect(mappedPoly.normalized).toContain("f(x)=x^4-2x^3")
    const exprStart = mappedPoly.normalized.indexOf("x^4-2x^3")
    const origSlice = mapNormalizedRangeToOriginal(mappedPoly, exprStart, exprStart + "x^4-2x^3".length)
    expect(polyPrompt.slice(origSlice.start, origSlice.end)).toContain("x^{4}-2x^{3}")

    const nestedFracPrompt = "已知 $f(x)=\\frac{1}{1+\\frac{1}{x}}$ 与 $x^{2}/a^{2}$"
    const normalizedNested = normalizeGeometryPrompt(nestedFracPrompt)
    expect(normalizedNested).not.toContain("\\frac")
    expect(normalizedNested).toContain("(1/(1+(1/x)))")
    expect(normalizedNested).toContain("x²/a²")
  })

  it("normalizes GK-P08 raw LaTeX hyperbola and circle cleanly with sourceMap provenance", () => {
    const raw = "14. 若双曲线 $y^{2}-\\frac{x^{2}}{m^{2}}=1(m>0)$ 的渐近线与圆 $x^{2}+y^{2}-4 y+3=0$ 相切, 则\n\n$m=$\n"
    const mapped = normalizeGeometryPromptWithSourceMap(raw)
    expect(mapped.normalized).not.toContain("\\frac")
    expect(mapped.normalized).not.toContain("{")
    expect(mapped.normalized).toContain("y²-x²/m²=1(m>0)")
    expect(mapped.normalized).toContain("x²+y²-4y+3=0")

    const domainStart = mapped.normalized.indexOf("m>0")
    const domainOrig = mapNormalizedRangeToOriginal(mapped, domainStart, domainStart + "m>0".length)
    expect(raw.slice(domainOrig.start, domainOrig.end)).toContain("m>0")
  })
})
