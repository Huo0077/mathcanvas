import { describe, expect, it } from "vitest"
import { createDefaultCadLayout, createEmptyDocument, validateDocument } from "./index"

/**
 * 一只**拓扑已经合法**的四面体文档（`solid-1` 的构造按参数替换）。
 *
 * 棱柱的断言要落在"构造描述"上，而拓扑那几条（顶点 / 棱 / 面引用、闭合边界）与它无关；
 * 共用这一份夹具之后，构造成立与否是唯一变量。
 */
function prismDocument(construction: unknown, options?: Parameters<typeof validateDocument>[1]) {
  const document = createEmptyDocument("geometry3d")
  document.primitives = [
    { id: "point-a", type: "point3", position: { x: 0, y: 0, z: 0 } },
    { id: "point-b", type: "point3", position: { x: 1, y: 0, z: 0 } },
    { id: "point-c", type: "point3", position: { x: 0, y: 1, z: 0 } },
    { id: "point-d", type: "point3", position: { x: 0, y: 0, z: 1 } },
    { id: "edge-ab", type: "edge3", pointIds: ["point-a", "point-b"] },
    { id: "edge-ac", type: "edge3", pointIds: ["point-a", "point-c"] },
    { id: "edge-ad", type: "edge3", pointIds: ["point-a", "point-d"] },
    { id: "edge-bc", type: "edge3", pointIds: ["point-b", "point-c"] },
    { id: "edge-bd", type: "edge3", pointIds: ["point-b", "point-d"] },
    { id: "edge-cd", type: "edge3", pointIds: ["point-c", "point-d"] },
    { id: "face-abc", type: "face3", pointIds: ["point-a", "point-b", "point-c"], edgeIds: ["edge-ab", "edge-bc", "edge-ac"] },
    { id: "face-abd", type: "face3", pointIds: ["point-a", "point-b", "point-d"], edgeIds: ["edge-ab", "edge-bd", "edge-ad"] },
    { id: "face-acd", type: "face3", pointIds: ["point-a", "point-c", "point-d"], edgeIds: ["edge-ac", "edge-cd", "edge-ad"] },
    { id: "face-bcd", type: "face3", pointIds: ["point-b", "point-c", "point-d"], edgeIds: ["edge-bc", "edge-cd", "edge-bd"] },
    {
      id: "solid-1",
      type: "polyhedron3",
      vertexIds: ["point-a", "point-b", "point-c", "point-d"],
      edgeIds: ["edge-ab", "edge-ac", "edge-ad", "edge-bc", "edge-bd", "edge-cd"],
      faceIds: ["face-abc", "face-abd", "face-acd", "face-bcd"],
      construction: construction as never
    }
  ]
  return validateDocument(document, options)
}

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

  /**
   * **斜棱柱的构造描述**（Solid/Prism 切片 Task 1）。
   *
   * 设计规格 §3.2 的口径："多边形至少三个点、无自交、底面点共面、向量有限且非零"。
   * 这一层只钉**字段与数值**那几条（点数、有限性、非零向量）：
   * 自交 / 共面 / 面积这类**几何语义**由确定性 evaluator（`@draw/geometry-kernel` 的
   * `validatePrismInput`）负责，schema 不实现第二份会与它分叉的判据（规格 §6.2）。
   */
  /**
   * **规格 §3.2 的输入形式必须被接受**（Fix round 2 / I6 + Deviation 5）。
   *
   * 规格给的例子是 `base.plane` + **二维** `{x,y}` 多边形点。之前 schema 只认三维点，
   * 于是"照规格写出来的文档"**打不开** —— 这不是少一个功能，是规格自己的例子非法。
   * 现在两种输入形式都收：二维形式由 codec 在解析边界抬到世界顶点（存储形式不变）。
   *
   * 这一层只做**形状**校验；自交 / 共面这类几何语义由内核的 `validatePrismInput` 负责，
   * 经 `prismConstructionValidator` 钩子接进来（规格 §6.2：schema 不重复实现几何语义）。
   */
  it("accepts the spec's plane + 2-D polygon input form and still rejects malformed ones", () => {
    const plane = { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } }
    const polygon2d = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 5, y: 2 }, { x: 1, y: 2 }]
    const vector = { x: 1, y: 0.5, z: 3 }

    const build = (construction: unknown) => prismDocument(construction)
    // 规格 §3.2 的形式：2-D 点 + 平面。
    expect(build({ kind: "prism", base: { plane, polygon: polygon2d }, vector }).valid).toBe(true)
    // 存储形式（世界顶点）照旧。
    expect(build({ kind: "prism", base: { polygon: polygon2d.map((point) => ({ x: point.x, y: point.y, z: 0 })) }, vector }).valid).toBe(true)

    for (const bad of [
      // 平面缺法向 / 法向为零
      { kind: "prism", base: { plane: { origin: { x: 0, y: 0, z: 0 } }, polygon: polygon2d }, vector },
      { kind: "prism", base: { plane: { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 0 } }, polygon: polygon2d }, vector },
      // 2-D 点里混进非有限数
      { kind: "prism", base: { plane, polygon: [...polygon2d.slice(0, 3), { x: 1, y: Number.NaN }] }, vector },
      // 少于三个点
      { kind: "prism", base: { plane, polygon: polygon2d.slice(0, 2) }, vector },
      // 点既不是合法的三维坐标、也不是合法的二维坐标
      { kind: "prism", base: { plane, polygon: [...polygon2d.slice(0, 3), { x: 1 }] }, vector }
    ]) {
      const result = build(bad)
      expect(result.valid).toBe(false)
      if (!result.valid) expect(result.errors.join(" ")).toContain("prism")
    }
  })

  /**
   * **几何语义经钩子在文档校验期执行**（Fix round 2 / I6）。
   *
   * `@draw/dsl` 不能依赖 `@draw/geometry-kernel`（内核依赖 DSL，反向导入会成环），
   * 所以 schema 不自己实现"共面 / 自交"，而是让调用方把内核的那份判据**注入**进来；
   * 这样导入路径（`decodeMgeo`）与创建路径用的是同一个判据，不会分叉。
   */
  it("runs an injected prism semantics check and reports it against the solid", () => {
    const construction = { kind: "prism", base: { polygon: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }] }, vector: { x: 0, y: 0, z: 1 } }

    expect(prismDocument(construction).valid).toBe(true)

    const strict = prismDocument(construction, { prismConstructionValidator: () => ["底面多边形自交。"] })
    expect(strict.valid).toBe(false)
    if (!strict.valid) expect(strict.errors).toContain("solid-1 prism base is invalid: 底面多边形自交。")
  })

  it("validates the construction descriptor of a prism solid", () => {
    const base = [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 3, z: 0 }]
    const vector = { x: 1, y: 0.5, z: 3 }

    const build = (construction: unknown) => prismDocument(construction)

    expect(build({ kind: "prism", base: { polygon: base }, vector }).valid).toBe(true)

    // 向量必须有限且非零：零向量拉伸出来的"棱柱"是退化的。
    for (const bad of [{ x: 0, y: 0, z: 0 }, { x: 1, y: Number.NaN, z: 0 }, { x: 0, y: 0 }, { x: 0, y: 1, z: Number.POSITIVE_INFINITY }]) {
      const result = build({ kind: "prism", base: { polygon: base }, vector: bad })
      expect(result.valid).toBe(false)
      if (!result.valid) expect(result.errors).toContain("polyhedron3 prism construction is invalid")
    }

    // 底面至少三个点，且每个点必须是有限的空间坐标。
    for (const polygon of [[], [{ x: 0, y: 0, z: 0 }], [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], [...base, { x: 1, y: 1, z: Number.NaN }], "polygon"]) {
      const result = build({ kind: "prism", base: { polygon }, vector })
      expect(result.valid).toBe(false)
      if (!result.valid) expect(result.errors).toContain("polyhedron3 prism construction is invalid")
    }

    // `base` 只认多边形：缺 base、缺 polygon 都要拒绝，而不是当成"空底面"放过。
    for (const construction of [{ kind: "prism", vector }, { kind: "prism", base: {}, vector }, { kind: "prism", base: { polygon: base } }]) {
      expect(build(construction).valid).toBe(false)
    }
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

  /**
   * 交面的**面积精度**标注（A2）。
   *
   * 平面区域（圆盘 / 多边形）的面积是闭式的——整圆 `πr²`、多边形就是它自己的面积；曲面区域
   * （圆柱 / 圆锥侧面）的面积是网格面片求和，是**数值近似**。两者读数上必须分得清，
   * 所以图元带一个显式的布尔标注。字段可选：旧文档没有它，行为不变。
   */
  it("validates the area-precision flag on an intersection face", () => {
    const document = createEmptyDocument("geometry3d")
    const cube = { id: "cube-1", type: "cube", origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
    const cylinder = { id: "cyl-1", type: "cylinder", center: { x: 0, y: 0, z: -2 }, radius: 1.5, height: 4, segments: 24 }
    const face = (areaExact: unknown) => ({
      id: "face-1", type: "intersectionFace", sourceIds: ["cube-1", "cyl-1"],
      points: [{ x: 0, y: 0, z: 0 }], normal: { x: 0, y: 0, z: 1 }, area: 1, hint: { x: 0, y: 0, z: 0 },
      status: "valid", areaExact
    })
    const withFlag = (areaExact: unknown) => validateDocument({ ...document, primitives: [cube, cylinder, face(areaExact)] })

    expect(withFlag(true).valid).toBe(true)
    expect(withFlag(false).valid).toBe(true)
    // 旧文档：根本没有这个字段。
    expect(withFlag(undefined).valid).toBe(true)
    expect(withFlag("yes").valid).toBe(false)
    expect(withFlag(1).valid).toBe(false)
    expect(withFlag(null).valid).toBe(false)
  })

  /**
   * 曲面区域的 `points` 是"外环 + 其余环反向缝合"的多边形（A2）：前导外环的顶点数是**渲染三角化**的依据——
   * 按环向条带缝，而不是从 `points[0]` 扇形铺开（扇形会把两根环之间的洞整块填掉）。
   *
   * 只收 ≥ 3 的整数：小于 3 缝不出条带，小数不是顶点数（字符串更不是）。字段可选，旧文档没有它。
   */
  it("validates the leading outer ring length on an intersection face", () => {
    const document = createEmptyDocument("geometry3d")
    const cube = { id: "cube-1", type: "cube", origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
    const cylinder = { id: "cyl-1", type: "cylinder", center: { x: 0, y: 0, z: -2 }, radius: 1.5, height: 4, segments: 48 }
    const face = (outerRingLength: unknown) => ({
      id: "face-1", type: "intersectionFace", sourceIds: ["cube-1", "cyl-1"],
      points: [{ x: 0, y: 0, z: 0 }], normal: { x: 0, y: 0, z: 1 }, area: 1, hint: { x: 0, y: 0, z: 0 },
      status: "valid", outerRingLength
    })
    const withLength = (outerRingLength: unknown) => validateDocument({ ...document, primitives: [cube, cylinder, face(outerRingLength)] })

    expect(withLength(48).valid).toBe(true)
    // 旧文档没有这个字段（平面区域也永远不会写它）：`valid` 为真就等价于 `errors` 为空。
    expect(withLength(undefined).valid).toBe(true)
    // 0 / 2.5 / "48" 都不是"≥3 的整数顶点数"，必须各自报出同一条错。
    for (const invalid of [0, 2.5, "48"]) {
      const result = withLength(invalid)
      expect(result.valid).toBe(false)
      if (!result.valid) expect(result.errors).toContain("intersectionFace outerRingLength is invalid")
    }
  })

  /**
   * 解析截面（A1）：`section.exact` 里是**精确**圆锥曲线 + 片段环。系数是精确真源，
   * 非有限数或错长度必须被拦住；旧文档没有这个字段，行为不变。
   */
  it("validates the exact analytic boundary written for round solids", () => {
    const document = createDefaultCadLayout(createEmptyDocument("cad"))
    const cube = { id: "cube-1", type: "cube", origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }
    const conic = (overrides: Record<string, unknown> = {}) => ({
      kind: "circle",
      frame: { origin: { x: 0, y: 0, z: 1 }, u: { x: 0, y: -1, z: 0 }, v: { x: 1, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } },
      coefficients: [1, 0, 1, 0, 0, -4],
      center: { x: 0, y: 0, z: 1 },
      semiMajor: 2,
      semiMinor: 2,
      eccentricity: 0,
      axes: { major: { x: 1, y: 0, z: 0 }, minor: { x: 0, y: 1, z: 0 } },
      closed: true,
      ...overrides
    })
    const piece = { kind: "conic", conic: conic(), parameterRange: [0, Math.PI * 2] }
    const segment = { kind: "segment", a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 } }
    const section = (exact: unknown) => ({
      id: "section-1", type: "section", sourceId: "cube-1",
      plane: { normal: { x: 0, y: 0, z: 1 }, constant: -1 },
      points: [{ x: 0, y: 0, z: 1 }], classification: "polygon", status: "approximate", exact
    })
    const withExact = (exact: unknown) => validateDocument({ ...document, primitives: [cube, section(exact)] }).valid

    expect(withExact({ kind: "circle", loops: [[piece]] })).toBe(true)
    expect(withExact({ kind: "ellipse", loops: [[piece, segment]] })).toBe(true)
    // 反向片段（把环接起来时会翻转方向）必须合法：参数区间不要求升序。
    expect(withExact({ kind: "ellipse", loops: [[{ kind: "conic", conic: conic(), parameterRange: [2, 1] }, segment]] })).toBe(true)
    expect(withExact({ kind: "hyperbola", loops: [[{ kind: "conic", conic: conic({ kind: "hyperbola" }), parameterRange: [0, 1], branch: 1 }]] })).toBe(true)
    // 旧文档：没有这个字段。
    expect(section(undefined) && validateDocument({ ...document, primitives: [cube, section(undefined)] }).valid).toBe(true)

    expect(withExact({ kind: "spiral", loops: [[piece]] })).toBe(false)
    expect(withExact({ kind: "circle", loops: "ring" })).toBe(false)
    expect(withExact({ kind: "circle", loops: [[segment, { kind: "arc", a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 } }]] })).toBe(false)
    expect(withExact({ kind: "circle", loops: [[{ kind: "conic", conic: conic({ coefficients: [1, 0, 1, 0, 0] }), parameterRange: [0, 1] }]] })).toBe(false)
    expect(withExact({ kind: "circle", loops: [[{ kind: "conic", conic: conic({ coefficients: [1, 0, 1, 0, 0, Number.NaN] }), parameterRange: [0, 1] }]] })).toBe(false)
    expect(withExact({ kind: "circle", loops: [[{ kind: "conic", conic: conic(), parameterRange: [0] }]] })).toBe(false)
    expect(withExact({ kind: "circle", loops: [[{ kind: "conic", conic: conic(), parameterRange: [0, 1], branch: -1 }]] })).toBe(false)
    expect(withExact({ kind: "circle", loops: [[segment, { kind: "segment", a: { x: 0, y: 0, z: Number.NaN }, b: { x: 1, y: 0, z: 0 } }]] })).toBe(false)
  })

  /**
   * 封闭曲线绕定点旋转（圆 / 椭圆）。
   *
   * 校验要点是**定点必须落在文档里**：引用一个不存在的点、引用一个不是点的图元、或者坐标里带 NaN，
   * 都会让"曲线过定点"这条性质静默失效（曲线照画，就是不经过那个点），必须在保存前拦住。
   */
  it("validates a closed curve rotating about a fixed point", () => {
    const build = (curve: Record<string, unknown>) => {
      const document = createEmptyDocument("conics")
      document.primitives = [
        { id: "point-1", type: "point", x: 3, y: 0 },
        { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 3, ...curve }
      ]
      return validateDocument(document).valid
    }
    const fixed = (pivot: unknown, angle: unknown = Math.PI / 6) => ({ pivot, angle, baseCenter: { x: 0, y: 0 } })

    expect(build({ rotationAbout: fixed({ kind: "coordinate", x: 3, y: 0 }) })).toBe(true)
    expect(build({ rotationAbout: fixed({ kind: "primitive", primitiveId: "point-1" }) })).toBe(true)
    expect(build({ rotation: 0.4, rotationAbout: fixed({ kind: "coordinate", x: 3, y: 0 }) })).toBe(true)
    // 没有放置信息仍然是合法的：旧文档行为必须逐位不变。
    expect(build({})).toBe(true)

    expect(build({ rotationAbout: fixed({ kind: "coordinate", x: Number.NaN, y: 0 }) })).toBe(false)
    expect(build({ rotationAbout: fixed({ kind: "coordinate", x: 3 }) })).toBe(false)
    expect(build({ rotationAbout: fixed({ kind: "primitive", primitiveId: "missing" }) })).toBe(false)
    expect(build({ rotationAbout: fixed({ kind: "primitive", primitiveId: "circle-1" }) })).toBe(false)
    expect(build({ rotationAbout: fixed({ kind: "coordinate", x: 3, y: 0 }, Number.POSITIVE_INFINITY) })).toBe(false)
    expect(build({ rotationAbout: fixed({ kind: "coordinate", x: 3, y: 0 }, "half") })).toBe(false)
    expect(build({ rotationAbout: { pivot: { kind: "coordinate", x: 3, y: 0 } } })).toBe(false)
    expect(build({ rotationAbout: null })).toBe(false)
    expect(build({ rotation: "tilted" })).toBe(false)
    // 基准圆心是必需项：缺了它重算就会把"转过的位置"当基准，越转越偏。
    expect(build({ rotationAbout: { pivot: { kind: "coordinate", x: 3, y: 0 }, angle: 0 } })).toBe(false)
    expect(build({ rotationAbout: { pivot: { kind: "coordinate", x: 3, y: 0 }, angle: 0, baseCenter: { x: Number.NaN, y: 0 } } })).toBe(false)
    expect(build({ rotationAbout: { pivot: { kind: "coordinate", x: 3, y: 0 }, angle: 0, baseCenter: { x: 0 } } })).toBe(false)
  })

  /** 双曲线 / 圆弧都**不支持**绕定点旋转：它们不是封闭曲线，这个字段必须被拒绝而不是被忽略。 */
  it("rejects rotation about a fixed point on the curves that are not closed", () => {
    const document = createEmptyDocument("conics")
    const placement = { pivot: { kind: "coordinate", x: 1, y: 0 }, angle: 0.5 }

    const hyperbola = validateDocument({
      ...document,
      primitives: [{ id: "h", type: "hyperbola", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2, axis: "x", rotationAbout: placement }]
    })
    const arc = validateDocument({
      ...document,
      primitives: [{ id: "a", type: "arc", center: { x: 0, y: 0 }, radius: 2, startAngle: 0, endAngle: 1, rotationAbout: placement }]
    })

    expect(hyperbola.valid).toBe(false)
    expect(arc.valid).toBe(false)
  })

  /**
   * 动圆要能量面积 / 周长 / 半径，这三个度量名必须能存进文档。
   * 度量名以前也是一处写死的字面量列表（校验一处、读数名一处），所以这里同时钉住"名单是共用的"。
   */
  it("accepts the perimeter and radius metrics", () => {
    const document = createEmptyDocument("conics")
    const withMeasurements = {
      ...document,
      primitives: [{ id: "circle-1", type: "circle" as const, center: { x: 0, y: 0 }, radius: 3 }],
      measurements: [
        { id: "m-1", kind: "measurement3" as const, sourceIds: ["circle-1"], metric: "perimeter" as const, value: 6 * Math.PI, unit: "u", precision: "numeric-approximation" as const, status: "valid" as const, explanation: "" },
        { id: "m-2", kind: "measurement3" as const, sourceIds: ["circle-1"], metric: "radius" as const, value: 3, unit: "u", precision: "numeric-approximation" as const, status: "valid" as const, explanation: "" }
      ]
    }
    const result = validateDocument(withMeasurements)
    expect(result.valid ? [] : result.errors.filter((error) => error.includes("metric"))).toEqual([])

    // 名单之外的名字仍然要被拒绝（这条名单不是"什么都收"）。
    const bogus = validateDocument({ ...withMeasurements, measurements: [{ ...withMeasurements.measurements[0], metric: "circumference" }] })
    expect(bogus.valid).toBe(false)
  })

  /**
   * **平面点的 `parameterId` 必须指向真实存在的参数**（Agent DSL 切片 Task 1，规格 §4.1）。
   *
   * 空间点（`point3`）的宿主绑定早就检查了这一条（见 `onHost` / `onFace` / `onSurface` / `inSolid`
   * 那几行），理由是"悬空引用会让点**静默冻住**，而文档依然能保存"。平面点的 `onPath`
   * 绑定可以同样由文档参数驱动（符号参数 θ 驱动圆周动点，规格 §8.2），但那条检查一直没有 ——
   * 于是同样的悬空引用在平面侧只是被静默接受。
   */
  it("rejects a path-bound point whose parameter reference does not exist", () => {
    const build = (binding: unknown, parameters: Record<string, unknown> = {}) => {
      const document = createEmptyDocument("conics")
      document.parameters = parameters as never
      document.primitives = [
        { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 3 },
        { id: "point-1", type: "point", x: 3, y: 0, binding: binding as never }
      ]
      return validateDocument(document)
    }

    // 参数存在 → 绑定成立（符号参数驱动的动点）。
    expect(build({ kind: "onPath", pathId: "circle-1", parameter: 0.4, parameterId: "theta" }, { theta: { id: "theta", value: 0.4 } }).valid).toBe(true)
    // 参数不存在 → 悬空引用必须被拒（否则点会静默冻在最后一次算出的位置）。
    const dangling = build({ kind: "onPath", pathId: "circle-1", parameter: 0.4, parameterId: "theta" })
    expect(dangling.valid).toBe(false)
    if (!dangling.valid) expect(dangling.errors.join(" ")).toContain("parameter")
    // 非字符串同拒。
    expect(build({ kind: "onPath", pathId: "circle-1", parameter: 0.4, parameterId: 7 }).valid).toBe(false)
  })
})
