import type { AnnotationSpec, ConstraintSpec, Coordinate, GeometryDocument, GroupSpec, Measurement3, Point3Binding, Point3Primitive, PointBinding, PrimitiveSpec, Section3Classification, Vector3 } from "@draw/dsl"
import { adaptiveSampleFunctionSegments, buildSolidTemplate, calculateMeasurement3, createBuilderContext, evaluateLineParameters, evaluateParameterExpression, evaluateParameterExpressions, findExtrema, findInflectionPoints, findZeros, intersectCirclesDetailed, intersectLineCircleDetailed, intersectLinesDetailed, intersectSampledPrimitives, numericalDerivative, numericalIntegralWithDiagnostics, numericalSecondDerivative, orderSectionPoints3, sectionConvexPolyhedron, sectionPolyhedron3, solveLineConstraints, type FaceRing3, type IntersectionResult, type SampledPrimitive, type TemplateSolidPrimitive } from "@draw/geometry-kernel"

export type DomainOperation =
  | { op: "addPrimitive"; primitive: PrimitiveSpec }
  | { op: "addPrimitives"; primitives: PrimitiveSpec[] }
  | { op: "updatePrimitive"; id: string; patch: PrimitiveUpdatePatch }
  | { op: "toggleLock"; id: string; locked: boolean }
  | { op: "setParameter"; id: string; value: number }
  | { op: "setParameterExpression"; id: string; expression: string }
  | { op: "addAnnotation"; annotation: AnnotationSpec }
  | { op: "deleteAnnotation"; id: string }
  | { op: "addConstraint"; constraint: ConstraintSpec }
  | { op: "deleteConstraint"; id: string }
  | { op: "addMeasurement"; measurement: Measurement3 }
  | { op: "deleteMeasurement"; id: string }
  | { op: "deleteObject"; id: string }
  | { op: "toggleVisibility"; id: string; visible: boolean }
  | { op: "createGroup"; group: GroupSpec }
  | { op: "deleteGroup"; id: string }
  | { op: "alignPrimitives"; ids: string[]; alignment: Alignment }
  | { op: "setPrimitivesLocked"; ids: string[]; locked: boolean }
  | { op: "setPrimitivesVisible"; ids: string[]; visible: boolean }
  | { op: "translatePrimitive"; id: string; delta: { x: number; y: number } }

export type Alignment = "left" | "right" | "top" | "bottom" | "horizontalCenter" | "verticalCenter"

export interface PrimitiveUpdatePatch {
  x?: number
  y?: number
  binding?: PointBinding
  a?: { x: number; y: number }
  b?: { x: number; y: number }
  center?: { x: number; y: number }
  vertex?: { x: number; y: number }
  radius?: number
  radiusX?: number
  radiusY?: number
  focalParameter?: number
  axis?: "x" | "y"
  startAngle?: number
  endAngle?: number
  points?: { x: number; y: number }[]
  expression?: string
  domain?: [number, number]
  samples?: number
  rotation?: number
  label?: string
  style?: { stroke?: string; fill?: string; strokeWidth?: number; opacity?: number; dash?: string }
  origin3?: Vector3
  size3?: Vector3
  baseCenter3?: Vector3
  baseSize3?: { x: number; y: number }
  center3?: Vector3
  height?: number
  radius3?: number
  segments?: number
  position3?: Vector3
  binding3?: Point3Binding
}

export interface OperationResult {
  document: GeometryDocument
  changed: boolean
  error?: string
}

interface PrimitiveBounds { minX: number; maxX: number; minY: number; maxY: number }

export function createPoint3(id: string, position: Vector3, binding: Point3Binding = { kind: "free" }): Point3Primitive {
  return { id, type: "point3", position: { ...position }, binding }
}

export function createLine3(id: string, pointIds: [string, string]): Extract<PrimitiveSpec, { type: "line3" }> {
  return { id, type: "line3", definition: { kind: "throughPoints", pointIds: [...pointIds] as [string, string] } }
}

export function createFace3(id: string, pointIds: string[], edgeIds?: string[]): Extract<PrimitiveSpec, { type: "face3" }> {
  return { id, type: "face3", pointIds: [...pointIds], ...(edgeIds ? { edgeIds: [...edgeIds] } : {}) }
}

export function createPolyhedron3(id: string, vertexIds: string[], edgeIds: string[], faceIds: string[], construction: Extract<NonNullable<Extract<PrimitiveSpec, { type: "polyhedron3" }>["construction"]>, { kind: "fromPoints" | "fromFaces" }> = { kind: "fromFaces", sourceIds: [...vertexIds, ...edgeIds, ...faceIds] }): Extract<PrimitiveSpec, { type: "polyhedron3" }> {
  return { id, type: "polyhedron3", vertexIds: [...vertexIds], edgeIds: [...edgeIds], faceIds: [...faceIds], construction: { ...construction, sourceIds: [...construction.sourceIds] } }
}

export function patchPoint3(id: string, position: Vector3): Extract<DomainOperation, { op: "updatePrimitive" }> {
  return { op: "updatePrimitive", id, patch: { position3: { ...position } } }
}

function angleOnArc(angle: number, start: number, end: number): boolean {
  const full = Math.PI * 2
  const normalized = (value: number) => (value % full + full) % full
  const delta = end - start
  const direction = delta >= 0 ? 1 : -1
  const span = Math.min(Math.abs(delta), full)
  return normalized(direction * (angle - start)) <= span + 1e-10
}

function primitiveBounds(primitive: PrimitiveSpec): PrimitiveBounds | null {
  if (primitive.type === "point") return { minX: primitive.x, maxX: primitive.x, minY: primitive.y, maxY: primitive.y }
  if (primitive.type === "line" || primitive.type === "segment" || primitive.type === "ray") return {
    minX: Math.min(primitive.a.x, primitive.b.x), maxX: Math.max(primitive.a.x, primitive.b.x),
    minY: Math.min(primitive.a.y, primitive.b.y), maxY: Math.max(primitive.a.y, primitive.b.y)
  }
  if (primitive.type === "circle") return { minX: primitive.center.x - primitive.radius, maxX: primitive.center.x + primitive.radius, minY: primitive.center.y - primitive.radius, maxY: primitive.center.y + primitive.radius }
  if (primitive.type === "arc") {
    const angles = [primitive.startAngle, primitive.endAngle, 0, Math.PI / 2, Math.PI, Math.PI * 1.5].filter((angle) => angle === primitive.startAngle || angle === primitive.endAngle || angleOnArc(angle, primitive.startAngle, primitive.endAngle))
    const points = angles.map((angle) => ({ x: primitive.center.x + primitive.radius * Math.cos(angle), y: primitive.center.y + primitive.radius * Math.sin(angle) }))
    return { minX: Math.min(...points.map((point) => point.x)), maxX: Math.max(...points.map((point) => point.x)), minY: Math.min(...points.map((point) => point.y)), maxY: Math.max(...points.map((point) => point.y)) }
  }
  return null
}

function translatePrimitive(primitive: PrimitiveSpec, x: number, y: number): PrimitiveSpec {
  if (primitive.type === "point") return { ...primitive, x: primitive.x + x, y: primitive.y + y }
  if (primitive.type === "line" || primitive.type === "segment" || primitive.type === "ray") return {
    ...primitive,
    a: { x: primitive.a.x + x, y: primitive.a.y + y },
    b: { x: primitive.b.x + x, y: primitive.b.y + y }
  }
  if (primitive.type === "polyline") return { ...primitive, points: primitive.points.map((point) => ({ x: point.x + x, y: point.y + y })) }
  if (primitive.type === "circle" || primitive.type === "arc") return { ...primitive, center: { x: primitive.center.x + x, y: primitive.center.y + y } }
  if (primitive.type === "parabola") return { ...primitive, vertex: { x: primitive.vertex.x + x, y: primitive.vertex.y + y } }
  if (primitive.type === "ellipse" || primitive.type === "hyperbola") return { ...primitive, center: { x: primitive.center.x + x, y: primitive.center.y + y } }
  return primitive
}

function signedOffset(value: number): string {
  return value < 0 ? String(value) : `+${value}`
}

function translateFunction(primitive: Extract<PrimitiveSpec, { type: "function" }>, x: number, y: number): Extract<PrimitiveSpec, { type: "function" }> {
  const shiftedExpression = primitive.expression.replace(/\bx\b/g, `(x${signedOffset(-x)})`)
  return { ...primitive, expression: `(${shiftedExpression})${signedOffset(y)}`, domain: [primitive.domain[0] + x, primitive.domain[1] + x] }
}

function primitiveDependencies(primitive: PrimitiveSpec): string[] {
  const dependencies: string[] = []
  if (primitive.type === "point" && primitive.binding) {
    if (primitive.binding.kind === "onPath") dependencies.push(primitive.binding.pathId, ...(primitive.binding.parameterId ? [primitive.binding.parameterId] : []))
    if (primitive.binding.kind === "derived") dependencies.push(primitive.binding.sourceId)
  }
  if (primitive.type === "point3" && primitive.binding) {
    if (primitive.binding.kind === "onLine") dependencies.push(primitive.binding.lineId)
    if (primitive.binding.kind === "onPlane") dependencies.push(primitive.binding.planeId)
    if (primitive.binding.kind === "derived") dependencies.push(...primitive.binding.sourceIds)
  }
  if (primitive.type === "line") dependencies.push(...(primitive.slopeParameter ? [primitive.slopeParameter] : []))
  if (primitive.type === "line3") dependencies.push(...(primitive.definition.kind === "throughPoints" ? primitive.definition.pointIds : [primitive.definition.pointId]))
  if (primitive.type === "segment3") dependencies.push(...primitive.pointIds)
  if (primitive.type === "ray3") dependencies.push(primitive.originId, primitive.throughId)
  if (primitive.type === "plane3") dependencies.push(...(primitive.definition.kind === "throughPoints" ? primitive.definition.pointIds : [primitive.definition.pointId]))
  if (primitive.type === "circle3") dependencies.push(primitive.centerId)
  if (primitive.type === "edge3") dependencies.push(...primitive.pointIds, ...(primitive.faceIds ?? []))
  if (primitive.type === "face3") dependencies.push(...primitive.pointIds, ...(primitive.edgeIds ?? []), ...(primitive.planeId ? [primitive.planeId] : []))
  if (primitive.type === "polyhedron3") dependencies.push(...primitive.vertexIds, ...primitive.edgeIds, ...primitive.faceIds, ...(primitive.construction?.sourceIds ?? []), ...(primitive.construction?.kind === "template" ? (primitive.construction.parameterIds ?? []) : []))
  if (primitive.type === "intersection") dependencies.push(primitive.lineA, primitive.lineB)
  if (primitive.type === "lineCircleIntersection") dependencies.push(primitive.lineId, primitive.circleId)
  if (primitive.type === "circleIntersection") dependencies.push(primitive.circleA, primitive.circleB)
  if (primitive.type === "curveIntersection") dependencies.push(primitive.objectA, primitive.objectB)
  if (primitive.type === "intersectionSet") dependencies.push(primitive.objectA, primitive.objectB)
  if (primitive.type === "derivative" || primitive.type === "tangent" || primitive.type === "normal" || primitive.type === "secant" || primitive.type === "integral" || primitive.type === "analysisSet" || primitive.type === "section") dependencies.push(primitive.sourceId)
  return [...new Set(dependencies)]
}

function solidSectionGeometry(primitive: Extract<PrimitiveSpec, { type: "cube" | "pyramid" | "cylinder" | "cone" }>): { vertices: Vector3[]; edges: [number, number][] } {
  if (primitive.type === "cube") {
    const { origin, size } = primitive
    const vertices = [
      { x: origin.x, y: origin.y, z: origin.z }, { x: origin.x + size.x, y: origin.y, z: origin.z }, { x: origin.x + size.x, y: origin.y + size.y, z: origin.z }, { x: origin.x, y: origin.y + size.y, z: origin.z },
      { x: origin.x, y: origin.y, z: origin.z + size.z }, { x: origin.x + size.x, y: origin.y, z: origin.z + size.z }, { x: origin.x + size.x, y: origin.y + size.y, z: origin.z + size.z }, { x: origin.x, y: origin.y + size.y, z: origin.z + size.z }
    ]
    return { vertices, edges: [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]] }
  }
  if (primitive.type === "pyramid") {
    const halfX = primitive.baseSize.x / 2
    const halfZ = primitive.baseSize.y / 2
    const { baseCenter } = primitive
    const vertices = [{ x: baseCenter.x - halfX, y: baseCenter.y, z: baseCenter.z - halfZ }, { x: baseCenter.x + halfX, y: baseCenter.y, z: baseCenter.z - halfZ }, { x: baseCenter.x + halfX, y: baseCenter.y, z: baseCenter.z + halfZ }, { x: baseCenter.x - halfX, y: baseCenter.y, z: baseCenter.z + halfZ }, { x: baseCenter.x, y: baseCenter.y + primitive.height, z: baseCenter.z }]
    return { vertices, edges: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [1, 4], [2, 4], [3, 4]] }
  }
  const vertices: Vector3[] = []
  const halfHeight = primitive.height / 2
  for (const y of [-halfHeight, halfHeight]) for (let index = 0; index < primitive.segments; index += 1) {
    const angle = index * Math.PI * 2 / primitive.segments
    vertices.push({ x: primitive.center.x + primitive.radius * Math.cos(angle), y: primitive.center.y + halfHeight + y, z: primitive.center.z + primitive.radius * Math.sin(angle) })
  }
  const edges: [number, number][] = []
  for (let index = 0; index < primitive.segments; index += 1) {
    const next = (index + 1) % primitive.segments
    edges.push([index, next], [primitive.segments + index, primitive.segments + next], [index, primitive.segments + index])
  }
  if (primitive.type === "cone") {
    const apex = vertices.length
    vertices.push({ x: primitive.center.x, y: primitive.center.y + primitive.height, z: primitive.center.z })
    for (let index = 0; index < primitive.segments; index += 1) edges.push([primitive.segments + index, apex])
  }
  return { vertices, edges }
}

function classifySectionPoints(points: Vector3[]): Section3Classification {
  if (points.length === 0) return "none"
  if (points.length === 1) return "point"
  if (points.length === 2) return "segment"
  return "polygon"
}

/** Resolve materialized point-driven topology into ordered vertex positions and face rings. */
function polyhedronSectionTopology(polyhedron: Extract<PrimitiveSpec, { type: "polyhedron3" }>, primitiveMap: Map<string, PrimitiveSpec>): { vertices: Vector3[]; faces: number[][] } | null {
  const vertices: Vector3[] = []
  for (const vertexId of polyhedron.vertexIds) {
    const vertex = primitiveMap.get(vertexId)
    if (vertex?.type !== "point3") return null
    vertices.push({ ...vertex.position })
  }
  const faces: number[][] = []
  for (const faceId of polyhedron.faceIds) {
    const face = primitiveMap.get(faceId)
    if (face?.type !== "face3") return null
    const ring = face.pointIds.map((pointId) => polyhedron.vertexIds.indexOf(pointId))
    if (ring.length < 3 || ring.some((index) => index < 0)) return null
    faces.push(ring)
  }
  return faces.length >= 4 ? { vertices, faces } : null
}

/** Templates materialize their topology as point3/edge3/face3/polyhedron3 objects; cut that topology when present. */
function templateTopology(sourceId: string, primitiveMap: Map<string, PrimitiveSpec>): Extract<PrimitiveSpec, { type: "polyhedron3" }> | null {
  for (const primitive of primitiveMap.values()) {
    if (primitive.type === "polyhedron3" && primitive.construction?.kind === "template" && primitive.construction.sourceIds[0] === sourceId) return primitive
  }
  return null
}

/** Vertex positions of a section source: materialized topology first, template tessellation as fallback. */
function sourceVertices(source: PrimitiveSpec, primitiveMap: Map<string, PrimitiveSpec>): Vector3[] {
  if (source.type === "polyhedron3") return polyhedronSectionTopology(source, primitiveMap)?.vertices ?? []
  if (["cube", "pyramid", "cylinder", "cone"].includes(source.type)) return solidSectionGeometry(source as Extract<PrimitiveSpec, { type: "cube" | "pyramid" | "cylinder" | "cone" }>).vertices
  return []
}

/** Default cutting plane: horizontal through the source's bounding-box center so a new cut is actually visible. */
/** Resolved point-driven topology of one polyhedron, ready for kernel helpers such as unfolding. */
export interface PolyhedronTopology3 {
  vertices: Record<string, Vector3>
  faces: FaceRing3[]
  rootFaceId: string
}

/** Read a polyhedron's stable vertex and face rings, or null when the topology is incomplete. */
export function resolvePolyhedronTopology(document: GeometryDocument, polyhedronId: string): PolyhedronTopology3 | null {
  const primitiveMap = new Map(document.primitives.map((primitive) => [primitive.id, primitive]))
  const polyhedron = primitiveMap.get(polyhedronId)
  if (polyhedron?.type !== "polyhedron3") return null
  const vertices: Record<string, Vector3> = {}
  for (const vertexId of polyhedron.vertexIds) {
    const vertex = primitiveMap.get(vertexId)
    if (vertex?.type !== "point3") return null
    vertices[vertexId] = { ...vertex.position }
  }
  const faces: FaceRing3[] = []
  for (const faceId of polyhedron.faceIds) {
    const face = primitiveMap.get(faceId)
    if (face?.type !== "face3" || face.pointIds.length < 3) return null
    if (face.pointIds.some((pointId) => !vertices[pointId])) return null
    faces.push({ id: faceId, pointIds: [...face.pointIds] })
  }
  if (faces.length < 4) return null
  return { vertices, faces, rootFaceId: faces[0].id }
}

/** Default cutting plane: horizontal through the source's bounding-box center. Returns null when the source
 * vertices cannot be resolved, so callers never persist a fabricated plane. */
export function sectionPlaneThroughSource(document: GeometryDocument, sourceId: string): { normal: Vector3; constant: number } | null {
  const primitiveMap = new Map(document.primitives.map((primitive) => [primitive.id, primitive]))
  const source = primitiveMap.get(sourceId)
  const vertices = source ? sourceVertices(source, primitiveMap) : []
  if (vertices.length === 0) return null
  const heights = vertices.map((vertex) => vertex.y)
  return { normal: { x: 0, y: 1, z: 0 }, constant: -(Math.min(...heights) + Math.max(...heights)) / 2 }
}

function recomputeSection(primitive: Extract<PrimitiveSpec, { type: "section" }>, source: PrimitiveSpec, primitiveMap: Map<string, PrimitiveSpec>): Extract<PrimitiveSpec, { type: "section" }> {
  const polyhedron = source.type === "polyhedron3" ? source : templateTopology(source.id, primitiveMap)
  const topology = polyhedron ? polyhedronSectionTopology(polyhedron, primitiveMap) : null
  if (topology) {
    const result = sectionPolyhedron3(topology.vertices, topology.faces, primitive.plane)
    if (result.status === "none") return { ...primitive, points: [], classification: "none", status: "undefined", visible: false, diagnostic: result.explanation }
    if (result.status === "insufficient-data") return { ...primitive, points: [], classification: "insufficient-data", status: "failed", visible: false, diagnostic: result.explanation }
    return { ...primitive, points: result.points, classification: result.status, status: "approximate", visible: result.status !== "point", diagnostic: result.status === "polygon" ? undefined : result.explanation }
  }
  if (!["cube", "pyramid", "cylinder", "cone"].includes(source.type)) return { ...primitive, points: [], classification: "insufficient-data", status: "failed", visible: false, diagnostic: "截面来源不是可剖切的实体。" }
  const geometry = solidSectionGeometry(source as Extract<PrimitiveSpec, { type: "cube" | "pyramid" | "cylinder" | "cone" }>)
  const points = orderSectionPoints3(sectionConvexPolyhedron(geometry.vertices, geometry.edges, primitive.plane), primitive.plane)
  return { ...primitive, points, classification: classifySectionPoints(points), status: points.length > 0 ? "approximate" : "undefined", visible: points.length > 0, diagnostic: points.length >= 3 ? undefined : "剖切平面与模板实体相切或沿棱相交。" }
}

function resolveBoundPoint(binding: PointBinding, primitives: Map<string, PrimitiveSpec>, parameters: GeometryDocument["parameters"]): Coordinate | null {
  if (binding.kind !== "onPath") return null
  const path = primitives.get(binding.pathId)
  const parameter = binding.parameterId ? parameters[binding.parameterId]?.value : binding.parameter
  if (!path || parameter === undefined || !Number.isFinite(parameter)) return null
  const t = Math.min(1, Math.max(0, parameter))
  if (path.type === "line" || path.type === "segment" || path.type === "ray") return { x: path.a.x + (path.b.x - path.a.x) * t, y: path.a.y + (path.b.y - path.a.y) * t }
  if (path.type === "circle") {
    const angle = t * Math.PI * 2
    return { x: path.center.x + path.radius * Math.cos(angle), y: path.center.y + path.radius * Math.sin(angle) }
  }
  if (path.type === "arc") {
    const angle = path.startAngle + (path.endAngle - path.startAngle) * t
    return { x: path.center.x + path.radius * Math.cos(angle), y: path.center.y + path.radius * Math.sin(angle) }
  }
  if (path.type === "polyline") {
    const lengths = path.points.slice(1).map((point, index) => Math.hypot(point.x - path.points[index].x, point.y - path.points[index].y))
    const total = lengths.reduce((sum, length) => sum + length, 0)
    if (!total) return null
    let distance = t * total
    for (let index = 0; index < lengths.length; index += 1) {
      if (distance <= lengths[index] || index === lengths.length - 1) {
        const ratio = lengths[index] ? distance / lengths[index] : 0
        return { x: path.points[index].x + (path.points[index + 1].x - path.points[index].x) * ratio, y: path.points[index].y + (path.points[index + 1].y - path.points[index].y) * ratio }
      }
      distance -= lengths[index]
    }
  }
  if (path.type === "function") {
    const x = path.domain[0] + (path.domain[1] - path.domain[0]) * t
    try { return { x, y: evaluateParameterExpression(path.expression, { x, ...Object.fromEntries(Object.entries(parameters).map(([id, spec]) => [id, spec.value])) }) } } catch { return null }
  }
  return null
}

function isSampledPrimitive(primitive: PrimitiveSpec | undefined): primitive is SampledPrimitive {
  return Boolean(primitive && ["line", "segment", "ray", "polyline", "circle", "arc", "parabola", "ellipse", "hyperbola", "function"].includes(primitive.type))
}

function recomputeDerivative(primitive: Extract<PrimitiveSpec, { type: "derivative" }>, source: Extract<PrimitiveSpec, { type: "function" }>, parameters: GeometryDocument["parameters"]): Extract<PrimitiveSpec, { type: "derivative" }> {
  const variables = Object.fromEntries(Object.entries(parameters).map(([id, parameter]) => [id, parameter.value]))
  const sourceValue = (x: number) => evaluateParameterExpression(source.expression, { ...variables, x })
  const derivativeValue = primitive.order === 1
    ? (x: number) => numericalDerivative(sourceValue, x)
    : (x: number) => numericalSecondDerivative(sourceValue, x)
  try {
    const segments = adaptiveSampleFunctionSegments(derivativeValue, primitive.domain, { initialSteps: primitive.samples, maxSteps: Math.max(primitive.samples, 2048) })
    const points = segments.flat()
    return points.length ? { ...primitive, points, status: "approximate", diagnostic: undefined } : { ...primitive, points: [], status: "undefined", diagnostic: "source function is undefined across the derivative domain" }
  } catch (error) {
    return { ...primitive, points: [], status: "failed", diagnostic: error instanceof Error ? error.message : "derivative evaluation failed" }
  }
}

function evaluateSource(source: Extract<PrimitiveSpec, { type: "function" }>, x: number, parameters: GeometryDocument["parameters"]): number {
  const variables = Object.fromEntries(Object.entries(parameters).map(([id, parameter]) => [id, parameter.value]))
  return evaluateParameterExpression(source.expression, { ...variables, x })
}

function lineEndpoints(point: Coordinate, slope: number, domain: [number, number], vertical = false): { a: Coordinate; b: Coordinate } {
  if (vertical) return { a: { x: point.x, y: domain[0] }, b: { x: point.x, y: domain[1] } }
  return { a: { x: domain[0], y: point.y + slope * (domain[0] - point.x) }, b: { x: domain[1], y: point.y + slope * (domain[1] - point.x) } }
}

function recomputeTangent(primitive: Extract<PrimitiveSpec, { type: "tangent" | "normal" }>, source: Extract<PrimitiveSpec, { type: "function" }>, parameters: GeometryDocument["parameters"]): Extract<PrimitiveSpec, { type: "tangent" | "normal" }> {
  try {
    const y = evaluateSource(source, primitive.x, parameters)
    const sourceValue = (x: number) => evaluateSource(source, x, parameters)
    const derivative = numericalDerivative(sourceValue, primitive.x)
    if (!Number.isFinite(y) || !Number.isFinite(derivative)) return { ...primitive, point: { x: primitive.x, y: 0 }, status: "undefined" as const, diagnostic: "source function is undefined at the selected x" }
    const vertical = primitive.type === "normal" && Math.abs(derivative) < 1e-8
    const slope = primitive.type === "normal" ? (vertical ? 0 : -1 / derivative) : derivative
    return { ...primitive, point: { x: primitive.x, y }, slope, vertical, ...lineEndpoints({ x: primitive.x, y }, slope, source.domain, vertical), status: "approximate" as const, diagnostic: undefined }
  } catch (error) {
    return { ...primitive, point: { x: primitive.x, y: 0 }, status: "failed" as const, diagnostic: error instanceof Error ? error.message : "line evaluation failed" }
  }
}

function recomputeSecant(primitive: Extract<PrimitiveSpec, { type: "secant" }>, source: Extract<PrimitiveSpec, { type: "function" }>, parameters: GeometryDocument["parameters"]): Extract<PrimitiveSpec, { type: "secant" }> {
  try {
    const first = { x: primitive.x1, y: evaluateSource(source, primitive.x1, parameters) }
    const second = { x: primitive.x2, y: evaluateSource(source, primitive.x2, parameters) }
    if (!Number.isFinite(first.y) || !Number.isFinite(second.y)) return { ...primitive, points: [], status: "undefined" as const, diagnostic: "source function is undefined at a secant endpoint" }
    const vertical = Math.abs(second.x - first.x) < 1e-8
    const slope = vertical ? 0 : (second.y - first.y) / (second.x - first.x)
    return { ...primitive, points: [first, second], slope, vertical, ...lineEndpoints(first, slope, source.domain, vertical), status: "approximate" as const, diagnostic: undefined }
  } catch (error) {
    return { ...primitive, points: [], status: "failed" as const, diagnostic: error instanceof Error ? error.message : "secant evaluation failed" }
  }
}

function recomputeIntegral(primitive: Extract<PrimitiveSpec, { type: "integral" }>, source: Extract<PrimitiveSpec, { type: "function" }>, parameters: GeometryDocument["parameters"]): Extract<PrimitiveSpec, { type: "integral" }> {
  const sourceValue = (x: number) => evaluateSource(source, x, parameters)
  const result = numericalIntegralWithDiagnostics(sourceValue, primitive.domain, primitive.steps)
  const points = adaptiveSampleFunctionSegments(sourceValue, primitive.domain, { initialSteps: Math.min(primitive.steps, 512), maxSteps: Math.max(primitive.steps, 2048) }).flat()
  return { ...primitive, points, area: result.value, status: result.status, diagnostic: result.diagnostic }
}

function recomputeAnalysisSet(primitive: Extract<PrimitiveSpec, { type: "analysisSet" }>, source: Extract<PrimitiveSpec, { type: "function" }>, parameters: GeometryDocument["parameters"]): Extract<PrimitiveSpec, { type: "analysisSet" }> {
  const sourceValue = (x: number) => evaluateSource(source, x, parameters)
  const results = [...findZeros(sourceValue, primitive.domain, primitive.samples), ...findExtrema(sourceValue, primitive.domain, primitive.samples), ...findInflectionPoints(sourceValue, primitive.domain, primitive.samples)]
  const hasDefinedSamples = adaptiveSampleFunctionSegments(sourceValue, primitive.domain, { initialSteps: Math.min(primitive.samples, 256), maxSteps: Math.max(primitive.samples, 512) }).some((segment) => segment.length > 0)
  return hasDefinedSamples
    ? { ...primitive, results, status: "approximate" as const, diagnostic: undefined }
    : { ...primitive, results: [], status: "undefined" as const, diagnostic: "source function is undefined across the analysis domain" }
}

export function getDependencyIndex(document: GeometryDocument): Map<string, Set<string>> {
  const dependents = new Map<string, Set<string>>()
  for (const primitive of document.primitives) {
    for (const dependency of primitiveDependencies(primitive)) {
      const primitiveDependents = dependents.get(dependency) ?? new Set<string>()
      primitiveDependents.add(primitive.id)
      dependents.set(dependency, primitiveDependents)
    }
  }
  for (const constraint of document.constraints) {
    if (constraint.targets.length !== 2) continue
    const [first, second] = constraint.targets
    const firstDependents = dependents.get(first) ?? new Set<string>()
    firstDependents.add(second)
    dependents.set(first, firstDependents)
    const secondDependents = dependents.get(second) ?? new Set<string>()
    secondDependents.add(first)
    dependents.set(second, secondDependents)
  }
  return dependents
}

export function getAffectedPrimitiveIds(document: GeometryDocument, changedIds: string[]): Set<string> {
  const dependents = getDependencyIndex(document)
  const affected = new Set(changedIds)
  const queue = [...changedIds]
  while (queue.length) {
    const changedId = queue.shift()!
    for (const dependent of dependents.get(changedId) ?? new Set<string>()) {
      if (affected.has(dependent)) continue
      affected.add(dependent)
      queue.push(dependent)
    }
  }
  return affected
}

function point3Position(primitive: PrimitiveSpec | undefined, points: Map<string, Point3Primitive>): Vector3 | null {
  if (!primitive) return null
  if (primitive.type === "point3") return primitive.position
  if (primitive.type === "segment3" || primitive.type === "edge3") {
    const first = points.get(primitive.pointIds[0])
    return first?.position ?? null
  }
  if (primitive.type === "ray3") return points.get(primitive.originId)?.position ?? null
  return null
}

function resolveLine3Endpoints(primitive: Extract<PrimitiveSpec, { type: "line3" }>, points: Map<string, Point3Primitive>): { first: Vector3; second: Vector3 } | null {
  if (primitive.definition.kind === "throughPoints") {
    const first = points.get(primitive.definition.pointIds[0])
    const second = points.get(primitive.definition.pointIds[1])
    return first && second ? { first: first.position, second: second.position } : null
  }
  const point = points.get(primitive.definition.pointId)
  if (!point) return null
  return { first: point.position, second: { x: point.position.x + primitive.definition.direction.x, y: point.position.y + primitive.definition.direction.y, z: point.position.z + primitive.definition.direction.z } }
}

function resolveBoundPoint3(primitive: Extract<PrimitiveSpec, { type: "point3" }>, primitives: Map<string, PrimitiveSpec>): Vector3 | null {
  const binding = primitive.binding
  if (!binding || binding.kind === "free") return null
  const points = new Map([...primitives.values()].filter((candidate): candidate is Point3Primitive => candidate.type === "point3").map((point) => [point.id, point]))
  if (binding.kind === "onLine") {
    const line = primitives.get(binding.lineId)
    if (!line || line.type !== "line3") return null
    const endpoints = resolveLine3Endpoints(line, points)
    if (!endpoints || !Number.isFinite(binding.parameter)) return null
    return { x: endpoints.first.x + (endpoints.second.x - endpoints.first.x) * binding.parameter, y: endpoints.first.y + (endpoints.second.y - endpoints.first.y) * binding.parameter, z: endpoints.first.z + (endpoints.second.z - endpoints.first.z) * binding.parameter }
  }
  if (binding.kind === "onPlane") {
    const plane = primitives.get(binding.planeId)
    if (!plane || plane.type !== "plane3") return null
    return { x: binding.frame.origin.x + binding.coordinates[0] * binding.frame.u.x + binding.coordinates[1] * binding.frame.v.x, y: binding.frame.origin.y + binding.coordinates[0] * binding.frame.u.y + binding.coordinates[1] * binding.frame.v.y, z: binding.frame.origin.z + binding.coordinates[0] * binding.frame.u.z + binding.coordinates[1] * binding.frame.v.z }
  }
  if (binding.feature === "midpoint" && binding.sourceIds.length >= 2) {
    const first = point3Position(primitives.get(binding.sourceIds[0]), points)
    const second = point3Position(primitives.get(binding.sourceIds[1]), points)
    if (first && second) return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2, z: (first.z + second.z) / 2 }
  }
  return null
}

function recomputeBoundPoint3s(primitives: PrimitiveSpec[], affected: Set<string>): void {
  for (let pass = 0; pass < primitives.length; pass += 1) {
    let changed = false
    const primitiveMap = new Map(primitives.map((primitive) => [primitive.id, primitive]))
    for (let index = 0; index < primitives.length; index += 1) {
      const primitive = primitives[index]
      if (primitive.type !== "point3" || !primitive.binding || !affected.has(primitive.id)) continue
      const position = resolveBoundPoint3(primitive, primitiveMap)
      if (!position || primitive.position.x === position.x && primitive.position.y === position.y && primitive.position.z === position.z) continue
      primitives[index] = { ...primitive, position }
      primitiveMap.set(primitive.id, primitives[index])
      changed = true
    }
    if (!changed) return
  }
}

function syncTemplateTopology(primitives: PrimitiveSpec[]): void {
  const primitiveMap = new Map(primitives.map((primitive) => [primitive.id, primitive]))
  for (const polyhedron of primitives) {
    if (polyhedron.type !== "polyhedron3" || polyhedron.construction?.kind !== "template") continue
    const source = polyhedron.construction.sourceIds.map((id) => primitiveMap.get(id)).find((candidate): candidate is TemplateSolidPrimitive => Boolean(candidate && ["cube", "pyramid", "cylinder", "cone"].includes(candidate.type)))
    if (!source || source.type !== polyhedron.construction.templateId) continue
    const result = buildSolidTemplate(source, createBuilderContext(source.id))
    const generatedPoints = new Map(result.primitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "point3" }> => primitive.type === "point3").map((primitive) => [primitive.id, primitive.position]))
    for (let index = 0; index < primitives.length; index += 1) {
      const primitive = primitives[index]
      if (primitive.type !== "point3") continue
      const position = generatedPoints.get(primitive.id)
      if (position) primitives[index] = { ...primitive, position: { ...position } }
    }
  }
}

function resolveIntersection(primitive: Extract<PrimitiveSpec, { type: "intersection" | "lineCircleIntersection" | "circleIntersection" }>, lines: Map<string, Extract<PrimitiveSpec, { type: "line" }>>, circles: Map<string, Extract<PrimitiveSpec, { type: "circle" }>>): IntersectionResult {
  if (primitive.type === "intersection") {
    const first = lines.get(primitive.lineA)
    const second = lines.get(primitive.lineB)
    return first && second ? intersectLinesDetailed(first, second) : { kind: "degenerate", reason: "intersection references missing line" }
  }
  if (primitive.type === "lineCircleIntersection") {
    const line = lines.get(primitive.lineId)
    const circle = circles.get(primitive.circleId)
    return line && circle ? intersectLineCircleDetailed(line, circle) : { kind: "degenerate", reason: "line-circle intersection references missing object" }
  }
  const first = circles.get(primitive.circleA)
  const second = circles.get(primitive.circleB)
  return first && second ? intersectCirclesDetailed(first, second) : { kind: "degenerate", reason: "circle intersection references missing circle" }
}

export function recomputeDerivedObjects(document: GeometryDocument, changedIds?: string[]): GeometryDocument {
  const parameters = evaluateParameterExpressions(document.parameters)
  const evaluatedDocument = {
    ...document,
    parameters,
    primitives: document.primitives.map((primitive) => primitive.type === "line" ? evaluateLineParameters({ ...document, parameters }, primitive) : primitive)
  }
  const affected = changedIds === undefined
    ? new Set(document.primitives.map((primitive) => primitive.id))
    : getAffectedPrimitiveIds(document, changedIds)
  const projectedPrimitives = [...evaluatedDocument.primitives]
  const projectedLines = new Map(
    projectedPrimitives
      .filter((primitive): primitive is Extract<PrimitiveSpec, { type: "line" }> => primitive.type === "line")
      .map((line) => [line.id, line])
  )
  const activeLineIds = changedIds === undefined
    ? undefined
    : new Set([...affected].filter((id) => projectedLines.has(id)))
  const activeConstraintIds = changedIds === undefined
    ? undefined
    : new Set(evaluatedDocument.constraints
      .filter((constraint) => constraint.targets.length === 2 && constraint.targets.every((target) => affected.has(target)))
      .map((constraint) => constraint.id))
  const solved = solveLineConstraints(projectedLines, evaluatedDocument.constraints, undefined, undefined, changedIds === undefined ? undefined : activeLineIds, activeConstraintIds)
  if (!solved.converged) throw new Error("constraint solving failed to converge")
  const lines = solved.lines
  const primitiveIndexById = new Map(projectedPrimitives.map((primitive, index) => [primitive.id, index]))
  for (const [id, projected] of lines) {
    const primitiveIndex = primitiveIndexById.get(id)
    if (primitiveIndex !== undefined) projectedPrimitives[primitiveIndex] = projected
  }
  recomputeBoundPoint3s(projectedPrimitives, affected)
  syncTemplateTopology(projectedPrimitives)
  const circles = new Map(
    projectedPrimitives
      .filter((primitive): primitive is Extract<PrimitiveSpec, { type: "circle" }> => primitive.type === "circle")
      .map((circle) => [circle.id, circle])
  )
  const primitiveMap = new Map(projectedPrimitives.map((primitive) => [primitive.id, primitive]))
  const primitives = projectedPrimitives.map((primitive) => {
    if (!affected.has(primitive.id)) return primitive
    if (primitive.type === "point3" && primitive.binding) {
      const position = resolveBoundPoint3(primitive, primitiveMap)
      return position ? { ...primitive, position } : primitive
    }
    if (primitive.type === "point" && primitive.binding) {
      const point = resolveBoundPoint(primitive.binding, primitiveMap, parameters)
      return point ? { ...primitive, x: point.x, y: point.y } : primitive
    }
    if (primitive.type === "derivative") {
      const source = primitiveMap.get(primitive.sourceId)
      if (source?.type !== "function") return { ...primitive, points: [], status: "failed" as const, diagnostic: "derivative source function is missing" }
      return recomputeDerivative(primitive, source, parameters)
    }
    if (primitive.type === "tangent" || primitive.type === "normal" || primitive.type === "secant") {
      const source = primitiveMap.get(primitive.sourceId)
      if (source?.type !== "function") return { ...primitive, status: "failed" as const, diagnostic: "derived line source function is missing" }
      return primitive.type === "secant" ? recomputeSecant(primitive, source, parameters) : recomputeTangent(primitive, source, parameters)
    }
    if (primitive.type === "integral" || primitive.type === "analysisSet") {
      const source = primitiveMap.get(primitive.sourceId)
      if (source?.type !== "function") return { ...primitive, status: "failed" as const, diagnostic: "analysis source function is missing" }
      return primitive.type === "integral" ? recomputeIntegral(primitive, source, parameters) : recomputeAnalysisSet(primitive, source, parameters)
    }
    if (primitive.type === "section") {
      const source = primitiveMap.get(primitive.sourceId)
      if (!source) return { ...primitive, points: [], classification: "insufficient-data" as const, status: "failed" as const, visible: false, diagnostic: "截面来源实体不存在。" }
      return recomputeSection(primitive, source, primitiveMap)
    }
    if (primitive.type === "line") return lines.get(primitive.id) ?? primitive
    if (primitive.type === "intersectionSet") {
      const first = primitiveMap.get(primitive.objectA)
      const second = primitiveMap.get(primitive.objectB)
      if (!isSampledPrimitive(first) || !isSampledPrimitive(second)) throw new Error("intersection set references unsupported objects")
      const result = intersectSampledPrimitives(first, second)
      if (result.kind === "degenerate") throw new Error(`degenerate intersection set: ${result.reason}`)
      if (result.kind === "none" || result.kind === "coincident") return { ...primitive, points: [], visible: false }
      if (result.kind === "point" || result.kind === "tangent") return { ...primitive, points: [result.point], visible: true }
      return { ...primitive, points: result.points, visible: true }
    }
    if (primitive.type === "curveIntersection") {
      const first = primitiveMap.get(primitive.objectA)
      const second = primitiveMap.get(primitive.objectB)
      if (!isSampledPrimitive(first) || !isSampledPrimitive(second)) throw new Error("curve intersection references unsupported objects")
      const result = intersectSampledPrimitives(first, second)
      if (result.kind === "degenerate") throw new Error(`degenerate curve intersection: ${result.reason}`)
      if (result.kind === "none" || result.kind === "coincident") return { ...primitive, visible: false }
      if (result.kind === "point" || result.kind === "tangent") return { ...primitive, x: result.point.x, y: result.point.y, visible: true }
      const point = result.points[primitive.solutionIndex ?? 0]
      return { ...primitive, x: point.x, y: point.y, visible: true }
    }
    if (primitive.type !== "intersection" && primitive.type !== "lineCircleIntersection" && primitive.type !== "circleIntersection") return primitive
    const result = resolveIntersection(primitive, lines, circles)
    if (result.kind === "degenerate") throw new Error(`degenerate intersection: ${result.reason}`)
    if (result.kind === "none" || result.kind === "coincident") return { ...primitive, visible: false }
    if (result.kind === "point" || result.kind === "tangent") return { ...primitive, x: result.point.x, y: result.point.y, visible: true }
    const point = result.points[primitive.type === "intersection" ? 0 : primitive.solutionIndex ?? 0]
    return { ...primitive, x: point.x, y: point.y, visible: true }
  })
  const measurements = evaluatedDocument.measurements.map((measurement) => calculateMeasurement3(measurement, primitives))
  return { ...evaluatedDocument, primitives, measurements }
}

export function applyOperation(document: GeometryDocument, operation: DomainOperation): OperationResult {
  const next = structuredClone(document) as GeometryDocument
  let changedIds: string[] = []
  if (operation.op === "addPrimitive") {
    if (next.primitives.some((primitive) => primitive.id === operation.primitive.id)) return { document, changed: false, error: "duplicate object id" }
    next.primitives.push(operation.primitive)
    changedIds = [operation.primitive.id]
  } else if (operation.op === "addPrimitives") {
    if (operation.primitives.some((primitive, index) => next.primitives.some((candidate) => candidate.id === primitive.id) || operation.primitives.slice(0, index).some((candidate) => candidate.id === primitive.id))) return { document, changed: false, error: "duplicate object id" }
    next.primitives.push(...operation.primitives)
    changedIds = operation.primitives.map((primitive) => primitive.id)
  } else if (operation.op === "updatePrimitive") {
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)
    if (!primitive || !["point", "point3", "line", "segment", "ray", "polyline", "parabola", "ellipse", "hyperbola", "function", "circle", "arc", "cube", "pyramid", "cylinder", "cone"].includes(primitive.type) || primitive.locked) return { document, changed: false, error: primitive?.locked ? "object is locked" : "object is not editable" }
    if (primitive.type === "point") {
      if (operation.patch.x !== undefined) primitive.x = operation.patch.x
      if (operation.patch.y !== undefined) primitive.y = operation.patch.y
      if (operation.patch.binding !== undefined) primitive.binding = operation.patch.binding
    }
    if (primitive.type === "point3") {
      if (operation.patch.position3 !== undefined) primitive.position = { ...operation.patch.position3 }
      if (operation.patch.binding3 !== undefined) primitive.binding = operation.patch.binding3
      if (operation.patch.position3 !== undefined) {
        for (const candidate of next.primitives) {
          if (candidate.type !== "polyhedron3" || !candidate.vertexIds.includes(primitive.id) || candidate.construction?.kind !== "template") continue
          candidate.construction = { kind: "fromFaces", sourceIds: [...candidate.faceIds] }
        }
      }
    }
    if (primitive.type === "line" || primitive.type === "segment" || primitive.type === "ray") {
      if (operation.patch.a) primitive.a = { ...primitive.a, ...operation.patch.a }
      if (operation.patch.b) primitive.b = { ...primitive.b, ...operation.patch.b }
    }
    if (primitive.type === "polyline" && operation.patch.points) primitive.points = operation.patch.points
    if (primitive.type === "parabola") {
      if (operation.patch.vertex) primitive.vertex = { ...primitive.vertex, ...operation.patch.vertex }
      if (operation.patch.focalParameter !== undefined) primitive.focalParameter = operation.patch.focalParameter
      if (operation.patch.axis !== undefined) primitive.axis = operation.patch.axis
      if (operation.patch.rotation !== undefined) primitive.rotation = operation.patch.rotation
    }
    if (primitive.type === "ellipse" || primitive.type === "hyperbola") {
      if (operation.patch.center) primitive.center = { ...primitive.center, ...operation.patch.center }
      if (operation.patch.radiusX !== undefined) primitive.radiusX = operation.patch.radiusX
      if (operation.patch.radiusY !== undefined) primitive.radiusY = operation.patch.radiusY
      if (primitive.type === "hyperbola" && operation.patch.axis !== undefined) primitive.axis = operation.patch.axis
      if (operation.patch.rotation !== undefined) primitive.rotation = operation.patch.rotation
    }
    if (primitive.type === "function") {
      if (operation.patch.expression !== undefined) primitive.expression = operation.patch.expression
      if (operation.patch.domain !== undefined) primitive.domain = operation.patch.domain
      if (operation.patch.samples !== undefined) primitive.samples = operation.patch.samples
    }
    if (primitive.type === "circle" || primitive.type === "arc") {
      if (operation.patch.center) primitive.center = { ...primitive.center, ...operation.patch.center }
      if (operation.patch.radius !== undefined) primitive.radius = operation.patch.radius
    }
    if (primitive.type === "arc") {
      if (operation.patch.startAngle !== undefined) primitive.startAngle = operation.patch.startAngle
      if (operation.patch.endAngle !== undefined) primitive.endAngle = operation.patch.endAngle
    }
    if (primitive.type === "cube") {
      if (operation.patch.origin3) primitive.origin = { ...primitive.origin, ...operation.patch.origin3 }
      if (operation.patch.size3) primitive.size = { ...primitive.size, ...operation.patch.size3 }
    }
    if (primitive.type === "pyramid") {
      if (operation.patch.baseCenter3) primitive.baseCenter = { ...primitive.baseCenter, ...operation.patch.baseCenter3 }
      if (operation.patch.baseSize3) primitive.baseSize = { ...primitive.baseSize, ...operation.patch.baseSize3 }
      if (operation.patch.height !== undefined) primitive.height = operation.patch.height
    }
    if (primitive.type === "cylinder" || primitive.type === "cone") {
      if (operation.patch.center3) primitive.center = { ...primitive.center, ...operation.patch.center3 }
      if (operation.patch.radius3 !== undefined) primitive.radius = operation.patch.radius3
      if (operation.patch.height !== undefined) primitive.height = operation.patch.height
      if (operation.patch.segments !== undefined) primitive.segments = operation.patch.segments
    }
    if (operation.patch.label !== undefined) primitive.label = operation.patch.label
    if (operation.patch.style !== undefined) primitive.style = { ...primitive.style, ...operation.patch.style }
    changedIds = [operation.id]
  } else if (operation.op === "translatePrimitive") {
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)
    if (primitive) {
      next.primitives = next.primitives.map((candidate) => candidate.id !== operation.id
        ? candidate
        : candidate.type === "function" ? translateFunction(candidate, operation.delta.x, operation.delta.y) : translatePrimitive(candidate, operation.delta.x, operation.delta.y))
      changedIds = [operation.id]
    }
  } else if (operation.op === "toggleLock") {
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)
    if (!primitive) return { document, changed: false, error: "object not found" }
    primitive.locked = operation.locked
  } else if (operation.op === "setParameter") {
    const parameter = next.parameters[operation.id] ?? { id: operation.id, value: operation.value }
    next.parameters[operation.id] = { ...parameter, value: operation.value, expression: undefined }
    changedIds = [operation.id]
  } else if (operation.op === "setParameterExpression") {
    const parameter = next.parameters[operation.id] ?? { id: operation.id, value: 0 }
    next.parameters[operation.id] = { ...parameter, expression: operation.expression }
    changedIds = [operation.id]
  } else if (operation.op === "addAnnotation") {
    next.annotations.push(operation.annotation)
  } else if (operation.op === "deleteAnnotation") {
    const before = next.annotations.length
    next.annotations = next.annotations.filter((annotation) => annotation.id !== operation.id)
    if (before === next.annotations.length) return { document, changed: false, error: "annotation not found" }
  } else if (operation.op === "addConstraint") {
    if (next.constraints.some((constraint) => constraint.id === operation.constraint.id)) return { document, changed: false, error: "duplicate constraint id" }
    next.constraints.push(operation.constraint)
    changedIds = operation.constraint.targets
  } else if (operation.op === "deleteObject") {
    const before = next.primitives.length
    next.primitives = next.primitives.filter((primitive) => primitive.id !== operation.id)
    if (before === next.primitives.length) return { document, changed: false, error: "object not found" }
    changedIds = [operation.id]
  } else if (operation.op === "deleteConstraint") {
    const before = next.constraints.length
    next.constraints = next.constraints.filter((constraint) => constraint.id !== operation.id)
    if (before === next.constraints.length) return { document, changed: false, error: "constraint not found" }
  } else if (operation.op === "addMeasurement") {
    if (next.measurements.some((measurement) => measurement.id === operation.measurement.id)) return { document, changed: false, error: "duplicate measurement id" }
    next.measurements.push(operation.measurement)
    changedIds = operation.measurement.sourceIds
  } else if (operation.op === "deleteMeasurement") {
    const before = next.measurements.length
    next.measurements = next.measurements.filter((measurement) => measurement.id !== operation.id)
    if (before === next.measurements.length) return { document, changed: false, error: "measurement not found" }
  } else if (operation.op === "toggleVisibility") {
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)
    if (!primitive) return { document, changed: false, error: "object not found" }
    primitive.visible = operation.visible
  } else if (operation.op === "createGroup") {
    next.groups.push(operation.group)
  } else if (operation.op === "deleteGroup") {
    next.groups = next.groups.filter((group) => group.id !== operation.id)
  } else if (operation.op === "setPrimitivesLocked") {
    for (const primitive of next.primitives) if (operation.ids.includes(primitive.id)) primitive.locked = operation.locked
  } else if (operation.op === "setPrimitivesVisible") {
    for (const primitive of next.primitives) if (operation.ids.includes(primitive.id)) primitive.visible = operation.visible
  } else if (operation.op === "alignPrimitives") {
    const selected = next.primitives.filter((primitive) => operation.ids.includes(primitive.id))
    const bounds = selected.map((primitive) => primitiveBounds(primitive)!)
    const target = operation.alignment === "left" ? Math.min(...bounds.map((value) => value.minX))
      : operation.alignment === "right" ? Math.max(...bounds.map((value) => value.maxX))
        : operation.alignment === "top" ? Math.max(...bounds.map((value) => value.maxY))
          : operation.alignment === "bottom" ? Math.min(...bounds.map((value) => value.minY))
            : operation.alignment === "horizontalCenter" ? bounds.reduce((sum, value) => sum + (value.minX + value.maxX) / 2, 0) / bounds.length
              : bounds.reduce((sum, value) => sum + (value.minY + value.maxY) / 2, 0) / bounds.length
    next.primitives = next.primitives.map((primitive) => {
      if (!operation.ids.includes(primitive.id)) return primitive
      const value = primitiveBounds(primitive)!
      const x = operation.alignment === "left" ? target - value.minX
        : operation.alignment === "right" ? target - value.maxX
          : operation.alignment === "horizontalCenter" ? target - (value.minX + value.maxX) / 2 : 0
      const y = operation.alignment === "top" ? target - value.maxY
        : operation.alignment === "bottom" ? target - value.minY
          : operation.alignment === "verticalCenter" ? target - (value.minY + value.maxY) / 2 : 0
      return translatePrimitive(primitive, x, y)
    })
    changedIds = operation.ids
  }
  try {
    const recomputed = recomputeDerivedObjects(next, changedIds)
    recomputed.revision += 1
    recomputed.metadata.updatedAt = new Date().toISOString()
    return { document: recomputed, changed: true }
  } catch (error) {
    return { document, changed: false, error: error instanceof Error ? error.message : "Failed to recompute document" }
  }
}
