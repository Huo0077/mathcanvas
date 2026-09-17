/**
 * 3D 图元构造：网格 / 棱 / 面 / 截面 / 展开网 / 平面片与释放
 *
 * 从 threeScene.tsx 抽出来的纯函数：它们与 React 无关，独立成模块后可以直接单测，
 * 组件文件也不再混着一堆非组件导出（react-refresh 的告警就是这么来的）。
 */
import * as THREE from "three"
import type { ConePrimitive, CubePrimitive, CylinderPrimitive, Edge3Primitive, Face3Primitive, GeometryDocument, Line3Primitive, Plane3Primitive, Point3Primitive, PrimitiveSpec, PyramidPrimitive, Ray3Primitive, SectionPrimitive, Segment3Primitive, Vector3 } from "@draw/dsl"
import { type DihedralMarker3, type UnfoldLayout3 } from "@draw/geometry-kernel"
import { opacityFor, strokeFor } from "./primitiveStyle"
import type { ThreeScenePreview } from "./threeScenePreview"

type SolidPrimitive = CubePrimitive | PyramidPrimitive | CylinderPrimitive | ConePrimitive
type PointDrivenLinePrimitive = Line3Primitive | Segment3Primitive | Ray3Primitive

export interface SolidVisualOptions {
  showHiddenEdges?: boolean
  showNormals?: boolean
  transparentFaces?: boolean
  unfoldProgress?: number
}

export interface CubeFaceLayout {
  center: { x: number; y: number; z: number }
  width: number
  height: number
  rotation: { x: number; y: number; z: number }
}

export function cubeUnfoldCenters(size: { x: number; y: number; z: number }, progress: number): CubeFaceLayout[] {
  const clamped = Math.max(0, Math.min(1, progress))
  const folded = [
    { x: 0, y: 0, z: size.z / 2 }, { x: 0, y: 0, z: -size.z / 2 },
    { x: size.x / 2, y: 0, z: 0 }, { x: -size.x / 2, y: 0, z: 0 },
    { x: 0, y: size.y / 2, z: 0 }, { x: 0, y: -size.y / 2, z: 0 }
  ]
  const unfolded = [
    { x: 0, y: 0, z: size.z / 2 }, { x: 0, y: 0, z: -size.z * 1.5 },
    { x: size.x * 1.5, y: 0, z: 0 }, { x: -size.x * 1.5, y: 0, z: 0 },
    { x: 0, y: size.y * 1.5, z: 0 }, { x: 0, y: -size.y * 1.5, z: 0 }
  ]
  const dimensions = [
    { width: size.x, height: size.y, rotation: { x: 0, y: 0, z: 0 } }, { width: size.x, height: size.y, rotation: { x: 0, y: Math.PI, z: 0 } },
    { width: size.z, height: size.y, rotation: { x: 0, y: Math.PI / 2, z: 0 } }, { width: size.z, height: size.y, rotation: { x: 0, y: -Math.PI / 2, z: 0 } },
    { width: size.x, height: size.z, rotation: { x: -Math.PI / 2, y: 0, z: 0 } }, { width: size.x, height: size.z, rotation: { x: Math.PI / 2, y: 0, z: 0 } }
  ]
  return folded.map((center, index) => ({
    center: { x: center.x + (unfolded[index].x - center.x) * clamped, y: center.y + (unfolded[index].y - center.y) * clamped, z: center.z + (unfolded[index].z - center.z) * clamped },
    ...dimensions[index]
  }))
}

/** World radius used before the scene measures the camera; ThreeSceneView replaces it every frame. */
const DEFAULT_POINT_HANDLE_RADIUS = 0.05
/** 剖切面的单位法向；法向退化（零向量 / 非有限）时返回 null，调用方据此放弃这次拖动。 */
export function sectionUnitNormal(normal: Vector3): THREE.Vector3 | null {
  const unit = new THREE.Vector3(normal.x, normal.y, normal.z)
  return Number.isFinite(unit.x) && Number.isFinite(unit.y) && Number.isFinite(unit.z) && unit.lengthSq() > 1e-12 ? unit.normalize() : null
}

export function createPoint3Mesh(primitive: Point3Primitive, selected: boolean, worldRadius = DEFAULT_POINT_HANDLE_RADIUS): THREE.Mesh {
  // A unit sphere plus a scale keeps the handle resizable every frame without rebuilding geometry.
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: selected ? "#4c3ac7" : strokeFor(primitive), transparent: opacityFor(primitive) < 1, opacity: opacityFor(primitive) }))
  mesh.scale.setScalar(worldRadius)
  mesh.position.set(primitive.position.x, primitive.position.y, primitive.position.z)
  mesh.userData.primitiveId = primitive.id
  mesh.userData.primitiveType = primitive.type
  return mesh
}

function point3ById(points: Map<string, Point3Primitive>, id: string): Vector3 | null {
  return points.get(id)?.position ?? null
}

function pointDrivenLineEndpoints(primitive: PointDrivenLinePrimitive, points: Map<string, Point3Primitive>): [Vector3, Vector3] | null {
  if (primitive.type === "line3") {
    if (primitive.definition.kind === "throughPoints") {
      const first = point3ById(points, primitive.definition.pointIds[0])
      const second = point3ById(points, primitive.definition.pointIds[1])
      return first && second ? [first, second] : null
    }
    const origin = point3ById(points, primitive.definition.pointId)
    return origin ? [origin, { x: origin.x + primitive.definition.direction.x, y: origin.y + primitive.definition.direction.y, z: origin.z + primitive.definition.direction.z }] : null
  }
  const pointIds = primitive.type === "ray3" ? [primitive.originId, primitive.throughId] : primitive.pointIds
  const first = point3ById(points, pointIds[0])
  const second = point3ById(points, pointIds[1])
  return first && second ? [first, second] : null
}

export function createPointDrivenLine(primitive: PointDrivenLinePrimitive, points: Map<string, Point3Primitive>, selected: boolean): THREE.Line | null {
  const endpoints = pointDrivenLineEndpoints(primitive, points)
  if (!endpoints) return null
  const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(endpoints[0].x, endpoints[0].y, endpoints[0].z), new THREE.Vector3(endpoints[1].x, endpoints[1].y, endpoints[1].z)])
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: selected ? "#4c3ac7" : strokeFor(primitive), transparent: opacityFor(primitive) < 1, opacity: opacityFor(primitive) }))
  line.userData.primitiveId = primitive.id
  line.userData.primitiveType = primitive.type
  return line
}

const PLANE3_DEFAULT_FILL = "#3b6ef5"

/** Origin plus an in-plane orthonormal basis for a plane3, or null when the definition is degenerate. */
function planeFrame3(primitive: Plane3Primitive, points: Map<string, Point3Primitive>): { origin: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3 } | null {
  const basisFromNormal = (origin: THREE.Vector3, normal: THREE.Vector3) => {
    if (!Number.isFinite(normal.x) || normal.lengthSq() < 1e-9) return null
    normal.normalize()
    const helper = Math.abs(normal.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
    const u = new THREE.Vector3().crossVectors(helper, normal).normalize()
    return { origin, u, v: new THREE.Vector3().crossVectors(normal, u).normalize() }
  }
  if (primitive.definition.kind === "pointNormal") {
    const origin = points.get(primitive.definition.pointId)?.position
    return origin ? basisFromNormal(new THREE.Vector3(origin.x, origin.y, origin.z), new THREE.Vector3(primitive.definition.normal.x, primitive.definition.normal.y, primitive.definition.normal.z)) : null
  }
  const corners = primitive.definition.pointIds.map((id) => points.get(id)?.position)
  if (corners.some((corner) => !corner)) return null
  const [first, second, third] = corners as Vector3[]
  const normal = new THREE.Vector3().crossVectors(
    new THREE.Vector3(second.x - first.x, second.y - first.y, second.z - first.z),
    new THREE.Vector3(third.x - first.x, third.y - first.y, third.z - first.z)
  )
  // Collinear defining points describe no plane at all; drawing nothing beats drawing an arbitrary one.
  if (normal.lengthSq() < 1e-9) return null
  const origin = new THREE.Vector3((first.x + second.x + third.x) / 3, (first.y + second.y + third.y) / 3, (first.z + second.z + third.z) / 3)
  return basisFromNormal(origin, normal)
}

/**
 * A plane is infinite, so what gets drawn is a bounded patch centred on its defining points, sized by the
 * caller from the scene it sits in — this is the "合适大小" a plane needs to be usable at all.
 */
export function createPlane3Mesh(primitive: Plane3Primitive, points: Map<string, Point3Primitive>, selected: boolean, autoHalfSize: number): THREE.Mesh | null {
  const frame = planeFrame3(primitive, points)
  if (!frame) return null
  const { origin, u, v } = frame
  // An explicit half extent is document state; without it the patch is sized from the scene it sits in.
  const halfSize = primitive.halfSize ?? autoHalfSize
  const corner = (offsetU: number, offsetV: number) => new THREE.Vector3().copy(origin).addScaledVector(u, offsetU * halfSize).addScaledVector(v, offsetV * halfSize)
  const corners = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(corners.flatMap((point) => [point.x, point.y, point.z]), 3))
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  geometry.computeVertexNormals()
  // The patch keeps the colour the user chose; selection is carried by the outline and the crossing guides.
  const fill = primitive.style?.fill ?? PLANE3_DEFAULT_FILL
  const accent = selected ? "#4c3ac7" : fill
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: fill, transparent: true, opacity: selected ? 0.3 : 0.18, side: THREE.DoubleSide, depthWrite: false }))
  mesh.userData.primitiveId = primitive.id
  mesh.userData.primitiveType = primitive.type
  mesh.userData.visualRole = "plane3"
  const outlinePoints = [...corners, corners[0]]
  const outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints(outlinePoints), new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.9 }))
  outline.userData.visualRole = "plane3-outline"
  mesh.add(outline)
  // Two crossing centre lines read as "this is a plane", not a floating sheet.
  for (const direction of [u, v]) {
    const from = corner(0, 0).addScaledVector(direction, -halfSize)
    const to = corner(0, 0).addScaledVector(direction, halfSize)
    const guide = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, to]), new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.35 }))
    guide.userData.visualRole = "plane3-guide"
    mesh.add(guide)
  }
  return mesh
}

export function createFace3Mesh(primitive: Face3Primitive, points: Map<string, Point3Primitive>, selected: boolean): THREE.Mesh | null {  const positions = primitive.pointIds.map((id) => point3ById(points, id))
  if (positions.some((position) => !position) || positions.length < 3) return null
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions.flatMap((position) => [position!.x, position!.y, position!.z]), 3))
  const indices: number[] = []
  for (let index = 1; index < positions.length - 1; index += 1) indices.push(0, index, index + 1)
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: primitive.style?.fill ?? strokeFor(primitive), transparent: true, opacity: Math.min(0.48, opacityFor(primitive)), side: THREE.DoubleSide }))
  mesh.userData.primitiveId = primitive.id
  mesh.userData.primitiveType = primitive.type
  mesh.userData.visualRole = "face3"
  if (selected) {
    // Selection is an additive outline. Overwriting the fill made a freshly chosen colour look like it had not applied.
    const outlineGeometry = new THREE.BufferGeometry()
    outlineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions.flatMap((position) => [position!.x, position!.y, position!.z]), 3))
    const outline = new THREE.LineLoop(outlineGeometry, new THREE.LineBasicMaterial({ color: "#4c3ac7", transparent: true, opacity: 0.95 }))
    outline.userData.visualRole = "face3-outline"
    mesh.add(outline)
  }
  return mesh
}

export function createEdge3Line(primitive: Edge3Primitive, points: Map<string, Point3Primitive>, selected: boolean): THREE.Line | null {
  const first = point3ById(points, primitive.pointIds[0])
  const second = point3ById(points, primitive.pointIds[1])
  if (!first || !second) return null
  const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(first.x, first.y, first.z), new THREE.Vector3(second.x, second.y, second.z)])
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: selected ? "#4c3ac7" : strokeFor(primitive), transparent: opacityFor(primitive) < 1, opacity: opacityFor(primitive) }))
  line.userData.primitiveId = primitive.id
  line.userData.primitiveType = primitive.type
  return line
}

function solidMaterial(primitive: SolidPrimitive, selected: boolean, options: SolidVisualOptions = {}): THREE.MeshStandardMaterial {
  const opacity = opacityFor(primitive)
  return new THREE.MeshStandardMaterial({
    color: primitive.style?.fill ?? strokeFor(primitive),
    emissive: selected ? primitive.style?.stroke ?? strokeFor(primitive) : "#000000",
    emissiveIntensity: selected ? 0.28 : 0,
    roughness: 0.72,
    metalness: 0.04,
    transparent: options.transparentFaces || opacity < 1,
    opacity: options.transparentFaces ? Math.min(0.55, opacity) : opacity,
    side: THREE.DoubleSide
  })
}

export function createCubeMesh(primitive: CubePrimitive, selected: boolean, options: SolidVisualOptions = {}): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(primitive.size.x, primitive.size.y, primitive.size.z)
  const material = solidMaterial(primitive, selected, options)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(
    primitive.origin.x + primitive.size.x / 2,
    primitive.origin.y + primitive.size.y / 2,
    primitive.origin.z + primitive.size.z / 2
  )
  mesh.userData.primitiveId = primitive.id
  mesh.userData.primitiveType = primitive.type
  return mesh
}

function createPyramidGeometry(primitive: PyramidPrimitive): THREE.BufferGeometry {
  const halfX = primitive.baseSize.x / 2
  const halfZ = primitive.baseSize.y / 2
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -halfX, 0, -halfZ,
    halfX, 0, -halfZ,
    halfX, 0, halfZ,
    -halfX, 0, halfZ,
    0, primitive.height, 0
  ], 3))
  geometry.setIndex([0, 2, 1, 0, 3, 2, 0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4])
  geometry.computeVertexNormals()
  return geometry
}

export function createSolidMesh(primitive: SolidPrimitive, selected: boolean, options: SolidVisualOptions = {}): THREE.Mesh {
  if (primitive.type === "cube") return createCubeMesh(primitive, selected, options)
  const geometry = primitive.type === "pyramid"
    ? createPyramidGeometry(primitive)
    : primitive.type === "cylinder"
      ? new THREE.CylinderGeometry(primitive.radius, primitive.radius, primitive.height, primitive.segments)
      : new THREE.ConeGeometry(primitive.radius, primitive.height, primitive.segments)
  const mesh = new THREE.Mesh(geometry, solidMaterial(primitive, selected, options))
  if (primitive.type === "pyramid") mesh.position.set(primitive.baseCenter.x, primitive.baseCenter.y, primitive.baseCenter.z)
  else mesh.position.set(primitive.center.x, primitive.center.y + primitive.height / 2, primitive.center.z)
  mesh.userData.primitiveId = primitive.id
  mesh.userData.primitiveType = primitive.type
  return mesh
}

function solidOutline(mesh: THREE.Mesh, primitive: SolidPrimitive, selected: boolean): THREE.LineSegments {
  const geometry = new THREE.EdgesGeometry(mesh.geometry)
  const material = new THREE.LineBasicMaterial({
    color: selected ? "#4c3ac7" : primitive.style?.stroke ?? strokeFor(primitive),
    transparent: opacityFor(primitive) < 1,
    opacity: opacityFor(primitive)
  })
  const outline = new THREE.LineSegments(geometry, material)
  outline.position.copy(mesh.position)
  outline.userData.primitiveId = primitive.id
  return outline
}

function hiddenEdgeOverlay(mesh: THREE.Mesh, primitive: SolidPrimitive): THREE.LineSegments {
  const geometry = new THREE.EdgesGeometry(mesh.geometry)
  const material = new THREE.LineDashedMaterial({
    color: primitive.style?.stroke ?? strokeFor(primitive),
    dashSize: 0.12,
    gapSize: 0.08,
    transparent: true,
    opacity: Math.min(0.45, opacityFor(primitive)),
    depthTest: false,
    depthWrite: false
  })
  const hidden = new THREE.LineSegments(geometry, material)
  hidden.computeLineDistances()
  hidden.position.copy(mesh.position)
  hidden.userData.primitiveId = primitive.id
  hidden.userData.visualRole = "hidden-edges"
  return hidden
}

function normalVisuals(mesh: THREE.Mesh): THREE.ArrowHelper[] {
  return [
    { direction: new THREE.Vector3(1, 0, 0), color: "#e05d6f" },
    { direction: new THREE.Vector3(0, 1, 0), color: "#21a794" },
    { direction: new THREE.Vector3(0, 0, 1), color: "#6c5ce7" }
  ].map(({ direction, color }) => {
    const arrow = new THREE.ArrowHelper(direction, mesh.position, 1.2, color, 0.18, 0.1)
    arrow.userData.visualRole = "normal"
    return arrow
  })
}

export function createSectionMesh(primitive: SectionPrimitive): THREE.Object3D | null {
  // A cut that misses the solid (points moved past a face) has nothing to draw; drawing a fabricated
  // placeholder would make "moved the plane off the solid" look like a real section.
  if (primitive.points.length < 2) return null
  const sectionColor = primitive.style?.stroke ?? "#f97316"
  // 截面的全部闭合环：带孔或分成多块的截面在 `loops` 里保留完整几何，旧文档只有 `points`。
  const loops = primitive.loops && primitive.loops.length > 0 ? primitive.loops : [primitive.points]
  if (primitive.points.length === 2 && loops.every((loop) => loop.length < 3)) {
    // A vertex-tangent or edge-coincident cut is a segment, not an area.
    const segment = new THREE.Line(new THREE.BufferGeometry().setFromPoints(primitive.points.map((point) => new THREE.Vector3(point.x, point.y, point.z))), new THREE.LineBasicMaterial({ color: sectionColor }))
    segment.userData.primitiveId = primitive.id
    segment.userData.primitiveType = primitive.type
    segment.userData.visualRole = "section"
    return segment
  }
  const group = new THREE.Group()
  group.userData.primitiveId = primitive.id
  group.userData.primitiveType = primitive.type
  group.userData.visualRole = "section"
  group.userData.sectionLoopCount = loops.length
  loops.forEach((loop, loopIndex) => {
    if (loop.length < 3) return
    const positions = loop.flatMap((point) => [point.x, point.y, point.z])
    const indices: number[] = []
    for (let index = 1; index < loop.length - 1; index += 1) indices.push(0, index, index + 1)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    // 每一环都有自己的半透明填充；只有外环（面积最大）保留拾取用的 primitiveId，
    // 这样"点截面"仍然命中一次，而不是每加一环就多一个可拖动对象。
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: primitive.style?.fill ?? "#f97316", transparent: true, opacity: loopIndex === 0 ? 0.42 : 0, side: THREE.DoubleSide, depthWrite: false }))
    if (loopIndex === 0) {
      mesh.userData.primitiveId = primitive.id
      mesh.userData.primitiveType = primitive.type
    }
    mesh.userData.visualRole = "section"
    // Section points are ordered along the boundary, so the closed loop reflects the real cut outline.
    const boundaryPoints = [...loop, loop[0]].map((point) => new THREE.Vector3(point.x, point.y, point.z))
    const boundary = new THREE.Line(new THREE.BufferGeometry().setFromPoints(boundaryPoints), new THREE.LineBasicMaterial({ color: sectionColor }))
    boundary.userData.visualRole = "section-boundary"
    boundary.userData.sectionLoopIndex = loopIndex
    mesh.add(boundary)
    group.add(mesh)
  })
  return group.children.length > 0 ? group : null
}

/** Render a computed unfold layout as one filled mesh plus an outline per face, keeping pick metadata on each face. */
export function createUnfoldNetGroup(polyhedronId: string, layout: UnfoldLayout3, selected: boolean): THREE.Group {
  const group = new THREE.Group()
  group.userData.primitiveId = polyhedronId
  group.userData.visualRole = "unfold-net"
  layout.faces.forEach((face, index) => {
    if (face.positions.length < 3) return
    const positions = face.positions.flatMap((point) => [point.x, point.y, point.z])
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
    const indices: number[] = []
    for (let corner = 1; corner < face.positions.length - 1; corner += 1) indices.push(0, corner, corner + 1)
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: selected ? "#7c6cf0" : "#9c96c4", transparent: true, opacity: 0.82, side: THREE.DoubleSide, metalness: 0.05, roughness: 0.8 }))
    mesh.userData.primitiveId = polyhedronId
    mesh.userData.primitiveType = "polyhedron3"
    mesh.userData.visualRole = "unfold-face"
    mesh.userData.partId = `unfolded-face-${index}`
    const outlinePoints = [...face.positions, face.positions[0]].map((point) => new THREE.Vector3(point.x, point.y, point.z))
    const outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints(outlinePoints), new THREE.LineBasicMaterial({ color: selected ? "#4c3ac7" : "#6f6a92" }))
    outline.userData.primitiveId = polyhedronId
    outline.userData.partId = `unfolded-face-${index}`
    outline.userData.visualRole = "unfold-face-outline"
    mesh.add(outline)
    group.add(mesh)
  })
  return group
}

export function createDihedralMarkerGroup(marker: DihedralMarker3, selected: boolean): THREE.Group {
  const color = selected ? "#4c3ac7" : "#e07b39"
  const toVector = (point: Vector3) => new THREE.Vector3(point.x, point.y, point.z)
  const group = new THREE.Group()
  group.userData.visualRole = "dihedral-marker"
  const hinge = new THREE.Line(new THREE.BufferGeometry().setFromPoints([toVector(marker.hingeStart), toVector(marker.hingeEnd)]), new THREE.LineBasicMaterial({ color }))
  hinge.userData.visualRole = "dihedral-hinge"
  group.add(hinge)
  const arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(marker.arc.map(toVector)), new THREE.LineBasicMaterial({ color }))
  arc.userData.visualRole = "dihedral-arc"
  group.add(arc)
  for (const [index, normal] of [marker.firstNormal, marker.secondNormal].entries()) {
    const arrow = new THREE.Line(new THREE.BufferGeometry().setFromPoints([toVector(normal.start), toVector(normal.end)]), new THREE.LineBasicMaterial({ color }))
    arrow.userData.visualRole = `dihedral-normal-${index}`
    group.add(arrow)
  }
  return group
}

/** Respect the platform reduced-motion preference so folding jumps instead of animating. */
export function prefersReducedMotion(): boolean {
  return typeof globalThis.matchMedia === "function" && globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches
}

export function nextUnfoldProgress(current: number, target: number): number {
  if (target === 0) return 0
  const next = current + (target - current) * 0.6
  return Math.abs(target - next) <= 0.001 ? target : next
}

/** 平面以 `normal · p + constant = 0` 表示；法向为零向量时没有可画的平面。 */
function planeBasisFrom(normal: Vector3, constant: number): { origin: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3 } | null {
  const unit = new THREE.Vector3(normal.x, normal.y, normal.z)
  if (!Number.isFinite(unit.x) || !Number.isFinite(unit.y) || !Number.isFinite(unit.z) || unit.lengthSq() < 1e-12) return null
  const lengthSq = unit.lengthSq()
  const origin = unit.clone().multiplyScalar(-constant / lengthSq)
  unit.normalize()
  const helper = Math.abs(unit.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
  const u = new THREE.Vector3().crossVectors(helper, unit).normalize()
  return { origin, u, v: new THREE.Vector3().crossVectors(unit, u).normalize() }
}

/**
 * 剖切面片：把无穷平面画成一块恰好罩住来源实体的方形面片。
 * 没有它的时候，截面在画布上只剩一条交线，"切在哪、往哪边挪"都看不出来。
 */
export function createPlanePatch(plane: { normal: Vector3; constant: number }, sourceVertices: Vector3[], options: { color: string; opacity: number; dashedEdges?: boolean }): THREE.Group | null {
  const basis = planeBasisFrom(plane.normal, plane.constant)
  if (!basis) return null
  const { origin, u, v } = basis
  // Size from the source's own footprint on the plane, so the patch reads as "the cut through this solid".
  const radius = sourceVertices.length > 0
    ? Math.max(...sourceVertices.map((vertex) => {
      const offset = new THREE.Vector3(vertex.x - origin.x, vertex.y - origin.y, vertex.z - origin.z)
      return Math.hypot(offset.dot(u), offset.dot(v))
    })) * 1.35 + 0.3
    : 3
  const corner = (offsetU: number, offsetV: number) => origin.clone().addScaledVector(u, offsetU * radius).addScaledVector(v, offsetV * radius)
  const corners = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(corners.flatMap((point) => [point.x, point.y, point.z]), 3))
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  geometry.computeVertexNormals()
  const group = new THREE.Group()
  group.userData.visualRole = "section-plane-patch"
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: options.color, transparent: true, opacity: options.opacity, side: THREE.DoubleSide, depthWrite: false }))
  mesh.userData.visualRole = "section-plane-patch-face"
  group.add(mesh)
  const outlinePoints = [...corners, corners[0]]
  const outline = options.dashedEdges
    ? new THREE.Line(new THREE.BufferGeometry().setFromPoints(outlinePoints), new THREE.LineDashedMaterial({ color: options.color, transparent: true, opacity: 0.9, dashSize: 0.3, gapSize: 0.22 }))
    : new THREE.Line(new THREE.BufferGeometry().setFromPoints(outlinePoints), new THREE.LineBasicMaterial({ color: options.color, transparent: true, opacity: 0.9 }))
  if (options.dashedEdges) outline.computeLineDistances()
  outline.userData.visualRole = "section-plane-patch-outline"
  group.add(outline)
  return group
}

export function createSolidGroup(primitive: SolidPrimitive, selected: boolean, options: SolidVisualOptions = {}): THREE.Group {  if (primitive.type === "cube" && options.unfoldProgress !== undefined && options.unfoldProgress > 0.001) return createCubeUnfoldGroup(primitive, selected, options)
  const group = new THREE.Group()
  const mesh = createSolidMesh(primitive, selected, options)
  group.add(mesh)
  group.add(solidOutline(mesh, primitive, selected))
  if (options.showHiddenEdges) group.add(hiddenEdgeOverlay(mesh, primitive))
  if (options.showNormals) normalVisuals(mesh).forEach((normal) => group.add(normal))
  return group
}

function createCubeUnfoldGroup(primitive: CubePrimitive, selected: boolean, options: SolidVisualOptions): THREE.Group {
  const group = new THREE.Group()
  const center = { x: primitive.origin.x + primitive.size.x / 2, y: primitive.origin.y + primitive.size.y / 2, z: primitive.origin.z + primitive.size.z / 2 }
  cubeUnfoldCenters(primitive.size, options.unfoldProgress ?? 1).forEach((face, index) => {
    const geometry = new THREE.PlaneGeometry(face.width, face.height)
    const mesh = new THREE.Mesh(geometry, solidMaterial(primitive, selected, options))
    mesh.position.set(center.x + face.center.x, center.y + face.center.y, center.z + face.center.z)
    mesh.rotation.set(face.rotation.x, face.rotation.y, face.rotation.z)
    mesh.userData.primitiveId = primitive.id
    mesh.userData.partId = `unfolded-face-${index}`
    mesh.userData.visualRole = `unfolded-face-${index}`
    group.add(mesh)
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: selected ? "#4c3ac7" : primitive.style?.stroke ?? strokeFor(primitive), transparent: true, opacity: opacityFor(primitive) }))
    outline.position.copy(mesh.position)
    outline.rotation.copy(mesh.rotation)
    outline.userData.primitiveId = primitive.id
    outline.userData.partId = `unfolded-face-${index}`
    group.add(outline)
  })
  return group
}

export function visibleSolids(document: GeometryDocument): SolidPrimitive[] {
  const templateSources = new Set(document.primitives.flatMap((primitive) => primitive.type === "polyhedron3" && primitive.construction?.kind === "template" ? primitive.construction.sourceIds : []))
  return document.primitives.filter((primitive): primitive is SolidPrimitive => ["cube", "pyramid", "cylinder", "cone"].includes(primitive.type) && primitive.visible !== false && !templateSources.has(primitive.id))
}

/** 释放一个对象子树的几何与材质。内容对象每次同步都会重建，必须逐个释放，否则显存会一路涨。 */
/**
 * 由点驱动的对象：点手柄、以及引用点的直线 / 线段 / 射线 / 棱 / 面。
 * 抽成函数是为了拖动绑定点时能**只重建受影响的对象**（下游实时跟随），而不是整场重建。
 */
export function buildPointDrivenObject(primitive: PrimitiveSpec, points: Map<string, Point3Primitive>, selected: boolean): THREE.Object3D | null {
  if (primitive.type === "point3") return createPoint3Mesh(primitive, selected)
  if (primitive.type === "line3" || primitive.type === "segment3" || primitive.type === "ray3") return createPointDrivenLine(primitive, points, selected)
  if (primitive.type === "edge3") return createEdge3Line(primitive, points, selected)
  if (primitive.type === "face3") return createFace3Mesh(primitive, points, selected)
  return null
}

export function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Line) && !(object instanceof THREE.LineSegments)) return
    object.geometry.dispose()
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    materials.forEach((material) => material.dispose())
  })
}

export function disposeScene(scene: THREE.Scene): void {
  for (const child of [...scene.children]) disposeObject(child)
}

/** 虚线预览：低不透明度 + 虚线的交线/截面，明确区别于用户已创建的图元。 */
export function createPreviewGroup(
  preview: ThreeScenePreview,
  interactive: boolean,
  onHoverChange: (hovering: boolean) => void
): THREE.Group {
  const group = new THREE.Group()
  group.userData.visualRole = "intersection-preview"
  // 预览不是图形内容：它绝不能参与"适应视图"的包围盒，否则剖切面片会把取景范围撑大
  // （实测：平移视角的边界因此从 15 涨到 15.36）。
  group.userData.excludeFromFit = true
  /**
   * 拾取用的子对象集合单独放在一个子组里：预览的可见线是 1px 虚线，按像素去点它是"找针"，
   * 所以命中判定用更宽的对象——交线用不可见的加粗线，截面则用整块剖切面（在面上任意位置点都能创建）。
   */
  const hitTargets: THREE.Object3D[] = []
  /** 命中区按种类分：交线用加粗不可见线；截面只用它那圈边界线（面片不是命中区）。 */
  const lineHitTargets: THREE.Object3D[] = []
  const points: THREE.Vector3[] = []
  if (preview.kind === "intersection") {
    for (const segment of preview.segments) {
      points.push(new THREE.Vector3(segment.a.x, segment.a.y, segment.a.z), new THREE.Vector3(segment.b.x, segment.b.y, segment.b.z))
    }
  } else {
    const loop = preview.points.length >= 2 ? [...preview.points, preview.points[0]] : []
    for (const point of loop) points.push(new THREE.Vector3(point.x, point.y, point.z))
    // 截面预览额外画出剖切面本身：只有交线时看不出"切在哪"，也看不出往哪边挪。
    if (preview.plane) {
      const patch = createPlanePatch(preview.plane, preview.points, { color: "#f04f5f", opacity: 0.12, dashedEdges: true })
      if (patch) {
        patch.userData.visualRole = "section-preview-plane"
        group.add(patch)
      }
    }
  }
  if (points.length >= 2) {
    // 截面用闭合折线（Line），交线用线段集合（LineSegments）：前者是一圈边界，后者是若干条交线。
    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    const material = new THREE.LineDashedMaterial({ color: "#f04f5f", dashSize: 0.35, gapSize: 0.25, transparent: true, opacity: 0.85 })
    const line = preview.kind === "section" ? new THREE.Line(geometry, material) : new THREE.LineSegments(geometry, material)
    line.computeLineDistances()
    line.userData.visualRole = "intersection-preview-line"
    group.add(line)
    if (interactive) {
      // 命中带：用一根不可见但更粗的线承担拾取，避免用户必须点到 1px 宽的虚线上。
      const hit = preview.kind === "section"
        ? new THREE.Line(geometry.clone(), new THREE.LineBasicMaterial({ transparent: true, opacity: 0 }))
        : new THREE.LineSegments(geometry.clone(), new THREE.LineBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }))
      hit.userData.visualRole = "intersection-preview-hit"
      group.add(hit)
      hitTargets.push(hit)
      if (preview.kind === "section") lineHitTargets.push(hit)
    }
  }
  group.userData.hitTargets = hitTargets
  /**
   * 截面预览只认边界线：把整块剖切面当命中区会覆盖实体的一大片投影，
   * 于是点画布上任意位置的顶点都算"指向预览"，把普通选择变成创建截面（实测回归）。
   */
  group.userData.lineHitTargets = lineHitTargets
  group.userData.onHoverChange = onHoverChange
  return group
}
