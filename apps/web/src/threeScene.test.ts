import { describe, expect, it } from "vitest"
import * as THREE from "three"

import { createCameraState, createCubeMesh, createSolidGroup, createSolidMesh, cubeUnfoldCenters, panCameraState, pickPrimitiveAt, resetCameraState, rotateCameraState, zoomCameraState } from "./threeScene"

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

  it("updates and resets an orbit camera without mutating the source state", () => {
    const initial = createCameraState()
    const rotated = rotateCameraState(initial, 24, -12)
    const panned = panCameraState(rotated, 2, -1)
    const zoomed = zoomCameraState(panned, 0.6)

    expect(rotated).not.toEqual(initial)
    expect(zoomed.distance).toBeLessThan(panned.distance)
    expect(resetCameraState()).toEqual(initial)
  })

  it("picks a solid mesh by viewport coordinates", () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    camera.position.set(0, 0, 8)
    camera.lookAt(0, 0, 0)
    const mesh = createCubeMesh({ id: "cube-pick", type: "cube", origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }, false)
    const scene = new THREE.Scene()
    scene.add(mesh)

    expect(pickPrimitiveAt(scene, camera, { x: 0.5, y: 0.5 })).toBe("cube-pick")
    expect(pickPrimitiveAt(scene, camera, { x: 0.99, y: 0.99 })).toBeNull()

    mesh.geometry.dispose()
    const material = mesh.material as THREE.Material
    material.dispose()
  })

  it("builds optional hidden-edge and normal visual layers", () => {
    const group = createSolidGroup({ id: "cube-visual", type: "cube", origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }, false, { showHiddenEdges: true, showNormals: true })
    const hiddenEdges = group.children.find((child) => child.userData.visualRole === "hidden-edges") as THREE.LineSegments | undefined
    const normals = group.children.filter((child) => child.userData.visualRole === "normal")

    expect(hiddenEdges).toBeTruthy()
    expect((hiddenEdges?.material as THREE.LineDashedMaterial).depthTest).toBe(false)
    expect((hiddenEdges?.material as THREE.LineDashedMaterial).dashSize).toBeGreaterThan(0)
    expect(normals.length).toBeGreaterThan(0)

    group.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) child.geometry.dispose()
      if ("material" in child && child.material instanceof THREE.Material) child.material.dispose()
    })
  })

  it("moves cube faces into a deterministic unfold layout", () => {
    const folded = cubeUnfoldCenters({ x: 2, y: 4, z: 6 }, 0)
    const unfolded = cubeUnfoldCenters({ x: 2, y: 4, z: 6 }, 1)

    expect(folded).toHaveLength(6)
    expect(unfolded).toHaveLength(6)
    expect(unfolded).not.toEqual(folded)
    expect(new Set(unfolded.map((face) => `${face.center.x},${face.center.y},${face.center.z}`)).size).toBe(6)
  })
})
