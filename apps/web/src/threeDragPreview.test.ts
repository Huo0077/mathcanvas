import { describe, expect, it, vi } from "vitest"
import * as THREE from "three"
import { createEmptyDocument, type GeometryDocument, type PrimitiveSpec } from "@draw/dsl"
import { buildSolidTemplate } from "@draw/geometry-kernel"
import { recomputeDerivedObjects } from "@draw/scene-graph"
import type { DragSessionState } from "./threeSceneEffect"
import { dragPreviewDocument } from "./threeDragPreview"
import { createThreeSceneDragVisuals } from "./threeSceneDragVisuals"

function session(targetId: string, delta = new THREE.Vector3(1, 2, 3)): DragSessionState {
  return { targetId, family: new Set([targetId]), anchor: new THREE.Vector3(), origin: new THREE.Vector3(), total: delta, visualApplied: new THREE.Vector3(), applied: true }
}
function point(doc: GeometryDocument, id: string) {
  const p = doc.primitives.find(p => p.id === id)
  if (p?.type !== "point3") throw new Error(`Missing point ${id}`)
  return p.position
}
function documentWith(primitives: PrimitiveSpec[]) {
  return recomputeDerivedObjects({ ...createEmptyDocument("geometry3d"), primitives })
}

describe("temporary dependency-aware drag documents", () => {
  it.each(["cube", "cylinder", "cone"] as const)("moves %s topology, face/surface/interior bindings and transitive segments together", kind => {
    const solid = kind === "cube"
      ? { id: "solid", type: kind, origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
      : { id: "solid", type: kind, center: { x: 0, y: 0, z: -2 }, radius: 2, height: 4, segments: 12 }
    const topology = buildSolidTemplate(solid).primitives
    const face = topology.find(p => p.type === "face3")!
    const edge = topology.find(p => p.type === "edge3")!
    const base = documentWith([solid, ...topology,
      { id: "on-face", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "onFace", faceId: face.id, uv: [0.5, 0.5] } },
      { id: "on-edge", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "onHost", hostId: edge.id, parameter: 0.5 } },
      { id: "inside", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "inSolid", solidId: solid.id, uvw: [0.4, 0.6, 0.5] } },
      ...(kind === "cube" ? [] : [{ id: "surface", type: "point3" as const, position: { x: 0, y: 0, z: 0 }, binding: { kind: "onSurface" as const, solidId: solid.id, uv: [0.7, 0.4] as [number, number] } }]),
      { id: "segment", type: "segment3", pointIds: ["on-face", "inside"] },
      { id: "downstream", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "onHost", hostId: "segment", parameter: 0.5 } }
    ])
    const saved = JSON.stringify(base)
    const preview = dragPreviewDocument(base, session(solid.id))
    const ids = ["on-face", "on-edge", "inside", "downstream", ...topology.filter(p => p.type === "point3").map(p => p.id)]
    if (kind !== "cube") ids.push("surface")
    for (const id of ids) {
      const a = point(base, id), b = point(preview, id)
      expect(b.x - a.x, id).toBeCloseTo(1, 8)
      expect(b.y - a.y, id).toBeCloseTo(2, 8)
      expect(b.z - a.z, id).toBeCloseTo(3, 8)
    }
    expect(JSON.stringify(base)).toBe(saved)
    // Cumulative frames always start from the canonical base, never the prior frame.
    const next = dragPreviewDocument(base, session(solid.id, new THREE.Vector3(2, 0, 0)))
    expect(point(next, "inside").x - point(base, "inside").x).toBeCloseTo(2)
    expect(point(dragPreviewDocument(base, session(solid.id, new THREE.Vector3())), "inside")).toEqual(point(base, "inside"))
  })

  it("recomputes embedded faces, planes and points attached to them", () => {
    const base = documentWith([
      { id: "a", type: "point3", position: { x: 0, y: 0, z: 0 } },
      { id: "b", type: "point3", position: { x: 4, y: 0, z: 0 } },
      { id: "c", type: "point3", position: { x: 0, y: 4, z: 0 } },
      { id: "face", type: "face3", pointIds: ["a", "b", "c"] },
      { id: "plane", type: "plane3", definition: { kind: "throughPoints", pointIds: ["a", "b", "c"] } },
      { id: "on-face", type: "point3", position: { x: 1, y: 1, z: 0 }, binding: { kind: "onFace", faceId: "face", uv: [1, 1] } },

    ])
    const preview = dragPreviewDocument(base, session("a", new THREE.Vector3(0, 0, 2)))
    for (const id of ["on-face"]) {
      const p = point(preview, id)
      expect(p.z).not.toBeCloseTo(0)
      // New plane through A(0,0,2), B(4,0,0), C(0,4,0).
      expect(p.x + p.y + 2 * p.z).toBeCloseTo(4, 8)
    }
  })

  it.each(["translate", "rotate", "radius"] as const)("%s previews a circle and its dependent points with commit semantics", mode => {
    const base = documentWith([
      { id: "circle", type: "circle3", center: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, radius: 2 },
      { id: "p", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "onHost", hostId: "circle", parameter: 0.6 } }
    ])
    const drag = session("circle")
    if (mode === "radius") drag.scale = { id: "circle", original: 2, current: 4 }
    if (mode === "rotate") drag.rotation = { family: new Set(["circle"]), state: { axis: "x", pivot: new THREE.Vector3(), lastAngle: 0, raw: Math.PI / 2, applied: Math.PI / 2 } }
    const p = point(dragPreviewDocument(base, drag), "p")
    const before = point(base, "p")
    if (mode === "translate") expect(p).toEqual({ x: before.x + 1, y: before.y + 2, z: before.z + 3 })
    else if (mode === "radius") expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(4)
    else expect(Math.abs(p.z)).toBeGreaterThan(0.1)
    expect(p).not.toEqual(before)
  })

  it("can reapply a preview after a display refresh and clear without painting a stale frame", () => {
    const base = documentWith([{ id: "a", type: "point3", position: { x: 0, y: 0, z: 0 } }])
    const documentRef = { current: base }, dragSessionRef = { current: session("a") }
    const syncContent = vi.fn(), render = vi.fn()
    const visuals = createThreeSceneDragVisuals({ documentRef, dragSessionRef, syncContent, render })
    visuals.resumeDragVisual()
    const first = syncContent.mock.calls[0][0]
    visuals.resumeDragVisual()
    expect(point(syncContent.mock.calls[1][0], "a")).toEqual(point(first, "a"))
    visuals.clearDragPreview()
    expect(syncContent).toHaveBeenLastCalledWith(base, true)
    expect(render).toHaveBeenCalledTimes(2)
    expect(documentRef.current).toBe(base)
  })
})


describe("preview rejection and constraints", () => {
  it("uses the constrained commit planner, including a fully cancelled displacement", () => {
    const base = documentWith([
      { id: "a", type: "point3", position: { x: 0, y: 0, z: 0 } },
      { id: "b", type: "point3", position: { x: 1, y: 0, z: 0 } },
      { id: "c", type: "point3", position: { x: 0, y: 1, z: 0 } },
      { id: "p", type: "point3", position: { x: 2, y: 3, z: 0 } },
      { id: "plane", type: "plane3", definition: { kind: "throughPoints", pointIds: ["a", "b", "c"] } }
    ])
    base.constraints = [{ id: "constraint", type: "pointOnPlane", targets: ["p", "plane"] }]
    expect(point(dragPreviewDocument(base, session("p", new THREE.Vector3(1, 2, 5)), true), "p")).toEqual({ x: 3, y: 5, z: 0 })
    expect(dragPreviewDocument(base, session("p", new THREE.Vector3(0, 0, 5)), true)).toBe(base)
  })

  it("does not let ordinary invalid solid vertex candidates escape the preview handler", () => {
    const cube = { id: "cube", type: "cube" as const, origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }
    const base = documentWith([cube, ...buildSolidTemplate(cube).primitives])
    const vertices = base.primitives.filter(p => p.type === "point3")
    const a = vertices[0], b = vertices[1]
    const delta = new THREE.Vector3(b.position.x - a.position.x, b.position.y - a.position.y, b.position.z - a.position.z)
    const syncContent = vi.fn()
    const visuals = createThreeSceneDragVisuals({ documentRef: { current: base }, dragSessionRef: { current: null }, syncContent, render: vi.fn() })
    expect(visuals.previewDrag(session(a.id, delta))).toBe(false)
    expect(syncContent).not.toHaveBeenCalled()
    expect(point(base, a.id)).toEqual(a.position)
  })
})


it("recomputes section geometry from the same cumulative normal displacement used on release", () => {
  const cube = { id: "cube", type: "cube" as const, origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }
  const base = documentWith([cube, ...buildSolidTemplate(cube).primitives,
    { id: "section", type: "section", sourceId: "cube", plane: { normal: { x: 0, y: 0, z: 1 }, constant: 0 }, points: [], classification: "none", status: "undefined" }
  ])
  const drag = session("section", new THREE.Vector3(2, 3, 0.5))
  drag.slideNormal = new THREE.Vector3(0, 0, 1)
  const section = dragPreviewDocument(base, drag).primitives.find(p => p.id === "section")
  if (section?.type !== "section") throw new Error("Expected section")
  expect(section.points).toHaveLength(4)
  for (const p of section.points) expect(p.z).toBeCloseTo(0.5)
})

it("rejects a collinear dependent plane candidate and retains the last valid preview", () => {
  const base = documentWith([
    { id: "a", type: "point3", position: { x: 0, y: 0, z: 0 } },
    { id: "b", type: "point3", position: { x: 2, y: 0, z: 0 } },
    { id: "c", type: "point3", position: { x: 0, y: 2, z: 0 } },
    { id: "plane", type: "plane3", definition: { kind: "throughPoints", pointIds: ["a", "b", "c"] } }
  ])
  const syncContent = vi.fn()
  const visuals = createThreeSceneDragVisuals({ documentRef: { current: base }, dragSessionRef: { current: null }, syncContent, render: vi.fn() })
  expect(visuals.previewDrag(session("c", new THREE.Vector3(1, -1, 0)))).toBe(true)
  const lastValid = syncContent.mock.calls[0][0]
  expect(visuals.previewDrag(session("c", new THREE.Vector3(1, -2, 0)))).toBe(false)
  expect(syncContent).toHaveBeenCalledOnce()
  expect(point(lastValid, "c")).toEqual({ x: 1, y: 1, z: 0 })
  expect(point(base, "c")).toEqual({ x: 0, y: 2, z: 0 })
})
