import { describe, expect, it } from "vitest"

import { createDefaultCadLayout, createEmptyDocument, type PrimitiveSpec } from "@draw/dsl"
import { buildSolidTemplate } from "@draw/geometry-kernel"

import { commitPatch } from "./patches"

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
