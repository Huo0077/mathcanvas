import { describe, expect, it } from "vitest"
import * as THREE from "three"

import type { GeometryDocument, Point3Primitive, PrimitiveSpec, SectionPrimitive } from "@draw/dsl"
import { createEmptyDocument } from "@draw/dsl"
import { buildSolidTemplate, circleConic3, dihedralMarker3, unfoldPolyhedron3 } from "@draw/geometry-kernel"
import { POINT_HANDLE_RADIUS_PX, pickPrimitiveAt, pickRaycastHit3, pointHandleWorldRadius, resolveSelectableHit, templateTopologyOwners } from "./threePicking"
import { applyDragOffsets, dragFamilyIds, dragWorldPoint } from "./threeDrag"
import { createCircle3Line, createConic3Line, createCubeMesh, createCurveLoops3, createDihedralMarkerGroup, createEdge3Line, createFace3Mesh, createPlane3Mesh, createPlanePatch, createPoint3Mesh, createPointDrivenLine, createSectionMesh, createSolidGroup, createSolidMesh, createUnfoldNetGroup, cubeUnfoldCenters, nextUnfoldProgress, prefersReducedMotion, sectionUnitNormal } from "./threePrimitives"
import { applyCameraState, cameraBasis, clampCameraTarget, createCameraState, fitCameraState, panCameraState, resetCameraState, rotateCameraState, zoomCameraState } from "./threeCamera"
import { sceneSyncDecision } from "./sceneContentKey"

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

  it("keeps a selected face's own fill colour and marks the selection with an outline", () => {
    const points = new Map([
      ["point-a", { id: "point-a", type: "point3" as const, position: { x: 0, y: 0, z: 0 } }],
      ["point-b", { id: "point-b", type: "point3" as const, position: { x: 2, y: 0, z: 0 } }],
      ["point-c", { id: "point-c", type: "point3" as const, position: { x: 0, y: 2, z: 0 } }]
    ])
    const face = { id: "face-abc", type: "face3" as const, pointIds: ["point-a", "point-b", "point-c"], style: { fill: "#ff0000" } }
    const mesh = createFace3Mesh(face, points, true)!

    // Selection used to overwrite the fill, so the chosen colour only appeared after deselecting.
    expect((mesh.material as THREE.MeshBasicMaterial).color.getHexString()).toBe("ff0000")
    const outline = mesh.children.find((child) => child.userData.visualRole === "face3-outline") as THREE.LineLoop | undefined
    expect(outline).toBeTruthy()
    expect((outline!.material as THREE.LineBasicMaterial).color.getHexString()).toBe("4c3ac7")

    mesh.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) object.geometry.dispose()
      if ("material" in object && object.material instanceof THREE.Material) object.material.dispose()
    })
  })

  it("keeps a selected plane's own fill colour while its outline and guides take the accent colour", () => {
    const points = new Map([
      ["p0", { id: "p0", type: "point3" as const, position: { x: 0, y: 0, z: 0 } }],
      ["p1", { id: "p1", type: "point3" as const, position: { x: 4, y: 0, z: 0 } }],
      ["p2", { id: "p2", type: "point3" as const, position: { x: 0, y: 4, z: 0 } }]
    ])
    const plane = createPlane3Mesh({ id: "plane-abc", type: "plane3", definition: { kind: "throughPoints", pointIds: ["p0", "p1", "p2"] }, style: { fill: "#ff0000" } }, points, true, 2)!

    expect((plane.material as THREE.MeshBasicMaterial).color.getHexString()).toBe("ff0000")
    const outline = plane.children.find((child) => child.userData.visualRole === "plane3-outline") as THREE.Line
    expect((outline.material as THREE.LineBasicMaterial).color.getHexString()).toBe("4c3ac7")
    const guides = plane.children.filter((child) => child.userData.visualRole === "plane3-guide") as THREE.Line[]
    expect(guides).toHaveLength(2)
    for (const guide of guides) expect((guide.material as THREE.LineBasicMaterial).color.getHexString()).toBe("4c3ac7")

    plane.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) object.geometry.dispose()
      if ("material" in object && object.material instanceof THREE.Material) object.material.dispose()
    })
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
    expect(rotated.target).toEqual(initial.target)
    expect(panned.target).not.toEqual(rotated.target)
  })

  it("pans along the camera's own axes so the figure follows the pointer after any rotation", () => {
    const facing = { azimuth: 0, elevation: 0, distance: 16, target: { x: 0, y: 0, z: 0 } }
    // Z is up: looking down -X, screen-right is +Y and screen-up is +Z, so a sideways pan must not move world X.
    expect(panCameraState(facing, 2, 0, 0).target).toEqual({ x: 0, y: 2, z: 0 })
    expect(panCameraState(facing, 0, 3, 0).target).toEqual({ x: 0, y: 0, z: 3 })
    // Depth runs along the view axis; without it a figure that is off-centre in depth can never be centred.
    expect(panCameraState(facing, 0, 0, 4).target).toEqual({ x: -4, y: 0, z: 0 })

    // After a quarter turn the same screen-space pan moves a different world axis.
    const quarterTurn = panCameraState({ ...facing, azimuth: 90 }, 2, 0, 0).target
    expect(quarterTurn.x).toBeCloseTo(-2, 10)
    expect(quarterTurn.y).toBeCloseTo(0, 10)
    expect(quarterTurn.z).toBeCloseTo(0, 10)
  })

  it("keeps the world Z axis pointing up for the orbit camera", () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)

    applyCameraState(camera, { azimuth: 0, elevation: 0, distance: 10, target: { x: 0, y: 0, z: 0 } })

    // Level with the horizon: the camera sits on +X and its up vector is world +Z, not the Three.js default +Y.
    expect(camera.position.toArray()).toEqual([10, 0, 0])
    expect(camera.up.toArray()).toEqual([0, 0, 1])
    // Tilting up must raise the camera along +Z.
    applyCameraState(camera, { azimuth: 0, elevation: 90, distance: 10, target: { x: 0, y: 0, z: 0 } })
    expect(camera.position.x).toBeCloseTo(0, 6)
    expect(camera.position.y).toBeCloseTo(0, 6)
    expect(camera.position.z).toBeCloseTo(10, 6)
  })

  it("keeps a screen-plane pan perpendicular to the view axis", () => {
    const state = { azimuth: 45, elevation: 35, distance: 16, target: { x: 0, y: 0, z: 0 } }
    const axis = panCameraState(state, 0, 0, 1).target
    const panned = panCameraState(state, 2, -3, 0).target

    expect(axis.x * panned.x + axis.y * panned.y + axis.z * panned.z).toBeCloseTo(0, 10)
  })

  it("clamps the orbit centre to a bounded range around the figure", () => {
    const bounds = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1))
    const limit = clampCameraTarget({ x: 1e6, y: 0, z: 0 }, bounds).x

    // Bounded, but still far enough out to reach every part of a figure of this size.
    expect(limit).toBeGreaterThan(3)
    expect(limit).toBeLessThan(20)
    expect(clampCameraTarget({ x: -1e6, y: 1e6, z: 0 }, bounds)).toEqual({ x: -limit, y: limit, z: 0 })
    // Anything already inside the range is left exactly where the user put it.
    expect(clampCameraTarget({ x: 0.5, y: 0, z: 0 }, bounds)).toEqual({ x: 0.5, y: 0, z: 0 })
    // With no geometry the camera falls back to a fixed neighbourhood of the origin rather than unbounded space.
    expect(Math.abs(clampCameraTarget({ x: 1e6, y: -1e6, z: 0 }, new THREE.Box3()).x)).toBeLessThanOrEqual(50)
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

  it("draws a plane at its stored half extent instead of the automatic one", () => {
    const points = new Map([
      ["p0", { id: "p0", type: "point3" as const, position: { x: 0, y: 0, z: 0 } }],
      ["p1", { id: "p1", type: "point3" as const, position: { x: 4, y: 0, z: 0 } }],
      ["p2", { id: "p2", type: "point3" as const, position: { x: 0, y: 4, z: 0 } }]
    ])
    const plane = { id: "plane-abc", type: "plane3" as const, definition: { kind: "throughPoints" as const, pointIds: ["p0", "p1", "p2"] as [string, string, string] } }
    // Reach from the patch centre to a corner is halfSize * sqrt(2) for a square patch.
    const cornerReach = (mesh: THREE.Mesh) => {
      const position = mesh.geometry.getAttribute("position")
      const corners = Array.from({ length: position.count }, (_, index) => new THREE.Vector3().fromBufferAttribute(position, index))
      const centre = corners.reduce((sum, corner) => sum.add(corner), new THREE.Vector3()).multiplyScalar(1 / corners.length)
      return corners[0].distanceTo(centre)
    }
    const dispose = (mesh: THREE.Mesh) => mesh.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) object.geometry.dispose()
      if ("material" in object && object.material instanceof THREE.Material) object.material.dispose()
    })

    const automatic = createPlane3Mesh(plane, points, false, 2)!
    const manual = createPlane3Mesh({ ...plane, halfSize: 5 }, points, false, 2)!

    // Without a stored size the patch still follows the scene it sits in.
    expect(cornerReach(automatic)).toBeCloseTo(2 * Math.SQRT2, 6)
    // A stored size wins over the automatic one; ignoring it is exactly the bug this pins.
    expect(cornerReach(manual)).toBeCloseTo(5 * Math.SQRT2, 6)

    dispose(automatic)
    dispose(manual)
  })

  it("keeps a template sub-element only when the caller asks for it", () => {
    const owners = new Map([["face-1", "cube-1"], ["edge-1", "cube-1"]])

    // Default behaviour, unchanged since P6 v3: a hit on generated topology selects the owning solid,
    // which is the only way the solid can be picked at all.
    expect(resolveSelectableHit("face-1", owners)).toBe("cube-1")
    expect(resolveSelectableHit("edge-1", owners)).toBe("cube-1")
    // Alt keeps the hit on the part itself so faces and edges stay reachable.
    expect(resolveSelectableHit("face-1", owners, true)).toBe("face-1")
    expect(resolveSelectableHit("edge-1", owners, true)).toBe("edge-1")
    expect(resolveSelectableHit(null, owners, true)).toBeNull()
  })

  it("refuses to draw a plane whose defining points are collinear", () => {    const points = new Map([
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
    // 截面网格现在是"每一环一个 Group 子项"（带孔/多环截面要求），所以边界要在子树里找。
    const boundaries: THREE.Object3D[] = []
    object?.traverse((child) => {
      if (child.userData.visualRole === "section-boundary") boundaries.push(child)
    })
    const boundary = boundaries[0] as THREE.Line | undefined

    expect(boundary).toBeTruthy()
    expect((boundary?.geometry.getAttribute("position") as THREE.BufferAttribute).count).toBe(5)
    // 单环截面只画一圈边界。
    expect(boundaries).toHaveLength(1)

    // 带孔截面：两环都要画出来，外层填充、内环只画轮廓（不覆盖孔洞）。
    const holed: SectionPrimitive = {
      ...section,
      loops: [
        [{ x: -2, y: -2, z: 0 }, { x: 2, y: -2, z: 0 }, { x: 2, y: 2, z: 0 }, { x: -2, y: 2, z: 0 }],
        [{ x: -1, y: -1, z: 0 }, { x: 1, y: -1, z: 0 }, { x: 1, y: 1, z: 0 }, { x: -1, y: 1, z: 0 }]
      ]
    }
    const holedObject = createSectionMesh(holed)
    const holedBoundaries: THREE.Object3D[] = []
    holedObject?.traverse((child) => {
      if (child.userData.visualRole === "section-boundary") holedBoundaries.push(child)
    })
    expect(holedBoundaries).toHaveLength(2)
    expect(holedObject?.userData.sectionLoopCount).toBe(2)

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

describe("free 3D drag", () => {
  /** A camera built the way applyCameraState builds one, so drag geometry is tested against the real basis. */
  function cameraFor(state = createCameraState()) {
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1000)
    applyCameraState(camera, state)
    camera.updateMatrixWorld(true)
    return camera
  }

  it("moves the figure along the camera's screen axes, not the world axes", () => {
    const camera = cameraFor({ azimuth: 0, elevation: 0, distance: 10, target: { x: 0, y: 0, z: 0 } })
    const anchor = new THREE.Vector3(0, 0, 0)

    // At azimuth 0 the camera sits on +X looking at the origin: screen-right is world +Y, screen-down is -Z
    // (Z is the up axis). A drag that only changed world X would be the old world-axis bug all over again.
    expect(dragWorldPoint(camera, anchor, { x: 0.6, y: 0.5 })!.y).toBeGreaterThan(0.5)
    expect(dragWorldPoint(camera, anchor, { x: 0.5, y: 0.6 })!.z).toBeLessThan(-0.5)
    // The dragged figure stays in the plane it was grabbed in, so it cannot slide towards the camera.
    expect(dragWorldPoint(camera, anchor, { x: 0.6, y: 0.6 })!.x).toBeCloseTo(0, 10)
  })

  it("turns the drag direction with the camera", () => {
    const anchor = new THREE.Vector3(0, 0, 0)
    const forward = dragWorldPoint(cameraFor({ azimuth: 0, elevation: 0, distance: 10, target: { x: 0, y: 0, z: 0 } }), anchor, { x: 0.7, y: 0.5 })!
    const turned = dragWorldPoint(cameraFor({ azimuth: 90, elevation: 0, distance: 10, target: { x: 0, y: 0, z: 0 } }), anchor, { x: 0.7, y: 0.5 })!

    // A camera turned 90° about Z makes screen-right world -X instead of +Y.
    expect(forward.y).toBeGreaterThan(0.5)
    expect(Math.abs(forward.x)).toBeLessThan(0.01)
    expect(turned.x).toBeLessThan(-0.5)
  })

  it("maps the same pointer position to the same world point and no movement for no movement", () => {
    const camera = cameraFor()
    const anchor = new THREE.Vector3(1, 2, 3)
    const basis = cameraBasis(createCameraState())

    // The screen centre is not the anchor: the plane through the anchor is only met where the ray crosses it.
    // What matters is that an unchanged pointer produces an unchanged point, which is what "not moved" means.
    const first = dragWorldPoint(camera, anchor, { x: 0.5, y: 0.5 })!
    const again = dragWorldPoint(camera, anchor, { x: 0.5, y: 0.5 })!
    expect(again.clone().sub(first).length()).toBeLessThan(1e-12)

    // Sweeping the pointer across the screen slides the grabbed point along the screen plane, in order.
    const along = (x: number) => dragWorldPoint(camera, anchor, { x, y: 0.5 })!.clone().sub(first).dot(basis.right)
    expect(along(0.6) - along(0.4)).toBeGreaterThan(0)
    expect(along(0.7) - along(0.6)).toBeGreaterThan(0)
  })

  it("carries a template solid's generated topology with it", () => {
    const cube = { id: "cube-1", type: "cube" as const, origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }
    const document: GeometryDocument = { ...createEmptyDocument("geometry3d"), primitives: [cube, ...buildSolidTemplate(cube).primitives] }
    const topology = document.primitives.find((primitive) => primitive.type === "polyhedron3") as { vertexIds: string[]; edgeIds: string[]; faceIds: string[] }

    const family = dragFamilyIds(document, "cube-1")

    // The solid is drawn through its children, so a drag that misses one of them would look like nothing moved.
    expect(family.has("cube-1")).toBe(true)
    for (const childId of [...topology.vertexIds, ...topology.edgeIds, ...topology.faceIds]) expect(family.has(childId)).toBe(true)
  })

  it("carries a point-driven line's endpoints with it", () => {
    const document: GeometryDocument = {
      ...createEmptyDocument("geometry3d"),
      primitives: [
        { id: "p-a", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "free" } },
        { id: "p-b", type: "point3", position: { x: 2, y: 0, z: 0 }, binding: { kind: "free" } },
        { id: "p-c", type: "point3", position: { x: 0, y: 2, z: 0 }, binding: { kind: "free" } },
        { id: "line-ab", type: "line3", definition: { kind: "throughPoints", pointIds: ["p-a", "p-b"] } },
        { id: "face-abc", type: "face3", pointIds: ["p-a", "p-b", "p-c"] },
        { id: "unrelated", type: "point3", position: { x: 9, y: 9, z: 9 }, binding: { kind: "free" } }
      ]
    }

    const family = dragFamilyIds(document, "line-ab")

    // The line's own endpoints move; the face that shares two of them is a separate object and stays put.
    expect([...family].sort()).toEqual(["line-ab", "p-a", "p-b"])
    expect(family.has("unrelated")).toBe(false)
  })

  it("moves only the family members and can be undone", () => {
    const scene = new THREE.Scene()
    const solid = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
    solid.userData.primitiveId = "cube-1"
    const generated = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
    generated.userData.primitiveId = "cube-1-point-1"
    generated.position.set(1, 0, 0)
    const other = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
    other.userData.primitiveId = "ball-1"
    scene.add(solid, generated, other)

    applyDragOffsets(scene, new Set(["cube-1", "cube-1-point-1"]), new THREE.Vector3(1, 0, 0))
    applyDragOffsets(scene, new Set(["cube-1", "cube-1-point-1"]), new THREE.Vector3(0, 2, 0))

    expect(solid.position.toArray()).toEqual([1, 2, 0])
    expect(generated.position.toArray()).toEqual([2, 2, 0])
    expect(other.position.toArray()).toEqual([0, 0, 0])

    // Drawing the same delta backwards hands the picture back to the document without rebuilding the scene.
    applyDragOffsets(scene, new Set(["cube-1", "cube-1-point-1"]), new THREE.Vector3(-1, -2, 0))
    expect(solid.position.toArray()).toEqual([0, 0, 0])
    expect(generated.position.toArray()).toEqual([1, 0, 0])

    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose()
        ;(object.material as THREE.Material).dispose()
      }
    })
  })

  it("describes the drag direction with the camera basis the scene already pans along", () => {
    const basis = cameraBasis({ azimuth: 45, elevation: 30, distance: 16, target: { x: 0, y: 0, z: 0 } })

    expect(basis.right.length()).toBeCloseTo(1, 10)
    expect(basis.up.length()).toBeCloseTo(1, 10)
    expect(basis.right.dot(basis.up)).toBeCloseTo(0, 10)
    expect(basis.up.dot(basis.forward)).toBeCloseTo(0, 10)
  })
})

describe("section cutting plane", () => {
  const dispose = (object: THREE.Object3D) => {
    object.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) child.geometry.dispose()
      if ("material" in child && child.material instanceof THREE.Material) child.material.dispose()
    })
  }
  /** A cube spanning -1..1: its horizontal cut is a 2x2 square. */
  const cubeVertices = [
    { x: -1, y: -1, z: -1 }, { x: 1, y: -1, z: -1 }, { x: 1, y: 1, z: -1 }, { x: -1, y: 1, z: -1 },
    { x: -1, y: -1, z: 1 }, { x: 1, y: -1, z: 1 }, { x: 1, y: 1, z: 1 }, { x: -1, y: 1, z: 1 }
  ]
  const horizontal = { normal: { x: 0, y: 1, z: 0 }, constant: 0 }

  it("normalises a cutting plane's normal and refuses a degenerate one", () => {
    const unit = sectionUnitNormal({ x: 0, y: 3, z: 4 })!
    // Normalising is float arithmetic: compare numerically, not by exact component equality.
    expect(unit.length()).toBeCloseTo(1, 12)
    expect(unit.y).toBeCloseTo(0.6, 12)
    expect(unit.z).toBeCloseTo(0.8, 12)
    expect(sectionUnitNormal({ x: 0, y: 0, z: 0 })).toBeNull()
    expect(sectionUnitNormal({ x: Number.NaN, y: 1, z: 0 })).toBeNull()
  })

  it("draws the plane as a patch that covers the solid it cuts", () => {
    const patch = createPlanePatch(horizontal, cubeVertices, { color: "#f97316", opacity: 0.1 })
    expect(patch).toBeTruthy()
    const face = patch!.children.find((child) => child.userData.visualRole === "section-plane-patch-face") as THREE.Mesh
    patch!.updateMatrixWorld(true)

    // Every corner of the patch sits in the cutting plane (y = 0) and reaches past the cube's own footprint.
    const positions = face.geometry.getAttribute("position")
    const corners = Array.from({ length: positions.count }, (_, index) => new THREE.Vector3().fromBufferAttribute(positions, index))
    for (const corner of corners) expect(corner.y).toBeCloseTo(0, 10)
    expect(Math.max(...corners.map((corner) => Math.hypot(corner.x, corner.z)))).toBeGreaterThan(Math.hypot(1, 1))
    dispose(patch!)
  })

  it("draws nothing for a plane with no usable normal", () => {
    expect(createPlanePatch({ normal: { x: 0, y: 0, z: 0 }, constant: 1 }, cubeVertices, { color: "#f97316", opacity: 0.1 })).toBeNull()
  })

  it("keeps the patch centred on the plane's own origin, not the solid's", () => {
    // The same plane moved up by 1: the patch has to move with it, or it would point at the wrong cut.
    const lifted = createPlanePatch({ normal: { x: 0, y: 1, z: 0 }, constant: -1 }, cubeVertices, { color: "#f97316", opacity: 0.1 })!
    const face = lifted.children.find((child) => child.userData.visualRole === "section-plane-patch-face") as THREE.Mesh
    const positions = face.geometry.getAttribute("position")

    for (let index = 0; index < positions.count; index += 1) expect(positions.getY(index)).toBeCloseTo(1, 10)
    dispose(lifted)
  })
})

describe("scene sync decision", () => {
  /**
   * 这条纯函数决定"内容签名变化时要不要重新同步场景内容"。
   * 它必须跳过重复同步（否则每次父组件重渲染都会重建全部几何），
   * 但首次与任何变化都必须同步。
   */
  it("skips the sync when the content signature is unchanged", () => {
    expect(sceneSyncDecision("geometry3d-1|1|", "geometry3d-1|1|")).toBe(false)
  })

  it("syncs on the first run and on any change", () => {
    expect(sceneSyncDecision(null, "geometry3d-1|1|")).toBe(true)
    expect(sceneSyncDecision("geometry3d-1|1|", "geometry3d-1|2|")).toBe(true)
  })
})

/**
 * A1 第 3 片：解析曲线的渲染。
 *
 * 用户口径："我不要一个逼近的圆，我需要一个真的圆。" 曲线本身是解析的，只有"画出来"这一步要离散化——
 * 段数由屏幕误差决定，所以放大时点会变多，而不是把 48 段的棱一起放大。
 */
describe("exact curve rendering", () => {
  const circleConic = () => circleConic3({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }, 2)!
  const countRole = (root: { traverse: (callback: (object: { userData: Record<string, unknown> }) => void) => void }, role: string) => {
    let count = 0
    root.traverse((object) => { if (object.userData.visualRole === role) count += 1 })
    return count
  }

  it("samples an exact circle from the tolerance and re-samples when the tolerance tightens", () => {
    const loose = createConic3Line("circle3-1", circleConic(), 0.01, false)!
    const tight = createConic3Line("circle3-1", circleConic(), 0.001, false)!

    expect(loose.userData.visualRole).toBe("exact-curve")
    expect(loose.userData.segmentCount).toBe(32)                       // R=2、tol=0.01
    expect(tight.userData.segmentCount).toBeGreaterThan(loose.userData.segmentCount)
    expect(loose.userData.primitiveId).toBe("circle3-1")
    // 半径非有限的圆不画，而不是画一个假的。
    expect(createConic3Line("bad", { ...circleConic(), semiMajor: 0 }, 0.01, false)).toBeNull()
  })

  it("draws every loop of an exact section boundary and closes it", () => {
    const conic = circleConic()
    const loops = [[{ kind: "conic" as const, conic, parameterRange: [0, Math.PI] as [number, number] }], [{ kind: "segment" as const, a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 } }]]
    const group = createCurveLoops3("section-1", loops, 0.01, false)!

    expect(group.userData.primitiveId).toBe("section-1")
    expect(group.userData.segmentCount).toBeGreaterThan(0)
    expect(countRole(group, "exact-curve")).toBe(2)
    // 空环不给对象（不编一条零长度的线）。
    expect(createCurveLoops3("section-2", [], 0.01, false)).toBeNull()
  })

  it("hands the section boundary to the exact curve instead of the polygon chords", () => {
    const section = {
      id: "section-1", type: "section" as const, sourceId: "cylinder-1",
      plane: { normal: { x: 0, y: 0, z: 1 }, constant: -1 },
      points: [{ x: 2, y: 0, z: 1 }, { x: 0, y: 2, z: 1 }, { x: -2, y: 0, z: 1 }, { x: 0, y: -2, z: 1 }],
      loops: [[{ x: 2, y: 0, z: 1 }, { x: 0, y: 2, z: 1 }, { x: -2, y: 0, z: 1 }, { x: 0, y: -2, z: 1 }]],
      classification: "polygon" as const, status: "exact" as const,
      exact: { kind: "circle" as const, loops: [[{ kind: "conic" as const, conic: circleConic(), parameterRange: [0, Math.PI * 2] as [number, number] }]] }
    }

    const withChords = createSectionMesh(section)!
    const exactOnly = createSectionMesh(section, { omitBoundary: true })!

    expect(countRole(withChords, "section-boundary")).toBe(1)
    expect(countRole(exactOnly, "section-boundary")).toBe(0)   // 边界交给真曲线，不留一圈弦
  })

  it("renders a document circle3 as a true curve", () => {
    const points = new Map([["point-a", { id: "point-a", type: "point3" as const, position: { x: 0, y: 0, z: 0 } }]])
    const line = createCircle3Line({ id: "circle3-1", type: "circle3", centerId: "point-a", normal: { x: 0, y: 0, z: 1 }, radius: 1 }, points, 0.01, false)!

    expect(line.userData.visualRole).toBe("exact-curve")
    expect(line.userData.primitiveType).toBe("circle3")
    expect(line.userData.segmentCount).toBeGreaterThanOrEqual(16)
    // 圆心点不存在时如实不画。
    expect(createCircle3Line({ id: "circle3-2", type: "circle3", centerId: "missing", normal: { x: 0, y: 0, z: 1 }, radius: 1 }, points, 0.01, false)).toBeNull()
  })
})
