import type { Plane3, Vector3 } from "./geometry3d"
import { addVector3, crossVector3, dotVector3, lengthVector3, normalizeVector3, planeFromPoints, scaleVector3, subtractVector3 } from "./geometry3d"

/** A straight segment of an intersection line. */
export interface Segment3 {
  a: Vector3
  b: Vector3
}

export type Intersection3Classification = "none" | "segment" | "polyline" | "insufficient-data"

export interface Intersection3Result {
  segments: Segment3[]
  classification: Intersection3Classification
  explanation: string
  /** 来源里有面环共面、退化或缺失时给出可读原因，不伪造几何。 */
  diagnostics: string[]
}

const EPSILON = 1e-9
/** 平行判定：两个支撑平面法向的叉积长度相对阈值。 */
const PARALLEL_EPSILON = 1e-9

function pointKey(point: Vector3, tolerance: number): string {
  const step = Math.max(tolerance, EPSILON)
  return `${Math.round(point.x / step)},${Math.round(point.y / step)},${Math.round(point.z / step)}`
}

function isFiniteVector(point: Vector3): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
}

/** 面环的支撑平面；顶点不足或退化（共线）时返回 null，由调用方决定如何诊断。 */
export function planeFromRing(ring: Vector3[], tolerance = EPSILON): Plane3 | null {
  if (ring.length < 3 || !ring.every(isFiniteVector)) return null
  for (let first = 0; first < ring.length - 2; first += 1) {
    for (let second = first + 1; second < ring.length - 1; second += 1) {
      for (let third = second + 1; third < ring.length; third += 1) {
        const plane = planeFromPoints(ring[first], ring[second], ring[third])
        if (plane && lengthVector3(plane.normal) > tolerance) return plane
      }
    }
  }
  return null
}

/** 平面是否覆盖整个面环（用于判定"共面"这种没有唯一交线的情况）。 */
function ringLiesInPlane(ring: Vector3[], plane: Plane3, tolerance: number): boolean {
  return ring.every((point) => Math.abs(dotVector3(plane.normal, point) + plane.constant) <= tolerance)
}

/**
 * 两个支撑平面确定的直线：返回直线上的一个点与单位方向；平面平行（含共面）时返回 null。
 * 直线 = { p0 + t·direction }。
 */
export function planeIntersectionLine(first: Plane3, second: Plane3): { point: Vector3; direction: Vector3 } | null {
  const firstNormal = normalizeVector3(first.normal)
  const secondNormal = normalizeVector3(second.normal)
  const direction = crossVector3(firstNormal, secondNormal)
  const directionLength = lengthVector3(direction)
  if (directionLength <= PARALLEL_EPSILON) return null
  const unit = scaleVector3(direction, 1 / directionLength)
  // 解三个方程：n1·p = -c1, n2·p = -c2, unit·p = 0（选直线离原点最近的点）。
  const firstConstant = -first.constant
  const secondConstant = -second.constant
  const determinant = dotVector3(crossVector3(firstNormal, secondNormal), unit)
  if (Math.abs(determinant) <= PARALLEL_EPSILON) return null
  const point = scaleVector3(
    addVector3(
      scaleVector3(crossVector3(secondNormal, unit), firstConstant),
      scaleVector3(crossVector3(unit, firstNormal), secondConstant)
    ),
    1 / determinant
  )
  if (!isFiniteVector(point)) return null
  return { point, direction: unit }
}

/**
 * 两个**凸**面环之间的交线段。
 * 做法（显式裁剪，避免"近似区间"带来的假交线）：
 * 1. 用第二个环的支撑平面去切第一个环 → 得到第一个环与该平面的交线段；
 * 2. 用第一个环的支撑平面去切第二个环 → 得到第二个环与该平面的交线段；
 * 3. 两条交线段都落在同一条直线（两平面交线）上，取它们的**参数区间交集**；
 * 4. 交集为空说明两个面没有公共点（哪怕各自都穿过了那条直线）。
 * 共面、平行、退化输入一律返回 null，由调用方给出诊断，不在这里猜。
 */
export function intersectRings3(first: Vector3[], second: Vector3[], tolerance = EPSILON): Segment3 | null {
  const firstPlane = planeFromRing(first, tolerance)
  const secondPlane = planeFromRing(second, tolerance)
  if (!firstPlane || !secondPlane) return null
  const line = planeIntersectionLine(firstPlane, secondPlane)
  if (!line) return null
  // 共面时交线不唯一：交给调用方诊断，不在这里猜。
  if (ringLiesInPlane(first, secondPlane, tolerance) && ringLiesInPlane(second, firstPlane, tolerance)) return null

  const along = line.direction
  const parameter = (point: Vector3) => dotVector3(subtractVector3(point, line.point), along)

  /**
   * 用一个平面切一个环：返回该环与平面的交点在交线方向上的参数区间。
   * 逐边解 v = 0（v 为到切割平面的有符号距离），把相邻的两个边界参数配成一段——
   * 这样"面只在直线附近凸起一小块"与"面横跨整条直线"两种情形都正确。
   */
  const clippedRange = (ring: Vector3[], plane: Plane3): { low: number; high: number } | null => {
    const normal = normalizeVector3(plane.normal)
    const distance = (point: Vector3) => dotVector3(normal, point) + plane.constant
    const crossings: { point: Vector3; t: number }[] = []
    for (let index = 0; index < ring.length; index += 1) {
      const start = ring[index]
      const end = ring[(index + 1) % ring.length]
      const startDistance = distance(start)
      const endDistance = distance(end)
      if (Math.abs(startDistance) <= tolerance) {
        crossings.push({ point: start, t: parameter(start) })
        continue
      }
      if (startDistance * endDistance < 0) {
        const ratio = startDistance / (startDistance - endDistance)
        const point = addVector3(start, scaleVector3(subtractVector3(end, start), ratio))
        crossings.push({ point, t: parameter(point) })
      }
    }
    if (crossings.length < 2) return null
    const sorted = [...crossings].sort((left, right) => left.t - right.t)
    // 相邻配对成段，取最长的一段（凸环至多两段，取最长即主体交线）。
    let best: { low: number; high: number } | null = null
    for (let index = 0; index + 1 < sorted.length; index += 2) {
      const low = sorted[index].t
      const high = sorted[index + 1].t
      if (high - low <= tolerance) continue
      if (!best || high - low > best.high - best.low) best = { low, high }
    }
    return best
  }

  const firstRange = clippedRange(first, secondPlane)
  const secondRange = clippedRange(second, firstPlane)
  if (!firstRange || !secondRange) return null
  const low = Math.max(firstRange.low, secondRange.low)
  const high = Math.min(firstRange.high, secondRange.high)
  if (high - low <= tolerance) return null
  const a = addVector3(line.point, scaleVector3(along, low))
  const b = addVector3(line.point, scaleVector3(along, high))
  if (!isFiniteVector(a) || !isFiniteVector(b)) return null
  return { a, b }
}

/** 方向平行判定与端点去重所需的容差（相对尺度）。 */
function scaleOf(rings: Vector3[][]): number {
  const values = rings.flat().flatMap((point) => [Math.abs(point.x), Math.abs(point.y), Math.abs(point.z)]).filter(Number.isFinite)
  return Math.max(...values, 1)
}

/**
 * 两组面环之间的公共交线：逐面求交 → 端点去重 → 共线合并。
 * 同一段交线会被相邻的两个面各算一次（例如立方体的一条棱是两个面的交），因此必须去重。
 */
export function intersectFaceSets(first: Vector3[][], second: Vector3[][], tolerance = 1e-7): Intersection3Result {
  const diagnostics: string[] = []
  const validFirst = first.filter((ring) => ring.length >= 3 && ring.every(isFiniteVector))
  const validSecond = second.filter((ring) => ring.length >= 3 && ring.every(isFiniteVector))
  if (validFirst.length === 0 || validSecond.length === 0) {
    return { segments: [], classification: "insufficient-data", explanation: "至少一侧没有可用的面环，无法求交。", diagnostics: ["来源缺少面环（实体需要已物化的拓扑）。"] }
  }

  const scale = scaleOf([...validFirst, ...validSecond])
  const epsilon = Math.max(tolerance, scale * 1e-9)
  const raw: Segment3[] = []
  let coplanarPairs = 0
  const planeTolerance = scale * 1e-7
  for (const firstRing of validFirst) {
    for (const secondRing of validSecond) {
      const firstPlane = planeFromRing(firstRing, epsilon)
      const secondPlane = planeFromRing(secondRing, epsilon)
      if (!firstPlane || !secondPlane) continue
      // **共面短路**：两个面共面时交线不唯一。若不先跳过，平面求交会在数值上退化并给出假交线。
      if (ringLiesInPlane(firstRing, secondPlane, planeTolerance) && ringLiesInPlane(secondRing, firstPlane, planeTolerance)) {
        coplanarPairs += 1
        continue
      }
      const segment = intersectRings3(firstRing, secondRing, epsilon)
      if (segment) raw.push(segment)
    }
  }
  if (coplanarPairs > 0) diagnostics.push(`有 ${coplanarPairs} 对面共面，共面没有唯一交线，已跳过。`)
  if (raw.length === 0) {
    return { segments: [], classification: "none", explanation: "两组面之间没有交线。", diagnostics }
  }

  // 端点去重：同一段交线可能被相邻面重复算出（方向可能相反）。
  const seen = new Map<string, { a: Vector3; b: Vector3; aKey: string; bKey: string }>()
  for (const segment of raw) {
    const aKey = pointKey(segment.a, epsilon)
    const bKey = pointKey(segment.b, epsilon)
    const key = aKey < bKey ? `${aKey}~${bKey}` : `${bKey}~${aKey}`
    if (!seen.has(key)) seen.set(key, { a: segment.a, b: segment.b, aKey, bKey })
  }
  const unique = [...seen.values()].map((entry) => ({ a: entry.a, b: entry.b }))

  // 共线合并：把共线且投影区间重叠/相接的段并成一条（多边形近似会把一条长交线切成很多短段）。
  // 逐对贪心在这里不可靠（合并顺序会影响结果），改为"按共线分组（并查集）→ 每组取两端极值"。
  const directions = unique.map((segment) => normalizeVector3(subtractVector3(segment.b, segment.a)))
  const groupOf = unique.map((_, index) => index)
  const find = (index: number): number => {
    let root = index
    while (groupOf[root] !== root) root = groupOf[root]
    return root
  }
  const union = (first: number, second: number) => {
    const firstRoot = find(first)
    const secondRoot = find(second)
    if (firstRoot !== secondRoot) groupOf[secondRoot] = firstRoot
  }
  /** 共线判定：方向平行，且第二段的两个端点到第一段所在直线的距离都在容差内。 */
  const collinear = (first: number, second: number): boolean => {
    const firstDirection = directions[first]
    const secondDirection = directions[second]
    if (Math.abs(Math.abs(dotVector3(firstDirection, secondDirection)) - 1) > 1e-9) return false
    const origin = unique[first].a
    const normal = crossVector3(firstDirection, subtractVector3(unique[second].a, origin))
    if (lengthVector3(normal) > epsilon * 8) return false
    const farNormal = crossVector3(firstDirection, subtractVector3(unique[second].b, origin))
    return lengthVector3(farNormal) <= epsilon * 8
  }
  /**
   * 共线之外还必须**参数区间重叠或相接**才合并：同一条无限直线上可能有多段彼此分离的真实交线
   * （例如两个盒子只在两个角落接触），把它们并成一段会跨过中间的空隙。
   */
  const intervalsTouch = (first: number, second: number): boolean => {
    const direction = directions[first]
    const origin = unique[first].a
    const project = (point: Vector3) => dotVector3(subtractVector3(point, origin), direction)
    const firstRange = [project(unique[first].a), project(unique[first].b)].sort((left, right) => left - right)
    const secondRange = [project(unique[second].a), project(unique[second].b)].sort((left, right) => left - right)
    return secondRange[0] <= firstRange[1] + epsilon * 4 && firstRange[0] <= secondRange[1] + epsilon * 4
  }
  for (let first = 0; first < unique.length; first += 1) {
    for (let second = first + 1; second < unique.length; second += 1) {
      if (collinear(first, second) && intervalsTouch(first, second)) union(first, second)
    }
  }
  const groups = new Map<number, number[]>()
  for (let index = 0; index < unique.length; index += 1) {
    const root = find(index)
    groups.set(root, [...(groups.get(root) ?? []), index])
  }
  const merged: Segment3[] = []
  for (const members of groups.values()) {
    if (members.length === 1) {
      merged.push(unique[members[0]])
      continue
    }
    const direction = directions[members[0]]
    const origin = unique[members[0]].a
    const projected = members.flatMap((index) => [unique[index].a, unique[index].b]).map((point) => ({ point, t: dotVector3(subtractVector3(point, origin), direction) }))
    projected.sort((left, right) => left.t - right.t)
    merged.push({ a: projected[0].point, b: projected[projected.length - 1].point })
  }

  const classification: Intersection3Classification = merged.length === 1 ? "segment" : "polyline"
  return {
    segments: merged,
    classification,
    explanation: merged.length === 1
      ? "两组面相交于一条交线。"
      : `两组面相交于 ${merged.length} 条交线（已按共线与端点合并）。`,
    diagnostics
  }
}

/** 从面环集合取出"可见面"的顶点环；缺失或退化由调用方转成诊断。 */
export function faceRingsFromFaces(faces: number[][], vertices: Vector3[]): Vector3[][] {
  return faces
    .filter((face) => face.length >= 3 && face.every((index) => Number.isInteger(index) && index >= 0 && index < vertices.length))
    .map((face) => face.map((index) => vertices[index]))
    .filter((ring) => ring.every(isFiniteVector))
}
