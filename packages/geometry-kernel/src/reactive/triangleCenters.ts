import type { Coordinate, DerivedSolidResult, Vector3 } from "@draw/dsl"

import { crossVector3, dotVector3, lengthVector3, normalizeVector3 } from "../geometry3d"
import { coordinateInput, degenerateDiagnostic, derivedNode, invalidDomainDiagnostic, measurementNode, missingSourceDiagnostic, vector3Input } from "./evaluator"
import type { DerivedNode, EvaluationResult, MeasurementNode } from "./types"

/**
 * **三角形的五心与半径**（设计规格 §4.3）。
 *
 * ```text
 * G = (A+B+C)/3
 * I = (aA+bB+cC)/(a+b+c)
 * r_in = 2*area/(a+b+c)      R = abc/(4*area)
 * H = A+B+C-2O
 * ```
 *
 * 三条实现要点：
 *
 * 1. **在三角形自身的二维基底里算**（`triangleFrame`）。规格 §4.3 点名要求"外心在三角形自身二维
 *    基底中解垂直平分线"：直接在三维里解方程组也行，但投影到平面内之后所有公式都退化成课本上的
 *    二维闭式解，边角关系一目了然，也顺带支持"三角形躺在一个斜平面上"。
 * 2. **退化是四态之一**：三点共线时外心 / 内心 / 垂心 / 旁心 / 三个半径都**没有定义**，
 *    返回 `degenerate`。硬套公式只会得到一个看起来像答案的点（外心公式在这里除以 0）。
 *    形心是例外：三点平均对共线点依然良定义，所以它照算 —— 这是有意的，不是漏判。
 * 3. **纯函数 + 薄节点**：几何在 `triangleCenter` / `triangleRadius` 里，节点只负责读上游、
 *    把 `DerivedSolidResult` 翻译成结构化诊断。
 */

export type TriangleCenterKind = "centroid" | "incenter" | "circumcenter" | "orthocenter" | "excenter"
export type TriangleRadiusMetric = "inradius" | "circumradius" | "exradius"

export interface Triangle3 {
  readonly a: Vector3
  readonly b: Vector3
  readonly c: Vector3
}

export interface TriangleOptions {
  /** 退化判据的**相对**容差（除以最长边²）。缺省 1e-9。 */
  readonly tolerance?: number
  /** 哪个顶点的旁心（0=A、1=B、2=C），只对 `excenter` 有意义。 */
  readonly excenterVertex?: 0 | 1 | 2
}

const DEFAULT_DEGENERACY_TOLERANCE = 1e-9

interface PlaneFrame {
  readonly origin: Vector3
  readonly u: Vector3
  readonly v: Vector3
}

const finiteVector = (point: Vector3): boolean => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)

/** 只看"算出来了 / 没算出来"两种失败：没有 `approximate` 这一档（五心都是闭式解）。 */
type ExactOrFailure<Value> =
  | { status: "exact"; value: Value }
  | { status: "undefined"; reason: string }
  | { status: "degenerate"; reason: string }

const undefinedResult = (reason: string): { status: "undefined"; reason: string } => ({ status: "undefined", reason })
const degenerateResult = (reason: string): { status: "degenerate"; reason: string } => ({ status: "degenerate", reason })

/** 三点是否退化（共线 / 重合）：`2*area` 相对最长边的平方小于容差。 */
function isDegenerate(triangle: Triangle3, tolerance: number): boolean {
  const first = crossVector3({ x: triangle.b.x - triangle.a.x, y: triangle.b.y - triangle.a.y, z: triangle.b.z - triangle.a.z }, { x: triangle.c.x - triangle.a.x, y: triangle.c.y - triangle.a.y, z: triangle.c.z - triangle.a.z })
  const scale = Math.max(1, lengthVector3({ x: triangle.b.x - triangle.a.x, y: triangle.b.y - triangle.a.y, z: triangle.b.z - triangle.a.z }), lengthVector3({ x: triangle.c.x - triangle.a.x, y: triangle.c.y - triangle.a.y, z: triangle.c.z - triangle.a.z }))
  return lengthVector3(first) <= tolerance * scale * scale
}

/** 边长的规范记法：`a = |BC|`、`b = |CA|`、`c = |AB|`（与规格 §4.3 的公式一致）。 */
function sideLengths(triangle: Triangle3): { a: number; b: number; c: number; perimeter: number; doubleArea: number } {
  const a = Math.hypot(triangle.c.x - triangle.b.x, triangle.c.y - triangle.b.y, triangle.c.z - triangle.b.z)
  const b = Math.hypot(triangle.a.x - triangle.c.x, triangle.a.y - triangle.c.y, triangle.a.z - triangle.c.z)
  const c = Math.hypot(triangle.b.x - triangle.a.x, triangle.b.y - triangle.a.y, triangle.b.z - triangle.a.z)
  return { a, b, c, perimeter: a + b + c, doubleArea: lengthVector3(crossVector3({ x: triangle.b.x - triangle.a.x, y: triangle.b.y - triangle.a.y, z: triangle.b.z - triangle.a.z }, { x: triangle.c.x - triangle.a.x, y: triangle.c.y - triangle.a.y, z: triangle.c.z - triangle.a.z })) }
}

/** 三角形自身的二维基底：原点在 A，`u` 沿 AB，`v` 在三角形平面内且与 `u` 正交。 */
function triangleFrame(triangle: Triangle3, tolerance: number): ExactOrFailure<PlaneFrame> {
  if (![triangle.a, triangle.b, triangle.c].every(finiteVector)) return undefinedResult("三角形顶点不是有限坐标。")
  if (isDegenerate(triangle, tolerance)) return degenerateResult("三点共线（或重合），三角形没有自身的二维基底。")
  const u = normalizeVector3({ x: triangle.b.x - triangle.a.x, y: triangle.b.y - triangle.a.y, z: triangle.b.z - triangle.a.z })
  const normal = normalizeVector3(crossVector3({ x: triangle.b.x - triangle.a.x, y: triangle.b.y - triangle.a.y, z: triangle.b.z - triangle.a.z }, { x: triangle.c.x - triangle.a.x, y: triangle.c.y - triangle.a.y, z: triangle.c.z - triangle.a.z }))
  const v = crossVector3(normal, u)
  return { status: "exact", value: { origin: triangle.a, u, v } }
}

const toPlane = (frame: PlaneFrame, point: Vector3): Coordinate => {
  const offset = { x: point.x - frame.origin.x, y: point.y - frame.origin.y, z: point.z - frame.origin.z }
  return { x: dotVector3(offset, frame.u), y: dotVector3(offset, frame.v) }
}

const fromPlane = (frame: PlaneFrame, point: Coordinate): Vector3 => ({
  x: frame.origin.x + point.x * frame.u.x + point.y * frame.v.x,
  y: frame.origin.y + point.x * frame.u.y + point.y * frame.v.y,
  z: frame.origin.z + point.x * frame.u.z + point.y * frame.v.z
})

/** 二维（三角形自身基底内）的中心公式。退化情形由调用方先行拦掉。 */
function center2d(kind: TriangleCenterKind, first: Coordinate, second: Coordinate, third: Coordinate, sides: { a: number; b: number; c: number }, excenterVertex: 0 | 1 | 2): Coordinate {
  const average = (weights: [number, number, number]): Coordinate => ({
    x: (weights[0] * first.x + weights[1] * second.x + weights[2] * third.x) / (weights[0] + weights[1] + weights[2]),
    y: (weights[0] * first.y + weights[1] * second.y + weights[2] * third.y) / (weights[0] + weights[1] + weights[2])
  })
  if (kind === "centroid") return average([1, 1, 1])
  // 内心：以对边长为权（aA + bB + cC）/（a+b+c）。
  if (kind === "incenter") return average([sides.a, sides.b, sides.c])
  if (kind === "excenter") {
    const weights: [number, number, number] = [sides.a, sides.b, sides.c]
    weights[excenterVertex] = -weights[excenterVertex]
    return average(weights)
  }
  // 外心：解两条垂直平分线（克莱姆法则）。退化（行列式为 0）已经被 `isDegenerate` 拦掉。
  const determinant = 2 * (first.x * (second.y - third.y) + second.x * (third.y - first.y) + third.x * (first.y - second.y))
  const firstSquared = first.x * first.x + first.y * first.y
  const secondSquared = second.x * second.x + second.y * second.y
  const thirdSquared = third.x * third.x + third.y * third.y
  const circumcenter: Coordinate = {
    x: (firstSquared * (second.y - third.y) + secondSquared * (third.y - first.y) + thirdSquared * (first.y - second.y)) / determinant,
    y: (firstSquared * (third.x - second.x) + secondSquared * (first.x - third.x) + thirdSquared * (second.x - first.x)) / determinant
  }
  if (kind === "circumcenter") return circumcenter
  // H = A + B + C − 2O（仿射恒等式，在任何仿射坐标系里都成立）。
  return { x: first.x + second.x + third.x - 2 * circumcenter.x, y: first.y + second.y + third.y - 2 * circumcenter.y }
}

interface PreparedTriangle {
  readonly frame: PlaneFrame
  readonly sides: ReturnType<typeof sideLengths>
  readonly first: Coordinate
  readonly second: Coordinate
  readonly third: Coordinate
}

function prepare(triangle: Triangle3, options: TriangleOptions): ExactOrFailure<PreparedTriangle> {
  const tolerance = options.tolerance ?? DEFAULT_DEGENERACY_TOLERANCE
  const frame = triangleFrame(triangle, tolerance)
  if (frame.status === "undefined") return undefinedResult(frame.reason)
  if (frame.status === "degenerate") return degenerateResult(frame.reason)
  return {
    status: "exact",
    value: {
      frame: frame.value,
      sides: sideLengths(triangle),
      first: toPlane(frame.value, triangle.a),
      second: toPlane(frame.value, triangle.b),
      third: toPlane(frame.value, triangle.c)
    }
  }
}

/** 五心之一。共线输入 → `degenerate`；非有限输入 → `undefined`。 */
export function triangleCenter(kind: TriangleCenterKind, triangle: Triangle3, options: TriangleOptions = {}): DerivedSolidResult<Vector3> {
  // 形心是三点平均，**不需要**三角形自身的基底，对共线点也良定义：先行处理，不参与退化判定。
  if (kind === "centroid") {
    if (![triangle.a, triangle.b, triangle.c].every(finiteVector)) return undefinedResult("三角形顶点不是有限坐标。")
    return { status: "exact", value: { x: (triangle.a.x + triangle.b.x + triangle.c.x) / 3, y: (triangle.a.y + triangle.b.y + triangle.c.y) / 3, z: (triangle.a.z + triangle.b.z + triangle.c.z) / 3 } }
  }
  const prepared = prepare(triangle, options)
  if (prepared.status !== "exact") return prepared
  const { frame, sides, first, second, third } = prepared.value
  const center = center2d(kind, first, second, third, sides, options.excenterVertex ?? 0)
  const lifted = fromPlane(frame, center)
  return finiteVector(lifted) ? { status: "exact", value: lifted } : undefinedResult("中心坐标不是有限数。")
}

export function triangleCenter2(kind: TriangleCenterKind, a: Coordinate, b: Coordinate, c: Coordinate, options: TriangleOptions = {}): DerivedSolidResult<Coordinate> {
  const result = triangleCenter(kind, { a: { ...a, z: 0 }, b: { ...b, z: 0 }, c: { ...c, z: 0 } }, options)
  return result.status === "exact" ? { status: "exact", value: { x: result.value.x, y: result.value.y } } : result
}

/** 内切圆半径 / 外接圆半径 / 旁切圆半径。 */
export function triangleRadius(metric: TriangleRadiusMetric, triangle: Triangle3, options: TriangleOptions = {}): DerivedSolidResult<number> {
  const prepared = prepare(triangle, options)
  if (prepared.status !== "exact") return prepared
  const { sides } = prepared.value
  if (metric === "inradius") {
    // r = 2*area/(a+b+c) = doubleArea/perimeter
    return { status: "exact", value: sides.doubleArea / sides.perimeter }
  }
  if (metric === "circumradius") {
    // R = abc/(4*area) = abc/(2*doubleArea)
    return { status: "exact", value: (sides.a * sides.b * sides.c) / (2 * sides.doubleArea) }
  }
  // 旁切圆半径 r_A = area/(s−a) = doubleArea/(perimeter − 2a)
  const vertex = options.excenterVertex ?? 0
  const opposite = vertex === 0 ? sides.a : vertex === 1 ? sides.b : sides.c
  return { status: "exact", value: sides.doubleArea / (sides.perimeter - 2 * opposite) }
}

export function triangleRadius2(metric: TriangleRadiusMetric, a: Coordinate, b: Coordinate, c: Coordinate, options: TriangleOptions = {}): DerivedSolidResult<number> {
  return triangleRadius(metric, { a: { ...a, z: 0 }, b: { ...b, z: 0 }, c: { ...c, z: 0 } }, options)
}

export interface TriangleCenterNodeOptions {
  readonly kind: TriangleCenterKind
  /** 三个顶点节点，按 A、B、C 顺序。 */
  readonly pointIds: readonly [string, string, string]
  /** `plane`（缺省）读二维坐标、`space` 读三维坐标。 */
  readonly space?: "plane" | "space"
  readonly excenterVertex?: 0 | 1 | 2
  readonly tolerance?: number
}

const failureFor = (nodeId: string, result: DerivedSolidResult<unknown>): EvaluationResult<never> => {
  if (result.status === "degenerate") return { status: "degenerate", diagnostic: degenerateDiagnostic(nodeId, result.reason) }
  if (result.status === "undefined") return { status: "undefined", diagnostic: invalidDomainDiagnostic(nodeId, result.reason) }
  return { status: "undefined", diagnostic: invalidDomainDiagnostic(nodeId, "求值没有给出可用的结果。") }
}

function readTriangle(
  inputs: ReadonlyMap<string, EvaluationResult<unknown>>,
  pointIds: readonly [string, string, string],
  space: "plane" | "space"
): { triangle: Triangle3 } | { missing: string } {
  const read = (id: string) => space === "plane" ? coordinateInput(inputs, id) : vector3Input(inputs, id)
  const points = pointIds.map((id) => ({ id, value: read(id) }))
  const absent = points.find((point) => point.value === null)
  if (absent) return { missing: absent.id }
  const [first, second, third] = points.map((point) => point.value!) as [Coordinate | Vector3, Coordinate | Vector3, Coordinate | Vector3]
  const lift = (point: Coordinate | Vector3): Vector3 => ({ x: point.x, y: point.y, z: "z" in point ? point.z : 0 })
  return { triangle: { a: lift(first), b: lift(second), c: lift(third) } }
}

export function triangleCenterNode(id: string, options: TriangleCenterNodeOptions): DerivedNode<Coordinate | Vector3> {
  const space = options.space ?? "plane"
  const triangleOptions: TriangleOptions = { ...(options.tolerance === undefined ? {} : { tolerance: options.tolerance }), ...(options.excenterVertex === undefined ? {} : { excenterVertex: options.excenterVertex }) }
  return derivedNode<Coordinate | Vector3>(id, options.pointIds, (inputs) => {
    const read = readTriangle(inputs, options.pointIds, space)
    if ("missing" in read) return { status: "undefined", diagnostic: missingSourceDiagnostic(id, read.missing) }
    const result = triangleCenter(options.kind, read.triangle, triangleOptions)
    if (result.status !== "exact") return failureFor(id, result)
    return { status: "exact", value: space === "plane" ? { x: result.value.x, y: result.value.y } : result.value }
  })
}

export interface TriangleRadiusNodeOptions {
  readonly metric: TriangleRadiusMetric
  readonly pointIds: readonly [string, string, string]
  readonly space?: "plane" | "space"
  readonly excenterVertex?: 0 | 1 | 2
  readonly tolerance?: number
}

export function triangleRadiusNode(id: string, options: TriangleRadiusNodeOptions): MeasurementNode {
  const space = options.space ?? "plane"
  const triangleOptions: TriangleOptions = { ...(options.tolerance === undefined ? {} : { tolerance: options.tolerance }), ...(options.excenterVertex === undefined ? {} : { excenterVertex: options.excenterVertex }) }
  return measurementNode(id, options.pointIds, (inputs) => {
    const read = readTriangle(inputs, options.pointIds, space)
    if ("missing" in read) return { status: "undefined", diagnostic: missingSourceDiagnostic(id, read.missing) }
    const result = triangleRadius(options.metric, read.triangle, triangleOptions)
    return result.status === "exact" ? { status: "exact", value: result.value } : failureFor(id, result)
  })
}
