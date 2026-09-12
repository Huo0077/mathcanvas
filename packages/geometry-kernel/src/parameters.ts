import type { ParameterSpec } from "@draw/dsl"

import { evaluateExpression, parseExpression, type ExpressionNode } from "./expression"

function evaluateNode(expression: ExpressionNode, resolve: (name: string) => number): number {
  if (expression.type === "number") return expression.value
  if (expression.type === "variable") return resolve(expression.name)
  const left = evaluateNode(expression.left, resolve)
  const right = evaluateNode(expression.right, resolve)
  if (expression.operator === "+") return left + right
  if (expression.operator === "-") return left - right
  if (expression.operator === "*") return left * right
  return left / right
}

export function evaluateParameterExpressions(parameters: Record<string, ParameterSpec>): Record<string, ParameterSpec> {
  const resolved = structuredClone(parameters) as Record<string, ParameterSpec>
  const states = new Map<string, "visiting" | "done">()

  const resolve = (id: string): number => {
    const parameter = resolved[id]
    if (!parameter) throw new Error(`Unknown variable: ${id}`)
    if (states.get(id) === "visiting") throw new Error(`Circular parameter reference: ${id}`)
    if (states.get(id) === "done") return parameter.value
    states.set(id, "visiting")
    const value = parameter.expression
      ? evaluateNode(parseExpression(parameter.expression), resolve)
      : parameter.value
    if (!Number.isFinite(value)) throw new Error(`Parameter is not finite: ${id}`)
    parameter.value = value
    states.set(id, "done")
    return value
  }

  for (const id of Object.keys(resolved)) resolve(id)
  return resolved
}

export function evaluateParameterExpression(expression: string, variables: Record<string, number>): number {
  return evaluateExpression(parseExpression(expression), variables)
}
