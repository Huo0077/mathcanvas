import type { PrimitiveSpec } from "@draw/dsl"

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

function projectedFacePoints(points: Vector3[]): Array<{ x: number; y: number }> {
  const normal = crossVector3(subtractVector3(points[1], points[0]), subtractVector3(points[2], points[0]))
  const absolute = { x: Math.abs(normal.x), y: Math.abs(normal.y), z: Math.abs(normal.z) }
  if (absolute.x >= absolute.y && absolute.x >= absolute.z) return points.map((point) => ({ x: point.y, y: point.z }))
  if (absolute.y >= absolute.z) return points.map((point) => ({ x: point.x, y: point.z }))
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
  const top = input.base.map((point) => ({ x: point.x + input.vector.x, y: point.y + input.vector.y, z: point.z + input.vector.z }))
  const baseCount = input.base.length
  const faces = [Array.from({ length: baseCount }, (_, index) => baseCount - 1 - index), Array.from({ length: baseCount }, (_, index) => baseCount + index)]
  for (let index = 0; index < baseCount; index += 1) faces.push([index, (index + 1) % baseCount, baseCount + ((index + 1) % baseCount), baseCount + index])
  return buildFromPoints({ vertices: [...input.base, ...top], faces }, context)
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

const solidBuilders = new Map<string, SolidBuilder<unknown>>([
  ["prism", { id: "prism", label: "棱柱", create: (input, context) => buildPrism(input as PrismInput, context) }],
  ["frustum", { id: "frustum", label: "棱台", create: (input, context) => buildFrustum(input as FrustumInput, context) }],
  ["fromPoints", { id: "fromPoints", label: "点集构造多面体", create: (input, context) => buildFromPoints(input as FromPointsInput, context) }],
  ["cube", { id: "cube", label: "立方体", create: (input, context) => buildCube(input as CubeInput, context) }],
  ["pyramid", { id: "pyramid", label: "棱锥", create: (input, context) => buildPyramid(input as PyramidInput, context) }],
  ["cylinder", { id: "cylinder", label: "圆柱近似", create: (input, context) => {
    const roundInput = input as RoundSolidInput
    if (!roundInput || !Number.isInteger(roundInput.segments) || roundInput.segments < 3 || !isFiniteVector(roundInput.center) || !Number.isFinite(roundInput.radius) || roundInput.radius <= 0 || !Number.isFinite(roundInput.height) || roundInput.height <= 0) return emptyResult([diagnostic("invalid-input", "cylinder parameters are invalid")])
    return buildCylinder(roundInput, context)
  } }],
  ["cone", { id: "cone", label: "圆锥近似", create: (input, context) => {
    const roundInput = input as RoundSolidInput
    if (!roundInput || !Number.isInteger(roundInput.segments) || roundInput.segments < 3 || !isFiniteVector(roundInput.center) || !Number.isFinite(roundInput.radius) || roundInput.radius <= 0 || !Number.isFinite(roundInput.height) || roundInput.height <= 0) return emptyResult([diagnostic("invalid-input", "cone parameters are invalid")])
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
  } catch {
    return emptyResult([diagnostic("invalid-input", "solid builder failed to create valid geometry")])
  }
}
