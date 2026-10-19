import { describe, expect, it } from "vitest"

import { expandExamShorthand } from "./latexNormalisation"

/**
 * **带下标的链式相等**（2026-10-19，solid-32 现场）：`AB=AA₁=2` 里的 `AA₁` 是
 * 两个点名 A、A₁；原来的链式展开只认单字符点名，于是留下一个孤零零的 `AB=`。
 */
describe("expandExamShorthand with subscript names", () => {
  it("expands a chain whose segment names contain subscripts", () => {
    expect(expandExamShorthand("AB=AA₁=2")).toBe("AB=2，AA₁=2")
  })

  it("still expands plain chains", () => {
    expect(expandExamShorthand("PA=AB=BC=2")).toBe("PA=2，AB=2，BC=2")
  })

  it("splits a number followed by a Chinese sentence and strips a leading 若", () => {
    expect(expandExamShorthand("CD=4.已经证明")).toBe("CD=4，已经证明")
    expect(expandExamShorthand("若二面角C-AB-D为150°")).toBe("二面角C-AB-D为150°")
  })

  it("expands an equilateral triangle with an explicit side", () => {
    expect(expandExamShorthand("△ABC是边长为3的等边三角形")).toBe("AB=3，AC=3，BC=3")
  })
})
