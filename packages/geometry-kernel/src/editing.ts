import type { Coordinate } from "@draw/dsl"

import { intersectLinesDetailed } from "./intersections"
import { planarIntersections, type PlanarSnapPrimitive } from "./snap-geometry"

/**
 * 修改类几何原语：偏移、修剪、延伸。
 *
 * 三个函数都只返回**几何结果**（不返回 scene-graph 的 patch），由 web 层负责组装成文档补丁——
 * 内核不依赖 scene-graph，边界保持干净。
 *
 * 约定：
 * - 偏移的正方向是"沿行进方向的左侧"（方向向量逆时针转 90°），负值即右侧；圆/圆弧改变半径。
 * - 修剪保留**靠近 `near` 点**的那一半；延伸只接受落在当前跨度**之外**的交点。
 * - 圆弧/圆的修剪（拆成多段圆弧）不在本片范围，返回 null 而不是猜。
 */
export type GeometryEdit =
  | { kind: "line-like"; a: Coordinate; b: Coordinate }
  | { kind: "polyline"; points: Coordinate[] }
  | { kind: "radius"; radius: number }

function lineLike(primitive: PlanarSnapPrimitive): { a: Coordinate; b: Coordinate } | null {
  if (primitive.type === "line" || primitive.type === "segment" || primitive.type === "ray") return { a: primitive.a, b: primitive.b }
  return null
}

/** 方向单位向量与其左侧法线。 */
function frame(a: Coordinate, b: Coordinate): { unit: Coordinate; normal: Coordinate; length: number } | null {
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  if (length < 1e-9) return null
  const unit = { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
  return { unit, normal: { x: -unit.y, y: unit.x }, length }
}

function shift(point: Coordinate, normal: Coordinate, distance: number): Coordinate {
  return { x: point.x + normal.x * distance, y: point.y + normal.y * distance }
}

export function offsetPrimitive(primitive: PlanarSnapPrimitive, distance: number): GeometryEdit | null {
  if (!Number.isFinite(distance)) return null
  const straight = lineLike(primitive)
  if (straight) {
    const geometry = frame(straight.a, straight.b)
    if (!geometry) return null
    return { kind: "line-like", a: shift(straight.a, geometry.normal, distance), b: shift(straight.b, geometry.normal, distance) }
  }
  if (primitive.type === "circle" || primitive.type === "arc") {
    const radius = primitive.radius + distance
    return radius > 0 ? { kind: "radius", radius } : null
  }
  if (primitive.type === "polyline") {
    const points = primitive.points
    if (points.length < 2) return null
    const shifted: Coordinate[] = [shift(points[0], frame(points[0], points[1])!.normal, distance)]
    for (let index = 1; index < points.length - 1; index += 1) {
      const previous = frame(points[index - 1], points[index])!
      const next = frame(points[index], points[index + 1])!
      // 两条相邻偏移线的交点就是斜接点；平行（折返）时退回直接平移顶点。
      const miter = intersectLinesDetailed(
        { id: "prev", type: "line", a: shift(points[index - 1], previous.normal, distance), b: shift(points[index], previous.normal, distance) },
        { id: "next", type: "line", a: shift(points[index], next.normal, distance), b: shift(points[index + 1], next.normal, distance) }
      )
      shifted.push(miter.kind === "point" ? miter.point : shift(points[index], previous.normal, distance))
    }
    const lastFrame = frame(points[points.length - 2], points[points.length - 1])
    if (!lastFrame) return null
    shifted.push(shift(points[points.length - 1], lastFrame.normal, distance))
    return { kind: "polyline", points: shifted }
  }
  return null
}

/** 目标在自身 a→b 跨度上的参数（线段 0–1、射线 ≥0、直线不限）。 */
function inSpan(primitive: PlanarSnapPrimitive, parameter: number): boolean {
  if (primitive.type === "segment") return parameter >= 0 && parameter <= 1
  if (primitive.type === "ray") return parameter >= 0
  return true
}

function parameterOn(a: Coordinate, b: Coordinate, point: Coordinate): number {
  const deltaX = b.x - a.x
  const deltaY = b.y - a.y
  const lengthSquared = deltaX * deltaX + deltaY * deltaY
  if (lengthSquared < 1e-18) return 0
  return ((point.x - a.x) * deltaX + (point.y - a.y) * deltaY) / lengthSquared
}

/** 目标支撑直线与边界的交点，带各自参数（边界按自身范围过滤，目标不过滤——延伸要靠这个）。 */
function supportHits(target: PlanarSnapPrimitive, boundary: PlanarSnapPrimitive, span: { a: Coordinate; b: Coordinate }): { point: Coordinate; parameter: number }[] {
  const support = { id: `${target.id}-support`, type: "line" as const, a: span.a, b: span.b }
  return planarIntersections(support, boundary)
    .map((point) => ({ point, parameter: parameterOn(span.a, span.b, point) }))
    .filter((hit) => Number.isFinite(hit.parameter))
}

export function trimPrimitive(target: PlanarSnapPrimitive, boundary: PlanarSnapPrimitive, near: Coordinate): GeometryEdit | null {
  const span = lineLike(target)
  if (!span) return null
  const nearParameter = parameterOn(span.a, span.b, near)
  const hits = supportHits(target, boundary, span).filter((hit) => inSpan(target, hit.parameter))
  if (hits.length === 0) return null
  const cut = hits.reduce((closest, hit) => Math.abs(hit.parameter - nearParameter) < Math.abs(closest.parameter - nearParameter) ? hit : closest)
  // near 在交点之前 → 保留 a 那一段；否则保留 b 那一段。
  return nearParameter <= cut.parameter
    ? { kind: "line-like", a: span.a, b: cut.point }
    : { kind: "line-like", a: cut.point, b: span.b }
}

export function extendPrimitive(target: PlanarSnapPrimitive, boundary: PlanarSnapPrimitive, near: Coordinate): GeometryEdit | null {
  const span = lineLike(target)
  if (!span) return null
  const nearParameter = parameterOn(span.a, span.b, near)
  const extendStart = nearParameter < 0.5
  const candidates = supportHits(target, boundary, span)
    .filter((hit) => extendStart ? hit.parameter < 0 : hit.parameter > 1)
  if (candidates.length === 0) return null
  const hit = extendStart
    ? candidates.reduce((closest, candidate) => candidate.parameter > closest.parameter ? candidate : closest)
    : candidates.reduce((closest, candidate) => candidate.parameter < closest.parameter ? candidate : closest)
  return extendStart ? { kind: "line-like", a: hit.point, b: span.b } : { kind: "line-like", a: span.a, b: hit.point }
}
