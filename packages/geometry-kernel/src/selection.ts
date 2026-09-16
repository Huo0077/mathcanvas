import type { Coordinate, PrimitiveSpec } from "@draw/dsl"

import { segmentIntersection } from "./curve-intersections"
import type { PlanarSnapPrimitive } from "./snap-geometry"

/**
 * 框选语义：AutoCAD 的两个方向约定。
 *
 * - `window`：**从左往右**拖框，只选完全落在框内的对象。
 * - `crossing`：**从右往左**拖框，只要对象与框相交（或落在框内）就选。
 *
 * 几何判定放在内核里，UI 只负责画框和决定方向，避免两个画布各写一套。
 */
export interface SelectionBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export type BoxSelectionMode = "window" | "crossing"

const EPSILON = 1e-9
/** 圆弧没有解析的框相交判定，按渲染同样的密度采样成折线（与画布画出来的形状一致）。 */
const ARC_SAMPLES = 24

export function pointInSelectionBox(point: Coordinate, box: SelectionBox): boolean {
  return point.x >= box.minX - EPSILON && point.x <= box.maxX + EPSILON && point.y >= box.minY - EPSILON && point.y <= box.maxY + EPSILON
}

function boxCorners(box: SelectionBox): [Coordinate, Coordinate][] {
  const { minX, minY, maxX, maxY } = box
  return [[{ x: minX, y: minY }, { x: maxX, y: minY }], [{ x: maxX, y: minY }, { x: maxX, y: maxY }], [{ x: maxX, y: maxY }, { x: minX, y: maxY }], [{ x: minX, y: maxY }, { x: minX, y: minY }]]
}

function segmentsOf(primitive: PlanarSnapPrimitive): [Coordinate, Coordinate][] {
  if (primitive.type === "segment") return [[primitive.a, primitive.b]]
  if (primitive.type === "polyline") {
    const segments: [Coordinate, Coordinate][] = []
    for (let index = 1; index < primitive.points.length; index += 1) segments.push([primitive.points[index - 1], primitive.points[index]])
    return segments
  }
  if (primitive.type === "arc") {
    const segments: [Coordinate, Coordinate][] = []
    for (let index = 0; index < ARC_SAMPLES; index += 1) {
      const first = primitive.startAngle + (primitive.endAngle - primitive.startAngle) * (index / ARC_SAMPLES)
      const second = primitive.startAngle + (primitive.endAngle - primitive.startAngle) * ((index + 1) / ARC_SAMPLES)
      segments.push([
        { x: primitive.center.x + primitive.radius * Math.cos(first), y: primitive.center.y + primitive.radius * Math.sin(first) },
        { x: primitive.center.x + primitive.radius * Math.cos(second), y: primitive.center.y + primitive.radius * Math.sin(second) }
      ])
    }
    return segments
  }
  return []
}

function segmentTouchesBox(segment: [Coordinate, Coordinate], box: SelectionBox): boolean {
  if (pointInSelectionBox(segment[0], box) || pointInSelectionBox(segment[1], box)) return true
  return boxCorners(box).some((edge) => segmentIntersection(segment, edge) !== null)
}

/** 圆心到框的最近距离（圆心在框内为 0）。 */
function distanceToBox(center: Coordinate, box: SelectionBox): number {
  const dx = Math.max(box.minX - center.x, 0, center.x - box.maxX)
  const dy = Math.max(box.minY - center.y, 0, center.y - box.maxY)
  return Math.hypot(dx, dy)
}

/** 圆心到框内最远角落的距离：圆周只有落在 [最近, 最远] 之间才可能穿过框。 */
function farthestDistanceToBox(center: Coordinate, box: SelectionBox): number {
  return Math.max(
    Math.hypot(center.x - box.minX, center.y - box.minY),
    Math.hypot(center.x - box.maxX, center.y - box.minY),
    Math.hypot(center.x - box.minX, center.y - box.maxY),
    Math.hypot(center.x - box.maxX, center.y - box.maxY)
  )
}

/** 完全落在框内（`window` 方向）。无限直线与射线按定义它们的两个端点判定。 */
export function primitiveInSelectionBox(primitive: PrimitiveSpec, box: SelectionBox): boolean {
  if (primitive.type === "point") return pointInSelectionBox({ x: primitive.x, y: primitive.y }, box)
  if (primitive.type === "line" || primitive.type === "segment" || primitive.type === "ray") return pointInSelectionBox(primitive.a, box) && pointInSelectionBox(primitive.b, box)
  if (primitive.type === "polyline") return primitive.points.every((point) => pointInSelectionBox(point, box))
  if (primitive.type === "circle") {
    return primitive.center.x - primitive.radius >= box.minX - EPSILON
      && primitive.center.x + primitive.radius <= box.maxX + EPSILON
      && primitive.center.y - primitive.radius >= box.minY - EPSILON
      && primitive.center.y + primitive.radius <= box.maxY + EPSILON
  }
  if (primitive.type === "arc") return segmentsOf(primitive).every((segment) => pointInSelectionBox(segment[0], box))
  return false
}

/** 与框相交或落在框内（`crossing` 方向）。 */
export function primitiveCrossesSelectionBox(primitive: PrimitiveSpec, box: SelectionBox): boolean {
  if (primitiveInSelectionBox(primitive, box)) return true
  if (primitive.type === "point") return false
  if (primitive.type === "circle") {
    const near = distanceToBox(primitive.center, box)
    const far = farthestDistanceToBox(primitive.center, box)
    // 圆周穿过框：半径落在最近距离与最远距离之间。大圆把框整个套住时圆周并不经过框，不算相交。
    return primitive.radius >= near - EPSILON && primitive.radius <= far + EPSILON
  }
  if (primitive.type === "line" || primitive.type === "ray") {
    // 无界图元不能整体落在框内，只要它穿过框就算相交；用一个足够长的线段近似它。
    const direction = { x: primitive.b.x - primitive.a.x, y: primitive.b.y - primitive.a.y }
    const length = Math.hypot(direction.x, direction.y)
    if (length === 0) return false
    const reach = Math.hypot(box.maxX - box.minX, box.maxY - box.minY) * 4
    const unit = { x: direction.x / length, y: direction.y / length }
    const start = primitive.type === "line" ? { x: primitive.a.x - unit.x * reach, y: primitive.a.y - unit.y * reach } : primitive.a
    return segmentTouchesBox([start, { x: primitive.b.x + unit.x * reach, y: primitive.b.y + unit.y * reach }], box)
  }
  if (primitive.type === "segment" || primitive.type === "polyline" || primitive.type === "arc") return segmentsOf(primitive).some((segment) => segmentTouchesBox(segment, box))
  return false
}

/** 按方向语义选出图元 id；不支持的类型直接跳过（不猜）。 */
export function selectPrimitivesInBox(primitives: PrimitiveSpec[], box: SelectionBox, mode: BoxSelectionMode): string[] {
  return primitives
    .filter((primitive) => mode === "window" ? primitiveInSelectionBox(primitive, box) : primitiveCrossesSelectionBox(primitive, box))
    .map((primitive) => primitive.id)
}
