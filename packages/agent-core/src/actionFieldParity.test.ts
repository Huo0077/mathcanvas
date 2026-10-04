import { describe, expect, it } from "vitest"

import { ACTIONS, FIELD_KINDS, declaredFieldKind, type ActionId, type ActionSpec, type FieldKind } from "./actionRegistry"
import { allActionToolSchemas, actionToolSchema, parseActionToolInput } from "./actionSchemas"
import { parseDraftAction } from "./schemas"
import { updatableInputFields } from "@draw/scene-graph"

/**
 * **登记表 / 发布的 schema / 解析器三者对"字段"的口径必须一致**（Phase 1 阶段门槛）。
 *
 * ## 这一组用例挡的是什么
 *
 * `actionRegistry.ACTIONS` 是"我们承诺收什么"的唯一声明处。可"某个字段是什么形状"
 * 此前写在 `actionSchemas` 内部的四张并行集合（`NUMBER_FIELDS` / `STRING_FIELDS` /
 * `PLANAR_FIELDS` / `SPATIAL_FIELDS`）里 —— 于是同一份知识在两处各存一份。
 *
 * **两处都不需要覆盖登记表里的每个字段就能让既有测试全绿**：实测过一遍，
 * 既有用例只抽查了 `patch` / `plane` / `anchor` / `targets` / `center` / `origin` / `size` 这几个。
 * 所以"登记了、也发布给模型了，却没人按它读"这类缺口可以存在而没有任何用例为红。
 *
 * 现在种类表搬进了登记表（`FIELD_KINDS` + 逐动作的 `rawFieldTypes`），这组用例把三件事钉死：
 * ①每个登记字段**都有**种类（缺一个就红，不再靠"生成器抛错"这种延迟信号）；
 * ②发布出去的 schema 与登记的种类**相符**；
 * ③解析器对每个可用字段**真的读它**（给对形状的值要活下来；给错形状的值要按字段路径拒绝）。
 *
 * ## 一处如实记录
 *
 * 我最初怀疑 `dynamic.create_bound_point.inputs.parameterId` 被解析器丢掉 —— **那是误读**，
 * `actionInputs.ts` 的 `parameterId` 分支确实读了它（有一个探针用例证明了这一点）。
 * 把这个过程写在这里，是因为"看起来像缺陷"的怀疑在写成用例之前不算结论。
 */
describe("registry, published schema and parser agree on fields", () => {
  it("gives every registered field a kind", () => {
    const missing: string[] = []
    for (const [actionId, spec] of Object.entries(ACTIONS)) {
      for (const field of spec.inputFields) {
        if (field === "alias") continue
        if (declaredFieldKind(spec, field) === undefined) missing.push(`${actionId}.${field}`)
      }
    }
    expect(missing, `these fields have no kind in the registry: ${missing.join(", ")}`).toEqual([])
  })

  it("has no stale entry in the global kind table", () => {
    const used = new Set<string>()
    for (const spec of Object.values(ACTIONS)) for (const field of spec.inputFields) used.add(field)
    /**
     * 种类表里留着一个没人用的字段名不是无害的：它会让下一个同名但不同义的字段
     * **静默拿到一个错的形状**，而不是"缺种类"这种会红的状态。
     */
    const stale = Object.keys(FIELD_KINDS).filter((field) => !used.has(field))
    expect(stale, `these kind entries match no registered field: ${stale.join(", ")}`).toEqual([])
  })

  it("publishes exactly the fields the registry declares", () => {
    for (const schema of allActionToolSchemas()) {
      const published = Object.keys(schema.inputSchema.properties ?? {}).sort()
      const declared = [...ACTIONS[schema.actionId].inputFields].sort()
      expect(published, `${schema.actionId} publishes a different field set than the registry`).toEqual(declared)
    }
  })

  it("describes each published field the way the registry declares it", () => {
    /**
     * 逐字段核对"发布形状 vs 登记种类"。**例外（枚举 / 引用 / 逐动作声明）按同一优先级放行** ——
     * 它们本来就该盖过全局种类表，所以这里核对的是"没被它们接管"的那些字段。
     */
    const expectedShape: Record<FieldKind, (schema: { type?: string; properties?: Record<string, unknown>; items?: unknown }) => boolean> = {
      string: (s) => s.type === "string",
      number: (s) => s.type === "number",
      integer: (s) => s.type === "integer",
      boolean: (s) => s.type === "boolean",
      point: (s) => s.type === "object" && "x" in (s.properties ?? {}) && !("z" in (s.properties ?? {})),
      vector: (s) => s.type === "object" && "z" in (s.properties ?? {}),
      pointList: (s) => s.type === "array",
      vectorList: (s) => s.type === "array" && s.items !== undefined,
      vertexList: (s) => s.type === "array" && s.items !== undefined,
      stringList: (s) => s.type === "array" && s.items !== undefined,
      faceRings: (s) => s.type === "array" && s.items !== undefined,
      plane: (s) => Array.isArray((s as { oneOf?: unknown[] }).oneOf),
      tangentAnchor: (s) => Array.isArray((s as { oneOf?: unknown[] }).oneOf),
      updatablePatch: (s) => s.type === "object",
      scopedRef: (s) => Array.isArray((s as { oneOf?: unknown[] }).oneOf),
      idList: (s) => s.type === "array"
    }

    const mismatches: string[] = []
    for (const [actionId, spec] of Object.entries(ACTIONS) as [ActionId, ActionSpec][]) {
      const schema = actionToolSchema(actionId)
      for (const field of spec.inputFields) {
        if (field === "alias") continue
        const property = schema.inputSchema.properties?.[field]
        if (property === undefined) continue
        // 枚举与引用字段由它们自己的规则接管，形状不受种类表约束。
        if (spec.enumValues?.[field] !== undefined) continue
        if ((spec.references ?? []).some((entry) => entry.field === field)) continue
        const kind = declaredFieldKind(spec, field)
        if (kind === undefined) continue
        if (!expectedShape[kind](property as never)) {
          mismatches.push(`${actionId}.${field} declared ${kind} but published ${JSON.stringify(property)}`)
        }
      }
    }
    expect(mismatches, mismatches.join("; ")).toEqual([])
  })

  it("does not drop any field the registry declares for any action", () => {
    /**
     * 逐动作、逐字段地问同一个问题：**给一个形状正确的值，它能不能活着穿过解析？**
     *
     * 判据是"字段有没有出现在解析结果里"，而不是"值对不对" ——
     * 值级语义属于动作编译器，不是这一层的事。
     *
     * 注意 `alias` 跳过：它由 `requiresAlias` 决定，不由 `inputFields` 声明。
     */
    const sampleFor = (field: string): unknown => {
      if (field === "targets") return ["a"]
      if (field === "points" || field === "basePolygon") return [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }]
      if (field === "vertices") return [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }]
      if (field === "faces") return [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]]
      if (field === "patch") return {}
      if (field === "plane") return { normal: { x: 0, y: 0, z: 1 }, constant: 0 }
      if (field === "anchor") return { kind: "parameter", parameter: 0 }
      if (field === "target" || field === "host") return { scope: "draft", alias: "X" }
      return "sample"
    }

    const dropped: string[] = []
    for (const [actionId, spec] of Object.entries(ACTIONS) as [ActionId, ActionSpec][]) {
      const inputs: Record<string, unknown> = {}
      for (const field of spec.inputFields) {
        if (field === "alias") continue
        const enumValues = spec.enumValues?.[field]
        inputs[field] = enumValues ? enumValues[0] : sampleFor(field)
      }
      const result = parseActionToolInput(actionId, { ...(spec.requiresAlias ? { alias: "X" } : {}), ...inputs }, "k")
      if (!result.ok) continue
      const produced = result.value.inputs as Record<string, unknown>
      for (const field of spec.inputFields) {
        if (field === "alias") continue
        if (!(field in produced)) dropped.push(`${actionId}.${field}`)
      }
    }

    expect(dropped, `these registered fields never survive parsing: ${dropped.join(", ")}`).toEqual([])
  })

  it("reads every declared field, and rejects a wrong-shaped value at that field's path", () => {
    /**
     * 上一条问的是"字段在不在"，这一条问的是"**它真的被读了**吗"：
     * 给每个字段一个**形状错误**的值，要求解析在**该字段的路径上**报错。
     *
     * 为什么这两条缺一不可：一个字段被原样透传（没人读它）时，"给它合法值"与"给它垃圾值"
     * 都同样通过 —— 于是"登记了但没实现"可以完全无声。形状错误必须被挡在传输层，
     * 否则它一路走到动作编译器才炸，报的还是够不到的**动作级**路径（`section.create` 的平面
     * 就是这么挂过两次的真实现场）。
     */
    const garbageFor = (field: string, kind: FieldKind | undefined): unknown => {
      if (field === "targets") return [42]
      if (kind === "point" || kind === "vector") return { x: "not-a-number", y: 0, z: 0 }
      if (kind === "pointList" || kind === "vectorList" || kind === "vertexList") return [{ x: "nope", y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }]
      if (kind === "faceRings") return [["not-an-int"]]
      if (kind === "plane") return { normal: "nope" }
      if (kind === "tangentAnchor") return { kind: "parameter", parameter: "nope" }
      if (kind === "updatablePatch") return "nope"
      if (kind === "integer") return 1.5
      if (kind === "number") return "not-a-number"
      return 42 // 本该是字符串的字段给数字
    }

    const unread: string[] = []
    /**
     * `ACTIONS` 是 `as const`：逐条字面量类型里**没有** `references` / `enumValues` 这些
     * 可选字段（只有写了的条目才有）。当成 `ActionSpec` 迭代，才与生产代码看同一张表。
     */
    for (const [actionId, spec] of Object.entries(ACTIONS) as [ActionId, ActionSpec][]) {
      // 先造一份**每字段都合法**的输入作为底稿（缺字段会走"问用户"，那是合法路径，测不到东西）。
      const base: Record<string, unknown> = {}
      for (const field of spec.inputFields) {
        if (field === "alias") continue
        const enumValues = spec.enumValues?.[field]
        if (enumValues) { base[field] = enumValues[0]; continue }
        if (field === "targets") { base[field] = ["a"]; continue }
        if (field === "points" || field === "basePolygon") { base[field] = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }]; continue }
        if (field === "vertices") { base[field] = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }]; continue }
        if (field === "faces") { base[field] = [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]]; continue }
        if (field === "patch") { base[field] = {}; continue }
        if (field === "plane") { base[field] = { normal: { x: 0, y: 0, z: 1 }, constant: 0 }; continue }
        if (field === "anchor") { base[field] = { kind: "parameter", parameter: 0 }; continue }
        if (field === "target" || field === "host") { base[field] = { scope: "draft", alias: "X" }; continue }
        base[field] = "sample"
      }

      for (const field of spec.inputFields) {
        if (field === "alias" || spec.enumValues?.[field] !== undefined) continue
        const reference = (spec.references ?? []).find((entry) => entry.field === field)
        const kind = declaredFieldKind(spec, field)
        const payload = { ...(spec.requiresAlias ? { alias: "X" } : {}), ...base, [field]: garbageFor(field, kind) }
        // 先要求底稿本身合法：底稿不合法的话，"报错"说明不了任何事。
        const clean = parseActionToolInput(actionId, { ...(spec.requiresAlias ? { alias: "X" } : {}), ...base }, "k")
        if (!clean.ok) continue
        const parsed = parseActionToolInput(actionId, payload, "k")
        const rejectedAtField = !parsed.ok && parsed.errors.some((error) => error.path.includes(`inputs.${field}`) || (reference?.nested !== undefined && error.path.includes(`inputs.${reference.nested.outer}`)))
        if (!rejectedAtField) unread.push(`${actionId}.${field}: ${parsed.ok ? "accepted garbage" : parsed.errors.map((error) => `${error.code}@${error.path}`).join(",")}`)
      }
    }

    expect(unread, `these declared fields never validate their own value:\n  ${unread.join("\n  ")}`).toEqual([])
  })
})

/**
 * `parseDraftAction` 是**工具通道真正走的那条解析**（`parseActionToolInput` 只是它的包装）。
 * 上面那一组是围绕 `inputs` 的字段口径；这一条是它与 `patch` 白名单之间的接缝。
 */
describe("registry field facts stay wired to the parser", () => {
  it("keeps the update patch closed over the scene graph's editable fields", () => {
    const schema = actionToolSchema("object.update_inputs").inputSchema.properties?.patch
    expect(schema?.additionalProperties).toBe(false)
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual([...updatableInputFields()].sort())
  })

  it("reports an unknown field instead of accepting it", () => {
    const result = parseDraftAction({ actionId: "dynamic.create_locus", actionKey: "k", factIds: [], inputs: { alias: "L", sourcePointId: "P", nonsense: 1 } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some((error) => error.code === "unknown_field")).toBe(true)
  })
})
