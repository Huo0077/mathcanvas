import { describe, expect, it } from "vitest"
import * as THREE from "three"

import type { GeometryDocument, Point3Primitive, PrimitiveSpec, SectionPrimitive } from "@draw/dsl"
import { createEmptyDocument } from "@draw/dsl"
import { buildSolidTemplate, dihedralMarker3, unfoldPolyhedron3 } from "@draw/geometry-kernel"

import { POINT_HANDLE_RADIUS_PX, createCameraState, createCubeMesh, createDihedralMarkerGroup, createEdge3Line, createFace3Mesh, createPlane3Mesh, createPoint3Mesh, createPointDrivenLine, createSectionMesh, createSolidGroup, createSolidMesh, createUnfoldNetGroup, cubeUnfoldCenters, fitCameraState, nextUnfoldProgress, panCameraState, pickPrimitiveAt, pickRaycastHit3, pointHandleWorldRadius, prefersReducedMotion, resetCameraState, resolveSelectableHit, rotateCameraState, templateTopologyOwners, zoomCameraState } from "./threeScene"

describe("Three.js geometry scene", () => {
  it("converges an unfold animation to its target within a short render window", () => {
    let progress = 0
    for (let frame = 0; frame < 8; frame += 1) progress = nextUnfoldProgress(progress, 1)

    expect(progress).toBe(1)
  })

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

  it("sizes a vertex handle in world units but keeps it constant on screen", () => {
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1000)
    const handle = createPoint3Mesh({ id: "point-handle", type: "point3", position: { x: 0, y: 0, z: 0 } }, false, 0.25)

    expect((handle.geometry as THREE.SphereGeometry).parameters.radius).toBe(1)
    expect(handle.scale.x).toBeCloseTo(0.25, 6)

    // Doubling the distance must double the world radius so the handle covers the same pixels.
    const near = pointHandleWorldRadius(camera, 8, 400)
    const far = pointHandleWorldRadius(camera, 16, 400)
    expect(far / near).toBeCloseTo(2, 6)

    // The projected diameter matches the requested pixel size.
    const worldPerPixel = 2 * 8 * Math.tan((42 * Math.PI / 180) / 2) / 400
    expect((near * 2) / worldPerPixel).toBeCloseTo(POINT_HANDLE_RADIUS_PX * 2, 6)
  })

  it("hands the click to the surface under the cursor instead of an object on the far side", () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    camera.position.set(0, 0, 8)
    camera.lookAt(0, 0, 0)
    const scene = new THREE.Scene()
    const points = new Map([["p0", { id: "p0", type: "point3" as const, position: { x: -1, y: -1, z: 0 } }], ["p1", { id: "p1", type: "point3" as const, position: { x: 1, y: -1, z: 0 } }], ["p2", { id: "p2", type: "point3" as const, position: { x: 1, y: 1, z: 0 } }], ["p3", { id: "p3", type: "point3" as const, position: { x: -1, y: 1, z: 0 } }]])
    const face = createFace3Mesh({ id: "face-front", type: "face3", pointIds: ["p0", "p1", "p2", "p3"] }, points, false)!
    // A handle four units behind the face must not win just because it is a point.
    const behind = createPoint3Mesh({ id: "point-behind", type: "point3", position: { x: 0, y: 0, z: -4 } }, false, 0.05)
    scene.add(face, behind)

    const hit = pickRaycastHit3(scene, camera, { x: 0.5, y: 0.5 })

    expect(hit?.primitiveId).toBe("face-front")
    expect(hit?.kind).toBe("face")

    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose()
      if (object instanceof THREE.Mesh && object.material instanceof THREE.Material) object.material.dispose()
    })
  })

  it("still lets a handle that sits on a surface win the click", () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    camera.position.set(0, 0, 8)
    camera.lookAt(0, 0, 0)
    const points = new Map([["p0", { id: "p0", type: "point3" as const, position: { x: -1, y: -1, z: 0 } }], ["p1", { id: "p1", type: "point3" as const, position: { x: 1, y: -1, z: 0 } }], ["p2", { id: "p2", type: "point3" as const, position: { x: 1, y: 1, z: 0 } }], ["p3", { id: "p3", type: "point3" as const, position: { x: -1, y: 1, z: 0 } }]])
    const build = () => {
      const scene = new THREE.Scene()
      const face = createFace3Mesh({ id: "face-front", type: "face3", pointIds: ["p0", "p1", "p2", "p3"] }, points, false)!
      // Sunk slightly behind the face, the way a solid's vertex handle sits inside its own surface.
      const sunk = createPoint3Mesh({ id: "point-sunk", type: "point3", position: { x: 0, y: 0, z: -0.2 } }, false, 0.05)
      scene.add(face, sunk)
      return scene
    }
    const dispose = (scene: THREE.Scene) => scene.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose()
      if (object instanceof THREE.Mesh && object.material instanceof THREE.Material) object.material.dispose()
    })

    const tight = build()
    expect(pickRaycastHit3(tight, camera, { x: 0.5, y: 0.5 }, { tolerance: 0.01 })?.primitiveId).toBe("face-front")
    dispose(tight)

    // The screen-space allowance is what makes a small handle grabbable through its own surface.
    const forgiving = build()
    expect(pickRaycastHit3(forgiving, camera, { x: 0.5, y: 0.5 }, { tolerance: 0.3 })?.primitiveId).toBe("point-sunk")
    dispose(forgiving)
  })

  it("does not let a line the cursor never touched steal the click", () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    camera.position.set(0, 0, 8)
    camera.lookAt(0, 0, 0)
    const points = new Map([
      ["l0", { id: "l0", type: "point3" as const, position: { x: 0.5, y: -1, z: 0 } }],
      ["l1", { id: "l1", type: "point3" as const, position: { x: 0.5, y: 1, z: 0 } }],
      ["p0", { id: "p0", type: "point3" as const, position: { x: -1, y: -1, z: 0 } }],
      ["p1", { id: "p1", type: "point3" as const, position: { x: 1, y: -1, z: 0 } }],
      ["p2", { id: "p2", type: "point3" as const, position: { x: 1, y: 1, z: 0 } }],
      ["p3", { id: "p3", type: "point3" as const, position: { x: -1, y: 1, z: 0 } }]
    ])
    const scene = new THREE.Scene()
    const face = createFace3Mesh({ id: "face-front", type: "face3", pointIds: ["p0", "p1", "p2", "p3"] }, points, false)!
    const line = createPointDrivenLine({ id: "line-3d", type: "line3", definition: { kind: "throughPoints", pointIds: ["l0", "l1"] } }, points, false)!
    scene.add(face, line)

    // three.js defaults the line grab distance to a whole world unit, which is how an untouched edge used to win.
    expect(pickRaycastHit3(scene, camera, { x: 0.5, y: 0.5 }, { tolerance: 0.04 })?.primitiveId).toBe("face-front")
    expect(pickRaycastHit3(scene, camera, { x: 0.5, y: 0.5 }, { tolerance: 1 })?.primitiveId).toBe("line-3d")

    scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) object.geometry.dispose()
      if ("material" in object && object.material instanceof THREE.Material) object.material.dispose()
    })
  })

  it("draws a finite, pickable plane through its three defining points", () => {
    const points = new Map([
      ["p0", { id: "p0", type: "point3" as const, position: { x: 0, y: 0, z: 0 } }],
      ["p1", { id: "p1", type: "point3" as const, position: { x: 4, y: 0, z: 0 } }],
      ["p2", { id: "p2", type: "point3" as const, position: { x: 0, y: 4, z: 0 } }]
    ])
    const plane = createPlane3Mesh({ id: "plane-abc", type: "plane3", definition: { kind: "throughPoints", pointIds: ["p0", "p1", "p2"] } }, points, false, 2)

    expect(plane).toBeTruthy()
    expect(plane?.userData).toMatchObject({ primitiveId: "plane-abc", primitiveType: "plane3" })
    // A plane is infinite; what is drawn is a bounded quad centred on the defining points.
    const position = plane!.geometry.getAttribute("position") as THREE.BufferAttribute
    const corners = Array.from({ length: position.count }, (_, index) => new THREE.Vector3().fromBufferAttribute(position, index))
    for (const corner of corners) expect(Math.abs(corner.z)).toBeLessThan(1e-6)
    expect(Math.max(...corners.map((corner) => corner.x)) - Math.min(...corners.map((corner) => corner.x))).toBeCloseTo(4, 5)
    expect(corners.reduce((sum, corner) => sum + corner.x, 0) / corners.length).toBeCloseTo(4 / 3, 5)
    // The plane must be hittable, otherwise it stays decorative.
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    camera.position.set(4 / 3, 4 / 3, 12)
    camera.lookAt(4 / 3, 4 / 3, 0)
    const scene = new THREE.Scene()
    scene.add(plane!)
    expect(pickPrimitiveAt(scene, camera, { x: 0.5, y: 0.5 })).toBe("plane-abc")

    scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) object.geometry.dispose()
      if ("material" in object && object.material instanceof THREE.Material) object.material.dispose()
    })
  })

  it("refuses to draw a plane whose defining points are collinear", () => {
    const points = new Map([
      ["p0", { id: "p0", type: "point3" as const, position: { x: 0, y: 0, z: 0 } }],
      ["p1", { id: "p1", type: "point3" as const, position: { x: 1, y: 0, z: 0 } }],
      ["p2", { id: "p2", type: "point3" as const, position: { x: 2, y: 0, z: 0 } }]
    ])

    expect(createPlane3Mesh({ id: "plane-degenerate", type: "plane3", definition: { kind: "throughPoints", pointIds: ["p0", "p1", "p2"] } }, points, false, 2)).toBeNull()
  })

  it("frames a figure by moving the target and pulling back, keeping the viewing angles", () => {
    const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 1000)
    const bounds = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1))
    const fitted = fitCameraState({ azimuth: 45, elevation: 30, distance: 16, target: { x: 0, y: 0, z: 0 } }, bounds, camera)

    expect(fitted.azimuth).toBe(45)
    expect(fitted.elevation).toBe(30)
    expect(fitted.target).toEqual({ x: 0.5, y: 0.5, z: 0.5 })

    // Every corner of the box must land inside the frustum at the fitted distance.
    const distance = fitted.distance
    const cameraAtFitted = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 1000)
    const horizontal = distance * Math.cos(30 * Math.PI / 180)
    cameraAtFitted.position.set(fitted.target.x + horizontal * Math.cos(Math.PI / 4), fitted.target.y + distance * Math.sin(30 * Math.PI / 180), fitted.target.z + horizontal * Math.sin(Math.PI / 4))
    cameraAtFitted.lookAt(fitted.target.x, fitted.target.y, fitted.target.z)
    cameraAtFitted.updateMatrixWorld(true)
    cameraAtFitted.updateProjectionMatrix()
    for (const corner of [new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1), new THREE.Vector3(1, 0, 1), new THREE.Vector3(0, 1, 0)]) {
      const projected = corner.clone().project(cameraAtFitted)
      expect(Math.abs(projected.x)).toBeLessThan(1)
      expect(Math.abs(projected.y)).toBeLessThan(1)
    }

    // An empty scene falls back to the default view instead of collapsing the camera.
    expect(fitCameraState(createCameraState(), new THREE.Box3(), camera).distance).toBe(createCameraState().distance)
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

  it("hands a click on a template solid's derived edge or face to the owning solid", () => {
    const cube: Extract<PrimitiveSpec, { type: "cube" }> = { id: "cube-1", type: "cube", origin: { x: -2, y: -2, z: -1 }, size: { x: 4, y: 4, z: 2 }, label: "立方体 1" }
    const built = buildSolidTemplate(cube)
    const document: GeometryDocument = { ...createEmptyDocument("geometry3d"), primitives: [cube, ...built.primitives] }
    const owners = templateTopologyOwners(document)

    // Every derived edge and face belongs to the solid, so clicking the body selects the editable object.
    expect(built.edgeIds).toHaveLength(12)
    expect(built.faceIds).toHaveLength(6)
    expect(owners.size).toBe(18)
    for (const childId of [...built.edgeIds, ...built.faceIds]) expect(owners.get(childId)).toBe("cube-1")

    // Generated vertices stay directly selectable: dragging one is how a template solid becomes point-driven.
    for (const vertexId of built.vertexIds) expect(owners.has(vertexId)).toBe(false)

    expect(resolveSelectableHit(built.edgeIds[0], owners)).toBe("cube-1")
    expect(resolveSelectableHit(built.vertexIds[0], owners)).toBe(built.vertexIds[0])
    expect(resolveSelectableHit("face-user", owners)).toBe("face-user")
    expect(resolveSelectableHit(null, owners)).toBeNull()
  })

  it("resolves a raycast on a template solid's surface to the solid itself", () => {
    const cube: Extract<PrimitiveSpec, { type: "cube" }> = { id: "cube-1", type: "cube", origin: { x: -2, y: -2, z: -1 }, size: { x: 4, y: 4, z: 2 }, label: "立方体 1" }
    const built = buildSolidTemplate(cube)
    const document: GeometryDocument = { ...createEmptyDocument("geometry3d"), primitives: [cube, ...built.primitives] }
    const owners = templateTopologyOwners(document)
    const points = new Map(document.primitives.filter((primitive): primitive is Point3Primitive => primitive.type === "point3").map((primitive) => [primitive.id, primitive]))
    const scene = new THREE.Scene()
    // Mirror what ThreeSceneView draws for a template solid: the topology children, never the solid itself.
    for (const primitive of document.primitives) {
      if (primitive.type === "face3") {
        const face = createFace3Mesh(primitive, points, false)
        if (face) scene.add(face)
      }
      if (primitive.type === "edge3") {
        const edge = createEdge3Line(primitive, points, false)
        if (edge) scene.add(edge)
      }
    }
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    camera.position.set(0, 0, 12)
    camera.lookAt(0, 0, 0)

    const rawHit = pickPrimitiveAt(scene, camera, { x: 0.5, y: 0.5 })

    expect(rawHit).not.toBe("cube-1")
    expect(resolveSelectableHit(rawHit, owners)).toBe("cube-1")

    scene.traverse((child) => {
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
