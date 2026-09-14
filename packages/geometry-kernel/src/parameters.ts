import type { ParameterSpec } from "@draw/dsl"

import { compileExpression, evaluateExpression, type ExpressionNode } from "./expression"

function evaluateNode(expression: ExpressionNode, resolve: (name: string) => number): number {
  if (expression.type === "number") return expression.value
  if (expression.type === "variable") {
    if (expression.name.toLowerCase() === "pi") return Math.PI
    if (expression.name.toLowerCase() === "e") return Math.E
    return resolve(expression.name)
  }
  if (expression.type === "unary") {
    const value = evaluateNode(expression.argument, resolve)
    return expression.operator === "-" ? -value : value
  }
  if (expression.type === "call") {
    const value = evaluateNode(expression.argument, resolve)
    if (expression.name === "abs") return Math.abs(value)
    if (expression.name === "cos") return Math.cos(value)
    if (expression.name === "exp") return Math.exp(value)
    if (expression.name === "log") return Math.log(value)
    if (expression.name === "sin") return Math.sin(value)
    if (expression.name === "sqrt") return Math.sqrt(value)
    return Math.tan(value)
  }
  const left = evaluateNode(expression.left, resolve)
  const right = evaluateNode(expression.right, resolve)
  if (expression.operator === "+") return left + right
  if (expression.operator === "-") return left - right
  if (expression.operator === "*") return left * right
  if (expression.operator === "/") return left / right
  return left ** right
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
      ? evaluateNode(compileExpression(parameter.expression), resolve)
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
  return evaluateExpression(compileExpression(expression), variables)
}
