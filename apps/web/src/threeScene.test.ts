import { describe, expect, it } from "vitest"
import * as THREE from "three"

import type { SectionPrimitive } from "@draw/dsl"
import { dihedralMarker3, unfoldPolyhedron3 } from "@draw/geometry-kernel"

import { createCameraState, createCubeMesh, createDihedralMarkerGroup, createFace3Mesh, createPoint3Mesh, createPointDrivenLine, createSectionMesh, createSolidGroup, createSolidMesh, createUnfoldNetGroup, cubeUnfoldCenters, panCameraState, pickPrimitiveAt, pickRaycastHit3, prefersReducedMotion, resetCameraState, rotateCameraState, zoomCameraState } from "./threeScene"

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

  it("draws a closed boundary over an ordered section polygon", () => {
    const section: SectionPrimitive = {
      id: "section-1",
      type: "section",
      sourceId: "solid-1",
      plane: { normal: { x: 0, y: 0, z: 1 }, constant: 0 },
      points: [{ x: -1, y: -1, z: 0 }, { x: 1, y: -1, z: 0 }, { x: 1, y: 1, z: 0 }, { x: -1, y: 1, z: 0 }],
      classification: "polygon",
      status: "approximate"
    }

    const object = createSectionMesh(section)
    const boundary = object?.children.find((child) => child.userData.visualRole === "section-boundary") as THREE.Line | undefined

    expect(boundary).toBeTruthy()
    expect((boundary?.geometry.getAttribute("position") as THREE.BufferAttribute).count).toBe(5)

    object?.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) child.geometry.dispose()
      if ("material" in child && child.material instanceof THREE.Material) child.material.dispose()
    })
  })

  it("draws a tangent section as a segment instead of an area", () => {
    const section: SectionPrimitive = {
      id: "section-2",
      type: "section",
      sourceId: "solid-1",
      plane: { normal: { x: 1, y: 0, z: 1 }, constant: -2 },
      points: [{ x: 1, y: -1, z: 1 }, { x: 1, y: 1, z: 1 }],
      classification: "segment",
      status: "approximate"
    }

    const object = createSectionMesh(section)

    expect(object).toBeInstanceOf(THREE.Line)
    object?.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) child.geometry.dispose()
      if ("material" in child && child.material instanceof THREE.Material) child.material.dispose()
    })
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

  it("builds one pickable filled face with an outline per unfolded face", () => {
    const cubeVertices: Record<string, { x: number; y: number; z: number }> = {
      v0: { x: -1, y: -1, z: -1 }, v1: { x: 1, y: -1, z: -1 }, v2: { x: 1, y: 1, z: -1 }, v3: { x: -1, y: 1, z: -1 },
      v4: { x: -1, y: -1, z: 1 }, v5: { x: 1, y: -1, z: 1 }, v6: { x: 1, y: 1, z: 1 }, v7: { x: -1, y: 1, z: 1 }
    }
    const cubeFaces = [
      { id: "bottom", pointIds: ["v0", "v1", "v2", "v3"] },
      { id: "top", pointIds: ["v4", "v5", "v6", "v7"] },
      { id: "front", pointIds: ["v0", "v1", "v5", "v4"] },
      { id: "right", pointIds: ["v1", "v2", "v6", "v5"] },
      { id: "back", pointIds: ["v2", "v3", "v7", "v6"] },
      { id: "left", pointIds: ["v3", "v0", "v4", "v7"] }
    ]
    const layout = unfoldPolyhedron3(cubeVertices, cubeFaces, 1, "bottom")

    const group = createUnfoldNetGroup("solid-1", layout, true)
    const faces = group.children.filter((child) => child.userData.visualRole === "unfold-face")

    expect(faces).toHaveLength(6)
    expect(faces[0].userData).toMatchObject({ primitiveId: "solid-1", primitiveType: "polyhedron3" })
    expect(String(faces[0].userData.partId)).toMatch(/^unfolded-face-\d$/)
    expect(faces[0].children.some((child) => child.userData.visualRole === "unfold-face-outline")).toBe(true)

    group.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) child.geometry.dispose()
      if ("material" in child && child.material instanceof THREE.Material) child.material.dispose()
    })
  })

  it("draws the dihedral hinge, angle arc and both face normals", () => {
    const first = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }]
    const second = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 1 }, { x: 0, y: 0, z: 1 }]
    const marker = dihedralMarker3(first, second, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { radius: 0.5, arcSteps: 4 })
    if (!marker) throw new Error("expected a dihedral marker")

    const group = createDihedralMarkerGroup(marker, false)
    const roles = group.children.map((child) => child.userData.visualRole)

    expect(roles).toContain("dihedral-hinge")
    expect(roles).toContain("dihedral-arc")
    expect(roles).toContain("dihedral-normal-0")
    expect(roles).toContain("dihedral-normal-1")
    const arc = group.children.find((child) => child.userData.visualRole === "dihedral-arc") as THREE.Line
    expect((arc.geometry.getAttribute("position") as THREE.BufferAttribute).count).toBe(5)

    group.traverse((child) => {
      if (child instanceof THREE.Line) child.geometry.dispose()
      if ("material" in child && child.material instanceof THREE.Material) child.material.dispose()
    })
  })

  it("reads the platform reduced-motion preference", () => {
    const original = globalThis.matchMedia
    const stub = (matches: boolean) => ((query: string) => ({ matches, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as unknown as typeof globalThis.matchMedia
    try {
      globalThis.matchMedia = stub(true)
      expect(prefersReducedMotion()).toBe(true)
      globalThis.matchMedia = stub(false)
      expect(prefersReducedMotion()).toBe(false)
    } finally {
      if (original) globalThis.matchMedia = original
      else Reflect.deleteProperty(globalThis, "matchMedia")
    }
  })
})
