import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import type { ConePrimitive, CubePrimitive, Edge3Primitive, Face3Primitive, GeometryDocument, Line3Primitive, Plane3Primitive, Point3Primitive, Polyhedron3Primitive, PrimitiveSpec, PyramidPrimitive, CylinderPrimitive, Ray3Primitive, SectionPrimitive, Segment3Primitive, Vector3 } from "@draw/dsl"
import { dihedralAngleDegrees, host3FromPrimitive, unfoldPolyhedron3, type DihedralMarker3, type Host3, type Host3Parameter, type UnfoldLayout3 } from "@draw/geometry-kernel"
import { resolveMeasurementVisual } from "./measurementVisuals"
import { syncOverlay } from "./overlaySync"
import type { SceneControlMode } from "./statusPrompts"
import { getDependencyIndex, isFreeDraggable3, planeThroughPoints, resolveDihedralMarker3, resolvePolyhedronTopology, sectionSourceVertices, templateTopologyIds } from "@draw/scene-graph"

import { opacityFor, strokeFor } from "./primitiveStyle"
import { loadViewPreference3d, saveViewPreference3d } from "./persistence/draftStorage"
import { GRID_CELLS, gridPlacement } from "./sceneGrid"
import { sceneContentKey, sceneSyncDecision } from "./sceneContentKey"
import { applyCameraState, boxCorners, clampCameraTarget, contentBounds, createCameraState, FIT_ANIMATION_MS, fitCameraState, interpolateCameraState, isContentOutOfView, panCameraState, resetCameraState, rotateCameraState, shouldAutoFit, zoomCameraState, type CameraState } from "./threeCamera"
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
  kind: "point" | "line" | "edge" | "face" | "plane" | "solid" | "marker" | "section"
}

function pickKind(primitiveType: unknown): RaycastHit3["kind"] {  if (primitiveType === "point3") return "point"
  if (primitiveType === "edge3") return "edge"
  if (primitiveType === "face3") return "face"
  if (primitiveType === "plane3") return "plane"
  if (primitiveType === "section") return "section"
  if (["cube", "pyramid", "cylinder", "cone", "polyhedron3"].includes(String(primitiveType))) return "solid"
  return "line"
}

/**
 * Share of the click tolerance a kind may claim: small handles need the most, surfaces none.
 * Sections stay at 0 here: their boundary lies *inside* the solid, so a blanket allowance would let a cut
 * steal clicks meant for the solid's own vertices and edges (measured regression: clicking a cube vertex
 * selected the section instead). They are picked deliberately instead — see `pickSectionAt`.
 */
const pickKindAllowance: Record<RaycastHit3["kind"], number> = { point: 1, edge: 0.5, line: 0.5, face: 0, plane: 0, solid: 0, marker: 0, section: 0 }

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

/**
 * A section is drawn as a boundary that lies *inside* the solid it cuts, so along the same ray the solid's own
 * surface is always nearer and ordinary distance ranking can never reach the cut. Pick it deliberately: the
 * pointer has to be on the drawn boundary (within a pixel-based tolerance), and clicking a vertex/edge handle
 * still wins so fine-grained editing is not hijacked by a cut passing nearby.
 */
export function pickSectionAt(scene: THREE.Scene, camera: THREE.Camera, normalizedPoint: { x: number; y: number }, tolerance: number, preciseHit: boolean): string | null {
  if (preciseHit) return null
  const raycaster = new THREE.Raycaster()
  raycaster.params.Line = { threshold: tolerance }
  raycaster.setFromCamera(new THREE.Vector2(normalizedPoint.x * 2 - 1, -(normalizedPoint.y * 2 - 1)), camera)
  scene.updateMatrixWorld(true)
  const hits = raycaster
    .intersectObjects(scene.children, true)
    .filter((entry) => entry.object.userData.primitiveType === "section" && typeof entry.object.userData.primitiveId === "string")
  return hits.length > 0 ? (hits[0].object.userData.primitiveId as string) : null
}

export function resolveSelectableHit(primitiveId: string | null, owners: Map<string, string>, keepSubElement = false): string | null {
  if (primitiveId === null) return null
  // Alt keeps the hit on the generated edge or face, so a template solid's parts stay reachable on demand.
  return keepSubElement ? primitiveId : owners.get(primitiveId) ?? primitiveId
}

/**
 * 自由拖动：被拖对象在屏幕平面上的落点。
 * 与相机自身基向量求交，所以相机转过之后图形仍然跟着指针走；深度保持不变，拖动不会把人拽进纵深。
 */
export function dragWorldPoint(camera: THREE.Camera, anchor: THREE.Vector3, normalizedPoint: { x: number; y: number }): THREE.Vector3 | null {
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(new THREE.Vector2(normalizedPoint.x * 2 - 1, -(normalizedPoint.y * 2 - 1)), camera)
  const normal = new THREE.Vector3()
  camera.getWorldDirection(normal)
  // A plane seen edge-on cannot be intersected: the drag would slide to infinity, so keep the figure put.
  return Math.abs(normal.dot(raycaster.ray.direction)) < 1e-6 ? null : raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, anchor), new THREE.Vector3())
}

/** 剖切面的单位法向；法向退化（零向量 / 非有限）时返回 null，调用方据此放弃这次拖动。 */
export function sectionUnitNormal(normal: Vector3): THREE.Vector3 | null {
  const unit = new THREE.Vector3(normal.x, normal.y, normal.z)
  return Number.isFinite(unit.x) && Number.isFinite(unit.y) && Number.isFinite(unit.z) && unit.lengthSq() > 1e-12 ? unit.normalize() : null
}

/**
 * 自由拖动一个对象时真正要跟着动的全部对象：它自己、它按 id 引用的点（线段/棱/面/平面/多面体），
 * 以及模板实体所生成的点/棱/面。少了这一步，拖点驱动的棱就"只动属性不动画面"。
 */
export function dragFamilyIds(document: GeometryDocument, id: string): Set<string> {
  const { dependents, parents } = dragGraph(document)
  const family = new Set<string>([id])
  const queue = [id]
  while (queue.length > 0) {
    for (const childId of dependents.get(queue.shift()!) ?? []) {
      if (family.has(childId)) continue
      family.add(childId)
      queue.push(childId)
    }
  }
  // 生成的拓扑是"由父级算出来"的：拖动父级要连它的点/棱/面一起动，否则实体看着没动。
  for (const member of [...family]) for (const parentId of parents.get(member) ?? []) family.add(parentId)
  return family
}

/** 依赖索引的正反两向：正向着找"谁跟着它动"，反向着找"它是由谁生成的"。 */
function dragGraph(document: GeometryDocument): { dependents: Map<string, Set<string>>; parents: Map<string, Set<string>> } {
  const dependents = new Map<string, Set<string>>()
  const parents = new Map<string, Set<string>>()
  for (const [parentId, childIds] of getDependencyIndex(document)) {
    for (const childId of childIds) {
      const entries = dependents.get(parentId) ?? new Set<string>()
      entries.add(childId)
      dependents.set(parentId, entries)
      const owners = parents.get(childId) ?? new Set<string>()
      owners.add(parentId)
      parents.set(childId, owners)
    }
  }
  return { dependents, parents }
}

/**
 * 把一个位移画到某个对象自己的可视元素上（不重建场景）。
 * 拖动剖切面时用它：截面本体与剖切面片都属于同一个图元，一起挪才有"刀口在动"的观感。
 */
export function offsetSceneObjects(scene: THREE.Scene, primitiveId: string, delta: THREE.Vector3): void {
  scene.traverse((object) => {
    if (object.userData.primitiveId !== primitiveId) return
    object.position.add(delta)
  })
}

/**
 * 把一个拖动位移画到场景里，而不重建场景。拖动期间文档只在节流点提交，逐帧重建会明显卡顿；
 * 这里先把 offset 记在对象上，渲染前统一应用，抬手后再由文档接替。
 * `delta` 传零即撤销这些临时偏移，用于把画面交还给文档。
 */
export function applyDragOffsets(scene: THREE.Scene, family: Set<string>, delta: THREE.Vector3): void {
  scene.traverse((object) => {
    const objectId = object.userData.primitiveId
    if (typeof objectId !== "string" || !family.has(objectId)) return
    const applied = (object.userData.dragOffset as THREE.Vector3 | undefined) ?? new THREE.Vector3()
    object.position.add(delta)
    applied.add(delta)
    object.userData.dragOffset = applied
  })
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

function visibleSolids(document: GeometryDocument): SolidPrimitive[] {
  const templateSources = new Set(document.primitives.flatMap((primitive) => primitive.type === "polyhedron3" && primitive.construction?.kind === "template" ? primitive.construction.sourceIds : []))
  return document.primitives.filter((primitive): primitive is SolidPrimitive => ["cube", "pyramid", "cylinder", "cone"].includes(primitive.type) && primitive.visible !== false && !templateSources.has(primitive.id))
}

/** 释放一个对象子树的几何与材质。内容对象每次同步都会重建，必须逐个释放，否则显存会一路涨。 */
/**
 * 由点驱动的对象：点手柄、以及引用点的直线 / 线段 / 射线 / 棱 / 面。
 * 抽成函数是为了拖动绑定点时能**只重建受影响的对象**（下游实时跟随），而不是整场重建。
 */
function buildPointDrivenObject(primitive: PrimitiveSpec, points: Map<string, Point3Primitive>, selected: boolean): THREE.Object3D | null {
  if (primitive.type === "point3") return createPoint3Mesh(primitive, selected)
  if (primitive.type === "line3" || primitive.type === "segment3" || primitive.type === "ray3") return createPointDrivenLine(primitive, points, selected)
  if (primitive.type === "edge3") return createEdge3Line(primitive, points, selected)
  if (primitive.type === "face3") return createFace3Mesh(primitive, points, selected)
  return null
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Line) && !(object instanceof THREE.LineSegments)) return
    object.geometry.dispose()
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    materials.forEach((material) => material.dispose())
  })
}

function disposeScene(scene: THREE.Scene): void {
  for (const child of [...scene.children]) disposeObject(child)
}

/** Pointer bookkeeping for one press; lives at component scope so a scene rebuild cannot end a drag. */
interface PointerState {
  pointerId: number
  x: number
  y: number
  lastX: number
  lastY: number
  button: number
  moved: boolean
  shiftKey: boolean
}

/**
 * 一次自由拖动。拖动期间文档完全不提交，只把位移按帧画到场景里的对象上；抬手时才提交唯一一次操作。
 * 这正是"一次拖动 = 一步撤销"的保证：中途每提交一次，撤销栈里就多一步，用户要按好几次 Ctrl+Z 才能回到原状
 * （实测：一次 90px 的拖动会留下 4 步）。`total` 是这次拖动的总位移，`applied` 表示画面已经动过。
 */
interface DragSessionState {
  targetId: string
  family: Set<string>
  anchor: THREE.Vector3
  origin: THREE.Vector3
  /** 这次拖动的世界位移（截面时已投影到法向）。 */
  total: THREE.Vector3
  /** 已经画进场景的那一段，用来算增量，避免重复叠加。 */
  visualApplied: THREE.Vector3
  applied: boolean
  /** 拖动截面时：把屏幕位移投影到该法向上，得到剖切面要走的世界距离。 */
  slideNormal?: THREE.Vector3
  /**
   * 拖动**绑定点**时：宿主约束（evaluate / closestParameter / residual）、它的下游对象 id，
   * 以及这次拖动最新的宿主参数。参数是唯一真值——每帧只更新参数与受影响对象，抬手才提交文档。
   */
  hostConstraint?: Host3
  hostDependents?: string[]
  hostParameter?: Host3Parameter
}

export interface ThreeSceneViewProps {  document: GeometryDocument
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
  /** 拖动结束时上报这次拖动的总位移（屏幕平面内的世界向量）。只在抬手时回调一次：拖动期间文档不提交，
   * 这样一次拖动就是一步撤销。拖动过程中的画面由场景自己按帧平移，不经过文档。 */
  onDragEnd?: (id: string, delta: Vector3) => void
  /** 选中截面时，把拖动/键盘微调解释为"沿法向平移剖切面"的世界距离。 */
  onMoveSection?: (id: string, distance: number) => void
  /** 拖动绑定点结束：提交宿主参数（点 / 面 / 曲面的自然参数）。 */
  onHostDragEnd?: (pointId: string, parameter: Host3Parameter) => void
  /** 开启"以面为剖切面"后，点到的那个面就成为截面 `<id>` 的剖切面。 */
  onPickSectionFace?: (id: string, plane: { normal: Vector3; constant: number }) => void
}

/** 虚线预览：低不透明度 + 虚线的交线/截面，明确区别于用户已创建的图元。 */
function createPreviewGroup(
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

export function ThreeSceneView({ document, selectedIds, onSelect, onStatusPromptChange, preview = null, onPreviewHover, onPreviewClick, onDragEnd, onMoveSection, onHostDragEnd, onPickSectionFace }: ThreeSceneViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const renderTargetRef = useRef<HTMLDivElement>(null)
  const measurementOverlayRef = useRef<HTMLDivElement>(null)
  const pointLabelOverlayRef = useRef<HTMLDivElement>(null)
  const cameraStateRef = useRef<CameraState>(createCameraState())
  const resetCameraRef = useRef<() => void>(() => undefined)
  const fitCameraRef = useRef<() => void>(() => undefined)
  const fittedDocumentRef = useRef<string | null>(null)
  const panModeRef = useRef(false)
  const dragModeRef = useRef(false)
  const pointerStateRef = useRef<PointerState | null>(null)
  const dragSessionRef = useRef<DragSessionState | null>(null)
  /** The selection the rebuilt scene must highlight; the pointer handlers read it without re-subscribing. */
  const selectedIdsRef = useRef<string[]>(selectedIds)
  selectedIdsRef.current = selectedIds
  /** The drag callback, read through a ref so a parent re-render never restarts the scene. */
  const dragEndRef = useRef(onDragEnd)
  dragEndRef.current = onDragEnd
  /** 当前预览的种类与场景组：截面预览要抢在实体拾取之前，交线预览不抢（见 handlePointerUp 的说明）。 */
  const previewKindRef = useRef<ThreeScenePreview["kind"] | null>(preview?.kind ?? null)
  previewKindRef.current = preview?.kind ?? null
  /** 预览组的深度（离相机多远）：用来判断"点手柄"和"点剖切面"哪个才是用户真正指到的东西。 */
  const previewDepthRef = useRef<number | null>(null)
  /** 移动剖切面（沿法向的世界位移），与拖动回调解耦，方便键盘微调共用。 */
  const moveSectionRef = useRef(onMoveSection)
  moveSectionRef.current = onMoveSection
  /** 拖动绑定点结束：提交宿主参数（点/面/曲面的自然参数）。 */
  const hostDragEndRef = useRef(onHostDragEnd)
  hostDragEndRef.current = onHostDragEnd
  /** 以面为剖切面的回调，以及"正在等待拾取"的开关。 */
  const pickSectionFaceRef = useRef(onPickSectionFace)
  pickSectionFaceRef.current = onPickSectionFace
  /** 键盘微调用：当前的文档与选择，避免把 keydown 监听器绑在频繁变化的值上。 */
  const documentRef = useRef(document)
  documentRef.current = document
  /**
   * 把进行中的拖动偏移补画到当前场景上。拖动途中场景会被重建（选中变化、窗口尺寸变化都会重建），
   * 新场景的对象回到文档里的位置，已经"画上去"的偏移就丢了 —— 观感是一次回弹/闪跳。
   * 由场景构建流程在 render 之后调用；也用于拖动自身的逐帧重画。
   */
  const resumeDragVisualRef = useRef<() => void>(() => undefined)
  const [showHiddenEdges, setShowHiddenEdges] = useState(false)
  const [showNormals, setShowNormals] = useState(false)
  const [transparentFaces, setTransparentFaces] = useState(false)
  const [unfolded, setUnfolded] = useState(false)
  const [unfoldProgress, setUnfoldProgress] = useState(0)
  const [showAngle, setShowAngle] = useState(false)
  const [panMode, setPanMode] = useState(false)
  const [dragMode, setDragMode] = useState(false)
  /** 「以面为剖切面」的一次性拾取模式：开启后下一次点击面即取该面为剖切面。 */
  const [facePickMode, setFacePickMode] = useState(false)
  const facePickModeRef = useRef(false)
  facePickModeRef.current = facePickMode
  const [webglAvailable, setWebglAvailable] = useState(true)
  const statusPromptChangeRef = useRef(onStatusPromptChange)
  statusPromptChangeRef.current = onStatusPromptChange
  const previewHoverRef = useRef(onPreviewHover)
  previewHoverRef.current = onPreviewHover
  /**
   * 场景内容的输入：文档 / 选择 / 显示开关 / 预览 / 选中回调。
   * 挂载效应只读这些 ref，因此父组件重渲染不会再重建渲染器（见下面的挂载效应说明）。
   */
  const previewRef = useRef(preview)
  previewRef.current = preview
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  /**
   * 预览点击回调也必须走 ref：App 里的实现闭包着它自己那份 `document`，
   * 直接调用首次渲染的函数会拿到空文档，点击虚线预览将什么都不创建（实测回归）。
   */
  const previewClickRef = useRef(onPreviewClick)
  previewClickRef.current = onPreviewClick
  const displayFlagsRef = useRef({ showHiddenEdges, showNormals, transparentFaces, unfoldProgress })
  displayFlagsRef.current = { showHiddenEdges, showNormals, transparentFaces, unfoldProgress }
  /** 场景运行时：挂载时创建一次，之后所有内容同步都走它。 */
  const runtimeRef = useRef<{ syncContent: () => void } | null>(null)
  /** 内容同步签名：同一个签名不重复同步（见 sceneContentKey）。 */
  const contentKeyRef = useRef<string | null>(null)
  /** 回归读数：本次挂载创建渲染器的次数（恒为 1）与内容同步次数。 */
  const sceneBuildsRef = useRef(0)
  const sceneSyncsRef = useRef(0)
  /** 自动取景：开关、用户是否动过相机（动过就不再抢视角）、已自动取景的次数、上一次的内容 AABB。 */
  const [autoFit, setAutoFit] = useState(() => loadViewPreference3d().autoFit)
  const autoFitRef = useRef(autoFit)
  autoFitRef.current = autoFit
  const cameraFitRef = useRef(0)
  /** 重新打开「自动取景」时立刻拟合一次。 */
  const fitWithoutTouchRef = useRef<() => void>(() => undefined)
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
    dragModeRef.current = dragMode
  }, [dragMode])

  /** 两个模式互斥：同时开着的话，左键拖动到底算平移视角还是拖图形就说不清了。 */
  const enterMode = (mode: "pan" | "drag") => {
    const nextPan = mode === "pan" ? !panMode : false
    const nextDrag = mode === "drag" ? !dragMode : false
    setPanMode(nextPan)
    setDragMode(nextDrag)
    lastControlRef.current = nextDrag ? "free-drag" : lastControlRef.current === "free-drag" ? null : lastControlRef.current
    statusPromptChangeRef.current?.(lastControlRef.current)
  }

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
    const sceneShell = containerRef.current
    sceneBuildsRef.current += 1
    if (sceneShell) {
      sceneShell.dataset.sceneBuilds = String(sceneBuildsRef.current)
      sceneShell.dataset.sceneSyncs = String(sceneSyncsRef.current)
    }

    scene.add(new THREE.AmbientLight("#ffffff", 1.7))
    const keyLight = new THREE.DirectionalLight("#ffffff", 2.4)
    keyLight.position.set(6, 10, 8)
    scene.add(keyLight)

    /**
     * 场景内容：每次同步先释放再重建，但**渲染器与 canvas 不再重建**。
     *
     * 这段代码过去直接写在效应体内，而效应依赖含 `document` 与每次渲染都换身份的 `onSelect`，
     * 于是任何一次父组件重渲染（悬停、提示、错误、展开动画的每一帧）都会
     * `renderer.dispose()` + `new THREE.WebGLRenderer()` 并换掉 canvas —— 既是性能灾难
     * （浏览器 WebGL 上下文数量有限），也让相机动画与拖动预览随时被打断。
     *
     * 说明：下面整段保持原有缩进以便与历史实现逐行对照，逻辑上它在 `syncContent()` 内部。
     */
    let contentObjects: THREE.Object3D[] = []
    const addContent = (object: THREE.Object3D) => {
      contentObjects.push(object)
      scene.add(object)
    }
    const clearContent = () => {
      for (const object of contentObjects) {
        scene.remove(object)
        disposeObject(object)
      }
      contentObjects = []
    }
    /** 同步时刷新的闭包变量：render() 与指针处理函数都读它们。 */
    let pointHandles: THREE.Mesh[] = []
    let visiblePointLabels: Point3Primitive[] = []
    let measurementVisuals: NonNullable<ReturnType<typeof resolveMeasurementVisual>>[] = []
    let previewGroup: THREE.Object3D | null = null
    let sceneBounds = new THREE.Box3()
    /** 空间点索引与"模板子元素归属模板实体"的映射：指针处理函数要用，必须随同步一起刷新。 */
    let points = new Map<string, Point3Primitive>()
    let topologyOwners = new Map<string, string>()
    /** 背景坐标系：单位尺寸的栅格与坐标轴，真实大小与位置每帧按可见范围设置。 */
    let gridHelper: THREE.GridHelper | null = null
    let axesHelper: THREE.AxesHelper | null = null
    /** 点驱动对象的索引：拖动绑定点时按 id 就地重建受影响的那些。 */
    let objectIndex = new Map<string, THREE.Object3D>()

    const currentContentKey = () => sceneContentKey({
      document: documentRef.current,
      selectedIds: selectedIdsRef.current,
      ...displayFlagsRef.current,
      previewKind: previewRef.current?.kind ?? null
    })

    const syncContent = () => {
    sceneSyncsRef.current += 1
    clearContent()
    pointHandles = []
    visiblePointLabels = []
    measurementVisuals = []
    previewGroup = null
    objectIndex = new Map<string, THREE.Object3D>()
    if (sceneShell) sceneShell.dataset.sceneSyncs = String(sceneSyncsRef.current)
    const document = documentRef.current
    const selectedIds = selectedIdsRef.current
    const { showHiddenEdges, showNormals, transparentFaces, unfoldProgress } = displayFlagsRef.current
    const preview = previewRef.current
    points = new Map(document.primitives.filter((primitive): primitive is Point3Primitive => primitive.type === "point3").map((primitive) => [primitive.id, primitive]))
    topologyOwners = templateTopologyOwners(document)

    const unfoldedPolyhedra = unfoldProgress > 0.001
      ? document.primitives.filter((primitive): primitive is Polyhedron3Primitive => primitive.type === "polyhedron3" && primitive.visible !== false)
      : []
    const unfoldedChildIds = new Set(unfoldedPolyhedra.flatMap((polyhedron) => [...polyhedron.edgeIds, ...polyhedron.faceIds]))
    document.primitives.filter((primitive) => primitive.visible !== false).forEach((primitive) => {
      if (unfoldedChildIds.has(primitive.id)) return
      const object = buildPointDrivenObject(primitive, points, selectedIds.includes(primitive.id))
      if (!object) return
      if (primitive.type === "point3") pointHandles.push(object as THREE.Mesh)
      objectIndex.set(primitive.id, object)
      addContent(object)
    })

    visibleSolids(document).forEach((primitive) => {
      const selected = selectedIds.includes(primitive.id)
      addContent(createSolidGroup(primitive, selected, { showHiddenEdges, showNormals, transparentFaces, unfoldProgress }))
    })
    document.primitives.filter((primitive): primitive is SectionPrimitive => primitive.type === "section" && primitive.visible !== false).forEach((primitive) => {
      const mesh = createSectionMesh(primitive)
      if (mesh) addContent(mesh)
      // 选中截面时把剖切面本身也画出来：只看到一圈交线的话，"刀口在哪、往哪边挪"都无从判断。
      if (!selectedIds.includes(primitive.id)) return
      const patch = createPlanePatch(primitive.plane, sectionSourceVertices(document, primitive.sourceId), { color: "#f97316", opacity: 0.1 })
      if (!patch) return
      // 剖切面片只是"刀口在哪"的指示物，不能参与拾取：它又大又正对相机，否则点击/拖动都会命中它
      // 而不是截面本身（实测：拖它会平移面片，截面却没动）。
      patch.traverse((child) => { child.raycast = () => undefined })
      patch.userData.visualRole = "section-plane"
      addContent(patch)
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
      addContent(line)
    })
    let unfoldFaceCount = 0
    unfoldedPolyhedra.forEach((polyhedron) => {
      const topology = resolvePolyhedronTopology(document, polyhedron.id)
      if (!topology) return
      const layout = unfoldPolyhedron3(topology.vertices, topology.faces, unfoldProgress, topology.rootFaceId)
      if (layout.status !== "ok") return
      addContent(createUnfoldNetGroup(polyhedron.id, layout, selectedIds.includes(polyhedron.id)))
      unfoldFaceCount += layout.faces.length
    })
    // 3D point labels: an HTML overlay above the canvas, so the classroom names A/B/C stay readable at any zoom.
    // The overlay never receives pointer events, so picking still goes through the renderer.
    visiblePointLabels = document.primitives.filter((primitive): primitive is Point3Primitive => primitive.type === "point3" && primitive.visible !== false)
    let dihedralMarkerCount = 0
    let planeCount = 0
    document.measurements
      .filter((measurement) => measurement.metric === "dihedral" && measurement.status === "valid" && measurement.sourceIds.some((id) => selectedIds.includes(id)))
      .forEach((measurement) => {
        const marker = resolveDihedralMarker3(document, measurement.id)
        if (!marker) return
        addContent(createDihedralMarkerGroup(marker, measurement.sourceIds.every((id) => selectedIds.includes(id))))
        dihedralMarkerCount += 1
      })
    measurementVisuals = document.measurements
      .filter((measurement) => measurement.sourceIds.some((id) => selectedIds.includes(id)))
      .map((measurement) => resolveMeasurementVisual(document, measurement.id))
      .filter((visual): visual is NonNullable<ReturnType<typeof resolveMeasurementVisual>> => Boolean(visual))
    measurementVisuals.filter((visual) => visual.kind === "label").forEach((visual) => {
      visual.segments.forEach((segment) => {
        const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(segment.start.x, segment.start.y, segment.start.z), new THREE.Vector3(segment.end.x, segment.end.y, segment.end.z)])
        const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: "#604fda", transparent: true, opacity: 0.75 }))
        line.userData.measurementId = visual.id
        line.userData.visualRole = "measurement-helper"
        addContent(line)
      })
    })
    // Planes are drawn last: their patch is sized from the figure they belong to, so the figure must exist first.
    const contentRadius = contentBounds(scene).getSize(new THREE.Vector3()).length() / 2
    const planeHalfSize = Math.max(Math.min(contentRadius * 1.6, 60), 1.2)
    document.primitives.filter((primitive): primitive is Plane3Primitive => primitive.type === "plane3" && primitive.visible !== false).forEach((primitive) => {
      const plane = createPlane3Mesh(primitive, points, selectedIds.includes(primitive.id), planeHalfSize)
      if (!plane) return
      addContent(plane)
      planeCount += 1
    })
    // 预览层最后加入：盖在实体之上，但仍用虚线表达"还没创建"。
    previewGroup = preview && (preview.segments.length > 0 || preview.points.length >= 2)
      ? createPreviewGroup(preview, Boolean(previewHoverRef.current), (hovering) => previewHoverRef.current?.(hovering))
      : null
    if (previewGroup) addContent(previewGroup)
    if (sceneShell) {
      sceneShell.dataset.intersectionPreview = previewGroup ? preview!.kind : "none"
      sceneShell.dataset.unfoldFaces = String(unfoldFaceCount)
      sceneShell.dataset.unfoldProgress = unfoldProgress.toFixed(2)
      sceneShell.dataset.dihedralMarkers = String(dihedralMarkerCount)
      sceneShell.dataset.planeCount = String(planeCount)
      sceneShell.dataset.measurementLabelCount = String(measurementVisuals.length)
      // 剖切面的读数：剖面有没有真的动、动到哪，靠这几个数看，不靠肉眼。
      const sections = document.primitives.filter((primitive): primitive is SectionPrimitive => primitive.type === "section")
      const firstSection = sections[0]
      sceneShell.dataset.sectionCount = String(sections.length)
      sceneShell.dataset.sectionPlaneConstant = firstSection ? firstSection.plane.constant.toFixed(3) : ""
      sceneShell.dataset.sectionPlaneNormal = firstSection ? `${firstSection.plane.normal.x.toFixed(3)},${firstSection.plane.normal.y.toFixed(3)},${firstSection.plane.normal.z.toFixed(3)}` : ""
      sceneShell.dataset.sectionPointCount = firstSection ? String(firstSection.points.length) : ""
    }

    sceneBounds = contentBounds(scene)
    if (sceneShell) {
      const size = sceneBounds.getSize(new THREE.Vector3())
      const centre = sceneBounds.getCenter(new THREE.Vector3())
      sceneShell.dataset.contentBounds = sceneBounds.isEmpty() ? "empty" : `${centre.x.toFixed(2)},${centre.y.toFixed(2)},${centre.z.toFixed(2)} size ${size.x.toFixed(2)},${size.y.toFixed(2)},${size.z.toFixed(2)}`
    }
    // Grid and axes follow the figure: at a one-unit scale a fixed five-unit axes helper slashes straight
    // through the solid and a fourteen-unit grid turns into visual noise.
    /** 背景坐标系：几何是单位尺寸，尺寸与位置每帧按"可见范围 + 内容到达范围"设置。 */
    const grid = new THREE.GridHelper(GRID_CELLS, GRID_CELLS, scenePalette.grid, scenePalette.grid)
    // Three.js builds its grid in the XZ plane, which is the floor only when Y is up. With Z up, the floor is XY.
    grid.rotation.x = Math.PI / 2
    grid.userData.excludeFromFit = true
    gridHelper = grid
    addContent(grid)
    // AxesHelper already draws X/Y/Z along the world axes, so blue points up once Z is the vertical axis.
    const axes = new THREE.AxesHelper(1)
    axes.userData.excludeFromFit = true
    axesHelper = axes
    addContent(axes)
    }
    syncContent()

    /**
     * 只重建**一个**点驱动对象：拖动绑定点时用它让下游实时跟随。
     * 位置已经在 `points` 里按新参数写好，所以这里不需要重建整场、也不进撤销历史。
     */
    const refreshPrimitiveObject = (id: string) => {
      const primitive = documentRef.current.primitives.find((candidate) => candidate.id === id)
      if (!primitive) return
      const previous = objectIndex.get(id)
      const replacement = buildPointDrivenObject(primitive, points, selectedIdsRef.current.includes(id))
      if (previous) {
        scene.remove(previous)
        disposeObject(previous)
        const index = contentObjects.indexOf(previous)
        if (index >= 0) contentObjects.splice(index, 1)
        if (previous instanceof THREE.Mesh) pointHandles = pointHandles.filter((handle) => handle !== previous)
      }
      if (!replacement) return
      addContent(replacement)
      objectIndex.set(id, replacement)
      if (replacement instanceof THREE.Mesh && primitive.type === "point3") pointHandles.push(replacement)
    }

    let viewportHeight = height
    const syncPointHandleScales = () => {
      for (const handle of pointHandles) handle.scale.setScalar(pointHandleWorldRadius(camera, camera.position.distanceTo(handle.position), viewportHeight))
    }
    /**
     * 栅格与坐标轴按当前相机与内容自动铺满可见范围。
     * 旧实现是"固定 14 格、以原点为中心、只按内容对角线取整"，于是内容离原点一远
     * （用户报告：点的坐标到 20 左右）就落在坐标面之外的空白里。
     */
    const applyGridPlacement = () => {
      if (!gridHelper && !axesHelper) return
      const state = cameraStateRef.current
      const span = sceneBounds.isEmpty() ? 0 : sceneBounds.getSize(new THREE.Vector3()).length()
      const reach = sceneBounds.isEmpty() ? 0 : Math.max(...boxCorners(sceneBounds).map((corner) => Math.hypot(corner.x, corner.y)))
      const placement = gridPlacement({
        distance: state.distance,
        fovDegrees: camera.fov,
        aspect: camera.aspect,
        target: state.target,
        contentSpan: span,
        contentReach: reach
      })
      if (gridHelper) {
        gridHelper.scale.setScalar(placement.cell)
        gridHelper.position.set(placement.centre.x, placement.centre.y, 0)
      }
      if (axesHelper) axesHelper.scale.setScalar(placement.axesLength)
      if (sceneShell) {
        sceneShell.dataset.gridCell = String(placement.cell)
        sceneShell.dataset.gridCentre = `${placement.centre.x},${placement.centre.y}`
        sceneShell.dataset.gridExtent = String(placement.extent)
        sceneShell.dataset.axesLength = String(placement.axesLength)
      }
    }
    const render = () => {
      syncPointHandleScales()
      applyGridPlacement()
      const bounds = renderer.domElement.getBoundingClientRect()
      const overlay = measurementOverlayRef.current
      if (overlay) {
        syncOverlay(
          overlay,
          measurementVisuals.map((visual) => {
            const projected = new THREE.Vector3(visual.position.x, visual.position.y, visual.position.z).project(camera)
            return {
              key: visual.id,
              text: visual.label,
              visible: projected.z >= -1 && projected.z <= 1,
              left: (projected.x * 0.5 + 0.5) * bounds.width,
              top: (-projected.y * 0.5 + 0.5) * bounds.height,
              dataset: { measurementId: visual.id }
            }
          }),
          () => {
            const label = globalThis.document.createElement("div")
            label.className = "three-measurement-label"
            label.setAttribute("role", "status")
            return label
          }
        )
      }
      const labelOverlay = pointLabelOverlayRef.current
      if (labelOverlay) {
        syncOverlay(
          labelOverlay,
          visiblePointLabels.map((primitive) => {
            const projected = new THREE.Vector3(primitive.position.x, primitive.position.y, primitive.position.z).project(camera)
            const label = primitive.label ?? primitive.id
            return {
              key: primitive.id,
              text: label,
              visible: projected.z >= -1 && projected.z <= 1,
              // 点标记的半径是固定像素，所以标注也按像素偏移，不随缩放漂移。
              left: (projected.x * 0.5 + 0.5) * bounds.width + 10,
              top: (-projected.y * 0.5 + 0.5) * bounds.height - 10,
              dataset: { pointLabel: label, pointId: primitive.id }
            }
          }),
          () => {
            const label = globalThis.document.createElement("span")
            label.className = "three-point-label"
            return label
          }
        )
      }
      if (sceneShell) {
        sceneShell.dataset.cameraDistance = cameraStateRef.current.distance.toFixed(2)
        sceneShell.dataset.cameraTarget = `${cameraStateRef.current.target.x.toFixed(2)},${cameraStateRef.current.target.y.toFixed(2)},${cameraStateRef.current.target.z.toFixed(2)}`
        // 自动取景开关的状态：e2e 与排查都靠它读，不靠肉眼。
        sceneShell.dataset.autofit = autoFitRef.current ? "true" : "false"
        // 视角角度的读数：旋转不改变视点中心，所以"有没有转"只能从这里看出来。
        sceneShell.dataset.cameraAzimuth = cameraStateRef.current.azimuth.toFixed(2)
        sceneShell.dataset.cameraElevation = cameraStateRef.current.elevation.toFixed(2)
      }
      renderer.render(scene, camera)
    }
    /** Click tolerance in world units, so a grab is always the same number of pixels wide. */
    const pickTolerance = () => pointHandleWorldRadius(camera, cameraStateRef.current.distance, viewportHeight, PICK_TOLERANCE_PX)
    /** 自由拖动：把对象沿屏幕平面平移的世界位移。深度不变，所以拖完图形还在原来的纵深上。 */
    const dragDeltaFor = (session: { anchor: THREE.Vector3; origin: THREE.Vector3 }, point: { x: number; y: number }): THREE.Vector3 | null => {
      const current = dragWorldPoint(camera, session.anchor, point)
      return current ? current.sub(session.origin) : null
    }
    const setCameraState = (nextState: CameraState) => {
      cameraStateRef.current = nextState
      applyCameraState(camera, nextState)
      render()
    }
    resetCameraRef.current = () => setCameraState(resetCameraState())
    const fitToContent = () => {
      setCameraState(fitCameraState(cameraStateRef.current, sceneBounds, camera))
    }
    fitCameraRef.current = fitToContent
    fitWithoutTouchRef.current = () => animateToFit()
    /**
     * 自动取景的过渡：约 250ms 的 ease-out 插值，`prefersReducedMotion` 时直接跳变。
     * 直接写 `cameraStateRef` 而不走 `setCameraState`，因为自动取景不该把自己标记成"用户动过相机"。
     */
    let fitAnimation: number | null = null
    const cancelFitAnimation = () => {
      if (fitAnimation !== null) cancelAnimationFrame(fitAnimation)
      fitAnimation = null
    }
    const animateToFit = () => {
      const fitted = fitCameraState(cameraStateRef.current, sceneBounds, camera)
      cancelFitAnimation()
      if (prefersReducedMotion()) {
        cameraStateRef.current = fitted
        applyCameraState(camera, fitted)
        render()
        return
      }
      const from = cameraStateRef.current
      const started = performance.now()
      const step = () => {
        const ratio = Math.min(1, (performance.now() - started) / FIT_ANIMATION_MS)
        const eased = 1 - (1 - ratio) ** 3
        cameraStateRef.current = interpolateCameraState(from, fitted, eased)
        applyCameraState(camera, cameraStateRef.current)
        render()
        fitAnimation = ratio < 1 ? requestAnimationFrame(step) : null
      }
      fitAnimation = requestAnimationFrame(step)
    }
    // Fit when a different document arrives (open file, switch workspace, restore draft), not on every edit:
    // re-framing while the user is working would fight their own camera moves.
    contentKeyRef.current = currentContentKey()
    const fittedId = documentRef.current.metadata.id
    if (fittedDocumentRef.current !== fittedId) {
      fittedDocumentRef.current = fittedId
      fitToContent()
    }
    render()
    // 场景重建后把进行中的拖动偏移补画回去，避免拖动中途回弹（见 resumeDragVisualRef）。
    resumeDragVisualRef.current()
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      const next = viewportSize()
      viewportHeight = next.height
      camera.aspect = next.width / next.height
      camera.updateProjectionMatrix()
      renderer.setSize(next.width, next.height, false)
      render()
    })
    resizeObserver?.observe(container)

    /** 拖动期间的重画次数：拖动必须逐次跟手重画，否则画面会一格一格跳（见 handlePointerMove）。 */
    let dragFrames = 0
    /** 把这次拖动已经画上去的偏移补画到（可能是刚重建的）场景上，见 resumeDragVisualRef 的说明。 */
    resumeDragVisualRef.current = () => {
      const session = dragSessionRef.current
      if (!session?.applied || session.visualApplied.lengthSq() < 1e-12) return
      if (session.slideNormal) offsetSceneObjects(scene, session.targetId, session.slideNormal.clone().multiplyScalar(session.visualApplied.dot(session.slideNormal)))
      else applyDragOffsets(scene, session.family, session.visualApplied.clone())
      render()
    }
    /**
     * 场景运行时句柄：内容同步 + 补画进行中的拖动偏移 + 重画。
     * 由"内容同步效应"在签名变化时调用；渲染器与事件监听都留在本次挂载里，不再重建。
     */
    runtimeRef.current = {
      syncContent: () => {
        syncContent()
        /**
         * 自动取景的决策：文档换了或内容越界一定要拟合；内容变了但用户没动过相机也拟合；
         * 用户一旦手动调过视角，就只有"内容越界"才允许再抢（见 shouldAutoFit）。
         */
        const documentId = documentRef.current.metadata.id
        const documentChanged = fittedDocumentRef.current !== documentId
        const outOfView = isContentOutOfView(cameraStateRef.current, sceneBounds, camera)
        const shouldFit = shouldAutoFit({
          enabled: autoFitRef.current,
          dragging: dragSessionRef.current !== null,
          documentChanged,
          outOfView
        })
        fittedDocumentRef.current = documentId
        resumeDragVisualRef.current()
        render()
        if (shouldFit) {
          cameraFitRef.current += 1
          if (sceneShell) sceneShell.dataset.cameraFit = String(cameraFitRef.current)
          animateToFit()
        }
      }
    }
    const pointFromEvent = (event: PointerEvent) => {
      const bounds = renderer.domElement.getBoundingClientRect()
      return { x: (event.clientX - bounds.left) / Math.max(bounds.width, 1), y: (event.clientY - bounds.top) / Math.max(bounds.height, 1) }
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 && event.button !== 1) return
      event.preventDefault()
      const point = pointFromEvent(event)
      pointerStateRef.current = { pointerId: event.pointerId, x: point.x, y: point.y, lastX: point.x, lastY: point.y, button: event.button, moved: false, shiftKey: event.shiftKey }
      dragSessionRef.current = null
      if (sceneShell) sceneShell.dataset.dragTarget = ""
      // 以面为剖切面：这一次点击只用来取面，取到就退出该模式。
      if (facePickModeRef.current && event.button === 0) {
        const hit = pickRaycastHit3(scene, camera, point, { tolerance: pickTolerance() })
        const face = hit ? documentRef.current.primitives.find((primitive) => primitive.id === hit.primitiveId) : undefined
        const section = documentRef.current.primitives.find((primitive): primitive is SectionPrimitive => primitive.type === "section" && selectedIdsRef.current.includes(primitive.id))
        if (hit?.kind === "face" && face?.type === "face3" && section) {
          // 由面的点环求它所在的平面；不共面的环（例如曲面侧面）会被 planeThroughPoints 直接拒绝。
          const vertices = face.pointIds.map((id) => points.get(id)?.position).filter((position): position is Vector3 => Boolean(position))
          const plane = planeThroughPoints(vertices)
          if (plane) {
            pickSectionFaceRef.current?.(section.id, plane)
            setFacePickMode(false)
          }
        }
        renderer.domElement.releasePointerCapture(event.pointerId)
        return
      }
      if (dragModeRef.current && event.button === 0) {
        const hit = pickRaycastHit3(scene, camera, point, { tolerance: pickTolerance() })
        const targetId = resolveSelectableHit(hit?.primitiveId ?? null, topologyOwners)
        const target = targetId ? documentRef.current.primitives.find((primitive) => primitive.id === targetId) : undefined
        // 拖动排查用读数：这一次按下到底抓到了什么。
        if (sceneShell) sceneShell.dataset.dragTarget = `${hit?.kind ?? "none"}:${hit?.primitiveId ?? "-"}->${target?.type ?? "none"}`
        // 截面要单独判定：它画在实体内部，按深度永远排不到，但用户指向那圈线时就是要挪刀口。
        const sectionId = pickSectionAt(scene, camera, point, pickTolerance(), hit?.kind === "point" || hit?.kind === "edge")
        const section = sectionId ? documentRef.current.primitives.find((primitive) => primitive.id === sectionId) : undefined
        if (section && section.type === "section") {
          // 拖动一个截面 = 沿法向平移剖切面。截面没有自己的实体几何，拖它就是挪刀口。
          const normal = sectionUnitNormal(section.plane.normal)
          if (normal) {
            // 需要一个真实的世界锚点（拖动位移由屏幕平面求交得出），用指针射线在截面所在平面上的落点。
            const anchor = dragWorldPoint(camera, new THREE.Vector3(0, 0, 0), point)
            if (anchor) {
              const sectionPoint = section.points[0]
              if (sectionPoint) anchor.set(sectionPoint.x, sectionPoint.y, sectionPoint.z)
              dragSessionRef.current = { targetId: section.id, family: new Set([section.id]), anchor, origin: anchor.clone(), total: new THREE.Vector3(), visualApplied: new THREE.Vector3(), applied: false, slideNormal: normal }
            }
          }
        } else if (hit && target && target.type === "point3" && target.binding && target.binding.kind !== "free") {
          /**
           * 绑定点的拖动：指针位置投影回**宿主的参数域**，点由参数算出坐标，所以永远贴住宿主
           * （不像自由拖动那样"叠加屏幕位移"，拖久了也不会漂离）。拖动期间只更新参数与受影响对象。
           */
          const binding = target.binding
          const hostId = binding.kind === "onHost" ? binding.hostId : binding.kind === "onFace" ? binding.faceId : binding.kind === "onSurface" ? binding.solidId : null
          const hostPrimitive = hostId ? documentRef.current.primitives.find((candidate) => candidate.id === hostId) : undefined
          const hostConstraint = hostPrimitive ? host3FromPrimitive(hostPrimitive, documentRef.current.primitives) : null
          if (hostConstraint) {
            const anchor = new THREE.Vector3(hit.worldPoint.x, hit.worldPoint.y, hit.worldPoint.z)
            const origin = dragWorldPoint(camera, anchor, point) ?? anchor.clone()
            const dependents = dragFamilyIds(documentRef.current, target.id)
            dependents.delete(target.id)
            dragSessionRef.current = {
              targetId: target.id,
              family: new Set([target.id]),
              anchor,
              origin,
              total: new THREE.Vector3(),
              visualApplied: new THREE.Vector3(),
              applied: false,
              hostConstraint,
              hostDependents: [...dependents].filter((id) => ["line3", "segment3", "ray3", "edge3", "face3"].includes(documentRef.current.primitives.find((candidate) => candidate.id === id)?.type ?? ""))
            }
          }
        } else if (hit && target && isFreeDraggable3(target, points, templateTopologyIds(documentRef.current))) {
          const anchor = new THREE.Vector3(hit.worldPoint.x, hit.worldPoint.y, hit.worldPoint.z)
          const origin = dragWorldPoint(camera, anchor, point) ?? anchor.clone()
          dragSessionRef.current = { targetId: target.id, family: dragFamilyIds(documentRef.current, target.id), anchor, origin, total: new THREE.Vector3(), visualApplied: new THREE.Vector3(), applied: false }
        }
      }
      renderer.domElement.setPointerCapture(event.pointerId)
    }
    const handlePointerMove = (event: PointerEvent) => {
      const pointerState = pointerStateRef.current
      if (!pointerState || pointerState.pointerId !== event.pointerId) return
      const point = pointFromEvent(event)
      const deltaX = point.x - pointerState.lastX
      const deltaY = point.y - pointerState.lastY
      pointerState.moved ||= Math.hypot(point.x - pointerState.x, point.y - pointerState.y) > 0.008
      const session = dragSessionRef.current
      if (session) {
        const world = dragDeltaFor(session, point)
        if (world) {
          if (session.hostConstraint) {
            /**
             * 绑定点：把指针在世界平面上的落点**投影回宿主参数域**，再由参数算出坐标。
             * 每帧只重建这个点与它的下游对象（不整场重建、不进撤销历史），抬手才提交参数。
             */
            const worldPoint = session.origin.clone().add(world)
            const parameter = session.hostConstraint.closestParameter({ x: worldPoint.x, y: worldPoint.y, z: worldPoint.z })
            const projected = session.hostConstraint.evaluate(parameter)
            session.hostParameter = parameter
            session.applied = true
            const current = points.get(session.targetId)
            if (current) points.set(session.targetId, { ...current, position: projected })
            refreshPrimitiveObject(session.targetId)
            for (const dependentId of session.hostDependents ?? []) refreshPrimitiveObject(dependentId)
            pointerState.lastX = point.x
            pointerState.lastY = point.y
            render()
            dragFrames += 1
            if (sceneShell) {
              sceneShell.dataset.dragFrames = String(dragFrames)
              sceneShell.dataset.dragParameter = parameter.v === undefined ? parameter.u.toFixed(4) : `${parameter.u.toFixed(4)},${parameter.v.toFixed(4)}`
              // 残差应当恒为 0：坐标就是从参数算出来的（这条读数是"严格贴住宿主"的直接证据）。
              sceneShell.dataset.hostResidual = session.hostConstraint.residual(projected).toFixed(6)
              // 这次拖动里有多少下游对象跟着重建（0 表示这个点还没有下游）。
              sceneShell.dataset.hostDependents = String(session.hostDependents?.length ?? 0)
            }
            return
          }
          // 截面只认法向分量：屏幕位移先投影到法向，切向拖动不会让剖切面乱跑。
          if (session.slideNormal) session.total.copy(session.slideNormal).multiplyScalar(world.dot(session.slideNormal))
          else session.total.copy(world)
          // 只画"还没画的那一段"：画面跟手，文档在整次拖动期间保持不动。
          const step = session.total.clone().sub(session.visualApplied)
          if (step.lengthSq() > 1e-12) {
            if (session.slideNormal) {
              // 截面：屏幕位移投影到法向，画面上把截面与剖切面片一起挪，抬手再提交文档。
              const distance = step.dot(session.slideNormal)
              if (Math.abs(distance) > 1e-12) offsetSceneObjects(scene, session.targetId, session.slideNormal.clone().multiplyScalar(distance))
            } else {
              applyDragOffsets(scene, session.family, step)
            }
            session.visualApplied.copy(session.total)
            session.applied = true
            /**
             * 立刻重画。这些偏移只是改了 Three.js 对象的位置，**不会自己触发渲染**；
             * 少了这一句，画面就要等到下一次别的渲染（相机、尺寸、提交后的场景重建）才更新，
             * 拖动看起来就是"一帧一帧"跳（实测：20 次 pointermove 里只有 3 次真的重画）。
             */
            render()
            dragFrames += 1
            if (sceneShell) sceneShell.dataset.dragFrames = String(dragFrames)
          }
          /**
           * 拖动期间**不提交文档**：每次提交都会重建整个 3D 场景（几何与材质全部重建），
           * 那正是拖动中"顿一下"的来源，而且一次拖动会变成多步撤销。画面由上面的临时偏移负责，
           * 抬手时再一次性提交（见 handlePointerUp）。
           */
        }
        pointerState.lastX = point.x
        pointerState.lastY = point.y
        return
      }
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
      const pointerState = pointerStateRef.current
      if (!pointerState || pointerState.pointerId !== event.pointerId) return
      const point = pointFromEvent(event)
      const session = dragSessionRef.current
      if (session) {
        dragSessionRef.current = null
        // 拖动期间一次都没提交，所以这里的一次提交就是整次拖动唯一的一步撤销。
        if (session.hostConstraint && session.hostParameter && session.applied) {
          // 绑定点：提交的是**宿主参数**；坐标由重算派生，所以点不会因为浮点累积而漂离宿主。
          hostDragEndRef.current?.(session.targetId, session.hostParameter)
        } else if (session.applied && session.total.lengthSq() > 1e-8) {
          if (session.slideNormal) moveSectionRef.current?.(session.targetId, session.total.dot(session.slideNormal))
          else dragEndRef.current?.(session.targetId, session.total)
        }
        // 选中放在抬手：拖动本身不该因为高亮重建而多一次场景重建。
        if (!selectedIdsRef.current.includes(session.targetId)) onSelectRef.current(session.targetId, false)
      } else if (!pointerState.moved && pointerState.button === 0) {
        /**
         * 点击优先级：**点 / 棱的拾取优先于"创建"**。
         * 否则虚线预览会抢走顶点手柄的点击（实测回归：点顶点手柄变成创建截线），
         * 而细粒度的空间元素本来就是用户更明确的目标；只有落到实体/面的点击才解释为创建。
         *
         * 截面预览是例外，但要有条件：它的那圈虚线落在实体**内部**，任何点击都会先命中实体的面，
         * 按上面的规则永远轮不到它（实测"点虚线创建截面"完全无效）。所以指针停在预览上时让预览优先，
         * 除非用户明确指到了一个**比剖切面更靠前**的顶点/棱手柄——那种情况下用户要的是那个手柄。
         */
        const hit = pickRaycastHit3(scene, camera, point, { tolerance: pickTolerance() })
        const precise = hit?.kind === "point" || hit?.kind === "edge"
        // 按点击位置重新判定预览（不能用 pointermove 留下的标志：原地点击可能根本没有移动事件）。
        const previewHit = previewHitAt(point)
        const previewInFront = previewHit.depth === null || !hit || previewHit.depth <= hit.depth
        const sectionWins = previewKindRef.current === "section" && previewInFront
        // 排查读数：这一次点击到底被哪条规则拦下（粗拾取到了什么、预览有没有命中、谁更靠前）。
        if (sceneShell) sceneShell.dataset.pickReadout = `${hit?.kind ?? "none"}|${hit?.primitiveId ?? "-"}|${precise ? "precise" : "coarse"}|${previewHit.hovering ? "hover" : "off"}|${previewInFront ? "front" : "behind"}`
        if (previewHit.hovering && previewClickRef.current && (!precise || sectionWins)) previewClickRef.current()
        else onSelectRef.current(resolveSelectableHit(hit?.primitiveId ?? null, topologyOwners, event.altKey), event.shiftKey)
      }
      renderer.domElement.releasePointerCapture(event.pointerId)
      pointerStateRef.current = null
    }
    /**
     * 指针落在虚线预览上了吗？用射线与预览命中区求交，阈值按屏幕像素给（与实体拾取同一套思路），
     * 这样"点击创建"只在真的指向预览时生效，不会抢走普通选择。
     * 独立成函数是因为 **点击时必须按点击位置重新判定一次**：浏览器不需要在 pointerdown 之前先发
     * pointermove，只靠 pointermove 维护的标志会让"原地点击"读到过期状态（实测：剖切面确实在指针下、
     * 却因为标志是 false 而创建不了截面）。
     */
    const previewHitAt = (normalizedPoint: { x: number; y: number }) => {
      if (!previewGroup) return { hovering: false, depth: null as number | null }
      const raycaster = new THREE.Raycaster()
      raycaster.params.Line = { threshold: pickTolerance() }
      raycaster.setFromCamera(new THREE.Vector2(normalizedPoint.x * 2 - 1, -(normalizedPoint.y * 2 - 1)), camera)
      const hitTargets = (previewGroup.userData.hitTargets as THREE.Object3D[] | undefined) ?? previewGroup.children
      const hits = raycaster.intersectObjects(hitTargets, false)
      return { hovering: hits.length > 0, depth: hits.length > 0 ? hits[0].distance : null }
    }
    const updatePreviewHover = (event: PointerEvent) => {
      if (!previewGroup || !onPreviewHover) return
      const point = pointFromEvent(event)
      const { hovering, depth } = previewHitAt(point)
      previewDepthRef.current = depth
      if (sceneShell) sceneShell.dataset.previewHovering = hovering ? "true" : "false"
      if (hovering !== previewHovering) {
        previewHovering = hovering
        onPreviewHover(hovering)
      }
    }
    let previewHovering = false
    const handlePointerMoveForPreview = (event: PointerEvent) => updatePreviewHover(event)
    const handlePointerLeaveForPreview = () => {
      previewDepthRef.current = null
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
    /**
     * 方向键微调剖切面：只在「自由拖动」开着、且选中的是截面时生效（与拖动的语义一致）。
     * 上下键沿法向 1 个单位、左右键反向；按住 Shift 走 0.2，用来贴近某个面。
     */
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!dragModeRef.current || event.altKey || event.ctrlKey || event.metaKey) return
      const section = documentRef.current.primitives.find((primitive): primitive is SectionPrimitive => primitive.type === "section" && selectedIdsRef.current.includes(primitive.id))
      if (!section || !sectionUnitNormal(section.plane.normal)) return
      const direction = event.key === "ArrowUp" || event.key === "ArrowRight" ? 1 : event.key === "ArrowDown" || event.key === "ArrowLeft" ? -1 : 0
      if (direction === 0) return
      event.preventDefault()
      moveSectionRef.current?.(section.id, direction * (event.shiftKey ? 0.2 : 1))
    }
    globalThis.addEventListener("keydown", handleKeyDown)
    renderer.domElement.addEventListener("pointerdown", handlePointerDown)
    renderer.domElement.addEventListener("pointermove", handlePointerMove)
    renderer.domElement.addEventListener("pointerup", handlePointerUp)
    renderer.domElement.addEventListener("pointercancel", handlePointerUp)
    renderer.domElement.addEventListener("wheel", handleWheel, { passive: false })
    renderer.domElement.addEventListener("contextmenu", handleContextMenu)
    return () => {
      resetCameraRef.current = () => undefined
      fitCameraRef.current = () => undefined
      runtimeRef.current = null
      contentKeyRef.current = null
      cancelFitAnimation()
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown)
      renderer.domElement.removeEventListener("pointermove", handlePointerMove)
      renderer.domElement.removeEventListener("pointerup", handlePointerUp)
      renderer.domElement.removeEventListener("pointercancel", handlePointerUp)
      renderer.domElement.removeEventListener("pointermove", handlePointerMoveForPreview)
      renderer.domElement.removeEventListener("pointerleave", handlePointerLeaveForPreview)
      renderer.domElement.removeEventListener("wheel", handleWheel)
      renderer.domElement.removeEventListener("contextmenu", handleContextMenu)
      globalThis.removeEventListener("keydown", handleKeyDown)
      resizeObserver?.disconnect()
      disposeScene(scene)
      renderer.dispose()
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement)
    }
    // 挂载期只建一次：文档、选择与显示开关都经 ref 读取，父组件的任何重渲染都不再重建渲染器。
  }, [])

  /** 开关的状态立刻反映到 DOM 读数上：切换开关不会重建场景，所以不能只靠 render() 去写。 */
  useEffect(() => {
    const shell = containerRef.current
    if (shell) shell.dataset.autofit = autoFit ? "true" : "false"
  }, [autoFit])

  /**
   * 内容同步：只在"场景内容签名"变化时跑。文档编辑、选中、显示开关、预览与展开进度会改变签名；
   * 相机、指针、提示文案不会，因此悬停与提示不再触发任何场景工作。
   */
  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    const key = sceneContentKey({
      document,
      selectedIds,
      showHiddenEdges,
      showNormals,
      transparentFaces,
      unfoldProgress,
      previewKind: preview?.kind ?? null
    })
    if (!sceneSyncDecision(contentKeyRef.current, key)) return
    contentKeyRef.current = key
    runtime.syncContent()
  }, [document, selectedIds, showHiddenEdges, showNormals, transparentFaces, unfoldProgress, preview])

  const hasGeometry = document.primitives.some((primitive) => ["point3", "line3", "segment3", "ray3", "edge3", "face3", "polyhedron3", "cube", "pyramid", "cylinder", "cone"].includes(primitive.type) && primitive.visible !== false)
  /** 「以面为剖切面」需要有选中的截面作为目标。 */
  const hasSelectedSection = selectedIds.some((id) => document.primitives.some((primitive) => primitive.id === id && primitive.type === "section"))
  const angle = dihedralAngleDegrees({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })
  return <div className="three-canvas-shell" ref={containerRef} data-3d-scene="true" data-pan-mode={panMode ? "true" : "false"} data-drag-mode={dragMode ? "true" : "false"} aria-label="3D 几何场景"><div className="three-render-target" ref={renderTargetRef} /><div className="three-measurement-overlay" ref={measurementOverlayRef} aria-label="三维测量标注" /><div className="three-point-label-overlay" ref={pointLabelOverlayRef} aria-label="三维点标注" />{webglAvailable && <div className="three-scene-controls" aria-label="3D显示控制"><button type="button" aria-pressed={transparentFaces} onClick={() => setTransparentFaces((visible) => !visible)}>透明面</button><button type="button" aria-pressed={showHiddenEdges} onClick={() => setShowHiddenEdges((visible) => !visible)}>隐藏边</button><button type="button" aria-pressed={showNormals} onClick={toggleNormals}>法向量</button><button type="button" aria-pressed={unfolded} onClick={() => setUnfolded((visible) => !visible)}>{unfolded ? "折叠" : "展开"}</button><button type="button" aria-pressed={showAngle} onClick={toggleAngleDemo}>测量二面角</button><button type="button" aria-label="自动取景" aria-pressed={autoFit} title="开启后，加载文件、增删图元或内容跑出视野时会自动把视角调整到框住全部可见图元（保留 30% 安全边距）；你手动转动过视角之后就不再主动抢" onClick={() => { const next = !autoFit; setAutoFit(next); saveViewPreference3d({ autoFit: next }); if (next) fitWithoutTouchRef.current() }}>自动取景</button><button type="button" aria-label="以面为剖切面" aria-pressed={facePickMode} title="点一下这个按钮，再点实体上的某个面，该面就成为选中截面的剖切面" disabled={!hasSelectedSection} onClick={() => setFacePickMode((active) => !active)}>取面</button></div>}{webglAvailable && <div className="three-camera-controls" aria-label="3D视角控制"><button type="button" aria-label="自由拖动" aria-pressed={dragMode} title="开启后左键按住图形即整体拖动：实体、点、以及由点驱动的棱/线/面/平面都会跟着指针在屏幕平面内移动，其它对象不受影响" onClick={() => enterMode("drag")}>自由拖动</button><button type="button" aria-label="平移视角" aria-pressed={panMode} title="开启后左键拖动画布即平移视角，按 Ctrl 拖动沿视线前后移动" onClick={() => enterMode("pan")}>平移视角</button><button type="button" aria-label="适应视图" title="把视角调整到刚好框住当前图形，并把视角中心移回图形" onClick={() => fitCameraRef.current()}>适应视图</button><button type="button" aria-label="重置3D视角" title="回到默认视角" onClick={() => resetCameraRef.current()}>重置视角</button></div>}{webglAvailable && <p className="three-camera-hint" data-camera-hint="true">{dragMode ? "自由拖动已开启：左键按住图形整体移动 · 关掉按钮后左键拖动恢复为旋转视角 · 滚轮缩放" : panMode ? "平移视角已开启：左键拖动平移 · 按 Ctrl 拖动沿视线前后移动 · 滚轮缩放" : "左键拖动旋转 · 中键或 Shift+左键拖动平移 · Ctrl+拖动沿视线前后移动 · 滚轮缩放"}</p>}{showAngle && webglAvailable && <div className="three-angle-readout" role="status">二面角：{angle.toFixed(1)}°（示例法向量 X/Y）</div>}{!webglAvailable && <div className="three-scene-status" role="status">当前浏览器不支持 WebGL，无法显示 3D 场景。</div>}{webglAvailable && !hasGeometry && <div className="three-scene-status" role="status">添加点、线或面开始探索三维空间。</div>}</div>
}
