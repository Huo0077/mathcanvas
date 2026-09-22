import type { Coordinate, Section3Classification, Vector3 } from "@draw/dsl"

import { signedDistanceToLine, angleBetween, polygonPerimeter, signedPolygonArea } from "../dynamic-measurements"
import { constraintTangentAt, normalFromTangent, tangentSegment, type CurveTangent, type PlanarConstraint } from "../planar-constraints"
import { sectionPolyhedron3 } from "../sections3d"
import { applyParameterBounds } from "./constraints"
import { coordinateInput, degenerateDiagnostic, derivedNode, invalidDomainDiagnostic, invalidHostDiagnostic, measurementNode as createMeasurementNode, missingSourceDiagnostic, nonFiniteDiagnostic, resolvedValue } from "./evaluator"
import type { DerivedNode, MeasurementNode } from "./types"

/**
 * **派生节点：切线 / 截面 / 测量**（设计规格 §4.2/§4.3/§3.4）。
 *
 * 规格把这些都算作 DAG 下游节点，而不是"拖动时顺手算一遍"的临时值：
 *
 * ```text
 * 参数变化 -> 反向依赖闭包 -> 拓扑排序 -> 纯 evaluator -> 临时场景预览 -> 抬手后一次性提交
 * ```
 *
 * 三条实现约定：
 * 1. **切点参数是唯一真值**：切点由约束的 `evaluate(参数)` 求出（不是从切向积分回去，
 *    否则连续拖动会慢慢漂离曲线），切向用内核的 `constraintTangentAt`；
 * 2. **截面是"实体拓扑 + 平面"的函数**：平面一动整条截面重算，空截面如实报 `none`，
 *    绝不把上一圈的旧环留在那里；
 * 3. **测量是图上的节点**：它的失效只由自己的来源决定，因此"改一个无关的点"不会重算它
 *    （`measurementNode` 的依赖就是那几个点）。
 */

export interface TangentValue extends CurveTangent {
  /** 可视线段的两端（以切点为中心，长度由调用方给的半长决定）。 */
  readonly a: Coordinate
  readonly b: Coordinate
  /** 单位法向（切向转 90°）。 */
  readonly normal: Coordinate
}

export interface TangentNodeOptions {
  readonly constraint: PlanarConstraint | null
  /** 切点参数的真源节点；缺省用字面量。 */
  readonly parameterId?: string
  readonly parameter?: number
  readonly branch?: number
  /** 可视半长（世界单位）。缺省 1。 */
  readonly halfLength?: number
  /** 曲线图元节点：只参与失效传播。 */
  readonly hostIds?: readonly string[]
}

const DEFAULT_TANGENT_HALF_LENGTH = 1

function tangentValue(tangent: CurveTangent, halfLength: number): TangentValue {
  const segment = tangentSegment(tangent, halfLength)
  const normal = normalFromTangent(tangent).direction
  return { ...tangent, a: segment.a, b: segment.b, normal }
}

/** 某个参数处的切线。参数越界时按曲线自身的域折回 / 夹取（与动点约束同一套语义）。 */
export function tangentNode(id: string, options: TangentNodeOptions): DerivedNode<TangentValue> {
  const branch = options.branch ?? 0
  const literal = options.parameter ?? 0
  const halfLength = options.halfLength ?? DEFAULT_TANGENT_HALF_LENGTH
  const dependsOn = [...new Set([...(options.hostIds ?? []), ...(options.parameterId === undefined ? [] : [options.parameterId])])]
  return derivedNode<TangentValue>(id, dependsOn, (inputs) => {
    const constraint = options.constraint
    if (!constraint) return { status: "undefined", diagnostic: invalidHostDiagnostic(id, "切线来源曲线不存在或类型不支持。") }
    let parameter = literal
    if (options.parameterId !== undefined) {
      const value = resolvedValue(inputs.get(options.parameterId))
      if (typeof value !== "number") return { status: "undefined", diagnostic: missingSourceDiagnostic(id, options.parameterId, `切点参数 ${options.parameterId} 没有可用的数值。`) }
      parameter = value
    }
    // 非有限是 `non_finite`，不是退化（规格 §4.2 把两件事分开；同文件其它分支都这么报）。
    if (!Number.isFinite(parameter)) return { status: "undefined", diagnostic: nonFiniteDiagnostic(id, "parameter", `切点参数不是有限数：${String(parameter)}`) }
    const bounded = applyParameterBounds(parameter, constraint.parameterBounds(branch))
    const tangent = constraintTangentAt(constraint, bounded.parameter, branch)
    if (!tangent) return { status: "undefined", diagnostic: invalidDomainDiagnostic(id, `参数 ${bounded.parameter} 处曲线没有切线。`) }
    return { status: "exact", value: tangentValue(tangent, halfLength) }
  })
}

export interface TangentAtPointNodeOptions {
  readonly constraint: PlanarConstraint | null
  /** 定位切点的动点节点（它的坐标会被投影回曲线，得到切点参数）。 */
  readonly pointId: string
  readonly halfLength?: number
  readonly hostIds?: readonly string[]
}

/**
 * **动点处的切线**：先把这个点投影回曲线得到参数，再在该参数处作切线。
 *
 * 投影用约束自己的 `project`（正反映射的唯一一份定义），因此"切线过这个点"永远成立 ——
 * 即使用户把这个点拖到曲线之外（拖动本身不会，但文档可能被编辑过）。
 */
export function tangentAtPointNode(id: string, options: TangentAtPointNodeOptions): DerivedNode<TangentValue> {
  const halfLength = options.halfLength ?? DEFAULT_TANGENT_HALF_LENGTH
  const dependsOn = [...new Set([...(options.hostIds ?? []), options.pointId])]
  return derivedNode<TangentValue>(id, dependsOn, (inputs) => {
    const constraint = options.constraint
    if (!constraint) return { status: "undefined", diagnostic: invalidHostDiagnostic(id, "切线来源曲线不存在或类型不支持。") }
    const point = coordinateInput(inputs, options.pointId)
    if (!point) return { status: "undefined", diagnostic: missingSourceDiagnostic(id, options.pointId, `定位动点 ${options.pointId} 没有可用的坐标。`) }
    const projection = constraint.project(point)
    if (!projection) return { status: "undefined", diagnostic: invalidDomainDiagnostic(id, "动点无法投影回曲线，切线无从确定。") }
    const tangent = constraintTangentAt(constraint, projection.parameter, projection.branch)
    if (!tangent) return { status: "undefined", diagnostic: invalidDomainDiagnostic(id, "曲线在该参数处没有切线。") }
    return { status: "exact", value: tangentValue(tangent, halfLength) }
  })
}

// ---------------------------------------------------------------------------
// 截面
// ---------------------------------------------------------------------------

export interface SectionValue {
  readonly classification: Section3Classification
  readonly points: readonly Vector3[]
}

export interface SolidSectionNodeOptions {
  /** 实体拓扑节点（值形如 `{ vertices, faces }`）。 */
  readonly solidId: string
  /** 剖切平面节点（值形如 `{ normal, constant }`）。 */
  readonly planeId: string
  readonly tolerance?: number
}

interface SolidTopologyValue {
  readonly vertices: readonly Vector3[]
  readonly faces: readonly (readonly number[])[]
}

const isFiniteVector = (value: unknown): value is Vector3 => {
  const record = value as { x?: unknown; y?: unknown; z?: unknown } | null
  return Boolean(record) && typeof record!.x === "number" && typeof record!.y === "number" && typeof record!.z === "number"
    && Number.isFinite(record!.x) && Number.isFinite(record!.y) && Number.isFinite(record!.z)
}

function readSolidTopology(value: unknown): SolidTopologyValue | null {
  const record = value as { vertices?: unknown; faces?: unknown } | null
  if (!record || !Array.isArray(record.vertices) || !Array.isArray(record.faces)) return null
  const vertices = record.vertices as unknown[]
  if (!vertices.every(isFiniteVector)) return null
  if (vertices.length < 4 || record.faces.length < 4) return null
  const faces = record.faces.map((face) => Array.isArray(face) && face.every((index) => Number.isInteger(index) && (index as number) >= 0 && (index as number) < vertices.length) ? face as number[] : null)
  return faces.every((face) => face !== null) ? { vertices: vertices as Vector3[], faces: faces as number[][] } : null
}

function readPlane(value: unknown): { normal: Vector3; constant: number } | null {
  const record = value as { normal?: unknown; constant?: unknown } | null
  if (!record || !isFiniteVector(record.normal) || typeof record.constant !== "number" || !Number.isFinite(record.constant)) return null
  return { normal: record.normal, constant: record.constant }
}

/**
 * 实体与平面的截面。
 *
 * 空截面（平面离开实体）是**合法几何结果**：规格 §3.4 明确要求 `none/point/segment/polygon` 可区分，
 * 所以这里返回 `{ classification: "none", points: [] }`，而不是报错、也不是留着上一圈的旧环。
 * 只有"实体拓扑读不出来"才是诊断（`invalid_host`）。
 */
export function solidSectionNode(id: string, options: SolidSectionNodeOptions): DerivedNode<SectionValue> {
  return derivedNode<SectionValue>(id, [options.solidId, options.planeId], (inputs) => {
    const topology = readSolidTopology(resolvedValue(inputs.get(options.solidId)))
    if (!topology) return { status: "undefined", diagnostic: invalidHostDiagnostic(id, `实体 ${options.solidId} 的拓扑不完整，无法求截面。`) }
    const plane = readPlane(resolvedValue(inputs.get(options.planeId)))
    if (!plane) return { status: "undefined", diagnostic: missingSourceDiagnostic(id, options.planeId, `剖切平面 ${options.planeId} 没有可用的几何。`) }
    const result = options.tolerance === undefined
      ? sectionPolyhedron3([...topology.vertices], topology.faces.map((face) => [...face]), plane)
      : sectionPolyhedron3([...topology.vertices], topology.faces.map((face) => [...face]), plane, options.tolerance)
    if (result.status === "insufficient-data") return { status: "undefined", diagnostic: invalidHostDiagnostic(id, "截面算法报数据不足（拓扑或平面不合法）。") }
    return { status: "exact", value: { classification: result.status, points: result.points } }
  })
}

// ---------------------------------------------------------------------------
// 测量
// ---------------------------------------------------------------------------

export type MeasurementMetric = "distance" | "angle" | "area" | "perimeter" | "distanceToLine"

export interface MeasurementNodeOptions {
  readonly metric: MeasurementMetric
  readonly pointIds: readonly string[]
  /** `distanceToLine` 用：直线节点（值形如 `{ a, b }`）。 */
  readonly lineId?: string
}

const requiredPoints: Record<MeasurementMetric, number> = { distance: 2, angle: 3, area: 3, perimeter: 3, distanceToLine: 1 }

function readLine(value: unknown): { a: Coordinate; b: Coordinate } | null {
  const record = value as { a?: unknown; b?: unknown; point?: unknown } | null
  if (!record) return null
  const first = coordinateOf(record.a)
  const second = coordinateOf(record.b)
  return first && second ? { a: first, b: second } : null
}

function coordinateOf(value: unknown): Coordinate | null {
  const record = value as { x?: unknown; y?: unknown } | null
  return record && typeof record.x === "number" && typeof record.y === "number" && Number.isFinite(record.x) && Number.isFinite(record.y) ? { x: record.x, y: record.y } : null
}

/**
 * 平面测量（距离 / 夹角 / 面积 / 周长 / 点到直线距离）。
 *
 * 几何全部来自既有的 `dynamic-measurements.ts`（与文档里的测量共用同一份定义），
 * 这里只负责"从图上取点 → 调内核 → 退化时说清楚为什么"。
 */
export function planarMeasurementNode(id: string, options: MeasurementNodeOptions): MeasurementNode {
  const dependsOn = [...new Set([...options.pointIds, ...(options.lineId === undefined ? [] : [options.lineId])])]
  const required = requiredPoints[options.metric]
  return createMeasurementNode(id, dependsOn, (inputs) => {
    if (options.pointIds.length < required) return { status: "degenerate", diagnostic: degenerateDiagnostic(id, `${options.metric} 需要至少 ${required} 个点。`) }
    const points: Coordinate[] = []
    for (const pointId of options.pointIds) {
      const value = coordinateInput(inputs, pointId)
      if (!value) return { status: "undefined", diagnostic: missingSourceDiagnostic(id, pointId, `测量来源 ${pointId} 没有可用的坐标。`) }
      points.push(value)
    }
    if (options.metric === "distanceToLine") {
      if (options.lineId === undefined) return { status: "undefined", diagnostic: missingSourceDiagnostic(id, "line", "点到直线的距离缺少直线来源。") }
      const line = readLine(resolvedValue(inputs.get(options.lineId)))
      if (!line) return { status: "undefined", diagnostic: missingSourceDiagnostic(id, options.lineId, `直线 ${options.lineId} 没有可用的几何。`) }
      const signed = signedDistanceToLine(line.a, line.b, points[0])
      if (signed === null) return { status: "degenerate", diagnostic: degenerateDiagnostic(id, "直线退化成一点，距离没有定义。") }
      return { status: "exact", value: Math.abs(signed) }
    }
    if (options.metric === "distance") return { status: "exact", value: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) }
    if (options.metric === "angle") {
      const angle = angleBetween(points[1], points[0], points[2])
      return angle === null ? { status: "degenerate", diagnostic: degenerateDiagnostic(id, "角的两条边退化成一点，夹角没有定义。") } : { status: "exact", value: angle }
    }
    if (options.metric === "perimeter") return { status: "exact", value: polygonPerimeter(points) }
    const area = Math.abs(signedPolygonArea(points))
    // 共线三点的面积是 0：那是退化，而不是"面积等于 0 的一个三角形"。
    return area <= 0 ? { status: "degenerate", diagnostic: degenerateDiagnostic(id, "三点共线，面积退化为 0。") } : { status: "exact", value: area }
  })
}

/** 点到直线的距离（独立入口，方便适配层按语义命名）。 */
export function measurementEdgeNode(id: string, options: Omit<MeasurementNodeOptions, "metric"> & { metric: "distanceToLine" }): MeasurementNode {
  return planarMeasurementNode(id, { ...options, metric: "distanceToLine" })
}
