import { describe, expect, it } from "vitest"

import type { ParameterSpec } from "@draw/dsl"

import { evaluateParameterExpression, evaluateParameterExpressions } from "./parameters"

const spec = (expression: string): Record<string, ParameterSpec> => ({ p: { id: "p", value: 0, expression } })

/**
 * 体检发现的真缺陷：`parameters.ts` 里曾经有一份**第二套**求值器，只处理 abs/cos/exp/log/sin/sqrt，
 * 其余 14 个函数名（ln、log10、log_2、asin、atan、floor、ceil、sinh、cosh、tanh…）全部落到
 * `return Math.tan(value)` 兜底分支——解析器接受这些名字，于是 `ln(2)` 被算成 `tan(2)`，
 * 而这个**错值会被写进 `parameter.value` 并保存**。
 */
describe("parameter expression evaluation", () => {
  it("evaluates the natural logarithm instead of falling through to tan", () => {
    expect(evaluateParameterExpressions(spec("ln(2)")).p.value).toBeCloseTo(Math.LN2, 12)
    expect(evaluateParameterExpressions(spec("log(2)")).p.value).toBeCloseTo(Math.LN2, 12)
    expect(evaluateParameterExpressions(spec("log10(1000)")).p.value).toBeCloseTo(3, 12)
    expect(evaluateParameterExpressions(spec("log_2(8)")).p.value).toBeCloseTo(3, 12)
  })

  it("agrees with the standalone evaluator on every function the parser accepts", () => {
    const expressions = [
      "abs(-3)", "acos(0.5)", "acosh(2)", "asin(0.5)", "asinh(2)", "atan(1)", "atanh(0.5)",
      "ceil(1.2)", "cos(0.4)", "cosh(1)", "exp(1)", "floor(1.8)", "ln(2)", "log(2)", "log10(100)",
      "log_2(8)", "sin(0.4)", "sinh(1)", "sqrt(2)", "tan(0.4)", "tanh(1)", "|(-4)|"
    ]
    for (const expression of expressions) {
      const expected = evaluateParameterExpression(expression, {})
      expect(evaluateParameterExpressions(spec(expression)).p.value, expression).toBeCloseTo(expected, 12)
    }
  })

  it("still resolves parameter references and rejects unknown variables", () => {
    const parameters: Record<string, ParameterSpec> = {
      r: { id: "r", value: 3 },
      area: { id: "area", value: 0, expression: "pi*r^2" }
    }
    const resolved = evaluateParameterExpressions(parameters)
    expect(resolved.area.value).toBeCloseTo(Math.PI * 9, 12)
    expect(() => evaluateParameterExpressions({ broken: { id: "broken", value: 0, expression: "missing+1" } })).toThrow(/Unknown variable/)
  })
})
