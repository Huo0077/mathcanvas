import type { Coordinate, PrimitiveSpec } from "@draw/dsl"

import { sampleEllipse, sampleHyperbolaBranches, sampleParabola } from "./conics"
import { adaptiveSampleFunctionSegments } from "./calculus"
import { evaluateParameterExpression } from "./parameters"
import type { IntersectionResult } from "./types"

export type SampledPrimitive = Extract<PrimitiveSpec, { type: "line" | "segment" | "ray" | "polyline" | "circle" | "arc" | "parabola" | "ellipse" | "hyperbola" | "function" }>

function uniquePoints(points: Coordinate[], tolerance = 1e-4): Coordinate[] {
  const unique: Coordinate[] = []
  for (const point of points) {
    if (!unique.some((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) <= tolerance * Math.max(1, Math.abs(point.x), Math.abs(point.y)))) unique.push(point)
  }
  return unique
}

function segmentIntersection(first: [Coordinate, Coordinate], second: [Coordinate, Coordinate], tolerance = 1e-9): Coordinate | null {
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
  if (primitive.type === "circle") return [Array.from({ length: 257 }, (_, index) => { const angle = Math.PI * 2 * index / 256; return { x: primitive.center.x + primitive.radius * Math.cos(angle), y: primitive.center.y + primitive.radius * Math.sin(angle) } })]
  if (primitive.type === "arc") return [Array.from({ length: 129 }, (_, index) => { const angle = primitive.startAngle + (primitive.endAngle - primitive.startAngle) * index / 128; return { x: primitive.center.x + primitive.radius * Math.cos(angle), y: primitive.center.y + primitive.radius * Math.sin(angle) } })]
  if (primitive.type === "parabola") return [sampleParabola(primitive, [-12, 12], 256)]
  if (primitive.type === "ellipse") return [sampleEllipse(primitive, 256)]
  if (primitive.type === "hyperbola") {
    return sampleHyperbolaBranches(primitive, [-12, 12], 256)
  }
  return adaptiveSampleFunctionSegments((x) => evaluateParameterExpression(primitive.expression, { x }), primitive.domain, { initialSteps: primitive.samples ?? 256, maxSteps: Math.max(primitive.samples ?? 256, 2048) })
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
  const unique = uniquePoints(points)
  if (unique.length === 0) return { kind: "none", reason: "curves are disjoint" }
  if (unique.length === 1) return { kind: "point", point: unique[0] }
  return { kind: "points", points: unique.slice(0, MAX_CURVE_INTERSECTIONS) }
}
