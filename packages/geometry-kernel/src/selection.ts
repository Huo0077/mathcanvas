import type { ArcPrimitive, Coordinate, PrimitiveSpec } from "@draw/dsl"

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
/** 圆弧的采样弦数：只服务于 `crossing`（相交）与旧渲染密度一致；`window`（完全在框内）已改解析判定。 */
const ARC_SAMPLES = 24

export function pointInSelectionBox(point: Coordinate, box: SelectionBox): boolean {
  return point.x >= box.minX - EPSILON && point.x <= box.maxX + EPSILON && point.y >= box.minY - EPSILON && point.y <= box.maxY + EPSILON
}

function boxCorners(box: SelectionBox): [Coordinate, Coordinate][] {
  const { minX, minY, maxX, maxY } = box
  return [[{ x: minX, y: minY }, { x: maxX, y: minY }], [{ x: maxX, y: minY }, { x: maxX, y: maxY }], [{ x: maxX, y: maxY }, { x: minX, y: maxY }], [{ x: minX, y: maxY }, { x: minX, y: minY }]]
}

/** 有限坐标（框选的解析判定不接受 NaN / Infinity：那种输入没有诚实的答案，只能保守地判否）。 */
function isFiniteCoordinate(point: Coordinate): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}

/**
 * 角度落在圆弧扫过的范围内。
 *
 * 与 `snap-geometry.ts` 的 `angleWithinArc` 同义（那边没导出，而这一片只允许改 selection.ts，
 * 所以这里保留一份局部实现）。扫过角度按**有向**理解：`endAngle < startAngle` 是负向弧，
 * 归一化到 (-π, π] 后必须 ≤ 0；`|sweep| ≥ 2π` 视为整圆。空区间（sweep = 0）不算任何角度，
 * 于是圆弧上什么都没有——`window` 因此只可能判否（保守），不会凭空造出一条曲线。
 */
function angleWithinArcRange(arc: ArcPrimitive, angle: number): boolean {
  const sweep = arc.endAngle - arc.startAngle
  if (!Number.isFinite(sweep)) return false
  if (Math.abs(sweep) >= Math.PI * 2 - EPSILON) return true
  const normalize = (value: number) => ((value % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
  return sweep >= 0
    ? normalize(angle - arc.startAngle) <= sweep + EPSILON
    : normalize(arc.startAngle - angle) <= -sweep + EPSILON
}

/**
 * 圆弧上"碰得到 x / y 极值"的候选点：两个端点 + 落在弧内的四个轴向切点（0, π/2, π, 3π/2）。
 *
 * 轴上投影的极值只可能出现在这两类位置：内部极值点（切线垂直于该轴，即上面四个角度）
 * 或区间端点。弦采样是**内接**折线，永远躲在真实弧里面——半径 1 时弧顶能鼓出
 * r·(1 − cos(π/24)) ≈ 0.00856，足以让"所有采样点都在框内"放过一个真的出框的弧。
 */
function arcExtremePoints(arc: ArcPrimitive): Coordinate[] {
  const pointAt = (angle: number): Coordinate => ({ x: arc.center.x + arc.radius * Math.cos(angle), y: arc.center.y + arc.radius * Math.sin(angle) })
  const points: Coordinate[] = [pointAt(arc.startAngle), pointAt(arc.endAngle)]
  for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
    if (angleWithinArcRange(arc, angle)) points.push(pointAt(angle))
  }
  return points
}

/**
 * 圆弧的采样点（与画布同样的密度）。
 *
 * **只服务于 `crossing`（相交）语义**：`window` 的"完全在框内"已改解析判定（见 `arcExtremePoints`）。
 * 相交是"碰到就算"的谓词，而弦是**内接**折线：它可能漏掉真实曲线比弦更早碰到框的那一小段
 * （弧顶鼓出，最多 r·(1 − cos(π/24))），却不会无中生有地报出真实曲线之外的接触。
 * 也就是说它在"漏选"一侧不保守。保留它是因为圆弧∩框的解析判定要再解一次"弧 ∩ 四条框边"，
 * 超出本切片范围；这里如实标注它是采样判定，而不是假装它是解析的。
 *
 * **必须包含终点**（索引 0..ARC_SAMPLES）：若只看每条弦的起点，弧的末端就从不参与判定。
 */
function arcSamplePoints(arc: Extract<PlanarSnapPrimitive, { type: "arc" }>): Coordinate[] {
  return Array.from({ length: ARC_SAMPLES + 1 }, (_, index) => {
    const angle = arc.startAngle + (arc.endAngle - arc.startAngle) * (index / ARC_SAMPLES)
    return { x: arc.center.x + arc.radius * Math.cos(angle), y: arc.center.y + arc.radius * Math.sin(angle) }
  })
}

function segmentsOf(primitive: PlanarSnapPrimitive): [Coordinate, Coordinate][] {
  if (primitive.type === "segment") return [[primitive.a, primitive.b]]
  if (primitive.type === "polyline") {
    const segments: [Coordinate, Coordinate][] = []
    for (let index = 1; index < primitive.points.length; index += 1) segments.push([primitive.points[index - 1], primitive.points[index]])
    return segments
  }
  if (primitive.type === "arc") {
    const points = arcSamplePoints(primitive)
    return points.slice(1).map((point, index) => [points[index], point] as [Coordinate, Coordinate])
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
    // 圆的极值就是 center ± r（轴向切点各两个）；退化输入按"框不住"处理（保守）。
    const finite = isFiniteCoordinate(primitive.center) && Number.isFinite(primitive.radius)
    return finite
      && primitive.center.x - primitive.radius >= box.minX - EPSILON
      && primitive.center.x + primitive.radius <= box.maxX + EPSILON
      && primitive.center.y - primitive.radius >= box.minY - EPSILON
      && primitive.center.y + primitive.radius <= box.maxY + EPSILON
  }
  if (primitive.type === "arc") {
    // 解析判定：只看弧上的极值候选点，绝不再按采样弦判"完全在框内"。
    const finite = isFiniteCoordinate(primitive.center) && Number.isFinite(primitive.radius) && Number.isFinite(primitive.startAngle) && Number.isFinite(primitive.endAngle)
    // 空区间（start = end）没有点集，谈不上"完全在框内"：显式判否，而不是靠候选点碰巧落在框外来决定。
    if (!finite || primitive.endAngle === primitive.startAngle) return false
    return arcExtremePoints(primitive).every((point) => pointInSelectionBox(point, box))
  }
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
  if (primitive.type === "segment" || primitive.type === "polyline" || primitive.type === "arc") {
    // 圆弧在这里仍是**采样弦**判定（见 `arcSamplePoints` 的说明）：本切片只把 `window` 的
    // "完全在框内"改为解析判定。非有限坐标直接判否（保守），别让 NaN 在弦里兜圈子。
    if (primitive.type === "arc" && !(isFiniteCoordinate(primitive.center) && Number.isFinite(primitive.radius))) return false
    return segmentsOf(primitive).some((segment) => segmentTouchesBox(segment, box))
  }
  return false
}

/** 按方向语义选出图元 id；不支持的类型直接跳过（不猜）。 */
export function selectPrimitivesInBox(primitives: PrimitiveSpec[], box: SelectionBox, mode: BoxSelectionMode): string[] {
  return primitives
    .filter((primitive) => mode === "window" ? primitiveInSelectionBox(primitive, box) : primitiveCrossesSelectionBox(primitive, box))
    .map((primitive) => primitive.id)
}
