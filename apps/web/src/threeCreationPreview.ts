import * as THREE from "three"
import type { Vector3 } from "@draw/dsl"

import type { SpatialCreationSession } from "./spatialCreationSession"

export function creationPreviewVertices(session: SpatialCreationSession, hover: Vector3 | null): Vector3[] {
  const points = session.anchors.map((anchor) => anchor.position)
  if (hover) points.push(hover)
  else if (session.tool === "face3" && points.length >= 3) points.push(points[0])
  return points
}

/** Disposable, unpickable guide; the document is never mutated while hovering. */
export function updateThreeCreationPreview(group: THREE.Group, session: SpatialCreationSession | null, hover: Vector3 | null, accent: string): void {
  for (const object of [...group.children]) {
    group.remove(object)
    if (object instanceof THREE.Line) {
      object.geometry.dispose()
      const material = object.material
      if (Array.isArray(material)) material.forEach((item) => item.dispose())
      else material.dispose()
    } else if (object instanceof THREE.Mesh) {
      object.geometry.dispose()
      const material = object.material
      if (Array.isArray(material)) material.forEach((item) => item.dispose())
      else material.dispose()
    }
  }
  if (!session) return
  const points = creationPreviewVertices(session, hover)
  if (points.length >= 2) {
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map((point) => new THREE.Vector3(point.x, point.y, point.z)))
    const line = new THREE.Line(geometry, new THREE.LineDashedMaterial({ color: accent, dashSize: 0.22, gapSize: 0.12, depthTest: false, transparent: true, opacity: 0.95 }))
    line.computeLineDistances()
    line.renderOrder = 50
    group.add(line)
  }
  if (hover) {
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 8), new THREE.MeshBasicMaterial({ color: accent, depthTest: false }))
    marker.position.set(hover.x, hover.y, hover.z)
    marker.renderOrder = 51
    group.add(marker)
  }
}