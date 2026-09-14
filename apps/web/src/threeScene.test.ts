import { describe, expect, it } from "vitest"
import * as THREE from "three"

import { createCameraState, createCubeMesh, createFace3Mesh, createPoint3Mesh, createPointDrivenLine, createSolidGroup, createSolidMesh, cubeUnfoldCenters, panCameraState, pickPrimitiveAt, pickRaycastHit3, resetCameraState, rotateCameraState, zoomCameraState } from "./threeScene"

describe("Three.js geometry scene", () => {
  it("renders a selectable point3 at its source position", () => {
    const mesh = createPoint3Mesh({ id: "point3-a", type: "point3", position: { x: 1, y: 2, z: 3 } }, false)

    expect(mesh.position.toArray()).toEqual([1, 2, 3])
    expect(mesh.userData.primitiveId).toBe("point3-a")

    mesh.geometry.dispose()
    ;(mesh.material as THREE.Material).dispose()
  })

  it("renders a line3 from stable point references", () => {
    const points = new Map([
      ["point-a", { id: "point-a", type: "point3" as const, position: { x: 0, y: 0, z: 0 } }],
      ["point-b", { id: "point-b", type: "point3" as const, position: { x: 2, y: 3, z: 4 } }]
    ])
    const line = createPointDrivenLine({ id: "line-ab", type: "line3", definition: { kind: "throughPoints", pointIds: ["point-a", "point-b"] } }, points, false)

    expect(line).toBeTruthy()
    expect(line?.geometry.attributes.position.count).toBe(2)
    expect(line?.userData.primitiveId).toBe("line-ab")
    line?.geometry.dispose()
    ;(line?.material as THREE.Material | undefined)?.dispose()
  })

  it("renders a face3 from a closed point ring", () => {
    const points = new Map([
      ["point-a", { id: "point-a", type: "point3" as const, position: { x: 0, y: 0, z: 0 } }],
      ["point-b", { id: "point-b", type: "point3" as const, position: { x: 2, y: 0, z: 0 } }],
      ["point-c", { id: "point-c", type: "point3" as const, position: { x: 0, y: 2, z: 0 } }]
    ])
    const mesh = createFace3Mesh({ id: "face-abc", type: "face3", pointIds: ["point-a", "point-b", "point-c"] }, points, false)

    expect(mesh).toBeTruthy()
    expect(mesh?.geometry.index?.count).toBe(3)
    expect(mesh?.userData.primitiveId).toBe("face-abc")
    mesh?.geometry.dispose()
    ;(mesh?.material as THREE.Material | undefined)?.dispose()
  })

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

  it("prefers a spatial point over a containing face and returns depth", () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    camera.position.set(0, 0, 8)
    camera.lookAt(0, 0, 0)
    const scene = new THREE.Scene()
    const cube = createCubeMesh({ id: "cube-under-point", type: "cube", origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }, false)
    const point = createPoint3Mesh({ id: "point-front", type: "point3", position: { x: 0, y: 0, z: 1 } }, false)
    scene.add(cube, point)

    const hit = pickRaycastHit3(scene, camera, { x: 0.5, y: 0.5 })

    expect(hit?.primitiveId).toBe("point-front")
    expect(hit?.kind).toBe("point")
    expect(hit?.depth).toBeGreaterThan(0)
    expect(hit?.worldPoint.z).toBeGreaterThan(0)

    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose()
      if (object instanceof THREE.Mesh && object.material instanceof THREE.Material) object.material.dispose()
    })
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

  it("reports the picked unfolded face as a stable sub-part id", () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    camera.position.set(0, 0, 12)
    camera.lookAt(0, 0, 0)
    const scene = new THREE.Scene()
    const group = createSolidGroup({ id: "cube-unfolded", type: "cube", origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }, false, { unfoldProgress: 1 })
    scene.add(group)

    const hit = pickRaycastHit3(scene, camera, { x: 0.5, y: 0.5 })

    expect(hit?.primitiveId).toBe("cube-unfolded")
    expect(hit?.partId).toMatch(/^unfolded-face-\d$/)

    group.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) child.geometry.dispose()
      if ("material" in child && child.material instanceof THREE.Material) child.material.dispose()
    })
  })
})
