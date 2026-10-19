import { describe, expect, it } from "vitest"

import { normalizeGeometryPrompt } from "./latexNormalisation"

/**
 * **OCR 错字/向量命令**（2026-10-19，P5-2）：纯文本题面也要修常见错字；
 * 这些替换都是**等长**的（棱椎→棱锥），不会移动 source span。
 */
describe("OCR and vector normalisation", () => {
  it("fixes common OCR characters in plain text", () => {
    expect(normalizeGeometryPrompt("正四棱椎的侧棱长")).toBe("正四棱锥的侧棱长")
    expect(normalizeGeometryPrompt("圆锥和圆椎")).toBe("圆锥和圆锥")
  })

  it("strips \\vec{...} in LaTeX prompts", () => {
    expect(normalizeGeometryPrompt("$\\vec{m}=(1,2)$")).toBe("m=(1,2)")
  })
})
