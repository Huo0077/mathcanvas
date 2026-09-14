import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import type { CubePrimitive, Edge3Primitive, Face3Primitive, GeometryDocument, Line3Primitive, Point3Primitive, Polyhedron3Primitive, PyramidPrimitive, CylinderPrimitive, ConePrimitive, Ray3Primitive, SectionPrimitive, Segment3Primitive, Vector3 } from "@draw/dsl"
import { dihedralAngleDegrees, unfoldPolyhedron3, type DihedralMarker3, type UnfoldLayout3 } from "@draw/geometry-kernel"
import { resolveDihedralMarker3, resolvePolyhedronTopology } from "@draw/scene-graph"

import { opacityFor, strokeFor } from "./primitiveStyle"

const scenePalette = {
  background: "#fbfcff",
  grid: "#d9deea"
} as const

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

export interface CameraState {
  azimuth: number
  elevation: number
  distance: number
  target: { x: number; y: number; z: number }
}

export function createCameraState(): CameraState {
  return { azimuth: 45, elevation: 30, distance: 16, target: { x: 0, y: 0, z: 0 } }
}

export function rotateCameraState(state: CameraState, azimuthDelta: number, elevationDelta: number): CameraState {
  return { ...state, azimuth: state.azimuth + azimuthDelta, elevation: Math.max(-85, Math.min(85, state.elevation + elevationDelta)) }
}

export function panCameraState(state: CameraState, x: number, y: number): CameraState {
  return { ...state, target: { ...state.target, x: state.target.x + x, y: state.target.y + y } }
}

export function zoomCameraState(state: CameraState, factor: number): CameraState {
  return { ...state, distance: Math.max(3, Math.min(60, state.distance * factor)) }
}

export function resetCameraState(): CameraState {
  return createCameraState()
}

function applyCameraState(camera: THREE.PerspectiveCamera, state: CameraState): void {
  const azimuth = state.azimuth * Math.PI / 180
  const elevation = state.elevation * Math.PI / 180
  const horizontal = state.distance * Math.cos(elevation)
  camera.position.set(
    state.target.x + horizontal * Math.cos(azimuth),
    state.target.y + state.distance * Math.sin(elevation),
    state.target.z + horizontal * Math.sin(azimuth)
  )
  camera.lookAt(state.target.x, state.target.y, state.target.z)
}

export function pickPrimitiveAt(scene: THREE.Scene, camera: THREE.Camera, normalizedPoint: { x: number; y: number }): string | null {
  return pickRaycastHit3(scene, camera, normalizedPoint)?.primitiveId ?? null
}

export interface RaycastHit3 {
  primitiveId: string
  partId?: string
  depth: number
  worldPoint: Vector3
  kind: "point" | "line" | "edge" | "face" | "solid" | "marker"
}

function pickKind(primitiveType: unknown): RaycastHit3["kind"] {
  if (primitiveType === "point3") return "point"
  if (primitiveType === "edge3") return "edge"
  if (primitiveType === "face3") return "face"
  if (["cube", "pyramid", "cylinder", "cone", "polyhedron3"].includes(String(primitiveType))) return "solid"
  return "line"
}

export function pickRaycastHit3(scene: THREE.Scene, camera: THREE.Camera, normalizedPoint: { x: number; y: number }): RaycastHit3 | null {
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(new THREE.Vector2(normalizedPoint.x * 2 - 1, -(normalizedPoint.y * 2 - 1)), camera)
  scene.updateMatrixWorld(true)
  const intersections = raycaster.intersectObjects(scene.children, true)
  const priority: Record<RaycastHit3["kind"], number> = { point: 0, edge: 1, face: 2, line: 3, solid: 4, marker: 5 }
  const hits = intersections.flatMap((intersection) => {
    const primitiveId = intersection.object.userData.primitiveId
    if (typeof primitiveId !== "string") return []
    const kind = pickKind(intersection.object.userData.primitiveType)
    return [{ primitiveId, partId: typeof intersection.object.userData.partId === "string" ? intersection.object.userData.partId : undefined, depth: intersection.distance, worldPoint: { x: intersection.point.x, y: intersection.point.y, z: intersection.point.z }, kind, priority: priority[kind] }]
  })
  const hit = hits.sort((first, second) => first.priority - second.priority || first.depth - second.depth)[0]
  if (!hit) return null
  return { primitiveId: hit.primitiveId, partId: hit.partId, depth: hit.depth, worldPoint: hit.worldPoint, kind: hit.kind }
}

export function createPoint3Mesh(primitive: Point3Primitive, selected: boolean): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), new THREE.MeshBasicMaterial({ color: selected ? "#4c3ac7" : strokeFor(primitive), transparent: opacityFor(primitive) < 1, opacity: opacityFor(primitive) }))
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

export function createFace3Mesh(primitive: Face3Primitive, points: Map<string, Point3Primitive>, selected: boolean): THREE.Mesh | null {
  const positions = primitive.pointIds.map((id) => point3ById(points, id))
  if (positions.some((position) => !position) || positions.length < 3) return null
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions.flatMap((position) => [position!.x, position!.y, position!.z]), 3))
  const indices: number[] = []
  for (let index = 1; index < positions.length - 1; index += 1) indices.push(0, index, index + 1)
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: selected ? "#4c3ac7" : strokeFor(primitive), transparent: true, opacity: Math.min(0.48, opacityFor(primitive)), side: THREE.DoubleSide }))
  mesh.userData.primitiveId = primitive.id
  mesh.userData.primitiveType = primitive.type
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
  if (primitive.points.length < 2) return null
  const sectionColor = primitive.style?.stroke ?? "#f97316"
  if (primitive.points.length === 2) {
    // A vertex-tangent or edge-coincident cut is a segment, not an area.
    const segment = new THREE.Line(new THREE.BufferGeometry().setFromPoints(primitive.points.map((point) => new THREE.Vector3(point.x, point.y, point.z))), new THREE.LineBasicMaterial({ color: sectionColor }))
    segment.userData.primitiveId = primitive.id
    segment.userData.primitiveType = primitive.type
    segment.userData.visualRole = "section"
    return segment
  }
  const positions = primitive.points.flatMap((point) => [point.x, point.y, point.z])
  const indices: number[] = []
  for (let index = 1; index < primitive.points.length - 1; index += 1) indices.push(0, index, index + 1)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: primitive.style?.fill ?? "#f97316", transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false }))
  mesh.userData.primitiveId = primitive.id
  mesh.userData.primitiveType = primitive.type
  mesh.userData.visualRole = "section"
  // Section points are ordered along the boundary, so the closed loop reflects the real cut outline.
  const boundaryPoints = [...primitive.points, primitive.points[0]].map((point) => new THREE.Vector3(point.x, point.y, point.z))
  const boundary = new THREE.Line(new THREE.BufferGeometry().setFromPoints(boundaryPoints), new THREE.LineBasicMaterial({ color: sectionColor }))
  boundary.userData.visualRole = "section-boundary"
  mesh.add(boundary)
  return mesh
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

export function createSolidGroup(primitive: SolidPrimitive, selected: boolean, options: SolidVisualOptions = {}): THREE.Group {
  if (primitive.type === "cube" && options.unfoldProgress !== undefined && options.unfoldProgress > 0.001) return createCubeUnfoldGroup(primitive, selected, options)
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

function visibleSolids(document: GeometryDocument): SolidPrimitive[] {
  const templateSources = new Set(document.primitives.flatMap((primitive) => primitive.type === "polyhedron3" && primitive.construction?.kind === "template" ? primitive.construction.sourceIds : []))
  return document.primitives.filter((primitive): primitive is SolidPrimitive => ["cube", "pyramid", "cylinder", "cone"].includes(primitive.type) && primitive.visible !== false && !templateSources.has(primitive.id))
}

function disposeScene(scene: THREE.Scene): void {
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Line) && !(object instanceof THREE.LineSegments)) return
    object.geometry.dispose()
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    materials.forEach((material) => material.dispose())
  })
}

export interface ThreeSceneViewProps {
  document: GeometryDocument
  selectedIds: string[]
  onSelect: (id: string | null, additive?: boolean) => void
}

export function ThreeSceneView({ document, selectedIds, onSelect }: ThreeSceneViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const renderTargetRef = useRef<HTMLDivElement>(null)
  const cameraStateRef = useRef<CameraState>(createCameraState())
  const resetCameraRef = useRef<() => void>(() => undefined)
  const [showHiddenEdges, setShowHiddenEdges] = useState(false)
  const [showNormals, setShowNormals] = useState(false)
  const [transparentFaces, setTransparentFaces] = useState(false)
  const [unfolded, setUnfolded] = useState(false)
  const [unfoldProgress, setUnfoldProgress] = useState(0)
  const [showAngle, setShowAngle] = useState(false)
  const [webglAvailable, setWebglAvailable] = useState(true)

  useEffect(() => {
    const target = unfolded ? 1 : 0
    if (prefersReducedMotion()) {
      setUnfoldProgress(target)
      return
    }
    let frame = 0
    const animate = () => {
      setUnfoldProgress((current) => {
        const next = current + (target - current) * 0.2
        if (Math.abs(target - next) > 0.001) frame = requestAnimationFrame(animate)
        return Math.abs(target - next) <= 0.001 ? target : next
      })
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [unfolded])

  useEffect(() => {
    const container = renderTargetRef.current
    if (!container) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(scenePalette.background)
    const width = Math.max(container.clientWidth, 320)
    const height = Math.max(container.clientHeight, 480)
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 1000)
    applyCameraState(camera, cameraStateRef.current)

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      setWebglAvailable(false)
      return
    }
    setWebglAvailable(true)
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2))
    renderer.setSize(width, height, false)
    renderer.domElement.setAttribute("role", "img")
    renderer.domElement.setAttribute("aria-label", "3D 几何画布")
    renderer.domElement.dataset.sceneCanvas = "true"
    container.replaceChildren(renderer.domElement)

    scene.add(new THREE.AmbientLight("#ffffff", 1.7))
    const keyLight = new THREE.DirectionalLight("#ffffff", 2.4)
    keyLight.position.set(6, 10, 8)
    scene.add(keyLight)
    scene.add(new THREE.GridHelper(14, 14, scenePalette.grid, scenePalette.grid))
    scene.add(new THREE.AxesHelper(5))

    const unfoldedPolyhedra = unfoldProgress > 0.001
      ? document.primitives.filter((primitive): primitive is Polyhedron3Primitive => primitive.type === "polyhedron3" && primitive.visible !== false)
      : []
    const unfoldedChildIds = new Set(unfoldedPolyhedra.flatMap((polyhedron) => [...polyhedron.edgeIds, ...polyhedron.faceIds]))
    const points = new Map(document.primitives.filter((primitive): primitive is Point3Primitive => primitive.type === "point3").map((primitive) => [primitive.id, primitive]))
    document.primitives.filter((primitive) => primitive.visible !== false).forEach((primitive) => {
      if (unfoldedChildIds.has(primitive.id)) return
      const selected = selectedIds.includes(primitive.id)
      if (primitive.type === "point3") scene.add(createPoint3Mesh(primitive, selected))
      if (primitive.type === "line3" || primitive.type === "segment3" || primitive.type === "ray3") {
        const line = createPointDrivenLine(primitive, points, selected)
        if (line) scene.add(line)
      }
      if (primitive.type === "edge3") {
        const edge = createEdge3Line(primitive, points, selected)
        if (edge) scene.add(edge)
      }
      if (primitive.type === "face3") {
        const face = createFace3Mesh(primitive, points, selected)
        if (face) scene.add(face)
      }
    })

    visibleSolids(document).forEach((primitive) => {
      const selected = selectedIds.includes(primitive.id)
      scene.add(createSolidGroup(primitive, selected, { showHiddenEdges, showNormals, transparentFaces, unfoldProgress }))
    })
    document.primitives.filter((primitive): primitive is SectionPrimitive => primitive.type === "section" && primitive.visible !== false).forEach((primitive) => {
      const mesh = createSectionMesh(primitive)
      if (mesh) scene.add(mesh)
    })
    let unfoldFaceCount = 0
    unfoldedPolyhedra.forEach((polyhedron) => {
      const topology = resolvePolyhedronTopology(document, polyhedron.id)
      if (!topology) return
      const layout = unfoldPolyhedron3(topology.vertices, topology.faces, unfoldProgress, topology.rootFaceId)
      if (layout.status !== "ok") return
      scene.add(createUnfoldNetGroup(polyhedron.id, layout, selectedIds.includes(polyhedron.id)))
      unfoldFaceCount += layout.faces.length
    })
    const sceneShell = containerRef.current
    let dihedralMarkerCount = 0
    document.measurements
      .filter((measurement) => measurement.metric === "dihedral" && measurement.status === "valid" && measurement.sourceIds.some((id) => selectedIds.includes(id)))
      .forEach((measurement) => {
        const marker = resolveDihedralMarker3(document, measurement.id)
        if (!marker) return
        scene.add(createDihedralMarkerGroup(marker, measurement.sourceIds.every((id) => selectedIds.includes(id))))
        dihedralMarkerCount += 1
      })
    if (sceneShell) {
      sceneShell.dataset.unfoldFaces = String(unfoldFaceCount)
      sceneShell.dataset.unfoldProgress = unfoldProgress.toFixed(2)
      sceneShell.dataset.dihedralMarkers = String(dihedralMarkerCount)
    }

    const render = () => renderer.render(scene, camera)
    const setCameraState = (nextState: CameraState) => {
      cameraStateRef.current = nextState
      applyCameraState(camera, nextState)
      render()
    }
    resetCameraRef.current = () => setCameraState(resetCameraState())
    render()
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      const nextWidth = Math.max(container.clientWidth, 320)
      const nextHeight = Math.max(container.clientHeight, 480)
      camera.aspect = nextWidth / nextHeight
      camera.updateProjectionMatrix()
      renderer.setSize(nextWidth, nextHeight, false)
      render()
    })
    resizeObserver?.observe(container)

    let pointerState: { pointerId: number; x: number; y: number; lastX: number; lastY: number; button: number; moved: boolean; shiftKey: boolean } | null = null
    const pointFromEvent = (event: PointerEvent) => {
      const bounds = renderer.domElement.getBoundingClientRect()
      return { x: (event.clientX - bounds.left) / Math.max(bounds.width, 1), y: (event.clientY - bounds.top) / Math.max(bounds.height, 1) }
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 && event.button !== 1) return
      event.preventDefault()
      const point = pointFromEvent(event)
      pointerState = { pointerId: event.pointerId, x: point.x, y: point.y, lastX: point.x, lastY: point.y, button: event.button, moved: false, shiftKey: event.shiftKey }
      renderer.domElement.setPointerCapture(event.pointerId)
    }
    const handlePointerMove = (event: PointerEvent) => {
      if (!pointerState || pointerState.pointerId !== event.pointerId) return
      const point = pointFromEvent(event)
      const deltaX = point.x - pointerState.lastX
      const deltaY = point.y - pointerState.lastY
      pointerState.moved ||= Math.hypot(point.x - pointerState.x, point.y - pointerState.y) > 0.008
      const nextState = pointerState.button === 1 || pointerState.shiftKey
        ? panCameraState(cameraStateRef.current, -deltaX * cameraStateRef.current.distance * 1.5, deltaY * cameraStateRef.current.distance * 1.5)
        : rotateCameraState(cameraStateRef.current, deltaX * 140, deltaY * 140)
      pointerState.lastX = point.x
      pointerState.lastY = point.y
      setCameraState(nextState)
    }
    const handlePointerUp = (event: PointerEvent) => {
      if (!pointerState || pointerState.pointerId !== event.pointerId) return
      const point = pointFromEvent(event)
      if (!pointerState.moved && pointerState.button === 0) onSelect(pickPrimitiveAt(scene, camera, point), event.shiftKey)
      renderer.domElement.releasePointerCapture(event.pointerId)
      pointerState = null
    }
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      setCameraState(zoomCameraState(cameraStateRef.current, Math.exp(event.deltaY * 0.001)))
    }
    const handleContextMenu = (event: MouseEvent) => event.preventDefault()
    renderer.domElement.addEventListener("pointerdown", handlePointerDown)
    renderer.domElement.addEventListener("pointermove", handlePointerMove)
    renderer.domElement.addEventListener("pointerup", handlePointerUp)
    renderer.domElement.addEventListener("pointercancel", handlePointerUp)
    renderer.domElement.addEventListener("wheel", handleWheel, { passive: false })
    renderer.domElement.addEventListener("contextmenu", handleContextMenu)
    return () => {
      resetCameraRef.current = () => undefined
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown)
      renderer.domElement.removeEventListener("pointermove", handlePointerMove)
      renderer.domElement.removeEventListener("pointerup", handlePointerUp)
      renderer.domElement.removeEventListener("pointercancel", handlePointerUp)
      renderer.domElement.removeEventListener("wheel", handleWheel)
      renderer.domElement.removeEventListener("contextmenu", handleContextMenu)
      resizeObserver?.disconnect()
      disposeScene(scene)
      renderer.dispose()
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement)
    }
  }, [document, onSelect, selectedIds, showHiddenEdges, showNormals, transparentFaces, unfoldProgress])

  const hasGeometry = document.primitives.some((primitive) => ["point3", "line3", "segment3", "ray3", "edge3", "face3", "polyhedron3", "cube", "pyramid", "cylinder", "cone"].includes(primitive.type) && primitive.visible !== false)
  const angle = dihedralAngleDegrees({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })
  return <div className="three-canvas-shell" ref={containerRef} data-3d-scene="true" aria-label="3D 几何场景"><div className="three-render-target" ref={renderTargetRef} />{webglAvailable && <div className="three-scene-controls" aria-label="3D显示控制"><button type="button" aria-pressed={transparentFaces} onClick={() => setTransparentFaces((visible) => !visible)}>透明面</button><button type="button" aria-pressed={showHiddenEdges} onClick={() => setShowHiddenEdges((visible) => !visible)}>隐藏边</button><button type="button" aria-pressed={showNormals} onClick={() => setShowNormals((visible) => !visible)}>法向量</button><button type="button" aria-pressed={unfolded} onClick={() => setUnfolded((visible) => !visible)}>{unfolded ? "折叠" : "展开"}</button><button type="button" aria-pressed={showAngle} onClick={() => setShowAngle((visible) => !visible)}>测量二面角</button></div>}{webglAvailable && <button className="three-reset-button" type="button" aria-label="重置3D视角" onClick={() => resetCameraRef.current()}>重置视角</button>}{showAngle && webglAvailable && <div className="three-angle-readout" role="status">二面角：{angle.toFixed(1)}°（示例法向量 X/Y）</div>}{!webglAvailable && <div className="three-scene-status" role="status">当前浏览器不支持 WebGL，无法显示 3D 场景。</div>}{webglAvailable && !hasGeometry && <div className="three-scene-status" role="status">添加点、线或面开始探索三维空间。</div>}</div>
}
