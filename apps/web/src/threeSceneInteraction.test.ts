import * as THREE from "three"
import { buildSolidTemplate } from "@draw/geometry-kernel"
import { describe, expect, it, vi } from "vitest"
import { createEmptyDocument } from "@draw/dsl"
import type { GeometryDocument, Point3Primitive, Segment3Primitive, Line3Primitive, Ray3Primitive } from "@draw/dsl"
import { createThreeSceneInteraction } from "./threeSceneInteraction"
import { pointHandleWorldRadius, PICK_TOLERANCE_PX } from "./threePicking"
import { createPoint3Mesh } from "./threePrimitives"
import { dragWorldPoint } from "./threeDrag"

import { dragPreviewDocument } from "./threeDragPreview"
import type { DragSessionState } from "./threeSceneEffect"

function previewCallbacks(documentRef: { current: GeometryDocument }, points: Map<string, Point3Primitive>) {
  const sync = (doc: GeometryDocument) => {
    points.clear()
    for (const p of doc.primitives) if (p.type === "point3") points.set(p.id, p)
  }
  return {
    previewDrag: (session: DragSessionState) => sync(dragPreviewDocument(documentRef.current, session)),
    clearDragPreview: () => sync(documentRef.current)
  }
}


describe("threeSceneInteraction bound point dragging", () => {
  it.each(["segment", "line", "ray"] as const)("allows direct left-click drag on a bound point along a host %s", (kind) => {
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)

    const p1: Point3Primitive = { id: "p1", type: "point3", position: { x: -2, y: 0, z: 0 } }
    const p2: Point3Primitive = { id: "p2", type: "point3", position: { x: 2, y: 0, z: 0 } }
    const segment: Segment3Primitive | Line3Primitive | Ray3Primitive = kind === "line"
      ? { id: "segment-1", type: "line3", definition: { kind: "throughPoints", pointIds: ["p1", "p2"] } }
      : kind === "ray"
        ? { id: "segment-1", type: "ray3", originId: "p1", throughId: "p2" }
        : { id: "segment-1", type: "segment3", pointIds: ["p1", "p2"] }
    const mover: Point3Primitive = {
      id: "mover",
      type: "point3",
      position: { x: 0, y: 0, z: 0 },
      binding: { kind: "onHost", hostId: "segment-1", parameter: 0.5 }
    }

    const doc: GeometryDocument = {
      ...createEmptyDocument("geometry3d"),
      primitives: [p1, p2, segment, mover]
    }

    const points = new Map<string, Point3Primitive>([
      ["p1", p1],
      ["p2", p2],
      ["mover", mover]
    ])

    const moverMesh = createPoint3Mesh(mover, false, 0.05)
    scene.add(moverMesh)

    const domElement = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }),
      setPointerCapture: () => {},
      releasePointerCapture: () => {}
    } as unknown as HTMLCanvasElement

    const renderer = {
      domElement,
      render: () => {}
    } as unknown as THREE.WebGLRenderer

    const documentRef = { current: doc }
    const selectedIdsRef = { current: [] as string[] }
    const dragModeRef = { current: false }
    const panModeRef = { current: false }
    const pointerStateRef = { current: null as any }
    const dragSessionRef = { current: null as any }
    const cameraStateRef = { current: { azimuth: 0, elevation: 0, distance: 10, target: { x: 0, y: 0, z: 0 } } }
    const topologyOwners = new Map<string, string>()

    let lastHostDragEnd: { id: string; parameter: any } | null = null

    const render = vi.fn()
    const interaction = createThreeSceneInteraction({
      cameraStateRef,
      panModeRef,
      dragModeRef,
      pointerStateRef,
      dragSessionRef,
      selectedIdsRef,
      dragEndRef: { current: undefined },
      moveSectionRef: { current: undefined },
      hostDragEndRef: { current: (id, parameter) => { lastHostDragEnd = { id, parameter } } },
      rotateEndRef: { current: undefined },
      trackRadiusEndRef: { current: undefined },
      rotationHandleRef: { current: null },
      trackRadiusHandleRef: { current: null },
      circleRadiusPreviewRef: { current: null },
      pickSectionFaceRef: { current: undefined },
      documentRef,
      setFacePickMode: () => {},
      facePickModeRef: { current: false },
      onSelectRef: { current: () => {} },
      previewClickRef: { current: undefined },
      scene,
      camera,
      renderer,
      sceneShell: null,
      sceneBounds: new THREE.Box3(),
      points,
      topologyOwners,
      ...previewCallbacks(documentRef, points),
      render,
      pickTolerance: () => pointHandleWorldRadius(camera, cameraStateRef.current.distance, 800, PICK_TOLERANCE_PX),
      dragDeltaFor: (session, pt) => {
        const current = dragWorldPoint(camera, session.anchor, pt)
        return current ? current.sub(session.origin) : null
      },
      setCameraState: () => {},
      pointFromEvent: (event) => ({ x: event.clientX / 800, y: event.clientY / 800 }),
      raycasterAt: (pt) => {
        const r = new THREE.Raycaster()
        r.setFromCamera(new THREE.Vector2(pt.x * 2 - 1, -(pt.y * 2 - 1)), camera)
        return r
      },
      previewHitAt: () => ({ hovering: false, depth: null, preview: null })
    })

    // PointerDown at center (400, 400)
    interaction.handlePointerDown({
      pointerId: 1,
      button: 0,
      clientX: 400,
      clientY: 400,
      preventDefault: () => {}
    } as any)

    expect(dragSessionRef.current).not.toBeNull()
    expect(dragSessionRef.current.targetId).toBe("mover")
    expect(dragSessionRef.current.hostConstraint).toBeDefined()

    // PointerMove to (450, 400)
    interaction.handlePointerMove({
      pointerId: 1,
      clientX: 450,
      clientY: 400
    } as any)

    expect(dragSessionRef.current.applied).toBe(true)
    const currentPos = points.get("mover")!.position
    expect(currentPos.x).toBeGreaterThan(0)
    expect(dragSessionRef.current.reactiveHost.graph.diagnostics()).toEqual([])

    // A spatial line/ray must remain draggable past the defining second point;
    // only a segment clamps to that endpoint.
    interaction.handlePointerMove({ pointerId: 1, clientX: 750, clientY: 400 } as any)
    if (kind === "segment") expect(points.get("mover")!.position.x).toBeCloseTo(2, 8)
    else expect(points.get("mover")!.position.x).toBeGreaterThan(2)

    // This callback deliberately does not commit a document. A refused/no-op
    // commit must still repaint the restored canonical geometry on the next frame.
    render.mockClear()
    let repaint: FrameRequestCallback | undefined
    const schedule = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(callback => { repaint = callback; return 1 })
    try {
      interaction.handlePointerUp({ pointerId: 1, clientX: 450, clientY: 400 } as any)
      expect(schedule).toHaveBeenCalledOnce()
      expect(render).not.toHaveBeenCalled()
      expect(points.get("mover")!.position).toEqual(mover.position)
      repaint!(0)
      expect(render).toHaveBeenCalledOnce()
    } finally { schedule.mockRestore() }

    expect(lastHostDragEnd).not.toBeNull()
    expect(lastHostDragEnd!.id).toBe("mover")
    expect(lastHostDragEnd!.parameter.u).toBeGreaterThan(0.5)
  })

  it("fails or succeeds when pointer is 6px or 8px away from handle", () => {
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)

    const p1: Point3Primitive = { id: "p1", type: "point3", position: { x: -2, y: 0, z: 0 } }
    const p2: Point3Primitive = { id: "p2", type: "point3", position: { x: 2, y: 0, z: 0 } }
    const segment: Segment3Primitive = {
      id: "segment-1",
      type: "segment3",
      pointIds: ["p1", "p2"],
      style: { stroke: "#000" }
    }
    const mover: Point3Primitive = {
      id: "mover",
      type: "point3",
      position: { x: 0, y: 0, z: 0 },
      binding: { kind: "onHost", hostId: "segment-1", parameter: 0.5 }
    }

    const doc: GeometryDocument = {
      ...createEmptyDocument("geometry3d"),
      primitives: [p1, p2, segment, mover]
    }

    const points = new Map<string, Point3Primitive>([
      ["p1", p1],
      ["p2", p2],
      ["mover", mover]
    ])

    const moverMesh = createPoint3Mesh(mover, false, 0.05)
    scene.add(moverMesh)

    const domElement = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }),
      setPointerCapture: () => {},
      releasePointerCapture: () => {}
    } as unknown as HTMLCanvasElement

    const renderer = {
      domElement,
      render: () => {}
    } as unknown as THREE.WebGLRenderer

    const documentRef = { current: doc }
    const selectedIdsRef = { current: [] as string[] }
    const dragModeRef = { current: false }
    const panModeRef = { current: false }
    const pointerStateRef = { current: null as any }
    const dragSessionRef = { current: null as any }
    const cameraStateRef = { current: { azimuth: 0, elevation: 0, distance: 10, target: { x: 0, y: 0, z: 0 } } }
    const topologyOwners = new Map<string, string>()

    const interaction = createThreeSceneInteraction({
      cameraStateRef,
      panModeRef,
      dragModeRef,
      pointerStateRef,
      dragSessionRef,
      selectedIdsRef,
      dragEndRef: { current: undefined },
      moveSectionRef: { current: undefined },
      hostDragEndRef: { current: () => {} },
      rotateEndRef: { current: undefined },
      trackRadiusEndRef: { current: undefined },
      rotationHandleRef: { current: null },
      trackRadiusHandleRef: { current: null },
      circleRadiusPreviewRef: { current: null },
      pickSectionFaceRef: { current: undefined },
      documentRef,
      setFacePickMode: () => {},
      facePickModeRef: { current: false },
      onSelectRef: { current: () => {} },
      previewClickRef: { current: undefined },
      scene,
      camera,
      renderer,
      sceneShell: null,
      sceneBounds: new THREE.Box3(),
      points,
      topologyOwners,
      ...previewCallbacks(documentRef, points),
      render: () => {},
      pickTolerance: () => pointHandleWorldRadius(camera, cameraStateRef.current.distance, 800, PICK_TOLERANCE_PX),
      dragDeltaFor: (session, pt) => {
        const current = dragWorldPoint(camera, session.anchor, pt)
        return current ? current.sub(session.origin) : null
      },
      setCameraState: () => {},
      pointFromEvent: (event) => ({ x: event.clientX / 800, y: event.clientY / 800 }),
      raycasterAt: (pt) => {
        const r = new THREE.Raycaster()
        r.setFromCamera(new THREE.Vector2(pt.x * 2 - 1, -(pt.y * 2 - 1)), camera)
        return r
      },
      previewHitAt: () => ({ hovering: false, depth: null, preview: null })
    })

    // PointerDown at (408, 400) - 8 pixels away
    interaction.handlePointerDown({
      pointerId: 1,
      button: 0,
      clientX: 408,
      clientY: 400,
      preventDefault: () => {}
    } as any)

    console.log("At 8px away, dragSessionRef:", dragSessionRef.current ? "FOUND" : "NULL")
    expect(dragSessionRef.current).not.toBeNull()
    expect(dragSessionRef.current.targetId).toBe("mover")

    // Move
    interaction.handlePointerMove({
      pointerId: 1,
      clientX: 450,
      clientY: 400
    } as any)
    expect(dragSessionRef.current.applied).toBe(true)
    expect(points.get("mover")!.position.x).toBeGreaterThan(0)
  })

  it("handles bound point on a cube edge with solid mesh in scene", () => {
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
    camera.position.set(5, 5, 10)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)

    const cube = { id: "cube-1", type: "cube" as const, origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }
    const built = buildSolidTemplate(cube)

    const edge = built.primitives.find(p => p.type === "edge3")
    const polyhedron = built.primitives.find(p => p.type === "polyhedron3")
    if (!edge || !polyhedron) throw new Error("Cube template must contain edges and a polyhedron")
    const boundPt: Point3Primitive = {
      id: "bound-pt",
      type: "point3",
      position: { x: -1, y: -1, z: 0 },
      binding: { kind: "onHost", hostId: edge.id, parameter: 0.5 }
    }

    const doc: GeometryDocument = {
      ...createEmptyDocument("geometry3d"),
      primitives: [cube, ...built.primitives, boundPt]
    }

    const points = new Map<string, Point3Primitive>()
    for (const p of doc.primitives) {
      if (p.type === "point3") points.set(p.id, p as Point3Primitive)
    }

    // Add cube face mesh to scene
    const cubeFaceMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial())
    cubeFaceMesh.userData.primitiveId = built.polyhedronId
    cubeFaceMesh.userData.primitiveType = "polyhedron3"
    scene.add(cubeFaceMesh)

    // Add point mesh
    const ptMesh = createPoint3Mesh(boundPt, false, 0.05)
    scene.add(ptMesh)

    const renderer = {
      domElement: {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }),
        setPointerCapture: () => {},
        releasePointerCapture: () => {}
      },
      render: () => {}
    } as any

    const documentRef = { current: doc }
    const selectedIdsRef = { current: [] as string[] }
    const dragModeRef = { current: false }
    const panModeRef = { current: false }
    const pointerStateRef = { current: null as any }
    const dragSessionRef = { current: null as any }
    const cameraStateRef = { current: { azimuth: 45, elevation: 30, distance: 12, target: { x: 0, y: 0, z: 0 } } }
    const topologyOwners = new Map<string, string>()
    for (const childId of [...polyhedron.edgeIds, ...polyhedron.faceIds]) {
      topologyOwners.set(childId, cube.id)
    }

    const interaction = createThreeSceneInteraction({
      cameraStateRef,
      panModeRef,
      dragModeRef,
      pointerStateRef,
      dragSessionRef,
      selectedIdsRef,
      dragEndRef: { current: undefined },
      moveSectionRef: { current: undefined },
      hostDragEndRef: { current: () => {} },
      rotateEndRef: { current: undefined },
      trackRadiusEndRef: { current: undefined },
      rotationHandleRef: { current: null },
      trackRadiusHandleRef: { current: null },
      circleRadiusPreviewRef: { current: null },
      pickSectionFaceRef: { current: undefined },
      documentRef,
      setFacePickMode: () => {},
      facePickModeRef: { current: false },
      onSelectRef: { current: () => {} },
      previewClickRef: { current: undefined },
      scene,
      camera,
      renderer,
      sceneShell: null,
      sceneBounds: new THREE.Box3(),
      points,
      topologyOwners,
      ...previewCallbacks(documentRef, points),
      render: () => {},
      pickTolerance: () => pointHandleWorldRadius(camera, cameraStateRef.current.distance, 800, PICK_TOLERANCE_PX),
      dragDeltaFor: (session, pt) => {
        const current = dragWorldPoint(camera, session.anchor, pt)
        return current ? current.sub(session.origin) : null
      },
      setCameraState: () => {},
      pointFromEvent: (event) => ({ x: event.clientX / 800, y: event.clientY / 800 }),
      raycasterAt: (pt) => {
        const r = new THREE.Raycaster()
        r.setFromCamera(new THREE.Vector2(pt.x * 2 - 1, -(pt.y * 2 - 1)), camera)
        return r
      },
      previewHitAt: () => ({ hovering: false, depth: null, preview: null })
    })

    // Project boundPt to screen
    const ndc = new THREE.Vector3(boundPt.position.x, boundPt.position.y, boundPt.position.z).project(camera)
    const screenX = (ndc.x + 1) * 400
    const screenY = (-ndc.y + 1) * 400

    interaction.handlePointerDown({
      pointerId: 1,
      button: 0,
      clientX: screenX,
      clientY: screenY,
      preventDefault: () => {}
    } as any)

    expect(dragSessionRef.current?.targetId).toBe(boundPt.id)
    expect(dragSessionRef.current?.hostConstraint).toBeDefined()
  })
})
