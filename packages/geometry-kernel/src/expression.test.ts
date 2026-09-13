import { describe, expect, it } from "vitest"

import { evaluateExpression, parseExpression } from "./expression"

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
})
