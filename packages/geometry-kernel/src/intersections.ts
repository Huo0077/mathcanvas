import type { CirclePrimitive, Coordinate, LinePrimitive, PolylinePrimitive, RayPrimitive } from "@draw/dsl"
import { orient2d } from "robust-predicates"

import { allFinite, defaultNumericPolicy, nearlyZero, scaledTolerance, type NumericPolicy } from "./numeric"
import type { IntersectionResult } from "./types"

function pointDistance(first: Coordinate, second: Coordinate): number {
  return Math.hypot(first.x - second.x, first.y - second.y)
}

function uniquePoints(points: Coordinate[], tolerance = 1e-9): Coordinate[] {
  const unique: Coordinate[] = []
  for (const point of points) if (!unique.some((candidate) => pointDistance(candidate, point) <= tolerance * Math.max(1, Math.abs(point.x), Math.abs(point.y), Math.abs(candidate.x), Math.abs(candidate.y)))) unique.push(point)
  return unique
}

function segmentParameter(segment: { a: Coordinate; b: Coordinate }, point: Coordinate): number | null {
  const dx = segment.b.x - segment.a.x
  const dy = segment.b.y - segment.a.y
  const length = Math.hypot(dx, dy)
  if (!Number.isFinite(length) || length === 0) return null
  return ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) / (length * length)
}

function inUnitInterval(value: number | null, tolerance = 1e-9): boolean {
  return value !== null && value >= -tolerance && value <= 1 + tolerance
}

/**
 * 交点是否落在射线的**前向半线**上。
 *
 * 垂直距离是长度量纲，判据必须随坐标尺度缩放：在 ~1e6 的坐标上，交点本身由浮点算出来就带着
 * ~1e-10 的残差，用绝对 1e-12 去比会把"确实相交"误判成"在起点之后"（实测：射线方向 (1, 0.001)、
 * 起点 (1e6, 1e6)、竖直直线在 x = 1e6 + 0.0005 处相交 → 旧实现返回 `none`）。
 */
function onRay(ray: RayPrimitive, point: Coordinate, policy: NumericPolicy = defaultNumericPolicy): boolean {
  const dx = ray.b.x - ray.a.x
  const dy = ray.b.y - ray.a.y
  const length = Math.hypot(dx, dy)
  if (!Number.isFinite(length) || length === 0) return false
  const ux = dx / length
  const uy = dy / length
  const offsetX = point.x - ray.a.x
  const offsetY = point.y - ray.a.y
  const tolerance = scaledTolerance([point.x, point.y, ray.a.x, ray.a.y, ray.b.x, ray.b.y], policy)
  return Math.abs(ux * offsetY - uy * offsetX) <= tolerance && ux * offsetX + uy * offsetY >= -tolerance
}

function lineCoordinates(line: LinePrimitive): number[] {
  return [line.a.x, line.a.y, line.b.x, line.b.y]
}

export function intersectLinesDetailed(first: LinePrimitive, second: LinePrimitive, policy: NumericPolicy = defaultNumericPolicy): IntersectionResult {
  if (!allFinite([...lineCoordinates(first), ...lineCoordinates(second)])) return { kind: "degenerate", reason: "line coordinates must be finite" }
  const firstDirection = { x: first.b.x - first.a.x, y: first.b.y - first.a.y }
  const secondDirection = { x: second.b.x - second.a.x, y: second.b.y - second.a.y }
  const firstLength = Math.hypot(firstDirection.x, firstDirection.y)
  const secondLength = Math.hypot(secondDirection.x, secondDirection.y)
  if (nearlyZero(firstLength, [firstDirection.x, firstDirection.y], policy) || nearlyZero(secondLength, [secondDirection.x, secondDirection.y], policy)) return { kind: "degenerate", reason: "line direction is degenerate" }
  const firstUnit = { x: firstDirection.x / firstLength, y: firstDirection.y / firstLength }
  const secondUnit = { x: secondDirection.x / secondLength, y: secondDirection.y / secondLength }
  const normalizedDenominator = firstUnit.x * secondUnit.y - firstUnit.y * secondUnit.x
  if (nearlyZero(normalizedDenominator, [firstUnit.x, firstUnit.y, secondUnit.x, secondUnit.y], policy)) {
    const collinear = orient2d(first.a.x, first.a.y, first.b.x, first.b.y, second.a.x, second.a.y) === 0 && orient2d(first.a.x, first.a.y, first.b.x, first.b.y, second.b.x, second.b.y) === 0
    return collinear ? { kind: "coincident" } : { kind: "none", reason: "parallel" }
  }
  const offset = { x: second.a.x - first.a.x, y: second.a.y - first.a.y }
  const parameter = (offset.x * secondUnit.y - offset.y * secondUnit.x) / normalizedDenominator / firstLength
  const point = { x: first.a.x + parameter * firstDirection.x, y: first.a.y + parameter * firstDirection.y }
  return allFinite([point.x, point.y]) ? { kind: "point", point } : { kind: "degenerate", reason: "line intersection is not finite" }
}

export function intersectLines(first: LinePrimitive, second: LinePrimitive): Coordinate | null {
  const result = intersectLinesDetailed(first, second)
  return result.kind === "point" ? result.point : null
}

export function intersectRayLineDetailed(ray: RayPrimitive, line: LinePrimitive, policy: NumericPolicy = defaultNumericPolicy): IntersectionResult {
  const result = intersectLinesDetailed({ id: `${ray.id}-support`, type: "line", a: ray.a, b: ray.b }, line, policy)
  if (result.kind === "point") return onRay(ray, result.point, policy) ? result : { kind: "none", reason: "intersection lies behind ray origin" }
  return result
}

export function intersectRayCircleDetailed(ray: RayPrimitive, circle: CirclePrimitive, policy: NumericPolicy = defaultNumericPolicy): IntersectionResult {
  const result = intersectLineCircleDetailed({ id: `${ray.id}-support`, type: "line", a: ray.a, b: ray.b }, circle, policy)
  if (result.kind === "point" || result.kind === "tangent") return onRay(ray, result.point, policy) ? result : { kind: "none", reason: "intersection lies behind ray origin" }
  if (result.kind !== "points") return result
  const points = result.points.filter((point) => onRay(ray, point, policy))
  if (points.length === 0) return { kind: "none", reason: "intersection lies behind ray origin" }
  if (points.length === 1) return { kind: "point", point: points[0] }
  return { kind: "points", points: [points[0], points[1]] }
}

export function intersectPolylineLineDetailed(polyline: PolylinePrimitive, line: LinePrimitive, policy: NumericPolicy = defaultNumericPolicy): IntersectionResult {
  const points: Coordinate[] = []
  let coincident = false
  for (let index = 1; index < polyline.points.length; index += 1) {
    const segment = { id: `${polyline.id}-segment-${index}`, type: "line" as const, a: polyline.points[index - 1], b: polyline.points[index] }
    const result = intersectLinesDetailed(segment, line, policy)
    if (result.kind === "point" && inUnitInterval(segmentParameter(segment, result.point), policy.absoluteTolerance)) points.push(result.point)
    if (result.kind === "coincident") coincident = true
  }
  const unique = uniquePoints(points, policy.absoluteTolerance)
  if (unique.length === 0) return coincident ? { kind: "coincident" } : { kind: "none", reason: "disjoint" }
  if (unique.length === 1) return { kind: "point", point: unique[0] }
  return { kind: "points", points: unique }
}

export function intersectPolylineCircleDetailed(polyline: PolylinePrimitive, circle: CirclePrimitive, policy: NumericPolicy = defaultNumericPolicy): IntersectionResult {
  const points: Coordinate[] = []
  for (let index = 1; index < polyline.points.length; index += 1) {
    const segment = { id: `${polyline.id}-segment-${index}`, type: "line" as const, a: polyline.points[index - 1], b: polyline.points[index] }
    const result = intersectLineCircleDetailed(segment, circle, policy)
    if (result.kind === "point" || result.kind === "tangent") {
      if (inUnitInterval(segmentParameter(segment, result.point), policy.absoluteTolerance)) points.push(result.point)
    } else if (result.kind === "points") {
      for (const point of result.points) if (inUnitInterval(segmentParameter(segment, point), policy.absoluteTolerance)) points.push(point)
    }
  }
  const unique = uniquePoints(points, policy.absoluteTolerance)
  if (unique.length === 0) return { kind: "none", reason: "disjoint" }
  if (unique.length === 1) return { kind: "point", point: unique[0] }
  return { kind: "points", points: unique }
}

export function intersectLineCircleDetailed(line: LinePrimitive, circle: CirclePrimitive, policy: NumericPolicy = defaultNumericPolicy): IntersectionResult {
  const values = [...lineCoordinates(line), circle.center.x, circle.center.y, circle.radius]
  if (!allFinite(values) || circle.radius <= 0) return { kind: "degenerate", reason: "line-circle geometry is invalid" }
  const direction = { x: line.b.x - line.a.x, y: line.b.y - line.a.y }
  const directionLength = Math.hypot(direction.x, direction.y)
  if (nearlyZero(directionLength, [direction.x, direction.y], policy)) return { kind: "degenerate", reason: "line direction is degenerate" }
  const unit = { x: direction.x / directionLength, y: direction.y / directionLength }
  const normal = { x: -unit.y, y: unit.x }
  const centerOffset = { x: circle.center.x - line.a.x, y: circle.center.y - line.a.y }
  const signedDistance = centerOffset.x * normal.x + centerOffset.y * normal.y
  if (!Number.isFinite(signedDistance)) return { kind: "degenerate", reason: "line-circle distance is not finite" }
  const normalizedDistance = Math.abs(signedDistance) / circle.radius
  const tolerance = scaledTolerance([normalizedDistance, 1], policy)
  if (normalizedDistance > 1 + tolerance) return { kind: "none", reason: "disjoint" }
  const closest = { x: circle.center.x - signedDistance * normal.x, y: circle.center.y - signedDistance * normal.y }
  if (!allFinite([closest.x, closest.y])) return { kind: "degenerate", reason: "line-circle projection is not finite" }
  if (Math.abs(normalizedDistance - 1) <= tolerance) return allFinite([closest.x, closest.y]) ? { kind: "tangent", point: closest } : { kind: "degenerate", reason: "line-circle intersection is not finite" }
  const halfChord = circle.radius * Math.sqrt(Math.max(0, 1 - normalizedDistance * normalizedDistance))
  const points: [Coordinate, Coordinate] = [
    { x: closest.x - halfChord * unit.x, y: closest.y - halfChord * unit.y },
    { x: closest.x + halfChord * unit.x, y: closest.y + halfChord * unit.y }
  ]
  return allFinite(points.flatMap((point) => [point.x, point.y])) ? { kind: "points", points } : { kind: "degenerate", reason: "line-circle intersections are not finite" }
}

export function intersectLineCircle(line: LinePrimitive, circle: CirclePrimitive): Coordinate[] {
  const result = intersectLineCircleDetailed(line, circle)
  if (result.kind === "point" || result.kind === "tangent") return [result.point]
  return result.kind === "points" ? result.points : []
}

export function intersectCirclesDetailed(first: CirclePrimitive, second: CirclePrimitive, policy: NumericPolicy = defaultNumericPolicy): IntersectionResult {
  const values = [first.center.x, first.center.y, first.radius, second.center.x, second.center.y, second.radius]
  if (!allFinite(values) || first.radius <= 0 || second.radius <= 0) return { kind: "degenerate", reason: "circle geometry is invalid" }
  const delta = { x: second.center.x - first.center.x, y: second.center.y - first.center.y }
  const distance = Math.hypot(delta.x, delta.y)
  const scale = Math.max(distance, first.radius, second.radius)
  const normalizedDistance = distance / scale
  const firstRadius = first.radius / scale
  const secondRadius = second.radius / scale
  const tolerance = scaledTolerance([normalizedDistance, firstRadius, secondRadius], policy)
  if (normalizedDistance <= tolerance) return Math.abs(firstRadius - secondRadius) <= tolerance ? { kind: "coincident" } : { kind: "none", reason: "disjoint" }
  if (normalizedDistance > firstRadius + secondRadius + tolerance || normalizedDistance < Math.abs(firstRadius - secondRadius) - tolerance) return { kind: "none", reason: "disjoint" }
  const normalizedAlong = (firstRadius * firstRadius - secondRadius * secondRadius + normalizedDistance * normalizedDistance) / (2 * normalizedDistance)
  const normalizedHeightSquared = firstRadius * firstRadius - normalizedAlong * normalizedAlong
  const along = normalizedAlong * scale
  const unit = { x: delta.x / distance, y: delta.y / distance }
  const midpoint = { x: first.center.x + along * unit.x, y: first.center.y + along * unit.y }
  if (Math.abs(normalizedHeightSquared) <= tolerance) return allFinite([midpoint.x, midpoint.y]) ? { kind: "tangent", point: midpoint } : { kind: "degenerate", reason: "circle intersection is not finite" }
  if (normalizedHeightSquared < 0) return { kind: "none", reason: "disjoint" }
  const height = Math.sqrt(normalizedHeightSquared) * scale
  const perpendicular = { x: -unit.y * height, y: unit.x * height }
  const points: [Coordinate, Coordinate] = [
    { x: midpoint.x + perpendicular.x, y: midpoint.y + perpendicular.y },
    { x: midpoint.x - perpendicular.x, y: midpoint.y - perpendicular.y }
  ]
  return allFinite(points.flatMap((point) => [point.x, point.y])) ? { kind: "points", points } : { kind: "degenerate", reason: "circle intersections are not finite" }
}

export function intersectCircles(first: CirclePrimitive, second: CirclePrimitive): Coordinate[] {
  const result = intersectCirclesDetailed(first, second)
  if (result.kind === "point" || result.kind === "tangent") return [result.point]
  return result.kind === "points" ? result.points : []
}
