import type { AnnotationSpec, ConstraintSpec, Coordinate, DrawingSheetSpec, DrawingViewSpec, EngineeringAnnotation, GeometryDocument, GroupSpec, LayerSpec, Measurement3, Point3Binding, Point3Primitive, PointBinding, PrimitiveSpec, Section3Classification, Vector3 } from "@draw/dsl"
import { createDependencyGraph, adaptiveSampleFunctionSegments, arcConstraint, buildSolidTemplate, calculateMeasurement3, circleConstraint, createBuilderContext, dihedralMarker3, ellipseConstraint, evaluateLineParameters, evaluateParameterExpression, evaluateParameterExpressions, evaluatePlanarMeasurement, findExtrema, findInflectionPoints, findZeros, functionGraphConstraint, host3FromPrimitive, hyperbolaConstraint, intersectCirclesDetailed, intersectFaceSets, intersectLineCircleDetailed, intersectLinesDetailed, intersectSampledPrimitives, lineConstraint, numericalDerivative, numericalIntegralWithDiagnostics, numericalSecondDerivative, orderSectionPoints3, parabolaConstraint, polylineConstraint, rayConstraint, sectionConvexPolyhedron, sectionPolyhedron3, segmentConstraint, sharedRingEdge3, solveLineConstraints, type DihedralMarker3, type FaceRing3, type IntersectionResult, type PlanarConstraint, type PlanarMetric, type SampledPrimitive, type TemplateSolidPrimitive } from "@draw/geometry-kernel"

export type DomainOperation =
  | { op: "addPrimitive"; primitive: PrimitiveSpec }
  | { op: "addPrimitives"; primitives: PrimitiveSpec[] }
  | { op: "updatePrimitive"; id: string; patch: PrimitiveUpdatePatch }
  | { op: "toggleLock"; id: string; locked: boolean }
  | { op: "setParameter"; id: string; value: number; min?: number; max?: number; step?: number; label?: string; ownerId?: string }
  | { op: "deleteParameter"; id: string }
  | { op: "setParameterExpression"; id: string; expression: string }
  | { op: "addAnnotation"; annotation: AnnotationSpec }
  | { op: "deleteAnnotation"; id: string }
  | { op: "addEngineeringAnnotation"; annotation: EngineeringAnnotation }
  | { op: "deleteEngineeringAnnotation"; id: string }
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
  | { op: "addLayer"; layer: LayerSpec }
  | { op: "updateLayer"; id: string; patch: LayerUpdatePatch }
  | { op: "deleteLayer"; id: string; reassignTo?: string }
  | { op: "setActiveLayer"; id: string }
  | { op: "addDrawingSheet"; sheet: DrawingSheetSpec }
  | { op: "updateDrawingSheet"; id: string; patch: DrawingSheetUpdatePatch }
  | { op: "addDrawingView"; view: DrawingViewSpec }
  | { op: "updateDrawingView"; id: string; patch: DrawingViewUpdatePatch }
  | { op: "deleteDrawingView"; id: string }
  | { op: "translatePrimitive"; id: string; delta: { x: number; y: number } }
  /**
   * 自由拖动（立体几何）：按世界向量整体平移一个空间对象。
   * 由点驱动的对象平移它自己的点，模板实体平移自己的定位参数，生成拓扑由重算跟随。
   */
  | { op: "translatePrimitive3"; id: string; delta: Vector3 }
  /**
   * 沿自身法向平移剖切面（截面专用）。`distance` 为世界单位的有符号位移，正值朝法向方向。
   * 截面点由 `recomputeSection` 在同一事务里重算，所以"移动剖切面"和"截面形状更新"永远一致。
   */
  | { op: "moveSectionPlane"; id: string; distance: number }
  /** 绕世界轴旋转剖切面。`pivot` 省略时绕平面上离原点最近的点转；界面传实体中心，刀口才是"绕着图形摆斜"。 */
  | { op: "rotateSectionPlane"; id: string; axis: "x" | "y" | "z"; degrees: number; pivot?: Vector3 }
  /** 直接给定剖切面（例如"用某个面当剖切面"）。 */
  | { op: "setSectionPlane"; id: string; normal: Vector3; constant: number }

export type Alignment = "left" | "right" | "top" | "bottom" | "horizontalCenter" | "verticalCenter"

export type LayerUpdatePatch = Partial<Omit<LayerSpec, "id">>
export type DrawingSheetUpdatePatch = Partial<Omit<DrawingSheetSpec, "id">>
export type DrawingViewUpdatePatch = Partial<Omit<DrawingViewSpec, "id">>

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
  /** Euler orientation of a parameterized solid, in radians; omitted axes keep their current angle. */
  rotation3?: Partial<Vector3>
  /** Drawn half-extent of a `plane3` patch; null returns it to automatic sizing. */
  halfSize?: number | null
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

function shiftedPoint(point: Vector3, delta: Vector3): Vector3 {
  return { x: point.x + delta.x, y: point.y + delta.y, z: point.z + delta.z }
}

function point3Index(document: GeometryDocument): Map<string, Point3Primitive> {
  return new Map(document.primitives.filter((candidate): candidate is Point3Primitive => candidate.type === "point3").map((point) => [point.id, point]))
}

/** Point-driven objects only reference their points; those points are what a drag has to move. */
function managedPointIds(primitive: PrimitiveSpec): string[] {
  if (primitive.type === "line3") return primitive.definition.kind === "throughPoints" ? [...primitive.definition.pointIds] : [primitive.definition.pointId]
  if (primitive.type === "segment3" || primitive.type === "edge3") return [...primitive.pointIds]
  if (primitive.type === "ray3") return [primitive.originId, primitive.throughId]
  if (primitive.type === "plane3") return primitive.definition.kind === "throughPoints" ? [...primitive.definition.pointIds] : [primitive.definition.pointId]
  if (primitive.type === "face3") return [...primitive.pointIds]
  if (primitive.type === "polyhedron3") return [...primitive.vertexIds]
  return []
}

/**
 * Every point/edge/face a template solid materialised. Those children are drawn from their parent, so a drag
 * has to move the parent; letting a child move on its own would silently pull the solid apart.
 */
export function templateTopologyIds(document: GeometryDocument): Set<string> {
  const ids = new Set<string>()
  for (const primitive of document.primitives) {
    if (primitive.type !== "polyhedron3" || primitive.construction?.kind !== "template") continue
    for (const childId of [...primitive.vertexIds, ...primitive.edgeIds, ...primitive.faceIds]) ids.add(childId)
  }
  return ids
}

/**
 * Whether free dragging may move this object at all. Generated topology is excluded (above); planes and
 * point-driven lines/edges/faces only move when the points they are defined by can move; bound points belong
 * to whatever binds them.
 */
export function isFreeDraggable3(primitive: PrimitiveSpec, points: Map<string, Point3Primitive>, generated: Set<string> = new Set()): boolean {
  if (primitive.locked) return false
  if (generated.has(primitive.id)) return false
  if (primitive.type === "point3") return !primitive.binding || primitive.binding.kind === "free"
  if (primitive.type === "cube" || primitive.type === "pyramid" || primitive.type === "cylinder" || primitive.type === "cone") return true
  if (!["line3", "segment3", "ray3", "plane3", "face3", "polyhedron3", "edge3"].includes(primitive.type)) return false
  const owned = managedPointIds(primitive)
  if (owned.length === 0) return false
  return owned.every((id) => {
    if (generated.has(id)) return false
    const point = points.get(id)
    return Boolean(point) && (!point!.binding || point!.binding.kind === "free")
  })
}

/**
 * Translate an object along a world vector. The object's own geometry is either a stored parameter (a template
 * solid's anchor, or a free point's position) or an inherited reference to its points; `movedIds` names what
 * else this drag has to move, which is also what tells the dependent recompute what to re-derive.
 */
function translatePrimitive3(primitive: PrimitiveSpec, delta: Vector3): { primitive: PrimitiveSpec; movedIds: string[] } {
  if (primitive.type === "point3") {
    if (primitive.binding && primitive.binding.kind !== "free") return { primitive, movedIds: [] }
    return { primitive: { ...primitive, position: shiftedPoint(primitive.position, delta) }, movedIds: [primitive.id] }
  }
  if (primitive.type === "cube") return { primitive: { ...primitive, origin: shiftedPoint(primitive.origin, delta) }, movedIds: [primitive.id] }
  if (primitive.type === "pyramid") return { primitive: { ...primitive, baseCenter: shiftedPoint(primitive.baseCenter, delta) }, movedIds: [primitive.id] }
  if (primitive.type === "cylinder" || primitive.type === "cone") return { primitive: { ...primitive, center: shiftedPoint(primitive.center, delta) }, movedIds: [primitive.id] }
  return { primitive, movedIds: managedPointIds(primitive) }
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
    // 宿主绑定：宿主先算，绑定点后算（拓扑序因此自动正确）。
    if (primitive.binding.kind === "onHost") dependencies.push(primitive.binding.hostId)
    if (primitive.binding.kind === "onFace") dependencies.push(primitive.binding.faceId)
    if (primitive.binding.kind === "onSurface") dependencies.push(primitive.binding.solidId)
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
  // 连接（connection）只存两个点的引用，因此它依赖那些点；不含坐标，永远不会过期。
  if (primitive.type === "connection") dependencies.push(primitive.startPointId, primitive.endPointId, ...(primitive.control?.thirdPointId ? [primitive.control.thirdPointId] : []))
  if (primitive.type === "intersection") dependencies.push(primitive.lineA, primitive.lineB)
  if (primitive.type === "lineCircleIntersection") dependencies.push(primitive.lineId, primitive.circleId)
  if (primitive.type === "circleIntersection") dependencies.push(primitive.circleA, primitive.circleB)
  if (primitive.type === "curveIntersection") dependencies.push(primitive.objectA, primitive.objectB)
  if (primitive.type === "intersectionSet") dependencies.push(primitive.objectA, primitive.objectB)
  if (primitive.type === "intersectionLine") dependencies.push(...primitive.sourceIds)
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
    const halfY = primitive.baseSize.y / 2
    const { baseCenter } = primitive
    // 世界是 Z 轴朝上（与 `buildSolidTemplate` 一致）：底面铺在 XY 平面、顶点沿 +Z。
    // 旧实现把底面放在 XZ、顶点沿 +Y，于是"默认剖切面取包围盒中心的 y"算到了实体之外——
    // 上一轮实测的"棱锥/圆柱/圆锥默认截面错位"就是这个坐标系不一致。
    const vertices = [
      { x: baseCenter.x - halfX, y: baseCenter.y - halfY, z: baseCenter.z },
      { x: baseCenter.x + halfX, y: baseCenter.y - halfY, z: baseCenter.z },
      { x: baseCenter.x + halfX, y: baseCenter.y + halfY, z: baseCenter.z },
      { x: baseCenter.x - halfX, y: baseCenter.y + halfY, z: baseCenter.z },
      { x: baseCenter.x, y: baseCenter.y, z: baseCenter.z + primitive.height }
    ]
    return { vertices, edges: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [1, 4], [2, 4], [3, 4]] }
  }
  const ring = (z: number) => Array.from({ length: primitive.segments }, (_, index) => {
    const angle = index * Math.PI * 2 / primitive.segments
    return { x: primitive.center.x + primitive.radius * Math.cos(angle), y: primitive.center.y + primitive.radius * Math.sin(angle), z }
  })
  const edgesBetween = (offset: number): [number, number][] => {
    const edges: [number, number][] = []
    for (let index = 0; index < primitive.segments; index += 1) {
      const next = (index + 1) % primitive.segments
      edges.push([offset + index, offset + next])
      if (offset > 0) edges.push([index, offset + index])
    }
    return edges
  }
  if (primitive.type === "cylinder") {
    const bottom = ring(primitive.center.z)
    const top = ring(primitive.center.z + primitive.height)
    const vertices = [...bottom, ...top]
    return { vertices, edges: [...edgesBetween(0), ...edgesBetween(primitive.segments).slice(primitive.segments)] }
  }
  // 圆锥：只有一个底面圆 + 顶点。旧实现建了上下两个同半径的环、顶点又落在上环高度上，
  // 等于"顶面被扇形封口的圆柱"——任何未被物化的圆锥文档其截面与面环都是错的。
  const vertices = [...ring(primitive.center.z), { x: primitive.center.x, y: primitive.center.y, z: primitive.center.z + primitive.height }]
  const apex = primitive.segments
  const edges: [number, number][] = []
  for (let index = 0; index < primitive.segments; index += 1) {
    edges.push([index, (index + 1) % primitive.segments], [index, apex])
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
export function sectionSourceVertices(document: GeometryDocument, sourceId: string): Vector3[] {
  const primitiveMap = new Map(document.primitives.map((primitive) => [primitive.id, primitive]))
  const source = primitiveMap.get(sourceId)
  return source ? sourceVertices(source, primitiveMap) : []
}

/**
 * 截面的剖切面平移一段距离。平面以 `normal · p + constant = 0` 表示，沿法向走 `distance` 时**只改常数项**：
 * `constant - distance * |normal|`。这里刻意不把法向单位化——同时改法向和常数项会让平面额外漂移
 * （实测：法向 (0,3,4)、距离 1 时，平面会多走 2 个单位）。
 */
export function movedSectionPlane(plane: { normal: Vector3; constant: number }, distance: number): { normal: Vector3; constant: number } {
  const length = Math.hypot(plane.normal.x, plane.normal.y, plane.normal.z)
  if (!Number.isFinite(length) || length < 1e-9 || !Number.isFinite(distance)) return plane
  return { normal: plane.normal, constant: plane.constant - distance * length }
}

/** 剖切面沿法向到原点的有符号偏移（教学读数：平面相对原点走了多远）。 */
export function sectionPlaneOffset(plane: { normal: Vector3; constant: number }): number {
  const length = Math.hypot(plane.normal.x, plane.normal.y, plane.normal.z)
  return length < 1e-9 ? 0 : -plane.constant / length
}

function rotateVector(vector: Vector3, axis: "x" | "y" | "z", radians: number): Vector3 {
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  if (axis === "x") return { x: vector.x, y: vector.y * cos - vector.z * sin, z: vector.y * sin + vector.z * cos }
  if (axis === "y") return { x: vector.x * cos + vector.z * sin, y: vector.y, z: -vector.x * sin + vector.z * cos }
  return { x: vector.x * cos - vector.y * sin, y: vector.x * sin + vector.y * cos, z: vector.z }
}

/**
 * 绕世界轴旋转剖切面，枢轴默认取平面上离原点最近的点。
 * 绕**实体中心**转才是教学上想要的"把刀口摆斜"（见 `sectionPivotFor`）；枢轴参数化是为了让调用方给出
 * 那个中心，同时保留"绕平面自身垂足转"这一纯几何语义。
 */
export function rotatedSectionPlane(plane: { normal: Vector3; constant: number }, axis: "x" | "y" | "z", degrees: number, pivot?: Vector3): { normal: Vector3; constant: number } {
  const lengthSq = plane.normal.x ** 2 + plane.normal.y ** 2 + plane.normal.z ** 2
  if (!Number.isFinite(lengthSq) || lengthSq < 1e-18 || !Number.isFinite(degrees)) return plane
  const center = pivot ?? { x: -plane.constant * plane.normal.x / lengthSq, y: -plane.constant * plane.normal.y / lengthSq, z: -plane.constant * plane.normal.z / lengthSq }
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y) || !Number.isFinite(center.z)) return plane
  const normal = rotateVector(plane.normal, axis, degrees * Math.PI / 180)
  return { normal, constant: -(normal.x * center.x + normal.y * center.y + normal.z * center.z) }
}

/** 一组点的中心：截面的剖切面绕着它转，倾斜后的刀口才会仍然穿过实体、看得见截面。 */
export function sectionPivot(points: Vector3[]): Vector3 | null {
  if (points.length === 0) return null
  const centre = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y, z: sum.z + point.z }), { x: 0, y: 0, z: 0 })
  return { x: centre.x / points.length, y: centre.y / points.length, z: centre.z / points.length }
}

/** 点到平面的有符号距离：`normal·p + constant`（法向为单位向量时就是世界距离）。 */
export function sectionDistanceToPlane(plane: { normal: Vector3; constant: number }, point: Vector3): number {
  return plane.normal.x * point.x + plane.normal.y * point.y + plane.normal.z * point.z + plane.constant
}

export interface SectionPlaneGeometry {
  normal: Vector3
  constant: number
}

/**
 * 由一组共面点求它所在的平面（前三点定法向，再用全部点校正方向）。
 * 点不共面（例如圆柱侧面那圈顶点）或退化时返回 null——调用方据此明确拒绝，而不是塞一个瞎猜的平面。
 */
export function planeThroughPoints(points: Vector3[], tolerance = 1e-6): SectionPlaneGeometry | null {  if (points.length < 3) return null
  const subtract = (a: Vector3, b: Vector3): Vector3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
  const cross = (a: Vector3, b: Vector3): Vector3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
  const dot = (a: Vector3, b: Vector3) => a.x * b.x + a.y * b.y + a.z * b.z
  const [first, second, third] = points
  const normal = cross(subtract(second, first), subtract(third, first))
  const length = Math.hypot(normal.x, normal.y, normal.z)
  if (!Number.isFinite(length) || length < 1e-9) return null
  const unit = { x: normal.x / length, y: normal.y / length, z: normal.z / length }
  const constant = -dot(unit, points[0])
  // 判据是各点到平面的**绝对**距离。把容差乘上"点集尺寸"是错的：那样点集越大越松，
  // 圆柱侧面那圈顶点就会被当成一个平面（实测）。
  return points.every((point) => Math.abs(dot(unit, point) + constant) <= tolerance) ? { normal: unit, constant } : null
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

/** Resolve the drawable dihedral annotation for a stored dihedral measurement, or null when it cannot be drawn. */
export function resolveDihedralMarker3(document: GeometryDocument, measurementId: string): DihedralMarker3 | null {
  const measurement = document.measurements.find((candidate) => candidate.id === measurementId)
  if (!measurement || measurement.metric !== "dihedral" || measurement.sourceIds.length !== 2) return null
  const primitiveMap = new Map(document.primitives.map((primitive) => [primitive.id, primitive]))
  const faces: Extract<PrimitiveSpec, { type: "face3" }>[] = []
  for (const sourceId of measurement.sourceIds) {
    const source = primitiveMap.get(sourceId)
    if (source?.type !== "face3") return null
    faces.push(source)
  }
  const hinge = sharedRingEdge3(faces[0].pointIds, faces[1].pointIds)
  if (!hinge) return null
  const firstPoints: Vector3[] = []
  const secondPoints: Vector3[] = []
  for (const pointId of faces[0].pointIds) {
    const point = primitiveMap.get(pointId)
    if (point?.type !== "point3") return null
    firstPoints.push({ ...point.position })
  }
  for (const pointId of faces[1].pointIds) {
    const point = primitiveMap.get(pointId)
    if (point?.type !== "point3") return null
    secondPoints.push({ ...point.position })
  }
  const hingeStart = primitiveMap.get(hinge[0])
  const hingeEnd = primitiveMap.get(hinge[1])
  if (hingeStart?.type !== "point3" || hingeEnd?.type !== "point3") return null
  return dihedralMarker3(firstPoints, secondPoints, { ...hingeStart.position }, { ...hingeEnd.position })
}

/** Default cutting plane: the **horizontal** plane (normal +Z, world is Z-up) through the source's
 * bounding-box centre. Returns null when the source vertices cannot be resolved, so callers never
 * persist a fabricated plane. */
export function sectionPlaneThroughSource(document: GeometryDocument, sourceId: string): { normal: Vector3; constant: number } | null {
  const primitiveMap = new Map(document.primitives.map((primitive) => [primitive.id, primitive]))
  const source = primitiveMap.get(sourceId)
  const vertices = source ? sourceVertices(source, primitiveMap) : []
  if (vertices.length === 0) return null
  const heights = vertices.map((vertex) => vertex.z)
  return { normal: { x: 0, y: 0, z: 1 }, constant: -(Math.min(...heights) + Math.max(...heights)) / 2 }
}

function recomputeSection(primitive: Extract<PrimitiveSpec, { type: "section" }>, source: PrimitiveSpec, primitiveMap: Map<string, PrimitiveSpec>): Extract<PrimitiveSpec, { type: "section" }> {
  const polyhedron = source.type === "polyhedron3" ? source : templateTopology(source.id, primitiveMap)
  const topology = polyhedron ? polyhedronSectionTopology(polyhedron, primitiveMap) : null
  if (topology) {
    const result = sectionPolyhedron3(topology.vertices, topology.faces, primitive.plane)
    if (result.status === "none") return { ...primitive, points: [], loops: [], classification: "none", status: "undefined", visible: false, diagnostic: result.explanation }
    if (result.status === "insufficient-data") return { ...primitive, points: [], loops: [], classification: "insufficient-data", status: "failed", visible: false, diagnostic: result.explanation }
    return { ...primitive, points: result.points, loops: result.loops, classification: result.status, status: "approximate", visible: result.status !== "point", diagnostic: result.status === "polygon" ? undefined : result.explanation }
  }
  if (!["cube", "pyramid", "cylinder", "cone"].includes(source.type)) return { ...primitive, points: [], loops: [], classification: "insufficient-data", status: "failed", visible: false, diagnostic: "截面来源不是可剖切的实体。" }
  const geometry = solidSectionGeometry(source as Extract<PrimitiveSpec, { type: "cube" | "pyramid" | "cylinder" | "cone" }>)
  const points = orderSectionPoints3(sectionConvexPolyhedron(geometry.vertices, geometry.edges, primitive.plane), primitive.plane)
  return { ...primitive, points, loops: points.length >= 3 ? [points] : [], classification: classifySectionPoints(points), status: points.length > 0 ? "approximate" : "undefined", visible: points.length > 0, diagnostic: points.length >= 3 ? undefined : "剖切平面与模板实体相切或沿棱相交。" }
}

/**
 * 交线来源的面环。
 * - `polyhedron3` / 四类模板：取物化拓扑的顶点+面环；
 * - `face3`：它自己就是一个面环；
 * - `plane3`：平面没有边界，不能作为"有界交线"的来源（返回 null，由调用方给诊断）。
 */
export function intersectionFaceRings(source: PrimitiveSpec, primitiveMap: Map<string, PrimitiveSpec>): Vector3[][] | null {
  if (source.type === "face3") {
    const points: Vector3[] = []
    for (const pointId of source.pointIds) {
      const point = primitiveMap.get(pointId)
      if (point?.type !== "point3") return null
      points.push({ ...point.position })
    }
    return points.length >= 3 ? [points] : null
  }
  const polyhedron = source.type === "polyhedron3" ? source : templateTopology(source.id, primitiveMap)
  if (!polyhedron) return null
  const topology = polyhedronSectionTopology(polyhedron, primitiveMap)
  if (!topology) return null
  return topology.faces.map((face) => face.map((index) => topology.vertices[index]))
}

/**
 * 交线随来源重算：两个来源的面环两两求交，去重合并后写回 `segments`。
 * 与截面的区别：截面是"一个平面切实体"，交线是"两个对象的公共边界"。
 */
function recomputeIntersectionLine(
  primitive: Extract<PrimitiveSpec, { type: "intersectionLine" }>,
  primitiveMap: Map<string, PrimitiveSpec>
): Extract<PrimitiveSpec, { type: "intersectionLine" }> {
  const sources = primitive.sourceIds.map((id) => primitiveMap.get(id))
  if (sources.some((source) => !source)) {
    return { ...primitive, segments: [], classification: "insufficient-data", status: "insufficient-data", visible: false, diagnostic: "交线来源对象不存在。" }
  }
  const rings = sources.map((source) => intersectionFaceRings(source!, primitiveMap))
  if (rings.some((entry) => !entry)) {
    return { ...primitive, segments: [], classification: "insufficient-data", status: "insufficient-data", visible: false, diagnostic: "交线来源缺少可用的面环（平面没有边界，模板需要已物化的拓扑）。" }
  }
  const result = intersectFaceSets(rings[0]!, rings[1]!)
  if (result.classification === "insufficient-data") {
    return { ...primitive, segments: [], classification: "insufficient-data", status: "insufficient-data", visible: false, diagnostic: result.explanation }
  }
  if (result.classification === "none") {
    return { ...primitive, segments: [], classification: "none", status: "degenerate", visible: false, diagnostic: [result.explanation, ...result.diagnostics].join(" ") }
  }
  return {
    ...primitive,
    segments: result.segments,
    classification: result.classification,
    status: "valid",
    visible: true,
    diagnostic: result.diagnostics.length > 0 ? result.diagnostics.join(" ") : undefined
  }
}

/**
 * 由文档里的曲线对象构造内核约束。
 *
 * **绑定参数就是该约束的自然参数**，不再一律归一化到 [0, 1]：
 *
 *   直线 / 射线 / 线段  仿射比例 t（直线与射线**不截断**）
 *   圆 / 弧 / 椭圆      角度 θ（弧度）
 *   折线               按弧长归一化的比例
 *   函数图像           x 本身
 *
 * 统一归一化对直线是致命的：直线在画布上横贯整个视野，但 `clamp(t, 0, 1)` 会把点锁在
 * `a..b` 这一段里 —— 用户看到一条长线，点却只能在中间一小段滑动。
 * 交给内核约束之后，正向映射（`evaluate`）与反向映射（`project`）由同一份定义保证互逆。
 */
export function pathConstraint(path: PrimitiveSpec, parameters: GeometryDocument["parameters"]): PlanarConstraint | null {
  if (path.type === "line") return lineConstraint(path.id, path.a, path.b)
  if (path.type === "segment") return segmentConstraint(path.id, path.a, path.b)
  if (path.type === "ray") return rayConstraint(path.id, path.a, path.b)
  if (path.type === "circle") return circleConstraint(path.id, path.center, path.radius)
  if (path.type === "arc") return arcConstraint(path.id, path.center, path.radius, path.startAngle, path.endAngle)
  if (path.type === "polyline") return polylineConstraint(path.id, path.points)
  if (path.type === "ellipse") return ellipseConstraint(path.id, path)
  // 抛物线与双曲线的自然参数是无界的轴向参数 u，所以它们需要绑定自带一个 `domain` 作为扫描窗口。
  if (path.type === "parabola") return parabolaConstraint(path.id, path)
  if (path.type === "hyperbola") return hyperbolaConstraint(path.id, path)
  if (path.type === "function") {
    const variables = Object.fromEntries(Object.entries(parameters).map(([id, spec]) => [id, spec.value]))
    return functionGraphConstraint(path.id, (x) => evaluateParameterExpression(path.expression, { ...variables, x }), path.domain)
  }
  return null
}

/**
 * 滑块、动画与轨迹扫描用的**参数窗口**。
 *
 * 有界约束直接用它的参数域；无界约束（直线、射线、抛物线、双曲线）没有有限域：
 * 抛物线与双曲线优先用绑定自带的 `domain`（用户可编辑），没有就取一个与图形尺度成比例的窗口；
 * 直线与射线用与 `a→b` 长度成比例的窗口。
 *
 * 注意这个窗口**只决定滑块与轨迹扫多远**，拖动本身不受它限制（`dragBoundPoint` 直接写参数值）。
 */
export function parameterWindow(path: PrimitiveSpec, parameters: GeometryDocument["parameters"], domain?: readonly [number, number]): { min: number; max: number } {
  const bounds = pathConstraint(path, parameters)?.parameterBounds()
  if (bounds && Number.isFinite(bounds.min) && Number.isFinite(bounds.max)) return { min: bounds.min, max: bounds.max }
  // 抛物线/双曲线：绑定里的 domain 是权威的（用户可改），否则给一个与焦参数/半径成比例的默认窗口。
  if (domain && Number.isFinite(domain[0]) && Number.isFinite(domain[1]) && domain[0] < domain[1]) return { min: domain[0], max: domain[1] }
  // 直线的 t 以 a→b 为单位长度，所以 ±2 就是"往两头各延伸两个 a..b 那么长"。
  if (path.type === "line") return { min: -2, max: 2 }
  if (path.type === "ray") return { min: 0, max: 3 }
  if (path.type === "parabola") {
    const scale = Math.max(1, Math.abs(path.focalParameter) * 2)
    return { min: -scale, max: scale }
  }
  if (path.type === "hyperbola") {
    const scale = Math.max(1, Math.abs(path.radiusX) * 2)
    return { min: -scale, max: scale }
  }
  return { min: 0, max: 1 }
}

/** 把世界坐标投影到约束曲线上，返回自然参数。与 `resolveBoundPoint` 是同一份定义的正反两面。 */
function projectOntoPath(path: PrimitiveSpec, desired: Coordinate, parameters: GeometryDocument["parameters"], branch?: 0 | 1): number | null {
  // 双曲线必须锁在绑定记录的那一支上，否则拖过渐近线时点会跳到对面那一支。
  const projection = pathConstraint(path, parameters)?.project(desired, branch === undefined ? {} : { previousBranch: branch })
  return projection ? projection.parameter : null
}

/**
 * 拖拽一个被约束的点：把"当前位置 + 增量"投影回曲线，写回参数。
 *
 * 自由点是直接加 x/y 的，但约束点不能这么做 —— 下一个重算会立刻用旧参数把坐标覆盖回去，
 * 拖动等于没发生。参数写两处：
 *   - `binding.parameter`：点自己的参数；
 *   - 若绑定了文档参数，同时写它的值，因为 `resolveBoundPoint` 在有 `parameterId` 时只看那个参数。
 */
function dragBoundPoint(point: Extract<PrimitiveSpec, { type: "point" }>, delta: Coordinate, primitiveMap: Map<string, PrimitiveSpec>, parameters: GeometryDocument["parameters"]): { point: Extract<PrimitiveSpec, { type: "point" }>; parameterValue: { id: string; value: number } | null } | null {
  if (point.binding?.kind !== "onPath") return null
  const path = primitiveMap.get(point.binding.pathId)
  if (!path) return null
  const projected = projectOntoPath(path, { x: point.x + delta.x, y: point.y + delta.y }, parameters, point.binding.branch)
  if (projected === null) return null
  const binding: PointBinding = { ...point.binding, parameter: projected }
  return {
    point: { ...point, binding },
    parameterValue: binding.parameterId ? { id: binding.parameterId, value: projected } : null
  }
}

function resolveBoundPoint(binding: PointBinding, primitives: Map<string, PrimitiveSpec>, parameters: GeometryDocument["parameters"]): Coordinate | null {
  if (binding.kind !== "onPath") return null
  const path = primitives.get(binding.pathId)
  if (!path) return null
  const parameter = binding.parameterId ? parameters[binding.parameterId]?.value : binding.parameter
  if (parameter === undefined || !Number.isFinite(parameter)) return null
  return pathConstraint(path, parameters)?.evaluate(parameter, binding.branch ?? 0) ?? null
}

function isSampledPrimitive(primitive: PrimitiveSpec | undefined): primitive is SampledPrimitive {
  return Boolean(primitive && ["line", "segment", "ray", "polyline", "circle", "arc", "parabola", "ellipse", "hyperbola", "function"].includes(primitive.type))
}

/**
 * 几何运算（求交）用的取样来源。
 *
 * `connection` 在文档里只存两个点的 id，没有自己的坐标，所以要先解析成真实端点才能参与运算 ——
 * 否则"两个动点之间连的线段"就只是一根装饰线，量不了也交不了。
 * 抛物线连接用的是二次贝塞尔控制点，不是真正的抛物线，故不在此列。
 */
function sampledSource(id: string, primitiveMap: Map<string, PrimitiveSpec>): SampledPrimitive | undefined {
  const primitive = primitiveMap.get(id)
  if (primitive?.type === "connection") {
    if (primitive.kind !== "segment" && primitive.kind !== "line" && primitive.kind !== "ray") return undefined
    const start = primitiveMap.get(primitive.startPointId)
    const end = primitiveMap.get(primitive.endPointId)
    if (start?.type !== "point" || end?.type !== "point") return undefined
    const a = { x: start.x, y: start.y }
    const b = { x: end.x, y: end.y }
    return { id: primitive.id, type: primitive.kind, a, b }
  }
  return isSampledPrimitive(primitive) ? primitive : undefined
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

/**
 * 受影响对象的**拓扑重算顺序**：任一对象的依赖都排在它前面。
 *
 * 主重算流程原来是"取所有受影响对象，按数组顺序各重算一次"，只在对象恰好按依赖顺序创建时正确。
 * 用拓扑序之后：一趟就能算完（`recomputeBoundPoint3s` 那个"最多重跑 N 遍直到不动"的循环因此可以去掉），
 * 并且能保证下游读到的是**刚算出来的**上游值。
 *
 * 两个安全措施：
 * - 依赖里只有真实存在的图元才建边（`slopeParameter` / `parameterId` 这类参数 id 不是图元，
 *   它们的值在参数求值的前置步骤里已经应用过，不需要参与排序）；
 * - 环里的节点不会出现在拓扑序中，直接过滤会**静默漏算**，所以按文档顺序补在末尾。
 */
export function topologicalRecomputeOrder(document: GeometryDocument, changedIds?: string[]): string[] {
  const graph = createDependencyGraph()
  const primitiveIds = new Set(document.primitives.map((primitive) => primitive.id))
  for (const primitive of document.primitives) {
    graph.addNode(primitive.id, primitiveDependencies(primitive).filter((dependency) => primitiveIds.has(dependency)))
  }
  const affected = changedIds === undefined ? primitiveIds : getAffectedPrimitiveIds(document, changedIds)
  const ordered = graph.topologicalOrder().filter((id) => affected.has(id))
  const seen = new Set(ordered)
  for (const primitive of document.primitives) {
    if (!affected.has(primitive.id) || seen.has(primitive.id)) continue
    ordered.push(primitive.id)
    seen.add(primitive.id)
  }
  return ordered
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

/** 宿主参数一律夹到宿主声明的域内：否则"参数 2"在 [0,1] 的线段上会把点扔到线段之外。 */
function clampHostParameter(value: number, domain: readonly [number, number]): number {
  return Math.min(Math.max(value, domain[0]), domain[1])
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
  /**
   * 宿主绑定：坐标完全由参数算出（参数是唯一真值）。
   * 宿主解析不了时返回 null，调用方会保留点上一次的坐标——不静默把点挪到别处。
   */
  if (binding.kind === "onHost" || binding.kind === "onFace" || binding.kind === "onSurface") {
    const sourceId = binding.kind === "onHost" ? binding.hostId : binding.kind === "onFace" ? binding.faceId : binding.solidId
    const source = primitives.get(sourceId)
    const host = source ? host3FromPrimitive(source, primitives) : null
    if (!host) return null
    if (binding.kind === "onHost") {
      if (!Number.isFinite(binding.parameter)) return null
      return host.evaluate({ u: clampHostParameter(binding.parameter, host.domain.u) })
    }
    const [u, v] = binding.uv
    if (!Number.isFinite(u) || !Number.isFinite(v)) return null
    const vDomain = host.domain.v ?? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]
    return host.evaluate({ u: clampHostParameter(u, host.domain.u), v: clampHostParameter(v, vDomain) })
  }
  if (binding.feature === "midpoint" && binding.sourceIds.length >= 2) {
    const first = point3Position(primitives.get(binding.sourceIds[0]), points)
    const second = point3Position(primitives.get(binding.sourceIds[1]), points)
    if (first && second) return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2, z: (first.z + second.z) / 2 }
  }
  return null
}

/**
 * 把一个截面物化成**独立图元**：每一环生成 point3 + edge3 + face3。
 *
 * 刻意不写 `sourceId`——物化出来的几何与来源解耦：删掉宿主不影响它们，
 * 它们也能被移动、求交、测量（这正是"可以获取截面图元"的含义）。
 * 返回的数组顺序是"点 → 棱 → 面"，调用方用一条 `addPrimitives` 提交即可。
 */
export function sectionMaterialization(document: GeometryDocument, sectionId: string): PrimitiveSpec[] | null {
  const section = document.primitives.find((primitive) => primitive.id === sectionId)
  if (section?.type !== "section") return null
  const loops = (section.loops && section.loops.length > 0 ? section.loops : [section.points]).filter((loop) => loop.length >= 3)
  if (loops.length === 0) return null
  const label = section.label ?? section.id
  const stroke = section.style?.stroke ?? "#f97316"
  const primitives: PrimitiveSpec[] = []
  loops.forEach((loop, loopIndex) => {
    const suffix = loops.length > 1 ? ` ${loopIndex + 1}` : ""
    const pointIds = loop.map((point, pointIndex) => {
      const id = `${section.id}-p${loopIndex + 1}-${pointIndex + 1}`
      primitives.push({ id, type: "point3", position: { ...point }, binding: { kind: "free" }, label: `${label} 顶点${suffix}-${pointIndex + 1}`, style: { stroke, fill: stroke } })
      return id
    })
    const edgeIds = loop.map((_, pointIndex) => {
      const id = `${section.id}-e${loopIndex + 1}-${pointIndex + 1}`
      primitives.push({ id, type: "edge3", pointIds: [pointIds[pointIndex], pointIds[(pointIndex + 1) % loop.length]], label: `${label} 棱${suffix}-${pointIndex + 1}`, style: { stroke } })
      return id
    })
    primitives.push({ id: `${section.id}-f${loopIndex + 1}`, type: "face3", pointIds, edgeIds, label: `${label} 面${suffix}`, style: { stroke, fill: `${stroke}33` } })
  })
  return primitives
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
  // 受约束的 point3 不再需要"最多重跑 N 遍直到不动"的多趟循环：
  // 主重算按拓扑序走，且每算完一个对象就更新查找表，一趟即可收敛。
  syncTemplateTopology(projectedPrimitives)
  const circles = new Map(
    projectedPrimitives
      .filter((primitive): primitive is Extract<PrimitiveSpec, { type: "circle" }> => primitive.type === "circle")
      .map((circle) => [circle.id, circle])
  )
  const primitiveMap = new Map(projectedPrimitives.map((primitive) => [primitive.id, primitive]))
  /**
   * 重算单个对象。返回 `undefined` 表示这个类型不参与本趟重算。
   *
   * 抽成函数是为了让主循环按**拓扑序**遍历，并在每算完一个对象后立刻更新 `primitiveMap` ——
   * 这样下游读到的是刚刚算出来的上游值，而不是本趟开始前的那份快照。
   */
  /**
 * 从多解里挑一个：
 * - 有 `hint` 时取**离 hint 最近的解**——解的数量或顺序随形状变化时不会串位（吸引域语义，与 SolveSpace 一致）；
 * - 没有 hint 时退回下标；下标越界取最后一个，而不是静默回到第 0 个。
 * 调用方会把选中的解写回 `hint`，于是下一次重算继续跟着它。
 */
function pickSolution<T extends { x: number; y: number }>(points: T[], solutionIndex: number | undefined, hint: { x: number; y: number } | undefined): T | null {
  if (points.length === 0) return null
  if (hint) {
    let best = points[0]
    let bestDistance = Math.hypot(best.x - hint.x, best.y - hint.y)
    for (const candidate of points.slice(1)) {
      const distance = Math.hypot(candidate.x - hint.x, candidate.y - hint.y)
      if (distance < bestDistance) {
        best = candidate
        bestDistance = distance
      }
    }
    return best
  }
  const index = Number.isInteger(solutionIndex) && (solutionIndex ?? 0) >= 0 ? (solutionIndex as number) : 0
  return points[Math.min(index, points.length - 1)]
}

const recomputePrimitive = (primitive: PrimitiveSpec): PrimitiveSpec | undefined => {
    if (primitive.type === "point3" && primitive.binding) {
      const position = resolveBoundPoint3(primitive, primitiveMap)
      return position ? { ...primitive, position } : undefined
    }
    if (primitive.type === "point" && primitive.binding) {
      const point = resolveBoundPoint(primitive.binding, primitiveMap, parameters)
      return point ? { ...primitive, x: point.x, y: point.y } : undefined
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
    if (primitive.type === "intersectionLine") return recomputeIntersectionLine(primitive, primitiveMap)
    if (primitive.type === "line") return lines.get(primitive.id)
    if (primitive.type === "intersectionSet") {
      const first = sampledSource(primitive.objectA, primitiveMap)
      const second = sampledSource(primitive.objectB, primitiveMap)
      if (!first || !second) throw new Error("intersection set references unsupported objects")
      const result = intersectSampledPrimitives(first, second)
      if (result.kind === "degenerate") throw new Error(`degenerate intersection set: ${result.reason}`)
      if (result.kind === "none" || result.kind === "coincident") return { ...primitive, points: [], visible: false }
      if (result.kind === "point" || result.kind === "tangent") return { ...primitive, points: [result.point], visible: true }
      return { ...primitive, points: result.points, visible: true }
    }
    if (primitive.type === "curveIntersection") {
      const first = sampledSource(primitive.objectA, primitiveMap)
      const second = sampledSource(primitive.objectB, primitiveMap)
      if (!first || !second) throw new Error("curve intersection references unsupported objects")
      const result = intersectSampledPrimitives(first, second)
      if (result.kind === "degenerate") throw new Error(`degenerate curve intersection: ${result.reason}`)
      if (result.kind === "none" || result.kind === "coincident") return { ...primitive, visible: false }
      if (result.kind === "point" || result.kind === "tangent") return { ...primitive, x: result.point.x, y: result.point.y, visible: true }
      const point = pickSolution(result.points, primitive.solutionIndex, primitive.hint)
      return point ? { ...primitive, x: point.x, y: point.y, hint: { x: point.x, y: point.y }, visible: true } : { ...primitive, visible: false }
    }
    if (primitive.type !== "intersection" && primitive.type !== "lineCircleIntersection" && primitive.type !== "circleIntersection") return undefined
    const result = resolveIntersection(primitive, lines, circles)
    if (result.kind === "degenerate") throw new Error(`degenerate intersection: ${result.reason}`)
    if (result.kind === "none" || result.kind === "coincident") return { ...primitive, visible: false }
    if (result.kind === "point" || result.kind === "tangent") return { ...primitive, x: result.point.x, y: result.point.y, visible: true }
    const point = primitive.type === "intersection" ? result.points[0] : pickSolution(result.points, primitive.solutionIndex, primitive.hint)
    if (!point) return { ...primitive, visible: false }
    return primitive.type === "intersection"
      ? { ...primitive, x: point.x, y: point.y, visible: true }
      : { ...primitive, x: point.x, y: point.y, hint: { x: point.x, y: point.y }, visible: true }
  }
  const primitives = [...projectedPrimitives]
  for (const id of topologicalRecomputeOrder(evaluatedDocument, changedIds)) {
    const index = primitiveIndexById.get(id)
    if (index === undefined) continue
    const recomputed = recomputePrimitive(primitives[index])
    if (recomputed === undefined || recomputed === primitives[index]) continue
    primitives[index] = recomputed
    // 关键：下游对象必须看到刚算出来的上游值，而不是本趟开始前的快照。
    primitiveMap.set(id, recomputed)
  }
  // 测量只在它的来源对象真的进了脏集时才重算 —— 这是依赖图剪枝在测量上的体现。
  // 来源都没变时保留上一次的读数（值本身就存在文档里），所以"拖一个和它无关的点"不会触发它。
  const measurements = evaluatedDocument.measurements.map((measurement) => {
    if (changedIds !== undefined && !measurement.sourceIds.some((id) => affected.has(id))) return measurement
    return evaluatedDocument.workspace === "geometry3d"
      ? calculateMeasurement3(measurement, primitives)
      : calculatePlanarMeasurement(measurement, primitives)
  })
  return { ...evaluatedDocument, primitives, measurements }
}

/**
 * 平面（2D）测量。
 *
 * 复用 `Measurement3` 这个既有容器，而不是新增一套 DSL 类型：`Measurement3Metric` 已经包含
 * length / distance / angle / area，状态枚举也与内核的 `MeasurementStatus` 逐字一致，
 * 因此归档格式、对象列表、检查器和导出器都不需要改动。求值则交给内核的 `evaluatePlanarMeasurement`，
 * 由它负责退化判定（重合点、零向量、三点共线）与 atan2 角度。
 *
 * 两处映射：
 * - `dihedralKind`（interior / exterior）同时承载平面角的取角方式，沿用已有的按钮签名；
 * - 平面量的值都是数值计算的，所以 `precision` 固定为 `numeric-approximation`。
 */
function calculatePlanarMeasurement(measurement: Measurement3, primitives: PrimitiveSpec[]): Measurement3 {
  const positions = new Map<string, Coordinate>()
  for (const primitive of primitives) {
    if (primitive.type === "point") positions.set(primitive.id, { x: primitive.x, y: primitive.y })
  }
  const reading = evaluatePlanarMeasurement({
    id: measurement.id,
    metric: measurement.metric as PlanarMetric,
    sourceIds: measurement.sourceIds,
    angleKind: measurement.dihedralKind === "exterior" ? "exterior" : "interior"
  }, (id) => positions.get(id) ?? null)
  return {
    ...measurement,
    value: reading.value ?? undefined,
    unit: reading.unit,
    status: reading.status,
    precision: "numeric-approximation",
    explanation: reading.explanation
  }
}

/** Derivative curve, tangent, normal, secant, integral region and analysis set all describe one function. */
function functionAnalysisSourceId(primitive: PrimitiveSpec): string | null {
  switch (primitive.type) {
    case "derivative":
    case "tangent":
    case "normal":
    case "secant":
    case "integral":
    case "analysisSet":
      return primitive.sourceId
    default:
      return null
  }
}

/**
 * 参数是否仍被某个图元引用。两个用途：回收自动生成的驱动参数时确认它真的成了孤儿，
 * 以及拒绝删除仍被绑定的参数。调用前应先完成图元的增删，这样判断的是**当前**状态。
 */
export function parameterIsReferenced(document: GeometryDocument, parameterId: string): boolean {
  return document.primitives.some((primitive) => {
    if (primitive.type === "line" && primitive.slopeParameter === parameterId) return true
    if (primitive.type === "point" && primitive.binding?.kind === "onPath" && primitive.binding.parameterId === parameterId) return true
    if (primitive.type === "locus" && primitive.parameterId === parameterId) return true
    if (primitive.type === "polyhedron3" && primitive.construction?.kind === "template") return (primitive.construction.parameterIds ?? []).includes(parameterId)
    return false
  })
}

/**
 * 一个图元"纯派生"地依赖哪些对象 —— 也就是"这些来源没了，它就没有独立存在的意义"。
 *
 * 这些对象在删除时会被级联带走，而不是以"object is referenced by another object"拒绝删除。
 * 判据是**派生性**：交点、轨迹、连接都完全由来源决定，自己不含任何独立几何。
 */
function cascadeSources(primitive: PrimitiveSpec): string[] {
  if (primitive.type === "intersection") return [primitive.lineA, primitive.lineB]
  if (primitive.type === "lineCircleIntersection") return [primitive.lineId, primitive.circleId]
  if (primitive.type === "circleIntersection") return [primitive.circleA, primitive.circleB]
  if (primitive.type === "curveIntersection") return [primitive.objectA, primitive.objectB]
  if (primitive.type === "intersectionSet") return [primitive.objectA, primitive.objectB]
  if (primitive.type === "locus") return [primitive.sourcePointId]
  if (primitive.type === "connection") return [primitive.startPointId, primitive.endPointId, ...(primitive.control?.thirdPointId ? [primitive.control.thirdPointId] : [])]
  // 截面与截线同样是**纯派生**对象：删掉来源实体时用户不该先手动清掉它们。
  if (primitive.type === "section") return [primitive.sourceId]
  if (primitive.type === "intersectionLine") return primitive.sourceIds
  const analysisSource = functionAnalysisSourceId(primitive)
  return analysisSource === null ? [] : [analysisSource]
}

/**
 * 一次删除要连带处理的东西。
 *
 * 语义（用户已确认）：**派生与标注随宿主一起注销**，用户自己搭出来的构造引用仍然拒绝删除
 * （除非一起选中——那条路由 `validateDeletion` 做并集校验）。
 * 绑定点不删：宿主没了就把它**降级为自由点**并保留位置，不静默吞掉用户的内容。
 */
export interface DeletionPlan {
  primitives: Set<string>
  measurements: Set<string>
  annotations: Set<string>
  engineeringAnnotations: Set<string>
  constraints: Set<string>
  groupMembers: Set<string>
}

export function deletionPlan(document: GeometryDocument, ids: string[]): DeletionPlan {
  const primitives = new Set(ids.flatMap((id) => [...deletionTargets(document, id)]))
  return {
    primitives,
    measurements: new Set(document.measurements.filter((measurement) => measurement.sourceIds.some((sourceId) => primitives.has(sourceId))).map((measurement) => measurement.id)),
    annotations: new Set(document.annotations.filter((annotation) => (typeof annotation.target === "string" && primitives.has(annotation.target)) || (annotation.anchor?.kind === "primitive" && primitives.has(annotation.anchor.primitiveId))).map((annotation) => annotation.id)),
    engineeringAnnotations: new Set((document.engineeringAnnotations ?? []).filter((annotation) => annotation.sourceIds.some((sourceId) => primitives.has(sourceId))).map((annotation) => annotation.id)),
    constraints: new Set(document.constraints.filter((constraint) => constraint.targets.some((target) => primitives.has(target))).map((constraint) => constraint.id)),
    // 分组是用户的容器：只把被删成员摘掉，空分组保留（不替用户丢东西）。
    groupMembers: new Set(document.groups.flatMap((group) => group.members).filter((member) => primitives.has(member)))
  }
}

/** 宿主被删除时把引用它的点降级为自由点（位置保留），避免悬空引用让文档存不下去。 */
function unbindDeletedHost(primitive: PrimitiveSpec, deleted: Set<string>): PrimitiveSpec {
  if (primitive.type === "point3" && primitive.binding && primitive.binding.kind !== "free") {
    const binding = primitive.binding
    const hostId = binding.kind === "onLine" ? binding.lineId : binding.kind === "onPlane" ? binding.planeId : binding.kind === "onHost" ? binding.hostId : binding.kind === "onFace" ? binding.faceId : binding.kind === "onSurface" ? binding.solidId : null
    const sources = binding.kind === "derived" ? binding.sourceIds : hostId ? [hostId] : []
    if (sources.some((sourceId) => deleted.has(sourceId))) return { ...primitive, binding: { kind: "free" } }
  }
  if (primitive.type === "point" && primitive.binding?.kind === "onPath" && deleted.has(primitive.binding.pathId)) return { ...primitive, binding: { kind: "free" } }
  return primitive
}

/**
 * A template solid (cube/pyramid/cylinder/cone) is not a single primitive: the workspace also materialises a
 * polyhedron plus its vertices, edges and faces so the figure can be drawn and measured. Those parts exist only
 * to draw the solid, so for deletion they are the same object — deleting any member deletes the family. Treating
 * the generated parts as ordinary referrers instead made a solid impossible to delete, and deleting the
 * generated part alone left the rest of the figure floating in the scene.
 *
 * Function analysis objects are the same story: a 导函数/切线/积分区域/分析集 only exists to describe its source
 * function. Counting them as ordinary referrers made a legacy calculus document's function impossible to delete
 * ("object is referenced by another object"), so they are deleted together with the function they came from.
 *
 * **交点同理**：删除一条直线时，用户不应该先手动删掉它与别的图形的交点再回来删直线。
 * 交点、轨迹、连接都是纯派生对象，一律随来源级联删除。
 */
export function deletionTargets(document: GeometryDocument, id: string): Set<string> {
  const targets = new Set<string>([id])
  // 模板实体的拓扑是一整族，先按成员归属整体纳入，后面的级联才看得到它们。
  const polyhedron = document.primitives.find((primitive) => {
    if (primitive.type !== "polyhedron3" || primitive.construction?.kind !== "template") return false
    return primitive.id === id || primitive.construction.sourceIds[0] === id || primitive.vertexIds.includes(id) || primitive.edgeIds.includes(id) || primitive.faceIds.includes(id)
  })
  if (polyhedron && polyhedron.type === "polyhedron3") {
    for (const member of [polyhedron.id, ...(polyhedron.construction?.sourceIds ?? []), ...polyhedron.vertexIds, ...polyhedron.edgeIds, ...polyhedron.faceIds]) targets.add(member)
  }
  /**
   * 固定点迭代，不能只扫一趟：级联出来的对象本身可能还被别的派生对象引用。
   * 例如"直线 → 连接（引用该直线上的点）→ 连接与圆的交点"，一趟只能收到中间那层。
   */
  let added = true
  while (added) {
    added = false
    for (const primitive of document.primitives) {
      if (targets.has(primitive.id)) continue
      const sources = cascadeSources(primitive)
      if (sources.length === 0 || !sources.some((sourceId) => targets.has(sourceId))) continue
      targets.add(primitive.id)
      added = true
    }
  }
  return targets
}

export function layerDescendantIds(document: GeometryDocument, id: string): Set<string> {
  const descendants = new Set<string>([id])
  let changed = true
  while (changed) {
    changed = false
    for (const layer of document.layers ?? []) {
      if (layer.parentId && descendants.has(layer.parentId) && !descendants.has(layer.id)) {
        descendants.add(layer.id)
        changed = true
      }
    }
  }
  return descendants
}

export function applyOperation(document: GeometryDocument, operation: DomainOperation): OperationResult {  const next = structuredClone(document) as GeometryDocument
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
    const editableGeometry = ["point", "point3", "line", "segment", "ray", "polyline", "parabola", "ellipse", "hyperbola", "function", "circle", "arc", "cube", "pyramid", "cylinder", "cone", "plane3"]
    const geometryPatchKeys = Object.keys(operation.patch).filter((key) => key !== "style" && key !== "label")
    if (!primitive || (geometryPatchKeys.length > 0 && !editableGeometry.includes(primitive.type)) || primitive.locked) return { document, changed: false, error: primitive?.locked ? "object is locked" : "object is not editable" }
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
    if (primitive.type === "plane3" && operation.patch.halfSize !== undefined) {
      // null puts the plane back on automatic sizing; JSON.stringify then drops the field entirely.
      if (operation.patch.halfSize === null || !(operation.patch.halfSize > 0)) delete primitive.halfSize
      else primitive.halfSize = operation.patch.halfSize
    }
    if (primitive.type === "cube") {
      if (operation.patch.origin3) primitive.origin = { ...primitive.origin, ...operation.patch.origin3 }
      if (operation.patch.size3) primitive.size = { ...primitive.size, ...operation.patch.size3 }
      if (operation.patch.rotation3) primitive.rotation = { ...(primitive.rotation ?? { x: 0, y: 0, z: 0 }), ...operation.patch.rotation3 }
    }
    if (primitive.type === "pyramid") {
      if (operation.patch.baseCenter3) primitive.baseCenter = { ...primitive.baseCenter, ...operation.patch.baseCenter3 }
      if (operation.patch.baseSize3) primitive.baseSize = { ...primitive.baseSize, ...operation.patch.baseSize3 }
      if (operation.patch.height !== undefined) primitive.height = operation.patch.height
      if (operation.patch.rotation3) primitive.rotation = { ...(primitive.rotation ?? { x: 0, y: 0, z: 0 }), ...operation.patch.rotation3 }
    }
    if (primitive.type === "cylinder" || primitive.type === "cone") {
      if (operation.patch.center3) primitive.center = { ...primitive.center, ...operation.patch.center3 }
      if (operation.patch.radius3 !== undefined) primitive.radius = operation.patch.radius3
      if (operation.patch.height !== undefined) primitive.height = operation.patch.height
      if (operation.patch.segments !== undefined) primitive.segments = operation.patch.segments
      if (operation.patch.rotation3) primitive.rotation = { ...(primitive.rotation ?? { x: 0, y: 0, z: 0 }), ...operation.patch.rotation3 }
    }
    if (operation.patch.label !== undefined) primitive.label = operation.patch.label
    // A template solid paints its generated point/edge/face children, so a template style change recolours them too.
    if (operation.patch.style !== undefined && ["cube", "pyramid", "cylinder", "cone"].includes(primitive.type)) {
      for (const candidate of next.primitives) {
        if (candidate.type !== "polyhedron3" || candidate.construction?.kind !== "template" || candidate.construction.sourceIds[0] !== primitive.id) continue
        candidate.style = { ...candidate.style, ...operation.patch.style }
        for (const childId of [...candidate.vertexIds, ...candidate.edgeIds, ...candidate.faceIds]) {
          const child = next.primitives.find((entry) => entry.id === childId)
          if (child) child.style = { ...child.style, ...operation.patch.style }
        }
      }
    }
    if (operation.patch.style !== undefined) primitive.style = { ...primitive.style, ...operation.patch.style }
    changedIds = [operation.id]
  } else if (operation.op === "translatePrimitive") {
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)
    if (primitive) {
      const primitiveMap = new Map(next.primitives.map((candidate) => [candidate.id, candidate]))
      const dragged = primitive.type === "point"
        ? dragBoundPoint(primitive, operation.delta, primitiveMap, next.parameters)
        : null
      if (dragged) {
        // 约束点沿曲线滑动：写回自己的参数（以及它绑定的文档参数），坐标由重算统一求出。
        next.primitives = next.primitives.map((candidate) => candidate.id === operation.id ? dragged.point : candidate)
        if (dragged.parameterValue) {
          const parameter = next.parameters[dragged.parameterValue.id]
          if (parameter) next.parameters[dragged.parameterValue.id] = { ...parameter, value: dragged.parameterValue.value }
          changedIds = [operation.id, dragged.parameterValue.id]
        } else {
          changedIds = [operation.id]
        }
      } else {
        next.primitives = next.primitives.map((candidate) => candidate.id !== operation.id
          ? candidate
          : candidate.type === "function" ? translateFunction(candidate, operation.delta.x, operation.delta.y) : translatePrimitive(candidate, operation.delta.x, operation.delta.y))
        changedIds = [operation.id]
      }
    }
  } else if (operation.op === "translatePrimitive3") {
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)
    if (!primitive) return { document, changed: false, error: "object not found" }
    if (!isFreeDraggable3(primitive, point3Index(next), templateTopologyIds(next))) return { document, changed: false, error: "object is not draggable" }
    const moved = translatePrimitive3(primitive, operation.delta)
    const movedIds = new Set(moved.movedIds)
    next.primitives = next.primitives
      .map((candidate) => candidate.id === operation.id ? moved.primitive : candidate)
      // A point-driven object is moved by moving its points; the object itself only follows through recompute.
      .map((candidate) => candidate.type === "point3" && candidate.id !== operation.id && movedIds.has(candidate.id) ? { ...candidate, position: shiftedPoint(candidate.position, operation.delta) } : candidate)
    // Sections name their source by id, so they are not in the dependency index: a moved solid has to
    // re-derive its own cuts explicitly, or the drawn section would keep the old shape while the solid moves.
    const cutIds = next.primitives.filter((candidate): candidate is Extract<PrimitiveSpec, { type: "section" }> => candidate.type === "section" && candidate.sourceId === operation.id).map((section) => section.id)
    changedIds = [...movedIds, operation.id, ...cutIds]
  } else if (operation.op === "moveSectionPlane") {
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)
    if (!primitive || primitive.type !== "section") return { document, changed: false, error: "section not found" }
    primitive.plane = movedSectionPlane(primitive.plane, operation.distance)
    // 剖切面变了，截面点必须在同一次提交里重算，否则画布上的形状和读数会对不上。
    changedIds = [operation.id]
  } else if (operation.op === "rotateSectionPlane") {
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)
    if (!primitive || primitive.type !== "section") return { document, changed: false, error: "section not found" }
    primitive.plane = rotatedSectionPlane(primitive.plane, operation.axis, operation.degrees, operation.pivot)
    changedIds = [operation.id]
  } else if (operation.op === "setSectionPlane") {
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)
    if (!primitive || primitive.type !== "section") return { document, changed: false, error: "section not found" }
    primitive.plane = { normal: { ...operation.normal }, constant: operation.constant }
    changedIds = [operation.id]
  } else if (operation.op === "toggleLock") {
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)
    if (!primitive) return { document, changed: false, error: "object not found" }
    primitive.locked = operation.locked
  } else if (operation.op === "setParameter") {
    const parameter = next.parameters[operation.id] ?? { id: operation.id, value: operation.value }
    // 只在显式给出时覆盖元数据，这样拖动滑块（只带 value）不会抹掉参数已有的 min/max/label。
    next.parameters[operation.id] = {
      ...parameter,
      value: operation.value,
      expression: undefined,
      ...(operation.min === undefined ? {} : { min: operation.min }),
      ...(operation.max === undefined ? {} : { max: operation.max }),
      ...(operation.step === undefined ? {} : { step: operation.step }),
      ...(operation.label === undefined ? {} : { label: operation.label }),
      ...(operation.ownerId === undefined ? {} : { ownerId: operation.ownerId })
    }
    changedIds = [operation.id]
  } else if (operation.op === "deleteParameter") {
    if (!next.parameters[operation.id]) return { document, changed: false, error: "parameter not found" }
    // 参数还被图元引用时不能删：绑定里的 parameterId 一旦悬空，点会静默冻住。
    if (parameterIsReferenced(next, operation.id)) return { document, changed: false, error: "parameter is referenced by an object" }
    delete next.parameters[operation.id]
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
  } else if (operation.op === "addEngineeringAnnotation") {
    if (next.engineeringAnnotations?.some((annotation) => annotation.id === operation.annotation.id)) return { document, changed: false, error: "duplicate engineering annotation id" }
    next.engineeringAnnotations = [...(next.engineeringAnnotations ?? []), operation.annotation]
    changedIds = operation.annotation.sourceIds
  } else if (operation.op === "deleteEngineeringAnnotation") {
    const annotations = next.engineeringAnnotations ?? []
    const filtered = annotations.filter((annotation) => annotation.id !== operation.id)
    if (filtered.length === annotations.length) return { document, changed: false, error: "engineering annotation not found" }
    next.engineeringAnnotations = filtered
  } else if (operation.op === "addConstraint") {
    if (next.constraints.some((constraint) => constraint.id === operation.constraint.id)) return { document, changed: false, error: "duplicate constraint id" }
    next.constraints.push(operation.constraint)
    changedIds = operation.constraint.targets
  } else if (operation.op === "deleteObject") {
    const plan = deletionPlan(next, [operation.id])
    const targets = plan.primitives
    const before = next.primitives.length
    // 先"解绑"再过滤：宿主被删掉的点降级为自由点（保留位置），不留悬空引用。
    next.primitives = next.primitives.map((primitive) => unbindDeletedHost(primitive, targets)).filter((primitive) => !targets.has(primitive.id))
    if (before === next.primitives.length) return { document, changed: false, error: "object not found" }
    // 测量 / 注释 / 工程标注 / 约束随宿主一起注销；分组只摘掉被删成员。
    if (plan.measurements.size > 0) next.measurements = next.measurements.filter((measurement) => !plan.measurements.has(measurement.id))
    if (plan.annotations.size > 0) next.annotations = next.annotations.filter((annotation) => !plan.annotations.has(annotation.id))
    if (plan.engineeringAnnotations.size > 0 && next.engineeringAnnotations) next.engineeringAnnotations = next.engineeringAnnotations.filter((annotation) => !plan.engineeringAnnotations.has(annotation.id))
    if (plan.constraints.size > 0) next.constraints = next.constraints.filter((constraint) => !plan.constraints.has(constraint.id))
    if (plan.groupMembers.size > 0) next.groups = next.groups.map((group) => group.members.some((member) => plan.groupMembers.has(member)) ? { ...group, members: group.members.filter((member) => !plan.groupMembers.has(member)) } : group)
    /**
     * 回收"随对象自动生成"的驱动参数。判据是**孤儿**而不是"本次被删"：
     * 只要它带 `ownerId`（自动生成）、归属对象已经不在文档里、且没有任何图元引用它，就是垃圾。
     *
     * 不能只看 `targets`：先删点 A（参数因被点 B 共用而保留）、再删点 B 时，
     * A 早已不在 targets 里，只看 targets 就永远收不掉这个参数。
     *
     * 必须在图元过滤**之后**做，否则被删图元自己的绑定会被算成"仍被引用"。
     * 用户手工创建的参数不带 `ownerId`，永远不会被这一步碰掉。
     */
    const survivingIds = new Set(next.primitives.map((primitive) => primitive.id))
    for (const [parameterId, parameter] of Object.entries(next.parameters)) {
      if (!parameter.ownerId || survivingIds.has(parameter.ownerId)) continue
      if (parameterIsReferenced(next, parameterId)) continue
      delete next.parameters[parameterId]
    }
    changedIds = [...targets]
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
  } else if (operation.op === "addLayer") {
    next.layers = [...(next.layers ?? []), operation.layer]
    if (!next.activeLayerId) next.activeLayerId = operation.layer.id
  } else if (operation.op === "updateLayer") {
    next.layers = (next.layers ?? []).map((layer) => layer.id === operation.id ? { ...layer, ...operation.patch, id: layer.id } : layer)
  } else if (operation.op === "deleteLayer") {
    const removedIds = layerDescendantIds(next, operation.id)
    const targetId = operation.reassignTo ?? (next.layers ?? []).find((layer) => layer.kind === "geometry" && !removedIds.has(layer.id))?.id
    if (!targetId) return { document, changed: false, error: "no replacement layer" }
    next.primitives = next.primitives.map((primitive) => removedIds.has(primitive.layerId ?? "") ? { ...primitive, layerId: targetId } : primitive)
    next.layers = (next.layers ?? []).filter((layer) => !removedIds.has(layer.id))
    if (removedIds.has(next.activeLayerId ?? "")) next.activeLayerId = targetId
  } else if (operation.op === "setActiveLayer") {
    next.activeLayerId = operation.id
  } else if (operation.op === "addDrawingSheet") {
    next.drawingSheets = [...(next.drawingSheets ?? []), operation.sheet]
    if (!next.activeSheetId) next.activeSheetId = operation.sheet.id
  } else if (operation.op === "updateDrawingSheet") {
    next.drawingSheets = (next.drawingSheets ?? []).map((sheet) => sheet.id === operation.id ? { ...sheet, ...operation.patch, id: sheet.id } : sheet)
  } else if (operation.op === "addDrawingView") {
    next.drawingViews = [...(next.drawingViews ?? []), operation.view]
  } else if (operation.op === "updateDrawingView") {
    next.drawingViews = (next.drawingViews ?? []).map((view) => view.id === operation.id ? { ...view, ...operation.patch, id: view.id } : view)
  } else if (operation.op === "deleteDrawingView") {
    next.drawingViews = (next.drawingViews ?? []).filter((view) => view.id !== operation.id)
    next.drawingSheets = (next.drawingSheets ?? []).map((sheet) => ({ ...sheet, viewIds: sheet.viewIds.filter((viewId) => viewId !== operation.id) }))
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
