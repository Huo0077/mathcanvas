import type { Coordinate, Vector3 } from "@draw/dsl"

import type {
  ConstraintNode,
  DerivedNode,
  EvaluationResult,
  MeasurementNode,
  NodeEvaluator,
  ParameterNode,
  ReactiveDiagnostic,
  ReactiveDiagnosticCode,
  SourceNode,
  EvaluatedReactiveNode
} from "./types"

/**
 * evaluator 的**纯函数护栏**（设计规格 §4.2）。
 *
 * 规格要求"每个 evaluator 必须拒绝 NaN、无穷、缺失来源和退化输入"，并要求诊断是结构化的。
 * 这一层只做三件事，全部与具体几何无关：
 *
 * 1. 造节点（`parameterNode` / `derivedNode` / …）—— 让调用方不必关心节点对象的形状；
 * 2. 造诊断（`missingSourceDiagnostic` / `nonFiniteDiagnostic` / …）—— 码与文案只有一份；
 * 3. `runEvaluator` —— 调用 evaluator、兜住异常、并对**结果里的每一个数字**做有限性检查。
 *
 * 第 3 条是"非有限值必须是结构化诊断"这条不变式的唯一执行点：放在这里，任何 evaluator
 * 都不可能靠"想不到"绕过它（几何代码里 `0/0`、`Math.hypot` 溢出都很容易产出 NaN）。
 */

const diagnostic = (code: ReactiveDiagnosticCode, nodeId: string, message: string, upstream?: string): ReactiveDiagnostic =>
  upstream === undefined ? { code, nodeId, message } : { code, nodeId, message, upstream }

export const missingSourceDiagnostic = (nodeId: string, upstream: string, detail?: string): ReactiveDiagnostic =>
  diagnostic("missing_source", nodeId, detail ?? `缺少来源：${upstream} 没有可用的值。`, upstream)

export const cycleDiagnostic = (nodeId: string, cycle: readonly string[]): ReactiveDiagnostic =>
  diagnostic("dependency_cycle", nodeId, `依赖成环：${cycle.join(" -> ")}`)

export const cycleMemberDiagnostic = (nodeId: string, path: readonly string[]): ReactiveDiagnostic =>
  diagnostic("dependency_cycle", nodeId, `依赖成环（${path.join(" -> ")}），拒绝求值。`)

export const nonFiniteDiagnostic = (nodeId: string, path: string, detail?: string): ReactiveDiagnostic =>
  diagnostic("non_finite", nodeId, detail ?? `结果不是有限数：${path}`)

export const degenerateDiagnostic = (nodeId: string, message: string): ReactiveDiagnostic => diagnostic("degenerate", nodeId, message)

export const invalidDomainDiagnostic = (nodeId: string, message: string): ReactiveDiagnostic => diagnostic("invalid_domain", nodeId, message)

export const invalidHostDiagnostic = (nodeId: string, message: string): ReactiveDiagnostic => diagnostic("invalid_host", nodeId, message)

export const evaluationFailedDiagnostic = (nodeId: string, error: unknown): ReactiveDiagnostic =>
  diagnostic("evaluation_failed", nodeId, `求值抛异常：${error instanceof Error ? error.message : String(error)}`)

/** 结果是"有值"的两种状态（`exact` / `approximate`）。 */
export function isResolved<Value>(result: EvaluationResult<Value> | undefined): result is Extract<EvaluationResult<Value>, { status: "exact" | "approximate" }> {
  return result !== undefined && (result.status === "exact" || result.status === "approximate")
}

/** 有值时取出值；`undefined` / `degenerate` 一律返回 `undefined`（绝不编造）。 */
export function resolvedValue<Value>(result: EvaluationResult<Value> | undefined): Value | undefined {
  return isResolved(result) ? result.value : undefined
}

export function diagnosticOf(result: EvaluationResult<unknown> | undefined): ReactiveDiagnostic | undefined {
  return result !== undefined && (result.status === "undefined" || result.status === "degenerate") ? result.diagnostic : undefined
}

/**
 * 从上游结果里读数值。
 *
 * 几何图元在文档里存成坐标 / 向量，而"动点"在 DAG 里存成 `{ point, parameter, clamped }`
 * （见 `constraints.ts`），所以读取器同时接受两种形状：**裸坐标**与**带 `point` 的记录**。
 * 少一层转换，上游就可以自由选择"参数化的点"还是"直接给一个坐标"。
 */
function unwrapInput(value: unknown, key: "x" | "y" | "z"): number | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  const bare = record[key]
  if (typeof bare === "number") return bare
  const nested = record.point
  if (nested && typeof nested === "object") {
    const candidate = (nested as Record<string, unknown>)[key]
    return typeof candidate === "number" ? candidate : null
  }
  return null
}

export function numberInput(inputs: ReadonlyMap<string, EvaluationResult<unknown>>, id: string): number | null {
  const value = resolvedValue(inputs.get(id))
  return typeof value === "number" ? value : null
}

export function coordinateInput(inputs: ReadonlyMap<string, EvaluationResult<unknown>>, id: string): Coordinate | null {
  const value = resolvedValue(inputs.get(id))
  const x = unwrapInput(value, "x")
  const y = unwrapInput(value, "y")
  return x === null || y === null ? null : { x, y }
}

export function vector3Input(inputs: ReadonlyMap<string, EvaluationResult<unknown>>, id: string): Vector3 | null {
  const value = resolvedValue(inputs.get(id))
  const x = unwrapInput(value, "x")
  const y = unwrapInput(value, "y")
  const z = unwrapInput(value, "z")
  return x === null || y === null || z === null ? null : { x, y, z }
}

/** 有 `z` 就是三维点，否则是平面点。 */
export function pointInput(inputs: ReadonlyMap<string, EvaluationResult<unknown>>, id: string): Coordinate | Vector3 | null {
  return vector3Input(inputs, id) ?? coordinateInput(inputs, id)
}

/**
 * 结果里第一个非有限数字的路径（`"value.x"`、`"[2].y"` …）。
 *
 * 递归走对象与数组：几何结果是坐标 / 向量 / 点集这类普通结构，逐个字段查一遍就够，
 * 不需要每个 evaluator 自己再写一遍 `Number.isFinite` 检查。
 */
export function nonFinitePath(value: unknown, path = "value"): string | null {
  if (typeof value === "number") return Number.isFinite(value) ? null : path
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = nonFinitePath(value[index], `${path}[${index}]`)
      if (found) return found
    }
    return null
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      const found = nonFinitePath(nested, `${path}.${key}`)
      if (found) return found
    }
    return null
  }
  return null
}

/**
 * 执行一个 evaluator 并检查它的输出。
 *
 * 异常与非有限值都变成诊断（`evaluation_failed` / `non_finite`），**不返回任何值**：
 * 调用方（`ReactiveGraph`）据此把这一节点与它的下游一起标成失败，而不是保留上一次的结果。
 */
export function runEvaluator(node: EvaluatedReactiveNode, inputs: ReadonlyMap<string, EvaluationResult<unknown>>): EvaluationResult<unknown> {
  let result: EvaluationResult<unknown>
  try {
    result = node.evaluate(inputs) as EvaluationResult<unknown>
  } catch (error) {
    return { status: "undefined", diagnostic: evaluationFailedDiagnostic(node.id, error) }
  }
  if (!isResolved(result)) return result
  const path = nonFinitePath(result.value)
  return path === null ? result : { status: "undefined", diagnostic: nonFiniteDiagnostic(node.id, path) }
}

export const sourceNode = (id: string, value: unknown): SourceNode => ({ kind: "source", id, value })

export const parameterNode = (id: string, value: number, options: { ownerId?: string } = {}): ParameterNode =>
  options.ownerId === undefined ? { kind: "parameter", id, value } : { kind: "parameter", id, value, ownerId: options.ownerId }

export const constraintNode = <Value>(id: string, dependsOn: readonly string[], evaluate: NodeEvaluator<Value>): ConstraintNode<Value> =>
  ({ kind: "constraint", id, dependsOn, evaluate })

export const derivedNode = <Value>(id: string, dependsOn: readonly string[], evaluate: NodeEvaluator<Value>): DerivedNode<Value> =>
  ({ kind: "derived", id, dependsOn, evaluate })

export const measurementNode = (id: string, dependsOn: readonly string[], evaluate: NodeEvaluator<number>): MeasurementNode =>
  ({ kind: "measurement", id, dependsOn, evaluate })
