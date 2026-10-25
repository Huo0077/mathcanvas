import { describe, expect, it } from "vitest"

import { expandExamShorthand } from "./latexNormalisation"

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
