import type { ArcPrimitive, CirclePrimitive, Coordinate, LinePrimitive, PrimitiveSpec, RayPrimitive, SegmentPrimitive } from "@draw/dsl"

import { intersectCirclesDetailed, intersectLineCircleDetailed, intersectLinesDetailed } from "./intersections"

/**
 * 对象捕捉需要的几何原语：最近点、垂足、象限点和两两交点。
 *
 * 放在内核而不是 UI 里，是因为这些都是纯几何；`drafting.ts` 只负责把结果编排成候选与优先级。
 * 所有函数都按图元自身范围过滤（线段/射线/折线/圆弧），这样"看起来在图元上"和"真的在图元上"一致。
 */
export type PlanarSnapPrimitive = Extract<PrimitiveSpec, { type: "line" | "segment" | "ray" | "polyline" | "circle" | "arc" }>

type LineLike = LinePrimitive | SegmentPrimitive | RayPrimitive

interface LineAtom {
  kind: "line"
  /** 无界支撑直线；范围由 inRange 判定，clamp 把参数收进实体自身的范围。 */
  line: LinePrimitive
  inRange: (parameter: number) => boolean
  clamp: (parameter: number) => number
}

interface CircleAtom {
  kind: "circle"
  circle: CirclePrimitive
  inRange: (point: Coordinate) => boolean
  /** 最近点用：指针方向落在范围外时收到圆弧端点。 */
  clamp: (point: Coordinate) => Coordinate
}

type Atom = LineAtom | CircleAtom

const withinSegment = (parameter: number) => parameter >= -1e-9 && parameter <= 1 + 1e-9
const withinRay = (parameter: number) => parameter >= -1e-9
const always = () => true
const identity = (parameter: number) => parameter
const clampUnit = (parameter: number) => Math.min(1, Math.max(0, parameter))
const clampRay = (parameter: number) => Math.max(0, parameter)

function angleWithinArc(arc: ArcPrimitive, point: Coordinate): boolean {
  const angle = Math.atan2(point.y - arc.center.y, point.x - arc.center.x)
  const sweep = arc.endAngle - arc.startAngle
  const normalize = (value: number) => ((value % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
  return Math.abs(sweep) >= Math.PI * 2 - 1e-9
    ? true
    : sweep >= 0
      ? normalize(angle - arc.startAngle) <= sweep + 1e-9
      : normalize(arc.startAngle - angle) <= -sweep + 1e-9
}

function lineAtom(primitive: LineLike): LineAtom {
  const line: LinePrimitive = { id: primitive.id, type: "line", a: primitive.a, b: primitive.b }
  const inRange = primitive.type === "line" ? always : primitive.type === "ray" ? withinRay : withinSegment
  const clamp = primitive.type === "line" ? identity : primitive.type === "ray" ? clampRay : clampUnit
  return { kind: "line", line, inRange, clamp }
}

/** 把图元拆成"直线 / 圆"两种原子，并各自带上范围规则；折线拆成多段。 */
function atomsOf(primitive: PlanarSnapPrimitive): Atom[] {
  if (primitive.type === "line" || primitive.type === "segment" || primitive.type === "ray") return [lineAtom(primitive)]
  if (primitive.type === "polyline") {
    const atoms: Atom[] = []
    for (let index = 1; index < primitive.points.length; index += 1) {
      atoms.push(lineAtom({ id: `${primitive.id}-${index}`, type: "segment", a: primitive.points[index - 1], b: primitive.points[index] }))
    }
    return atoms
  }
  const circle: CirclePrimitive = { id: primitive.id, type: "circle", center: primitive.center, radius: primitive.radius }
  if (primitive.type === "circle") {
    return [{ kind: "circle", circle, inRange: always, clamp: (point) => radialProjection(circle, point) ?? point }]
  }
  const endpoints: Coordinate[] = [primitive.startAngle, primitive.endAngle].map((angle) => ({
    x: primitive.center.x + primitive.radius * Math.cos(angle),
    y: primitive.center.y + primitive.radius * Math.sin(angle)
  }))
  return [{
    kind: "circle",
    circle,
    inRange: (point) => angleWithinArc(primitive, point),
    // 最近点可以收到圆弧端点：那是圆弧上真实存在、且离指针最近的点。
    clamp: (point) => {
      const projected = radialProjection(circle, point)
      if (projected && angleWithinArc(primitive, projected)) return projected
      return endpoints.reduce((closest, candidate) => distance(candidate, point) < distance(closest, point) ? candidate : closest)
    }
  }]
}

function segmentsOf(primitive: PlanarSnapPrimitive): LineAtom[] {
  return atomsOf(primitive).filter((atom): atom is LineAtom => atom.kind === "line")
}

/** 支撑直线上的投影参数（0 = a，1 = b）；折线按各段分别算。 */
function projectionParameter(line: LinePrimitive, point: Coordinate): number | null {
  const deltaX = line.b.x - line.a.x
  const deltaY = line.b.y - line.a.y
  const lengthSquared = deltaX * deltaX + deltaY * deltaY
  if (lengthSquared === 0) return null
  return ((point.x - line.a.x) * deltaX + (point.y - line.a.y) * deltaY) / lengthSquared
}

function pointAt(line: LinePrimitive, parameter: number): Coordinate {
  return { x: line.a.x + parameter * (line.b.x - line.a.x), y: line.a.y + parameter * (line.b.y - line.a.y) }
}

function distance(first: Coordinate, second: Coordinate): number {
  return Math.hypot(first.x - second.x, first.y - second.y)
}

/** 圆心到指针方向与圆的交点（指针在圆心处则无解）。 */
function radialProjection(circle: CirclePrimitive, point: Coordinate): Coordinate | null {
  const offset = { x: point.x - circle.center.x, y: point.y - circle.center.y }
  const length = Math.hypot(offset.x, offset.y)
  if (length === 0) return null
  return { x: circle.center.x + (offset.x / length) * circle.radius, y: circle.center.y + (offset.y / length) * circle.radius }
}

/**
 * 实体上离指针最近的点。悬停在范围之外时收进实体自身范围（线段收到端点、射线收到起点、
 * 圆弧收到扫过范围内的最近端点）——这就是"实体上的最近点"的数学定义。
 * 垂足不使用这个夹取语义：脚点落在实体之外时垂足不存在。
 */
export function nearestPointOnPrimitive(primitive: PlanarSnapPrimitive, point: Coordinate): Coordinate | null {
  let best: Coordinate | null = null
  for (const atom of atomsOf(primitive)) {
    const candidate = atom.kind === "line"
      ? (() => {
        const parameter = projectionParameter(atom.line, point)
        return parameter === null ? null : pointAt(atom.line, atom.clamp(parameter))
      })()
      : atom.inRange(point) ? radialProjection(atom.circle, point) : atom.clamp(point)
    if (!candidate) continue
    if (!best || distance(candidate, point) < distance(best, point)) best = candidate
  }
  return best
}

/**
 * 从锚点向实体作垂线的垂足（线段/直线/射线/折线 = 投影点；圆/圆弧 = 圆心到锚点方向与圆的交点，
 * 也就是切线垂直于半径的位置）。锚点落点范围外时返回 null。
 */
export function perpendicularPointOnPrimitive(primitive: PlanarSnapPrimitive, from: Coordinate): Coordinate | null {
  if (primitive.type === "circle" || primitive.type === "arc") {
    const offset = { x: from.x - primitive.center.x, y: from.y - primitive.center.y }
    const length = Math.hypot(offset.x, offset.y)
    if (length === 0) return null
    const unit = { x: offset.x / length, y: offset.y / length }
    const candidates: Coordinate[] = [
      { x: primitive.center.x + unit.x * primitive.radius, y: primitive.center.y + unit.y * primitive.radius },
      { x: primitive.center.x - unit.x * primitive.radius, y: primitive.center.y - unit.y * primitive.radius }
    ].filter((point) => primitive.type === "circle" || angleWithinArc(primitive, point))
    if (candidates.length === 0) return null
    return candidates.reduce((closest, point) => distance(point, from) < distance(closest, from) ? point : closest)
  }
  let best: Coordinate | null = null
  for (const atom of segmentsOf(primitive)) {
    const parameter = projectionParameter(atom.line, from)
    if (parameter === null || !atom.inRange(parameter)) continue
    const candidate = pointAt(atom.line, parameter)
    if (!best || distance(candidate, from) < distance(best, from)) best = candidate
  }
  return best
}

/** 圆/圆弧的四个象限点（圆弧只保留自己扫过的那几个）。 */
export function quadrantPointsOnPrimitive(primitive: PlanarSnapPrimitive): Coordinate[] {
  if (primitive.type !== "circle" && primitive.type !== "arc") return []
  const { center, radius } = primitive
  const quadrants: Coordinate[] = [
    { x: center.x + radius, y: center.y },
    { x: center.x - radius, y: center.y },
    { x: center.x, y: center.y + radius },
    { x: center.x, y: center.y - radius }
  ]
  return primitive.type === "arc" ? quadrants.filter((point) => angleWithinArc(primitive, point)) : quadrants
}

/** 两个平面图元的所有交点（按各自范围过滤后去重）。 */
export function planarIntersections(first: PlanarSnapPrimitive, second: PlanarSnapPrimitive): Coordinate[] {
  const results: Coordinate[] = []
  const push = (point: Coordinate) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return
    if (!results.some((candidate) => distance(candidate, point) < 1e-7)) results.push(point)
  }
  for (const firstAtom of atomsOf(first)) {
    for (const secondAtom of atomsOf(second)) {
      if (firstAtom.kind === "line" && secondAtom.kind === "line") {
        const result = intersectLinesDetailed(firstAtom.line, secondAtom.line)
        if (result.kind !== "point") continue
        const firstParameter = projectionParameter(firstAtom.line, result.point)
        const secondParameter = projectionParameter(secondAtom.line, result.point)
        if (firstParameter === null || secondParameter === null) continue
        if (firstAtom.inRange(firstParameter) && secondAtom.inRange(secondParameter)) push(result.point)
        continue
      }
      if (firstAtom.kind === "circle" && secondAtom.kind === "circle") {
        const result = intersectCirclesDetailed(firstAtom.circle, secondAtom.circle)
        const points = result.kind === "points" ? result.points : result.kind === "point" || result.kind === "tangent" ? [result.point] : []
        for (const point of points) if (firstAtom.inRange(point) && secondAtom.inRange(point)) push(point)
        continue
      }
      const lineAtomSide = firstAtom.kind === "line" ? firstAtom : secondAtom as LineAtom
      const circleAtomSide = firstAtom.kind === "circle" ? firstAtom : secondAtom as CircleAtom
      const result = intersectLineCircleDetailed(lineAtomSide.line, circleAtomSide.circle)
      const points = result.kind === "points" ? result.points : result.kind === "point" || result.kind === "tangent" ? [result.point] : []
      for (const point of points) {
        const parameter = projectionParameter(lineAtomSide.line, point)
        if (parameter !== null && lineAtomSide.inRange(parameter) && circleAtomSide.inRange(point)) push(point)
      }
    }
  }
  return results
}
