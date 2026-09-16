import { describe, expect, it } from "vitest"
import { createDefaultCadLayout, createEmptyDocument, validateDocument } from "./index"

describe("Geometry DSL document layout schema", () => {
  /**
   * 抛物线与双曲线的绑定参数是无界的轴向参数，所以绑定要自带一个递增的有限 `domain` 作为扫描窗口。
   */
  it("validates the parameter domain and branch of a path-bound point", () => {
    const build = (binding: unknown) => {
      const document = createEmptyDocument("conics")
      document.primitives = [
        { id: "parabola-1", type: "parabola", vertex: { x: 0, y: 0 }, focalParameter: 2, axis: "y" },
        { id: "hyperbola-1", type: "hyperbola", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2, axis: "x" },
        { id: "point-1", type: "point", x: 0, y: 0, binding: binding as never }
      ]
      return validateDocument(document)
    }

    expect(build({ kind: "onPath", pathId: "parabola-1", parameter: 0, domain: [-4, 4] }).valid).toBe(true)
    expect(build({ kind: "onPath", pathId: "hyperbola-1", parameter: 0, domain: [-6, 6], branch: 1 }).valid).toBe(true)
    // A plain onPath binding with no domain stays valid: bounded curves do not need one.
    expect(build({ kind: "onPath", pathId: "parabola-1", parameter: 0 }).valid).toBe(true)

    for (const domain of [[4, -4], [1, 1], [0], [-1, 1, 2], [Number.NaN, 1], "wide", null]) {
      expect(build({ kind: "onPath", pathId: "parabola-1", parameter: 0, domain }).valid).toBe(false)
    }
    expect(build({ kind: "onPath", pathId: "hyperbola-1", parameter: 0, branch: 2 }).valid).toBe(false)
    expect(build({ kind: "onPath", pathId: "hyperbola-1", parameter: 0, branch: -1 }).valid).toBe(false)
  })

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
