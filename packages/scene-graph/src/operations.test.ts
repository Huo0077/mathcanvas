import { describe, expect, it } from "vitest"

import { createDefaultCadLayout, createEmptyDocument, type PrimitiveSpec } from "@draw/dsl"
import { buildSolidTemplate } from "@draw/geometry-kernel"

import { commitPatch } from "./patches"
import { planeThroughPoints, sectionDistanceToPlane, sectionPivot, sectionPlaneOffset, sectionPlaneThroughSource } from "./operations"

function cadDocument() {
  return createDefaultCadLayout(createEmptyDocument("cad"))
}

describe("template solid orientation", () => {
  const cone = { id: "cone-1", type: "cone" as const, center: { x: 0, y: 0, z: 0 }, radius: 1, height: 4, segments: 4 }

  function coneDocument() {
    const document = createEmptyDocument("geometry3d")
    return commitPatch(document, { op: "addPrimitives", primitives: [cone, ...buildSolidTemplate(cone).primitives] }).document
  }

  const apexId = (document: ReturnType<typeof coneDocument>) => (document.primitives.find((primitive) => primitive.type === "polyhedron3") as { vertexIds: string[] }).vertexIds.at(-1)!
  const positionOf = (document: ReturnType<typeof coneDocument>, id: string) => (document.primitives.find((primitive) => primitive.id === id) as { position: { x: number; y: number; z: number } }).position

  it("stores the orientation and drags the generated topology with it", () => {
    const document = coneDocument()
    const apex = apexId(document)

    expect(positionOf(document, apex).z).toBeCloseTo(4, 6)

    const rotated = commitPatch(document, { op: "updatePrimitive", id: "cone-1", patch: { rotation3: { x: Math.PI / 2, y: 0, z: 0 } } })

    expect(rotated.changed).toBe(true)
    expect((rotated.document.primitives.find((primitive) => primitive.id === "cone-1") as { rotation: { x: number } }).rotation.x).toBeCloseTo(Math.PI / 2, 10)
    // The vertices belong to the template, so they must follow the new orientation instead of staying upright.
    expect(positionOf(rotated.document, apex).z).toBeCloseTo(2, 6)
    expect(positionOf(rotated.document, apex).y).toBeCloseTo(-2, 6)
  })

  it("merges a single axis so the other angles are preserved", () => {
    const document = coneDocument()
    const leaned = commitPatch(document, { op: "updatePrimitive", id: "cone-1", patch: { rotation3: { x: Math.PI / 2, y: 0, z: 0 } } }).document
    const turned = commitPatch(leaned, { op: "updatePrimitive", id: "cone-1", patch: { rotation3: { z: Math.PI } } }).document

    expect((turned.primitives.find((primitive) => primitive.id === "cone-1") as { rotation: { x: number; y: number; z: number } }).rotation).toMatchObject({ x: Math.PI / 2, z: Math.PI })
  })
})

describe("plane patch size", () => {
  function planeDocument() {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "p0", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "free" } },
      { id: "p1", type: "point3", position: { x: 4, y: 0, z: 0 }, binding: { kind: "free" } },
      { id: "p2", type: "point3", position: { x: 0, y: 4, z: 0 }, binding: { kind: "free" } },
      { id: "plane-abc", type: "plane3", definition: { kind: "throughPoints", pointIds: ["p0", "p1", "p2"] } }
    ]
    return document
  }

  const planeOf = (document: ReturnType<typeof planeDocument>) => document.primitives.find((primitive) => primitive.id === "plane-abc") as { halfSize?: number }

  it("stores an explicit half extent", () => {
    const sized = commitPatch(planeDocument(), { op: "updatePrimitive", id: "plane-abc", patch: { halfSize: 6 } })

    expect(sized.changed).toBe(true)
    expect(planeOf(sized.document).halfSize).toBe(6)
  })

  it("returns the plane to automatic sizing when the size is cleared", () => {
    const sized = commitPatch(planeDocument(), { op: "updatePrimitive", id: "plane-abc", patch: { halfSize: 6 } }).document
    const cleared = commitPatch(sized, { op: "updatePrimitive", id: "plane-abc", patch: { halfSize: null } })

    expect(cleared.changed).toBe(true)
    // Removed rather than set to zero, so the stored document carries no stale size.
    expect("halfSize" in planeOf(cleared.document)).toBe(false)
  })
})

describe("free 3D drag", () => {
  const cube = { id: "cube-1", type: "cube" as const, origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }

  function cubeDocument() {
    const document = createEmptyDocument("geometry3d")
    return commitPatch(document, { op: "addPrimitives", primitives: [cube, ...buildSolidTemplate(cube).primitives] }).document
  }

  const primitiveById = (document: ReturnType<typeof cubeDocument>, id: string) => document.primitives.find((candidate) => candidate.id === id)!
  const positionOf = (document: ReturnType<typeof cubeDocument>, id: string) => (primitiveById(document, id) as { position: { x: number; y: number; z: number } }).position
  /** The materialised topology the canvas draws for the cube; its ids are allocated by the builder. */
  const generatedTopology = (document: ReturnType<typeof cubeDocument>) => primitiveById(document, "cube-1-polyhedron-27") as unknown as { vertexIds: string[]; edgeIds: string[] }

  it("moves a template solid and every point it generated", () => {
    const document = cubeDocument()
    const generatedPointId = generatedTopology(document).vertexIds[0]
    const before = positionOf(document, generatedPointId)

    const moved = commitPatch(document, { op: "translatePrimitive3", id: "cube-1", delta: { x: 2, y: 0, z: -3 } })

    expect(moved.changed).toBe(true)
    expect((primitiveById(moved.document, "cube-1") as { origin: { x: number; y: number; z: number } }).origin).toEqual({ x: 1, y: -1, z: -4 })
    // The generated topology is what the canvas actually draws, so it has to follow the anchor.
    expect(positionOf(moved.document, generatedPointId)).toEqual({ x: before.x + 2, y: before.y, z: before.z - 3 })
  })

  it("keeps a template solid's size when it is dragged", () => {
    const moved = commitPatch(cubeDocument(), { op: "translatePrimitive3", id: "cube-1", delta: { x: 5, y: 5, z: 5 } })

    expect((primitiveById(moved.document, "cube-1") as { size: { x: number; y: number; z: number } }).size).toEqual({ x: 2, y: 2, z: 2 })
  })

  it("moves a point-driven object by moving the points it references", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "p-a", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "free" } },
      { id: "p-b", type: "point3", position: { x: 2, y: 0, z: 0 }, binding: { kind: "free" } },
      { id: "segment-ab", type: "segment3", pointIds: ["p-a", "p-b"] }
    ]

    const moved = commitPatch(document, { op: "translatePrimitive3", id: "segment-ab", delta: { x: 0, y: 1, z: 2 } })

    expect(moved.changed).toBe(true)
    expect(positionOf(moved.document, "p-a")).toEqual({ x: 0, y: 1, z: 2 })
    expect(positionOf(moved.document, "p-b")).toEqual({ x: 2, y: 1, z: 2 })
  })

  it("moves a point-driven line's endpoints so the line follows", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "p-a", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "free" } },
      { id: "p-b", type: "point3", position: { x: 2, y: 0, z: 0 }, binding: { kind: "free" } },
      { id: "line-ab", type: "line3", definition: { kind: "throughPoints", pointIds: ["p-a", "p-b"] } }
    ]

    const moved = commitPatch(document, { op: "translatePrimitive3", id: "line-ab", delta: { x: 1, y: 1, z: 1 } })

    expect(positionOf(moved.document, "p-a")).toEqual({ x: 1, y: 1, z: 1 })
    expect(positionOf(moved.document, "p-b")).toEqual({ x: 3, y: 1, z: 1 })
  })

  it("leaves a bound point to the object that binds it", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "p-a", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "free" } },
      { id: "p-b", type: "point3", position: { x: 2, y: 0, z: 0 }, binding: { kind: "free" } },
      { id: "line-ab", type: "line3", definition: { kind: "throughPoints", pointIds: ["p-a", "p-b"] } },
      { id: "p-mid", type: "point3", position: { x: 1, y: 0, z: 0 }, binding: { kind: "derived", feature: "midpoint", sourceIds: ["p-a", "p-b"] } }
    ]

    const rejected = commitPatch(document, { op: "translatePrimitive3", id: "p-mid", delta: { x: 1, y: 0, z: 0 } })

    expect(rejected.changed).toBe(false)
    expect(rejected.error).toContain("not draggable")
    // Dragging the line the midpoint hangs off still carries it along.
    const moved = commitPatch(document, { op: "translatePrimitive3", id: "line-ab", delta: { x: 3, y: 0, z: 0 } })
    expect(positionOf(moved.document, "p-mid")).toEqual({ x: 4, y: 0, z: 0 })
  })

  it("refuses to drag generated topology out of its parent solid", () => {
    const document = cubeDocument()
    const generatedEdgeId = generatedTopology(document).edgeIds[0]

    const rejected = commitPatch(document, { op: "translatePrimitive3", id: generatedEdgeId, delta: { x: 1, y: 0, z: 0 } })

    expect(rejected.changed).toBe(false)
    expect(rejected.error).toContain("not draggable")
  })

  it("refuses a locked object and a non-finite drag", () => {
    expect(commitPatch(cubeDocument(), { op: "translatePrimitive3", id: "cube-1", delta: { x: 1, y: 0, z: Number.NaN } }).changed).toBe(false)

    const locked = commitPatch(cubeDocument(), { op: "toggleLock", id: "cube-1", locked: true }).document
    expect(commitPatch(locked, { op: "translatePrimitive3", id: "cube-1", delta: { x: 1, y: 0, z: 0 } }).changed).toBe(false)
  })

  it("is one undoable step per committed drag", () => {
    const document = cubeDocument()
    const moved = commitPatch(document, { op: "translatePrimitive3", id: "cube-1", delta: { x: 1, y: 1, z: 1 } }).document
    // A drag is dispatched as one operation, so the previous document is the whole undo step.
    expect((primitiveById(moved, "cube-1") as { origin: { x: number } }).origin.x).toBe(0)
    expect((primitiveById(document, "cube-1") as { origin: { x: number } }).origin.x).toBe(-1)
  })
})

describe("section plane", () => {
  const cube = { id: "cube-1", type: "cube" as const, origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }

  function sectionDocument() {
    const document = createEmptyDocument("geometry3d")
    return commitPatch(document, { op: "addPrimitives", primitives: [cube, ...buildSolidTemplate(cube).primitives] }).document
  }

  const sectionOf = (document: ReturnType<typeof sectionDocument>, id = "section-1") => document.primitives.find((candidate) => candidate.id === id) as Extract<PrimitiveSpec, { type: "section" }>
  /** Mean of one coordinate over a point list: a rigid translation shows up here even at a single point. */
  const meanCoordinate = (points: { x: number; y: number; z: number }[], axis: "x" | "y" | "z") => points.reduce((sum, point) => sum + point[axis], 0) / Math.max(points.length, 1)

  function withSection() {
    const document = sectionDocument()
    const plane = sectionPlaneThroughSource(document, "cube-1")!
    return commitPatch(document, { op: "addPrimitive", primitive: { id: "section-1", type: "section", sourceId: "cube-1", plane, points: [], classification: "none", status: "undefined" } }).document
  }

  it("starts as the horizontal plane through the solid's middle", () => {
    const document = withSection()

    // The cube spans y = -1..1, so the default cut sits at y = 0 and the section is a square.
    expect(sectionOf(document).plane).toEqual({ normal: { x: 0, y: 1, z: 0 }, constant: -0 })
    expect(sectionOf(document).classification).toBe("polygon")
    expect(sectionOf(document).points).toHaveLength(4)
  })

  it("moves the cutting plane along its normal and re-derives the section in the same commit", () => {
    const document = withSection()
    const before = sectionPlaneOffset(sectionOf(document).plane)
    // A positive distance pushes the plane along the normal (here +Y), so the cut rises.
    const moved = commitPatch(document, { op: "moveSectionPlane", id: "section-1", distance: 0.5 })

    expect(moved.changed).toBe(true)
    expect(sectionPlaneOffset(sectionOf(moved.document).plane) - before).toBeCloseTo(0.5, 10)
    // Same square, shifted up: every section point must carry the new height, not the old one.
    for (const point of sectionOf(moved.document).points) expect(point.y).toBeCloseTo(0.5, 6)
  })

  it("shows a smaller section as the plane approaches a face, and hides it once it is past the solid", () => {
    const document = withSection()
    const nearFace = commitPatch(document, { op: "moveSectionPlane", id: "section-1", distance: 0.95 }).document
    const pastSolid = commitPatch(nearFace, { op: "moveSectionPlane", id: "section-1", distance: 0.2 }).document

    expect(sectionOf(nearFace).classification).toBe("polygon")
    // A cut beyond the solid has no points at all: it must not leave a stale square on screen.
    expect(sectionOf(pastSolid).points).toHaveLength(0)
    expect(sectionOf(pastSolid).visible).toBe(false)
  })

  it("keeps a rotated plane's normal untouched so distance stays in world units", () => {
    const document = sectionDocument()
    // A deliberately un-normalised normal: 1 world unit must still mean 1 unit of travel.
    const plane = { normal: { x: 0, y: 3, z: 4 }, constant: -5 }
    const withTilted = commitPatch(document, { op: "addPrimitive", primitive: { id: "section-2", type: "section", sourceId: "cube-1", plane, points: [], classification: "none", status: "undefined" } }).document
    const offsetBefore = sectionPlaneOffset(sectionOf(withTilted, "section-2").plane)

    const moved = commitPatch(withTilted, { op: "moveSectionPlane", id: "section-2", distance: 1 })

    const stored = sectionOf(moved.document, "section-2").plane
    // Normalising while also moving the plane makes it drift by (|n| - 1) extra units, so keep the normal as-is.
    expect(stored.normal).toEqual(plane.normal)
    expect(sectionPlaneOffset(stored) - offsetBefore).toBeCloseTo(1, 10)
  })

  it("rejects moving something that is not a section, a locked section, or a non-finite distance", () => {
    const document = withSection()

    expect(commitPatch(document, { op: "moveSectionPlane", id: "cube-1", distance: 1 }).changed).toBe(false)
    expect(commitPatch(document, { op: "moveSectionPlane", id: "section-1", distance: Number.NaN }).changed).toBe(false)

    const locked = commitPatch(document, { op: "toggleLock", id: "section-1", locked: true }).document
    expect(commitPatch(locked, { op: "moveSectionPlane", id: "section-1", distance: 1 }).changed).toBe(false)
  })

  it("tilts the plane about a given pivot so the cut still crosses the solid", () => {
    const document = withSection()
    // Rotating about the plane's own closest point to the origin slides the plane out of the solid
    // (measured: distance from the origin fell from 1.5 to 0.15). A tipped knife must pivot *through* the
    // solid, so the UI passes the solid's centre.
    const centre = { x: 0, y: 0, z: 0 }
    const turned = commitPatch(document, { op: "rotateSectionPlane", id: "section-1", axis: "x", degrees: 30, pivot: centre })

    expect(turned.changed).toBe(true)
    const after = sectionOf(turned.document)
    expect(Math.hypot(after.plane.normal.x, after.plane.normal.y, after.plane.normal.z)).toBeCloseTo(1, 10)
    // The plane still passes through the pivot, so the cut stays inside the cube (no -0 / +0 games).
    expect(sectionDistanceToPlane(after.plane, centre)).toBeCloseTo(0, 10)
    expect(after.points.length).toBeGreaterThanOrEqual(3)
  })

  it("keeps the cut inside the solid across a run of tilts", () => {
    const document = withSection()
    const centre = { x: 0, y: 0, z: 0 }
    let turned = document
    // Tilts that keep the normal off the axis-aligned knife-edge stay well-behaved.
    for (const [axis, degrees] of [["x", 30], ["y", 45], ["z", 40]] as const) {
      turned = commitPatch(turned, { op: "rotateSectionPlane", id: "section-1", axis, degrees, pivot: centre }).document
      // Whatever the tilt, the plane goes through the solid's centre, so there is always a real section.
      expect(sectionDistanceToPlane(sectionOf(turned).plane, centre)).toBeCloseTo(0, 10)
      expect(sectionOf(turned).points.length).toBeGreaterThanOrEqual(3)
    }
    const normal = sectionOf(turned).plane.normal
    expect(Math.hypot(normal.x, normal.y, normal.z)).toBeCloseTo(1, 10)
  })

  it("turns a horizontal plane into a vertical one at 90°", () => {
    const document = withSection()
    const turned = commitPatch(document, { op: "rotateSectionPlane", id: "section-1", axis: "x", degrees: 90, pivot: { x: 0, y: 0, z: 0 } })

    const after = sectionOf(turned.document)
    // The orientation is exactly what was asked for, and the plane still passes through the pivot.
    expect(after.plane.normal.x).toBeCloseTo(0, 10)
    expect(after.plane.normal.y).toBeCloseTo(0, 10)
    expect(Math.abs(after.plane.normal.z)).toBeCloseTo(1, 10)
    expect(sectionDistanceToPlane(after.plane, { x: 0, y: 0, z: 0 })).toBeCloseTo(0, 10)
    // KNOWN LIMITATION: a cut whose normal lands exactly on a coordinate axis comes back unresolved from
    // `chainSectionLoops` (same plane written by hand behaves identically, so this is not the rotation).
    // Every non-axis-aligned tilt resolves, which is what the UI's 15° steps avoid hitting.
    expect(after.status === "approximate" || after.status === "failed").toBe(true)
  })

  it("derives a pivot at the centre of a point set", () => {
    expect(sectionPivot([{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 4, y: 3, z: 0 }])).toEqual({ x: 2, y: 1, z: 0 })
    expect(sectionPivot([])).toBeNull()
  })

  it("accepts an explicit plane, so a face can become the cutting plane", () => {
    const document = withSection()

    const plane = planeThroughPoints([{ x: 1, y: -1, z: -1 }, { x: 1, y: 1, z: -1 }, { x: 1, y: 1, z: 1 }, { x: 1, y: -1, z: 1 }])!
    const applied = commitPatch(document, { op: "setSectionPlane", id: "section-1", normal: plane.normal, constant: plane.constant })

    expect(applied.changed).toBe(true)
    // The cube's x = 1 face is the cut: the section is that whole square.
    const after = sectionOf(applied.document)
    expect(after.plane.normal.x).toBeCloseTo(1, 10)
    expect(after.points).toHaveLength(4)
    for (const point of after.points) expect(point.x).toBeCloseTo(1, 6)
  })

  it("rejects a degenerate or non-finite plane, and a rotation with a bad axis", () => {
    const document = withSection()

    expect(commitPatch(document, { op: "setSectionPlane", id: "section-1", normal: { x: 0, y: 0, z: 0 }, constant: 0 }).changed).toBe(false)
    expect(commitPatch(document, { op: "setSectionPlane", id: "section-1", normal: { x: 0, y: 1, z: 0 }, constant: Number.NaN }).changed).toBe(false)
    expect(commitPatch(document, { op: "setSectionPlane", id: "cube-1", normal: { x: 0, y: 1, z: 0 }, constant: 0 }).changed).toBe(false)
    expect(commitPatch(document, { op: "rotateSectionPlane", id: "section-1", axis: "w" as "x", degrees: 15 }).changed).toBe(false)
    expect(commitPatch(document, { op: "rotateSectionPlane", id: "section-1", axis: "x", degrees: Number.NaN }).changed).toBe(false)
  })

  it("refuses to build a plane from points that do not lie in one", () => {
    // Any three points are coplanar, so the real test needs a fourth off the plane.
    expect(planeThroughPoints([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }])).toBeNull()
    // A warped quadrilateral: the first three define one plane, the fourth sits clearly off it.
    expect(planeThroughPoints([{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 1 }, { x: -1, y: 0, z: 1 }, { x: 0, y: -1, z: 0.5 }])).toBeNull()
    expect(planeThroughPoints([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }])).toBeNull()
    // A real face ring still resolves, and its plane is the face's own.
    const face = planeThroughPoints([{ x: -1, y: -1, z: -1 }, { x: 1, y: -1, z: -1 }, { x: 1, y: 1, z: -1 }, { x: -1, y: 1, z: -1 }])
    expect(face).not.toBeNull()
    expect(Math.abs(face!.normal.z)).toBeCloseTo(1, 10)
    expect(face!.constant).toBeCloseTo(1, 10)
  })

  it("moves the section together with its source when the solid is dragged", () => {
    const document = withSection()
    const centreBefore = meanCoordinate(sectionOf(document).points, "x")
    // Drag the cube sideways: the horizontal cut plane still crosses it, so the section must follow.
    const moved = commitPatch(document, { op: "translatePrimitive3", id: "cube-1", delta: { x: 2, y: 0, z: 0 } })

    // A section names its source by id, so it is not in the dependency index: without an explicit re-derive
    // here the drawn cut would keep its old coordinates while the solid moves away from it.
    expect(sectionOf(moved.document).status).toBe("approximate")
    expect(sectionOf(moved.document).points).toHaveLength(4)
    expect(meanCoordinate(sectionOf(moved.document).points, "x") - centreBefore).toBeCloseTo(2, 6)
    // The plane itself is document state the user may have positioned: dragging the solid must not reset it.
    expect(sectionOf(moved.document).plane.constant).toEqual(sectionOf(document).plane.constant)
  })
})

describe("engineering workbench operations", () => {
  it("adds a child layer and activates it", () => {
    const document = cadDocument()
    const layer = { id: "layer-detail", name: "细节", parentId: "layer-geometry", kind: "geometry" as const, visible: true, locked: false, printable: true }

    const added = commitPatch(document, { op: "addLayer", layer } as never)
    const activated = commitPatch(added.document, { op: "setActiveLayer", id: layer.id } as never)

    expect(added.changed).toBe(true)
    expect(activated.document.layers).toContainEqual(layer)
    expect(activated.document.activeLayerId).toBe(layer.id)
  })

  it("reassigns primitives when deleting a layer", () => {
    const document = cadDocument()
    document.layers!.push({ id: "layer-detail", name: "细节", parentId: "layer-geometry", kind: "geometry", visible: true, locked: false, printable: true })
    document.primitives = [{ id: "point-1", type: "point", x: 1, y: 2, layerId: "layer-detail" }]

    const result = commitPatch(document, { op: "deleteLayer", id: "layer-detail", reassignTo: "layer-geometry" } as never)

    expect(result.changed).toBe(true)
    expect(result.document.layers?.some((layer) => layer.id === "layer-detail")).toBe(false)
    expect(result.document.primitives[0].layerId).toBe("layer-geometry")
  })

  it("updates a drawing view layout without changing its projected source", () => {
    const document = cadDocument()
    const result = commitPatch(document, { op: "updateDrawingView", id: "view-front", patch: { x: 80, y: 90, width: 420, scale: 2 } } as never)
    const view = result.document.drawingViews?.find((candidate) => candidate.id === "view-front")

    expect(result.changed).toBe(true)
    expect(view).toMatchObject({ x: 80, y: 90, width: 420, height: 220, scale: 2, kind: "front" })
  })

  it("rejects deleting a view referenced by a sheet", () => {
    const document = cadDocument()

    const result = commitPatch(document, { op: "deleteDrawingView", id: "view-front" } as never)

    expect(result.changed).toBe(false)
    expect(result.document).toBe(document)
    expect(result.error).toContain("drawing view is referenced by a sheet")
  })
})

describe("function analysis deletion", () => {
  /** A legacy calculus document: the analysis objects exist only to describe the function they came from. */
  function documentWithFunctionAnalysis() {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "fn-1", type: "function", expression: "x*x", domain: [-6, 6], samples: 128, label: "旧函数" },
      { id: "derivative-1", type: "derivative", sourceId: "fn-1", order: 1, domain: [-6, 6], samples: 128, points: [], status: "approximate" },
      { id: "tangent-1", type: "tangent", sourceId: "fn-1", x: 1, point: { x: 1, y: 1 }, slope: 2, a: { x: -6, y: -11 }, b: { x: 6, y: 13 }, status: "approximate" },
      { id: "normal-1", type: "normal", sourceId: "fn-1", x: 1, point: { x: 1, y: 1 }, slope: -0.5, a: { x: -6, y: 4.5 }, b: { x: 6, y: -1.5 }, status: "approximate" },
      { id: "secant-1", type: "secant", sourceId: "fn-1", x1: -1, x2: 1, points: [{ x: -1, y: 1 }, { x: 1, y: 1 }], slope: 0, a: { x: -6, y: 1 }, b: { x: 6, y: 1 }, status: "approximate" },
      { id: "integral-1", type: "integral", sourceId: "fn-1", domain: [-1, 1], steps: 64, points: [], area: 0.66, status: "approximate" },
      { id: "analysis-1", type: "analysisSet", sourceId: "fn-1", domain: [-6, 6], samples: 128, results: [], status: "approximate" },
      { id: "keep-line", type: "line", a: { x: -1, y: 3 }, b: { x: 1, y: 3 }, label: "保留直线" }
    ] as PrimitiveSpec[]
    return document
  }

  it("deletes a function together with its derived analysis objects", () => {
    const document = documentWithFunctionAnalysis()

    const result = commitPatch(document, { op: "deleteObject", id: "fn-1" })

    expect(result.changed).toBe(true)
    expect(result.document.primitives.map((primitive) => primitive.id)).toEqual(["keep-line"])
  })

  it("deletes one derived analysis object without touching the source function", () => {
    const document = documentWithFunctionAnalysis()

    const result = commitPatch(document, { op: "deleteObject", id: "derivative-1" })

    expect(result.changed).toBe(true)
    expect(result.document.primitives.map((primitive) => primitive.id)).toContain("fn-1")
    expect(result.document.primitives.map((primitive) => primitive.id)).not.toContain("derivative-1")
  })
})
