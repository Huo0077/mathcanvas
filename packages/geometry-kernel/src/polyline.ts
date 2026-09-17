import type { Coordinate, PolylinePrimitive, RayPrimitive } from "@draw/dsl"

import { scaledTolerance } from "./numeric"

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

/**
 * 点是否落在射线的**前向半线**上。
 *
 * 叉积残差是**长度**量纲，判据必须随坐标尺度缩放：在 ~1e9 的坐标上，一个确实落在射线上的点
 * 算出来的残差就有 ~1e-7，绝对容差会把它判成"不在射线上"（与 `intersections.onRay` 同一类缺陷）。
 * `tolerance` 仍然是调用方给出的**绝对**下限，相对项由 `numeric.ts` 的策略提供。
 */
export function pointOnRay(ray: RayPrimitive, point: Coordinate, tolerance = 1e-9): boolean {
  const vector = direction(ray)
  if (![ray.a.x, ray.a.y, ray.b.x, ray.b.y, point.x, point.y].every(Number.isFinite) || (vector.x === 0 && vector.y === 0)) return false
  const length = Math.hypot(vector.x, vector.y)
  const unit = { x: vector.x / length, y: vector.y / length }
  const offset = { x: point.x - ray.a.x, y: point.y - ray.a.y }
  const crossDistance = unit.x * offset.y - unit.y * offset.x
  const scale = scaledTolerance([ray.a.x, ray.a.y, ray.b.x, ray.b.y, point.x, point.y], { absoluteTolerance: tolerance, relativeTolerance: 1e-11 })
  if (Math.abs(crossDistance) > scale) return false
  return unit.x * offset.x + unit.y * offset.y >= -scale
}

export function polylineLength(polyline: PolylinePrimitive): number {
  let length = 0
  for (let index = 1; index < polyline.points.length; index += 1) {
    length += Math.hypot(polyline.points[index].x - polyline.points[index - 1].x, polyline.points[index].y - polyline.points[index - 1].y)
  }
  return length
}

/**
 * 点到折线的最近距离。
 *
 * 只有一个点的折线是"退化成点"的折线：距离就是到那个点的距离。旧实现返回 `+Infinity`，
 * 调用方只会把它当成"无穷远"（比"没有定义"更容易误导）。一个点都没有时才无从定义。
 */
export function distanceToPolyline(polyline: PolylinePrimitive, point: Coordinate): number {
  if (polyline.points.length === 0) return Number.POSITIVE_INFINITY
  if (polyline.points.length === 1) return Math.hypot(point.x - polyline.points[0].x, point.y - polyline.points[0].y)
  let distance = Number.POSITIVE_INFINITY
  for (let index = 1; index < polyline.points.length; index += 1) {
    distance = Math.min(distance, distanceToSegment(polyline.points[index - 1], polyline.points[index], point))
  }
  return distance
}
