/**
 * 3D 拾取：射线命中、命中种类与「该选中谁」的判定
 *
 * 从 threeScene.tsx 抽出来的纯函数：它们与 React 无关，独立成模块后可以直接单测，
 * 组件文件也不再混着一堆非组件导出（react-refresh 的告警就是这么来的）。
 */
import * as THREE from "three"
import type { GeometryDocument, Vector3 } from "@draw/dsl"

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
