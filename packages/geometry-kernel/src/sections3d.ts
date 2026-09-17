import type { Plane3, Vector3 } from "./geometry3d"
import { addVector3, crossVector3, dotVector3, intersectPlaneSegment, lengthVector3, normalizeVector3, subtractVector3 } from "./geometry3d"

/** Ordered section boundary produced by cutting a polyhedron with a plane. */
export type Section3Status = "none" | "point" | "segment" | "polygon" | "insufficient-data"

export interface Section3Result {
  status: Section3Status
  /** 周长最大的一环，按平面内顺序排列（兼容既有消费方 `SectionPrimitive.points`）。 */
  points: Vector3[]
  /** 全部闭合环，按面积降序。带孔或分成多块的截面靠它保留完整几何。 */
  loops: Vector3[][]
  explanation: string
}

const EPSILON = 1e-9

/**
 * 点键的量化步长按**模型尺度**取，而不是固定小数位：旋转 90° 得到的法向带着 ~1e-17 的残差，
 * 同一个交点在不同面上算出来的坐标会差几个 ulp，固定 9 位小数的键分不开它们——
 * 实测症状就是"法向正好落在坐标轴上时截面解析失败、点连不成闭合边界"。
 *
 * 注意：量化只用于**身份判定**（去重与成环），落库/返回的坐标仍然用精确交点——
 * 把交点吸附到格上会让 0.5 变成 0.500000001 这种可见漂移。
 */
function quantumFor(vertices: Vector3[]): number {
  const extent = vertices.reduce((largest, vertex) => Math.max(largest, Math.abs(vertex.x), Math.abs(vertex.y), Math.abs(vertex.z)), 1)
  return Math.max(extent * 1e-9, 1e-12)
}

function pointKey(point: Vector3, quantum: number): string {
  return `${Math.round(point.x / quantum)},${Math.round(point.y / quantum)},${Math.round(point.z / quantum)}`
}

function segmentKey(first: string, second: string): string {
  return first < second ? `${first}~${second}` : `${second}~${first}`
}

/**
 * Sort a convex ring by angle in the cutting plane. This is only a boundary order for convex sections; use
 * `sectionPolyhedron3` for arbitrary solids, which orders by face adjacency instead.
 */
function orderConvexRing(points: Vector3[], plane: Plane3): Vector3[] {
  const count = points.length
  const centroid = points.reduce((sum, point) => addVector3(sum, { x: point.x / count, y: point.y / count, z: point.z / count }), { x: 0, y: 0, z: 0 })
  const normal = normalizeVector3(plane.normal)
  const helper = Math.abs(normal.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
  const firstAxis = normalizeVector3(crossVector3(normal, helper))
  const secondAxis = crossVector3(normal, firstAxis)
  const angleOf = (point: Vector3) => {
    const offset = subtractVector3(point, centroid)
    return Math.atan2(dotVector3(offset, secondAxis), dotVector3(offset, firstAxis))
  }
  return [...points].sort((first, second) => angleOf(first) - angleOf(second))
}

/** Order a convex section point set around the cutting plane; fewer than three points are returned as-is. */
export function orderSectionPoints3(points: Vector3[], plane: Plane3): Vector3[] {
  return points.length < 3 ? [...points] : orderConvexRing(points, plane)
}

function polygonPerimeter(points: Vector3[]): number {
  return points.reduce((sum, point, index) => sum + lengthVector3(subtractVector3(points[(index + 1) % points.length], point)), 0)
}

function polygonArea(points: Vector3[]): number {
  if (points.length < 3) return 0
  const origin = points[0]
  let areaVector = { x: 0, y: 0, z: 0 }
  for (let index = 1; index < points.length - 1; index += 1) areaVector = addVector3(areaVector, crossVector3(subtractVector3(points[index], origin), subtractVector3(points[index + 1], origin)))
  return lengthVector3(areaVector) / 2
}

/** Intersection points of one face ring, kept in ring order and deduplicated across shared vertices. */
function faceSectionRing(face: number[], vertices: Vector3[], plane: Plane3, tolerance: number, quantum: number): Vector3[] {
  const ring: Vector3[] = []
  for (let index = 0; index < face.length; index += 1) {
    const first = vertices[face[index]]
    const second = vertices[face[(index + 1) % face.length]]
    for (const hit of intersectPlaneSegment(first, second, plane, tolerance)) {
      if (ring.length > 0 && pointKey(ring[ring.length - 1], quantum) === pointKey(hit, quantum)) continue
      ring.push(hit)
    }
  }
  while (ring.length > 1 && pointKey(ring[0], quantum) === pointKey(ring[ring.length - 1], quantum)) ring.pop()
  return ring
}

/** Chain the per-face segments into closed boundary loops by matching shared endpoints. */
function chainSectionLoops(segments: [Vector3, Vector3][], quantum: number): Vector3[][] {
  const pointsByKey = new Map<string, Vector3>()
  const adjacency = new Map<string, string[]>()
  for (const [start, end] of segments) {
    const startKey = pointKey(start, quantum)
    const endKey = pointKey(end, quantum)
    if (startKey === endKey) continue
    pointsByKey.set(startKey, start)
    pointsByKey.set(endKey, end)
    adjacency.set(startKey, [...(adjacency.get(startKey) ?? []), endKey])
    adjacency.set(endKey, [...(adjacency.get(endKey) ?? []), startKey])
  }

  const used = new Set<string>()
  const loops: Vector3[][] = []
  for (const startKey of adjacency.keys()) {
    let current = startKey
    const walk: string[] = []
    while (true) {
      const next = (adjacency.get(current) ?? []).find((candidate) => !used.has(segmentKey(current, candidate)))
      if (next === undefined) break
      used.add(segmentKey(current, next))
      walk.push(current)
      current = next
      if (current === startKey) break
    }
    if (current === startKey && walk.length >= 3) loops.push(walk.map((key) => pointsByKey.get(key)!))
  }
  return loops
}

/**
 * Cut any closed polyhedron with a plane by intersecting the plane with every face boundary, then chaining the
 * per-face segments into closed boundary loops. Working from face adjacency (instead of sorting points by angle)
 * keeps non-convex sections correct. The result is classified instead of fabricating geometry: disjoint,
 * vertex-tangent, edge-coincident, multiple-loop and full-polygon sections are distinguished, and degenerate
 * results return no points.
 *
 * @param vertices - polyhedron vertex positions; face rings index into this array
 * @param faces - closed face rings (index lists), at least 4 for a closed solid
 * @param plane - cutting plane in `dot(normal, point) + constant = 0` form
 */
export function sectionPolyhedron3(vertices: Vector3[], faces: number[][], plane: Plane3, tolerance = EPSILON): Section3Result {
  const validFaces = faces.filter((face) => face.length >= 3 && face.every((index) => Number.isInteger(index) && index >= 0 && index < vertices.length))
  if (vertices.length < 4 || validFaces.length < 4) return { status: "insufficient-data", points: [], loops: [], explanation: "多面体拓扑不足：截面需要至少 4 个顶点和 4 个闭合面。" }

  /**
   * 剖切平面必须先校验：零法向（或相对模型尺度可以忽略的法向）意味着"方程" `0·p + c = 0`
   * 与每个点都相容（`c = 0` 时恒真），逐面环首尾相连就能凑出一个**看起来正常的面**并把状态报成
   * `"polygon"`——凭空造出一片几何；而 `c ≠ 0` 时同样的输入却报 `"none"`。法向退化只能报数据不足。
   */
  const normalLength = lengthVector3(plane.normal)
  const extent = vertices.reduce((largest, vertex) => Math.max(largest, Math.abs(vertex.x), Math.abs(vertex.y), Math.abs(vertex.z)), 1)
  if (!Number.isFinite(normalLength) || !Number.isFinite(plane.constant) || normalLength <= extent * 1e-9) {
    return { status: "insufficient-data", points: [], loops: [], explanation: "剖切平面的法向退化（长度为零或不可用），无法确定剖切方向。" }
  }

  const quantum = quantumFor(vertices)
  const unique = new Map<string, Vector3>()
  const segments: [Vector3, Vector3][] = []
  for (const face of validFaces) {
    const ring = faceSectionRing(face, vertices, plane, tolerance, quantum)
    for (const point of ring) unique.set(pointKey(point, quantum), point)
    if (ring.length === 2) segments.push([ring[0], ring[1]])
    else if (ring.length > 2) for (let index = 0; index < ring.length; index += 1) segments.push([ring[index], ring[(index + 1) % ring.length]])
  }

  const points = [...unique.values()]
  if (points.length === 0) return { status: "none", points: [], loops: [], explanation: "剖切平面与多面体没有交集。" }
  if (points.length === 1) return { status: "point", points, loops: [], explanation: "剖切平面与多面体相切于一个顶点。" }
  if (points.length === 2) return { status: "segment", points, loops: [[...points]], explanation: "剖切平面与多面体相交于一条棱或线段。" }

  // 保留**全部**闭合环：旧实现只取周长最大的一条，于是不连通或带孔的截面会丢几何。
  // 退化环（面积近似为 0）先剔除；若一个都不剩，才判定为解析失败。
  const loops = chainSectionLoops(segments, quantum)
    .filter((loop) => polygonArea(loop) > tolerance)
    .sort((first, second) => polygonArea(second) - polygonArea(first))
  if (loops.length === 0) return { status: "insufficient-data", points: [], loops: [], explanation: "截面点无法连成闭合边界，已保留来源但不出结果。" }

  const ordered = loops[0]
  const extra = loops.length > 1 ? `剖切平面与多面体产生 ${loops.length} 条独立边界，全部保留（第一条为外轮廓）。` : ""
  return { status: "polygon", points: ordered, loops, explanation: `按面边界求交并沿相邻面连接得到 ${ordered.length} 个截面顶点。${extra}` }
}
