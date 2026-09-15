import { describe, expect, it } from "vitest"
import { createDefaultCadLayout, createEmptyDocument, validateDocument } from "./index"

describe("Geometry DSL document layout schema", () => {
  it("rejects duplicate layer, sheet, and view IDs", () => {
    const document = createDefaultCadLayout(createEmptyDocument("cad"))
    document.layers?.push({ ...document.layers[0] })
    document.drawingViews?.push({ ...document.drawingViews[0] })
    document.drawingSheets?.push({ ...document.drawingSheets[0] })

    const result = validateDocument(document)

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toContain("duplicate layer id: layer-geometry")
      expect(result.errors).toContain("duplicate drawing view id: view-front")
      expect(result.errors).toContain("duplicate drawing sheet id: sheet-1")
    }
  })

  it("rejects unknown layer kinds and invalid parent IDs", () => {
    const document = createDefaultCadLayout(createEmptyDocument("cad"))
    document.layers?.push({
      id: "layer-invalid",
      name: "Invalid",
      parentId: "missing-layer",
      kind: "unknown" as never,
      visible: true,
      locked: false,
      printable: true
    })

    const result = validateDocument(document)

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toContain("layer kind is invalid: layer-invalid")
      expect(result.errors).toContain("layer parent is missing: layer-invalid")
    }
  })

  it("accepts nested layers regardless of declaration order", () => {
    const document = createDefaultCadLayout(createEmptyDocument("cad"))
    const parent = document.layers![0]
    const child = { ...parent, id: "layer-child", name: "Child", parentId: parent.id }
    document.layers = [child, parent, ...document.layers!.slice(1)]

    expect(validateDocument(document)).toEqual({ valid: true })
  })

  it("rejects non-positive view dimensions and scales", () => {
    const document = createDefaultCadLayout(createEmptyDocument("cad"))
    document.drawingViews![0].width = 0
    document.drawingViews![1].height = -1
    document.drawingViews![2].scale = 0

    const result = validateDocument(document)

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toContain("drawing view width is invalid: view-front")
      expect(result.errors).toContain("drawing view height is invalid: view-top")
      expect(result.errors).toContain("drawing view scale is invalid: view-left")
    }
  })

  it("rejects sheets that reference missing views", () => {
    const document = createDefaultCadLayout(createEmptyDocument("cad"))
    document.drawingSheets![0].viewIds = ["missing-view"]

    const result = validateDocument(document)

    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors).toContain("drawing sheet references missing view: sheet-1")
  })

  it("rejects primitives that reference a missing layer", () => {
    const document = createDefaultCadLayout(createEmptyDocument("cad"))
    const primitive = { id: "point-1", type: "point", x: 1, y: 2, layerId: "missing-layer" }

    const result = validateDocument({ ...document, primitives: [primitive] })

    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors).toContain("primitive layer is missing: point-1")
  })
})
