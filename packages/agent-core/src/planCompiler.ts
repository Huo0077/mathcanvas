import type { GeometryDocument, Workspace } from "@draw/dsl"
import { commitTransaction, compileAction, createIdAllocator, solidTopology3, type ActionContext, type DomainOperation, type DraftAction, type IdAllocator } from "@draw/scene-graph"
import { sectionSolid3, validatePrismInput } from "@draw/geometry-kernel"

import {
  MAX_REPAIR_ATTEMPTS,
  type ClarificationQuestion,
  type PlanDiagnostic,
  type PlanEnvelope,
  type PlanVerification,
  type RepairRequest,
  type StructuredAssumption
} from "./contracts"
import { auditDescriptionFor, type AuditContext } from "./defaultPolicies"
import { auditPlan, type FieldCompletion } from "./parameterAudit"
import { parsePlanEnvelope, repairRequestFor } from "./schemas"
import { isInvariantRequest } from "./underdetermined"

/**
 * **把一份计划编译成动作**（Agent DSL 切片 Task 4；规格 §6.2/§6.3/§7）。
 *
 * ```text
 * 传输解析 → 字段审计 → 引用解析 → 参数补全 → 几何语义校验 → Scene Graph 动作编译
 * ```
 *
 * ## 为什么这六层必须在一处，而不是散在协调器里
 *
 * 每一层都有"不查就会静默出错"的东西：未知字段（模型发明的东西）、悬空别名
 *（新对象引用了一个不存在的名字）、缺省字段（安全默认必须变成看得见的假设）、
 * 退化几何（零向量棱柱）、以及**依赖顺序**（截面引用了同一批里刚建的棱柱）。
 * 分散实现时最容易漏掉的是最后一条，因为它看起来"动作编译器应该会处理"——
 * 而动作编译器是**逐笔对着同一份基准文档**编的（`compileActions` 的契约），
 * 它**看不到同一批里前面的动作**。所以这里逐笔推进工作文档，把前一笔的结果交给后一笔。
 *
 * ## 一条边界
 *
 * `context.document` **只读**：编译在克隆出来的工作文档上逐笔 `commitTransaction`，
 * 产出 `draftDocument`。规格 §1.2 那句"模型只能提出声明式计划，不能直接修改真实文档"
 * 在这里是结构性的 —— 没有任何一条代码路径能写回 `context.document`，
 * 而测试用内容指纹钉住它（`contentFingerprint` 前后相等）。
 */

export interface PlanCompileContext {
  /** 基准（真实）文档。编译**不会**改它。 */
  document: GeometryDocument
  workspace?: Workspace
  capabilityRevision?: string
  /** 用户原话：默认值推断与"任意/恒定"判定要看它。 */
  prompt?: string
  facts?: readonly { id: string; text: string }[]
  conversationId?: string
  documentGeneration?: number
  /** id 占用集（缺省取基准文档的图元 id）。 */
  takenIds?: readonly string[]
  /** 草稿级分配器（`draftStore` 会传它自己的那一份，保证跨 `stage` 幂等）。 */
  idAllocator?: IdAllocator
  orderedSelection?: readonly string[]
}

export interface PlanCompileResult {
  ok: boolean
  /** 六层都过之后可执行的动作：draft 别名已换成真 id。 */
  actions: DraftAction[]
  /** 补全后的计划（`assumptions` 已经并入，界面直接显示这一份）。 */
  plan: PlanEnvelope | null
  assumptions: StructuredAssumption[]
  questions: ClarificationQuestion[]
  /**
   * **逐字段的处理记录**（给了 / 回填了 / 要问的）。
   *
   * 它是"参数遗漏率"唯一的数据来源（见 `agentDslMetrics.test.ts`）：没有它，
   * "有多少字段是系统替用户定的"就只能是事后估的，而估出来的数字不能用来判断
   * "默认策略是不是太激进了"。
   */
  completions: FieldCompletion[]
  diagnostics: PlanDiagnostic[]
  /** 别名 → 真 id（预览与后续批次引用它）。 */
  aliases: Record<string, string>
  /** 已编译的操作，顺序即执行顺序。 */
  operations: DomainOperation[]
  /** 隔离草稿：应用完这批动作之后的候选文档（失败时为 null）。 */
  draftDocument: GeometryDocument | null
  /** 这份计划是怎么被验证的（精确构造 / 数值采样），见 `PlanVerification`。 */
  verification: PlanVerification | null
  /** 一次性修复请求（有可修的字段错误时才给）。 */
  repair?: RepairRequest
}

/** 引用字段：登记表（`ActionAuditDescription.references`）说它是引用，解析阶段据此解析。 */
interface ReferenceField {
  field: string
  /** `scoped` = 带 documentId 的对象引用；`id` = 同文档内的对象 id；`parameter` = 文档参数 id。 */
  kind: "scoped" | "id" | "parameter"
  /** 一批 id（`object.delete_many.targets`）。 */
  list: boolean
  /**
   * **嵌套在对象里的引用**（例如切线的 `anchor.pointId`）。
   *
   * 它同样是"可以指向同一份计划里新建的对象"的引用，所以必须与平铺的引用走同一条解析。
   * 漏掉它的症状很具体：椭圆与动点都建出来了，切线却报 `target_not_found: draft:P`。
   */
  nested?: { outer: string; inner: string; when: { field: string; equals: string } }
}

/**
 * **引用字段只有一份真源**：传输层的动作登记表（Fix round 1 / M4、I12、I16）。
 *
 * 这里以前手抄了一张 `REFERENCE_FIELDS`，于是"注册表说它是引用、解析器却不知道"完全可能
 *（`dynamic.bind_point.host`、`dynamic.bind_curve.pathId`、`dynamic.set_radius_rule.pointId`
 * 都漏在表外）。现在直接从 `ActionAuditDescription.references` 读 —— 传输层与解析器不可能分叉。
 */
function referenceFieldsFor(actionId: string): ReferenceField[] {
  const description = auditDescriptionFor(actionId)
  if (description === null) return []
  return description.references.map((reference) => ({
    field: reference.field,
    kind: reference.kind,
    list: reference.list === true,
    ...(reference.nested === undefined ? {} : { nested: reference.nested })
  }))
}

/** 草稿别名写成 `draft:<alias>`（**这是唯一的别名写法**，来源是 `{scope:"draft"}` 引用）。 */
export const DRAFT_ID_PREFIX = "draft:"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function pathFor(index: number, field?: string): string {
  return field === undefined ? `envelope.actions[${index}]` : `envelope.actions[${index}].inputs.${field}`
}

/** 把审计/解析/编译器给出的原因码整理成一条带层与路径的诊断。 */
function planDiagnostic(stage: PlanDiagnostic["stage"], code: string, path: string, detail: string, severity: PlanDiagnostic["severity"] = "error"): PlanDiagnostic {
  return { stage, code, path, detail, severity }
}

function describeError(error: unknown): string {
  return (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 512)
}

/**
 * **编译一份计划**（`input` 是**不可信**的：模型输出、工具结果或 IPC 载荷）。
 *
 * 返回的结果永远是"一条条说得清的诊断"，绝不抛异常跨边界：调用方（worker / 草稿适配器）
 * 需要的是原因码，而不是一个被打断的通道。
 */
export function compilePlan(input: unknown, context: PlanCompileContext): PlanCompileResult {
  // ---- 1. 传输解析 ------------------------------------------------------
  const parsed = parsePlanEnvelope(input)
  if (!parsed.ok) {
    const diagnostics = parsed.errors.map((error) => planDiagnostic("transport", error.code, error.path, error.detail))
    return {
      ok: false,
      actions: [],
      plan: null,
      assumptions: [],
      questions: [],
      completions: [],
      diagnostics,
      aliases: {},
      operations: [],
      draftDocument: null,
      verification: null,
      repair: repairRequestFor(parsed.errors, 1)
    }
  }

  if (parsed.value.kind !== "plan") {
    // 澄清 / 只读回答：没有动作可编译，但**不是**失败。
    return {
      ok: true,
      actions: [],
      plan: parsed.value,
      assumptions: [],
      questions: parsed.value.kind === "clarification" ? parsed.value.questions.map((text, index) => ({ id: `question-${index}`, text, reason: "规划器要求补充信息。" })) : [],
      completions: [],
      diagnostics: [],
      aliases: {},
      operations: [],
      draftDocument: null,
      verification: null
    }
  }

  const plan = parsed.value
  const auditContext: AuditContext = {
    documentId: context.document.metadata.id,
    workspace: (context.workspace ?? context.document.workspace) as AuditContext["workspace"],
    prompt: context.prompt,
    facts: context.facts,
    parameters: Object.keys(context.document.parameters),
    existingIds: context.document.primitives.map((primitive) => primitive.id)
  }

  // ---- 2. 字段审计（+ 4. 参数补全：审计的回填就是补全，见 `parameterAudit.ts`） ----
  const audit = auditPlan(plan, auditContext)
  const diagnostics: PlanDiagnostic[] = [...audit.diagnostics]
  const assumptions = [...audit.assumptions]
  const questions = [...audit.questions]
  const aliases: Record<string, string> = {}

  if (audit.questions.length > 0 || audit.actions.length === 0) {
    return {
      ok: false,
      actions: [],
      plan: null,
      assumptions,
      questions,
      completions: audit.completions,
      diagnostics,
      aliases,
      operations: [],
      draftDocument: null,
      verification: null,
      // 用户能回答的问题不该变成"让模型重发一遍"（规格 §7：区分配置失败与用户取消）。
      ...(audit.questions.length > 0 ? {} : { repair: repairRequestFor(toParseErrors(audit.diagnostics), 1) })
    }
  }

  /**
   * 补全之后的计划（假设**并进**信封，界面与协调器读同一份）。
   *
   * **合并而不是替换**（Fix round 1 / M6）：规划器自己声明过的那几条（"把直径 6 读作半径 3"）
   * 与审计补出来的那几条是**两批**，替换会让 `draftTools.compilePlan` 的 `payload.plan` 少掉前者
   *（UI 那边因为 `agentRuntime` 又合了一次而看不出来，所以这个缺陷一直没被用户看到）。
   */
  const mergedAssumptions = [...new Set([...(plan.assumptions ?? []), ...assumptions.map((assumption) => assumption.text)])]
  const completedPlan: PlanEnvelope = {
    ...plan,
    assumptions: mergedAssumptions.length === 0 ? undefined : mergedAssumptions,
    actions: audit.actions
  }

  const allocator = context.idAllocator ?? createIdAllocator(context.takenIds ?? context.document.primitives.map((primitive) => primitive.id))
  const workspace = (context.workspace ?? context.document.workspace) as Workspace
  let working: GeometryDocument = structuredClone(context.document)
  const operations: PlanCompileResult["operations"] = []
  const compiledActions: DraftAction[] = []

  // ---- 3/5/6. 逐笔：引用解析 → 几何校验 → 动作编译 → 推进工作文档 ----------
  for (const [index, action] of audit.actions.entries()) {
    /**
     * 注：这里**没有**"补全之后必填字段还缺"的兜底检查 —— 那是死代码（Fix round 1 / I13）。
     * `auditPlan` 在任何错误/提问时返回 `actions: []`，而 `compilePlan` 在那时就提前返回了，
     * 所以循环里的动作必然是补全成功的。缺字段的拒绝**只发生在 `parameter_completion` 那一层**
     *（审计把 `ask_user` / `reject` / 补不出来的诊断标成那个 stage），不再有第二份判据。
     */
    const resolution = resolveReferences(action, index, working, aliases)
    diagnostics.push(...resolution.diagnostics)
    if (resolution.diagnostics.some((entry) => entry.severity === "error")) continue

    const geometry = validateGeometry(resolution.action, index, working)
    diagnostics.push(...geometry.diagnostics)
    if (geometry.diagnostics.some((entry) => entry.severity === "error")) continue

    const actionContext: ActionContext = {
      targetDocument: working,
      targetWorkspace: workspace,
      orderedSelection: [...(context.orderedSelection ?? [])],
      capabilityRevision: context.capabilityRevision ?? "plan-compiler",
      idAllocator: allocator
    }

    let compiled: ReturnType<typeof compileAction>
    try {
      compiled = compileAction(resolution.action, actionContext)
    } catch (error) {
      diagnostics.push(planDiagnostic("action_compile", "compiler_threw", pathFor(index), describeError(error)))
      continue
    }
    if (compiled.diagnostics.length > 0) {
      for (const entry of compiled.diagnostics) diagnostics.push(planDiagnostic("action_compile", entry.code, pathFor(index), entry.message))
      continue
    }

    const transaction = commitTransaction({ base: working, operations: compiled.operations })
    if (transaction.errors.length > 0) {
      diagnostics.push(planDiagnostic("action_compile", "commit_rejected", pathFor(index), transaction.errors.join("; ")))
      continue
    }
    working = transaction.document
    operations.push(...compiled.operations)
    compiledActions.push(resolution.action)
    Object.assign(aliases, compiled.aliasToId)
  }

  const failed = diagnostics.some((entry) => entry.severity === "error")
  if (failed) {
    const errors = toParseErrors(diagnostics)
    return {
      ok: false,
      actions: [],
      plan: null,
      assumptions,
      questions,
      completions: audit.completions,
      diagnostics,
      aliases,
      operations: [],
      draftDocument: null,
      verification: null,
      repair: repairRequestFor(errors, 1)
    }
  }

  const verification = verifyPlan(compiledActions, context.prompt)

  return {
    ok: true,
    actions: compiledActions,
    plan: completedPlan,
    assumptions,
    questions,
    completions: audit.completions,
    diagnostics,
    aliases,
    operations,
    draftDocument: working,
    verification
  }
}

/** 只保留 `envelope.` 前缀的诊断路径，用于构造修复请求（修复只认字段路径）。 */
function toParseErrors(diagnostics: readonly PlanDiagnostic[]): { code: string; path: string; detail: string }[] {
  return diagnostics.filter((entry) => entry.severity === "error").map((entry) => ({ code: entry.code, path: entry.path, detail: entry.detail }))
}

/**
 * **引用解析**：把 `{scope:"draft",alias}` 与 `draft:<alias>` 换成真 id，
 * 并检查场景引用是不是指向**本文档**里真实存在的对象。
 *
 * 三条判据都必须在这里执行，因为下游（动作编译器）拿到的是一个扁平引用，
 * 它**无法区分**"这个 id 是别名没解析"与"这个对象真的不存在" ——
 * 而这两种失败对用户的含义完全不同（一个是我们漏了，一个是模型编了）。
 */
function resolveReferences(action: DraftAction, index: number, document: GeometryDocument, aliases: Record<string, string>): { action: DraftAction; diagnostics: PlanDiagnostic[] } {
  const reference = referenceFieldsFor(action.actionId)[0]
  if (!reference) return { action, diagnostics: [] }
  const inputs = isRecord(action.inputs) ? { ...(action.inputs as Record<string, unknown>) } : {}
  const value = inputs[reference.field]
  const diagnostics: PlanDiagnostic[] = []

  const resolveOne = (entry: unknown, list: boolean): unknown => {
    // 参数引用（`parameter.set` 的 `id`）：查的是**文档参数**，不是图元。
    if (reference.kind === "parameter") {
      if (typeof entry !== "string" || !(entry in document.parameters)) {
        diagnostics.push(planDiagnostic("reference_resolution", "parameter_not_found", pathFor(index, reference.field), `no parameter '${String(entry)}' in ${document.metadata.id}`))
      }
      return entry
    }
    // 作用域引用（`{scope:"draft"}` 或摊平后的 `{documentId,entityId}`）。
    if (isRecord(entry) && ("scope" in entry || "documentId" in entry)) {
      const scope = entry.scope
      if (scope === "draft") {
        const alias = typeof entry.alias === "string" ? entry.alias : ""
        const id = aliases[alias]
        if (!id) {
          diagnostics.push(planDiagnostic("reference_resolution", "unresolved_alias", pathFor(index, reference.field), `no object has been created under the alias '${alias}' before this action`))
          return entry
        }
        return { documentId: document.metadata.id, entityId: id }
      }
      const documentId = typeof entry.documentId === "string" ? entry.documentId : ""
      const entityId = typeof entry.entityId === "string" ? entry.entityId : ""
      if (documentId !== document.metadata.id) {
        diagnostics.push(planDiagnostic("reference_resolution", "cross_document_reference", pathFor(index, reference.field), `'${entityId}' lives in ${documentId}, not ${document.metadata.id}`))
        return entry
      }
      if (!document.primitives.some((primitive) => primitive.id === entityId)) {
        diagnostics.push(planDiagnostic("reference_resolution", "target_not_found", pathFor(index, reference.field), `no object ${entityId} in ${document.metadata.id}`))
      }
      return { documentId, entityId }
    }
    if (typeof entry === "string") {
      if (entry.startsWith(DRAFT_ID_PREFIX)) {
        const alias = entry.slice(DRAFT_ID_PREFIX.length)
        const id = aliases[alias]
        if (!id) {
          diagnostics.push(planDiagnostic("reference_resolution", "unresolved_alias", pathFor(index, reference.field), `no object has been created under the alias '${alias}' before this action`))
          return entry
        }
        return id
      }
      if (!document.primitives.some((primitive) => primitive.id === entry)) {
        diagnostics.push(planDiagnostic("reference_resolution", "target_not_found", pathFor(index, reference.field), `no object ${entry} in ${document.metadata.id}`))
      }
      return entry
    }
    if (!list) diagnostics.push(planDiagnostic("reference_resolution", "invalid_reference", pathFor(index, reference.field), "a reference must be a scoped reference or an id"))
    return entry
  }

  if (reference.list) {
    if (!Array.isArray(value)) {
      diagnostics.push(planDiagnostic("reference_resolution", "invalid_reference", pathFor(index, reference.field), "expected a list of ids"))
      return { action, diagnostics }
    }
    inputs[reference.field] = value.map((entry) => resolveOne(entry, true))
  } else {
    inputs[reference.field] = resolveOne(value, false)
  }

  /**
   * **嵌套引用**（`anchor.pointId`）：与平铺引用走同一条解析路径，只是取值在对象里面。
   * 条件（`anchor.kind === "point"`）不成立时不解析 —— 按曲线参数定位的切线里
   * 那个字段没有意义，硬解析会把"按参数定位"变成一条看不懂的错误。
   */
  if (reference.nested) {
    const outer = inputs[reference.nested.outer]
    if (isRecord(outer) && outer[reference.nested.when.field] === reference.nested.when.equals) {
      const resolved = resolveOne(outer[reference.nested.inner], false)
      inputs[reference.nested.outer] = { ...outer, [reference.nested.inner]: resolved }
    }
  }

  return { action: { ...action, inputs } as DraftAction, diagnostics }
}

/**
 * **几何语义校验**（第 5 层）：判据**来自内核**，不在这一层重写。
 *
 * 这一层此时还看不到"这批动作生成的对象"（那要等编译），所以它只判**与文档无关的那些**：
 * 棱柱的底面/向量（`validatePrismInput`）、圆锥曲线的半轴、棱上参数的取值范围。
 * 与文档相关的语义（跨文档、悬空引用、工作区）由第 3 层与动作编译器负责。
 */
function validateGeometry(action: DraftAction, index: number, document: GeometryDocument): { diagnostics: PlanDiagnostic[] } {
  const inputs = isRecord(action.inputs) ? (action.inputs as Record<string, unknown>) : {}
  const diagnostics: PlanDiagnostic[] = []

  if (action.actionId === "solid.create_prism") {
    const basePolygon = Array.isArray(inputs.basePolygon) ? (inputs.basePolygon as { x: number; y: number; z: number }[]) : []
    const vector = isRecord(inputs.vector) ? (inputs.vector as { x: number; y: number; z: number }) : undefined
    /**
     * `vector` 缺失在这里**不再可能**（Fix round 1 / I13）：它登记了安全默认，审计会回填；
     * 回填不了时 `auditPlan` 会清空动作并走 `parameter_completion`。原来的兜底分支是死代码。
     * 直接调用 `compilePlan` 之外的人（例如手工构造 `DraftAction`）由动作编译器拒绝。
     */
    if (vector) {
      const validation = validatePrismInput(basePolygon, vector)
      if (!validation.ok) {
        for (const entry of validation.diagnostics) diagnostics.push(planDiagnostic("geometry_validation", "degenerate_prism", pathFor(index, "basePolygon"), entry.message))
      }
    }
  }

  if (action.actionId === "planar.create_conic") {
    if (inputs.kind === "ellipse" || inputs.kind === "hyperbola") {
      const radiusX = inputs.radiusX
      const radiusY = inputs.radiusY
      if (typeof radiusX !== "number" || typeof radiusY !== "number" || radiusX <= 0 || radiusY <= 0) {
        diagnostics.push(planDiagnostic("geometry_validation", "degenerate_conic", pathFor(index, "radiusX"), `${String(inputs.kind)} needs positive semi-axes`))
      }
    }
    if (inputs.kind === "parabola" && (typeof inputs.focalParameter !== "number" || inputs.focalParameter === 0)) {
      diagnostics.push(planDiagnostic("geometry_validation", "degenerate_conic", pathFor(index, "focalParameter"), "a parabola needs a non-zero focal parameter"))
    }
  }

  /**
   * 注：棱上参数的 `[0, 1]` 判据**只在审计那一层**（`parameterAudit` 的 `parameter_out_of_domain`）。
   * 这里曾经又判一遍，是同一事实的两份实现，而且因为审计先跑并清空动作，这一份永远跑不到
   *（Fix round 1 / I13）。判据收敛到一处之后，"越界参数"只有一个错误码、一句文案。
   */

  // 未使用的文档参数：`document` 这一层留着是为了将来判"截面是否真的切到实体"，
  // 那需要拓扑物化之后才成立（见 `sectionSolid3` 的用法）。此处不假装已经判过。
  void document
  return { diagnostics }
}

/**
 * **这份计划是怎么被验证的**（规格 §8.2/§10）。
 *
 * 出现"不变量表达式"（`parameter.set_expression`）时**必须**说清是数值采样：
 * 表达式由参数求值器算出来，我们能给的是**采样验证**，不是形式证明。
 * 把它说成"已验证/已证明"就是把采样当成证明 —— 规格 §10 明令不许。
 *
 * 判据复用 `isInvariantRequest`（Fix round 1 / M3）：以前这里另写了一份只认中文的关键词表，
 * 于是英文题面（"for all"/"arbitrary"）会被判成"需要精确证明"，给出一句假的 formal。
 */
function verifyPlan(actions: readonly DraftAction[], prompt: string | undefined): PlanVerification {
  const hasInvariantExpression = actions.some((action) => action.actionId === "parameter.set_expression")
  if (hasInvariantExpression) {
    return {
      kind: "numeric_sampling",
      detail: "不变量表达式由参数求值器在采样点上验证（这些点满足等式），**不是形式证明**：符号证明不在本阶段范围内。"
    }
  }
  if (isInvariantRequest(prompt)) {
    return { kind: "numeric_sampling", detail: "题目要求任意/恒定性，而本计划只做了有限采样的数值核对，不是形式证明。" }
  }
  return { kind: "formal", detail: "每一步都是确定性内核构造（exact）；这份计划不包含需要证明的不变量断言。" }
}

/** 供调用方核对"截面到底切到了什么"（预览与诊断用）；不参与编译判定。 */
export function describeSectionDraft(document: GeometryDocument, sectionId: string): string | null {
  const section = document.primitives.find((primitive) => primitive.id === sectionId)
  if (section?.type !== "section") return null
  const source = document.primitives.find((primitive) => primitive.id === section.sourceId)
  if (!source) return "截面的来源实体已不在文档里。"
  const topology = solidTopology3(source, new Map(document.primitives.map((primitive) => [primitive.id, primitive])))
  if (!topology) return "来源实体的拓扑还不完整。"
  const result = sectionSolid3({ vertices: topology.vertices, faces: topology.faces }, section.plane)
  if (result.status === "exact") return `截面分类 ${result.value.classification}（${result.value.points.length} 个顶点）。`
  if (result.status === "approximate") return `截面（数值近似，残差 ${result.residual.toPrecision(3)}）：${result.value.classification}。`
  return result.reason
}

/** 修复上限：与 `contracts.MAX_REPAIR_ATTEMPTS` 同一份声明（这里只是让调用方少 import 一次）。 */
export const PLAN_REPAIR_LIMIT = MAX_REPAIR_ATTEMPTS
