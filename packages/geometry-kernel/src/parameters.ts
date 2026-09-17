import type { ParameterSpec } from "@draw/dsl"

import { compileExpression, evaluateExpression } from "./expression"

/**
 * 参数求值**只**用 `expression.ts` 的那一套求值器（与函数图像共用）。
 *
 * 这里曾经有一份只认 abs / cos / exp / log / sin / sqrt 的副本，其余函数名全部落到
 * `return Math.tan(value)` 兜底分支：解析器明明接受 20 个函数名，`ln(2)` 却被算成 `tan(2)`，
 * 而 `evaluateParameterExpressions` 会把结果写进 `parameter.value` 存盘——错值就此固化。
 *
 * 变量用 Proxy 惰性解析：`resolve` 负责递归、循环引用检测与"未定义变量"报错，
 * 求值器只按名字取值，于是两份实现不可能再分叉。
 */
function lazyVariables(resolve: (name: string) => number): Record<string, number> {
  return new Proxy({} as Record<string, number>, {
    get: (_target, property) => (typeof property === "string" ? resolve(property) : undefined),
    has: () => true
  })
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
      ? evaluateExpression(compileExpression(parameter.expression), variables)
      : parameter.value
    if (!Number.isFinite(value)) throw new Error(`Parameter is not finite: ${id}`)
    parameter.value = value
    states.set(id, "done")
    return value
  }
  const variables = lazyVariables(resolve)

  for (const id of Object.keys(resolved)) resolve(id)
  return resolved
}

export function evaluateParameterExpression(expression: string, variables: Record<string, number>): number {
  return evaluateExpression(compileExpression(expression), variables)
}
