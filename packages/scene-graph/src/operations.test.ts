import { describe, expect, it } from "vitest"

import { createDefaultCadLayout, createEmptyDocument } from "@draw/dsl"

import { commitPatch } from "./patches"

function cadDocument() {
  return createDefaultCadLayout(createEmptyDocument("cad"))
}

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
