import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { contentFingerprint } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION } from "./contracts"
import { compilePlan, type PlanCompileContext } from "./planCompiler"
import { createDraftTools } from "./tools/draftTools"

/**
 * **六层编译**（Agent DSL 切片 Task 4；规格 §6.2）。
 *
 * ```text
 * 传输解析 → 字段审计 → 引用解析 → 参数补全 → 几何语义校验 → Scene Graph 动作编译
 * ```
 *
 * 这一组用例守的是四件在接线时最容易漏掉的事：
 * 1. **依赖顺序**：同一个计划里"先建棱柱、再在中点建点、最后过三点作截面"必须能落地 ——
 *    动作编译器是**逐笔**推进工作文档的，而不是拿基准文档把所有动作各编一遍；
 * 2. **占用集**：非空文档上新建对象不许撞已有 id；
 * 3. **隔离草稿**：编译只产出候选文档，**基准文档一个字节都不动**（规格 §1.2）；
 * 4. **一次性修复**：失败时给出的修复请求只带 `path`/`code`/`allowedChanges`，
 *    而且只有一次机会。
 */

function context(document: GeometryDocument = createEmptyDocument("geometry3d"), overrides: Partial<PlanCompileContext> = {}): PlanCompileContext {
  return { document, conversationId: "conversation-1", documentGeneration: document.revision, ...overrides }
}

function rawPlan(actions: unknown[]): unknown {
  return { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "代表题", factIds: [], actions }
}

const PRISM = {
  actionId: "solid.create_prism",
  actionKey: "prism",
  factIds: [],
  inputs: {
    alias: "prism",
    basePolygon: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 3, y: Math.sqrt(3), z: 0 }, { x: 1, y: Math.sqrt(3), z: 0 }],
    vector: { x: 1, y: 0, z: 4 }
  }
}

const MIDPOINT = (alias: string, hostSub: number, parameter?: number) => ({
  actionId: "dynamic.create_bound_point",
  actionKey: `mid-${alias}`,
  factIds: [],
  inputs: { alias, host: { scope: "draft", alias: "prism" }, hostSub, ...(parameter === undefined ? {} : { parameter }) }
})

describe("plan compilation", () => {
  it("resolves draft aliases in dependency order and produces an isolated draft document", () => {
    const document = createEmptyDocument("geometry3d")
    const before = contentFingerprint(document)

    const result = compilePlan(rawPlan([
      PRISM,
      MIDPOINT("E", 0, 0.5),
      MIDPOINT("M", 1, 0.5),
      MIDPOINT("N", 2, 0.5),
      { actionId: "section.create", actionKey: "cut", factIds: [], inputs: { alias: "section", sourceId: "draft:prism", plane: { normal: { x: 0, y: 1, z: 0 }, constant: 0 } } }
    ]), context(document))

    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true)
    expect(result.diagnostics).toEqual([])
    // 别名解析成了真 id：草稿动作里不再有 draft 作用域的引用。
    expect(result.aliases.prism).toBe("solid-1")
    expect(result.aliases.E).toBe("point3-1")
    expect(JSON.stringify(result.actions)).not.toContain("\"draft\"")

    const ids = result.draftDocument?.primitives.map((primitive) => primitive.id) ?? []
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain("solid-1")
    expect(ids).toContain("point3-1")
    expect(result.draftDocument?.primitives.find((primitive) => primitive.id === "point3-1")).toMatchObject({ type: "point3", binding: { kind: "onHost", hostId: "solid-1:e0", parameter: 0.5 } })
    expect(result.draftDocument?.primitives.some((primitive) => primitive.type === "section")).toBe(true)
    // 三个中点参数都是题目的显式约束（0.5），不是默认值 → 没有假设。
    expect(result.assumptions).toEqual([])

    // 隔离：基准文档一个字节都没动。
    expect(contentFingerprint(document)).toBe(before)
    expect(document.primitives).toHaveLength(0)
  })

  it("allocates ids around the ids the live document already occupies", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "solid-1", type: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } } as never,
      { id: "point3-1", type: "point3", position: { x: 0, y: 0, z: 0 } } as never
    ]

    const result = compilePlan(rawPlan([PRISM, MIDPOINT("E", 0, 0.5)]), context(document, { documentGeneration: document.revision }))

    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true)
    expect(result.aliases.prism).toBe("solid-2")
    expect(result.aliases.E).toBe("point3-2")
    const ids = result.draftDocument?.primitives.map((primitive) => primitive.id) ?? []
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain("solid-1")
  })

  it("labels every rejection with the stage and an actionable field path", () => {
    const unknownField = compilePlan(rawPlan([{ ...PRISM, inputs: { ...PRISM.inputs, faces: [] } }]), context())
    expect(unknownField.ok).toBe(false)
    expect(unknownField.diagnostics[0]).toMatchObject({ stage: "transport", code: "unknown_field", path: "envelope.actions[0].inputs.faces", severity: "error" })

    const unresolved = compilePlan(rawPlan([MIDPOINT("E", 0)]), context())
    expect(unresolved.ok).toBe(false)
    // 别名指不到任何东西：引用解析这一层报出来，而且指出**是哪个动作的哪个字段**。
    expect(unresolved.diagnostics.some((entry) => entry.stage === "reference_resolution" && entry.code === "unresolved_alias" && entry.path === "envelope.actions[0].inputs.host")).toBe(true)

    // 跨文档引用：写在别的文档上的实体不许被引用。
    const crossDocument = compilePlan(rawPlan([{ ...MIDPOINT("E", 0), inputs: { alias: "E", host: { scope: "scene", ref: { documentId: "document-other", entityId: "solid-1" } }, hostSub: 0 } }]), context())
    expect(crossDocument.diagnostics.some((entry) => entry.code === "cross_document_reference")).toBe(true)

    // 几何语义：零向量的棱柱在**几何校验**这一层被拒（判据来自内核）。
    const degenerate = compilePlan(rawPlan([{ ...PRISM, inputs: { ...PRISM.inputs, vector: { x: 0, y: 0, z: 0 } } }]), context())
    expect(degenerate.ok).toBe(false)
    expect(degenerate.diagnostics.some((entry) => entry.stage === "geometry_validation" && entry.code === "degenerate_prism")).toBe(true)
  })

  it("asks the user when an omission has no safe default instead of asking for a repair", () => {
    const result = compilePlan(rawPlan([
      { actionId: "section.create", actionKey: "cut", factIds: [], inputs: { alias: "section", sourceId: "solid-1" } }
    ]), context())

    expect(result.ok).toBe(false)
    expect(result.actions).toEqual([])
    expect(result.questions.map((question) => question.path)).toEqual(["envelope.actions[0].inputs.plane"])
    // 用户能回答的问题**不该**变成"让模型重发一遍"。
    expect(result.repair).toBeUndefined()
  })

  it("offers exactly one repair request carrying only code/path/allowed changes", () => {
    const result = compilePlan(rawPlan([
      { ...PRISM, inputs: { ...PRISM.inputs, vector: { x: 0, y: 0, z: "up" } } }
    ]), context())

    expect(result.ok).toBe(false)
    expect(result.repair).toBeDefined()
    expect(result.repair?.attempt).toBe(1)
    expect(result.repair?.allowedChanges).toEqual(["envelope.actions[0].inputs.vector.z"])
    expect(result.repair?.errors[0]).toMatchObject({ code: "non_finite_number", path: "envelope.actions[0].inputs.vector.z" })
    // 修复请求里**没有**模型的原话（只有路径与原因码）。
    expect(JSON.stringify(result.repair)).not.toContain("up")
  })

  it("completes audited defaults and keeps the assumption visible", () => {
    // 向量**整个字段缺失**（不是 `undefined`）：模型输出是 JSON，缺字段就是没有那个键。
    const { vector: _omitted, ...prismInputs } = PRISM.inputs as Record<string, unknown>
    const declared = "规划器自己声明的假设（必须留下）"
    const result = compilePlan(rawPlan([{ ...PRISM, inputs: prismInputs, factIds: [] }]), context())
    // 上面那条不含规划器假设；下面这条把规划器声明的那句放进去，专门验"合并而不是替换"。
    const withDeclared = compilePlan({ ...(rawPlan([{ ...PRISM, inputs: prismInputs }]) as Record<string, unknown>), assumptions: [declared] }, context())

    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true)
    expect(result.actions[0].inputs).toMatchObject({ vector: { x: 0, y: 0, z: 3 } })
    // 文案按**实际回填了哪一半**写（Fix round 1 / M1）：这里底面是给的，所以不能说"底面取边长 4"。
    expect(result.assumptions.some((entry) => entry.text.includes("拉伸向量未指定"))).toBe(true)
    expect(result.assumptions.some((entry) => entry.text.includes("底面边长"))).toBe(false)
    /**
     * **合并而不是替换**（Fix round 1 / M6）：规划器声明过的那几句必须留下 ——
     * 以前是 `assumptions.length === 0 ? plan.assumptions : 补全文本`，于是
     * `draftTools.compilePlan` 的 `payload.plan` 会少掉规划器那几条。
     */
    const merged = withDeclared.plan?.kind === "plan" ? withDeclared.plan.assumptions : []
    expect(merged?.[0]).toBe(declared)
    expect(merged).toHaveLength(1 + withDeclared.assumptions.length)
  })

  it("distinguishes numeric sampling from an exact construction", () => {
    const exact = compilePlan(rawPlan([PRISM]), context())
    expect(exact.verification).toMatchObject({ kind: "formal" })

    const sampled = compilePlan(rawPlan([
      { actionId: "parameter.create", actionKey: "theta", factIds: [], inputs: { id: "theta", value: 0.4, min: 0, max: 6.28, step: 0.01, label: "θ" } },
      { actionId: "planar.create_conic", actionKey: "ellipse", factIds: [], inputs: { alias: "ellipse", kind: "ellipse", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2 } },
      { actionId: "parameter.create", actionKey: "invariant", factIds: [], inputs: { id: "invariant", value: 1, label: "9/OA²+4/OB²" } },
      { actionId: "parameter.set_expression", actionKey: "invariant-expr", factIds: [], inputs: { id: "invariant", expression: "9/(3*cos(theta))^2 + 4/(2*sin(theta))^2" } }
    ]), context(createEmptyDocument("conics"), { prompt: "求证 9/OA²+4/OB² 恒为 1" }))

    expect(sampled.ok, JSON.stringify(sampled.diagnostics)).toBe(true)
    expect(sampled.verification?.kind).toBe("numeric_sampling")
    expect(sampled.verification?.detail).toContain("形式证明")
    // 符号参数 θ 被**保留**下来了（规格 §6.3）：文档里的参数就是它，没有被特值化掉。
    expect(sampled.draftDocument?.parameters.theta).toMatchObject({ id: "theta", value: 0.4, label: "θ" })
    expect(sampled.draftDocument?.parameters.theta?.expression).toBeUndefined()
  })

  /**
   * **同一批里"先建点、再在该点处作切线"**（代表题 §8.2 的必需能力）。
   *
   * 切线的 `anchor.pointId` 是**嵌套**在 `anchor` 里的引用：它同样可以指向
   * 同一份计划里新建的点。漏掉这一条的症状很具体 —— 椭圆与动点都建出来了，
   * 切线却报 `target_not_found: draft:P`（一个用户看不懂的内部名字）。
   */
  it("resolves the nested anchor reference of a tangent at a draft point", () => {
    const result = compilePlan(rawPlan([
      { actionId: "planar.create_conic", actionKey: "ellipse", factIds: [], inputs: { alias: "ellipse", kind: "ellipse", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2 } },
      { actionId: "dynamic.create_bound_point", actionKey: "P", factIds: [], inputs: { alias: "P", host: { scope: "draft", alias: "ellipse" }, parameter: 0.4 } },
      { actionId: "function.create_tangent", actionKey: "tangent", factIds: [], inputs: { alias: "tangent-P", sourceId: "draft:P", anchor: { kind: "point", pointId: "draft:P" } } }
    ]), context(createEmptyDocument("conics")))

    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true)
    const tangent = result.actions.find((action) => action.actionId === "function.create_tangent")
    expect(tangent?.inputs).toMatchObject({ sourceId: result.aliases.P, anchor: { kind: "point", pointId: result.aliases.P } })
    expect(result.draftDocument?.primitives.some((primitive) => primitive.type === "tangent")).toBe(true)
  })

  /**
   * **每一个登记了的引用都要解析，不只第一个**（外部审查 A2）。
   *
   * `dynamic.bind_curve` 登记了**两个**引用：`target`（scoped）与 `pathId`（id）。
   * 引用解析原先只取 `referenceFieldsFor(actionId)[0]` —— 于是 `pathId` 从来没人解析，
   * `draft:seg` 原样传下去，动作层报 `path_not_found: no path draft:seg`（用户看不懂的内部名字）。
   * 这条用例的 `pathId` 正是**第二个**引用，也就是那条被漏掉的路径。
   */
  it("resolves every registered reference, not just the first one", () => {
    const result = compilePlan(rawPlan([
      { actionId: "planar.create_segment", actionKey: "seg", factIds: [], inputs: { alias: "seg", points: [{ x: 0, y: 0 }, { x: 4, y: 0 }] } },
      { actionId: "planar.create_point", actionKey: "P", factIds: [], inputs: { alias: "P", points: [{ x: 1, y: 0 }] } },
      { actionId: "dynamic.bind_curve", actionKey: "bind", factIds: [], inputs: { target: { scope: "draft", alias: "P" }, pathId: "draft:seg", parameter: 0.5 } }
    ]), context(createEmptyDocument("conics")))

    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true)
    const bind = result.actions.find((action) => action.actionId === "dynamic.bind_curve")
    // 修复前 `pathId` 还是字面量 `draft:seg`（第二个引用根本没被解析）。
    expect(bind?.inputs).toMatchObject({ pathId: result.aliases.seg, target: { documentId: expect.any(String), entityId: result.aliases.P } })
  })

  /**
   * 草稿工具是宿主侧的入口（`draftTools.ts`）。它**不产生草稿工件**：
   * 编译只回答"这份计划能不能变成一批动作"，落草稿是下一步 ——
   * 所以这里的 `artifacts` 必须是空的，而不是硬塞一个草稿 id 进去。
   */
  it("exposes the pipeline through the draft tool without faking a draft artifact", () => {
    const drafts = createDraftTools({ create: () => ({ draftId: "d1", draftVersion: 1, previewHash: "" }), stage: () => ({ ok: false, detail: "unused", unchanged: true, diagnostics: [] }), preflight: () => ({ ok: true, diagnostics: [] }), discard: () => true })

    const success = drafts.compilePlan(rawPlan([PRISM]), context())
    expect(success.status).toBe("success")
    expect(success.artifacts).toEqual([])
    expect(success.payload.ok).toBe(true)

    const refused = drafts.compilePlan(rawPlan([{ ...PRISM, inputs: { ...PRISM.inputs, faces: [] } }]), context())
    expect(refused.status).toBe("error")
    // 模型能改的失败 → 给出"按修复请求重发一次"，并带上原因码。
    expect(refused.next_actions.join(" ")).toContain("repair")
    expect(refused.diagnostics[0]).toMatchObject({ code: "unknown_field", severity: "error" })

    // 用户能回答的失败 → 让调用方去问用户（而不是让模型重发）。
    const needsAnswer = drafts.compilePlan(rawPlan([{ actionId: "section.create", actionKey: "cut", factIds: [], inputs: { alias: "s", sourceId: "solid-1" } }]), context())
    expect(needsAnswer.next_actions.join(" ")).toContain("ask the user")
  })
})
