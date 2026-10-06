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
import { extractRelations } from "./relationExtraction"
import { parseObligationWithLegacy } from "./obligationIR"
import { verifyDiagramObligations, type DiagramVerificationReport } from "./diagramVerification"
import { verifyRelations, type RelationLookup } from "./relations"
import { parsePlanEnvelope, repairRequestFor } from "./schemas"
/**
 * **哪些动作能让"题面点名的顶点"在候选图里有坐标**（计划 V0b）。
 *
 * 原文题设只有在这些动作在场时才谈得上逐条核验 —— 否则核验器拿不到点名表，
 * 所谓"核验"就退化成"动作编译成功即视为图正确"。此前这里写死了 `solid.create_polyhedron`，
 * 于是**任何平面图形都从不进入核验**：那是与 V0a 同一类的洞，只是换了一个工作区。
 *
 * **为什么刻意不含 `solid.create_template`**：它也会给子对象编 `A`、`B`、`C`… 的标签，
 * 但那是**模板自己的顺序编号**，与题面点名不是一回事。把它算进来会让"画个立方体"这类题面
 * 去核验并不存在的点名，而且会改变 `planCompiler.offPath.golden.test.ts` 钉住的关旗逐字节行为。
 * 模板实体的原文核验是**另一件工作**，要单独做、单独取证据。
 */
const VERIFIABLE_FIGURE_ACTION_IDS: ReadonlySet<string> = new Set([
  "solid.create_polyhedron",
  "planar.create_point",
  // 圆锥曲线**没有点名** —— 那条曲线自己就是被核验的对象（见 `candidateConic`）。
  "planar.create_conic",
  /**
   * 函数族**两笔都要**：曲线自己要被判（是不是题面那条函数），切线也要（斜率与切点）。
   * 只放其中一笔，另一笔的判据就会因为"图里没有对应物"而**永远报未核验** ——
   * 那不是保守，是把一条本来能判的题设变成永远判不了。
   */
  "function.create_graph",
  "function.create_tangent"
])

/**
 * **这份计划里有没有"能让题面点名的顶点拿到坐标"的动作** —— 这个问题只有这一处判断。
 *
 * 为什么必须收成一个函数：`planCompiler` 的**编译期**核验与 `draftStore` 的**草稿层再核验**
 * 各要问一次同一个问题。此前两处各写了一份 `action.actionId === "solid.create_polyhedron"`，
 * 于是 V0b 只改了编译器那一份：编译期核验确实跑了，而**用户在面板上什么也看不到** ——
 * 因为面板那份报告来自草稿层，那里仍然认死多面体。这正是本仓"同一个判断写两遍必然分叉"的现场样本，
 * 而且是**单元测试抓不到**的那种：`compilePlan` 的用例只走编译期那一条。
 */
export function planHasVerifiableFigure(actions: readonly { actionId: string }[]): boolean {
  return actions.some((action) => VERIFIABLE_FIGURE_ACTION_IDS.has(action.actionId))
}
/**
 * **N2 的见证搜索**（子任务 2c）。
 *
 * 这一行**有意**造出一个 import 环：`planCompiler → solver/witnessSearch → planCompiler`
 * （搜索器要用**产品那条**物化路径造候选，见 2b 的报告 §9）。两个方向都只在**函数体内**
 * 使用对方的绑定（没有任何模块初始化期的读取），ESM 的活绑定下是惰性的；
 * `searchWitness` / `compilePlan` 都是函数声明，提升之后调用点一定拿得到。
 * 另有一条替代方案是让编译层通过 `PlanCompileContext` 收一个搜索函数 —— 那等于把
 * "谁是搜索器"交给应用层去拼，与"搜索编排只有一处"（N2 的 Ownership）相冲突。
 */
import { searchWitness } from "./solver/witnessSearch"
import type { PolyhedronWitness, WitnessSearchResult, WitnessShapeKind } from "./solver/solverContracts"
/**
 * `isInvariantRequest` 从**叶子模块**导入（复核裁决 R29）。
 *
 * 它原先住在 `./underdetermined`，而那条边会让模块图成环：
 * `planCompiler → underdetermined → solver/witnessSearch → planCompiler`。
 * 判据本身只依赖字符串，搬到一个不 import 任何本包模块的叶子文件即可断环；
 * `underdetermined` 仍然 re-export 同一个函数，既有调用方与本行的**语义**都没有变。
 */
import { isInvariantRequest } from "./invariantRequest"
import { cubeCenterFrom, cubeEdgeLengthFrom, explicitlyRequestsCube } from "./geometryIntent"

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
  /**
   * **Phase N1 的能力开关**（`apps/web/src/agent/featureFlags.ts` 的 `obligationIR`）。
   *
   * 为什么由调用方传进来、而不是在 agent-core 里读那个 flag：开关是**应用级**的
   * （进程环境），而这个包是纯函数库 —— 在这里读 `process.env` 会让"同一份输入
   * 在不同环境给出不同结果"，那样连测试都钉不住。所以库只收一个布尔参数。
   *
   * **语义是"显式为 `true` 才开"**（控制器裁决 R6）：缺省 / `undefined` / `false`
   * 一律**不产出** `obligationIR`。R6 之前是"缺省开 + 生产调用方不传"，
   * 那等于这个开关**事实上从不生效** —— 与 Global Constraints「任何新能力先放在独立
   * feature flag 下」、flags 段「默认全部关闭」、「`flags=false` 时旧静态示意图链路行为不变」
   * 都冲突。保守方向：生产默认走旧路径，IR 只有显式打开才产出。
   */
  diagramObligationIR?: boolean
  /**
   * **Phase N2 的能力开关**（`apps/web/src/agent/featureFlags.ts` 的 `witnessSearch`；
   * 控制器裁决 R37 / R11）。
   *
   * 与 `diagramObligationIR` 同一条口径：由**应用层**持有、作为普通布尔传进来（这个包是纯函数库，
   * 不读进程环境），而且**显式为 `true` 才开** —— 缺省 / `undefined` / `false` 一律走旧路径，
   * 与改动之前逐字相同。
   *
   * 打开之后只多一件事：**当模型自己给的坐标没能通过题设核验时**，让
   * `solver/witnessSearch.ts` 按题设搜一组候选，把它**替换进这份计划**再走一遍
   * 同一个编译路径与同一个核验器，只有第二遍真的 `passed` 才产出草稿（见 `compilePlan`
   * 与 `rescuedByWitnessSearch` 的注释）。搜索**不会**在模型坐标已经合格时跑（R37①）。
   */
  diagramWitnessSearch?: boolean
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
  /** 题设逐条核验：欠定不是失败，无法可靠解析才是未核验。 */
  diagramVerification?: DiagramVerificationReport
  /**
   * **被物化出 `draftDocument` 的那份动作**（Phase N2 / 裁决 R37②）。
   *
   * 只有**救回路径**会带它：见证搜索成功时，编译器把候选的坐标与点名替换进计划，
   * 于是"这份 `draftDocument` 是从哪份动作算出来的"与调用方交进来的那份**不再相同**。
   *
   * 为什么必须回带：草稿层（`DraftStore.stage`）会拿调用方给的动作**再核验一次**
   * （那是 Worker 那条路"报告不能丢"的保证）。拿原始动作去核验一份被替换过坐标、
   * 点名的候选图，结论就会与图不符 —— 救回来的图会被显示成"未核验"甚至"失败"。
   * 缺省（`undefined`）的含义很明确：**调用方给的那份就是被物化的那份**，没有替换发生。
   */
  materialisedActions?: DraftAction[]
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
 *
 * ## Phase N2：开关打开时多一层"救回"（裁决 R37）
 *
 * 六层编译照旧跑一遍（`compileOnce`）。**只有当**这一遍真的物化出了候选、而题设核验
 * 没能 `passed`、题面指定的题型又受支持时，才去问 `solver/witnessSearch.ts` 要一组候选坐标；
 * 拿到之后**替换坐标、重跑同一个 `compileOnce`、要求第二遍核验真的 `passed`**。
 * 三条纪律各有名字：
 *
 * ① **只救不抢** —— 模型自己的坐标已经 `passed` 时连搜索都不调用（`diagramVerification`
 *    `passed` 就原样返回第一遍的结果）；
 * ② **生成物不豁免核验** —— 替换之后走的是**同一个** `buildFromPoints` → 编译路径 →
 *    `verifyDiagramObligations`，"是系统自己生成的"不构成任何捷径；
 * ③ **没有候选就不产生草稿** —— 搜不到（无解 / 不支持的题型 / 预算耗尽 / 构造被拒）
 *    一律把**第一遍**的结果原样交回去，也就是今天那条 fail-closed 路径，不产出半份草稿。
 *
 * 开关关着时（缺省）这个函数就是 `compileOnce(input, context).result` ——
 * 与改动之前逐字相同。
 */
export function compilePlan(input: unknown, context: PlanCompileContext): PlanCompileResult {
  const first = compileOnce(input, context)
  if (context.diagramWitnessSearch !== true) return first.result
  return rescuedByWitnessSearch(context, first) ?? first.result
}

/**
 * `compileOnce` 的**内部**产出：除了给调用方看的那份结果，还有救回路径需要的两样东西
 * （解析后的计划、原话解析产出）。它们**不进** `PlanCompileResult`：那是对外契约，
 * 多一个字段就多一份"看起来可以依赖"的形状。
 */
interface CompileOnceOutcome {
  result: PlanCompileResult
  /** 解析后的计划（只有 `kind: "plan"` 才有）；救回路径要在它上面替换多面体坐标。 */
  plan: Extract<PlanEnvelope, { kind: "plan" }> | null
  /** `parseObligationWithLegacy` 的产出（题设 IR + 旧结构）；救回路径必须喂**同一份**。 */
  obligations: ReturnType<typeof parseObligationWithLegacy> | null
}

/**
 * **六层编译跑一遍**（不含救回）。
 *
 * 抽出来是为了让救回路径能"再走一遍**同一段**代码"，而不是另写一条物化路径 ——
 * 后者一定会与这条分叉（这个项目在"同一个判断写两遍"上已经吃过好几次亏）。
 */
function compileOnce(input: unknown, context: PlanCompileContext): CompileOnceOutcome {
  // ---- 1. 传输解析 ------------------------------------------------------
  const parsed = parsePlanEnvelope(input)
  if (!parsed.ok) {
    const diagnostics = parsed.errors.map((error) => planDiagnostic("transport", error.code, error.path, error.detail))
    return {
      plan: null,
      obligations: null,
      result: {
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
  }

  if (parsed.value.kind !== "plan") {
    // 澄清 / 只读回答：没有动作可编译，但**不是**失败。
    return {
      plan: null,
      obligations: null,
      result: {
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
      plan: null,
      obligations: null,
      result: {
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

  diagnostics.push(...verifyExplicitCubeRequest(compiledActions, context.prompt))
  diagnostics.push(...validateRelations(plan, context.prompt))
  /**
   * **原话清单的解析入口在这里收成一个**（Phase N1）：`parseObligationWithLegacy` 同时给出
   * 旧结构（核验器要吃它）与统一 IR（trace / UI / N2 要吃它），所以"解析一次、两种形状"
   * 不可能分叉。`obligations` 的判据（有 polyhedron 动作 + 有原话）一字未改。
   */
  const obligationParse = context.prompt && planHasVerifiableFigure(compiledActions)
    ? parseObligationWithLegacy(context.prompt, { spatialPointConditions: context.diagramWitnessSearch === true }) : null
  const obligations = obligationParse?.legacy ?? null
  const diagramVerification = obligations && (obligations.givens.length > 0 || obligations.unverified.length > 0)
    ? verifyDiagramObligations(obligations, plan, working, context.document, { obligationIR: context.diagramObligationIR === true }) : undefined
  for (const check of diagramVerification?.checks ?? []) {
    if (check.status === "failed") diagnostics.push(planDiagnostic("geometry_validation", "diagram_condition_failed", "envelope.actions", `${check.sourceText}：${check.reason}`))
    if (check.status === "unverified") diagnostics.push(planDiagnostic("geometry_validation", "diagram_condition_unverified", "envelope.actions", `${check.sourceText}：${check.reason}`, "warning"))
  }
  const failed = diagnostics.some((entry) => entry.severity === "error")
  if (failed) {
    const errors = toParseErrors(diagnostics)
    return {
      plan,
      obligations: obligationParse,
      result: {
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
        ...(diagramVerification === undefined ? {} : { diagramVerification }),
        repair: repairRequestFor(errors, 1)
      }
    }
  }

  const verification = verifyPlan(compiledActions, context.prompt)

  return {
    plan,
    obligations: obligationParse,
    result: {
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
      verification,
      ...(diagramVerification === undefined ? {} : { diagramVerification })
    }
  }
}

/** 只保留 `envelope.` 前缀的诊断路径，用于构造修复请求（修复只认字段路径）。 */
function toParseErrors(diagnostics: readonly PlanDiagnostic[]): { code: string; path: string; detail: string }[] {
  return diagnostics.filter((entry) => entry.severity === "error").map((entry) => ({ code: entry.code, path: entry.path, detail: entry.detail }))
}

// ---------------------------------------------------------------- N2 救回路径

/**
 * 搜索的**固定参数**（R26：同一 seed 必须给出同一结果）。
 *
 * 为什么是常量而不是调用方的入参：编译路径没有"时间预算"这种东西可谈（一次暂存就是一次
 * 用户可见的等待），而把 `maxCandidates` / `timeoutMs` 暴露到 `PlanCompileContext` 会让
 * 这两条读数散进应用层。取值来自 2b 报告的实测建议（`task-2b-report.md` §8.7：
 * 池子上界 13，各候选一次 `compilePlan + verify` 在本机是 ~20ms 量级），
 * 留出余量后取 `24` / `1500ms`。
 */
const WITNESS_SEARCH_SEED = 0
const WITNESS_SEARCH_MAX_CANDIDATES = 24
const WITNESS_SEARCH_TIMEOUT_MS = 1500

/**
 * 题面点名的图形族 → 搜索器的 `shape`（计划 N2 的 `WitnessShapeKind`）。
 *
 * 判据只看**题面自己说要画什么**：首批只有棱锥能被搜索器构造（2b 的 `searchWitness`
 * 对 `prism` / `polyhedron` 都如实报"系统尚不支持"）。所以这里宁可把不确定的题面判成
 * "不是棱锥" —— 判错的代价是**把棱柱题画成棱锥**，那比"这次不救"严重得多。
 *
 * 不认"四面体"：那种题面走的是 `solid.create_tetrahedron`，本来就不进这条路径
 * （救回只在 `solid.create_polyhedron` 上谈），所以不必在这里猜。
 */
function witnessShapeFor(prompt: string): WitnessShapeKind {
  if (/棱锥|pyramid/i.test(prompt)) return "pyramid"
  if (/棱柱|prism/i.test(prompt)) return "prism"
  return "polyhedron"
}

/**
 * **把搜索到的候选坐标替换进这份计划**（同一条 `solid.create_polyhedron` 动作，别名不动）。
 *
 * 四条纪律，每条都在挡一种具体的坏结果：
 *
 * 1. **只替换唯一那只多面体**：核验器的点名映射（`diagramVerification.candidatePoints`）
 *    要求"恰好一只多面体 + 一张点名表"，多了就不是同一道题，宁可放弃救回；
 * 2. **顶点个数必须一致**：这次替换是"把同一只多面体的坐标换成满足题设的那一组"，
 *    不是换一只形状。个数对不上说明模型的图和搜索出来的不是同一族，不替换；
 * 3. **顶点顺序必须保住"模型自己的那个下标空间"**：计划里的 `relations` 用
 *    `v0`、`v1`…引用顶点（`relations.ts` 的既有约定），而模型那串 `vertexNames`
 *    正是"下标 → 点名"的声明。若按候选自己的顺序写回去，`v0` 就会指到另一个顶点，
 *    于是一条本来成立的关系在**第二遍**核验里被报成不成立 —— 那是我们替换顺序造成的假失败。
 *    所以优先把候选的坐标**按模型声明的点名重排**（`vertexNames` 原样保留）；
 * 4. **模型没声明点名时，只有"没有任何下标关系可被误解"才允许按候选自己的顺序写**
 *    （并补上候选的点名）。`plan.relations` 非空就说明下标是有意义的，那时不猜、不替换。
 *
 * 替换不了就返回 `null`（调用方据此放弃救回，保持今天的行为）。
 */
function withWitnessCoordinates(plan: Extract<PlanEnvelope, { kind: "plan" }>, candidate: PolyhedronWitness): Extract<PlanEnvelope, { kind: "plan" }> | null {
  const indexes = plan.actions.flatMap((action, index) => (action.actionId === "solid.create_polyhedron" ? [index] : []))
  if (indexes.length !== 1) return null
  const [index] = indexes
  const action = plan.actions[index]
  const inputs = isRecord(action.inputs) ? (action.inputs as Record<string, unknown>) : {}
  if (!Array.isArray(inputs.vertices) || inputs.vertices.length !== candidate.vertices.length) return null

  const declared = inputs.vertexNames
  const declaredNames = Array.isArray(declared) && declared.every((name) => typeof name === "string") ? (declared as string[]) : null
  /**
   * 模型声明的点名与候选的点名**是不是同一张表**（复核 R43 / M3）。
   *
   * 判据必须是**等长 + 双向集合相等 + 两边各自无重名**，四条缺一不可：
   * - `candidate.names` 里有重名 ⇒ `indexOf` 会把两个下标指到同一处；
   * - `declaredNames` 里有一个候选没有的名字 ⇒ `indexOf` 返回 `-1`，于是
   *   `vertices[-1]` 是 `undefined`、被对象展开摊成 `{}`，面环里还会出现 `-1`。
   * 那种图**不会**通过第二遍核验（`buildFromPoints` 会拒），所以它不可利用；
   * 但"先造一个坏计划再指望下游拒掉"不是这一层该有的写法 —— 这里直接判成"替换不了"。
   */
  const sameNameSet = declaredNames !== null
    && declaredNames.length === candidate.names.length
    && new Set(declaredNames).size === declaredNames.length
    && new Set(candidate.names).size === candidate.names.length
    && candidate.names.every((name) => declaredNames.includes(name))
  const declaredRelations = plan.relations ?? []

  let vertices: PolyhedronWitness["vertices"]
  let faces: PolyhedronWitness["faces"]
  let vertexNames: string[]
  if (sameNameSet) {
    // `permutation[model] = candidate`：按候选的**点名**重排，`v<i>` 因此仍然指向同一个顶点。
    const permutation = declaredNames!.map((name) => candidate.names.indexOf(name))
    vertices = permutation.map((position) => ({ ...candidate.vertices[position] }))
    faces = candidate.faces.map((ring) => ring.map((position) => permutation.indexOf(position)))
    vertexNames = [...declaredNames!]
  } else {
    if (declaredRelations.length > 0) return null
    vertices = candidate.vertices.map((point) => ({ ...point }))
    faces = candidate.faces.map((ring) => [...ring])
    vertexNames = [...candidate.names]
  }

  const actions = [...plan.actions]
  actions[index] = { ...action, inputs: { ...inputs, vertices, faces, vertexNames } } as DraftAction
  return { ...plan, actions }
}

/**
 * **救回路径的对外证据**（R35 条件 ③ + 设计 §1 验收判据 4：系统自选的值必须看得见）。
 *
 * 两句话分开写，因为它们是两件事：
 * - `witness.polyhedron`：**系统替用户定了什么**（2a 的自由值 / 2b 的自选网格值 / 搜索配置）。
 *   与 `underdetermined.ts` 的 polyhedron 见证同一个形状（`kind: "witness"`、可覆盖）。
 * - `witness.evidence`：**凭什么这么说**。`ClaimEvidence.degreesOfFreedom` 在本轮恒为 `null`
 *   （2b 如实留空，见 `solver/witnessSearch.ts` 的 `evidenceFor`），所以文案只能是
 *   **"未计算"** —— 把 `null` 说成"0 自由度"或"图形刚性"就是拿没算过的东西当结论（R35③）。
 */
function witnessAssumptions(found: Extract<WitnessSearchResult, { status: "verified_instance" }>): StructuredAssumption[] {
  return [
    {
      id: "witness.polyhedron",
      text: `系统按题设搜出了这组坐标（题面未给的量是系统自选的示例值，可在属性栏修改）：${found.assumptions.join("；")}`,
      kind: "witness",
      value: found.candidate,
      overridable: true,
      path: "witness.polyhedron"
    },
    {
      id: "witness.evidence",
      text: `这组坐标已按候选图逐条核验：证据状态 ${found.evidence.status}，solver=${found.evidence.solver}；自由度：未计算（null 表示没有算过）。`,
      kind: "witness",
      value: found.evidence,
      overridable: false,
      path: "witness.evidence"
    }
  ]
}

/**
 * **救回**（裁决 R37）：搜一组坐标、替换、重跑编译与核验；任何一步不成立都返回 `null`
 * 让调用方交回**第一遍**的结果（也就是今天的行为）。
 *
 * 顺序即判据，每一步都在挡一种具体的坏结果：
 * 1. 第一遍没有核验报告（没原话 / 没有多面体动作 / 题设一条都没解析出来）→ 没得救；
 * 2. 第一遍已经 `passed` → **连搜索都不调用**（R37①"只救不抢"：模型算对了就别动它）；
 * 3. 搜索没给出 `verified_instance`（无解 / 不支持 / 预算耗尽 / 全被构造期拒掉）→ 不救；
 * 4. 计划里不是唯一那只多面体 → 不替换；
 * 5. 第二遍**必须** `ok` + 有草稿 + 核验 `passed`，三者缺一都不算救回 ——
 *    生成物与模型给的候选走的是同一个核验器，没有任何"系统生成所以跳过"的豁免。
 */
/**
 * **组成一次见证搜索的入参 —— 只有这一处。**
 *
 * 三个常量（seed / 候选上限 / 超时）与"题面 → 图形族"的判据都收在这里，所以**救援路径**与
 * **离线入口**用的是同一份口径。"同一判断写两遍"会在这里造成两种后果之一：要么离线读数与
 * 救援路径的结果不可比，要么有人改了一边忘了另一边。
 */
function witnessSearchInput(ir: Parameters<typeof searchWitness>[0]["obligations"], prompt: string): Parameters<typeof searchWitness>[0] {
  return {
    obligations: ir,
    shape: witnessShapeFor(prompt),
    seed: WITNESS_SEARCH_SEED,
    maxCandidates: WITNESS_SEARCH_MAX_CANDIDATES,
    timeoutMs: WITNESS_SEARCH_TIMEOUT_MS
  }
}

/**
 * **离线见证搜索**：题面 → IR → 图形族 → 有界搜索。**不需要模型给的任何坐标。**
 *
 * ## 为什么它必须存在（以及我此前为什么以为它不存在）
 *
 * 第 36 轮我把 N4 的"求解率"记成"**要先回答离线时喂什么给见证层**，属口径决定" —— 理由是
 * "见证搜索只在救援路径里触发，它要先有一份模型给的计划失败才有东西可救"。**那个理由错了**：
 * 救援路径传进去的只有两样东西 —— `first.obligations.ir`（**解析结果**）与
 * `witnessShapeFor(context.prompt)`（**从题面推出来的图形族**）。**两样都不来自模型。**
 * 所以离线跑见证搜索从来就不缺输入，缺的只是"有人把它包成一个入口"。
 *
 * 与第 46 / 47 轮同源：**先问"是不是已经有别的机制在做"，再下"缺能力"的结论。**
 *
 * 返回的 `status` 与 benchmark 见证层的词表**逐字对应**（`verified_instance` /
 * `unverified_instance` / `no_witness`），所以那一层不需要任何新判断。
 */
export function searchWitnessForPrompt(prompt: string, options: { spatialPointConditions?: boolean } = {}): ReturnType<typeof searchWitness> {
  /**
   * **解析入口与救援路径共用同一个函数**（`parseObligationWithLegacy`），只是开关由调用方给。
   *
   * 早先这里写的是 `parseObligationIR(prompt)` —— 那等价于"永远不带 `spatialPointConditions`"，
   * 于是**离线入口与救援路径看到的题设不是同一份**：救援路径在 V0a 开关打开时会认出原话里
   * 写死的坐标（`planCompiler` 上方那句 `spatialPointConditions: context.diagramWitnessSearch`），
   * 而离线入口认不出。同一道题两条路给出不同结论，正是本仓"同一个判断不许写两遍"要挡的事。
   *
   * 缺省仍然是 `false`：`bench:agent` 的见证层读数是在"开关全关"下取的，改了缺省会让那批历史
   * 读数不可比。要坐标判据的调用方（V0a 的本地规划器）显式传 `true`。
   */
  const parsed = parseObligationWithLegacy(prompt, { spatialPointConditions: options.spatialPointConditions === true })
  return searchWitness(witnessSearchInput(parsed.ir, prompt))
}
function rescuedByWitnessSearch(context: PlanCompileContext, first: CompileOnceOutcome): PlanCompileResult | null {
  const report = first.result.diagramVerification
  if (report === undefined || report.status === "passed") return null
  if (first.plan === null || first.obligations === null || context.prompt === undefined) return null

  const found = searchWitness(witnessSearchInput(first.obligations.ir, context.prompt))

  if (found.status !== "verified_instance") return null

  const candidatePlan = withWitnessCoordinates(first.plan, found.candidate)
  if (candidatePlan === null) return null

  const second = compileOnce(candidatePlan, context)
  if (!second.result.ok || second.result.draftDocument === null || second.result.diagramVerification?.status !== "passed") return null

  return {
    ...second.result,
    assumptions: [...second.result.assumptions, ...witnessAssumptions(found)],
    /**
     * 草稿层的再核验要对着**这一份**（R37②）：被替换过坐标与点名的候选图，
     * 拿模型的原始动作去核验会得出与图不符的结论。
     */
    materialisedActions: second.result.actions
  }
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
  const references = referenceFieldsFor(action.actionId)
  if (references.length === 0) return { action, diagnostics: [] }
  const inputs = isRecord(action.inputs) ? { ...(action.inputs as Record<string, unknown>) } : {}
  const diagnostics: PlanDiagnostic[] = []

  /** 字段按**每一个**登记项传入（见下面的循环）：一个动作登记了几个引用就解析几个。 */
  const resolveOne = (entry: unknown, list: boolean, reference: ReferenceField): unknown => {
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
        /**
         * **宽容一处**：计划把"同一份计划里刚建出来的对象"写成了**场景引用**（`{documentId, entityId:"cube"}`）
         * 而不是草稿别名（`{scope:"draft", alias:"cube"}`）。实测现场：用户要"把正方体沿对角面剖开，标出截面"，
         * 计划是建立方体 → 建截面 → 标截面，后两条把 `cube` / `diagSection` 写成了场景引用，
         * 整轮因此死在 `target_not_found: no object cube`。
         *
         * 为什么可以在这里兜：`aliases` 只装**这一份计划里、这一步之前**已经建出来的对象，
         * 命中别名表就是无歧义的"它就是刚建的那个"；没命中仍然照旧拒绝（模型编的 id 一条都不放过）。
         */
        const draftId = aliases[entityId]
        if (draftId) return { documentId: document.metadata.id, entityId: draftId }
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
        /** 同上面那条：裸名字命中"本计划里刚建出来的别名"时按别名解析（现场见上）。 */
        const draftId = aliases[entry]
        if (draftId) return draftId
        diagnostics.push(planDiagnostic("reference_resolution", "target_not_found", pathFor(index, reference.field), `no object ${entry} in ${document.metadata.id}`))
      }
      return entry
    }
    if (!list) diagnostics.push(planDiagnostic("reference_resolution", "invalid_reference", pathFor(index, reference.field), "a reference must be a scoped reference or an id"))
    return entry
  }

  /**
   * **一个动作登记了几个引用，就解析几个**（外部审查 A2）。
   *
   * 原先这里只取 `referenceFieldsFor(action.actionId)[0]` —— **只解析第一个字段**。
   * 于是第二个引用永远指不到同一份计划里的别名：
   * - `dynamic.bind_curve` 的 `pathId`（`kind: "id"`）压根没人解析，`draft:c` 原样传下去，
   *   动作层报 `path_not_found: no path draft:c`；
   * - `dynamic.bind_point` 的 `host`（`kind: "scoped"`）同样没人解析，那个未解析的
   *   `{ scope: "draft", alias }` 到了下游因为"没有匹配的 documentId"被判成
   *   `cross_document_reference` —— 两句话都在说"引用错了"，而真正错的是**我们漏解析了一个字段**。
   *
   * 更糟的是那唯一一次修复机会：`RepairRequest` 带的是出错的 `path`，而它只会指到**第一个**字段上，
   * 于是"改一处就能救回来"的那一次被花在了错的地方。
   */
  for (const reference of references) {
    const value = inputs[reference.field]
    if (reference.list) {
      if (!Array.isArray(value)) {
        diagnostics.push(planDiagnostic("reference_resolution", "invalid_reference", pathFor(index, reference.field), "expected a list of ids"))
        continue
      }
      inputs[reference.field] = value.map((entry) => resolveOne(entry, true, reference))
    } else {
      inputs[reference.field] = resolveOne(value, false, reference)
    }

    /**
     * **嵌套引用**（`anchor.pointId`）：与平铺引用走同一条解析路径，只是取值在对象里面。
     * 条件（`anchor.kind === "point"`）不成立时不解析 —— 按曲线参数定位的切线里
     * 那个字段没有意义，硬解析会把"按参数定位"变成一条看不懂的错误。
     */
    if (reference.nested) {
      const outer = inputs[reference.nested.outer]
      if (isRecord(outer) && outer[reference.nested.when.field] === reference.nested.when.equals) {
        const resolved = resolveOne(outer[reference.nested.inner], false, reference)
        inputs[reference.nested.outer] = { ...outer, [reference.nested.inner]: resolved }
      }
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

/**
 * **编译阶段失败时给模型的修复提示**（Agent DSL 切片 Task 4 的接线）。
 *
 * 传输解析失败的提示由 `outputParser.describeRepairPrompt` 生成（它按**通道**给格式建议）。
 * 编译阶段的失败不是格式问题：计划已经是一个合法的 JSON 信封，错的是字段里说的东西
 *（悬空别名、退化几何、越界参数）。所以这一份提示换了个说法，并且必须回答**卡在哪一层** ——
 * 规格 §6.2 把六层各自的名字当成排障的第一个问题，而"计划不成立"是没用的。
 *
 * 层名来自诊断本身（`PlanDiagnostic.stage`），不在这里重算：诊断说 `geometry_validation`，
 * 提示就写 `geometry_validation`。`allowedChanges` 原样来自 `RepairRequest` ——
 * "这次只允许改这几处"是编译器的判断，不是提示文案自己推的。
 *
 * 与 `describeRepairPrompt` 一样，**绝不回显模型的原话**（那会把散文再送回去，
 * 形成自我强化的循环）。
 */
export function describeCompileRepairPrompt(repair: RepairRequest, diagnostics: readonly PlanDiagnostic[] = []): string {
  const failed = diagnostics.filter((entry) => entry.severity === "error")
  const lines = failed.length > 0
    ? failed.map((entry) => `${entry.stage}/${entry.code}@${entry.path}: ${entry.detail}`)
    : repair.errors.map((error) => `${error.code}@${error.path}: ${error.detail}`)
  const layers = [...new Set(failed.map((entry) => entry.stage))]
  /**
   * **按错误路径补一句"下一步怎么改"**（2026-10-04，来自真实运行）。
   *
   * 只按签名给针对性提醒，不做通用泛谈。三条签名都来自真实运行里出现过的失败：
   * ① 平面动作带了 `z`（模型建完立体后想用 `planar.*` 补几条边）；
   * ② `kind` 为 plan 却塞了 `answer`/`toolResultRefs`；
   * ③ 信封层失败时重申顶层合同。
   */
  const targeted = targetedRepairAdvice(failed.length > 0 ? failed : repair.errors)
  return [
    layers.length > 0 ? `上一份计划没有通过编译管线，卡在：${layers.join(" / ")}。` : "上一份计划没有通过编译管线。",
    "原因如下（层 + 字段路径 + 原因）：",
    lines.join("; "),
    repair.allowedChanges.length > 0 ? `这次只允许改这几处：${repair.allowedChanges.join(", ")}` : "这次只允许改上面点名的字段。",
    ...targeted,
    "请重新返回一份完整的计划信封，不要附加任何解释文字。"
  ].join("\n")
}

/**
 * 按**错误签名**给针对性提醒。签名来自真实运行，不是想象出来的：
 *
 * - `points` 上出现 `unexpected field 'z'` ⇒ 模型把**三维坐标**给了**平面动作**。
 *   它建完 `solid.create_polyhedron` 之后，会想用 `planar.create_segment` 去补 OA / CD 这类边，
 *   而平面动作只收 `x`/`y` —— 于是**整份计划被传输层拒掉**。
 * - `envelope.answer` 出现在 `plan` 分支 ⇒ 它把两个分支的字段混在一起了。
 * - 其余 `envelope.*` 失败 ⇒ 重申顶层合同（**只列仍然必填的字段**；`schemaVersion`/`factIds`/`kind`
 *   已改为可推断，再要求模型补它们等于制造又一轮无谓失败）。
 */
function targetedRepairAdvice(errors: readonly { code: string; path: string; detail: string }[]): string[] {
  const advice: string[] = []
  const planarZ = errors.some((error) => error.path.includes(".inputs.points") && error.detail.includes("'z'"))
  if (planarZ) {
    advice.push("提醒：`planar.*` 动作在**平面上**作图，坐标只能有 `x`、`y`，**不接受 `z`** —— 带上 `z` 会被直接拒。立体图元（顶点/棱/面）请由 `solid.*` 动作一次建出；不要再用 `planar.*` 去补立体的边。")
  }
  const answerInPlan = errors.some((error) => error.path === "envelope.answer" || error.path === "envelope.toolResultRefs" || error.path === "envelope.questions")
  if (answerInPlan) {
    advice.push("提醒：`kind` 为 `plan` 时顶层**只能有** `schemaVersion`、`kind`、`goal`、`factIds`、`assumptions`、`relations`、`actions`。`answer` / `toolResultRefs` / `questions` 属于别的分支，**不要混进来**。")
  }
  const envelopeFailure = errors.some((error) => error.path.startsWith("envelope")) && !answerInPlan
  if (envelopeFailure) {
    advice.push("提醒：`kind` 为 `plan` 时顶层必须有 `goal` 与 `actions`（数组，至少一项）。")
  }
  return advice
}

/** Code gate for unambiguous dimensions in the user's original cube request. */
/**
 * **关系核验**（设计 2026-10-03 §5.3/§5.5）。
 *
 * 与 `validateGeometry` 是同一类东西 —— 都是"这批动作产出的几何对不对"，所以 stage 同样用
 * `geometry_validation`，失败也走同一条一次性修复回路。
 *
 * **这一层才是真正解掉用户报障的地方**：题面只给关系、不给数值时（"在四棱锥 P-ABCD 中，
 * PA ⊥ 平面 ABCD，BC ∥ AD，AB ⊥ AD"），模型得自己算出一组坐标；而"它算的到底对不对"
 * 过去**没有任何检查**，只有内核那套退化判据（共面 / 自交 / 零体积 / 绕向）。
 *
 * 两件事，顺序不能反：
 * ① **覆盖度** —— 原话点名了 ⊥/∥/共面 而计划一条都没声明 → `relation_not_declared`。
 *    没有这一条，模型只要"不声明"就能绕过全部核验，而系统照样宣布关系成立。
 * ② **残差** —— 声明了的每条，用 `relations.ts` 的判据逐条算（那里是唯一真源）。
 *
 * **顶点名用下标约定** `v0`、`v1`…（执行前的裁定 2）：`solid.create_polyhedron` 的
 * `inputs` 今天没有顶点名字段，所以判据侧只能按下标认。取名不对会走"取不到顶点"这条
 * 失败路径（`relation_not_satisfied`），**不是静默通过**。
 */
/**
 * **关系核验**（设计 2026-10-03 §5.3/§5.5，2026-10-03 追加方案 C）。
 *
 * 与 `validateGeometry` 是同一类东西 —— 都是"这批动作产出的几何对不对"，所以 stage 同样用
 * `geometry_validation`，失败也走同一条一次性修复回路。
 *
 * ## 为什么关系由**系统从原话里抽**，而不是要模型声明
 *
 * 第一版让模型在计划里声明一张 `relations` 表，系统只做覆盖度校对 + 残差核验，想法是
 * "判据精确、模型也没法糊弄过去"。**真实应用推翻了它**（2026-10-03 用户现场）：
 * 发「在四棱锥 P-ABCD 中，PA垂直 平面 ABCD，BC平行 AD，AB垂直AD，画出P-ABCD」，
 * 模型两次都没给出 `relations` —— 即使系统明确告诉它「这次只允许改这几处：envelope.relations」、
 * 并把缺的那两条（perpendicular / parallel）逐条列出来，它仍然只是把同一份计划又发了一遍。
 *
 * 于是那条门禁变成了**模型满足不了的关卡**：一份几何完全正确的计划，会因为"没有自证"被判失败。
 * **质量门禁不能依赖被测方主动配合** —— 所以关系改由系统自己从原话里读（方案 C）。
 *
 * ## 点位怎么对上
 *
 * 抽取器的 targets 是**下标名** `v0`、`v1`…，而下标按**原话里点名的出现顺序**定：
 * 「在四棱锥 P-ABCD 中…」里的 `P`、`A`、`B`、`C`、`D` 依次是 `v0`…`v4`。
 * 这与 `solid.create_polyhedron` 的 `vertices` 顺序是同一个约定（模型的顶点数组也按题面点名的
 * 顺序给）。**名字对不上就不抽**（抽取器自己处理），抽不出来的那条不进核验、也不会被当成"通过"。
 *
 * ## 忠实于能验的部分
 *
 * 只核验**抽得出来**的关系；抽不出来的（写法不认识、点名不在计划里）不会让计划失败，
 * 但也**不会被说成"已核验"**。已知局限：这些"未核验"目前只写进编译期日志，还没有一路
 * 显示到用户面前 —— 那需要新增一条面向用户的通道，不在本次范围内。
 */
function validateRelations(plan: PlanEnvelope, prompt: string | undefined): PlanDiagnostic[] {
  const diagnostics: PlanDiagnostic[] = []
  const actions = plan.kind === "plan" ? plan.actions : []

  // ① **从原话抽关系**（方案 C 的核心）。
  //
  //    点位怎么对上：优先用模型**显式给出的点名**（`create_polyhedron` 的可选 `vertexNames`；
  //    只有模型知道 P 是哪个顶点）。没有那个字段时才退回"按原话点名的出现顺序"这条**假设** ——
  //    它会在模型打乱顶点顺序时静默指错顶点，所以一旦有声明就用声明。
  const declaredNames = vertexNamesOf(plan)
  // Without vertexNames, the prompt order is not a mapping. A guessed mapping
  // can turn a correct diagram into a false geometry failure.
  const extracted = declaredNames === null ? { relations: [] } : extractRelations(prompt ?? "", (name) => declaredNames.indexOf(name))
  const fromPrompt = extracted.relations.map((entry) => entry.relation)

  // ② 模型**自愿声明**的关系一并核验（契约里保留 `relations`：它不再被要求，但给了就认）。
  const declared = plan.kind === "plan" ? plan.relations ?? [] : []

  // 两边合起来去重：同一条关系（kind + targets 一模一样）只验一次。
  const seen = new Set<string>()
  const relations = [...fromPrompt, ...declared].filter((relation) => {
    const key = `${relation.kind}:${relation.targets.map((target) => target.vertex).join(",")}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  /**
   * ③ 抽到了关系、但**这份计划不产出任何自由坐标**时，没得验。
   *    这不是"关系成立"，如实标成 warning，不当成通过。
   */
  const hasPolyhedron = actions.some((action) => action.actionId === "solid.create_polyhedron")
  if (!hasPolyhedron && (relations.length > 0 || /⊥|∥|垂直|平行/.test(prompt ?? ""))) {
    return [planDiagnostic("geometry_validation", "relation_not_checkable", "envelope.actions", `题目里读到了 ${relations.length} 条几何关系，但这份计划没有产出可核验的顶点（缺少 solid.create_polyhedron），关系未被核验。`, "warning")]
  }
  if (relations.length === 0) return diagnostics

  // ④ 残差：顶点从计划里读出来（此刻只有 inputs，还没有图元 id）。
  const lookup: RelationLookup = (target) => vertexByName(plan, target.vertex)
  for (const failure of verifyRelations(relations, lookup).failures) {
    diagnostics.push(planDiagnostic("geometry_validation", "relation_not_satisfied", "envelope.relations", `关系 ${failure.id}（${failure.kind}）不成立：${failure.detail}`))
  }
  return diagnostics
}

/**
 * 计划里**显式声明的**顶点名（`create_polyhedron` 的可选 `vertexNames`），没有就返回 `null`。
 *
 * 为什么它比"按原话出现顺序猜"可靠：只有模型知道自己把哪个坐标放在 `vertices` 的第几位。
 * 有它时，关系里的点名能**精确**映到下标；没有时必须报未核验，不再推断题面出现顺序。
 */
function vertexNamesOf(plan: PlanEnvelope): string[] | null {
  if (plan.kind !== "plan") return null
  for (const action of plan.actions) {
    if (action.actionId !== "solid.create_polyhedron") continue
    const inputs = action.inputs
    if (!isRecord(inputs)) continue
    const names = inputs.vertexNames
    if (Array.isArray(names) && names.every((name) => typeof name === "string")) return names as string[]
  }
  return null
}

/** 顶点名（`v0`、`v1`…）→ 坐标。名字不合约定时返回 `null`（**不许拿默认值顶上**）。 */
function vertexByName(plan: PlanEnvelope, name: string): { x: number; y: number; z: number } | null {
  if (plan.kind !== "plan") return null
  const match = /^v(\d+)$/.exec(name)
  if (!match) return null
  const ordinal = Number(match[1])
  for (const action of plan.actions) {
    if (action.actionId !== "solid.create_polyhedron") continue
    // 分两句写而不是 `||` 合并：合并时 TS 不会把 `inputs` 缩窄到 `Record<string, unknown>`，
    // 于是 `inputs.vertices` 报 TS2339（实测）。分开写才缩得住。
    const inputs = action.inputs
    if (!isRecord(inputs)) continue
    const rawVertices = inputs.vertices
    if (!Array.isArray(rawVertices)) continue
    const vertex = rawVertices[ordinal]
    if (isRecord(vertex) && typeof vertex.x === "number" && typeof vertex.y === "number" && typeof vertex.z === "number") {
      return { x: vertex.x, y: vertex.y, z: vertex.z }
    }
    // 只有一份多面体计划：下标越界就当取不到。
    return null
  }
  return null
}

function verifyExplicitCubeRequest(actions: readonly DraftAction[], prompt: string | undefined): PlanDiagnostic[] {
  if (!prompt || !explicitlyRequestsCube(prompt)) return []
  const cubeActions = actions.map((action, index) => ({ action, index })).filter(({ action }) => action.actionId === "solid.create_template" && isRecord(action.inputs) && action.inputs.template === "cube")
  if (cubeActions.length > 1 && /(?:一个|one|single)/i.test(prompt)) {
    return [planDiagnostic("geometry_validation", "user_constraint_mismatch", "envelope.actions", "the user requested one cube, but the plan creates more than one")]
  }
  if (cubeActions.length !== 1) return []
  const { action, index } = cubeActions[0]
  const inputs: unknown = action.inputs
  if (!isRecord(inputs) || !isRecord(inputs.origin) || !isRecord(inputs.size)) return []
  const origin = inputs.origin
  const size = inputs.size
  const edge = cubeEdgeLengthFrom(prompt)
  const center = cubeCenterFrom(prompt)
  const diagnostics: PlanDiagnostic[] = []
  const near = (actual: unknown, expected: number): boolean => typeof actual === "number" && Math.abs(actual - expected) < 1e-7
  if (edge !== null && ![size.x, size.y, size.z].every((value) => near(value, edge))) {
    diagnostics.push(planDiagnostic("geometry_validation", "user_constraint_mismatch", pathFor(index, "size"), `the user requested cube edge length ${edge}; planned size differs on at least one axis`))
  }
  if (center && !["x", "y", "z"].every((axis) => near((origin[axis] as number) + (size[axis] as number) / 2, center[axis as keyof typeof center]))) {
    diagnostics.push(planDiagnostic("geometry_validation", "user_constraint_mismatch", pathFor(index, "origin"), "cube origin is a corner; origin + size / 2 must equal the center explicitly requested by the user"))
  }
  return diagnostics
}
