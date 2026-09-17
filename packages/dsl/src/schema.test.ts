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

  /**
   * 体检发现的真缺陷：`document.parameters` 只查了"是个对象"，条目本身从不校验。于是：
   * `parameters: null` 会通过校验、渲染时读 `document.parameters.slope` 直接白屏；
   * `{ "area": { id: "other", value: 1 } }` 让按 key 的查找 / 删除找不到条目，编辑静默丢失；
   * `value: "3"` 一路传到几何计算里变成 NaN，而这样的文档再也存不回去。
   */
  it("validates every parameter entry, not just the container", () => {
    const withParameters = (parameters: unknown) => validateDocument({ ...createEmptyDocument("conics"), parameters })
    const spec = (overrides: Record<string, unknown> = {}) => ({ p: { id: "p", value: 1, ...overrides } })

    expect(withParameters(spec()).valid).toBe(true)
    expect(withParameters(spec({ expression: "2*pi", min: 0, max: 10, step: 0.5, label: "半径", ownerId: "point-1" })).valid).toBe(true)

    expect(withParameters(null).valid).toBe(false)
    expect(withParameters({ p: null }).valid).toBe(false)
    expect(withParameters({ p: 3 }).valid).toBe(false)
    // key 与 id 必须一致：不一致时按 key 找不到参数，编辑会被静默丢弃。
    expect(withParameters(spec({ id: "other" })).valid).toBe(false)
    expect(withParameters(spec({ id: "" })).valid).toBe(false)
    expect(withParameters(spec({ value: "3" })).valid).toBe(false)
    expect(withParameters(spec({ value: Number.NaN })).valid).toBe(false)
    expect(withParameters(spec({ value: Number.POSITIVE_INFINITY })).valid).toBe(false)
    expect(withParameters(spec({ expression: 3 })).valid).toBe(false)
    expect(withParameters(spec({ min: "0" })).valid).toBe(false)
    expect(withParameters(spec({ max: Number.NaN })).valid).toBe(false)
    expect(withParameters(spec({ step: 0 })).valid).toBe(false)
    expect(withParameters(spec({ label: 3 })).valid).toBe(false)
    expect(withParameters(spec({ ownerId: 3 })).valid).toBe(false)
  })

  /**
   * 同一次体检：`metadata` 只查了 `id`。`App.tsx` 的导出路径读 `metadata.name.replace(...)`
   * 来生成文件名，一个缺 `name` 的文件能通过校验、打开后一按"导出"就抛 TypeError。
   */
  it("requires complete document metadata", () => {
    const document = createEmptyDocument("conics")
    const withMetadata = (metadata: unknown) => validateDocument({ ...document, metadata })

    expect(withMetadata({ id: "doc-1", name: "示例" }).valid).toBe(true)
    expect(withMetadata({ id: "doc-1" }).valid).toBe(false)
    expect(withMetadata({ name: "示例" }).valid).toBe(false)
    expect(withMetadata({ id: "doc-1", name: 3 }).valid).toBe(false)
    expect(withMetadata({ id: "doc-1", name: "" }).valid).toBe(false)
    expect(withMetadata(null).valid).toBe(false)
  })

  /**
   * 圆类实体（圆柱 / 圆锥）的多边形近似顶点与母线带 `tessellation` 标记：它们留在文档里参与面 / 棱 /
   * 交线计算，但不展示、不列出、点不到。只允许布尔值，缺省表示普通的用户对象（旧文档因此完全不受影响）。
   */
  it("validates the tessellation flag on round-solid vertices and generatrices", () => {
    const document = { ...createEmptyDocument("geometry3d") }
    const point = (overrides: Record<string, unknown> = {}) => ({ id: "point-a", type: "point3", position: { x: 0, y: 0, z: 0 }, ...overrides })
    // 棱必须引用真实存在的点，否则文档会因为"引用缺失"而整体无效，测不到 `tessellation` 这一条。
    const endpoints = [point({ id: "point-a" }), point({ id: "point-b", position: { x: 1, y: 0, z: 0 } })]
    const edge = (overrides: Record<string, unknown> = {}) => ({ id: "edge-a", type: "edge3", pointIds: ["point-a", "point-b"], ...overrides })

    expect(validateDocument({ ...document, primitives: [point({ tessellation: true })] }).valid).toBe(true)
    expect(validateDocument({ ...document, primitives: [point({ tessellation: false })] }).valid).toBe(true)
    expect(validateDocument({ ...document, primitives: [point()] }).valid).toBe(true)
    expect(validateDocument({ ...document, primitives: [point({ tessellation: "yes" })] }).valid).toBe(false)

    expect(validateDocument({ ...document, primitives: [...endpoints, edge({ tessellation: true })] }).valid).toBe(true)
    expect(validateDocument({ ...document, primitives: [...endpoints, edge()] }).valid).toBe(true)
    expect(validateDocument({ ...document, primitives: [...endpoints, edge({ tessellation: 1 })] }).valid).toBe(false)
  })

  /**
   * 同一次体检：`section.points` 有校验，`section.loops` 没有。`loops` 直接喂给 3D 预览的
   * 描边与三角化路径，非数组、环不是数组或坐标非有限都会让渲染层抛异常或画出 NaN 顶点。
   */
  it("validates the optional section loops used by the 3D preview", () => {
    const document = createDefaultCadLayout(createEmptyDocument("cad"))
    const cube = { id: "cube-1", type: "cube", origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }
    const valid = { x: 0, y: 0, z: 0 }
    const section = (loops: unknown) => ({
      id: "section-1", type: "section", sourceId: "cube-1",
      plane: { normal: { x: 0, y: 0, z: 1 }, constant: 0 },
      points: [valid], classification: "point", status: "approximate", loops
    })

    expect(validateDocument({ ...document, primitives: [cube, section([[valid]])] }).valid).toBe(true)
    expect(validateDocument({ ...document, primitives: [cube, section(undefined)] }).valid).toBe(true)
    expect(validateDocument({ ...document, primitives: [cube, section("loops")] }).valid).toBe(false)
    expect(validateDocument({ ...document, primitives: [cube, section([valid])] }).valid).toBe(false)
    expect(validateDocument({ ...document, primitives: [cube, section([[valid], "ring"])] }).valid).toBe(false)
    expect(validateDocument({ ...document, primitives: [cube, section([[{ x: 0, y: Number.NaN, z: 0 }]])] }).valid).toBe(false)
  })
})
