import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import type { ConePrimitive, CubePrimitive, Edge3Primitive, Face3Primitive, GeometryDocument, Line3Primitive, Plane3Primitive, Point3Primitive, Polyhedron3Primitive, PyramidPrimitive, CylinderPrimitive, Ray3Primitive, SectionPrimitive, Segment3Primitive, Vector3 } from "@draw/dsl"
import { dihedralAngleDegrees, unfoldPolyhedron3, type DihedralMarker3, type UnfoldLayout3 } from "@draw/geometry-kernel"
import { resolveMeasurementVisual } from "./measurementVisuals"
import type { SceneControlMode } from "./statusPrompts"
import { resolveDihedralMarker3, resolvePolyhedronTopology } from "@draw/scene-graph"

import { opacityFor, strokeFor } from "./primitiveStyle"
import type { ThreeScenePreview } from "./threeScenePreview"

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

/** How far the orbit centre may travel from the figure, as a multiple of the figure's radius. */
const PAN_RANGE_FACTOR = 3
/** Orbit-centre limit used before the scene has any geometry to anchor to. */
const EMPTY_BOUNDS_PAN_LIMIT = 12

/**
 * The camera's own axes for an orbit state: screen-right, screen-up and the view axis (camera -> target).
 * Panning along these instead of the world axes is what makes the figure track the pointer after the camera
 * has been turned, and `forward` is the axis that brings a figure which is off-centre in depth to the middle.
 */
function cameraBasis(state: CameraState): { right: THREE.Vector3; up: THREE.Vector3; forward: THREE.Vector3 } {
  const azimuth = state.azimuth * Math.PI / 180
  const elevation = state.elevation * Math.PI / 180
  // Matches applyCameraState: Z is the up axis, so elevation tilts the camera towards +Z.
  const forward = new THREE.Vector3(-Math.cos(elevation) * Math.cos(azimuth), -Math.cos(elevation) * Math.sin(azimuth), -Math.sin(elevation))
  const right = new THREE.Vector3(-Math.sin(azimuth), Math.cos(azimuth), 0)
  return { right, up: new THREE.Vector3().crossVectors(right, forward), forward }
}

/** Move the orbit centre by distances measured along the camera's own right, up and forward axes. */
export function panCameraState(state: CameraState, right: number, up: number, forward = 0): CameraState {
  const basis = cameraBasis(state)
  return {
    ...state,
    target: {
      x: state.target.x + basis.right.x * right + basis.up.x * up + basis.forward.x * forward,
      y: state.target.y + basis.right.y * right + basis.up.y * up + basis.forward.y * forward,
      z: state.target.z + basis.right.z * right + basis.up.z * up + basis.forward.z * forward
    }
  }
}

/** Keep the orbit centre near the figure, so a drag can never lose the geometry off screen. */
export function clampCameraTarget(target: CameraState["target"], bounds: THREE.Box3): CameraState["target"] {
  if (bounds.isEmpty()) {
    const clamp = (value: number) => Math.max(-EMPTY_BOUNDS_PAN_LIMIT, Math.min(EMPTY_BOUNDS_PAN_LIMIT, value))
    return { x: clamp(target.x), y: clamp(target.y), z: clamp(target.z) }
  }
  const centre = bounds.getCenter(new THREE.Vector3())
  const limit = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 0.5) * PAN_RANGE_FACTOR
  const clamp = (value: number, origin: number) => Math.max(origin - limit, Math.min(origin + limit, value))
  return { x: clamp(target.x, centre.x), y: clamp(target.y, centre.y), z: clamp(target.z, centre.z) }
}

export function zoomCameraState(state: CameraState, factor: number): CameraState {
  return { ...state, distance: Math.max(3, Math.min(60, state.distance * factor)) }
}

export function resetCameraState(): CameraState {
  return createCameraState()
}

/**
 * Frame a set of bounds: keep the viewing angles, move the target to the centre and pull back until the whole
 * figure fits the tighter screen axis. Without this a one-unit tetrahedron opens as a speck in a sixteen-unit
 * view, which is exactly how "the figure is there but you cannot see it" happens.
 */
export function fitCameraState(state: CameraState, bounds: THREE.Box3, camera: THREE.PerspectiveCamera): CameraState {
  if (bounds.isEmpty()) return { ...state, target: { x: 0, y: 0, z: 0 }, distance: createCameraState().distance }
  const centre = bounds.getCenter(new THREE.Vector3())
  const radius = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 0.35)
  const vertical = camera.fov * Math.PI / 360
  const horizontal = Math.atan(Math.tan(vertical) * Math.max(camera.aspect, 0.1))
  const distance = Math.max(radius / Math.sin(vertical), radius / Math.sin(horizontal)) * 1.25
  return { ...state, target: { x: centre.x, y: centre.y, z: centre.z }, distance: Math.max(3, Math.min(60, distance)) }
}

/** World-space bounds of everything drawn, ignoring the grid and axes so they never drive the framing. */
export function contentBounds(scene: THREE.Object3D): THREE.Box3 {
  scene.updateMatrixWorld(true)
  const bounds = new THREE.Box3()
  for (const child of scene.children) {
    if (child.userData.excludeFromFit) continue
    bounds.expandByObject(child)
  }
  return bounds
}

/** A round helper size (1/2/5 x 10^n) so the grid keeps readable cells at any scene scale. */
export function niceGridStep(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude
}

/** Exported for the tests: the orbit camera is the one place the world up axis is decided. */
export function applyCameraState(camera: THREE.PerspectiveCamera, state: CameraState): void {
  const azimuth = state.azimuth * Math.PI / 180
  const elevation = state.elevation * Math.PI / 180
  const horizontal = state.distance * Math.cos(elevation)
  // Z is up, which is what a maths or engineering audience expects: at zero azimuth the camera sits on +X and
  // tilting up raises it along +Z rather than +Y.
  camera.up.set(0, 0, 1)
  camera.position.set(
    state.target.x + horizontal * Math.cos(azimuth),
    state.target.y + horizontal * Math.sin(azimuth),
    state.target.z + state.distance * Math.sin(elevation)
  )
  camera.lookAt(state.target.x, state.target.y, state.target.z)
}

/**
 * Vertex handles are editor affordances, not geometry: they are sized in screen space so a fine mesh (a
 * 24-segment cylinder base has 48 vertices only 11px apart) does not turn into a string of beads, and so
 * handles neither grow without bound when you zoom in nor vanish when you zoom out. Measured against the
 * shipped build, the old world-space radius drew a 9px blob per vertex; 3px keeps vertices legible without
 * swallowing the figure. The grab area is deliberately larger than the drawing (PICK_TOLERANCE_PX), which is
 * the same visible-6 / hit-14 bargain the 2D canvas strikes.
 */
export const POINT_HANDLE_RADIUS_PX = 3
/** Grab radius for a click, in CSS pixels. Handles and thin edges are clickable beyond their drawn size. */
export const PICK_TOLERANCE_PX = 7
/** World radius used before the scene measures the camera; ThreeSceneView replaces it every frame. */
const DEFAULT_POINT_HANDLE_RADIUS = 0.05
/** three.js defaults Line.threshold to a whole world unit, which is far too grabby for geometry drawn at this scale. */
const DEFAULT_PICK_TOLERANCE = 0.05

/** World radius that projects to a constant pixel radius at `distance` from a camera. */
export function pointHandleWorldRadius(camera: THREE.PerspectiveCamera, distance: number, viewportHeight: number, radiusPx = POINT_HANDLE_RADIUS_PX): number {
  const worldPerPixel = 2 * Math.max(distance, 0) * Math.tan(camera.fov * Math.PI / 360) / Math.max(viewportHeight, 1)
  return radiusPx * worldPerPixel
}

export interface RaycastPickOptions {
  /** Click tolerance in world units at the picked depth; callers convert from PICK_TOLERANCE_PX. */
  tolerance?: number
}

export function pickPrimitiveAt(scene: THREE.Scene, camera: THREE.Camera, normalizedPoint: { x: number; y: number }, options: RaycastPickOptions = {}): string | null {
  return pickRaycastHit3(scene, camera, normalizedPoint, options)?.primitiveId ?? null
}

export interface RaycastHit3 {
  primitiveId: string
  partId?: string
  depth: number
  worldPoint: Vector3
  kind: "point" | "line" | "edge" | "face" | "plane" | "solid" | "marker"
}

function pickKind(primitiveType: unknown): RaycastHit3["kind"] {
  if (primitiveType === "point3") return "point"
  if (primitiveType === "edge3") return "edge"
  if (primitiveType === "face3") return "face"
  if (primitiveType === "plane3") return "plane"
  if (["cube", "pyramid", "cylinder", "cone", "polyhedron3"].includes(String(primitiveType))) return "solid"
  return "line"
}

/** Share of the click tolerance a kind may claim: small handles need the most, surfaces none. */
const pickKindAllowance: Record<RaycastHit3["kind"], number> = { point: 1, edge: 0.5, line: 0.5, face: 0, plane: 0, solid: 0, marker: 0 }

export function pickRaycastHit3(scene: THREE.Scene, camera: THREE.Camera, normalizedPoint: { x: number; y: number }, options: RaycastPickOptions = {}): RaycastHit3 | null {
  const tolerance = options.tolerance ?? DEFAULT_PICK_TOLERANCE
  const raycaster = new THREE.Raycaster()
  raycaster.params.Line.threshold = tolerance
  raycaster.setFromCamera(new THREE.Vector2(normalizedPoint.x * 2 - 1, -(normalizedPoint.y * 2 - 1)), camera)
  scene.updateMatrixWorld(true)
  const intersections = raycaster.intersectObjects(scene.children, true)
  const hits = intersections.flatMap((intersection) => {
    const primitiveId = intersection.object.userData.primitiveId
    if (typeof primitiveId !== "string") return []
    const kind = pickKind(intersection.object.userData.primitiveType)
    return [{ primitiveId, partId: typeof intersection.object.userData.partId === "string" ? intersection.object.userData.partId : undefined, depth: intersection.distance, worldPoint: { x: intersection.point.x, y: intersection.point.y, z: intersection.point.z }, kind, score: intersection.distance - pickKindAllowance[kind] * tolerance }]
  })
  // Rank by what is really under the cursor. A fixed kind priority let a handle on the far side of a solid win
  // over the surface the user clicked; the per-kind allowance keeps small handles grabbable without that.
  const hit = hits.sort((first, second) => first.score - second.score)[0]
  if (!hit) return null
  return { primitiveId: hit.primitiveId, partId: hit.partId, depth: hit.depth, worldPoint: hit.worldPoint, kind: hit.kind }
}

/**
 * A template solid (cube/pyramid/cylinder/cone) is never drawn as its own object: the scene shows the
 * point/edge/face children generated from it. Those generated edges and faces are display-only, so a raycast
 * hit on one of them belongs to the owning solid — otherwise the solid could not be clicked at all once its
 * post-creation selection is lost, which makes it look permanently frozen. Generated vertices are deliberately
 * left out: clicking a vertex selects the point, because moving points is how a template solid becomes
 * point-driven.
 */
export function templateTopologyOwners(document: GeometryDocument): Map<string, string> {
  const owners = new Map<string, string>()
  for (const primitive of document.primitives) {
    if (primitive.type !== "polyhedron3" || primitive.construction?.kind !== "template") continue
    const ownerId = primitive.construction.sourceIds[0]
    if (!ownerId) continue
    for (const childId of [...primitive.edgeIds, ...primitive.faceIds]) owners.set(childId, ownerId)
  }
  return owners
}

export function resolveSelectableHit(primitiveId: string | null, owners: Map<string, string>, keepSubElement = false): string | null {
  if (primitiveId === null) return null
  // Alt keeps the hit on the generated edge or face, so a template solid's parts stay reachable on demand.
  return keepSubElement ? primitiveId : owners.get(primitiveId) ?? primitiveId
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

export function nextUnfoldProgress(current: number, target: number): number {
  if (target === 0) return 0
  const next = current + (target - current) * 0.6
  return Math.abs(target - next) <= 0.001 ? target : next
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
  /** Reports which display switch is on so the shell can explain what it draws; null when both are off. */
  onStatusPromptChange?: (sceneControl: SceneControlMode | null) => void
  /**
   * 虚线预览内容（截面 / 截线）。传 null 表示当前选择没有可预览对象。
   * `interactive` 为真时指针落在预览上会高亮并上报，App 据此把点击解释为"创建图元"。
   */
  preview?: ThreeScenePreview | null
  onPreviewHover?: (hovering: boolean) => void
  /** 指针正落在虚线预览上时点击：交给 App 创建图元，而不是重新选择来源对象。 */
  onPreviewClick?: () => void
}

/** 虚线预览：低不透明度 + 虚线的交线/截面，明确区别于用户已创建的图元。 */
function createPreviewGroup(
  preview: ThreeScenePreview,
  interactive: boolean,
  onHoverChange: (hovering: boolean) => void
): THREE.Group {
  const group = new THREE.Group()
  group.userData.visualRole = "intersection-preview"
  const points: THREE.Vector3[] = []
  if (preview.kind === "intersection") {
    for (const segment of preview.segments) {
      points.push(new THREE.Vector3(segment.a.x, segment.a.y, segment.a.z), new THREE.Vector3(segment.b.x, segment.b.y, segment.b.z))
    }
  } else {
    const loop = preview.points.length >= 2 ? [...preview.points, preview.points[0]] : []
    for (const point of loop) points.push(new THREE.Vector3(point.x, point.y, point.z))
  }
  if (points.length >= 2) {
    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    const line = new THREE.LineSegments(geometry, new THREE.LineDashedMaterial({ color: "#f04f5f", dashSize: 0.35, gapSize: 0.25, transparent: true, opacity: 0.85 }))
    line.computeLineDistances()
    line.userData.visualRole = "intersection-preview-line"
    group.add(line)
    if (interactive) {
      // 命中带：用一根不可见但更粗的线承担拾取，避免用户必须点到 1px 宽的虚线上。
      const hit = new THREE.LineSegments(geometry.clone(), new THREE.LineBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }))
      hit.userData.visualRole = "intersection-preview-hit"
      group.add(hit)
    }
  }
  group.userData.onHoverChange = onHoverChange
  return group
}

export function ThreeSceneView({ document, selectedIds, onSelect, onStatusPromptChange, preview = null, onPreviewHover, onPreviewClick }: ThreeSceneViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const renderTargetRef = useRef<HTMLDivElement>(null)
  const measurementOverlayRef = useRef<HTMLDivElement>(null)
  const pointLabelOverlayRef = useRef<HTMLDivElement>(null)
  const cameraStateRef = useRef<CameraState>(createCameraState())
  const resetCameraRef = useRef<() => void>(() => undefined)
  const fitCameraRef = useRef<() => void>(() => undefined)
  const fittedDocumentRef = useRef<string | null>(null)
  const panModeRef = useRef(false)
  const [showHiddenEdges, setShowHiddenEdges] = useState(false)
  const [showNormals, setShowNormals] = useState(false)
  const [transparentFaces, setTransparentFaces] = useState(false)
  const [unfolded, setUnfolded] = useState(false)
  const [unfoldProgress, setUnfoldProgress] = useState(0)
  const [showAngle, setShowAngle] = useState(false)
  const [panMode, setPanMode] = useState(false)
  const [webglAvailable, setWebglAvailable] = useState(true)
  const statusPromptChangeRef = useRef(onStatusPromptChange)
  statusPromptChangeRef.current = onStatusPromptChange
  const previewHoverRef = useRef(onPreviewHover)
  previewHoverRef.current = onPreviewHover
  /**
   * Which display switch was toggled last. Both can be on at once, so the shell's hint follows the most recent
   * user action instead of a hard-coded priority; toggling the last one off clears the hint.
   */
  const lastControlRef = useRef<SceneControlMode | null>(null)

  const toggleNormals = () => {
    const next = !showNormals
    lastControlRef.current = next ? "normals" : lastControlRef.current === "normals" ? null : lastControlRef.current
    setShowNormals(next)
    statusPromptChangeRef.current?.(lastControlRef.current)
  }
  const toggleAngleDemo = () => {
    const next = !showAngle
    lastControlRef.current = next ? "dihedral-demo" : lastControlRef.current === "dihedral-demo" ? null : lastControlRef.current
    setShowAngle(next)
    statusPromptChangeRef.current?.(lastControlRef.current)
  }

  useEffect(() => () => statusPromptChangeRef.current?.(null), [])

  // A ref keeps the pointer handler current without rebuilding the whole scene on every mode toggle.
  useEffect(() => {
    panModeRef.current = panMode
  }, [panMode])

  useEffect(() => {
    const target = unfolded ? 1 : 0
    if (prefersReducedMotion()) {
      setUnfoldProgress(target)
      return
    }
    let frame = 0
    const animate = () => {
      setUnfoldProgress((current) => {
        const next = nextUnfoldProgress(current, target)
        if (next !== target) frame = requestAnimationFrame(animate)
        return next
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
    // The shell owns the viewport height, so measure it exactly: clamping here would desync the drawing
    // buffer from the CSS box and stretch the projection.
    const viewportSize = () => ({ width: Math.max(container.clientWidth, 1), height: Math.max(container.clientHeight, 1) })
    const { width, height } = viewportSize()
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

    const unfoldedPolyhedra = unfoldProgress > 0.001
      ? document.primitives.filter((primitive): primitive is Polyhedron3Primitive => primitive.type === "polyhedron3" && primitive.visible !== false)
      : []
    const unfoldedChildIds = new Set(unfoldedPolyhedra.flatMap((polyhedron) => [...polyhedron.edgeIds, ...polyhedron.faceIds]))
    const points = new Map(document.primitives.filter((primitive): primitive is Point3Primitive => primitive.type === "point3").map((primitive) => [primitive.id, primitive]))
    const pointHandles: THREE.Mesh[] = []
    document.primitives.filter((primitive) => primitive.visible !== false).forEach((primitive) => {
      if (unfoldedChildIds.has(primitive.id)) return
      const selected = selectedIds.includes(primitive.id)
      if (primitive.type === "point3") {
        const handle = createPoint3Mesh(primitive, selected)
        pointHandles.push(handle)
        scene.add(handle)
      }
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
    // 已持久化的截线：虚线，与"预览"用同一种视觉语言，但颜色更深、实心可选中。
    document.primitives.filter((primitive) => primitive.type === "intersectionLine" && primitive.visible !== false).forEach((primitive) => {
      if (primitive.type !== "intersectionLine") return
      const points = primitive.segments.flatMap((segment) => [new THREE.Vector3(segment.a.x, segment.a.y, segment.a.z), new THREE.Vector3(segment.b.x, segment.b.y, segment.b.z)])
      if (points.length < 2) return
      const line = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineDashedMaterial({ color: primitive.style?.stroke ?? "#dc2626", dashSize: 0.3, gapSize: 0.2 }))
      line.computeLineDistances()
      line.userData.primitiveId = primitive.id
      line.userData.primitiveType = primitive.type
      line.userData.visualRole = "intersection-line"
      scene.add(line)
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
    // 3D point labels: an HTML overlay above the canvas, so the classroom names A/B/C stay readable at any zoom.
    // The overlay never receives pointer events, so picking still goes through the renderer.
    const visiblePointLabels = document.primitives.filter((primitive): primitive is Point3Primitive => primitive.type === "point3" && primitive.visible !== false)
    let dihedralMarkerCount = 0
    let planeCount = 0
    document.measurements
      .filter((measurement) => measurement.metric === "dihedral" && measurement.status === "valid" && measurement.sourceIds.some((id) => selectedIds.includes(id)))
      .forEach((measurement) => {
        const marker = resolveDihedralMarker3(document, measurement.id)
        if (!marker) return
        scene.add(createDihedralMarkerGroup(marker, measurement.sourceIds.every((id) => selectedIds.includes(id))))
        dihedralMarkerCount += 1
      })
    const measurementVisuals = document.measurements
      .filter((measurement) => measurement.sourceIds.some((id) => selectedIds.includes(id)))
      .map((measurement) => resolveMeasurementVisual(document, measurement.id))
      .filter((visual): visual is NonNullable<ReturnType<typeof resolveMeasurementVisual>> => Boolean(visual))
    measurementVisuals.filter((visual) => visual.kind === "label").forEach((visual) => {
      visual.segments.forEach((segment) => {
        const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(segment.start.x, segment.start.y, segment.start.z), new THREE.Vector3(segment.end.x, segment.end.y, segment.end.z)])
        const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: "#604fda", transparent: true, opacity: 0.75 }))
        line.userData.measurementId = visual.id
        line.userData.visualRole = "measurement-helper"
        scene.add(line)
      })
    })
    // Planes are drawn last: their patch is sized from the figure they belong to, so the figure must exist first.
    const contentRadius = contentBounds(scene).getSize(new THREE.Vector3()).length() / 2
    const planeHalfSize = Math.max(Math.min(contentRadius * 1.6, 60), 1.2)
    document.primitives.filter((primitive): primitive is Plane3Primitive => primitive.type === "plane3" && primitive.visible !== false).forEach((primitive) => {
      const plane = createPlane3Mesh(primitive, points, selectedIds.includes(primitive.id), planeHalfSize)
      if (!plane) return
      scene.add(plane)
      planeCount += 1
    })
    // 预览层最后加入：盖在实体之上，但仍用虚线表达"还没创建"。
    const previewGroup = preview && (preview.segments.length > 0 || preview.points.length >= 2)
      ? createPreviewGroup(preview, Boolean(onPreviewHover), (hovering) => previewHoverRef.current?.(hovering))
      : null
    if (previewGroup) scene.add(previewGroup)
    if (sceneShell) {
      sceneShell.dataset.intersectionPreview = previewGroup ? preview!.kind : "none"
      sceneShell.dataset.unfoldFaces = String(unfoldFaceCount)
      sceneShell.dataset.unfoldProgress = unfoldProgress.toFixed(2)
      sceneShell.dataset.dihedralMarkers = String(dihedralMarkerCount)
      sceneShell.dataset.planeCount = String(planeCount)
      sceneShell.dataset.measurementLabelCount = String(measurementVisuals.length)
    }

    const sceneBounds = contentBounds(scene)
    if (sceneShell) {
      const size = sceneBounds.getSize(new THREE.Vector3())
      const centre = sceneBounds.getCenter(new THREE.Vector3())
      sceneShell.dataset.contentBounds = sceneBounds.isEmpty() ? "empty" : `${centre.x.toFixed(2)},${centre.y.toFixed(2)},${centre.z.toFixed(2)} size ${size.x.toFixed(2)},${size.y.toFixed(2)},${size.z.toFixed(2)}`
    }
    // Grid and axes follow the figure: at a one-unit scale a fixed five-unit axes helper slashes straight
    // through the solid and a fourteen-unit grid turns into visual noise.
    const hasContent = !sceneBounds.isEmpty()
    const helperSpan = hasContent ? Math.max(sceneBounds.getSize(new THREE.Vector3()).length(), 4) : 14
    const gridStep = niceGridStep(helperSpan / 14)
    const grid = new THREE.GridHelper(gridStep * 14, 14, scenePalette.grid, scenePalette.grid)
    // Three.js builds its grid in the XZ plane, which is the floor only when Y is up. With Z up, the floor is XY.
    grid.rotation.x = Math.PI / 2
    grid.userData.excludeFromFit = true
    scene.add(grid)
    // AxesHelper already draws X/Y/Z along the world axes, so blue points up once Z is the vertical axis.
    const axes = new THREE.AxesHelper(hasContent ? Math.max(planeHalfSize * 0.7, 1.2) : 5)
    axes.userData.excludeFromFit = true
    scene.add(axes)

    let viewportHeight = height
    const syncPointHandleScales = () => {
      for (const handle of pointHandles) handle.scale.setScalar(pointHandleWorldRadius(camera, camera.position.distanceTo(handle.position), viewportHeight))
    }
    const render = () => {
      syncPointHandleScales()
      const overlay = measurementOverlayRef.current
      if (overlay) {
        overlay.replaceChildren()
        const bounds = renderer.domElement.getBoundingClientRect()
        for (const visual of measurementVisuals) {
          const projected = new THREE.Vector3(visual.position.x, visual.position.y, visual.position.z).project(camera)
          const visible = projected.z >= -1 && projected.z <= 1
          if (!visible) continue
          const label = globalThis.document.createElement("div")
          label.className = "three-measurement-label"
          label.dataset.measurementId = visual.id
          label.setAttribute("role", "status")
          label.textContent = visual.label
          label.style.left = `${(projected.x * 0.5 + 0.5) * bounds.width}px`
          label.style.top = `${(-projected.y * 0.5 + 0.5) * bounds.height}px`
          overlay.appendChild(label)
        }
      }
      const labelOverlay = pointLabelOverlayRef.current
      if (labelOverlay) {
        labelOverlay.replaceChildren()
        const bounds = renderer.domElement.getBoundingClientRect()
        for (const primitive of visiblePointLabels) {
          const projected = new THREE.Vector3(primitive.position.x, primitive.position.y, primitive.position.z).project(camera)
          if (projected.z < -1 || projected.z > 1) continue
          const label = globalThis.document.createElement("span")
          label.className = "three-point-label"
          label.dataset.pointLabel = primitive.label ?? primitive.id
          label.dataset.pointId = primitive.id
          label.textContent = primitive.label ?? primitive.id
          // The marker radius is a constant pixel size, so the caption is offset in pixels too.
          label.style.left = `${(projected.x * 0.5 + 0.5) * bounds.width + 10}px`
          label.style.top = `${(-projected.y * 0.5 + 0.5) * bounds.height - 10}px`
          labelOverlay.appendChild(label)
        }
      }
      if (sceneShell) {
        sceneShell.dataset.cameraDistance = cameraStateRef.current.distance.toFixed(2)
        sceneShell.dataset.cameraTarget = `${cameraStateRef.current.target.x.toFixed(2)},${cameraStateRef.current.target.y.toFixed(2)},${cameraStateRef.current.target.z.toFixed(2)}`
      }
      renderer.render(scene, camera)
    }
    /** Click tolerance in world units, so a grab is always the same number of pixels wide. */
    const pickTolerance = () => pointHandleWorldRadius(camera, cameraStateRef.current.distance, viewportHeight, PICK_TOLERANCE_PX)
    const setCameraState = (nextState: CameraState) => {
      cameraStateRef.current = nextState
      applyCameraState(camera, nextState)
      render()
    }
    resetCameraRef.current = () => setCameraState(resetCameraState())
    const fitToContent = () => {
      cameraStateRef.current = fitCameraState(cameraStateRef.current, sceneBounds, camera)
      applyCameraState(camera, cameraStateRef.current)
      render()
    }
    fitCameraRef.current = fitToContent
    // Fit when a different document arrives (open file, switch workspace, restore draft), not on every edit:
    // re-framing while the user is working would fight their own camera moves.
    if (fittedDocumentRef.current !== document.metadata.id) {
      fittedDocumentRef.current = document.metadata.id
      fitToContent()
    }
    render()
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      const next = viewportSize()
      viewportHeight = next.height
      camera.aspect = next.width / next.height
      camera.updateProjectionMatrix()
      renderer.setSize(next.width, next.height, false)
      render()
    })
    resizeObserver?.observe(container)

    const topologyOwners = templateTopologyOwners(document)
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
      const state = cameraStateRef.current
      const scale = state.distance * 1.5
      // Ctrl drags along the view axis; middle drag, Shift+drag and the pan mode drag across the screen plane.
      const depthPan = event.ctrlKey || event.metaKey
      const screenPan = pointerState.button === 1 || pointerState.shiftKey || panModeRef.current
      const moved = depthPan
        ? panCameraState(state, 0, 0, deltaY * scale)
        : screenPan ? panCameraState(state, -deltaX * scale, deltaY * scale, 0) : rotateCameraState(state, deltaX * 140, deltaY * 140)
      pointerState.lastX = point.x
      pointerState.lastY = point.y
      setCameraState({ ...moved, target: clampCameraTarget(moved.target, sceneBounds) })
    }
    const handlePointerUp = (event: PointerEvent) => {
      if (!pointerState || pointerState.pointerId !== event.pointerId) return
      const point = pointFromEvent(event)
      if (!pointerState.moved && pointerState.button === 0) {
        /**
         * 点击优先级：**点 / 棱的拾取优先于"创建"**。
         * 否则虚线预览会抢走顶点手柄的点击（实测回归：点顶点手柄变成创建截线），
         * 而细粒度的空间元素本来就是用户更明确的目标；只有落到实体/面的点击才解释为创建。
         */
        const hit = pickRaycastHit3(scene, camera, point, { tolerance: pickTolerance() })
        const precise = hit?.kind === "point" || hit?.kind === "edge"
        if (previewHovering && onPreviewClick && !precise) onPreviewClick()
        else onSelect(resolveSelectableHit(hit?.primitiveId ?? null, topologyOwners, event.altKey), event.shiftKey)
      }
      renderer.domElement.releasePointerCapture(event.pointerId)
      pointerState = null
    }
    /**
     * 指针是否落在虚线预览上。用射线与预览命中线求交，阈值按屏幕像素给（与实体拾取同一套思路），
     * 这样"点击创建"只在真的指向预览时生效，不会抢走普通选择。
     */
    const updatePreviewHover = (event: PointerEvent) => {
      if (!previewGroup || !onPreviewHover) return
      const bounds = renderer.domElement.getBoundingClientRect()
      if (bounds.width <= 0 || bounds.height <= 0) return
      const pointer = new THREE.Vector2(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1)
      const raycaster = new THREE.Raycaster()
      raycaster.params.Line = { threshold: pickTolerance() }
      raycaster.setFromCamera(pointer, camera)
      const hits = raycaster.intersectObjects(previewGroup.children, false)
      const hovering = hits.length > 0
      if (hovering !== previewHovering) {
        previewHovering = hovering
        onPreviewHover(hovering)
      }
    }
    let previewHovering = false
    const handlePointerMoveForPreview = (event: PointerEvent) => updatePreviewHover(event)
    const handlePointerLeaveForPreview = () => {
      if (!previewHovering) return
      previewHovering = false
      onPreviewHover?.(false)
    }
    renderer.domElement.addEventListener("pointermove", handlePointerMoveForPreview)
    renderer.domElement.addEventListener("pointerleave", handlePointerLeaveForPreview)
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
      fitCameraRef.current = () => undefined
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown)
      renderer.domElement.removeEventListener("pointermove", handlePointerMove)
      renderer.domElement.removeEventListener("pointerup", handlePointerUp)
      renderer.domElement.removeEventListener("pointercancel", handlePointerUp)
      renderer.domElement.removeEventListener("pointermove", handlePointerMoveForPreview)
      renderer.domElement.removeEventListener("pointerleave", handlePointerLeaveForPreview)
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
  return <div className="three-canvas-shell" ref={containerRef} data-3d-scene="true" data-pan-mode={panMode ? "true" : "false"} aria-label="3D 几何场景"><div className="three-render-target" ref={renderTargetRef} /><div className="three-measurement-overlay" ref={measurementOverlayRef} aria-label="三维测量标注" /><div className="three-point-label-overlay" ref={pointLabelOverlayRef} aria-label="三维点标注" />{webglAvailable && <div className="three-scene-controls" aria-label="3D显示控制"><button type="button" aria-pressed={transparentFaces} onClick={() => setTransparentFaces((visible) => !visible)}>透明面</button><button type="button" aria-pressed={showHiddenEdges} onClick={() => setShowHiddenEdges((visible) => !visible)}>隐藏边</button><button type="button" aria-pressed={showNormals} onClick={toggleNormals}>法向量</button><button type="button" aria-pressed={unfolded} onClick={() => setUnfolded((visible) => !visible)}>{unfolded ? "折叠" : "展开"}</button><button type="button" aria-pressed={showAngle} onClick={toggleAngleDemo}>测量二面角</button></div>}{webglAvailable && <div className="three-camera-controls" aria-label="3D视角控制"><button type="button" aria-label="平移视角" aria-pressed={panMode} title="开启后左键拖动画布即平移视角，按 Ctrl 拖动沿视线前后移动" onClick={() => setPanMode((active) => !active)}>平移视角</button><button type="button" aria-label="适应视图" title="把视角调整到刚好框住当前图形，并把视角中心移回图形" onClick={() => fitCameraRef.current()}>适应视图</button><button type="button" aria-label="重置3D视角" title="回到默认视角" onClick={() => resetCameraRef.current()}>重置视角</button></div>}{webglAvailable && <p className="three-camera-hint" data-camera-hint="true">左键拖动旋转 · 中键或 Shift+左键拖动平移 · Ctrl+拖动沿视线前后移动 · 滚轮缩放</p>}{showAngle && webglAvailable && <div className="three-angle-readout" role="status">二面角：{angle.toFixed(1)}°（示例法向量 X/Y）</div>}{!webglAvailable && <div className="three-scene-status" role="status">当前浏览器不支持 WebGL，无法显示 3D 场景。</div>}{webglAvailable && !hasGeometry && <div className="three-scene-status" role="status">添加点、线或面开始探索三维空间。</div>}</div>
}
