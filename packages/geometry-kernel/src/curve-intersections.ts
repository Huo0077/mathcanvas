import type { Coordinate, PrimitiveSpec, SampledPrimitiveType } from "@draw/dsl"

import { sampleEllipse, sampleHyperbolaBranches, sampleParabola } from "./conics"
import { adaptiveSampleFunctionSegments } from "./calculus"
import { evaluateParameterExpression } from "./parameters"
import type { IntersectionResult } from "./types"

export type SampledPrimitive = Extract<PrimitiveSpec, { type: SampledPrimitiveType }>

/**
 * 采样点云的尺度：并集包围盒对角线（图形有多大）与坐标量级（double 在该量级下的分辨率）。
 */
function cloudScale(clouds: readonly Coordinate[][]): { extent: number; magnitude: number } {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let magnitude = 0
  for (const cloud of clouds) {
    for (const point of cloud) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
      minX = Math.min(minX, point.x)
      maxX = Math.max(maxX, point.x)
      minY = Math.min(minY, point.y)
      maxY = Math.max(maxY, point.y)
      magnitude = Math.max(magnitude, Math.abs(point.x), Math.abs(point.y))
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return { extent: 0, magnitude: 0 }
  return { extent: Math.hypot(maxX - minX, maxY - minY), magnitude }
}

/**
 * 去重容差：**只跟图形自身有多大有关，与图形画在平面的哪里无关**。
 *
 * 旧实现是 `1e-4 * max(1, |x|, |y|)`，两个毛病都在实测里量到过：
 *  1. 容差随"离原点多远"膨胀——半径 1 的圆放在原点附近容差 1e-4，平移到 x≈1000 之后变成 0.1，
 *     于是用 y = √(1 − 0.025²) ≈ 0.999687 的割线去切时，两个相距 **0.0497** 的真实交点被并成一个。
 *     用户把图形画到 20 以外就开始撞上这条比例。
 *  2. 1e-4 这个**相对**容差本身太松：图形尺寸 2800（半径 1000 的圆）时绝对容差 0.1，
 *     相距 0.05 的两个交点同样被并掉。
 *
 * 而"同一交点的重复候选"实测是**完全相等**的（交点落在采样顶点上时，相邻两条弦给出同一个 double，
 * 间距 0.000e+0），所以容差只需要机器精度量级：图形尺寸 × 1e-9，
 * 且不小于该坐标量级下 double 能分辨的最小间隔（EPSILON × |坐标| × 64）。
 */
export function intersectionDedupeTolerance(clouds: readonly Coordinate[][]): number {
  const { extent, magnitude } = cloudScale(clouds)
  return Math.max(extent * 1e-9, Math.max(1, magnitude) * Number.EPSILON * 64)
}

function uniquePoints(points: readonly Coordinate[], tolerance: number): Coordinate[] {
  const unique: Coordinate[] = []
  for (const point of points) {
    if (!unique.some((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) <= tolerance)) unique.push(point)
  }
  return unique
}

/** 线段相交（含端点）；采样求交与框选判定共用同一份实现。 */
export function segmentIntersection(first: [Coordinate, Coordinate], second: [Coordinate, Coordinate], tolerance = 1e-9): Coordinate | null {
  const firstDirection = { x: first[1].x - first[0].x, y: first[1].y - first[0].y }
  const secondDirection = { x: second[1].x - second[0].x, y: second[1].y - second[0].y }
  const denominator = firstDirection.x * secondDirection.y - firstDirection.y * secondDirection.x
  if (Math.abs(denominator) <= tolerance) return null
  const offset = { x: second[0].x - first[0].x, y: second[0].y - first[0].y }
  const firstParameter = (offset.x * secondDirection.y - offset.y * secondDirection.x) / denominator
  const secondParameter = (offset.x * firstDirection.y - offset.y * firstDirection.x) / denominator
  if (firstParameter < -tolerance || firstParameter > 1 + tolerance || secondParameter < -tolerance || secondParameter > 1 + tolerance) return null
  return { x: first[0].x + firstParameter * firstDirection.x, y: first[0].y + firstParameter * firstDirection.y }
}

function samplePrimitive(primitive: SampledPrimitive): Coordinate[][] {
  if (primitive.type === "line") {
    const direction = { x: primitive.b.x - primitive.a.x, y: primitive.b.y - primitive.a.y }
    const length = Math.hypot(direction.x, direction.y)
    if (!Number.isFinite(length) || length === 0) return []
    const unit = { x: direction.x / length, y: direction.y / length }
    return [[{ x: primitive.a.x - unit.x * 100, y: primitive.a.y - unit.y * 100 }, { x: primitive.a.x + unit.x * 100, y: primitive.a.y + unit.y * 100 }]]
  }
  if (primitive.type === "segment") return [[primitive.a, primitive.b]]
  if (primitive.type === "ray") {
    const direction = { x: primitive.b.x - primitive.a.x, y: primitive.b.y - primitive.a.y }
    const length = Math.hypot(direction.x, direction.y)
    if (!Number.isFinite(length) || length === 0) return []
    const unit = { x: direction.x / length, y: direction.y / length }
    return [[primitive.a, { x: primitive.a.x + unit.x * 100, y: primitive.a.y + unit.y * 100 }]]
  }
  if (primitive.type === "polyline") return [primitive.points]
  /**
   * 由其它图元引申出来的直线类（切线 / 法线 / 割线）：它们**画出来就是 `a→b` 这一段**，
   * 所以采样也只取这一段 —— 交点必须落在用户看得见的那截线上。
   *
   * 状态不是 `approximate` 的一律不采样：`a/b` 是上一次成功重算留下的残值，
   * 拿它求交会凭空造出交点（一个"算不出来的切线"在最上面那条用例里正是这样）。
   */
  if (primitive.type === "tangent" || primitive.type === "normal" || primitive.type === "secant") {
    if (primitive.status !== "approximate") return []
    const length = Math.hypot(primitive.b.x - primitive.a.x, primitive.b.y - primitive.a.y)
    return Number.isFinite(length) && length > 1e-12 ? [[primitive.a, primitive.b]] : []
  }
  /** 导函数与积分区域自带采样点；积分只用区域的**上边界**（填充是装饰，不参与求交）。 */
  if (primitive.type === "derivative" || primitive.type === "integral") {
    if (primitive.status !== "approximate") return []
    return primitive.points.length >= 2 ? [primitive.points] : []
  }
  if (primitive.type === "circle") return [Array.from({ length: 257 }, (_, index) => { const angle = Math.PI * 2 * index / 256; return { x: primitive.center.x + primitive.radius * Math.cos(angle), y: primitive.center.y + primitive.radius * Math.sin(angle) } })]
  if (primitive.type === "arc") return [Array.from({ length: 129 }, (_, index) => { const angle = primitive.startAngle + (primitive.endAngle - primitive.startAngle) * index / 128; return { x: primitive.center.x + primitive.radius * Math.cos(angle), y: primitive.center.y + primitive.radius * Math.sin(angle) } })]
  if (primitive.type === "parabola") return [sampleParabola(primitive, [-12, 12], 256)]
  if (primitive.type === "ellipse") return [sampleEllipse(primitive, 256)]
  if (primitive.type === "hyperbola") {
    return sampleHyperbolaBranches(primitive, [-12, 12], 256)
  }
  if (primitive.type === "function") return adaptiveSampleFunctionSegments((x) => evaluateParameterExpression(primitive.expression, { x }), primitive.domain, { initialSteps: primitive.samples ?? 256, maxSteps: Math.max(primitive.samples ?? 256, 2048) })
  /**
   * 穷尽性检查：往 `SAMPLED_PRIMITIVE_TYPES` 里加了类型却忘了在这里写采样，**编译就会失败**。
   * 以前这条名单有五份副本，漏一处只会在运行期表现为"这个图元没有交点"——切线就是这么被漏掉的。
   */
  const exhaustive: never = primitive
  return exhaustive
}

/** Two sampled curves can cross more than twice; clipping the list to the first pair silently hid real
 * intersections (a line met sin(x) six times and only two markers survived). Pathological pairs such as
 * sin(1/x) against the x axis would report hundreds, so the list is bounded for the canvas and the property bar. */
export const MAX_CURVE_INTERSECTIONS = 64

export function intersectSampledPrimitives(first: SampledPrimitive, second: SampledPrimitive): IntersectionResult {
  let firstPoints: Coordinate[][]
  let secondPoints: Coordinate[][]
  try {
    firstPoints = samplePrimitive(first)
    secondPoints = samplePrimitive(second)
  } catch (error) {
    return { kind: "degenerate", reason: error instanceof Error ? error.message : "curve sampling failed" }
  }
  if (!firstPoints.some((segment) => segment.length >= 2) || !secondPoints.some((segment) => segment.length >= 2)) return { kind: "degenerate", reason: "curve sampling needs at least two points" }
  const points: Coordinate[] = []
  for (const firstSegment of firstPoints) {
    for (const secondSegment of secondPoints) {
      for (let firstIndex = 1; firstIndex < firstSegment.length; firstIndex += 1) {
        for (let secondIndex = 1; secondIndex < secondSegment.length; secondIndex += 1) {
          const point = segmentIntersection([firstSegment[firstIndex - 1], firstSegment[firstIndex]], [secondSegment[secondIndex - 1], secondSegment[secondIndex]])
          if (point) points.push(point)
        }
      }
    }
  }
  const unique = uniquePoints(points, intersectionDedupeTolerance([...firstPoints, ...secondPoints]))
  if (unique.length === 0) return { kind: "none", reason: "curves are disjoint" }
  if (unique.length === 1) return { kind: "point", point: unique[0] }
  return { kind: "points", points: unique.slice(0, MAX_CURVE_INTERSECTIONS) }
}
