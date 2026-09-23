import type { ConePrimitive, CubePrimitive, CylinderPrimitive, PrimitiveSpec, PyramidPrimitive } from "@draw/dsl"

import { areCoplanar, crossVector3, subtractVector3, type Vector3 } from "./geometry3d"

export type GeometryDiagnosticCode =
  | "invalid-input"
  | "missing-face-rings"
  | "degenerate-base"
  | "degenerate-vector"
  | "non-planar-base"
  | "open-boundary"
  | "degenerate-volume"
  | "unused-vertex"
  | "disconnected-topology"
  | "self-intersection"
  | "duplicate-face"
  | "inconsistent-winding"
  | "unsupported-builder"

export interface GeometryDiagnostic {
  code: GeometryDiagnosticCode
  message: string
}

export interface BuilderContext {
  allocateId(namespace: string): string
}

export interface SolidBuildResult {
  primitives: PrimitiveSpec[]
  vertexIds: string[]
  edgeIds: string[]
  faceIds: string[]
  polyhedronId?: string
  diagnostics: GeometryDiagnostic[]
}

export interface SolidBuilder<Input = unknown> {
  id: string
  label: string
  create(input: Input, context: BuilderContext): SolidBuildResult
}

export interface PrismInput {
  base: Vector3[]
  vector: Vector3
}

export interface FrustumInput {
  bottom: Vector3[]
  top: Vector3[]
}

export interface FromPointsInput {
  vertices: Vector3[]
  faces: number[][]
}

export interface CubeInput {
  origin: Vector3
  size: Vector3
}

export interface PyramidInput {
  baseCenter: Vector3
  baseSize: { x: number; y: number }
  height: number
}

export interface RoundSolidInput {
  center: Vector3
  radius: number
  height: number
  segments: number
}

export type TemplateSolidPrimitive = CubePrimitive | PyramidPrimitive | CylinderPrimitive | ConePrimitive

/**
 * The point a template solid turns about: its box centre, or the midpoint of its axis.
 *
 * 导出给 `scene-graph` 的拖动旋转用：属主中心只有这一处定义，两边各写一份就会"拖的时候绕一点、画的时候绕另一点"。
 */
export function templateSolidPivot(primitive: TemplateSolidPrimitive): Vector3 {
  if (primitive.type === "cube") return { x: primitive.origin.x + primitive.size.x / 2, y: primitive.origin.y + primitive.size.y / 2, z: primitive.origin.z + primitive.size.z / 2 }
  if (primitive.type === "pyramid") return { x: primitive.baseCenter.x, y: primitive.baseCenter.y, z: primitive.baseCenter.z + primitive.height / 2 }
  return { x: primitive.center.x, y: primitive.center.y, z: primitive.center.z + primitive.height / 2 }
}

/** Euler rotation applied X then Y then Z around a pivot. A proper rotation keeps the winding and volume valid. */
export function rotateAboutPivot(position: Vector3, pivot: Vector3, rotation: Vector3): Vector3 {
  const x = position.x - pivot.x
  const y = position.y - pivot.y
  const z = position.z - pivot.z
  const y1 = y * Math.cos(rotation.x) - z * Math.sin(rotation.x)
  const z1 = y * Math.sin(rotation.x) + z * Math.cos(rotation.x)
  const x2 = x * Math.cos(rotation.y) + z1 * Math.sin(rotation.y)
  const z2 = -x * Math.sin(rotation.y) + z1 * Math.cos(rotation.y)
  return {
    x: x2 * Math.cos(rotation.z) - y1 * Math.sin(rotation.z) + pivot.x,
    y: x2 * Math.sin(rotation.z) + y1 * Math.cos(rotation.z) + pivot.y,
    z: z2 + pivot.z
  }
}

function diagnostic(code: GeometryDiagnosticCode, message: string): GeometryDiagnostic {
  return { code, message }
}

function emptyResult(diagnostics: GeometryDiagnostic[]): SolidBuildResult {
  return { primitives: [], vertexIds: [], edgeIds: [], faceIds: [], diagnostics }
}

function isFiniteVector(vector: unknown): vector is Vector3 {
  return Boolean(vector && typeof vector === "object" && Number.isFinite((vector as Vector3).x) && Number.isFinite((vector as Vector3).y) && Number.isFinite((vector as Vector3).z))
}

function isNonZeroVector(vector: unknown): vector is Vector3 {
  return isFiniteVector(vector) && (vector.x !== 0 || vector.y !== 0 || vector.z !== 0)
}

function hasDistinctPositions(points: Vector3[]): boolean {
  return new Set(points.map((point) => [point.x, point.y, point.z].join(","))).size === points.length
}

function hasNonZeroArea(points: Vector3[]): boolean {
  if (points.length < 3) return false
  const first = points[0]
  for (let secondIndex = 1; secondIndex < points.length; secondIndex += 1) {
    for (let thirdIndex = secondIndex + 1; thirdIndex < points.length; thirdIndex += 1) {
      if (isNonZeroVector(crossVector3(subtractVector3(points[secondIndex], first), subtractVector3(points[thirdIndex], first)))) return true
    }
  }
  return false
}

function pointPrimitive(id: string, position: Vector3): Extract<PrimitiveSpec, { type: "point3" }> {
  return { id, type: "point3", position, binding: { kind: "free" } }
}

function edgeKey(firstIndex: number, secondIndex: number): string {
  return [Math.min(firstIndex, secondIndex), Math.max(firstIndex, secondIndex)].join(":")
}

/**
 * 多边形所在平面的**稳健法向**（未单位化）。
 *
 * 不能只看前三个点：边上多带一个**共线点**的多边形很常见（`(0,0,0),(1,0,0),(2,0,0),…`），
 * 那时 `cross(p1-p0, p2-p0)` 是零向量，投影轴会塌成"丢掉 x 轴"，水平底面于是被压成一条线，
 * 自交判定把它误报成"自交"（评审 I2；`prism.ts` 里同一个修法）。
 */
function polygonNormal(points: Vector3[]): Vector3 {
  for (let second = 1; second < points.length; second += 1) {
    for (let third = second + 1; third < points.length; third += 1) {
      const normal = crossVector3(subtractVector3(points[second], points[0]), subtractVector3(points[third], points[0]))
      if (isNonZeroVector(normal)) return normal
    }
  }
  return { x: 0, y: 0, z: 0 }
}

function projectedFacePoints(points: Vector3[]): Array<{ x: number; y: number }> {
  const normal = polygonNormal(points)
  const absolute = { x: Math.abs(normal.x), y: Math.abs(normal.y), z: Math.abs(normal.z) }
  if (absolute.x > 0 || absolute.y > 0 || absolute.z > 0) {
    if (absolute.x >= absolute.y && absolute.x >= absolute.z) return points.map((point) => ({ x: point.y, y: point.z }))
    if (absolute.y >= absolute.z) return points.map((point) => ({ x: point.x, y: point.z }))
    return points.map((point) => ({ x: point.x, y: point.y }))
  }
  // 法向退化（全部共线）时按最大坐标跨度选视图，绝不把多边形压成一条线。
  const spread = points.reduce((span, point) => ({
    x: Math.max(span.x, Math.abs(point.x)),
    y: Math.max(span.y, Math.abs(point.y)),
    z: Math.max(span.z, Math.abs(point.z))
  }), { x: 0, y: 0, z: 0 })
  if (spread.x <= spread.y && spread.x <= spread.z) return points.map((point) => ({ x: point.y, y: point.z }))
  if (spread.y <= spread.z) return points.map((point) => ({ x: point.x, y: point.z }))
  return points.map((point) => ({ x: point.x, y: point.y }))
}

function orientation(first: { x: number; y: number }, second: { x: number; y: number }, third: { x: number; y: number }): number {
  return (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x)
}

function onSegment(first: { x: number; y: number }, second: { x: number; y: number }, point: { x: number; y: number }): boolean {
  return Math.min(first.x, second.x) <= point.x && point.x <= Math.max(first.x, second.x) && Math.min(first.y, second.y) <= point.y && point.y <= Math.max(first.y, second.y)
}

function segmentsIntersect(firstStart: { x: number; y: number }, firstEnd: { x: number; y: number }, secondStart: { x: number; y: number }, secondEnd: { x: number; y: number }): boolean {
  const firstOrientation = orientation(firstStart, firstEnd, secondStart)
  const secondOrientation = orientation(firstStart, firstEnd, secondEnd)
  const thirdOrientation = orientation(secondStart, secondEnd, firstStart)
  const fourthOrientation = orientation(secondStart, secondEnd, firstEnd)
  if ((firstOrientation > 0 && secondOrientation < 0 || firstOrientation < 0 && secondOrientation > 0) && (thirdOrientation > 0 && fourthOrientation < 0 || thirdOrientation < 0 && fourthOrientation > 0)) return true
  return firstOrientation === 0 && onSegment(firstStart, firstEnd, secondStart) || secondOrientation === 0 && onSegment(firstStart, firstEnd, secondEnd) || thirdOrientation === 0 && onSegment(secondStart, secondEnd, firstStart) || fourthOrientation === 0 && onSegment(secondStart, secondEnd, firstEnd)
}

function hasSelfIntersectingPolygon(points: Vector3[]): boolean {
  if (points.length < 4) return false
  const projected = projectedFacePoints(points)
  for (let firstIndex = 0; firstIndex < projected.length; firstIndex += 1) {
    const firstNextIndex = (firstIndex + 1) % projected.length
    for (let secondIndex = firstIndex + 1; secondIndex < projected.length; secondIndex += 1) {
      const secondNextIndex = (secondIndex + 1) % projected.length
      if (firstIndex === secondIndex || firstNextIndex === secondIndex || secondNextIndex === firstIndex) continue
      if (segmentsIntersect(projected[firstIndex], projected[firstNextIndex], projected[secondIndex], projected[secondNextIndex])) return true
    }
  }
  return false
}

function hasNonZeroVolume(vertices: Vector3[], faces: number[][]): boolean {
  const origin = vertices[0]
  let volume = 0
  let scale = 0
  const localVertices = vertices.map((vertex) => ({ x: vertex.x - origin.x, y: vertex.y - origin.y, z: vertex.z - origin.z }))
  for (const vertex of localVertices) scale = Math.max(scale, Math.abs(vertex.x), Math.abs(vertex.y), Math.abs(vertex.z))
  for (const face of faces) {
    const first = localVertices[face[0]]
    for (let index = 1; index < face.length - 1; index += 1) volume += (first.x * (localVertices[face[index]].y * localVertices[face[index + 1]].z - localVertices[face[index]].z * localVertices[face[index + 1]].y) - first.y * (localVertices[face[index]].x * localVertices[face[index + 1]].z - localVertices[face[index]].z * localVertices[face[index + 1]].x) + first.z * (localVertices[face[index]].x * localVertices[face[index + 1]].y - localVertices[face[index]].y * localVertices[face[index + 1]].x)) / 6
  }
  return scale > 0 && Math.abs(volume) > scale ** 3 * 1e-12
}

function createSolidFromIndexedFaces(vertices: Vector3[], faces: number[][], context: BuilderContext): SolidBuildResult {
  const points = vertices.map((position) => ({ id: context.allocateId("point"), position }))
  const vertexIds = points.map((point) => point.id)
  const edgeIndexes = new Map<string, { first: number; second: number }>()
  const faceEdgeKeys: string[][] = []
  for (const face of faces) {
    const keys: string[] = []
    for (let index = 0; index < face.length; index += 1) {
      const first = face[index]
      const second = face[(index + 1) % face.length]
      const key = edgeKey(first, second)
      keys.push(key)
      if (!edgeIndexes.has(key)) edgeIndexes.set(key, { first, second })
    }
    faceEdgeKeys.push(keys)
  }
  const faceIds = faces.map(() => context.allocateId("face"))
  const edgeIds = [...edgeIndexes.keys()].map(() => context.allocateId("edge"))
  const edgeIdByKey = new Map([...edgeIndexes.keys()].map((key, index) => [key, edgeIds[index]]))
  const edgeFaces = new Map<string, string[]>()
  for (let faceIndex = 0; faceIndex < faceEdgeKeys.length; faceIndex += 1) {
    for (const key of faceEdgeKeys[faceIndex]) {
      const owners = edgeFaces.get(key) ?? []
      owners.push(faceIds[faceIndex])
      edgeFaces.set(key, owners)
    }
  }
  const edges = [...edgeIndexes.entries()].map(([key, edge]) => ({
    id: edgeIdByKey.get(key) as string,
    type: "edge3" as const,
    pointIds: [vertexIds[edge.first], vertexIds[edge.second]] as [string, string],
    faceIds: edgeFaces.get(key) ?? []
  }))
  const renderedFaces = faces.map((pointIndexes, faceIndex) => ({
    id: faceIds[faceIndex],
    type: "face3" as const,
    pointIds: pointIndexes.map((pointIndex) => vertexIds[pointIndex]),
    edgeIds: faceEdgeKeys[faceIndex].map((key) => edgeIdByKey.get(key) as string)
  }))
  const polyhedronId = context.allocateId("polyhedron")
  const polyhedron = {
    id: polyhedronId,
    type: "polyhedron3" as const,
    vertexIds,
    edgeIds,
    faceIds,
    construction: { kind: "fromPoints" as const, sourceIds: vertexIds }
  }
  return { primitives: [...points.map((point) => pointPrimitive(point.id, point.position)), ...edges, ...renderedFaces, polyhedron], vertexIds, edgeIds, faceIds, polyhedronId, diagnostics: [] }
}

export function createBuilderContext(prefix = "solid"): BuilderContext {
  let sequence = 0
  return {
    allocateId(namespace) {
      sequence += 1
      return [prefix, namespace, sequence].join("-")
    }
  }
}

export function buildFromPoints(input: FromPointsInput, context: BuilderContext): SolidBuildResult {
  const diagnostics: GeometryDiagnostic[] = []
  if (!Array.isArray(input?.vertices) || input.vertices.length < 4 || input.vertices.some((vertex) => !isFiniteVector(vertex)) || !hasDistinctPositions(input.vertices)) diagnostics.push(diagnostic("invalid-input", "vertices must be distinct finite points"))
  if (!Array.isArray(input?.faces) || input.faces.length < 4) diagnostics.push(diagnostic("missing-face-rings", "a solid requires at least four explicit face rings"))
  if (diagnostics.length > 0) return emptyResult(diagnostics)
  for (const face of input.faces) {
    if (!Array.isArray(face) || face.length < 3 || new Set(face).size !== face.length || face.some((index) => !Number.isInteger(index) || index < 0 || index >= input.vertices.length)) {
      diagnostics.push(diagnostic("invalid-input", "face rings must contain distinct vertex indexes"))
      continue
    }
    const points = face.map((index) => input.vertices[index])
    if (!hasNonZeroArea(points)) diagnostics.push(diagnostic("degenerate-base", "face rings must have non-zero area"))
    else if (points.length >= 4 && !areCoplanar(points)) diagnostics.push(diagnostic("non-planar-base", "polygon face vertices must be coplanar"))
    else if (hasSelfIntersectingPolygon(points)) diagnostics.push(diagnostic("self-intersection", "face rings must not self-intersect"))
  }
  if (diagnostics.length > 0) return emptyResult(diagnostics)
  if (areCoplanar(input.vertices)) diagnostics.push(diagnostic("degenerate-volume", "solid vertices must not be coplanar"))
  const usedVertices = new Set<number>()
  const edgeOwners = new Map<string, number>()
  const edgeDirections = new Map<string, Array<[number, number]>>()
  const faceKeys = new Set<string>()
  const adjacency = input.vertices.map(() => new Set<number>())
  for (const face of input.faces) {
    const faceKey = [...face].sort((first, second) => first - second).join(":")
    if (faceKeys.has(faceKey)) diagnostics.push(diagnostic("duplicate-face", "face rings must be unique"))
    faceKeys.add(faceKey)
    for (const vertexIndex of face) usedVertices.add(vertexIndex)
    for (let index = 0; index < face.length; index += 1) {
      const first = face[index]
      const second = face[(index + 1) % face.length]
      const key = edgeKey(first, second)
      edgeOwners.set(key, (edgeOwners.get(key) ?? 0) + 1)
      const directions = edgeDirections.get(key) ?? []
      directions.push([first, second])
      edgeDirections.set(key, directions)
      adjacency[first].add(second)
      adjacency[second].add(first)
    }
  }
  if (usedVertices.size !== input.vertices.length) diagnostics.push(diagnostic("unused-vertex", "every vertex must belong to at least one face"))
  if ([...edgeOwners.values()].some((ownerCount) => ownerCount !== 2)) diagnostics.push(diagnostic("open-boundary", "every solid edge must belong to exactly two face rings"))
  for (const directions of edgeDirections.values()) if (directions.length === 2 && directions[0][0] === directions[1][0] && directions[0][1] === directions[1][1]) diagnostics.push(diagnostic("inconsistent-winding", "adjacent faces must orient shared edges in opposite directions"))
  const visited = new Set<number>()
  const pending = input.vertices.length > 0 ? [0] : []
  while (pending.length > 0) {
    const vertexIndex = pending.pop()
    if (vertexIndex === undefined || visited.has(vertexIndex)) continue
    visited.add(vertexIndex)
    for (const neighbor of adjacency[vertexIndex]) if (!visited.has(neighbor)) pending.push(neighbor)
  }
  if (visited.size !== input.vertices.length) diagnostics.push(diagnostic("disconnected-topology", "solid topology must be connected"))
  if (!hasNonZeroVolume(input.vertices, input.faces)) diagnostics.push(diagnostic("degenerate-volume", "solid topology must enclose non-zero volume"))
  if (diagnostics.length > 0) return emptyResult(diagnostics)
  return createSolidFromIndexedFaces(input.vertices, input.faces, context)
}

export function buildPrism(input: PrismInput, context: BuilderContext): SolidBuildResult {
  const diagnostics: GeometryDiagnostic[] = []
  if (!Array.isArray(input?.base) || input.base.length < 3 || input.base.some((point) => !isFiniteVector(point)) || !hasDistinctPositions(input.base) || !hasNonZeroArea(input.base)) diagnostics.push(diagnostic("degenerate-base", "prism base must contain distinct finite points with non-zero area"))
  if (!isNonZeroVector(input?.vector)) diagnostics.push(diagnostic("degenerate-vector", "prism vector must be finite and non-zero"))
  if (diagnostics.length > 0) return emptyResult(diagnostics)
  /**
   * **底面先按拉伸方向规范化成"从 vector 方向看逆时针"**（外部审查 M3）。
   *
   * 下面那套环（底面反向、顶面同向、侧面 `[i, i+1, i'+1, i']`）默认底面是这么给的。
   * 顺时针的底面会让**每一个面的法向都朝内** —— 而且是**一致地**朝内，于是
   * `inconsistent-winding`（只判"彼此是否一致"）与"体积非零"（只看 `|volume|`）两道判据
   * 都不会响：`buildPrism` 就这么静默吐出一只里外翻转的实体（实测有符号体积 **−72**）。
   * 同一个包里两个导出的棱柱构造器不该对同一份输入给出相反的朝向 ——
   * `buildPrismTopology` 对同一输入会正常化（它逐个面按"面心相对形心朝外"定向）。
   */
  const ordered = baseOrderedAlongVector(input.base, input.vector)
  const top = ordered.map((point) => ({ x: point.x + input.vector.x, y: point.y + input.vector.y, z: point.z + input.vector.z }))
  const baseCount = ordered.length
  const faces = [Array.from({ length: baseCount }, (_, index) => baseCount - 1 - index), Array.from({ length: baseCount }, (_, index) => baseCount + index)]
  for (let index = 0; index < baseCount; index += 1) faces.push([index, (index + 1) % baseCount, baseCount + ((index + 1) % baseCount), baseCount + index])
  return buildFromPoints({ vertices: [...ordered, ...top], faces }, context)
}

/**
 * 底面按拉伸方向规范化成"从 `vector` 方向看逆时针"；已经是的话原样返回一份。
 *
 * 法向用**整个环**的 Newell（不看头三个点 —— `prism.ts` 的 `facesOutwards` 正是在那上面栽过：
 * 前三点点共线时叉积是零向量，于是朝向被判反）。
 */
function baseOrderedAlongVector(base: readonly Vector3[], vector: Vector3): Vector3[] {
  let normal = { x: 0, y: 0, z: 0 }
  for (let index = 0; index < base.length; index += 1) {
    const current = base[index]
    const next = base[(index + 1) % base.length]
    normal = {
      x: normal.x + (current.y - next.y) * (current.z + next.z),
      y: normal.y + (current.z - next.z) * (current.x + next.x),
      z: normal.z + (current.x - next.x) * (current.y + next.y)
    }
  }
  const along = normal.x * vector.x + normal.y * vector.y + normal.z * vector.z
  // `along === 0`（底面与拉伸方向平行）保持原序：那是一只零体积的"平片"，
  // 由 `buildFromPoints` 的 `degenerate-volume` 拒绝，不该在这里被悄悄换个绕向。
  return along >= 0 ? [...base] : [...base].reverse()
}

export function buildFrustum(input: FrustumInput, context: BuilderContext): SolidBuildResult {
  if (!Array.isArray(input?.bottom) || !Array.isArray(input?.top) || input.bottom.length !== input.top.length || input.bottom.length < 3) return emptyResult([diagnostic("invalid-input", "frustum rings must have the same number of vertices")])
  const baseCount = input.bottom.length
  const faces = [Array.from({ length: baseCount }, (_, index) => baseCount - 1 - index), Array.from({ length: baseCount }, (_, index) => baseCount + index)]
  for (let index = 0; index < baseCount; index += 1) faces.push([index, (index + 1) % baseCount, baseCount + ((index + 1) % baseCount), baseCount + index])
  return buildFromPoints({ vertices: [...input.bottom, ...input.top], faces }, context)
}

function buildCube(input: CubeInput, context: BuilderContext): SolidBuildResult {
  if (!input || !isFiniteVector(input.origin) || !isFiniteVector(input.size) || input.size.x <= 0 || input.size.y <= 0 || input.size.z <= 0) return emptyResult([diagnostic("invalid-input", "cube parameters are invalid")])
  const { origin, size } = input
  const base = [{ x: origin.x, y: origin.y, z: origin.z }, { x: origin.x + size.x, y: origin.y, z: origin.z }, { x: origin.x + size.x, y: origin.y + size.y, z: origin.z }, { x: origin.x, y: origin.y + size.y, z: origin.z }]
  return buildPrism({ base, vector: { x: 0, y: 0, z: size.z } }, context)
}

function buildPyramid(input: PyramidInput, context: BuilderContext): SolidBuildResult {
  if (!input || !isFiniteVector(input.baseCenter) || !input.baseSize || !Number.isFinite(input.baseSize.x) || !Number.isFinite(input.baseSize.y) || input.baseSize.x <= 0 || input.baseSize.y <= 0 || !Number.isFinite(input.height) || input.height <= 0) return emptyResult([diagnostic("invalid-input", "pyramid parameters are invalid")])
  const halfX = input.baseSize.x / 2
  const halfY = input.baseSize.y / 2
  const base = [
    { x: input.baseCenter.x - halfX, y: input.baseCenter.y - halfY, z: input.baseCenter.z },
    { x: input.baseCenter.x + halfX, y: input.baseCenter.y - halfY, z: input.baseCenter.z },
    { x: input.baseCenter.x + halfX, y: input.baseCenter.y + halfY, z: input.baseCenter.z },
    { x: input.baseCenter.x - halfX, y: input.baseCenter.y + halfY, z: input.baseCenter.z }
  ]
  const apex = { x: input.baseCenter.x, y: input.baseCenter.y, z: input.baseCenter.z + input.height }
  return buildFromPoints({ vertices: [...base, apex], faces: [[3, 2, 1, 0], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]] }, context)
}

/**
 * **正四面体**的输入：底面（等边三角形）中心 + 棱长。
 *
 * 为什么它是内核的一等构造器，而不是"棱锥换个三角形底"：`buildPyramid` 的底面是**矩形**
 * （`baseSize.x/y`），`buildPrism` 的顶面是底面的**平移副本** —— 两者都表达不出"四个顶点、
 * 六条等长棱、四个三角面"这个形状。而用户会直接要它（"画一个正四面体 ABCD，棱长为 3"），
 * 动作层没有对应动作时，模型只能拿最接近的**冒充**（用户现场：正四面体被做成了三棱柱）。
 */
export interface TetrahedronInput {
  /** 底面（等边三角形）的中心。 */
  baseCenter: Vector3
  /** 棱长。 */
  edge: number
}

/**
 * 正四面体的**几何本身**（棱长 `a`）：
 *
 * - 底面是等边三角形，外接圆半径 `R = a / √3`，三个顶点按 0° / 120° / 240° 均匀取；
 * - 第四个顶点在底面中心正上方，高 `h = a · √(2/3)`（正四面体的高）。
 *
 * 于是**任意两个顶点的距离都等于 `a`** —— 这一点由用例把 6 条棱逐对量过，而不是靠"看起来对称"。
 *
 * 返回 `null` 表示输入不合法（底面中心不是有限向量，或棱长不是正的有限数）。
 */
export function regularTetrahedronShape(input: TetrahedronInput): { vertices: Vector3[]; faces: number[][] } | null {
  if (!input || !isFiniteVector(input.baseCenter) || !Number.isFinite(input.edge) || input.edge <= 0) return null
  const radius = input.edge / Math.sqrt(3)
  const height = input.edge * Math.sqrt(2 / 3)
  const { x, y, z } = input.baseCenter
  return {
    vertices: [
      { x: x + radius, y, z },
      { x: x - radius / 2, y: y + (radius * Math.sqrt(3)) / 2, z },
      { x: x - radius / 2, y: y - (radius * Math.sqrt(3)) / 2, z },
      { x, y, z: z + height }
    ],
    /**
     * 面环的绕向与 `buildPyramid` 同一口径：底面 `[2, 1, 0]` 从外侧看是顺时针（法向朝下），
     * 三个侧面按底面环的顺序接第四点（`[i, i+1, 3]`）。
     */
    faces: [[2, 1, 0], [0, 1, 3], [1, 2, 3], [2, 0, 3]]
  }
}

function buildTetrahedron(input: TetrahedronInput, context: BuilderContext): SolidBuildResult {
  const shape = regularTetrahedronShape(input)
  if (!shape) return emptyResult([diagnostic("invalid-input", "tetrahedron parameters are invalid: the base center must be finite and the edge length a positive finite number")])
  // 顶点/棱/面的编号、共面性、非零体积、自交这些校验都由既有的 `buildFromPoints` 负责。
  return buildFromPoints(shape, context)
}

function buildCylinder(input: RoundSolidInput, context: BuilderContext): SolidBuildResult {
  const bottom = Array.from({ length: input.segments }, (_, index) => {
    const angle = index * Math.PI * 2 / input.segments
    return { x: input.center.x + input.radius * Math.cos(angle), y: input.center.y + input.radius * Math.sin(angle), z: input.center.z }
  })
  return buildPrism({ base: bottom, vector: { x: 0, y: 0, z: input.height } }, context)
}

function buildCone(input: RoundSolidInput, context: BuilderContext): SolidBuildResult {
  const base = Array.from({ length: input.segments }, (_, index) => {
    const angle = index * Math.PI * 2 / input.segments
    return { x: input.center.x + input.radius * Math.cos(angle), y: input.center.y + input.radius * Math.sin(angle), z: input.center.z }
  })
  const apex = { x: input.center.x, y: input.center.y, z: input.center.z + input.height }
  const faces: number[][] = [Array.from({ length: input.segments }, (_, index) => input.segments - 1 - index)]
  for (let index = 0; index < input.segments; index += 1) faces.push([index, (index + 1) % input.segments, input.segments])
  return buildFromPoints({ vertices: [...base, apex], faces }, context)
}

/**
 * 圆近似分段数的上限。
 *
 * 与 DSL schema 的 `<type> geometry is invalid`（3..256）保持一致：内核是公开 API，
 * 只卡下界会让 `buildSolid("cylinder", { segments: 1e9 })` 去分配十亿个顶点——浏览器直接卡死。
 */
export const MAX_SOLID_SEGMENTS = 256

const solidBuilders = new Map<string, SolidBuilder<unknown>>([
  ["prism", { id: "prism", label: "棱柱", create: (input, context) => buildPrism(input as PrismInput, context) }],
  ["frustum", { id: "frustum", label: "棱台", create: (input, context) => buildFrustum(input as FrustumInput, context) }],
  ["fromPoints", { id: "fromPoints", label: "点集构造多面体", create: (input, context) => buildFromPoints(input as FromPointsInput, context) }],
  ["cube", { id: "cube", label: "立方体", create: (input, context) => buildCube(input as CubeInput, context) }],
  ["pyramid", { id: "pyramid", label: "棱锥", create: (input, context) => buildPyramid(input as PyramidInput, context) }],
  ["tetrahedron", { id: "tetrahedron", label: "正四面体", create: (input, context) => buildTetrahedron(input as TetrahedronInput, context) }],
  ["cylinder", { id: "cylinder", label: "圆柱近似", create: (input, context) => {
    const roundInput = input as RoundSolidInput
    if (!roundInput || !Number.isInteger(roundInput.segments) || roundInput.segments < 3 || roundInput.segments > MAX_SOLID_SEGMENTS || !isFiniteVector(roundInput.center) || !Number.isFinite(roundInput.radius) || roundInput.radius <= 0 || !Number.isFinite(roundInput.height) || roundInput.height <= 0) return emptyResult([diagnostic("invalid-input", `cylinder parameters are invalid (segments must be an integer in 3..${MAX_SOLID_SEGMENTS})`)])
    return buildCylinder(roundInput, context)
  } }],
  ["cone", { id: "cone", label: "圆锥近似", create: (input, context) => {
    const roundInput = input as RoundSolidInput
    if (!roundInput || !Number.isInteger(roundInput.segments) || roundInput.segments < 3 || roundInput.segments > MAX_SOLID_SEGMENTS || !isFiniteVector(roundInput.center) || !Number.isFinite(roundInput.radius) || roundInput.radius <= 0 || !Number.isFinite(roundInput.height) || roundInput.height <= 0) return emptyResult([diagnostic("invalid-input", `cone parameters are invalid (segments must be an integer in 3..${MAX_SOLID_SEGMENTS})`)])
    return buildCone(roundInput, context)
  } }]
])

export function registerSolidBuilder(builder: SolidBuilder<unknown>): boolean {
  if (!builder || typeof builder.id !== "string" || !builder.id.trim() || typeof builder.label !== "string" || !builder.label.trim() || typeof builder.create !== "function") return false
  solidBuilders.set(builder.id, builder)
  return true
}

export function listSolidBuilders(): string[] {
  return [...solidBuilders.keys()]
}

export function buildSolid(builderId: string, input: unknown, context: BuilderContext): SolidBuildResult {
  const builder = solidBuilders.get(builderId)
  if (!builder) return emptyResult([diagnostic("unsupported-builder", "unknown solid builder: " + builderId)])
  try {
    return builder.create(input, context)
  } catch (error) {
    /**
     * 输入不合法与**构造器内部崩溃**必须区分：`catch {}` 只说"输入不合法"会把我们自己的 bug
     * 伪装成用户的问题（实测：任何一个 builder 内部抛错都得到同一句话）。原始消息如实带上。
     */
    const reason = error instanceof Error ? error.message : String(error)
    return emptyResult([diagnostic("invalid-input", `solid builder failed to create valid geometry: ${reason}`)])
  }
}

function templateInput(primitive: TemplateSolidPrimitive): CubeInput | PyramidInput | RoundSolidInput {
  if (primitive.type === "cube") return { origin: primitive.origin, size: primitive.size }
  if (primitive.type === "pyramid") return { baseCenter: primitive.baseCenter, baseSize: primitive.baseSize, height: primitive.height }
  return { center: primitive.center, radius: primitive.radius, height: primitive.height, segments: primitive.segments }
}

/**
 * 模板顶点的**自动标签**：A…Z 之后接 P27、P28……
 *
 * 导出是因为"这个标签是自动生成的还是用户改过的"必须能判断：旧文档迁移时只有自动标签才允许重编
 *（见 `apps/web/src/solidTemplates.ts`），否则会把用户自己起的名字覆盖掉。
 */
export function templatePointLabel(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : `P${index + 1}`
}

/** 模板棱的自动标签（`棱 1` 起）。与 `templatePointLabel` 同理：迁移靠它区分自动标签与用户改名。 */
export function templateEdgeLabel(index: number): string {
  return `棱 ${index + 1}`
}

/**
 * **棱柱**子对象的自动标签（Fix round 2 / M5）。
 *
 * 为什么与模板分开：`templatePointLabel` 的 `A…Z` 是**模板迁移**的判据
 * （`solidTemplates.ts` 的 `realignTemplateChildren` 按它决定"这个名字是不是自动生成的，
 * 可以跟着新拓扑重编"）。棱柱的标签如果长得一模一样，两族对象在文档里就分不出来，
 * 将来哪一边改迁移规则都会误伤另一边。棱柱给 `P1…` 与 `棱柱棱 1…`，与模板的 `A…` / `棱 1…` 明确区分。
 */
export function prismPointLabel(index: number): string {
  return `P${index + 1}`
}

/** 棱柱子对象的棱标签：见 `prismPointLabel`。 */
export function prismEdgeLabel(index: number): string {
  return `棱柱棱 ${index + 1}`
}

/**
 * 圆类实体近似的**可见象限点**：每个圆环只留 4 个离 0° / 90° / 180° / 270° 最近的、互不相同的顶点。
 *
 * 用户要求："立体里的圆相关的内容不要这么多标点啊，只需要四个点就够了。"
 * `segments` 是 4 的倍数时就是**精确象限点**（48 段 → 0 / 12 / 24 / 36）；否则取最近的互异顶点，
 * 顶点数不足 4（三角形近似）时如实返回更少的点，不凑数。返回值按顶点序升序（标签顺序因此是环序）。
 */
export function quadrantVertexIndices(count: number, quadrantCount = 4): number[] {
  if (!Number.isInteger(count) || count < 3 || quadrantCount < 1) return []
  const indices: number[] = []
  for (let quadrant = 0; quadrant < quadrantCount; quadrant += 1) {
    const index = Math.round((quadrant * count) / quadrantCount) % count
    if (!indices.includes(index)) indices.push(index)
  }
  return indices.sort((first, second) => first - second)
}

/**
 * 圆类实体的**内部拓扑**：细分顶点（除象限点）与**母线**。
 *
 * 用户口径：①"圆相关的内容不要这么多标点，只需要四个点就够了"；②"有太多母线，用不上这些"。
 * 因此这两类对象只留在文档里（面 / 棱 / 交线 / 布尔交集都要读坐标），但不展示、不列出、点不到。
 * 判定按顶点 / 棱在物化序列里的位置做，纯函数、可单测；非圆类实体返回 `null`（全部可见）。
 */
export function roundSolidHiddenTopology(
  primitive: TemplateSolidPrimitive,
  vertexIds: readonly string[],
  edges: readonly { id: string; pointIds: readonly string[] }[]
): { hiddenVertexIds: ReadonlySet<string>; hiddenEdgeIds: ReadonlySet<string> } | null {
  if (primitive.type !== "cylinder" && primitive.type !== "cone") return null
  const segments = primitive.segments
  /** 物化顺序：[下底环, 上底环（仅圆柱）, 圆锥顶点]；只有环上的细分点会被隐藏，顶点永远可见。 */
  const ringCount = primitive.type === "cylinder" ? segments * 2 : segments
  /** 环内序号 → 是否象限点：上下两个环共用同一套象限序号（`index % segments`）。 */
  const quadrantOffsets = new Set(quadrantVertexIndices(segments))
  const hiddenVertexIds = new Set(
    vertexIds.filter((_, index) => index < ringCount && !quadrantOffsets.has(index % segments))
  )
  const indexOf = new Map(vertexIds.map((id, index) => [id, index]))
  const hiddenEdgeIds = new Set<string>()
  for (const edge of edges) {
    const first = indexOf.get(edge.pointIds[0] ?? "")
    const second = indexOf.get(edge.pointIds[1] ?? "")
    if (first === undefined || second === undefined) continue
    /**
     * 母线：圆柱是连接上下底的棱（一个端点在下底索引区间、另一个在上底），
     * 圆锥是连接底面与顶点的棱。**两环自身的棱保留**——它们在屏幕上就是那两个圆。
     */
    const isGeneratrix = primitive.type === "cone"
      ? first === segments || second === segments
      : (first < segments) !== (second < segments)
    if (isGeneratrix) hiddenEdgeIds.add(edge.id)
  }
  return { hiddenVertexIds, hiddenEdgeIds }
}

export function buildSolidTemplate(primitive: TemplateSolidPrimitive, context: BuilderContext = createBuilderContext(primitive.id)): SolidBuildResult {
  const result = buildSolid(primitive.type, templateInput(primitive), context)
  if (result.diagnostics.length > 0) return result
  const topologyIds = new Set([...result.vertexIds, ...result.edgeIds, ...result.faceIds, ...(result.polyhedronId ? [result.polyhedronId] : [])])
  // Orientation is applied to the finished vertices: one place covers all four templates, and a rigid
  // rotation cannot invalidate the topology that was just validated.
  const rotation = primitive.rotation
  const pivot = rotation ? templateSolidPivot(primitive) : null
  const rawEdges = result.primitives.filter((candidate): candidate is Extract<PrimitiveSpec, { type: "edge3" }> => candidate.type === "edge3").map((candidate) => ({ id: candidate.id, pointIds: candidate.pointIds }))
  const hidden = roundSolidHiddenTopology(primitive, result.vertexIds, rawEdges)
  const hiddenPoint = (id: string) => hidden?.hiddenVertexIds.has(id) ?? false
  const hiddenEdge = (id: string) => hidden?.hiddenEdgeIds.has(id) ?? false
  /** 标签只发给可见对象，并按**可见顺序**重新编号：圆柱顶点 A–H、棱 1–96（两环），圆锥顶点 A–E。 */
  const visiblePointIndex = new Map(result.vertexIds.filter((id) => !hiddenPoint(id)).map((id, index) => [id, index]))
  const visibleEdgeIndex = new Map(result.edgeIds.filter((id) => !hiddenEdge(id)).map((id, index) => [id, index]))
  const primitives = result.primitives.map((candidate) => {
    if (!topologyIds.has(candidate.id)) return candidate
    if (candidate.type === "point3") {
      const position = rotation && pivot ? rotateAboutPivot(candidate.position, pivot, rotation) : candidate.position
      const labelIndex = visiblePointIndex.get(candidate.id)
      if (labelIndex === undefined) return { ...candidate, position, style: primitive.style, tessellation: true, label: undefined }
      return { ...candidate, position, label: templatePointLabel(labelIndex), style: primitive.style }
    }
    if (candidate.type === "edge3") {
      const labelIndex = visibleEdgeIndex.get(candidate.id)
      if (labelIndex === undefined) return { ...candidate, style: primitive.style, tessellation: true, label: undefined }
      return { ...candidate, label: templateEdgeLabel(labelIndex), style: primitive.style }
    }
    if (candidate.type === "face3") return { ...candidate, label: `面 ${result.faceIds.indexOf(candidate.id) + 1}`, style: primitive.style }
    if (candidate.type === "polyhedron3") return { ...candidate, label: primitive.label, style: primitive.style, construction: { kind: "template" as const, templateId: primitive.type, sourceIds: [primitive.id, ...result.vertexIds, ...result.edgeIds, ...result.faceIds] } }
    return candidate
  })
  return { ...result, primitives }
}
