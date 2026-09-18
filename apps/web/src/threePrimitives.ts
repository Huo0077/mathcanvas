/**
 * 3D 图元构造：网格 / 棱 / 面 / 截面 / 展开网 / 平面片与释放
 *
 * 从 threeScene.tsx 抽出来的纯函数：它们与 React 无关，独立成模块后可以直接单测，
 * 组件文件也不再混着一堆非组件导出（react-refresh 的告警就是这么来的）。
 */
import * as THREE from "three"
import type { ConePrimitive, Conic3, CubePrimitive, CurvePiece3, CylinderPrimitive, Edge3Primitive, Face3Primitive, GeometryDocument, Line3Primitive, Plane3Primitive, Point3Primitive, PrimitiveSpec, PyramidPrimitive, Ray3Primitive, SectionPrimitive, Segment3Primitive, Vector3 } from "@draw/dsl"
import { conic3FromCircle3, type DihedralMarker3, type UnfoldLayout3 } from "@draw/geometry-kernel"
import { sampleClosedConic, sampleCurvePieces } from "./conicSampling"
import { circleRadiusHandlePoint } from "./threeDrag"
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

/**
 * 解析圆锥曲线的渲染：按**屏幕误差**细分（`tolerance` 是世界单位），所以放大不看出棱、缩远不浪费。
 *
 * 用户口径："我不要一个逼近的圆，我需要一个真的圆。" 曲线本身是解析的，只有"画出来"这一步要离散化。
 * 描边用 `THREE.Line`（与既有棱线、截面边界同一套 1px 线宽语言）：本轮要解决的是**曲线形状**，
 * 不是描边宽度；真要按像素宽画粗线时再上 `Line2`（它也不替你重采样，点还是这里算的）。
 */
export function createConic3Line(primitiveId: string, conic: Conic3, tolerance: number, selected: boolean, color?: string): THREE.Line | null {
  if (!conic.closed) return null
  const sampled = sampleClosedConic(conic, tolerance)
  if (sampled.length < 3) return null
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(sampled.map((point) => new THREE.Vector3(point.x, point.y, point.z))),
    new THREE.LineBasicMaterial({ color: selected ? "#4c3ac7" : color ?? "#0f766e" })
  )
  line.userData.primitiveId = primitiveId
  line.userData.visualRole = "exact-curve"
  line.userData.segmentCount = sampled.length - 1
  return line
}

/**
 * 圆类实体的**边界圆**：圆柱的上下底、圆锥的底，每个圆一条解析曲线（按屏幕误差细分）。
 *
 * 48 段近似下这两圈是 96 条弦，弦高偏差 `R(1 − cos(π/48))`，放大就出棱。
 * 那些弦仍留在文档里（对象列表、拾取、面片要用），画布改由这里画真圆。
 */
export function createRimCircles3(primitiveId: string, circles: Conic3[], tolerance: number, selected: boolean, color?: string): THREE.Group | null {
  const group = new THREE.Group()
  let segments = 0
  for (const circle of circles) {
    const line = createConic3Line(primitiveId, circle, tolerance, selected, color)
    if (!line) continue
    segments += Number(line.userData.segmentCount ?? 0)
    group.add(line)
  }
  if (group.children.length === 0) return null
  group.userData.primitiveId = primitiveId
  group.userData.visualRole = "rim-circles"
  group.userData.segmentCount = segments
  return group
}

/**
 * 截面 / 交面的解析边界：每个闭合环一条折线（环由"圆锥曲线弧 + 端面弦"拼成）。
 *
 * `role` 让调用方保留自己的视觉角色（截面是默认的 `exact-curve`、交面是 `intersection-face-edge`）：
 * 画布读数与 e2e 都按角色找对象，边界换了画法不该把角色也换掉。整圈的片段由 `sampleCurvePieces`
 * 交给闭式段数公式（见 `conicSampling.ts`），所以这里给出的点列一定落在**真曲线**上。
 */
export function createCurveLoops3(primitiveId: string, loops: CurvePiece3[][], tolerance: number, selected: boolean, color?: string, role = "exact-curve"): THREE.Group | null {
  const group = new THREE.Group()
  let segments = 0
  loops.forEach((loop, loopIndex) => {
    const sampled = sampleCurvePieces(loop, tolerance)
    if (sampled.length < 2) return
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(sampled.map((point) => new THREE.Vector3(point.x, point.y, point.z))),
      new THREE.LineBasicMaterial({ color: selected ? "#4c3ac7" : color ?? "#f97316" })
    )
    line.userData.visualRole = role
    line.userData.sectionLoopIndex = loopIndex
    line.userData.segmentCount = sampled.length - 1
    segments += sampled.length - 1
    group.add(line)
  })
  if (group.children.length === 0) return null
  group.userData.primitiveId = primitiveId
  group.userData.visualRole = `${role}-group`
  group.userData.segmentCount = segments
  return group
}

/** DSL 的空间圆图元：解析圆的真曲线（圆心是图元自己的字段，不需要点表）。 */
export function createCircle3Line(primitive: Extract<PrimitiveSpec, { type: "circle3" }>, tolerance: number, selected: boolean): THREE.Line | null {
  const conic = conic3FromCircle3(primitive)
  if (!conic) return null
  const line = createConic3Line(primitive.id, conic, tolerance, selected, strokeFor(primitive))
  if (line) line.userData.primitiveType = primitive.type
  return line
}

export function createSectionMesh(primitive: SectionPrimitive, options: { omitBoundary?: boolean } = {}): THREE.Object3D | null {
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
    group.add(mesh)
    // 解析可用时边界交给真曲线（`createCurveLoops3`）：这里只画填充，否则会同时出现一圈多边形弦。
    if (options.omitBoundary) return
    // Section points are ordered along the boundary, so the closed loop reflects the real cut outline.
    const boundaryPoints = [...loop, loop[0]].map((point) => new THREE.Vector3(point.x, point.y, point.z))
    const boundary = new THREE.Line(new THREE.BufferGeometry().setFromPoints(boundaryPoints), new THREE.LineBasicMaterial({ color: sectionColor }))
    boundary.userData.visualRole = "section-boundary"
    boundary.userData.sectionLoopIndex = loopIndex
    mesh.add(boundary)
  })
  return group.children.length > 0 ? group : null
}

/** 区域填充的参数：形状（极点 / 缝合带 / 扇形）+ 解析曲面 + 屏幕误差容差。 */
export interface RegionFillOptions {
  /** 前导外环的顶点数（缝合带，见内核 `outerRingLength`）。 */
  outerRingLength?: number
  /** 极点下标（圆锥侧面，见内核 `poleIndex`）。 */
  poleIndex?: number
  /** 这块区域所在的解析曲面：给了它（且容差可用）就按屏幕误差细分、把新顶点吸到真正的曲面上。 */
  surface?: RegionSurfaceGeometry
  /** 世界单位的屏幕误差容差（`curveToleranceFor`）。 */
  tolerance?: number
}

/** 有限二次曲面：底圆心 + 轴向 + 底半径 + 轴向高（圆柱半径恒定、圆锥半径线性收缩到 0）。 */
export interface RegionSurfaceGeometry {
  kind: "cylinder" | "cone"
  origin: Vector3
  axis: Vector3
  radius: number
  height: number
}

/**
 * 区域多边形的**填充三角化**（位置数组，非索引几何）。
 *
 * 形状按"数据里带了什么"决定，缺省是"凸平面多边形的扇形"：
 *
 * 1. **极点**（`poleIndex`，圆锥侧面就是）：极点待在曲面内部、不在边界环上，填充必须绕它铺开。
 *    只按边界环铺的话，一张"圆锥面"会被填成底面那团圆盘（形心还和真正的底面圆盘区域重合）——
 *    用户反馈的"交出一大堆面，但是无法获取那个曲面"，一半的原因就在这里。
 * 2. **缝合带**（`outerRingLength`）：内核给的 `points` 是"前导外环 + 其余环**反向**缝合"的多边形
 *   （配对规则 `points[长度 − 1 − i] ↔ points[i]`），对它做扇形会把两圈之间那个"洞"整块填掉——
 *    实测立方体 ∩ 圆柱的侧带会画成"顶上一块圆盘 + 几片横穿圆柱内部的三角形"。所以按**环向条带**缝。
 * 3. 其余（平面区域）：从第一点扇形铺开就行。
 *
 * **曲面区域还要再走一步**（`surface` + `tolerance`）：上面三种铺法用的都是**网格顶点**（默认 48 段），
 * 照它画出来的"圆柱面 / 圆锥面"是一圈平面三角形——默认缩放下能看出竖条纹、放大后侧影是多边形
 *（用户口径："我需要的只是那个相交的曲面，但是在我们的图里面，相交那个曲面是由很多三角形拼出来的"）。
 * 所以把每个三角形按**屏幕误差**均分成 `n²` 片，并把每个新顶点**吸到真正的曲面上**：
 * 弦高 ≤ 容差 ⇒ 画面上就是一条光滑曲面（与 A1 的"真圆"同一套思路）。`n` 对整块区域取同一个值
 *（用区域最长边的弦高反推），这样共享边上的细分点两边算出来完全一样、**不会裂**。
 *
 * 退化三角形（重合点）直接跳过：写进去只会得到零面积片，法向也没意义。
 */
export function regionFillPositions(points: Vector3[], options: RegionFillOptions = {}): number[] {
  const triangles: [number, number, number][] = []
  const push = (first: number, second: number, third: number) => {
    if (first === second || second === third || first === third) return
    triangles.push([first, second, third])
  }
  const { outerRingLength, poleIndex } = options
  if (poleIndex !== undefined && poleIndex >= 0 && poleIndex < points.length && points.length >= 4) {
    // 绕极点铺：每条边界边（去掉极点后首尾相接）与极点之间一片三角形。
    const ring = points.map((_, index) => index).filter((index) => index !== poleIndex)
    for (let index = 0; index < ring.length; index += 1) push(poleIndex, ring[index], ring[(index + 1) % ring.length])
  } else if (outerRingLength !== undefined && outerRingLength >= 3 && points.length >= 2 * outerRingLength) {
    for (let index = 0; index < outerRingLength; index += 1) {
      const next = (index + 1) % outerRingLength
      const inner = points.length - 1 - index
      const innerNext = points.length - 1 - next
      push(index, next, innerNext)
      push(index, innerNext, inner)
    }
  } else {
    for (let index = 1; index < points.length - 1; index += 1) push(0, index, index + 1)
  }
  return curvedFillPositions(points, triangles, options)
}

/** 每块区域最多细分出多少片：再密也看不出差别，只是白占显存（性能保护，不是精度上限）。 */
const MAX_REGION_TRIANGLES = 20000

/** 按一张二次曲面把三角形铺开：不细分时就是原样（只把顶点吸到曲面上），细分时子边弦高 ≤ 容差。 */
function curvedFillPositions(points: Vector3[], triangles: [number, number, number][], options: RegionFillOptions): number[] {
  const surface = options.surface
  const tolerance = options.tolerance
  const positions: number[] = []
  const snap = surface && Number.isFinite(tolerance) && (tolerance ?? 0) > 0 ? (point: Vector3) => snapToSurface(surface, point) : (point: Vector3) => point
  const divisions = surface && Number.isFinite(tolerance) && (tolerance ?? 0) > 0 ? subdivisionCount(points, triangles, surface, tolerance as number) : 1
  for (const triangle of triangles) {
    const corners = triangle.map((index) => snap(points[index]))
    if (divisions <= 1) {
      for (const corner of corners) positions.push(corner.x, corner.y, corner.z)
      continue
    }
    // 重心坐标均分：`(i, j)` 处的点是 `a + (b − a)·i/n + (c − a)·j/n`（`i + j ≤ n`）。
    const at = (i: number, j: number) => {
      const u = i / divisions
      const v = j / divisions
      const point = {
        x: corners[0].x + (corners[1].x - corners[0].x) * u + (corners[2].x - corners[0].x) * v,
        y: corners[0].y + (corners[1].y - corners[0].y) * u + (corners[2].y - corners[0].y) * v,
        z: corners[0].z + (corners[1].z - corners[0].z) * u + (corners[2].z - corners[0].z) * v
      }
      return snap(point)
    }
    for (let i = 0; i < divisions; i += 1) {
      for (let j = 0; j < divisions - i; j += 1) {
        const first = at(i, j)
        const second = at(i + 1, j)
        const third = at(i, j + 1)
        for (const vertex of [first, second, third]) positions.push(vertex.x, vertex.y, vertex.z)
        if (i + j + 2 > divisions) continue
        // 上方那一半（i + j + 1 < n 时存在）。
        const opposite = at(i + 1, j + 1)
        for (const vertex of [second, opposite, third]) positions.push(vertex.x, vertex.y, vertex.z)
      }
    }
  }
  return positions
}

/**
 * 每个三角形要均分成 `n × n`：`n` 由**区域最长边**的弦高反推。
 *
 * 一段弦高 `h` 的边，均分成 `n` 份后弦高降到 `h / n²`；要求 `h / n² ≤ tolerance` ⇒ `n ≈ √(h / tolerance)`。
 * 对整块区域取**同一个** `n`，共享边两边的细分点才算得一样（否则会出现 T 形接缝、画面上就是裂缝）。
 * 上限 `MAX_REGION_TRIANGLES` 是性能保护：到了那一步每个面片都远小于一个像素。
 */
function subdivisionCount(points: Vector3[], triangles: [number, number, number][], surface: RegionSurfaceGeometry, tolerance: number): number {
  let worst = 0
  for (const triangle of triangles) {
    for (let edge = 0; edge < 3; edge += 1) {
      const from = points[triangle[edge]]
      const to = points[triangle[(edge + 1) % 3]]
      const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, z: (from.z + to.z) / 2 }
      const snapped = snapToSurface(surface, middle)
      // 弦高 = 中点离真曲面的距离 ×2（弦在中点处的最大偏差就是它）。
      worst = Math.max(worst, 2 * Math.hypot(snapped.x - middle.x, snapped.y - middle.y, snapped.z - middle.z))
    }
  }
  if (!(worst > tolerance)) return 1
  const needed = Math.ceil(Math.sqrt(worst / tolerance))
  const affordable = Math.max(1, Math.floor(Math.sqrt(MAX_REGION_TRIANGLES / Math.max(triangles.length, 1))))
  return Math.max(1, Math.min(needed, affordable))
}

/**
 * 把一个点**吸到**这张二次曲面上：轴向坐标不变，径向距离改成该高度处的半径
 * （圆柱恒定 `radius`；圆锥 `radius·(1 − 轴向/高)`，锥尖处为 0）。
 *
 * 落在轴向范围之外的点了（浮点残差或退化输入）原样返回：宁可画旧位置，也不把它甩到别处去。
 */
export function snapToSurface(surface: RegionSurfaceGeometry, point: Vector3): Vector3 {
  const axisLength = Math.hypot(surface.axis.x, surface.axis.y, surface.axis.z)
  if (!(axisLength > 0) || !(surface.radius > 0) || !(surface.height > 0)) return point
  const axis = { x: surface.axis.x / axisLength, y: surface.axis.y / axisLength, z: surface.axis.z / axisLength }
  const offset = { x: point.x - surface.origin.x, y: point.y - surface.origin.y, z: point.z - surface.origin.z }
  const axial = offset.x * axis.x + offset.y * axis.y + offset.z * axis.z
  if (axial < -1e-9 || axial > surface.height + 1e-9) return point
  const radial = { x: offset.x - axial * axis.x, y: offset.y - axial * axis.y, z: offset.z - axial * axis.z }
  const distance = Math.hypot(radial.x, radial.y, radial.z)
  if (!(distance > 0)) return point
  const level = surface.kind === "cylinder" ? surface.radius : surface.radius * (1 - axial / surface.height)
  if (!(level > 0)) return point
  const scale = level / distance
  return {
    x: surface.origin.x + axial * axis.x + radial.x * scale,
    y: surface.origin.y + axial * axis.y + radial.y * scale,
    z: surface.origin.z + axial * axis.z + radial.z * scale
  }
}

/**
 * 区域多边形的**边界环**顶点（首尾不重复）：解析边界不可用时的多边形兜底。
 *
 * 极点（`poleIndex`）**不是边界上的点**：它待在曲面内部，画进边界会多出一圈"从极点出发的辐条"。
 */
function ringVertices(points: Vector3[], poleIndex?: number): THREE.Vector3[] {
  return points.filter((_, index) => index !== poleIndex).map((point) => new THREE.Vector3(point.x, point.y, point.z))
}

/** Render a computed unfold layout as one filled mesh plus an outline per face, keeping pick metadata on each face. */
/**
 * 交面图元：布尔交集的**一个支撑曲面区域**（用户口径："我需要的交面只是一个表面"）。
 *
 * 填色跟着图元样式走——用户要的就是"交面内部填充颜色可以更改"：`style.fill` 原样使用
 *（包括用户特意选的白色），只在完全没设过时才给一个默认的红色系；`style.opacity` 与
 * `style.stroke` 同样照办，否则检查器里那几个控件就是摆设。
 *
 * `tolerance` 是曲线的**屏幕误差容差**（世界单位，见 `conicSampling.ts`）：文档里带着解析边界
 *（`exactLoops`）且容差可用时，边界画成**真曲线**（按屏幕误差细分，放大不看出棱）；文档里带着解析曲面
 *（`surface`）时，**填充**也按同一个容差细分并吸回真正的曲面上——于是这块"圆柱面 / 圆锥面"是一条光滑
 * 曲面，而不是一圈平面三角形（用户口径："我需要的只是那个相交的曲面，但是在我们的图里面，相交那个曲面
 * 是由很多三角形拼出来的"）。容差不可用时如实退回多边形弦与网格面片，绝不拿 NaN / 无穷去采样。
 */
export function createIntersectionFaceGroup(
  primitive: Extract<PrimitiveSpec, { type: "intersectionFace" }>,
  selected: boolean,
  tolerance?: number
): THREE.Object3D | null {
  const ring = primitive.points
  if (ring.length < 3) return null
  const positions = regionFillPositions(ring, { outerRingLength: primitive.outerRingLength, poleIndex: primitive.poleIndex, surface: primitive.surface, tolerance })
  if (positions.length < 9) return null
  const vertices = ringVertices(ring, primitive.poleIndex)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  const opacity = opacityFor(primitive)
  const group = new THREE.Group()
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color: primitive.style?.fill ?? "#f04f5f",
    transparent: opacity < 1,
    opacity,
    side: THREE.DoubleSide,
    // 交面片嵌在别的实体里也很常见：不写深度，免得把它后面的东西整块挡掉。
    depthWrite: opacity >= 1
  }))
  mesh.userData.primitiveId = primitive.id
  mesh.userData.primitiveType = primitive.type
  mesh.userData.visualRole = "intersection-face"
  // 这片填充用了多少三角形（画布读数用它说明"曲面按屏幕误差细分"确实在生效）。
  mesh.userData.triangleCount = positions.length / 9
  group.userData.triangleCount = positions.length / 9
  group.add(mesh)

  const exactLoops = primitive.exactLoops && primitive.exactLoops.length > 0 ? primitive.exactLoops : null
  const stroke = selected ? "#4c3ac7" : strokeFor(primitive)
  const exact = exactLoops && tolerance !== undefined && Number.isFinite(tolerance) && tolerance > 0
    ? createCurveLoops3(primitive.id, exactLoops, tolerance, selected, stroke, "intersection-face-edge")
    : null
  if (exact) {
    group.add(exact)
    // 画布读数按"这个对象上有多少段解析曲线"统计：边界是真曲线时才报段数。
    if (typeof exact.userData.segmentCount === "number") group.userData.segmentCount = exact.userData.segmentCount
  } else {
    const edgePoints: THREE.Vector3[] = []
    for (let index = 0; index < vertices.length; index += 1) {
      edgePoints.push(vertices[index].clone(), vertices[(index + 1) % vertices.length].clone())
    }
    const edge = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(edgePoints),
      new THREE.LineBasicMaterial({ color: stroke, transparent: opacity < 1, opacity })
    )
    edge.userData.primitiveId = primitive.id
    edge.userData.visualRole = "intersection-face-edge"
    group.add(edge)
  }
  group.userData.primitiveId = primitive.id
  group.userData.primitiveType = primitive.type
  return group
}

/**
 * 交点图元：交线的端点 / 拐点。
 *
 * 画成一个单位球（半径由场景按屏幕尺寸统一缩放，与空间点手柄同一套约定），因此远看近看都一样大、
 * 都好点；它是**派生**对象，拖动不会改文档（重算会把它放回去），所以没有手柄那套拖拽行为。
 */
export function createIntersectionPointGroup(primitive: Extract<PrimitiveSpec, { type: "intersectionPoint3" }>, selected: boolean): THREE.Mesh {
  const opacity = opacityFor(primitive)
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({
    color: selected ? "#4c3ac7" : strokeFor(primitive),
    transparent: opacity < 1,
    opacity
  }))
  mesh.scale.setScalar(DEFAULT_POINT_HANDLE_RADIUS)
  mesh.position.set(primitive.position.x, primitive.position.y, primitive.position.z)
  mesh.userData.primitiveId = primitive.id
  mesh.userData.primitiveType = primitive.type
  mesh.userData.visualRole = "intersection-point"
  return mesh
}

/**
 * 交面图元（整体）：布尔交集的多面体表面。
 * - 面：半透明填充（可拾取：点它就是选中这个交面图元）；
 * - 棱：实线描边，让"公共区域长什么样"一眼看得出；
 * - 顶点不单独画：交面的顶点就是交线的端点，交线图元已经在画它们了。
 */
export function createIntersectionSolidGroup(primitive: Extract<PrimitiveSpec, { type: "intersectionSolid" }>, selected: boolean): THREE.Object3D | null {
  if (primitive.faces.length === 0 || primitive.vertices.length < 3) return null
  const group = new THREE.Group()
  group.userData.primitiveId = primitive.id
  group.userData.primitiveType = primitive.type
  group.userData.visualRole = "intersection-solid"
  group.userData.faceCount = primitive.faces.length
  // 填色跟着图元样式走；用户没设过 fill（默认白）时用交面自己的红色系，别在画布上变成一块白板。
  const fill = primitive.style?.fill && primitive.style.fill !== "#ffffff" ? primitive.style.fill : "#f04f5f"
  const stroke = primitive.style?.stroke ?? "#b91c1c"
  primitive.faces.forEach((face, faceIndex) => {
    const positions: number[] = []
    for (let index = 1; index < face.length - 1; index += 1) {
      for (const vertexIndex of [face[0], face[index], face[index + 1]]) {
        const vertex = primitive.vertices[vertexIndex]
        if (vertex) positions.push(vertex.x, vertex.y, vertex.z)
      }
    }
    if (positions.length < 9) return
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
    geometry.computeVertexNormals()
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: fill, transparent: true, opacity: selected ? 0.42 : 0.28, side: THREE.DoubleSide, depthWrite: false }))
    mesh.userData.primitiveId = primitive.id
    mesh.userData.primitiveType = primitive.type
    mesh.userData.visualRole = "intersection-solid"
    mesh.userData.faceIndex = faceIndex
    group.add(mesh)
  })
  const edgePoints: THREE.Vector3[] = []
  for (const face of primitive.faces) {
    for (let index = 0; index < face.length; index += 1) {
      const current = primitive.vertices[face[index]]
      const next = primitive.vertices[face[(index + 1) % face.length]]
      if (current && next) edgePoints.push(new THREE.Vector3(current.x, current.y, current.z), new THREE.Vector3(next.x, next.y, next.z))
    }
  }
  if (edgePoints.length >= 2) {
    const edge = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(edgePoints), new THREE.LineBasicMaterial({ color: stroke, transparent: true, opacity: selected ? 1 : 0.8 }))
    edge.userData.visualRole = "intersection-solid-edge"
    edge.userData.primitiveId = primitive.id
    group.add(edge)
  }
  return group.children.length > 0 ? group : null
}

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
export function buildPointDrivenObject(primitive: PrimitiveSpec, points: Map<string, Point3Primitive>, selected: boolean, tolerance = 0.005): THREE.Object3D | null {
  /**
   * 点手柄画在 `points` 里的坐标上，**不是**文档里的坐标。
   *
   * 拖动期间文档不提交，新坐标只写在 `points` 里（绑定点沿宿主滑动、点跟着轨道半径手柄缩放都是这样）。
   * 按文档坐标重建，画面上就是"拖了半天那个点还钉在原地，松手才跳过去"——用户实测反馈
   * "动点移动的时候我只能看到在拖动但是拖到哪里了根本不知道，直到松手才能看到位置"。
   *
   * 整场同步时 `points` 就是按文档重建的（`threeScene.tsx` 里同步开头那一句），两者恒等，
   * 所以这里优先取 `points` 不改变整场同步的结果。
   */
  if (primitive.type === "point3") {
    const live = points.get(primitive.id)
    return createPoint3Mesh(live ? { ...primitive, position: live.position } : primitive, selected)
  }
  if (primitive.type === "line3" || primitive.type === "segment3" || primitive.type === "ray3") return createPointDrivenLine(primitive, points, selected)
  if (primitive.type === "edge3") return createEdge3Line(primitive, points, selected)
  if (primitive.type === "face3") return createFace3Mesh(primitive, points, selected)
  if (primitive.type === "circle3") return createCircle3Line(primitive, tolerance, selected)
  return null
}

/** 三个世界轴的环色：与坐标轴同一套语义（X 红 / Y 绿 / Z 蓝），用户拖哪个环就是绕哪个轴转。 */
export const ROTATION_AXIS_COLORS: Record<"x" | "y" | "z", string> = { x: "#dc2626", y: "#16a34a", z: "#2563eb" }

/** 旋转手柄的语义标记：画布上"哪些对象是手柄"的唯一判据（它不是图形内容、也没有 `primitiveId`）。 */
export const ROTATION_HANDLE_ROLE = "rotation-handle"

/**
 * 三个世界轴上的旋转环（选中**恰好一个**可转对象时画）。
 *
 * 几条刻意的选择：
 * - 环**不挂** `primitiveId`：它们不是图元，偏移 / 临时旋转那些按 id 遍历的逻辑必须跳过它们；
 * - `excludeFromFit`：手柄不该把"适应视图"的包围盒撑大；
 * - `depthTest: false` + 高 `renderOrder`：被实体挡住的那半圈也要看得见、抓得到——
 *   实体内部的环只画一半，用户根本不知道能往那边拖；
 * - 环的平面与轴垂直（`TorusGeometry` 的轴是 +Z，另外两个各转 90°）。
 */
export function createRotationHandles(center: Vector3, radius: number, activeAxis: "x" | "y" | "z" | null = null): THREE.Group | null {
  if (!Number.isFinite(radius) || radius <= 0) return null
  const group = new THREE.Group()
  group.userData.visualRole = ROTATION_HANDLE_ROLE
  group.userData.excludeFromFit = true
  group.position.set(center.x, center.y, center.z)
  const tube = Math.max(radius * 0.02, 0.02)
  for (const axis of ["x", "y", "z"] as const) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, tube, 8, 96),
      new THREE.MeshBasicMaterial({
        color: ROTATION_AXIS_COLORS[axis],
        transparent: true,
        // 正在拖的那个轴更实，其余淡下去：多环同时存在时"我在转哪个"必须一眼看得出。
        opacity: activeAxis === null || activeAxis === axis ? 0.9 : 0.35,
        depthTest: false,
        depthWrite: false
      })
    )
    if (axis === "x") ring.rotation.y = Math.PI / 2
    if (axis === "y") ring.rotation.x = Math.PI / 2
    ring.renderOrder = 30
    ring.userData.visualRole = ROTATION_HANDLE_ROLE
    ring.userData.rotationAxis = axis
    group.add(ring)
  }
  return group
}

/**
 * 轨道圆的**半径手柄**：圆周上一个小球 ＋ 从圆心到它的虚线半径。
 *
 * 用户口径："圆要可以缩放旋转"。旋转有世界轴三色环，缩放就是这个手柄：抓住小球往外拉，半径跟着变。
 * 几条与旋转环一致的选择：
 * - 不参与取景（`excludeFromFit`）：手柄不是图形内容；
 * - 命中区**只算那个小球**（`userData.hitTargets`）——虚线半径横跨圆内部，若把它也算进命中，
 *   "拖圆本体平移"就会时不时变成"改半径"；
 * - `depthTest: false` ＋ 高 `renderOrder`：被实体挡住也要看得见、抓得到；
 * - 手柄尺寸是**世界尺寸**、跟着轨道半径走（与三色环同一套约定），不是屏幕恒定大小。
 */
export function createTrackRadiusHandle(center: Vector3, normal: Vector3, radius: number): THREE.Group | null {
  if (!Number.isFinite(radius) || radius <= 0) return null
  const normalLength = Math.hypot(normal.x, normal.y, normal.z)
  if (!Number.isFinite(normalLength) || normalLength < 1e-9) return null
  const rim = circleRadiusHandlePoint(center, normal, radius)
  const group = new THREE.Group()
  group.userData.visualRole = "track-radius-handle"
  group.userData.excludeFromFit = true
  const dotRadius = Math.max(0.06, Math.min(0.16, radius * 0.06))
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(dotRadius, 16, 12),
    new THREE.MeshBasicMaterial({ color: "#0f766e", transparent: true, opacity: 0.95, depthTest: false, depthWrite: false })
  )
  dot.position.copy(rim)
  dot.renderOrder = 31
  dot.userData.visualRole = "track-radius-handle"
  const spoke = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(center.x, center.y, center.z), rim]),
    new THREE.LineDashedMaterial({ color: "#0f766e", dashSize: Math.max(0.08, radius * 0.08), gapSize: Math.max(0.05, radius * 0.05), transparent: true, opacity: 0.75, depthTest: false })
  )
  spoke.computeLineDistances()
  spoke.renderOrder = 30
  spoke.userData.visualRole = "track-radius-spoke"
  group.add(spoke, dot)
  // 命中只认小球（见上面第 2 条）。
  group.userData.hitTargets = [dot]
  group.userData.handlePoint = rim
  return group
}

export function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Line) && !(object instanceof THREE.LineSegments)) return
    // 共享资源不能跟着某一个对象释放：所有预览的交点标记共用同一份几何与材质，
    // 释放其中一份会把还在用的其它预览一起掏空（多份预览同时存在时必然发生）。
    if (object.geometry.userData.shared !== true) object.geometry.dispose()
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    materials.forEach((material) => { if (material.userData?.shared !== true) material.dispose() })
  })
}

export function disposeScene(scene: THREE.Scene): void {
  for (const child of [...scene.children]) disposeObject(child)
}

/**
 * 虚线预览：低不透明度 + 虚线的交线/截面，明确区别于用户已创建的图元。
 *
 * `highlighted` 只影响**画法**（指针落在上面时更实一点），不影响命中区：
 * 命中区必须一直在，否则"原地点击"（浏览器不保证先发 pointermove）会命中不了自己的预览。
 *
 * `tolerance` 是屏幕误差容差：曲面交面预览也按它把填充细分并吸到真正的曲面上——
 * 预览就是"点下去会建出什么"的样子，它要是还由一圈平面三角形拼成，用户看到的就还是那句话。
 */
export function createPreviewGroup(
  preview: ThreeScenePreview,
  highlighted: boolean,
  onHoverChange: (hovering: boolean) => void,
  tolerance?: number
): THREE.Group {
  const group = new THREE.Group()
  group.userData.visualRole = "intersection-preview"
  // 预览不是图形内容：它绝不能参与"适应视图"的包围盒，否则它会把取景范围撑大。
  group.userData.excludeFromFit = true
  /**
   * 拾取用的子对象集合单独放在一个子组里：预览的可见线是 1px 虚线，按像素去点它是"找针"，
   * 所以命中判定用更宽的对象——交线用不可见的加粗线，截面用它那圈边界线的加粗副本，
   * 交面用它自己的面片。
   */
  const hitTargets: THREE.Object3D[] = []
  const lineHitTargets: THREE.Object3D[] = []
  const points: THREE.Vector3[] = []
  if (preview.kind === "face") {
    addFacePreview(group, preview, highlighted, hitTargets, tolerance)
  } else if (preview.kind === "point") {
    addPointPreview(group, preview, highlighted, hitTargets)
  } else if (preview.kind === "intersection") {
    for (const segment of preview.segments) {
      points.push(new THREE.Vector3(segment.a.x, segment.a.y, segment.a.z), new THREE.Vector3(segment.b.x, segment.b.y, segment.b.z))
    }
  } else {
    const loop = preview.points.length >= 2 ? [...preview.points, preview.points[0]] : []
    for (const point of loop) points.push(new THREE.Vector3(point.x, point.y, point.z))
  }
  /**
   * 这里**不再**画那块半透明剖切面。
   *
   * 用户反馈得很直接："我需要的是交面、交线和交点，而不是创建对象之后中间出现一个大截面。"
   * 选中一个实体时铺一块面片盖在图形中间，既挡视线又和目标无关；真正有用的是**这刀会切出什么**——
   * 那圈交线（虚线边界）与它的交点。剖切面本身属于"创建出来的截面"（交面），
   * 创建之后才画；用户也可以拖动 / 方向键挪刀口，那时才需要看到面片。
   */
  if (points.length >= 2) {
    // 截面用闭合折线（Line），交线用线段集合（LineSegments）：前者是一圈边界，后者是若干条交线。
    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    const material = new THREE.LineDashedMaterial({ color: "#f04f5f", dashSize: 0.35, gapSize: 0.25, transparent: true, opacity: highlighted ? 1 : 0.85 })
    const line = preview.kind === "section" ? new THREE.Line(geometry, material) : new THREE.LineSegments(geometry, material)
    line.computeLineDistances()
    line.userData.visualRole = "intersection-preview-line"
    group.add(line)
    // 命中带：用一根不可见但更粗的线承担拾取，避免用户必须点到 1px 宽的虚线上。
    const hit = preview.kind === "section"
      ? new THREE.Line(geometry.clone(), new THREE.LineBasicMaterial({ transparent: true, opacity: 0 }))
      : new THREE.LineSegments(geometry.clone(), new THREE.LineBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }))
    hit.userData.visualRole = "intersection-preview-hit"
    group.add(hit)
    hitTargets.push(hit)
    if (preview.kind === "section") lineHitTargets.push(hit)
  }
  if (preview.kind !== "face") {
    if (points.length >= 2) {
      // 交点：截面是环上的顶点、交线是每段的端点（共享端点只标一次）。
      for (const vertex of uniqueVertices(points)) {
        const marker = new THREE.Mesh(previewPointGeometry, previewPointMaterial)
        marker.position.copy(vertex)
        marker.userData.visualRole = "intersection-preview-point"
        // 交点标记只是画给人看的，不能参与拾取（点击由命中区负责）。
        marker.raycast = () => undefined
        group.add(marker)
      }
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

/** 这份预览有没有东西可画：交线要有线段，截面要有边界点，交面要有面环，交点要有位置。 */
export function hasDrawablePreview(preview: ThreeScenePreview): boolean {
  if (preview.kind === "face") return preview.points.length >= 3
  if (preview.kind === "point") return preview.position !== undefined
  if (preview.kind === "intersection") return preview.segments.length > 0
  return preview.points.length >= 2
}

/**
 * 就地切换预览的高亮：悬停只是"更实一点 / 更大一圈"，不该触发内容重建。
 * 交线的透明度、交面片的不透明度、交点标记的缩放都按 `highlighted` 给两档。
 */
export function applyPreviewHighlight(group: THREE.Object3D, highlighted: boolean): void {
  group.traverse((object) => {
    const role = object.userData.visualRole
    const renderable = object as THREE.Mesh | THREE.Line | THREE.LineSegments
    if (role === "intersection-preview-line") setOpacity(renderable, highlighted ? 1 : 0.85)
    else if (role === "intersection-preview-face") setOpacity(renderable, highlighted ? 0.34 : 0.18)
    else if (role === "intersection-preview-edge") setOpacity(renderable, highlighted ? 0.95 : 0.6)
    else if (role === "intersection-preview-point") object.scale.setScalar(highlighted ? 1.6 : 1)
  })
}

function setOpacity(object: THREE.Mesh | THREE.Line | THREE.LineSegments, opacity: number): void {
  const materials = Array.isArray(object.material) ? object.material : [object.material]
  materials.forEach((material) => { material.transparent = true; material.opacity = opacity })
}

/**
 * 交面预览：**一个**平面面片（半透明填充 + 它自己那圈边 + 顶点标记）。
 *
 * 用户口径："我需要的交面只是一个表面，而不是所有相交的表面"——所以交集的每一面各自是一份预览、
 * 各自可点；点哪一块就建哪一块的交面图元。面片本身就是命中区。
 *
 * 不透明度刻意压得很低：画布上可能同时有好几块交面，任何一块都不该挡住别的东西；
 * 指针落上去时（`highlighted`）才加一点，让"点下去会创建哪一块"一目了然。
 */
function addFacePreview(group: THREE.Group, preview: ThreeScenePreview, highlighted: boolean, hitTargets: THREE.Object3D[], tolerance?: number): void {
  const ring = preview.points
  if (ring.length < 3) return
  const positions = regionFillPositions(ring, { outerRingLength: preview.outerRingLength, poleIndex: preview.poleIndex, surface: preview.surface, tolerance })
  if (positions.length < 9) return
  const vertices = ringVertices(ring, preview.poleIndex)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color: "#f04f5f",
    transparent: true,
    opacity: highlighted ? 0.34 : 0.18,
    side: THREE.DoubleSide,
    // 交面预览不参与深度写入：它只是提示，不能把后面的实体挡掉。
    depthWrite: false
  }))
  mesh.userData.visualRole = "intersection-preview-face"
  group.add(mesh)
  hitTargets.push(mesh)

  const edgePoints: THREE.Vector3[] = []
  for (let index = 0; index < vertices.length; index += 1) {
    edgePoints.push(vertices[index].clone(), vertices[(index + 1) % vertices.length].clone())
  }
  const edge = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(edgePoints),
    new THREE.LineBasicMaterial({ color: "#d92b3a", transparent: true, opacity: highlighted ? 0.95 : 0.6 })
  )
  edge.userData.visualRole = "intersection-preview-edge"
  group.add(edge)

  /**
   * 顶点标记只给**平面**区域的拐角。
   *
   * 曲面区域（`outerRingLength` 缝合带 / `poleIndex` 带极点的圆锥面）的 `points` 是网格顶点，
   * 那些点不是任何几何意义上的交点，全标出来的话画布上就是密密麻麻的点（与既有口径冲突：
   * "光滑交线一个采样点都不标"）；缝合处的拐角也只是我们拼接多边形的接缝，不是几何特征。
   * 真正的交点标记由**交线**预览负责（`intersectionMarkerPoints`：只标转折 ≥ 18° 的角点）。
   */
  if (preview.outerRingLength !== undefined || preview.poleIndex !== undefined) return
  for (const vertex of uniqueVertices(vertices)) {
    const marker = new THREE.Mesh(previewPointGeometry, previewPointMaterial)
    marker.position.copy(vertex)
    marker.userData.visualRole = "intersection-preview-point"
    marker.raycast = () => undefined
    group.add(marker)
  }
}

/**
 * 交点预览：一个圆点标记 + 一圈**不可见的命中球**。
 *
 * 圆点在屏幕上只有几个像素，直接按像素点它是"找针"，所以命中区用一个稍大的不可见球承担；
 * 标记本身不参与拾取（与其它预览一致）。
 */
function addPointPreview(group: THREE.Group, preview: ThreeScenePreview, highlighted: boolean, hitTargets: THREE.Object3D[]): void {
  const position = preview.position
  if (!position) return
  const marker = new THREE.Mesh(previewPointGeometry, previewPointMaterial)
  marker.position.set(position.x, position.y, position.z)
  marker.scale.setScalar(highlighted ? 1.6 : 1)
  marker.userData.visualRole = "intersection-preview-point"
  marker.raycast = () => undefined
  group.add(marker)

  const hit = new THREE.Mesh(previewPointHitGeometry, previewPointHitMaterial)
  hit.position.copy(marker.position)
  hit.userData.visualRole = "intersection-preview-hit"
  group.add(hit)
  hitTargets.push(hit)
}

/** 预览的交点标记：一份共享几何与材质，避免每个顶点各建一套。 */
const previewPointGeometry = new THREE.SphereGeometry(0.06, 10, 8)
const previewPointMaterial = new THREE.MeshBasicMaterial({ color: "#d92b3a" })
/** 交点预览的命中球：比标记大一圈，但完全透明（只用来接点击）。 */
const previewPointHitGeometry = new THREE.SphereGeometry(0.16, 8, 6)
const previewPointHitMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
// 标记成共享：`disposeObject` 会跳过它们，否则重建任意一份预览都会掏空其它预览的标记。
previewPointGeometry.userData.shared = true
previewPointMaterial.userData.shared = true
previewPointHitGeometry.userData.shared = true
previewPointHitMaterial.userData.shared = true

/** 去重（同一位置只留一个标记）：`1e-6` 的尺度对预览足够，且不会把相邻顶点误合并。 */
function uniqueVertices(points: THREE.Vector3[]): THREE.Vector3[] {
  const unique: THREE.Vector3[] = []
  for (const point of points) {
    if (unique.some((candidate) => candidate.distanceToSquared(point) < 1e-12)) continue
    unique.push(point)
  }
  return unique
}
