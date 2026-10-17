import { describe, expect, it } from "vitest"

import { ACTIONS, SOLID_TEMPLATES } from "./actionRegistry"
import { allActionToolSchemas, actionToolSchema, parseActionToolInput } from "./actionSchemas"

describe("action tool schemas", () => {
  it("generates one strict schema for every registered action", () => {
    const schemas = allActionToolSchemas()

    expect(schemas).toHaveLength(Object.keys(ACTIONS).length)
    expect(new Set(schemas.map((schema) => schema.actionId)).size).toBe(schemas.length)
    for (const schema of schemas) {
      expect(schema.inputSchema.type).toBe("object")
      expect(schema.inputSchema.additionalProperties).toBe(false)
    }
  })

  it("publishes enum and required metadata from the action registry", () => {
    const schema = actionToolSchema("solid.create_template")

    expect(schema.inputSchema.required).toEqual(expect.arrayContaining(["alias", "template"]))
    expect(schema.inputSchema.properties?.template?.enum).toEqual(SOLID_TEMPLATES)
  })

  it("models list references as arrays of strings", () => {
    const schema = actionToolSchema("object.delete_many")

    expect(schema.inputSchema.properties?.targets).toMatchObject({ type: "array", items: { type: "string" } })
  })
})

/**
 * **发布出去的 schema 与真正接受的载荷必须是同一种东西**（2026-10-15 用户现场）。
 *
 * 现场那一轮，模型的两份计划都被信封拒了，理由**恰好是两条它无从知道的规矩**：
 * `a planar face needs at least three vertices`（面片至少三个点）与
 * `vertex name 'F' is used twice`（`vertexNames` 不许重名）。校验器（`actionInputs.ts`）
 * 一直执行这两条，而发布出去的 schema 里**一条都没写** —— 模型只能一轮踩一条，
 * 修复机会用完就整轮停。本仓在切线那次 P0-A 就立过这条规矩（"发布出去的 schema 与
 * 真正接受的载荷是同一种东西"），这一组用例把它钉在**枚举全部动作**的层面，
 * 而不是靠人记得逐个看。
 */
describe("发布的 schema 不许隐瞒校验器会执行的规矩", () => {
  it("名字表一律 `uniqueItems`：四个动作的校验器都判重名", () => {
    const withNames = allActionToolSchemas().filter((schema) => schema.inputSchema.properties?.vertexNames !== undefined)
    expect(withNames.length, "至少要覆盖棱柱 / 多面体 / 面片 / 折面").toBeGreaterThanOrEqual(4)
    for (const schema of withNames) {
      expect(schema.inputSchema.properties?.vertexNames, schema.actionId).toMatchObject({ type: "array", uniqueItems: true })
    }
  })

  it("面片（`solid.create_face` / `solid.fold` / 单面多面体）的 `vertices` 是**至少三个**，不是四个", () => {
    /**
     * 校验器对面片的要求是 "≥ 3 个点"（`a planar face needs at least three vertices`），
     * 而通用的 `vertexList` 种类发布的是 `minItems: 4`（那是**闭合多面体**的下限）。
     * 面片写成三角形是**合法且常见**的（`平面 PAD` 就是三角形），
     * 发布 4 会让模型以为三角形面片不被接受 —— 于是它要么改用多面体去套、要么凑第四个点
     *（现场第二次那份计划里的重名 `F` 正是"凑点"的形状）。
     *
     * 2026-10-17：`solid.create_polyhedron` 兼容 **1 个面**（平面多边形）之后，它也是同一档
     * —— 3 个顶点 + 1 个面环就是合法的平面三角形；`faces` 的下限随之落到 1。
     */
    expect(actionToolSchema("solid.create_face").inputSchema.properties?.vertices).toMatchObject({ minItems: 3 })
    expect(actionToolSchema("solid.fold").inputSchema.properties?.vertices).toMatchObject({ minItems: 3 })
    expect(actionToolSchema("solid.create_polyhedron").inputSchema.properties?.vertices).toMatchObject({ minItems: 3 })
    // 闭合多面体的面数下限**照旧是 4**，但单面多边形是 1 —— 发布 1，让 1 个面能过。
    expect(actionToolSchema("solid.create_polyhedron").inputSchema.properties?.faces).toMatchObject({ minItems: 1 })
  })

  it("棱柱的 `vertexNames` 是**偶数个且至少六个**（底环 n + 顶环 n）", () => {
    expect(actionToolSchema("solid.create_prism").inputSchema.properties?.vertexNames).toMatchObject({ minItems: 6 })
  })
})

describe("published schemas match the existing action parser", () => {
  it("does not demand fields that parameter audit can safely complete", () => {
    expect(actionToolSchema("solid.create_template").inputSchema.required).toEqual(["alias", "template"])
    expect(actionToolSchema("solid.create_prism").inputSchema.required).toEqual(["alias"])
    expect(actionToolSchema("solid.create_tetrahedron").inputSchema.required).toEqual(["alias"])
  })

  it("uses planar coordinates for planar actions and three coordinates for spatial ones", () => {
    const planar = actionToolSchema("planar.create_circle").inputSchema.properties?.center
    const spatial = actionToolSchema("solid.create_template").inputSchema.properties?.origin
    const size = actionToolSchema("solid.create_template").inputSchema.properties?.size
    expect(planar?.required).toEqual(["x", "y"])
    expect(planar?.properties?.z).toBeUndefined()
    expect(spatial?.required).toEqual(["x", "y", "z"])
    expect(size?.required).toEqual(["x", "y", "z"])
  })

  it("represents the tangent anchor variants rather than a scoped object reference", () => {
    const anchor = actionToolSchema("function.create_tangent").inputSchema.properties?.anchor
    expect(anchor?.oneOf).toEqual(expect.arrayContaining([
      expect.objectContaining({ properties: expect.objectContaining({ kind: expect.objectContaining({ enum: ["point"] }), pointId: expect.objectContaining({ type: "string" }) }) }),
      expect.objectContaining({ properties: expect.objectContaining({ kind: expect.objectContaining({ enum: ["parameter"] }), parameter: expect.objectContaining({ type: "number" }) }) })
    ]))
  })

  it("closes the update patch over the same editable fields as the scene graph", () => {
    const patch = actionToolSchema("object.update_inputs").inputSchema.properties?.patch
    expect(patch?.additionalProperties).toBe(false)
    expect(patch?.properties?.x?.type).toBe("number")
    expect(patch?.properties?.label?.type).toBe("string")
    expect(patch?.properties?.visible?.type).toBe("boolean")
    expect(patch?.properties?.notEditable).toBeUndefined()
  })


  it("publishes every supported three-point and point-normal section plane input", () => {
    const plane = actionToolSchema("section.create").inputSchema.properties?.plane
    const variants = plane?.oneOf ?? []
    expect(variants).toHaveLength(5)
    expect(variants.find((variant) => variant.properties?.points)).toMatchObject({ required: ["points"], properties: { points: { minItems: 3, maxItems: 3 } } })
    expect(variants.find((variant) => variant.properties?.throughPoints)).toMatchObject({ required: ["throughPoints"], properties: { throughPoints: { minItems: 3, maxItems: 3 } } })
    expect(variants.find((variant) => variant.properties?.origin)).toMatchObject({ required: ["origin", "normal"] })
  })

  /**
   * **每类引用字段发布的写法，必须与解析层真正接受的一一对应**（2026-10-10 更新）。
   *
   * 这条用例原先只钉"scoped 才是对象、`id` 是字符串"。真实 provider 现场把它改了：
   * 模型给切线写了 `sourceId: {scope:"draft",alias:"f"}`（它在别处就是这么教它的），
   * 整轮以 `invalid_type@envelope.actions[1].inputs.sourceId: expected a string` 失败。
   * 解析层现在两种都收（见 `schemaReaders.readIdReference`），所以发布的也必须是两种 ——
   * "发布出去的 schema 与真正接受的载荷必须是同一种东西"就是这个文件里的纪律。
   */
  it("publishes exactly the reference spellings each field class accepts", () => {
    // ① scoped 字段：完整两种（草稿别名 / 场景引用）。
    const scoped = actionToolSchema("dynamic.bind_point").inputSchema.properties?.target
    expect(scoped?.oneOf).toHaveLength(2)
    // ② 单个 id 引用字段：裸 id 字符串 + 草稿别名对象。**不发布 scene**（摊平成裸 id 会丢掉跨文档判据）。
    const idRef = actionToolSchema("section.create").inputSchema.properties?.sourceId
    expect(idRef?.oneOf).toHaveLength(2)
    expect(idRef?.oneOf?.[0]).toEqual({ type: "string" })
    expect(idRef?.oneOf?.[1]).toMatchObject({ properties: { scope: { enum: ["draft"] } }, required: ["scope", "alias"], additionalProperties: false })
    // ③ `parameter` 引用不是草稿别名：仍旧只发布字符串。
    const parameterRef = actionToolSchema("parameter.set").inputSchema.properties?.id
    expect(parameterRef?.type).toBe("string")
  })
})

describe("tool inputs reuse the actual plan parser", () => {
  it("accepts a valid create action and gives it the coordinator action key", () => {
    const result = parseActionToolInput("solid.create_template", { alias: "cube", template: "cube", size: { x: 3, y: 3, z: 3 } }, "step-1")
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toMatchObject({ actionId: "solid.create_template", actionKey: "step-1", inputs: { alias: "cube", size: { x: 3, y: 3, z: 3 } } })
  })

  it("rejects undeclared input fields at the model tool boundary", () => {
    const result = parseActionToolInput("solid.create_prism", { alias: "p", faces: [] }, "step-2")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "unknown_field", path: "tool.inputs.faces" })]))
  })

  /**
   * **球**（球体切片 Task 8）：三层都接通之后，模型产出的 `{alias, center, radius}` 必须原样通过。
   *
   * 同时钉住两件与"诚实"有关的事：
   * ① 缺 `center` / `radius` 是**合法的**（两者登记了 `ask_user`，由审计去问用户）——
   *    在这里报 `missing_field` 会把"本该问用户"变成一句生硬的拒绝；
   * ② 半径非正 / 非有限则**当场拒绝**，路径要落在字段上（好让一次性修复够得到它）。
   */
  it("accepts a sphere with a finite centre and a positive radius", () => {
    const result = parseActionToolInput("solid.create_sphere", { alias: "S", center: { x: 1, y: 2, z: 3 }, radius: 5 }, "step-sphere")

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toMatchObject({ actionId: "solid.create_sphere", actionKey: "step-sphere", inputs: { alias: "S", center: { x: 1, y: 2, z: 3 }, radius: 5 } })
  })

  it("lets a sphere omit centre and radius, because both are ask_user fields", () => {
    const result = parseActionToolInput("solid.create_sphere", { alias: "S" }, "step-sphere-2")

    expect(result.ok).toBe(true)
  })

  it("rejects a non-positive sphere radius on the field path, so one-shot repair can reach it", () => {
    const result = parseActionToolInput("solid.create_sphere", { alias: "S", center: { x: 0, y: 0, z: 0 }, radius: 0 }, "step-sphere-3")

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "invalid_type", path: "tool.inputs.radius" })]))
  })

  /**
   * **派生球：宿主是作用域引用，不是裸字符串**（S5）。
   *
   * 这条用例存在的理由很具体：这一族的编译层读的是**已解析的** `{documentId, entityId}`，
   * 而规划器写的是 `{scope:"draft", alias}` / `{scope:"scene", ref}`。第一版我把 `solidId` 当
   * `boundedString` 收，于是**规划器根本填不进去** —— 而单元用例直接构造动作对象、绕过了这一层，
   * 所以全绿。**这一条走的就是被绕过的那一层。**
   */
  it("accepts a drafted host reference for a derived sphere, and refuses an unscoped one", () => {
    const drafted = parseActionToolInput("derived.create_circumsphere", { alias: "O", solidId: { scope: "draft", alias: "pyramid" } }, "step-sphere-der1")
    expect(drafted.ok).toBe(true)
    if (drafted.ok) expect(drafted.value).toMatchObject({ actionId: "derived.create_circumsphere", inputs: { alias: "O", solidId: { scope: "draft", alias: "pyramid" } } })

    const scene = parseActionToolInput("derived.create_insphere", { alias: "I", solidId: { scope: "scene", ref: { documentId: "doc-1", entityId: "solid-1" } } }, "step-sphere-der2")
    expect(scene.ok).toBe(true)
    if (scene.ok) expect(scene.value).toMatchObject({ inputs: { solidId: { documentId: "doc-1", entityId: "solid-1" } } })

    // 裸字符串 / 不带作用域的对象都不是合法引用 —— 拒绝的理由要说得出是"引用没作用域"。
    const bare = parseActionToolInput("derived.create_circumsphere", { alias: "O", solidId: "solid-1" }, "step-sphere-der3")
    expect(bare.ok).toBe(false)
    if (!bare.ok) expect(bare.errors).toEqual(expect.arrayContaining([expect.objectContaining({ path: "tool.inputs.solidId" })]))
  })

  it("rejects an unscoped object reference before staging a draft", () => {
    const result = parseActionToolInput("object.update_inputs", { target: { entityId: "cube-1" }, patch: { x: 2 } }, "step-3")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "unscoped_reference", path: "tool.inputs.target" })]))
  })
})
describe("common tangent input path", () => {
  it("publishes and parses the common anchor without collapsing the two references", () => {
    const anchor = actionToolSchema("function.create_tangent").inputSchema.properties?.anchor
    expect(anchor?.oneOf).toEqual(expect.arrayContaining([expect.objectContaining({ properties: expect.objectContaining({ kind: expect.objectContaining({ enum: ["common"] }), otherSourceId: expect.objectContaining({ type: "string" }) }) })]))
    const result = parseActionToolInput("function.create_tangent", { alias: "ct", sourceId: "f", anchor: { kind: "common", otherSourceId: "g", branch: 1 } }, "step-common")
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.inputs).toMatchObject({ sourceId: "f", anchor: { kind: "common", otherSourceId: "g", branch: 1 } })
  })

  it("accepts draft references in both common-tangent slots", () => {
    const result = parseActionToolInput("function.create_tangent", { alias: "ct", sourceId: { scope: "draft", alias: "f" }, anchor: { kind: "common", otherSourceId: { scope: "draft", alias: "g" } } }, "step-common-draft")
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.inputs).toMatchObject({ sourceId: "draft:f", anchor: { otherSourceId: "draft:g" } })
  })

  it("rejects malformed common anchors at their field paths", () => {
    const badBranch = parseActionToolInput("function.create_tangent", { alias: "ct", sourceId: "f", anchor: { kind: "common", otherSourceId: "g", branch: 2 } }, "step-common-branch")
    expect(badBranch.ok).toBe(false)
    if (!badBranch.ok) expect(badBranch.errors).toEqual(expect.arrayContaining([expect.objectContaining({ path: "tool.inputs.anchor.branch" })]))
    const unknown = parseActionToolInput("function.create_tangent", { alias: "ct", sourceId: "f", anchor: { kind: "common", otherSourceId: "g", extra: true } }, "step-common-extra")
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "unknown_field", path: "tool.inputs.anchor.extra" })]))
  })
})
