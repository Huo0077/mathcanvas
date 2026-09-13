import { describe, expect, it } from "vitest"

import { insertFormulaTemplate } from "./formulaEditor"

describe("formula editor templates", () => {
  it("nests functions at the current cursor position", () => {
    const first = insertFormulaTemplate("", 0, 0, "sin()")
    const second = insertFormulaTemplate(first.value, first.cursorStart, first.cursorEnd, "ln()")

    expect(second.value).toBe("sin(ln())")
    expect(second.cursorStart).toBe(7)
    expect(second.cursorEnd).toBe(7)
  })

  it("wraps a selected expression with an absolute value function", () => {
    const result = insertFormulaTemplate("x + 1", 0, 1, "abs()")

    expect(result.value).toBe("abs(x) + 1")
    expect(result.cursorStart).toBe(5)
    expect(result.cursorEnd).toBe(5)
  })

  it("inserts a logarithm with an editable base token", () => {
    const result = insertFormulaTemplate("", 0, 0, "log_2()")

    expect(result.value).toBe("log_2()")
    expect(result.cursorStart).toBe(6)
  })
})
