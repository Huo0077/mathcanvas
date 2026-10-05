import type { ConstraintSpec, Face3Primitive, Line3Primitive, Plane3Primitive, PrimitiveSpec, Point3Primitive, Vector3 } from "@draw/dsl"

import { addVector3, crossVector3, dotVector3, lengthVector3, normalizeVector3, planeFromPoints, scaleVector3, subtractVector3 } from "./geometry3d"

export interface ConstraintDiagnostic3 {
  constraintId: string
  residual: number | null
  satisfied: boolean
  conflict: boolean
  explanation: string
}

export interface ConstraintSolve3Result {
  positions: Map<string, Vector3>
  diagnostics: ConstraintDiagnostic3[]
  converged: boolean
}

type Context3 = readonly PrimitiveSpec[] | ReadonlyMap<string, PrimitiveSpec>
/** 能把方向读出来的线状图元。**导出**是因为 N3 的拖动投影要用同一份判据，不许抄第二遍。 */
export type LineLike3 = Extract<PrimitiveSpec, { type: "line3" | "segment3" | "ray3" | "edge3" }>
const EPSILON = 1e-10

function byId(context: Context3): ReadonlyMap<string, PrimitiveSpec> {
  if (Array.isArray(context)) return new Map(context.map((primitive: PrimitiveSpec) => [primitive.id, primitive]))
  return context as ReadonlyMap<string, PrimitiveSpec>
}

function point(map: ReadonlyMap<string, PrimitiveSpec>, id: string): Vector3 | null {
  const primitive = map.get(id)
  return primitive?.type === "point3" ? primitive.position : null
}

/**
 * 一条线状图元的两个端点。**导出**是因为 N3 的线状投影要用同一份"怎么从图元读出一条线"的判据
 *（与 `isLineLike3` 同一条纪律：同一个判断不许写两遍）。
 */
export function lineEndpoints(primitive: LineLike3, map: ReadonlyMap<string, PrimitiveSpec>): [Vector3, Vector3] | null {
  if (primitive.type === "line3") {
    if (primitive.definition.kind === "pointDirection") {
      const origin = point(map, primitive.definition.pointId)
      return origin ? [origin, { x: origin.x + primitive.definition.direction.x, y: origin.y + primitive.definition.direction.y, z: origin.z + primitive.definition.direction.z }] : null
    }
    const first = point(map, primitive.definition.pointIds[0])
    const second = point(map, primitive.definition.pointIds[1])
    return first && second ? [first, second] : null
  }
  const ids = primitive.type === "ray3" ? [primitive.originId, primitive.throughId] : primitive.pointIds
  const first = point(map, ids[0])
  const second = point(map, ids[1])
  return first && second ? [first, second] : null
}

/**
 * "这个图元是不是线状的"这条判据的唯一实现。
 *
 * 导出是因为 N3 的拖动投影也要问同一个问题；两处各写一份 `["line3", …].includes(type)`
 * 就是"同一个判断写两遍"，而这类分叉在本项目里已经吃过几次亏。
 */
export function isLineLike3(primitive: PrimitiveSpec | undefined): primitive is LineLike3 {
  return primitive !== undefined && ["line3", "segment3", "ray3", "edge3"].includes(primitive.type)
}

function lineDirection(primitive: PrimitiveSpec | undefined, map: ReadonlyMap<string, PrimitiveSpec>): Vector3 | null {
  if (!isLineLike3(primitive)) return null
  const endpoints = lineEndpoints(primitive, map)
  if (!endpoints) return null
  const direction = subtractVector3(endpoints[1], endpoints[0])
  return lengthVector3(direction) > EPSILON ? direction : null
}

function planeNormal(primitive: Plane3Primitive | Face3Primitive, map: ReadonlyMap<string, PrimitiveSpec>): Vector3 | null {
  if (primitive.type === "plane3") {
    /**
     * 法向必须**真的能归一化**：schema 只要求"非零"，于是 (1e-30,0,0) 这种数量级能存进文档，
     * 而 `normalizeVector3` 对长度 < 1e-12 的输入返回零向量——此时任何点到平面的残差都算成 0，
     * 得到一个"永远满足"的假约束。归一化失败就返回 null（调用方报数据不足）。
     */
    if (primitive.definition.kind === "pointNormal") {
      const unit = normalizeVector3(primitive.definition.normal)
      return lengthVector3(unit) > EPSILON ? unit : null
    }
    const points = primitive.definition.pointIds.map((id) => point(map, id))
    return points.every(Boolean) ? planeFromPoints(points[0]!, points[1]!, points[2]!)?.normal ?? null : null
  }
  const points = primitive.pointIds.map((id) => point(map, id))
  return points.length >= 3 && points.every(Boolean) ? planeFromPoints(points[0]!, points[1]!, points[2]!)?.normal ?? null : null
}

/** 平面上的一个点：法式平面用它自己的基点，三点式用第一个点。**唯一一处**这么读。 */
function planeOrigin(plane: Plane3Primitive, map: ReadonlyMap<string, PrimitiveSpec>): Vector3 | null {
  return plane.definition.kind === "pointNormal" ? point(map, plane.definition.pointId) : point(map, plane.definition.pointIds[0])
}

function pointPlaneResidual(pointValue: Vector3, plane: Plane3Primitive, map: ReadonlyMap<string, PrimitiveSpec>): number | null {
  const normal = planeNormal(plane, map)
  const origin = planeOrigin(plane, map)
  if (!normal || !origin) return null
  return Math.abs(dotVector3(normal, subtractVector3(pointValue, origin)))
}

function pointLineResidual(pointValue: Vector3, line: LineLike3, map: ReadonlyMap<string, PrimitiveSpec>): number | null {
  const endpoints = lineEndpoints(line, map)
  if (!endpoints) return null
  const direction = subtractVector3(endpoints[1], endpoints[0])
  const length = lengthVector3(direction)
  return length > EPSILON ? lengthVector3(crossVector3(subtractVector3(pointValue, endpoints[0]), direction)) / length : null
}

/**
 * **点在线上的垂足**（N3 的拖动投影；残差只回答"差多少"，这里回答"该挪到哪"）。
 *
 * 与 `pointLineResidual` 共用同一份"怎么从图元读出一条线"的判据（`lineEndpoints`），
 * 所以"残差说 0"与"垂足就是它自己"不可能分叉。直线退化（两端点重合）时返回 `null`：
 * 此时垂足有无穷多个，编一个出来就是拿假设当结果。
 */
export function projectPointOntoLine3(pointValue: Vector3, line: LineLike3, map: ReadonlyMap<string, PrimitiveSpec>): Vector3 | null {
  const endpoints = lineEndpoints(line, map)
  if (!endpoints) return null
  const direction = subtractVector3(endpoints[1], endpoints[0])
  const squared = dotVector3(direction, direction)
  if (squared <= EPSILON * EPSILON) return null
  const ratio = dotVector3(subtractVector3(pointValue, endpoints[0]), direction) / squared
  return addVector3(endpoints[0], scaleVector3(direction, ratio))
}

/**
 * **点在平面上的垂足**。法向归一化失败（`planeNormal` 返回 `null`，例如 (1e-30,0,0) 那种
 * 存得进文档却归一化不出来的法向）时返回 `null` —— 与 `pointPlaneResidual` 同一条纪律：
 * 算不出来就说算不出来，**不报 0、也不编一个落点**。
 */
export function projectPointOntoPlane3(pointValue: Vector3, plane: Plane3Primitive, map: ReadonlyMap<string, PrimitiveSpec>): Vector3 | null {
  const normal = planeNormal(plane, map)
  const origin = planeOrigin(plane, map)
  if (!normal || !origin) return null
  const unit = normalizeVector3(normal)
  if (lengthVector3(unit) <= EPSILON) return null
  const distance = dotVector3(subtractVector3(pointValue, origin), unit)
  return subtractVector3(pointValue, scaleVector3(unit, distance))
}

function pointSet(map: ReadonlyMap<string, PrimitiveSpec>, ids: string[]): Vector3[] | null {
  const points = ids.map((id) => point(map, id))
  return points.every(Boolean) ? points as Vector3[] : null
}

function collinearResidual(points: Vector3[]): number {
  const direction = subtractVector3(points[1], points[0])
  const scale = Math.max(lengthVector3(direction), EPSILON)
  return Math.max(...points.slice(2).map((candidate) => lengthVector3(crossVector3(subtractVector3(candidate, points[0]), direction)) / scale))
}

function coplanarResidual(points: Vector3[]): number | null {
  const plane = planeFromPoints(points[0], points[1], points[2])
  return plane ? Math.abs(dotVector3(plane.normal, points[3]) + plane.constant) : null
}

export function constraintResidual3(constraint: ConstraintSpec, context: Context3): number | null {
  const map = byId(context)
  const targets = constraint.targets.map((id) => map.get(id))
  if (targets.some((target) => !target)) return null
  if (constraint.type === "pointOnLine") {
    const pointValue = point(map, constraint.targets[0])
    return pointValue && targets[1] ? pointLineResidual(pointValue, targets[1] as LineLike3, map) : null
  }
  if (constraint.type === "pointOnPlane") {
    const pointValue = point(map, constraint.targets[0])
    return pointValue && targets[1]?.type === "plane3" ? pointPlaneResidual(pointValue, targets[1], map) : null
  }
  if (constraint.type === "collinear") {
    const points = pointSet(map, constraint.targets)
    return points ? collinearResidual(points) : null
  }
  if (constraint.type === "coplanar") {
    const points = pointSet(map, constraint.targets)
    return points ? coplanarResidual(points) : null
  }
  if (constraint.type === "parallel" || constraint.type === "perpendicular") {
    const first = lineDirection(targets[0], map)
    const second = lineDirection(targets[1], map)
    if (!first || !second) return null
    const scale = lengthVector3(first) * lengthVector3(second)
    return constraint.type === "parallel" ? lengthVector3(crossVector3(first, second)) / scale : Math.abs(dotVector3(first, second)) / scale
  }
  if (constraint.type === "fixedDistance") {
    const first = point(map, constraint.targets[0])
    const second = point(map, constraint.targets[1])
    return first && second && constraint.value !== undefined ? Math.abs(lengthVector3(subtractVector3(first, second)) - constraint.value) : null
  }
  // "coincident" is a planar (2D) constraint and has no spatial residual.
  return null
}

/** 这条约束**本身就与另一条不可能同时成立**的两种可证情形。 */
export type ConstraintContradictionCode =
  /** 同一条线段被要求等于两个不同的长度。 */
  | "same-segment-two-lengths"
  /** 点既要落在这条线上、又要落在这个平面上，而两者平行且不相交。 */
  | "line-parallel-to-plane"

export interface ConstraintContradiction {
  code: ConstraintContradictionCode
  /** 参与这条矛盾的约束 id（至少两条）。 */
  constraintIds: string[]
  reason: string
}

/**
 * **可证的矛盾**（N3：把"没能同时满足"与"这两条根本不可能同时成立"分开）。
 *
 * ## 为什么必须有这一层
 *
 * 顺序投影在矛盾约束上会**来回振荡**（长度 2 与长度 3 把同一个点沿同一根轴反复拽），
 * 于是求解层停下来时只能说"在轮数内没能同时满足" —— 那是诚实的，但它把"我还不知道"
 * （可能只是投影没收敛）与"我知道它不成立"压成了同一句话。
 *
 * ## 只报能证明的两种，一条都不多报
 *
 * 1. **同一条线段两个不同的长度要求**：距离是一个数，`|v₁ − v₂| > 容差` 就是两条不同的要求。
 * 2. **点既在直线上、又在平面上，而两者平行且不相交**：平行时不交；直线到平面的距离大于
 *    容差时无公共点。**直线落在平面里不算矛盾**（此时交集就是整条线，随便取一个点都行），
 *    直线与平面相交于一点也不算（那个交点就是唯一解）。
 *
 * 其余情形（例如"三点共线"与"某两点距离非零"的相互作用）**需要更多几何推理**，
 * 本版不猜 —— 一条编出来的"矛盾"会把一份本来能解的题直接判死。
 */
export function findConstraintContradictions(
  constraints: readonly ConstraintSpec[],
  context: Context3,
  tolerance = 1e-6
): ConstraintContradiction[] {
  const map = byId(context)
  const found: ConstraintContradiction[] = []

  // 情形 1：按**无序点对**归组定长约束，组内值不一致就是矛盾。
  const byPair = new Map<string, { id: string; value: number }[]>()
  for (const constraint of constraints) {
    if (constraint.type !== "fixedDistance" || constraint.value === undefined) continue
    const [first, second] = constraint.targets
    if (first === undefined || second === undefined || first === second) continue
    const key = [first, second].sort().join("\u0000")
    const group = byPair.get(key)
    if (group) group.push({ id: constraint.id, value: constraint.value })
    else byPair.set(key, [{ id: constraint.id, value: constraint.value }])
  }
  for (const group of byPair.values()) {
    if (group.length < 2) continue
    const values = group.map((entry) => entry.value)
    if (Math.max(...values) - Math.min(...values) <= tolerance) continue
    found.push({
      code: "same-segment-two-lengths",
      constraintIds: group.map((entry) => entry.id),
      reason: `同一条线段被要求等于 ${values.join(" 与 ")} —— 距离只能是一个数，这两条不可能同时成立。`
    })
  }

  // 情形 2：同一个点既在线上又在面上，而线与面平行且不相交。
  const onLineByPoint = new Map<string, ConstraintSpec[]>()
  const onPlaneByPoint = new Map<string, ConstraintSpec[]>()
  for (const constraint of constraints) {
    const pointId = constraint.targets[0]
    if (pointId === undefined) continue
    if (constraint.type === "pointOnLine") {
      const group = onLineByPoint.get(pointId)
      if (group) group.push(constraint)
      else onLineByPoint.set(pointId, [constraint])
    } else if (constraint.type === "pointOnPlane") {
      const group = onPlaneByPoint.get(pointId)
      if (group) group.push(constraint)
      else onPlaneByPoint.set(pointId, [constraint])
    }
  }
  for (const [pointId, lineConstraints] of onLineByPoint) {
    const planeConstraints = onPlaneByPoint.get(pointId)
    if (!planeConstraints) continue
    for (const lineConstraint of lineConstraints) {
      const line = map.get(lineConstraint.targets[1] ?? "")
      const plane = map.get(planeConstraints[0].targets[1] ?? "")
      if (!isLineLike3(line) || plane?.type !== "plane3") continue
      const endpoints = lineEndpoints(line, map)
      const normal = planeNormal(plane, map)
      const origin = planeOrigin(plane, map)
      if (!endpoints || !normal || !origin) continue
      const direction = subtractVector3(endpoints[1], endpoints[0])
      const directionLength = lengthVector3(direction)
      const unit = normalizeVector3(normal)
      if (directionLength <= EPSILON || lengthVector3(unit) <= EPSILON) continue
      // 平行：方向与法向的点积（除以方向长度做尺度归一）在容差内为 0。
      if (Math.abs(dotVector3(direction, unit)) / directionLength > tolerance) continue
      // 直线到平面的距离：大于容差就是"不相交"。
      if (Math.abs(dotVector3(subtractVector3(endpoints[0], origin), unit)) <= tolerance) continue
      found.push({
        code: "line-parallel-to-plane",
        constraintIds: [planeConstraints[0].id, lineConstraint.id],
        reason: `点 ${pointId} 既要落在这条线上、又要落在这个平面上，而这条线与这个平面平行且不相交 —— 没有公共点。`
      })
    }
  }

  return found
}

export function diagnoseConstraint3(constraint: ConstraintSpec, context: Context3, tolerance = constraint.tolerance ?? 1e-6): ConstraintDiagnostic3 {
  const residual = constraintResidual3(constraint, context)
  const satisfied = residual !== null && residual <= tolerance
  return { constraintId: constraint.id, residual, satisfied, conflict: residual === null || !satisfied, explanation: residual === null ? "缺少有效空间来源，无法计算约束残差。" : satisfied ? `约束已满足，残差 ${residual.toExponential(2)}。` : `约束存在冲突，残差 ${residual.toExponential(2)} 超过容差 ${tolerance.toExponential(2)}。` }
}

/** Diagnose every spatial constraint. Planar-only `coincident` has no spatial residual and is skipped. */
export function diagnoseConstraints3(constraints: ConstraintSpec[], context: Context3, tolerance?: number): ConstraintDiagnostic3[] {
  return constraints.filter((constraint) => constraint.type !== "coincident").map((constraint) => diagnoseConstraint3(constraint, context, tolerance))
}

/**
 * **只诊断，绝不动点**（这条分工有测试钉着）：它报告残差与冲突，因此 `positions` 逐点等于
 * 当前位置，`converged` 只意味着"每一条被诊断的约束现在都已经满足"。
 *
 * **真的要挪点**请用 `projectPoint3Constraints`（`constraints3dProjection.ts`，N3 的拖动投影）：
 * 那是另一个函数、另一份契约（它带锚点、跳过分类与 fail-closed 的 `satisfied`）。
 * 两条路都保留是有意的 —— 拖动前要问"现在差多少"，拖动中要问"该挪到哪"，
 * 而把这两件事塞进一个函数就会让"诊断"顺手改掉调用方的几何。
 */
export function solvePoint3Constraints(constraints: ConstraintSpec[], context: Context3, tolerance = 1e-6): ConstraintSolve3Result {
  const map = byId(context)
  const positions = new Map([...map.values()].filter((primitive): primitive is Point3Primitive => primitive.type === "point3").map((primitive) => [primitive.id, { ...primitive.position }]))
  const diagnostics = diagnoseConstraints3(constraints, map, tolerance)
  return { positions, diagnostics, converged: diagnostics.every((diagnostic) => diagnostic.satisfied) }
}
