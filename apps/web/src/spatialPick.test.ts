import * as THREE from "three"
import { describe, expect, it } from "vitest"

import { resolveSpatialAnchor, type WorkPlane } from "./spatialPick"
import type { RaycastHit3 } from "./threePicking"

const ray = new THREE.Ray(new THREE.Vector3(2, 3, 10), new THREE.Vector3(0, 0, -1))

function hit(kind: RaycastHit3["kind"], position = { x: 4, y: 5, z: 6 }): RaycastHit3 {
  return { kind, primitiveId: "point-1", depth: 4, worldPoint: position }
}

describe("3D spatial placement", () => {
  it("uses the precise position of an existing point rather than the work plane", () => {
    expect(resolveSpatialAnchor(hit("point"), ray, "xy")).toEqual({ position: { x: 4, y: 5, z: 6 }, pointId: "point-1", source: "point" })
  })

  it("places an empty click on the visible XY plane z=0", () => {
    expect(resolveSpatialAnchor(null, ray, "xy")).toEqual({ position: { x: 2, y: 3, z: 0 }, source: "work-plane" })
  })

  it("supports XZ and YZ planes without guessing depth", () => {
    const towardY = new THREE.Ray(new THREE.Vector3(2, 10, 4), new THREE.Vector3(0, -1, 0))
    expect(resolveSpatialAnchor(null, towardY, "xz")).toEqual({ position: { x: 2, y: 0, z: 4 }, source: "work-plane" })
    const towardX = new THREE.Ray(new THREE.Vector3(10, 3, 4), new THREE.Vector3(-1, 0, 0))
    expect(resolveSpatialAnchor(null, towardX, "yz")).toEqual({ position: { x: 0, y: 3, z: 4 }, source: "work-plane" })
  })

  it("refuses nearly parallel or backwards rays instead of creating an arbitrary point", () => {
    const parallel = new THREE.Ray(new THREE.Vector3(1, 2, 5), new THREE.Vector3(1, 0, -1e-11).normalize())
    expect(resolveSpatialAnchor(null, parallel, "xy")).toEqual({ reason: "当前视角无法确定工作平面的落点，请旋转视角或切换工作平面" })
    const away = new THREE.Ray(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, 1))
    expect(resolveSpatialAnchor(null, away, "xy")).toHaveProperty("reason")
  })

  it("never binds a new point to a face merely because a ray hit its display mesh", () => {
    expect(resolveSpatialAnchor(hit("face"), ray, "xy")).toEqual({ position: { x: 4, y: 5, z: 6 }, source: "face" })
  })

  it("snaps to a displayed spatial line without binding an invented point", () => {
    expect(resolveSpatialAnchor(hit("line"), ray, "xy")).toEqual({ position: { x: 4, y: 5, z: 6 }, source: "edge" })
  })
  it("supports a selected face work plane using its geometric plane", () => {
    const selectedFace: WorkPlane = { normal: { x: 0, y: 0, z: 1 }, constant: -3 }
    expect(resolveSpatialAnchor(null, ray, selectedFace)).toEqual({ position: { x: 2, y: 3, z: 3 }, source: "work-plane" })
  })
})