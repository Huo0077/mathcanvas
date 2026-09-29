import * as THREE from "three"
import type { Vector3 } from "@draw/dsl"

import type { RaycastHit3 } from "./threePicking"

export type WorkPlane = "xy" | "xz" | "yz" | { normal: Vector3; constant: number }

export type SpatialPickResult =
  | { position: Vector3; pointId?: string; source: "point" | "edge" | "face" | "work-plane" }
  | { reason: string }

const unableToProject = "当前视角无法确定工作平面的落点，请旋转视角或切换工作平面"

function planeFor(workPlane: WorkPlane): THREE.Plane {
  if (workPlane === "xy") return new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
  if (workPlane === "xz") return new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  if (workPlane === "yz") return new THREE.Plane(new THREE.Vector3(1, 0, 0), 0)
  return new THREE.Plane(new THREE.Vector3(workPlane.normal.x, workPlane.normal.y, workPlane.normal.z), workPlane.constant)
}

export function resolveSpatialAnchor(hit: RaycastHit3 | null, ray: THREE.Ray, workPlane: WorkPlane): SpatialPickResult {
  if (hit && ["point", "edge", "face"].includes(hit.kind)) {
    return {
      position: { ...hit.worldPoint },
      ...(hit.kind === "point" ? { pointId: hit.primitiveId } : {}),
      source: hit.kind as "point" | "edge" | "face"
    }
  }
  const plane = planeFor(workPlane)
  const denominator = plane.normal.dot(ray.direction)
  if (plane.normal.lengthSq() < 1e-12 || Math.abs(denominator) < 1e-8) return { reason: unableToProject }
  const distance = -(ray.origin.dot(plane.normal) + plane.constant) / denominator
  if (!Number.isFinite(distance) || distance < 0) return { reason: unableToProject }
  const position = ray.at(distance, new THREE.Vector3())
  return { position: { x: position.x, y: position.y, z: position.z }, source: "work-plane" }
}