import type { Plane3, Vector3 } from "./geometry3d"
import { crossVector3, dotVector3, lengthVector3, normalizeVector3, subtractVector3 } from "./geometry3d"
import { orderSectionPoints3 } from "./sections3d"

/**
 * 两个凸实体的布尔交集：重叠区域的**整体表面**。
 *
 * 用户要求把"交面"做成独立图元，并明确它指的是"两个实体重叠区域的整体表面"（布尔交集）。
 *
 * 做法：凸实体 = 一组半空间的交集（每个面给一个半空间），所以
 * **用对方的每个面平面依次裁剪自己**，剩下的就是交集——凸实体被平面裁剪后仍是凸体，
 * 算法简单、数值可控（旋转、共面、相切都只是"某个角被削掉"）。
 *
 * 刻意**不做**非凸实体的近似：输入非凸时返回 `insufficient-data` 与诊断，而不是给一个看着像的错几何。
 */

export type SolidIntersectionStatus = "polyhedron" | "flat" | "point" | "segment" | "none" | "insufficient-data"

export interface Polyhedron3Input {
  vertices: Vector3[]
  faces: number[][]
}

export interface SolidIntersectionResult {
  status: SolidIntersectionStatus
  /** 交集的顶点（去重后）。 */
  vertices: Vector3[]
  /** 交集的面：按顺序排列的顶点索引。 */
  faces: number[][]
  /** 每个面**朝外**的单位法向，与 `faces` 一一对应（交面图元要"这一面朝哪边"）。 */
  faceNormals: Vector3[]
  /** 每个面的面积，与 `faces` 一一对应（交面图元要"这一面多大"）。 */
  faceAreas: number[]
  /** 交集体积（`flat` / `point` / `segment` / `none` 时为 0）。 */
  volume: number
  /** 交集表面积（各面多边形面积之和）。 */
  area: number
  explanation: string
  diagnostics: string[]
}

interface FacePlane extends Plane3 {
  /** 平面上的一点，用于半空间判定。 */
  point: Vector3
}

const EPSILON = 1e-9

/** 量化步长按模型尺度取：旋转带来的 ulp 级残差不会把同一个顶点判成两个。 */
function quantumFor(vertices: Vector3[]): number {
  const extent = vertices.reduce((largest, vertex) => Math.max(largest, Math.abs(vertex.x), Math.abs(vertex.y), Math.abs(vertex.z)), 1)
  return Math.max(extent * 1e-9, 1e-12)
}

const pointKey = (point: Vector3, quantum: number) => `${Math.round(point.x / quantum)},${Math.round(point.y / quantum)},${Math.round(point.z / quantum)}`

/** Newell 法向：对非严格平面多边形也稳定，不依赖顶点绕向是否一致。 */
function newellNormal(vertices: Vector3[], face: number[]): Vector3 | null {
  let normal = { x: 0, y: 0, z: 0 }
  for (let index = 0; index < face.length; index += 1) {
    const current = vertices[face[index]]
    const next = vertices[face[(index + 1) % face.length]]
    normal = {
      x: normal.x + (current.y - next.y) * (current.z + next.z),
      y: normal.y + (current.z - next.z) * (current.x + next.x),
      z: normal.z + (current.x - next.x) * (current.y + next.y)
    }
  }
  return lengthVector3(normal) > EPSILON ? normalizeVector3(normal) : null
}

function centroidOf(vertices: Vector3[]): Vector3 {
  const count = Math.max(vertices.length, 1)
  return vertices.reduce((sum, vertex) => ({ x: sum.x + vertex.x / count, y: sum.y + vertex.y / count, z: sum.z + vertex.z / count }), { x: 0, y: 0, z: 0 })
}

/** 面的平面，法向朝**外**（用形心判断朝向，因此不要求输入绕向一致）。 */
function facePlanes(input: Polyhedron3Input): FacePlane[] | null {
  const centroid = centroidOf(input.vertices)
  const planes: FacePlane[] = []
  for (const face of input.faces) {
    if (face.length < 3 || face.some((index) => index < 0 || index >= input.vertices.length)) return null
    const normal = newellNormal(input.vertices, face)
    if (!normal) return null
    const point = input.vertices[face[0]]
    const outward = dotVector3(normal, subtractVector3(centroid, point)) > 0 ? { x: -normal.x, y: -normal.y, z: -normal.z } : normal
    planes.push({ normal: outward, constant: -dotVector3(outward, point), point })
  }
  return planes
}

/** 凸性检查：每个顶点都必须落在每个面的内侧（面法向朝外 ⇒ 到平面距离 ≤ 容差）。 */
function convexityBreach(input: Polyhedron3Input, planes: FacePlane[], tolerance: number): boolean {
  for (const vertex of input.vertices) {
    for (const plane of planes) {
      if (dotVector3(plane.normal, vertex) + plane.constant > tolerance) return true
    }
  }
  return false
}

function dedupePoints(points: Vector3[], quantum: number): Vector3[] {
  const seen = new Set<string>()
  const unique: Vector3[] = []
  for (const point of points) {
    const key = pointKey(point, quantum)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(point)
  }
  return unique
}

/**
 * 去掉环上相邻（含首尾）重复的点。
 *
 * 顶点正好落在裁剪平面上时，它既会被"在内侧"分支push一次，又会被"跨越平面"分支补一个几乎同位的交点；
 * 不清掉这些重复点，面就会退化成 `[7,4,6,7,7]` 这种形状，扇形三角化随之算错——实测体积因此偏小 12%。
 */
function dedupeRing(points: Vector3[], quantum: number): Vector3[] {
  const rings: Vector3[] = []
  for (const point of points) {
    const previous = rings[rings.length - 1]
    if (previous && pointKey(previous, quantum) === pointKey(point, quantum)) continue
    rings.push(point)
  }
  while (rings.length > 1 && pointKey(rings[0], quantum) === pointKey(rings[rings.length - 1], quantum)) rings.pop()
  return rings
}

/** 用平面裁剪一个凸多面体（保留 `n·x + constant ≤ 0` 的一侧），并补上切口面。 */
function clipByPlane(polyhedron: Polyhedron3Input, plane: FacePlane, quantum: number): Polyhedron3Input {
  const signed = (point: Vector3) => dotVector3(plane.normal, point) + plane.constant
  const tolerance = quantum
  const vertices = [...polyhedron.vertices]
  /**
   * 顶点索引表（键 → 下标）。
   *
   * 旧实现每次插入都 `findIndex` 线性扫描并**重建字符串键**：一次裁剪是 O(F·V) 次键构造，
   * 两个 48 段圆柱的近似（各约 100 顶点、50 面）就已经到几十毫秒，96 段更是秒级。
   * 这里一次建表、之后 O(1) 查，语义完全不变（键相同时仍取**最早**的那个下标）。
   */
  const indexByKey = new Map<string, number>()
  vertices.forEach((vertex, index) => {
    const key = pointKey(vertex, quantum)
    if (!indexByKey.has(key)) indexByKey.set(key, index)
  })
  const vertexIndex = (point: Vector3): number => {
    const key = pointKey(point, quantum)
    const existing = indexByKey.get(key)
    if (existing !== undefined) return existing
    const next = vertices.push(point) - 1
    indexByKey.set(key, next)
    return next
  }
  const faces: number[][] = []
  const cutPoints: Vector3[] = []
  for (const face of polyhedron.faces) {
    const clipped: Vector3[] = []
    for (let index = 0; index < face.length; index += 1) {
      const current = polyhedron.vertices[face[index]]
      const next = polyhedron.vertices[face[(index + 1) % face.length]]
      const currentSigned = signed(current)
      const nextSigned = signed(next)
      const currentInside = currentSigned <= tolerance
      const nextInside = nextSigned <= tolerance
      if (currentInside) clipped.push(current)
      if (currentInside !== nextInside) {
        const denominator = currentSigned - nextSigned
        if (Math.abs(denominator) <= EPSILON) continue
        const ratio = currentSigned / denominator
        const crossing = { x: current.x + (next.x - current.x) * ratio, y: current.y + (next.y - current.y) * ratio, z: current.z + (next.z - current.z) * ratio }
        clipped.push(crossing)
        cutPoints.push(crossing)
      }
    }
    const indices = dedupeRing(clipped, quantum).map(vertexIndex)
    if (new Set(indices).size >= 3) faces.push(indices)
  }
  if (cutPoints.length >= 3) {
    /**
     * 切口面：切口上的点必须**按平面内角度排序**（凸切口 ⇒ 顺序即边界顺序）。
     * 少了这一步，切口面会变成自交多边形，后面每一刀都切在烂几何上——
     * 实测：包含关系的两立方体算成体积 0.88、面里出现 `[6,7,0,2,6,3,5]` 这种重复顶点的形状。
     */
    const ordered = orderSectionPoints3(dedupePoints(cutPoints, quantum), plane)
    if (ordered.length >= 3) faces.push(ordered.map(vertexIndex))
  }
  return { vertices, faces }
}

/** 压紧顶点表：去掉没有被面引用的顶点、重建索引，并合并**顶点集合相同**的面。 */
function compact(polyhedron: Polyhedron3Input): Polyhedron3Input {
  const remapped = new Map<number, number>()
  const vertices: Vector3[] = []
  const seen = new Set<string>()
  const faces: number[][] = []
  for (const face of polyhedron.faces) {
    const indices = face.map((index) => {
      const existing = remapped.get(index)
      if (existing !== undefined) return existing
      const next = vertices.push(polyhedron.vertices[index]) - 1
      remapped.set(index, next)
      return next
    })
    if (new Set(indices).size < 3) continue
    /**
     * 同集合的面只留一个：用对方平面裁剪时，若我方某个面正好落在对方平面上，
     * 它会完整保留，同时切口面又会被补一次——两份完全重合的面会让面积翻倍
     * （实测：两个相接的立方体表面积算成 2 而不是 1）。凸体上不同面的顶点集合不可能相同。
     */
    const signature = [...indices].sort((left, right) => left - right).join(",")
    if (seen.has(signature)) continue
    seen.add(signature)
    faces.push(indices)
  }
  return { vertices, faces }
}

function areaOf(polyhedron: Polyhedron3Input): number {
  let total = 0
  for (const face of polyhedron.faces) {
    let accumulated = { x: 0, y: 0, z: 0 }
    for (let index = 0; index < face.length; index += 1) {
      const current = polyhedron.vertices[face[index]]
      const next = polyhedron.vertices[face[(index + 1) % face.length]]
      accumulated = {
        x: accumulated.x + (current.y * next.z - current.z * next.y),
        y: accumulated.y + (current.z * next.x - current.x * next.z),
        z: accumulated.z + (current.x * next.y - current.y * next.x)
      }
    }
    total += lengthVector3(accumulated) / 2
  }
  return total
}

/**
 * 凸多面体体积：从内部点（顶点形心，凸体内部）对每个面张成的四面体**取绝对值**再相加。
 * 取绝对值让结果与顶点绕向无关——裁剪会保留输入面的绕向，而输入并不保证一致；
 * 有符号求和在这种情况下会互相抵消（实测：0.5 立方体算成 0.066）。
 */
function volumeOf(polyhedron: Polyhedron3Input): number {
  if (polyhedron.faces.length === 0) return 0
  const origin = centroidOf(polyhedron.vertices)
  let volume = 0
  for (const face of polyhedron.faces) {
    for (let index = 1; index < face.length - 1; index += 1) {
      const first = subtractVector3(polyhedron.vertices[face[0]], origin)
      const second = subtractVector3(polyhedron.vertices[face[index]], origin)
      const third = subtractVector3(polyhedron.vertices[face[index + 1]], origin)
      volume += Math.abs(dotVector3(first, crossVector3(second, third))) / 6
    }
  }
  return volume
}

function maxExtent(vertices: Vector3[]): number {
  let extent = 0
  for (const first of vertices) for (const second of vertices) extent = Math.max(extent, lengthVector3(subtractVector3(first, second)))
  return extent
}

/** 点集所在仿射子空间的维度（0 点、1 线、2 面、3 体），用于零体积退化分类。 */
function rankOf(vertices: Vector3[], tolerance: number): number {
  const base = vertices[0]
  const directions: Vector3[] = []
  for (const vertex of vertices.slice(1)) {
    let orthogonal = subtractVector3(vertex, base)
    if (lengthVector3(orthogonal) <= tolerance) continue
    for (const direction of directions) {
      const unit = normalizeVector3(direction)
      const projection = dotVector3(orthogonal, unit)
      orthogonal = { x: orthogonal.x - unit.x * projection, y: orthogonal.y - unit.y * projection, z: orthogonal.z - unit.z * projection }
    }
    if (lengthVector3(orthogonal) > tolerance) directions.push(orthogonal)
    if (directions.length === 3) break
  }
  return directions.length
}

function classify(polyhedron: Polyhedron3Input, tolerance: number): SolidIntersectionStatus {
  if (volumeOf(polyhedron) > tolerance ** 3) return "polyhedron"
  if (polyhedron.vertices.length <= 1) return "point"
  if (maxExtent(polyhedron.vertices) <= tolerance) return "point"
  return rankOf(polyhedron.vertices, tolerance) <= 1 ? "segment" : "flat"
}

export function intersectConvexPolyhedra3(first: Polyhedron3Input, second: Polyhedron3Input): SolidIntersectionResult {  const failed = (explanation: string, diagnostics: string[]): SolidIntersectionResult => ({ status: "insufficient-data", vertices: [], faces: [], faceNormals: [], faceAreas: [], volume: 0, area: 0, explanation, diagnostics })
  if (first.vertices.length < 4 || first.faces.length < 4 || second.vertices.length < 4 || second.faces.length < 4) {
    return failed("求交需要两个至少有四个面的多面体。", ["输入实体不完整"])
  }
  const firstPlanes = facePlanes(first)
  const secondPlanes = facePlanes(second)
  if (!firstPlanes || !secondPlanes) return failed("实体存在退化面（面积为零或顶点索引越界），无法判定交集。", ["退化面"])
  const quantum = quantumFor([...first.vertices, ...second.vertices])
  for (const [input, planes, label] of [[first, firstPlanes, "第一个"], [second, secondPlanes, "第二个"]] as const) {
    if (convexityBreach(input, planes, quantum * 10)) {
      return failed(`${label}实体不是凸多面体：凸交集算法只对凸实体成立，这里不做近似。`, ["non-convex", label])
    }
  }
  // 从第一个实体出发，用第二个实体的每个面平面依次裁剪。
  let current = compact(first)
  for (const plane of secondPlanes) {
    current = clipByPlane(current, plane, quantum)
    if (current.vertices.length === 0 || current.faces.length === 0) {
      return { status: "none", vertices: [], faces: [], faceNormals: [], faceAreas: [], volume: 0, area: 0, explanation: "两个实体没有重叠区域。", diagnostics: [] }
    }
  }
  current = compact(current)
  const status = classify(current, quantum * 100)
  const volume = volumeOf(current)
  const area = areaOf(current)
  const normals = faceNormalsOf(current)
  const faceAreas = current.faces.map((face) => ringAreaOf(current.vertices, face))
  if (status === "polyhedron") {
    return { status, vertices: current.vertices, faces: current.faces, faceNormals: normals, faceAreas, volume, area, explanation: `交集是 ${current.faces.length} 个面的多面体。`, diagnostics: [] }
  }
  const explanation = status === "flat"
    ? "两个实体只在一个平面区域上相接（交集没有体积）。"
    : status === "segment"
      ? "两个实体只沿一条线段相接。"
      : "两个实体只在一个点相接。"
  return { status, vertices: current.vertices, faces: current.faces, faceNormals: normals, faceAreas, volume, area, explanation, diagnostics: [status] }
}

/** 每个面**朝外**的单位法向（用交集形心判断朝向，因此与顶点绕向无关）。退化面给零向量。 */
function faceNormalsOf(polyhedron: Polyhedron3Input): Vector3[] {
  const centre = centroidOf(polyhedron.vertices)
  return polyhedron.faces.map((face) => {
    const unit = newellNormal(polyhedron.vertices, face)
    if (!unit) return { x: 0, y: 0, z: 0 }
    const centroid = faceCentroidOf(polyhedron.vertices, face)
    return dotVector3(unit, subtractVector3(centroid, centre)) < 0 ? { x: -unit.x, y: -unit.y, z: -unit.z } : unit
  })
}

function faceCentroidOf(vertices: Vector3[], face: number[]): Vector3 {
  const count = Math.max(face.length, 1)
  return face.reduce((sum, index) => {
    const vertex = vertices[index]
    return { x: sum.x + vertex.x / count, y: sum.y + vertex.y / count, z: sum.z + vertex.z / count }
  }, { x: 0, y: 0, z: 0 })
}

/** 单个面的面积（Newell 向量长度的一半）：交面图元的面积读数就是它。 */
function ringAreaOf(vertices: Vector3[], face: number[]): number {
  let accumulated = { x: 0, y: 0, z: 0 }
  for (let index = 0; index < face.length; index += 1) {
    const current = vertices[face[index]]
    const next = vertices[face[(index + 1) % face.length]]
    accumulated = {
      x: accumulated.x + (current.y * next.z - current.z * next.y),
      y: accumulated.y + (current.z * next.x - current.x * next.z),
      z: accumulated.z + (current.x * next.y - current.y * next.x)
    }
  }
  return lengthVector3(accumulated) / 2
}
