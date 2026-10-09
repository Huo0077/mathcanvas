import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { crossVector3, dotVector3, lengthVector3, subtractVector3 } from "@draw/geometry-kernel"
import { contentFingerprint } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION } from "./contracts"
import { compilePlan, describeCompileRepairPrompt, searchWitnessForPrompt, type PlanCompileContext } from "./planCompiler"
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

/**
 * **四棱锥 P-ABCD**（用户报障那一道）。绕向是暴力搜出来的合法组合 —— 拓扑别手推。
 */
const PYRAMID_VERTICES = [
  { x: 0, y: 0, z: 4 }, // v0 = P
  { x: 0, y: 0, z: 0 }, // v1 = A
  { x: 2, y: 0, z: 0 }, // v2 = B
  { x: 2, y: 3, z: 0 }, // v3 = C
  { x: 0, y: 3, z: 0 } // v4 = D
]

const PYRAMID_FACES = [[1, 2, 3, 4], [0, 2, 1], [0, 3, 2], [0, 4, 3], [0, 1, 4]]

const PYRAMID_RELATIONS = [
  { id: "PA-perp-base", kind: "perpendicular", targets: [{ vertex: "v0" }, { vertex: "v1" }, { vertex: "v1" }, { vertex: "v2" }, { vertex: "v3" }] },
  { id: "BC-parallel-AD", kind: "parallel", targets: [{ vertex: "v2" }, { vertex: "v3" }, { vertex: "v1" }, { vertex: "v4" }] }
]

const PYRAMID_PROMPT = "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，BC ∥ AD，画出这个四棱锥"

function polyhedronPlan(vertices: unknown[], relations?: unknown, faces: unknown = PYRAMID_FACES): unknown {
  return {
    ...(rawPlan([{
      actionId: "solid.create_polyhedron",
      actionKey: "pyramid",
      factIds: [],
      inputs: { alias: "pyramid", vertexNames: ["P", "A", "B", "C", "D"], vertices, faces }
    }]) as Record<string, unknown>),
    ...(relations === undefined ? {} : { relations })
  }
}

/**
 * **关系核验**（设计 2026-10-03 §5.3/§5.5）。
 *
 * 这是**真正解掉用户报障的那一层**：题面只给关系、不给数值时，模型自己算出一组坐标，
 * 系统在执行**之前**用内核判据逐条核验它说的是不是真的。
 *
 * 两件事，顺序不能反：先**覆盖度**（题面点名的关系一条都不许漏声明），再**残差**
 * （声明了的每条都要真的成立）。失败走既有的一次性修复回路，不静默给残图。
 */
describe("relation verification gate", () => {
  it("accepts a plan whose declared relations really hold", () => {
    const result = compilePlan(polyhedronPlan(PYRAMID_VERTICES, PYRAMID_RELATIONS), context(createEmptyDocument("geometry3d"), { prompt: PYRAMID_PROMPT }))

    expect(result.diagnostics.filter((entry) => entry.code.startsWith("relation_"))).toEqual([])
    expect(result.ok).toBe(true)
  })

  it("rejects a plan whose declared relation does not hold, and offers a repair", () => {
    // P 偏到 (1, 0, 4)：PA 不再垂直于底面，而计划声称它垂直。
    const skewed = [{ x: 1, y: 0, z: 4 }, PYRAMID_VERTICES[1], PYRAMID_VERTICES[2], PYRAMID_VERTICES[3], PYRAMID_VERTICES[4]]

    const result = compilePlan(polyhedronPlan(skewed, PYRAMID_RELATIONS), context(createEmptyDocument("geometry3d"), { prompt: PYRAMID_PROMPT }))

    expect(result.ok).toBe(false)
    expect(result.diagnostics.some((entry) => entry.stage === "geometry_validation" && entry.code === "relation_not_satisfied")).toBe(true)
    // 失败必须给一次性修复的机会（设计 §6），而不是直接死掉。
    expect(result.repair).toBeDefined()
  })

  /**
   * **方案 C 的核心判据**（2026-10-03 追加）：关系由系统从原话里读，**不要求模型声明**。
   *
   * 这一条对应的就是用户现场：模型两次都没给 `relations`（即使被明确要求改
   * `envelope.relations`），于是旧门禁把一份几何**完全正确**的计划判成了失败。
   * 现在同一份计划必须通过，而且**关系真的被核验了**（不是放行不管）。
   */
  it("verifies relations it read from the prompt even when the model declares none", () => {
    // 用户原句；计划只说坐标、`relations` 一个字都不给。
    const result = compilePlan(polyhedronPlan(PYRAMID_VERTICES, undefined), context(createEmptyDocument("geometry3d"), { prompt: PYRAMID_PROMPT }))

    expect(result.ok).toBe(true)
    expect(result.diagnostics.filter((entry) => entry.code.startsWith("relation_"))).toEqual([])
  })

  it("still rejects the same prompt when the coordinates do not actually satisfy the relations", () => {
    // 同一句原话、同一个"不给 relations"，但坐标是歪的 —— 核验必须抓到它。
    // 这条防的是"方案 C 退化成放行不管"。
    const skewed = [{ x: 1, y: 0, z: 4 }, PYRAMID_VERTICES[1], PYRAMID_VERTICES[2], PYRAMID_VERTICES[3], PYRAMID_VERTICES[4]]

    const result = compilePlan(polyhedronPlan(skewed, undefined), context(createEmptyDocument("geometry3d"), { prompt: PYRAMID_PROMPT }))

    expect(result.ok).toBe(false)
    expect(result.diagnostics.some((entry) => entry.code === "relation_not_satisfied")).toBe(true)
  })

  it("says so when it read relations but the plan has nothing to verify them against", () => {
    // 原话里有关系词，但这份计划不产出自由坐标（没有 create_polyhedron）→ 没得验。
    // **不许静默当成"通过"**：如实给一条 warning。
    const result = compilePlan(rawPlan([PRISM]), context(createEmptyDocument("geometry3d"), { prompt: "底面边长 2 的棱柱，AB垂直AD" }))

    expect(result.diagnostics.some((entry) => entry.code === "relation_not_checkable" && entry.severity === "warning")).toBe(true)
  })

  it("fails a declared relation whose vertex name does not exist, instead of passing it silently", () => {
    // 模型写错点名（v9）—— "无法判定"不许读成"已满足"。
    const typo = [{ id: "typo", kind: "parallel", targets: [{ vertex: "v9" }, { vertex: "v2" }, { vertex: "v1" }, { vertex: "v4" }] }]

    const result = compilePlan(polyhedronPlan(PYRAMID_VERTICES, typo), context(createEmptyDocument("geometry3d"), { prompt: "画一个四棱锥" }))

    expect(result.ok).toBe(false)
    expect(result.diagnostics.some((entry) => entry.code === "relation_not_satisfied")).toBe(true)
  })

  it("leaves a plan without relations exactly as it behaves today", () => {
    // **回归底线**：没有 relations 字段、题面也没有关系词 → 行为与今天逐字相同。
    const result = compilePlan(polyhedronPlan(PYRAMID_VERTICES, undefined), context(createEmptyDocument("geometry3d"), { prompt: "画一个四棱锥" }))

    expect(result.diagnostics.some((entry) => entry.code.startsWith("relation_"))).toBe(false)
  })

  /**
   * **Phase N1：统一 IR 与它的开关**（开关语义见控制器裁决 R6）。
   *
   * 三条一起钉住 N1 的验收条件："`flags=false` 时旧静态示意图链路行为不变"
   * 与"IR 确实接进了编译期"。只断言前者会退化成"什么都没做也算过"；
   * 只断言后者则无法证明回退路还在。
   *
   * R6 之后**缺省就是关**：`diagramObligationIR` 必须显式写 `true` 才产出 IR ——
   * 因为"缺省开 + 生产调用方不传"等于这个开关事实上从不生效。
   */
  it("attaches the unified obligation IR when the caller switches it on", () => {
    const result = compilePlan(polyhedronPlan(PYRAMID_VERTICES, PYRAMID_RELATIONS), context(createEmptyDocument("geometry3d"), { prompt: PYRAMID_PROMPT, diagramObligationIR: true }))

    expect(result.diagramVerification?.obligationIR?.obligations.map((item) => [item.role, item.kind, item.targets])).toEqual([
      ["given", "perpendicular", ["P", "A", "A", "B", "C", "D"]],
      ["given", "parallel", ["B", "C", "A", "D"]]
    ])
  })

  it("produces the legacy diagram report with no IR field when nobody passes the switch", () => {
    const result = compilePlan(polyhedronPlan(PYRAMID_VERTICES, PYRAMID_RELATIONS), context(createEmptyDocument("geometry3d"), { prompt: PYRAMID_PROMPT }))

    // 报告本体仍然照旧（核验条数与结论一字未变），而且**字段本身不存在**。
    expect(result.diagramVerification?.status).toBe("passed")
    expect(result.diagramVerification?.checks).toHaveLength(2)
    expect(Object.keys(result.diagramVerification ?? {}).sort()).toEqual(["checks", "sampleValues", "status"])
  })

  it("treats an explicit false exactly like the default", () => {
    const result = compilePlan(polyhedronPlan(PYRAMID_VERTICES, PYRAMID_RELATIONS), context(createEmptyDocument("geometry3d"), { prompt: PYRAMID_PROMPT, diagramObligationIR: false }))

    expect(result.diagramVerification?.obligationIR).toBeUndefined()
  })
  /**
   * **顶点顺序不再靠猜**（2026-10-03，方案 C 的配套）。
   *
   * 抽取出来的关系按**下标**认顶点，而下标要跟题面的点名对上只有模型知道。
   * 不声明时只能假设"`vertices` 顺序 = 题面点名顺序"—— 模型一打乱，判据就指错顶点，
   * 于是**明明画对了也被判不满足**。`vertexNames` 让模型把这件事说清楚。
   */
  it("uses the declared vertex names, so a different vertex order is still verified correctly", () => {
    // 同样的几何，但**顶点数组顺序被打乱**：C 放最前、P 放最后。
    // 面环必须跟着重排（下标变了），否则内核先报绕向不一致 —— 那是另一回事。
    const shuffled = [PYRAMID_VERTICES[3], PYRAMID_VERTICES[0], PYRAMID_VERTICES[1], PYRAMID_VERTICES[2], PYRAMID_VERTICES[4]]
    const names = ["C", "P", "A", "B", "D"]
    const remappedFaces = [[2, 3, 0, 4], [1, 3, 2], [1, 0, 3], [1, 4, 0], [1, 2, 4]]
    const plan = {
      ...(rawPlan([{
        actionId: "solid.create_polyhedron",
        actionKey: "pyramid",
        factIds: [],
        inputs: { alias: "pyramid", vertices: shuffled, faces: remappedFaces, vertexNames: names }
      }]) as Record<string, unknown>)
    }

    const result = compilePlan(plan, context(createEmptyDocument("geometry3d"), { prompt: PYRAMID_PROMPT }))

    // 有了声明，关系仍能逐条对上：不满足的一条都不该有，而且计划整体通过。
    expect(result.diagnostics.filter((entry) => entry.code === "relation_not_satisfied")).toEqual([])
    expect(result.ok).toBe(true)
  })

  it("rejects duplicate vertex names, because name-to-index would stop being a function", () => {
    const plan = {
      ...(rawPlan([{
        actionId: "solid.create_polyhedron",
        actionKey: "pyramid",
        factIds: [],
        inputs: { alias: "pyramid", vertices: PYRAMID_VERTICES, faces: PYRAMID_FACES, vertexNames: ["P", "A", "A", "C", "D"] }
      }]) as Record<string, unknown>)
    }

    const result = compilePlan(plan, context(createEmptyDocument("geometry3d")))

    expect(result.diagnostics.some((entry) => entry.code === "duplicate_name")).toBe(true)
  })

  it("rejects a vertex-name list whose length does not match the vertices", () => {
    const plan = {
      ...(rawPlan([{
        actionId: "solid.create_polyhedron",
        actionKey: "pyramid",
        factIds: [],
        inputs: { alias: "pyramid", vertices: PYRAMID_VERTICES, faces: PYRAMID_FACES, vertexNames: ["P", "A", "B"] }
      }]) as Record<string, unknown>)
    }

    const result = compilePlan(plan, context(createEmptyDocument("geometry3d")))

    expect(result.diagnostics.some((entry) => entry.code === "invalid_type")).toBe(true)
  })
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

  /**
   * **同一份计划里刚建出来的对象，写成场景引用 / 裸名字也要认**（2026-09-26 用户现场）。
   *
   * 用户要"把正方体沿对角面剖开，标出截面"，规划器给的三步是"建立方体 → 建截面 → 标截面"，
   * 但后两步把 `cube` 与 `diagSection` 写成了**场景引用**而不是草稿别名（`{scope:"draft", alias}`），
   * 整轮因此死在 `target_not_found: no object cube`。
   *
   * 判据没有歧义：别名表只装**这一份计划里、这一步之前**已经建出来的对象，命中就是"刚建的那个"。
   * 所以这里按别名解析；而**真的编造一个 id 仍旧照旧拒绝**（宽容不越界）。
   */
  it("accepts a same-plan object named by alias even when the reference forgot the draft scope", () => {
    const section = (sourceId: unknown) => ({ actionId: "section.create", actionKey: "cut", factIds: [], inputs: { alias: "cut", sourceId, plane: { normal: { x: 0, y: 1, z: 0 }, constant: 0 } } })
    const document = createEmptyDocument("geometry3d")

    // 写成裸名字
    const bare = compilePlan(rawPlan([PRISM, section("prism")]), context(document))
    expect(bare.ok, JSON.stringify(bare.diagnostics)).toBe(true)
    expect(bare.aliases.cut).toBeDefined()

    // 这个字段只接受**字符串引用**（裸 id 或 `draft:<alias>`）：场景引用那种对象形状在传输层就被拒。
    const sceneForm = compilePlan(rawPlan([PRISM, section({ documentId: document.metadata.id, entityId: "prism" })]), context(document))
    expect(sceneForm.ok).toBe(false)
    expect(sceneForm.diagnostics[0]).toMatchObject({ stage: "transport", code: "invalid_type", path: "envelope.actions[1].inputs.sourceId" })

    // 编造的 id 依旧被拒
    const invented = compilePlan(rawPlan([section("nowhere")]), context(document))
    expect(invented.ok).toBe(false)
    expect(invented.diagnostics.some((entry) => entry.code === "target_not_found")).toBe(true)
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
    // `stage` / `preflight` 返回 `Promise`（方案 3：编译可以交给几何 Worker）。
    const drafts = createDraftTools({ create: () => ({ draftId: "d1", draftVersion: 1, previewHash: "" }), stage: async () => ({ ok: false as const, detail: "unused", unchanged: true, diagnostics: [] }), preflight: async () => ({ ok: true as const, diagnostics: [] }), discard: () => true })

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

describe("task-level explicit cube constraints", () => {
  const makeCube = (origin: { x: number; y: number; z: number }, size: number) => ({
    schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "create one cube", factIds: [],
    actions: [{ actionId: "solid.create_template", actionKey: "cube", factIds: [], inputs: { alias: "cube", template: "cube", origin, size: { x: size, y: size, z: size } } }]
  })

  it("rejects a cube whose corner is at the origin when the user explicitly requested its center there", () => {
    const document = createEmptyDocument("geometry3d")
    const compiled = compilePlan(makeCube({ x: 0, y: 0, z: 0 }, 3), context(document, { prompt: "画一个棱长 3、中心在原点的立方体" }))
    expect(compiled.ok).toBe(false)
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "user_constraint_mismatch", path: "envelope.actions[0].inputs.origin" })]))
    expect(compiled.draftDocument).toBeNull()
  })

  it("rejects a cube with the wrong edge length even when the geometry is valid", () => {
    const document = createEmptyDocument("geometry3d")
    const compiled = compilePlan(makeCube({ x: 0, y: 0, z: 0 }, 2), context(document, { prompt: "画一个棱长 3 的立方体" }))
    expect(compiled.ok).toBe(false)
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "user_constraint_mismatch", path: "envelope.actions[0].inputs.size" })]))
    expect(compiled.draftDocument).toBeNull()
  })
  it("refuses to count two valid cubes as satisfying a request for exactly one", () => {
    const document = createEmptyDocument("geometry3d")
    const first = makeCube({ x: -1.5, y: -1.5, z: -1.5 }, 3)
    const second = { ...first.actions[0], actionKey: "cube-2", inputs: { ...first.actions[0].inputs, alias: "cube-2" } }
    const compiled = compilePlan({ ...first, actions: [...first.actions, second] }, context(document, { prompt: "画一个棱长 3、中心在原点的立方体" }))
    expect(compiled.ok).toBe(false)
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "user_constraint_mismatch", path: "envelope.actions" })]))
  })
  it("accepts a cube with the correct center and edge length", () => {
    const document = createEmptyDocument("geometry3d")
    const compiled = compilePlan(makeCube({ x: -1.5, y: -1.5, z: -1.5 }, 3), context(document, { prompt: "画一个棱长 3、中心在原点的立方体" }))
    expect(compiled.ok).toBe(true)
  })
})

/**
 * **修复提示按错误签名给"下一步怎么改"**（2026-10-04，来自真实运行）。
 *
 * 三次运行的失败签名各不相同，而引擎原本只回"字段路径 + 原因"。模型拿到
 * `unknown_field@…points[0].z` 并不知道**为什么**：它以为自己在补立体的边，
 * 而平面动作根本收不下 `z`。这里把三个真实签名逐条钉住。
 */
describe("compile repair advice", () => {
  const repairFor = (errors: { code: string; path: string; detail: string }[]) => ({ reason: "schema_invalid" as const, errors, allowedChanges: [], attempt: 1 })
  const ask = (errors: { code: string; path: string; detail: string }[]) => describeCompileRepairPrompt(repairFor(errors))

  it("explains that planar actions cannot take a z coordinate", () => {
    // 现场原话：模型建完 create_polyhedron 后想用 planar.create_segment 补 OA / CD。
    const hint = ask([
      { code: "unknown_field", path: "envelope.actions[1].inputs.points[0].z", detail: "unexpected field 'z'" },
      { code: "unknown_field", path: "envelope.actions[2].inputs.points[0].z", detail: "unexpected field 'z'" }
    ])

    expect(hint).toContain("planar.*")
    expect(hint).toContain("不接受 `z`")
    // 还要说清"立体已由 solid.* 建好，别再用 planar 去补边"。
    expect(hint).toContain("不要再用 `planar.*` 去补立体的边")
  })

  it("explains that a plan branch must not carry answer/other-branch fields", () => {
    const hint = ask([{ code: "unknown_field", path: "envelope.answer", detail: "unexpected field 'answer'" }])

    expect(hint).toContain("不要混进来")
    expect(hint).toContain("toolResultRefs")
  })

  /**
   * **提醒不能与"放宽样板字段"那条决定自相矛盾**。
   *
   * 放宽之后 `schemaVersion` / `factIds` / `kind` 都是可推断的；如果修复提示还在要求
   * 模型补它们，就等于让它花一轮去补系统自己能补的字段 —— 那正是我们刚刚修掉的毛病。
   */
  it("no longer asks the model to supply the fields we relaxed", () => {
    const hint = ask([{ code: "invalid_type", path: "envelope.actions", detail: "expected an array" }])

    expect(hint).toContain("`goal` 与 `actions`")
    expect(hint).not.toContain("schemaVersion")
    expect(hint).not.toContain("factIds")
  })
})

/**
 * **N2 子任务 2c：把见证搜索接进编译路径**（裁决 R37 / R11 / R35③）。
 *
 * 三条判据逐条对应 R17 点名的出口证据：
 * ① 开关关着时与改动之前**逐字相同**（含"候选不合格就没有草稿"这条 fail-closed 行为）；
 * ② 开着、且模型坐标不满足题设时，系统**自己搜一组坐标把草稿救回来** ——
 *   用户能看出那是系统选的示例值，而且进草稿的坐标**真的**满足题设（这里按内核度量独立回代）；
 * ③ 搜不到就**不产生草稿**，结果与关着时逐字相同（不许半份草稿）。
 *
 * 另外两条守 R37① 的"只救不抢"：模型坐标本来就合格时**连搜索都不调用**（草稿里留下的
 * 必须还是模型自己那组数）；题面点名的不是棱锥时不许硬套一只棱锥上去
 * （首批只有棱锥能被构造，见 `task-2b-report.md` §8.2/§8.3）。
 *
 * 开关的语义与 N1 的 `diagramObligationIR` 同一条（R6/R11）：**显式为 `true` 才开**。
 */
describe("witness search rescue in the compile path", () => {
  /** P 偏出垂足 `(1, 0, 4)`：PA 不再垂直于底面，模型自己声明的那条关系也不成立。 */
  const SKEWED_PYRAMID = [{ x: 1, y: 0, z: 4 }, PYRAMID_VERTICES[1], PYRAMID_VERTICES[2], PYRAMID_VERTICES[3], PYRAMID_VERTICES[4]]
  /**
   * 2b 用例里的同一道题面。
   *
   * 与上面那条 `PYRAMID_PROMPT` 的差别不是措辞：**它点名了底面的直角 `AB ⊥ AD`**，
   * 而搜索器的解析构造只支持"矩形 / 直角底面"（2a 的 `deriveBasePolygon`），
   * 少了这一条就构造不出候选（`unsupported-shape`），也就无从救回。
   */
  const RESCUE_PROMPT = "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，BC ∥ AD，AB ⊥ AD，画出这个四棱锥"
  /** 同一条线段被给了两个长度：题设自相矛盾，搜索器能给出冲突证据（2b 的 `findContradiction`）。 */
  const CONTRADICTORY_PROMPT = "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，AB ⊥ AD，BD=2，BD=3，画出这个四棱锥"
  /** 极端长宽比：内核的尺度判据把候选全拒掉 —— 搜了，但一个可核验的坐标都没拿到。 */
  const EXTREME_PROMPT = "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，AB ⊥ AD，AB=1，AD=1000000，画出这个四棱锥"
  /** 同一组题设，但题面说的是**棱柱**：首批不支持棱柱，接线层不许把它当棱锥救回来。 */
  const PRISM_PROMPT = "在四棱柱 P-ABCD 中，PA ⊥ 平面 ABCD，BC ∥ AD，AB ⊥ AD，画出这个四棱柱"

  /** 物化出来的多面体顶点的坐标，顺序与 `solid.create_polyhedron` 的 `vertices` 一致。 */
  function materialisedVertices(document: GeometryDocument): { x: number; y: number; z: number }[] {
    const solid = document.primitives.find((primitive) => primitive.type === "polyhedron3")
    if (solid?.type !== "polyhedron3") throw new Error("候选文档里没有多面体")
    return solid.vertexIds.map((id) => {
      const vertex = document.primitives.find((primitive) => primitive.id === id)
      if (vertex?.type !== "point3") throw new Error(`顶点 ${id} 不在候选文档里`)
      return vertex.position
    })
  }

  /** 物化动作里声明的点名（`candidatePoints` 就是按它与 `vertexIds` 一一对应取坐标的）。 */
  function materialisedNames(result: { actions: readonly { actionId: string; inputs: unknown }[] }): string[] {
    const action = result.actions.find((entry) => entry.actionId === "solid.create_polyhedron")
    const inputs = action?.inputs
    const names = typeof inputs === "object" && inputs !== null && !Array.isArray(inputs) ? (inputs as { vertexNames?: unknown }).vertexNames : undefined
    if (!Array.isArray(names) || !names.every((name) => typeof name === "string")) throw new Error("物化后的多面体动作没有点名")
    return names as string[]
  }

  it("leaves the failing candidate exactly as it was when the switch is off", () => {
    const document = createEmptyDocument("geometry3d")
    const input = polyhedronPlan(SKEWED_PYRAMID, PYRAMID_RELATIONS)
    const withoutSwitch = compilePlan(input, context(document, { prompt: RESCUE_PROMPT }))
    const explicitOff = compilePlan(input, context(document, { prompt: RESCUE_PROMPT, diagramWitnessSearch: false }))

    // R11：`false` 与"根本没这个开关"必须是**同一份报告**（逐字）。
    expect(JSON.stringify(explicitOff)).toBe(JSON.stringify(withoutSwitch))
    // 今天的行为没变：诊断 + **没有草稿**，也没有任何"救回来"的痕迹。
    expect(withoutSwitch.ok).toBe(false)
    expect(withoutSwitch.draftDocument).toBeNull()
    expect(withoutSwitch.materialisedActions).toBeUndefined()
  })

  it("rescues a triangular-base pyramid whose right corner is explicitly B, then verifies the materialised figure", () => {
    const document = createEmptyDocument("geometry3d")
    const prompt = "在三棱锥 P-ABC 中，PB⊥平面ABC，AB⊥BC，画出示意图"
    const plan = rawPlan([{
      actionId: "solid.create_polyhedron", actionKey: "pyramid", factIds: [],
      inputs: {
        alias: "pyramid", vertexNames: ["P", "A", "B", "C"],
        vertices: [{ x: 1, y: 0, z: 4 }, { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 3, z: 0 }],
        faces: [[1, 2, 3], [0, 2, 1], [0, 3, 2], [0, 1, 3]]
      }
    }])
    const result = compilePlan(plan, context(document, { prompt, diagramWitnessSearch: true }))
    expect(result.ok, result.diagnostics.map((entry) => entry.detail).join(" / ")).toBe(true)
    expect(result.diagramVerification?.status).toBe("passed")
    expect(result.materialisedActions).toBeDefined()
    expect(result.draftDocument?.primitives.some((item) => item.type === "polyhedron3")).toBe(true)
    expect(document.primitives).toHaveLength(0)
  })
  it("rescues a candidate that fails the givens with coordinates the system chose and re-verified", () => {
    const document = createEmptyDocument("geometry3d")
    const result = compilePlan(polyhedronPlan(SKEWED_PYRAMID, PYRAMID_RELATIONS), context(document, { prompt: RESCUE_PROMPT, diagramWitnessSearch: true }))

    expect(result.ok, result.diagnostics.map((entry) => entry.detail).join("; ")).toBe(true)
    expect(result.draftDocument).not.toBeNull()
    // 只有统一核验器说 `passed` 才会走到这里（生成物不豁免核验）。
    expect(result.diagramVerification?.status).toBe("passed")

    // ① 用户能看出这几个数是**系统选的示例值**（设计 §1 验收判据 4）。
    const texts = result.assumptions.map((assumption) => assumption.text)
    expect(texts.join(" ")).toContain("系统自选")
    /**
     * ② R35③：`ClaimEvidence.degreesOfFreedom` 是 `null`（2b 如实留空），
     * 送到用户面前的文案就只能说"未计算"。
     */
    const evidenceLine = texts.find((line) => line.includes("solver="))
    expect(evidenceLine, "证据那一行必须存在，否则用户看不到这次核验的依据").toBeDefined()
    expect(evidenceLine).toContain("自由度：未计算")
    expect(evidenceLine).not.toContain("刚性")

    /**
     * ③ 进草稿的坐标必须**真的是被核验过的那一组**：这里不复用核验器的残差，
     * 而是拿物化后的坐标按内核自己的度量独立回代（与 2b 的用例同一个手法）。
     */
    const vertices = materialisedVertices(result.draftDocument!)
    const names = materialisedNames(result)
    const at = (name: string) => vertices[names.indexOf(name)]
    const pa = subtractVector3(at("P"), at("A"))
    const ab = subtractVector3(at("B"), at("A"))
    const ad = subtractVector3(at("D"), at("A"))
    const bc = subtractVector3(at("C"), at("B"))
    // PA ⊥ 平面 ABCD：PA 同时垂直于底面内的两条不共线方向。
    expect(Math.abs(dotVector3(pa, ab))).toBeLessThan(1e-9)
    expect(Math.abs(dotVector3(pa, ad))).toBeLessThan(1e-9)
    // BC ∥ AD：叉积的归一化模长（也就是夹角的正弦）为零。
    expect(lengthVector3(crossVector3(bc, ad)) / (lengthVector3(bc) * lengthVector3(ad))).toBeLessThan(1e-9)
    // 而模型的 P 偏在 x = 1 且与 A 不同高 —— 救回来的不能还是那一组。
    expect(at("P").x).toBeCloseTo(at("A").x, 9)
    expect(at("P").z).toBeGreaterThan(0)
  })

  it("does not pre-empt a candidate the model already got right", () => {
    const document = createEmptyDocument("geometry3d")
    const result = compilePlan(polyhedronPlan(PYRAMID_VERTICES, PYRAMID_RELATIONS), context(document, { prompt: RESCUE_PROMPT, diagramWitnessSearch: true }))

    expect(result.ok).toBe(true)
    expect(result.diagramVerification?.status).toBe("passed")
    // 搜索若跑过，配置行会出现在假设里（2b 的 `configLine` 一定带 `seed=`）。
    expect(result.assumptions.map((assumption) => assumption.text).join(" ")).not.toContain("seed=")
    expect(result.materialisedActions).toBeUndefined()
    // 草稿里留下的必须是**模型自己**那组坐标，逐字未动。
    expect(materialisedVertices(result.draftDocument!)[0]).toEqual(PYRAMID_VERTICES[0])
  })

  it("produces no draft when the givens contradict each other, exactly as it does with the switch off", () => {
    const document = createEmptyDocument("geometry3d")
    const input = polyhedronPlan(SKEWED_PYRAMID, PYRAMID_RELATIONS)
    const withoutSwitch = compilePlan(input, context(document, { prompt: CONTRADICTORY_PROMPT }))
    const switchedOn = compilePlan(input, context(document, { prompt: CONTRADICTORY_PROMPT, diagramWitnessSearch: true }))

    expect(switchedOn.ok).toBe(false)
    expect(switchedOn.draftDocument).toBeNull()
    expect(JSON.stringify(switchedOn)).toBe(JSON.stringify(withoutSwitch))
  })

  it("produces no draft when the search constructs no verifiable candidate at all", () => {
    const document = createEmptyDocument("geometry3d")
    const input = polyhedronPlan(PYRAMID_VERTICES, PYRAMID_RELATIONS)
    const withoutSwitch = compilePlan(input, context(document, { prompt: EXTREME_PROMPT }))
    const switchedOn = compilePlan(input, context(document, { prompt: EXTREME_PROMPT, diagramWitnessSearch: true }))

    expect(switchedOn.ok).toBe(false)
    expect(switchedOn.draftDocument).toBeNull()
    expect(switchedOn.materialisedActions).toBeUndefined()
    expect(JSON.stringify(switchedOn)).toBe(JSON.stringify(withoutSwitch))
  })

  it("does not turn a prism problem into a pyramid just because the switch is on", () => {
    const document = createEmptyDocument("geometry3d")
    const input = polyhedronPlan(SKEWED_PYRAMID, PYRAMID_RELATIONS)
    const withoutSwitch = compilePlan(input, context(document, { prompt: PRISM_PROMPT }))
    const switchedOn = compilePlan(input, context(document, { prompt: PRISM_PROMPT, diagramWitnessSearch: true }))

    expect(withoutSwitch.ok).toBe(false)
    expect(switchedOn.ok).toBe(false)
    expect(switchedOn.draftDocument).toBeNull()
    expect(JSON.stringify(switchedOn)).toBe(JSON.stringify(withoutSwitch))
  })
})

/**
 * **按点名指定棱**（`hostEdge`，2026-10-05，用户裁决）。
 *
 * `hostSub` 是**宿主内部的棱下标** —— 模型在一个 stage 里"先建实体、再绑点"时拿不到那次的观察结果，
 * 只能赌下标（而且赌错会被当场拒绝：几何语义校验报 `diagram_condition_failed`）。
 * `hostEdge: { from, to }` 让它直接说"**B 与 D 之间那条棱**"，由编译器去查两端点名。
 *
 * 四条判据：能查到 / **顺序无关** / 名字不存在要如实报 / **两条都给了不许猜**。
 */
const TETRA_NAMED = {
  actionId: "solid.create_polyhedron", actionKey: "solid", factIds: [],
  inputs: {
    alias: "solid",
    vertices: [{ x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }],
    faces: [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]],
    vertexNames: ["A", "B", "C", "D"]
  }
}

const BOUND_BY_NAME = (alias: string, from: string, to: string, extra: Record<string, unknown> = {}) => ({
  actionId: "dynamic.create_bound_point", actionKey: `bound-${alias}`, factIds: [],
  inputs: { alias, host: { scope: "draft", alias: "solid" }, hostEdge: { from, to }, parameter: 0.5, label: alias, ...extra }
})

/** 候选文档里那个带某点名的点的坐标（找不到返回 undefined）。 */
function positionOf(compiled: { draftDocument?: GeometryDocument | null }, label: string) {
  const point = (compiled.draftDocument?.primitives ?? []).find((primitive) => (primitive as { label?: string }).label === label)
  return (point as { position?: { x: number; y: number; z: number } } | undefined)?.position
}

describe("按点名指定棱（hostEdge）", () => {
  it("「B 与 D 之间那条」⇒ 绑到它的中点（一步之内，不必知道下标）", () => {
    const compiled = compilePlan(rawPlan([TETRA_NAMED, BOUND_BY_NAME("O", "B", "D")]), context())

    expect(compiled.ok, JSON.stringify(compiled.diagnostics)).toBe(true)
    // B=(-1,0,0)、D=(1,0,0) ⇒ 中点 (0,0,0)
    expect(positionOf(compiled, "O")).toEqual({ x: 0, y: 0, z: 0 })
  })

  it("**顺序无关**：写「D 与 B」是同一条棱", () => {
    const compiled = compilePlan(rawPlan([TETRA_NAMED, BOUND_BY_NAME("O", "D", "B")]), context())

    expect(compiled.ok, JSON.stringify(compiled.diagnostics)).toBe(true)
    expect(positionOf(compiled, "O")).toEqual({ x: 0, y: 0, z: 0 })
  })

  it("点名的顶点不存在 ⇒ `edge_not_found`（不猜，也不静默建一个自由点顶着）", () => {
    const compiled = compilePlan(rawPlan([TETRA_NAMED, BOUND_BY_NAME("O", "B", "Z")]), context())

    expect(compiled.ok).toBe(false)
    expect(JSON.stringify(compiled.diagnostics)).toContain("edge_not_found")
  })

  it("`hostEdge` 与 `hostSub` **同时给 ⇒ 不猜**（明确报错）", () => {
    const compiled = compilePlan(rawPlan([TETRA_NAMED, BOUND_BY_NAME("O", "B", "D", { hostSub: 4 })]), context())

    expect(compiled.ok).toBe(false)
    expect(JSON.stringify(compiled.diagnostics)).toContain("ambiguous_host_edge")
  })

  /**
   * **`ambiguous_edge` 那一支今天到不了** —— 这条用例把"到不了"钉住，而不是假装它有守卫。
   *
   * 两个顶点同名在 `solid.create_polyhedron` 那一层就被拒了（`duplicated…`），
   * 而正常多面体两个顶点之间只有一条棱。所以解析里那一支**留着是为了将来真出现时不许猜**，
   * 我**不声称它有守卫**（今天没有用例能构造出来）。
   */
  it("两个顶点同名在**建实体那一层**就被拒 ⇒ 歧义根本到不了绑定这一步", () => {
    const duplicated = { ...TETRA_NAMED, inputs: { ...TETRA_NAMED.inputs, vertexNames: ["A", "B", "B", "D"] } }
    const compiled = compilePlan(rawPlan([duplicated, BOUND_BY_NAME("O", "B", "D")]), context())

    expect(compiled.ok).toBe(false)
    expect(JSON.stringify(compiled.diagnostics)).toContain("duplicat")
  })

  /**
   * **只给 `alias`、没给 `label`，也算它的点名**（2026-10-05 用户**第二次**现场）。
   *
   * 第二现场与第一次**逐字相同**，但模型这次暂存了 4 笔（还调了 `scene.inspect`）——
   * 说明它确实在建 O，只是把名字填进了 `alias`（草稿内的引用名）、**没填 `label`**（题面里的点名）。
   * 实测：那样建出来的点坐标**完全正确**（BD 的中点），但**没有名字**，于是编译器报
   * `diagram_condition_unverified`（**放行但标记未核验**），最后卡在确认门禁上 ——
   * 与用户 trace 里"校验成功 → cannot confirm"逐字吻合。
   *
   * `alias` 本来就是模型给这个对象起的名字；`solid` 用 `vertexNames` 给顶点命名的道理一样。
   */
  it("只给 `alias` 没给 `label` ⇒ 它也算这个点的点名（不许落到「无名点」）", () => {
    const aliasOnly = {
      actionId: "dynamic.create_bound_point", actionKey: "bound-O", factIds: [],
      inputs: { alias: "O", host: { scope: "draft", alias: "solid" }, hostEdge: { from: "B", to: "D" }, parameter: 0.5 }
    }
    const compiled = compilePlan(rawPlan([TETRA_NAMED, aliasOnly]), context())

    expect(compiled.ok, JSON.stringify(compiled.diagnostics)).toBe(true)
    // 今天这里会剩一条 `diagram_condition_unverified` —— 那正是用户看到的"题设尚未核验"。
    expect(compiled.diagnostics.filter((entry) => entry.code.startsWith("diagram_condition"))).toEqual([])
    expect(positionOf(compiled, "O")).toEqual({ x: 0, y: 0, z: 0 })
  })
})


describe("V0a: a free apex and every coordinate given must be judged", () => {
  const base = [{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 1, y: 2, z: 0 }]
  const makePlan = (apex: { x: number; y: number; z: number }, floor = base) => rawPlan([{
    actionId: "solid.create_polyhedron", actionKey: "free-apex", factIds: [], inputs: {
      alias: "free-apex", vertexNames: ["D", "A", "B", "C"], vertices: [apex, ...floor],
      faces: [[1, 2, 3], [0, 2, 1], [0, 3, 2], [0, 1, 3]]
    }
  }])

  it("rescues a skew apex without inventing an unstated right angle in the triangular base", () => {
    const prompt = "在三棱锥D-ABC中，AD⊥平面ABC，自由点D，画示意图"
    const result = compilePlan(makePlan({ x: 1, y: 0, z: 2 }), context(createEmptyDocument("geometry3d"), { prompt, diagramWitnessSearch: true }))
    expect(result.ok, result.diagnostics.map((item) => item.detail).join("; ")).toBe(true)
    expect(result.diagramVerification?.status).toBe("passed")
    expect(result.materialisedActions).toBeDefined()
    const action = result.materialisedActions!.find((item) => item.actionId === "solid.create_polyhedron")
    const names = (action?.inputs as { vertexNames: string[] }).vertexNames
    const solid = result.draftDocument!.primitives.find((item) => item.type === "polyhedron3")
    expect(solid?.type).toBe("polyhedron3")
    const at = (name: string) => {
      if (solid?.type !== "polyhedron3") throw new Error("missing materialized solid")
      const id = solid.vertexIds[names.indexOf(name)]
      const point = result.draftDocument!.primitives.find((item) => item.id === id)
      if (point?.type !== "point3") throw new Error(`missing named point ${name}`)
      return point.position
    }
    const ab = subtractVector3(at("B"), at("A"))
    const ac = subtractVector3(at("C"), at("A"))
    const ad = subtractVector3(at("D"), at("A"))
    expect(lengthVector3(crossVector3(ab, ac))).toBeGreaterThan(0.1)
    expect(Math.abs(dotVector3(ab, ac))).toBeGreaterThan(0.1) // an unstated base right angle is not assumed
    expect(Math.abs(dotVector3(ad, ab))).toBeLessThan(1e-8)
    expect(Math.abs(dotVector3(ad, ac))).toBeLessThan(1e-8)
    expect(at("D").z).toBeGreaterThan(at("A").z)
  })

  it("measures every explicitly stated vertex coordinate instead of passing a different valid perpendicular", () => {
    const prompt = "在三棱锥D-ABC中，A=(0,0,0)，B=(3,0,0)，C=(1,2,0)，AD⊥平面ABC，画示意图"
    const wrong = compilePlan(makePlan({ x: 1, y: 0, z: 2 }, [{ x: 1, y: 0, z: 0 }, base[1]!, base[2]!]), context(createEmptyDocument("geometry3d"), { prompt, diagramWitnessSearch: true }))
    expect(wrong.diagramVerification?.status).toBe("failed")
    expect(wrong.diagramVerification?.checks).toEqual(expect.arrayContaining([expect.objectContaining({ sourceText: "A=(0,0,0)", status: "failed" })]))
    const correct = compilePlan(makePlan({ x: 0, y: 0, z: 2 }), context(createEmptyDocument("geometry3d"), { prompt, diagramWitnessSearch: true }))
    expect(correct.ok, correct.diagnostics.map((item) => item.detail).join("; ")).toBe(true)
    expect(correct.diagramVerification?.status).toBe("passed")
    expect(correct.diagramVerification?.checks.filter((item) => item.kind === "pointCoordinate")).toHaveLength(3)
  })

  it("does not silently certify above-the-base wording before a reliable oriented judge exists", () => {
    const prompt = "在三棱锥D-ABC中，AD⊥平面ABC，D在底面ABC上方，画示意图"
    const result = compilePlan(makePlan({ x: 0, y: 0, z: 2 }), context(createEmptyDocument("geometry3d"), { prompt, diagramWitnessSearch: true }))
    expect(result.diagramVerification?.status).toBe("unverified")
    expect(result.diagramVerification?.checks.some((item) => item.sourceText.includes("D在底面ABC上方") && item.status === "unverified")).toBe(true)
  })
})

/**
 * **离线入口接上入口语法**（S6 接线）。
 *
 * `searchWitnessForPrompt` 是"题面 → 图形族 → 有界搜索"的离线入口，**救援路径用的是同一份口径**
 * （`witnessSearchInput`）。接线之后它先问入口语法（`specForPrompt`）：
 * 认得出形状从句时，族与 spec 都由那里给。
 *
 * 最直接的证据是**台体**：它的两个环不是从某一句题设读出来的，所以接线之前
 * `棱台` 会落到"任意多面体"那条、只会报"系统尚不支持"；现在能从题面一路走到**通过核验的候选**。
 */
describe("离线入口：入口语法接线", () => {
  it("四棱台的题面 ⇒ 通过核验的候选", () => {
    const result = searchWitnessForPrompt("在四棱台ABCD-A′B′C′D′中，AB⊥AD，画出这个四棱台")
    expect(result.status, JSON.stringify(result)).toBe("verified_instance")
  })

  it("棱锥题面的读数不变（接线只是把**同一份** spec 交给搜索层）", () => {
    const result = searchWitnessForPrompt("在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，BC ∥ AD，AB ⊥ AD，画出这个四棱锥")
    expect(result.status, JSON.stringify(result)).toBe("verified_instance")
  })

  it("读不出的台体题面：拒绝理由是**台体自己的**那句，不是『任意多面体』", () => {
    /**
     * `A₁` 系列点名与内核的顶面命名约定（`A′`）对不上 ⇒ 入口语法认不出 ⇒ 走兜底。
     * 兜底**也报 `frustum`**，于是用户看到的是"台体需要底环 / 顶环 / 相似比"，
     * 而不是对台体来说是假话的"任意多面体的坐标要由调用方给"。
     */
    const result = searchWitnessForPrompt("在四棱台ABCD-A₁B₁C₁D₁中，AB⊥AD，画出这个四棱台")
    expect(result.status).toBe("unverified_instance")
    if (result.status !== "unverified_instance") return
    expect(result.reasons.join(" "), JSON.stringify(result)).toContain("台体")
  })
})

/**
 * **平面图形也要逐条核验题设**（计划 V0b）。
 *
 * ## 为什么这组用例必须存在
 *
 * 原文核验的触发条件此前写死了 `solid.create_polyhedron` —— 于是**任何平面图形都从不进入核验**：
 * 动作编译成功就等于"图符合题意"。这与 V0a 修掉的是**同一类洞**，只是换了一个工作区。
 * 三点的坐标是**真实落盘**的那一份，核验器按点名表逐条量，不读构造方的自述。
 */
describe("V0b: planar figures get the same per-premise verification as solids", () => {
  const PLANAR_PROMPT = "在三角形ABC中，AB⊥AC，画示意图"

  /** 三个**点名**的平面点。A 与 B 钉在坐标轴上，C 由调用方给 —— 它就是这里唯一的变量。 */
  function planarTriangle(c: { x: number; y: number }) {
    return [
      { actionId: "planar.create_point", actionKey: "A", factIds: [], inputs: { alias: "A", points: [{ x: 0, y: 0 }], label: "A" } },
      { actionId: "planar.create_point", actionKey: "B", factIds: [], inputs: { alias: "B", points: [{ x: 2, y: 0 }], label: "B" } },
      { actionId: "planar.create_point", actionKey: "C", factIds: [], inputs: { alias: "C", points: [{ ...c }], label: "C" } }
    ]
  }

  const planarContext = () => context(createEmptyDocument("conics"), { prompt: PLANAR_PROMPT })

  it("verifies AB ⊥ AC from the real coordinates of the three named points", () => {
    const compiled = compilePlan(rawPlan(planarTriangle({ x: 0, y: 3 })), planarContext())
    expect(compiled.ok, compiled.diagnostics.map((item) => item.detail).join("; ")).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("passed")
    expect(compiled.diagramVerification?.checks.map((item) => `${item.sourceText}:${item.status}`)).toEqual(["AB⊥AC:passed"])
  })

  it("fails the very same premise when the figure puts C on the ray AB instead", () => {
    // 同一句话、同一套动作，只把 C 挪到 AB 上 —— 这条**不能**因为"动作都编译过了"就通过。
    const compiled = compilePlan(rawPlan(planarTriangle({ x: 3, y: 0 })), planarContext())
    expect(compiled.diagramVerification?.status).toBe("failed")
    expect(compiled.ok).toBe(false)
    expect(compiled.diagramVerification?.checks).toEqual(expect.arrayContaining([expect.objectContaining({ sourceText: "AB⊥AC", status: "failed" })]))
  })

  it("stays unverified when the named points never reach the document", () => {
    // 只给两个点：题面点名了 C，而候选图里没有它 —— 必须如实报"未核验"，不许按"没有就跳过"处理。
    const plan = rawPlan(planarTriangle({ x: 0, y: 3 }).slice(0, 2))
    const compiled = compilePlan(plan, planarContext())
    expect(compiled.diagramVerification?.status).toBe("unverified")
    expect(compiled.diagramVerification?.checks).toEqual(expect.arrayContaining([expect.objectContaining({ sourceText: "AB⊥AC", status: "unverified" })]))
  })
})

/**
 * **V0c：圆锥曲线也要按原话逐条核验**（计划 `V0c 圆锥曲线`）。
 *
 * 题面给的是方程 `x²/9+y²/4=1`，判据必须落在**画出来的那条椭圆**的真实参数上。
 * 重点不是"半轴对不对"，而是**焦点在哪个轴**：把两个半轴对调，焦点就从 `(±√5, 0)`
 * 变成 `(0, ±√5)` —— 那是另一条曲线，绝不能被判成"通过"。
 */
describe("V0c: conic figures get their premises verified too", () => {
  const ELLIPSE_PROMPT = "椭圆 x²/9+y²/4=1，画示意图"

  /** 一只椭圆；两个半轴就是这里唯一的变量。 */
  function ellipse(radiusX: number, radiusY: number) {
    return [{
      actionId: "planar.create_conic",
      actionKey: "ellipse",
      factIds: [],
      inputs: { alias: "ellipse", kind: "ellipse", center: { x: 0, y: 0 }, radiusX, radiusY, label: "椭圆" }
    }]
  }

  const conicContext = () => context(createEmptyDocument("conics"), { prompt: ELLIPSE_PROMPT })

  it("verifies the stated semi-axes against the ellipse that was actually drawn", () => {
    const compiled = compilePlan(rawPlan(ellipse(3, 2)), conicContext())
    expect(compiled.ok, compiled.diagnostics.map((item) => item.detail).join("; ")).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("passed")
    expect(compiled.diagramVerification?.checks.map((item) => `${item.sourceText}:${item.status}`)).toEqual(["x²/9+y²/4=1:passed"])
  })

  it("fails the same premise when the figure swaps the two semi-axes, which moves the foci", () => {
    // 半轴对调 ⇒ 焦点从 (±√5, 0) 变成 (0, ±√5)。这是**另一条曲线**，不能判通过。
    const compiled = compilePlan(rawPlan(ellipse(2, 3)), conicContext())
    expect(compiled.diagramVerification?.status).toBe("failed")
    expect(compiled.ok).toBe(false)
    expect(compiled.diagramVerification?.checks).toEqual(expect.arrayContaining([expect.objectContaining({ sourceText: "x²/9+y²/4=1", status: "failed" })]))
  })
})

/**
 * **V0d：Agent 要能画出函数图像**（计划 `V0d 导数曲线`）。
 *
 * ## 这条为什么在动作层就先红
 *
 * `packages/dsl` 里一直有 `type: "function"` 图元，场景图也能重算它的导数与切线 ——
 * 但 Agent 的动作表里**只有** `function.analyze` / `function.create_tangent`，
 * **没有任何动作能创建那张图**。也就是说："求 f 的导数"这条路是通的，
 * 而"先画出 f"这一步压根没法表达 —— 函数图像这一类题从入口就是断的。
 */
describe("V0d: the agent can create a function graph", () => {
  /** `x³ − 3x`。写成显式乘号：表达式解析器不承诺把 `3x` 当乘法。 */
  const CUBIC = "x^3-3*x"
  const GRAPH_PROMPT = "画出 f(x)=x³−3x 的图像"

  function graph(expression: string) {
    return [{
      actionId: "function.create_graph",
      actionKey: "graph",
      factIds: [],
      inputs: { alias: "f", expression, domain: [-2, 2] }
    }]
  }

  it("compiles function.create_graph into a real function primitive", () => {
    const compiled = compilePlan(rawPlan(graph(CUBIC)), context(createEmptyDocument("calculus"), { prompt: GRAPH_PROMPT }))
    expect(compiled.ok, compiled.diagnostics.map((item) => item.detail).join("; ")).toBe(true)
    const created = compiled.draftDocument?.primitives.filter((primitive) => primitive.type === "function") ?? []
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ expression: CUBIC, domain: [-2, 2] })
  })

  it("refuses an expression the app cannot parse instead of staging a blank graph", () => {
    // 静默落一张画不出来的图，比拒绝更糟：用户会以为"画好了"。
    const compiled = compilePlan(rawPlan(graph("x^^3")), context(createEmptyDocument("calculus"), { prompt: GRAPH_PROMPT }))
    // **先把"假绿"堵掉**：动作名不认识时 `ok` 同样是 `false`，那条断言就什么都没证明。
    expect(compiled.diagnostics.some((item) => item.code === "unknown_action")).toBe(false)
    expect(compiled.ok).toBe(false)
    expect(compiled.draftDocument).toBeNull()
  })
})

/**
 * **`spatialPointConditions` 是承重的**（S6.2 评估"窄正则退役"时量出来的）。
 *
 * 选项开着时，解析器才把题面里**写死的坐标**与**空间条件**（"在底面上面"）当题设看。
 * 实测（本批逐句量过，两侧都会变，方向相反）：
 *
 * | 题面写法 | 默认 | 带选项 |
 * | --- | --- | --- |
 * | `A=(0,0,0)` / `D=(0,0,2)`（等号坐标） | `unverified_instance` | **`verified_instance`** |
 * | `自由点D在底面ABC上方` / `D(0,0,2)`（无等号） | **`verified_instance`** ⚠ | `unverified_instance` |
 *
 * 读法：**左列两种"通过"与两次"未核验"都不是无所谓**。丢了选项，写死的坐标**进不了图**
 * （题面说了 A 在原点，图上却不是），而"在底面上方"与没带等号的坐标会**静默通过** ——
 * 前者是"核验过了 ≠ 图上是什么"，后者正是本仓最忌的静默放宽。这就是 V0a 那条窄正则
 * **不能盲删**的理由：把 `spatialPointConditions: true` 传下来是它契约的一部分。
 * 谁要让形状族接管那族句子，必须先接管这件事。
 */
describe("空间点条件：这个开关是承重的（不是可选项）", () => {
  it("等号坐标：只有打开选项才会被当成题设（默认进不了图）", () => {
    const baseCoordinate = "在三棱锥D-ABC中，A=(0,0,0)，AD⊥平面ABC，自由点D，画示意图"
    const apexCoordinate = "在三棱锥D-ABC中，D=(0,0,2)，AD⊥平面ABC，自由点D，画示意图"

    expect(searchWitnessForPrompt(baseCoordinate).status).toBe("unverified_instance")
    expect(searchWitnessForPrompt(baseCoordinate, { spatialPointConditions: true }).status).toBe("verified_instance")
    expect(searchWitnessForPrompt(apexCoordinate).status).toBe("unverified_instance")
    expect(searchWitnessForPrompt(apexCoordinate, { spatialPointConditions: true }).status).toBe("verified_instance")
  })

  it("空间条件与无等号坐标：默认会**静默通过**，打开选项才如实报未核验", () => {
    const above = "在三棱锥D-ABC中，AD⊥平面ABC，自由点D在底面ABC上方，画示意图"
    const bareCoordinate = "在三棱锥D-ABC中，D(0,0,2)，AD⊥平面ABC，自由点D，画示意图"

    // ⚠ 左列这两个 `verified_instance` **就是被钉住的陷阱**，不是"正确行为"的背书。
    expect(searchWitnessForPrompt(above).status, "空间条件被静默忽略").toBe("verified_instance")
    expect(searchWitnessForPrompt(above, { spatialPointConditions: true }).status).toBe("unverified_instance")
    expect(searchWitnessForPrompt(bareCoordinate).status, "无等号坐标被静默忽略").toBe("verified_instance")
    expect(searchWitnessForPrompt(bareCoordinate, { spatialPointConditions: true }).status).toBe("unverified_instance")
  })
})
