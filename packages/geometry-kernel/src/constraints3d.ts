import type { ConstraintSpec, Face3Primitive, Line3Primitive, Plane3Primitive, PrimitiveSpec, Point3Primitive, Vector3 } from "@draw/dsl"

import { crossVector3, dotVector3, lengthVector3, normalizeVector3, planeFromPoints, subtractVector3 } from "./geometry3d"

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
type LineLike3 = Extract<PrimitiveSpec, { type: "line3" | "segment3" | "ray3" | "edge3" }>
const EPSILON = 1e-10

function byId(context: Context3): ReadonlyMap<string, PrimitiveSpec> {
  if (Array.isArray(context)) return new Map(context.map((primitive: PrimitiveSpec) => [primitive.id, primitive]))
  return context as ReadonlyMap<string, PrimitiveSpec>
}

function point(map: ReadonlyMap<string, PrimitiveSpec>, id: string): Vector3 | null {
  const primitive = map.get(id)
  return primitive?.type === "point3" ? primitive.position : null
}

function lineEndpoints(primitive: LineLike3, map: ReadonlyMap<string, PrimitiveSpec>): [Vector3, Vector3] | null {
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

function lineDirection(primitive: PrimitiveSpec | undefined, map: ReadonlyMap<string, PrimitiveSpec>): Vector3 | null {
  if (!primitive || !["line3", "segment3", "ray3", "edge3"].includes(primitive.type)) return null
  const endpoints = lineEndpoints(primitive as LineLike3, map)
  if (!endpoints) return null
  const direction = subtractVector3(endpoints[1], endpoints[0])
  return lengthVector3(direction) > EPSILON ? direction : null
}

function planeNormal(primitive: Plane3Primitive | Face3Primitive, map: ReadonlyMap<string, PrimitiveSpec>): Vector3 | null {
  if (primitive.type === "plane3") {
    if (primitive.definition.kind === "pointNormal") return normalizeVector3(primitive.definition.normal)
    const points = primitive.definition.pointIds.map((id) => point(map, id))
    return points.every(Boolean) ? planeFromPoints(points[0]!, points[1]!, points[2]!)?.normal ?? null : null
  }
  const points = primitive.pointIds.map((id) => point(map, id))
  return points.length >= 3 && points.every(Boolean) ? planeFromPoints(points[0]!, points[1]!, points[2]!)?.normal ?? null : null
}

function pointPlaneResidual(pointValue: Vector3, plane: Plane3Primitive, map: ReadonlyMap<string, PrimitiveSpec>): number | null {
  const normal = planeNormal(plane, map)
  if (!normal) return null
  const origin = plane.definition.kind === "pointNormal" ? point(map, plane.definition.pointId) : point(map, plane.definition.pointIds[0])
  return origin ? Math.abs(dotVector3(normal, subtractVector3(pointValue, origin))) : null
}

function pointLineResidual(pointValue: Vector3, line: LineLike3, map: ReadonlyMap<string, PrimitiveSpec>): number | null {
  const endpoints = lineEndpoints(line, map)
  if (!endpoints) return null
  const direction = subtractVector3(endpoints[1], endpoints[0])
  const length = lengthVector3(direction)
  return length > EPSILON ? lengthVector3(crossVector3(subtractVector3(pointValue, endpoints[0]), direction)) / length : null
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
 * Diagnosis-only helper: it reports residuals and conflicts for spatial constraints and deliberately does not
 * project or move any point, so `positions` mirrors the current point positions. Constraint projection is
 * scheduled with the spatial-relation teaching slice; `converged` therefore only means "every diagnosed
 * constraint is already satisfied".
 */
export function solvePoint3Constraints(constraints: ConstraintSpec[], context: Context3, tolerance = 1e-6): ConstraintSolve3Result {
  const map = byId(context)
  const positions = new Map([...map.values()].filter((primitive): primitive is Point3Primitive => primitive.type === "point3").map((primitive) => [primitive.id, { ...primitive.position }]))
  const diagnostics = diagnoseConstraints3(constraints, map, tolerance)
  return { positions, diagnostics, converged: diagnostics.every((diagnostic) => diagnostic.satisfied) }
}
