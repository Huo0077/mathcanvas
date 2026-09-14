import { describe, expect, it } from "vitest"
import * as THREE from "three"

import { createCubeMesh, createSolidMesh } from "./threeScene"

describe("Three.js geometry scene", () => {
  it("maps a parameterized cube to a centered box mesh", () => {
    const mesh = createCubeMesh({
      id: "cube-1",
      type: "cube",
      origin: { x: -2, y: -3, z: -4 },
      size: { x: 4, y: 6, z: 8 },
      label: "教学立方体"
    }, false)

    expect(mesh.position.toArray()).toEqual([0, 0, 0])
    expect((mesh.geometry as THREE.BoxGeometry).parameters).toMatchObject({ width: 4, height: 6, depth: 8 })
    expect(mesh.userData.primitiveId).toBe("cube-1")

    mesh.geometry.dispose()
    const material = mesh.material as THREE.Material
    material.dispose()
  })

  it.each([
    { type: "pyramid" as const, id: "pyramid-1", expectedKind: "pyramid" },
    { type: "cylinder" as const, id: "cylinder-1", expectedKind: "cylinder" },
    { type: "cone" as const, id: "cone-1", expectedKind: "cone" }
  ])("creates a $expectedKind mesh from its DSL parameters", ({ type, id, expectedKind }) => {
    const primitive = type === "pyramid"
      ? { id, type, baseCenter: { x: 1, y: 2, z: 3 }, baseSize: { x: 4, y: 6 }, height: 8 }
      : { id, type, center: { x: 1, y: 2, z: 3 }, radius: 4, height: 8, segments: 12 }
    const mesh = createSolidMesh(primitive, false)

    expect(mesh.userData.primitiveId).toBe(id)
    expect(mesh.userData.primitiveType).toBe(expectedKind)
    expect(mesh.geometry.attributes.position.count).toBeGreaterThan(0)

    mesh.geometry.dispose()
    const material = mesh.material as THREE.Material
    material.dispose()
  })
})
