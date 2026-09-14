import { describe, expect, it } from "vitest"

import { compileExpression, evaluateExpression, parseExpression } from "./expression"

describe("expression AST", () => {
  it("parses and evaluates arithmetic with variables and parentheses", () => {
    const expression = parseExpression("2 * (x + 1) - y / 2")

    expect(expression).toEqual({
      type: "binary",
      operator: "-",
      left: {
        type: "binary",
        operator: "*",
        left: { type: "number", value: 2 },
        right: {
          type: "binary",
          operator: "+",
          left: { type: "variable", name: "x" },
          right: { type: "number", value: 1 }
        }
      },
      right: {
        type: "binary",
        operator: "/",
        left: { type: "variable", name: "y" },
        right: { type: "number", value: 2 }
      }
    })
    expect(evaluateExpression(expression, { x: 3, y: 4 })).toBe(6)
  })

  it("rejects unknown variables and malformed expressions", () => {
    expect(() => evaluateExpression(parseExpression("x + 1"), {})).toThrow("Unknown variable: x")
    expect(() => parseExpression("2 +")).toThrow("Expected expression")
  })

  it("evaluates function notation, powers, and unary signs", () => {
    const expression = parseExpression("-sin(x)^2 + sqrt(4)")

    expect(evaluateExpression(expression, { x: Math.PI / 2 })).toBeCloseTo(1)
  })

  it("evaluates inverse trigonometric, hyperbolic, and logarithmic functions", () => {
    const expression = parseExpression("asinh(sinh(x)) + acosh(cosh(x)) + atanh(tanh(x)) + log10(100) + ln(e)")

    expect(evaluateExpression(expression, { x: 0.25 })).toBeCloseTo(0.25 + 0.25 + 0.25 + 2 + 1)
  })

  it("evaluates composite expressions with function aliases and constants", () => {
    const expression = parseExpression("exp(-x^2) * cos(2*x) + pi - e")

    expect(evaluateExpression(expression, { x: 0 })).toBeCloseTo(1 + Math.PI - Math.E)
  })

  it("supports classroom absolute value and subscript logarithm notation", () => {
    expect(evaluateExpression(parseExpression("|x|"), { x: -3 })).toBe(3)
    expect(evaluateExpression(parseExpression("log_2(x)"), { x: 8 })).toBeCloseTo(3)
  })

  it("reuses compiled ASTs for equivalent normalized sources", () => {
    expect(compileExpression(" y = x * x ")).toBe(compileExpression("x * x"))
  })

  it("rejects unknown functions instead of executing arbitrary identifiers", () => {
    expect(() => parseExpression("alert(x)")).toThrow("Unknown function: alert")
  })
})
