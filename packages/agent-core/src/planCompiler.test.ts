import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { contentFingerprint } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION } from "./contracts"
import { compilePlan, describeCompileRepairPrompt, type PlanCompileContext } from "./planCompiler"
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
   * **Phase N1：统一 IR 与它的开关**。
   *
   * 这两条一起钉住 N1 的验收条件："`flags=false` 时旧静态示意图链路行为不变"
   * 与"IR 确实接进了编译期"。只断言前者会退化成"什么都没做也算过"；
   * 只断言后者则无法证明回退路还在。
   */
  it("attaches the unified obligation IR to the report the plan compiler produces", () => {
    const result = compilePlan(polyhedronPlan(PYRAMID_VERTICES, PYRAMID_RELATIONS), context(createEmptyDocument("geometry3d"), { prompt: PYRAMID_PROMPT }))

    expect(result.diagramVerification?.obligationIR?.obligations.map((item) => [item.role, item.kind, item.targets])).toEqual([
      ["given", "perpendicular", ["P", "A", "A", "B", "C", "D"]],
      ["given", "parallel", ["B", "C", "A", "D"]]
    ])
  })

  it("leaves the legacy diagram report unchanged when the IR switch is off", () => {
    const result = compilePlan(polyhedronPlan(PYRAMID_VERTICES, PYRAMID_RELATIONS), context(createEmptyDocument("geometry3d"), { prompt: PYRAMID_PROMPT, diagramObligationIR: false }))

    // 报告本体仍然照旧（核验条数与结论一字未变），只是不带 IR。
    expect(result.diagramVerification?.status).toBe("passed")
    expect(result.diagramVerification?.checks).toHaveLength(2)
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
