import type { Coordinate, PolylinePrimitive, RayPrimitive } from "@draw/dsl"

function direction(ray: RayPrimitive): Coordinate {
  return { x: ray.b.x - ray.a.x, y: ray.b.y - ray.a.y }
}

function distanceToSegment(first: Coordinate, second: Coordinate, point: Coordinate): number {
  const dx = second.x - first.x
  const dy = second.y - first.y
  const length = Math.hypot(dx, dy)
  if (length === 0) return Math.hypot(point.x - first.x, point.y - first.y)
  const unitX = dx / length
  const unitY = dy / length
  const parameter = Math.max(0, Math.min(length, (point.x - first.x) * unitX + (point.y - first.y) * unitY))
  return Math.hypot(point.x - (first.x + parameter * unitX), point.y - (first.y + parameter * unitY))
}

export function pointOnRay(ray: RayPrimitive, point: Coordinate, tolerance = 1e-9): boolean {
  const vector = direction(ray)
  if (![ray.a.x, ray.a.y, ray.b.x, ray.b.y, point.x, point.y].every(Number.isFinite) || (vector.x === 0 && vector.y === 0)) return false
  const length = Math.hypot(vector.x, vector.y)
  const unit = { x: vector.x / length, y: vector.y / length }
  const offset = { x: point.x - ray.a.x, y: point.y - ray.a.y }
  const crossDistance = unit.x * offset.y - unit.y * offset.x
  if (Math.abs(crossDistance) > tolerance) return false
  return unit.x * offset.x + unit.y * offset.y >= -tolerance
}

export function polylineLength(polyline: PolylinePrimitive): number {
  let length = 0
  for (let index = 1; index < polyline.points.length; index += 1) {
    length += Math.hypot(polyline.points[index].x - polyline.points[index - 1].x, polyline.points[index].y - polyline.points[index - 1].y)
  }
  return length
}

export function distanceToPolyline(polyline: PolylinePrimitive, point: Coordinate): number {
  if (polyline.points.length === 0) return Number.POSITIVE_INFINITY
  let distance = Number.POSITIVE_INFINITY
  for (let index = 1; index < polyline.points.length; index += 1) {
    distance = Math.min(distance, distanceToSegment(polyline.points[index - 1], polyline.points[index], point))
  }
  return distance
}
