import type { GeometryDocument, PrimitiveSpec, Workspace } from "@draw/dsl"
import { commitTransaction, compileAction, createIdAllocator, solidTopology3, type ActionContext, type DomainOperation, type DraftAction, type IdAllocator } from "@draw/scene-graph"
import { ratioParameterFor, sectionSolid3, validatePrismInput, DEFAULT_SOLID_SEGMENTS, foldAnglesForTargetDistance, searchFoldAngles } from "@draw/geometry-kernel"

import {
  MAX_REPAIR_ATTEMPTS,
  PLAN_SCHEMA_VERSION,
  type ClarificationQuestion,
  type PlanDiagnostic,
  type PlanEnvelope,
  type PlanVerification,
  type RepairRequest,
  type StructuredAssumption
} from "./contracts"
import { auditDescriptionFor, type AuditContext } from "./defaultPolicies"
import { roundFrustumChordError } from "./localPlanDefaults"
import { DRAFT_ID_PREFIX } from "./schemaReaders"
import { auditPlan, type FieldCompletion } from "./parameterAudit"
import { extractRelations } from "./relationExtraction"
import { parseObligationWithLegacy } from "./obligationIR"
import { constructTetrahedron } from "./solver/tetrahedron"
import { materialiseFoldHinges } from "./solver/foldHinges"
import { constructSquarePyramid } from "./solver/pyramid"
import { constructRegularSquarePyramid } from "./solver/regularPyramid"
import { constructRegularTriangularPyramid } from "./solver/regularTriangularPyramid"
import { constructRightPrism } from "./solver/prism"
import { constructRightTrapezoidPrism } from "./solver/trapezoidPrism"
import { constructPerpendicularPyramid } from "./solver/perpendicularPyramid"
import { constructDihedralTriangle } from "./solver/dihedral"
import { missingNamedPoints, verifyDiagramObligations, type DiagramVerificationReport, type MissingNamedPoint } from "./diagramVerification"
import { parseDiagramObligations } from "./diagramObligations"
import { buildFigureIntent, readFoldTransformations } from "./figureIntent"
import { materialisedHostAction, planFigureMaterialisation } from "./figureMaterialisation"
import { applyNormalisation, parseNormalisationReply, type NormalisationReport } from "./promptNormalization"
import { normalizeGeometryPrompt, expandExamShorthand } from "./latexNormalisation"
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
  /**
   * **平面面片**（2026-10-10 用户现场）：`solid.create_face` 同样产出带点名的自由坐标
   *（顶点 + 一只 `face3`），而"平面四边形 + 翻折片"这类**开放曲面只能用它表达** ——
   * 不含它等于"用面片画的图一律不核验"，与上面那条平面图形的洞是同一类。
   */
  "solid.create_face",
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
export function planHasVerifiableFigure(actions: readonly { actionId: string; inputs?: unknown }[]): boolean {
  return actions.some((action) =>
    VERIFIABLE_FIGURE_ACTION_IDS.has(action.actionId)
    /**
     * **棱柱要单独判：带了点名才算**（Task 13，2026-10-12）。
     *
     * 实测洞：棱柱的顶点原先叫 `P1…P6`（**模板自己的顺序编号**，与题面点名不是一回事），
     * 于是题面里 `AB=2` 一条都拿不到坐标 —— 而这一轮 `ok=true`、**核验一条都没跑**（静默通过）。
     *
     * **为什么不能把它直接加进上面那个集合**：那会让"只画个棱柱"的题面也去核验并不存在的点名，
     * 把本来能过的挡住 —— 这与那条"刻意不含 `solid.create_template`"的理由是**同一条**。
     * 所以判据落在**这一笔动作有没有带点名**上，而不是落在动作名上。
     */
    || (action.actionId === "solid.create_prism" && prismCarriesVertexNames(action.inputs))
  )
}

/** 棱柱这一笔有没有带点名（`vertexNames`，底面 n 个 + 顶面 n 个）。 */
function prismCarriesVertexNames(inputs: unknown): boolean {
  if (inputs === null || typeof inputs !== "object") return false
  const names = (inputs as { vertexNames?: unknown }).vertexNames
  return Array.isArray(names) && names.length >= 6
}

/**
 * **自己写坐标的动作**：这两笔的 `vertices` 是**模型给的自由坐标**（不是模板 / 内核算出来的）。
 *
 * 设计 §6 的"坐标来源标注"只对它们有意义 —— 别的动作根本没有坐标可以被"构造"替换，
 * 对它们说"这份坐标未经条件构造"是**假话**（它们没有可构造的坐标）。
 * 与上面那张表的分工：那张表回答"题面点名的顶点有没有坐标可核验"，这张表回答
 * "这组坐标是不是模型自己写的" —— 平面工作区的 `planar.create_point` 在前者里、不在这里。
 */
const FREE_COORDINATE_ACTION_IDS: ReadonlySet<string> = new Set(["solid.create_polyhedron", "solid.create_face"])

function planHasFreeCoordinates(plan: Extract<PlanEnvelope, { kind: "plan" }>): boolean {
  return plan.actions.some((action) => FREE_COORDINATE_ACTION_IDS.has(action.actionId))
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
import { searchWitness, specForPrompt } from "./solver/witnessSearch"
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
   * **模型给的题面改写**（2026-10-10 第二件）：界面要把「原件 → 我这样读」摆给用户看。
   * 没有改写时**不存在这个键**（不是 `undefined`）—— 与 `materialisedActions` 同一条纪律。
   */
  promptNormalisation?: NormalisationReport
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

/**
 * 草稿别名写成 `draft:<alias>`（**这是唯一的别名写法**，来源是 `{scope:"draft"}` 引用）。
 *
 * 真源搬去 `schemaReaders`（2026-10-10）：`readIdReference` 也要把 `{scope:"draft",alias}`
 * 收成这个字符串，两处各写一份字面量就又多一处会漂移的真源。这里转出去只为既有引用不改。
 */
export { DRAFT_ID_PREFIX } from "./schemaReaders"

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
 * ## 两条救援，顺序固定
 *
 * 1. **补建题面点到、图上没有的点**（`rescueWithMaterialisedPoints`，2026-10-10）：**默认路径**就跑，
 *    不挂开关 —— 它是**修缺陷**（题面点到的点必须真的存在），不是实验特性。它只做题设唯一确定了
 *    构造的两种点，而且第二遍核验必须真的 `passed` 才算数。
 * 2. **见证搜索**（`rescuedByWitnessSearch`，开关打开时）：坐标整体不合格时按题设搜一组候选。
 *
 * 补建排在前面，因为它比搜索便宜、而且是确定性的；它救不回来时**原样交回第一遍**，下面那条
 * 照旧按自己的开关决定要不要跑。
 *
 * 开关关着、又不需要补建时（缺省），这个函数就是 `compileOnce(input, context).result` ——
 * 与改动之前逐字相同；`planCompiler.offPath.golden.test.ts` 钉住这一点（含"off 路径上不存在
 * `materialisedActions`"）。
 */
export function compilePlan(input: unknown, context: PlanCompileContext): PlanCompileResult {
  const first = compileOnce(input, context)
  /**
   * **折角剪裁**（2026-10-17 用户截图）：模型坐标已经通过核验时，默认路径不会再走救援。
   * 但 `solid.fold` 只追加折片、不会把折走的角从宿主面上拿走 —— 画面于是同时有平放的 AEF
   * 和折起来的 PEF。这里把宿主面重写成五边形（A 保留为参考点），再编一遍；**只改可见拓扑**，
   * 题设仍由同一个核验器按最终坐标复核。
   */
  if (first.plan !== null && first.result.diagramVerification?.status === "passed") {
    const cut = cutFoldedCorner(first.plan)
    if (cut !== first.plan) {
      const cutCompiled = compileOnce(cut, context)
      if (cutCompiled.result.ok && cutCompiled.result.draftDocument !== null && cutCompiled.result.diagramVerification?.status === "passed") {
        /**
         * 草稿层会拿 **materialisedActions** 对着候选图再核一遍。剪角之后动作已经变成
         * “五边形面 + A 参考点 + 折片”，不回写就会被原始 A–D 面核验，面数与点名对不上。
         */
        return { ...cutCompiled.result, materialisedActions: cutCompiled.result.actions }
      }
    }
  }
  /**
   * **只对核验复跑一次语法展开**（2026-10-19，solid-32 现场）：`AB=AA₁=2` 这类链式
   * 相等、`△ABC是边长为3的等边三角形` 这类缩写，解析器本身不展开；模型坐标可能是对的，
   * 却因为条件没读全而显示“未核验”。这里用展开后的题面重新编译/核验一次，
   * 只接受 `passed`，不改变原文与 span。
   */
  if (first.plan !== null && first.result.diagramVerification?.status === "unverified" && context.prompt !== undefined) {
    const expanded = expandExamShorthand(normalizeGeometryPrompt(context.prompt))
    if (expanded !== context.prompt && expanded !== normalizeGeometryPrompt(context.prompt)) {
      const recheck = compileOnce(first.plan, { ...context, prompt: expanded })
      if (recheck.result.ok && recheck.result.draftDocument !== null && recheck.result.diagramVerification?.status === "passed") {
        return { ...recheck.result, materialisedActions: recheck.result.actions }
      }
    }
  }
  /**
   * **梯形底直四棱柱**先试：它只匹配 `直四棱柱 + AB⊥AD/AB//CD + 体积`，不依赖前面那些
   * 顺序/环清洗是否已经救出一个半成品。solid-20 的模型计划经常在面环处就编不过，
   * 排在结构清洗之后会根本走不到。
   */
  const trapezoidPrism = rescueWithTrapezoidPrism(context, first)
  if (trapezoidPrism !== null) return trapezoidPrism
  const perpendicularPyramid = rescueWithPerpendicularPyramid(context, first)
  if (perpendicularPyramid !== null) return perpendicularPyramid
  const circumcenter = rescueWithCircumcenterPoint(context, first)
  if (circumcenter !== null) return circumcenter
  /**
   * **结构清洗**（2026-10-19，任务 P1-3）：先修顺序，再把非法折角按 90° 安全默认回填，
   * 然后才编译。旧路径把“顺序”和“折角”分成两次救援，第一处修好后第二处仍会挡住整轮。
   */
  const structural = rescueWithStructuralRepairs(context, first)
  if (structural !== null) return structural
  const sortedRings = rescueWithSortedFaceRings(context, first)
  if (sortedRings !== null) return sortedRings
  /**
   * **线段引用了还没建出来的点**（2026-10-17 评测现场）：模型把 `EF` 排在了
   * `bound E/F` 之前。移动它到末尾重编一次 —— 只动顺序，不改字段。
   */
  const reordered = rescueWithSegmentOrder(context, first)
  if (reordered !== null) return reordered
  const materialised = rescueWithMaterialisedPoints(context, first)
  if (materialised !== null) return materialised
  /**
   * **六条棱都给了的四面体**（2026-10-19，P1-1）：坐标由解析构造，不再让模型心算。
   * 排在补折之前：它是纯坐标构造，不依赖折片。
   */
  const tetrahedron = rescueWithTetrahedronEdges(context, first)
  if (tetrahedron !== null) return tetrahedron
  const regularTriangularPyramid = rescueWithRegularTriangularPyramid(context, first)
  if (regularTriangularPyramid !== null) return regularTriangularPyramid
  const regularPyramid = rescueWithRegularSquarePyramid(context, first)
  if (regularPyramid !== null) return regularPyramid
  const pyramid = rescueWithSquarePyramid(context, first)
  if (pyramid !== null) return pyramid
  const prism = rescueWithRightPrism(context, first)
  if (prism !== null) return prism
  const dihedral = rescueWithDihedralTriangle(context, first)
  if (dihedral !== null) return dihedral
  /**
   * **题面说要折、计划里却没有折**：按题面补上那一笔（选项②，2026-10-15）。
   *
   * 排在折角反求**之前**是必须的：折角反求要有一笔 `solid.fold` 才谈得上反求它的角。
   * 顺序因此是「补点 → **补折** → 反求折角 → 见证搜索」。
   */
  const synthesised = rescueWithSynthesisedFold(context, first)
  if (synthesised !== null) return synthesised
  /**
   * **折角反求**排在见证搜索之前：它是**解析**的、确定的、也不吃候选预算（Task 12）。
   * 它同样"只救不抢"：第一遍通过了就一步都不动。
   */
  const solvedFold = rescueWithSolvedFoldAngle(context, first)
  if (solvedFold !== null) return solvedFold
  if (context.diagramWitnessSearch !== true) return first.result
  const rescue = rescuedByWitnessSearch(context, first)
  if (rescue.status === "rescued") return rescue.result
  /**
   * **规范折片重建**放在最后**（2026-10-19 稳定性复跑）：前面的补折/折角反求/见证救援
   * 都能救时优先用它们；都救不回来时，再按题面比例 + 平面见证坐标从头重建折片。
   * 这样既有测试断言的 `synthesised-fold` / `witness.polyhedron` 路径不会被抢走。
   */
  const foldConstruction = rescueWithFoldConstruction(context, first)
  if (foldConstruction !== null) return foldConstruction
  /** 第 ③ 条纪律的**另一半**：救不回来时不但原样交回第一遍，还要**说清这组坐标是谁给的**。 */
  return rescue.status === "not-needed" ? first.result : labelModelCoordinates(first, rescue.reason)
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
/**
 * **渲染级退化提示**（2026-10-19，P4-4）：标记点近重合、标签碰撞风险、全部共线。
 * 只发警告，不阻止出图；相机参数不在编译期，暂不判断。
 */
function renderDegeneracyWarnings(document: GeometryDocument): PlanDiagnostic[] {
  const points = document.primitives
    .filter((primitive): primitive is Extract<typeof primitive, { type: "point3" }> => primitive.type === "point3")
    .map((primitive) => ({ label: (primitive as { label?: unknown }).label, position: (primitive as unknown as { position: { x: number; y: number; z: number } }).position }))
    .filter((point): point is { label: string; position: { x: number; y: number; z: number } } => typeof point.label === "string" && point.position !== undefined)
  const warnings: PlanDiagnostic[] = []
  const tolerance = 1e-6
  let extent = 0
  for (let first = 0; first < points.length; first += 1) {
    for (let second = first + 1; second < points.length; second += 1) {
      const a = points[first]!
      const b = points[second]!
      extent = Math.max(extent, Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y, a.position.z - b.position.z))
    }
  }
  const labelThreshold = extent * 0.02
  for (let first = 0; first < points.length; first += 1) {
    for (let second = first + 1; second < points.length; second += 1) {
      const a = points[first]!
      const b = points[second]!
      const distance = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y, a.position.z - b.position.z)
      if (distance <= tolerance) {
        warnings.push(planDiagnostic("geometry_validation", "render_near_coincident_points", "envelope.actions", `${a.label} 与 ${b.label} 的距离 ${distance.toExponential(2)} 近重合，渲染时可能无法分辨。`, "warning"))
      } else if (extent > tolerance && distance <= labelThreshold) {
        warnings.push(planDiagnostic("geometry_validation", "render_label_collision_risk", "envelope.actions", `${a.label} 与 ${b.label} 仅相距 ${distance.toPrecision(3)}（图幅跨度 ${extent.toPrecision(3)}），标签可能重叠。`, "warning"))
      }
    }
  }
  if (points.length >= 3) {
    const origin = points[0]!.position
    const direction = points[1]!.position
    const axis = { x: direction.x - origin.x, y: direction.y - origin.y, z: direction.z - origin.z }
    const axisLength = Math.hypot(axis.x, axis.y, axis.z)
    if (axisLength > tolerance) {
      const collinear = points.slice(2).every((point) => {
        const vector = { x: point.position.x - origin.x, y: point.position.y - origin.y, z: point.position.z - origin.z }
        const cross = {
          x: axis.y * vector.z - axis.z * vector.y,
          y: axis.z * vector.x - axis.x * vector.z,
          z: axis.x * vector.y - axis.y * vector.x
        }
        return Math.hypot(cross.x, cross.y, cross.z) / axisLength <= tolerance
      })
      if (collinear) warnings.push(planDiagnostic("geometry_validation", "render_collinear_points", "envelope.actions", "所有标记点共线，渲染视角会退化成一条线。", "warning"))
    }
  }
  return warnings
}

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

  /**
   * **`goal` 缺失时用题面原话补**（2026-10-15 用户现场）。
   *
   * 传输层已经把"缺失"收成空串（`schemas.ts` 那一处写了理由：模型在唯一的修复轮里把整个
   * `goal` 丢了，整轮停在一个字符串上）。这里补上的是**用户自己写的那句话**（题面第一行），
   * 所以**系统仍然不替模型编一句话** —— 显示出来的目标句就是题面原文。
   * "这一行不是模型给的"这件事**要显形**：下面那条 `goal_inferred` 警告会进开发者视图。
   */
  const promptGoal = context.prompt?.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? ""
  const goalWasMissing = parsed.value.goal.trim() === ""
  if (goalWasMissing && promptGoal !== "") parsed.value.goal = promptGoal

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
  /**
   * **传输层的非致命提示**（2026-10-11）：解析器丢掉了它认不出的条目（今天只有一种 ——
   * `relations` 里出现内核不认识的 `kind`）。它必须以 `warning` 走到用户面前：
   * 静默丢掉一条模型写过的东西，正是本仓最忌的那种静默；而它**不该**把整份计划作废
   *（那个决定的读数与理由写在 `schemas.ts` 的 `readRelations`）。
   */
  const transportNotes = [
    ...(parsed.notes ?? []).map((note) => planDiagnostic("transport", note.code, note.path, note.detail, "warning")),
    /**
     * **`goal` 的出处也要显形**（2026-10-15 用户现场）：模型没给这一栏、系统用题面原话补的，
     * 就明说 —— 与"系统替你做的选择要写出来"是同一条纪律（只是这里替的是**一句话**，不是几何）。
     */
    ...(goalWasMissing && promptGoal !== ""
      ? [planDiagnostic("transport", "goal_inferred", "envelope.goal", `模型这一轮没有给 \`goal\`；目标句取自**题面原话**「${promptGoal}」，系统没有替它另编一句话。`, "warning")]
      : [])
  ]
  const diagnostics: PlanDiagnostic[] = [...transportNotes, ...audit.diagnostics]
  const assumptions = [...audit.assumptions, ...approximationAssumptions(audit.actions)]
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

  /**
   * **题面规范化**（2026-10-10 第二件；设计见 `promptNormalization.ts` 的模块头）。
   *
   * 计划里带着模型给的改写时，用它把"我们读不懂"的从句换成标准写法，然后**照旧走同一个解析器与
   * 核验器** —— 判据（指不回原文 / 编造点名 / 关系换弱 / 改写后仍读不出）全在 `promptNormalization`，
   * 这里只负责"换文本、接着往下走"。没有任何改写、或全被拒 ⇒ 用**原文**，行为与今天逐字相同。
   */
  const promptText = context.prompt
  const declaredNormalisations = plan.kind === "plan" ? plan.normalisations ?? [] : []
  const unreadClauses = promptText === undefined || declaredNormalisations.length === 0 ? [] : parseDiagramObligations(promptText).unverified
  const normalisation = promptText === undefined || unreadClauses.length === 0
    ? null
    : parseNormalisationReply({ clauses: declaredNormalisations }, promptText, unreadClauses)
  const effectivePrompt = normalisation === null || normalisation.accepted.length === 0 || promptText === undefined
    ? promptText
    : applyNormalisation(promptText, normalisation.accepted)
  /** 解析/核验只看归一化题面；模型改写与 span 仍走 `effectivePrompt`。 */
  const parserPrompt = effectivePrompt === undefined ? undefined : normalizeGeometryPrompt(effectivePrompt)

  diagnostics.push(...verifyExplicitCubeRequest(compiledActions, parserPrompt))
  diagnostics.push(...validateRelations(plan, parserPrompt))
  /**
   * **原话清单的解析入口在这里收成一个**（Phase N1）：`parseObligationWithLegacy` 同时给出
   * 旧结构（核验器要吃它）与统一 IR（trace / UI / N2 要吃它），所以"解析一次、两种形状"
   * 不可能分叉。`obligations` 的判据（有 polyhedron 动作 + 有原话）一字未改。
   *
   * 这里读的是 `effectivePrompt`（原文，或规范化之后的题面）—— 两处都只有这一个来源。
   */
  const obligationParse = parserPrompt && planHasVerifiableFigure(compiledActions)
    ? parseObligationWithLegacy(parserPrompt, { spatialPointConditions: context.diagramWitnessSearch === true }) : null
  const obligations = obligationParse?.legacy ?? null
  const diagramVerification = obligations && (obligations.givens.length > 0 || obligations.unverified.length > 0)
    ? verifyDiagramObligations(obligations, plan, working, context.document, { obligationIR: context.diagramObligationIR === true }) : undefined
  for (const check of diagramVerification?.checks ?? []) {
    if (check.status === "failed") diagnostics.push(planDiagnostic("geometry_validation", "diagram_condition_failed", "envelope.actions", `${check.sourceText}：${check.reason}`))
    if (check.status === "unverified") diagnostics.push(planDiagnostic("geometry_validation", "diagram_condition_unverified", "envelope.actions", `${check.sourceText}：${check.reason}`, "warning"))
  }
  /**
   * **题面说的是"翻折"，那就必须真的折过**（Task 13，2026-10-12）。
   *
   * 判据来自 `figureIntent` 的 `fold` 变换（题面那句话的唯一机器可读形状），量的是**最终坐标**：
   * 折是刚体运动 ⇒ `apexAs` 到折痕两端的距离必须与 `apex` 的一样。
   * 没有这一条时，"模型绕开 `solid.fold`、直接把 `P` 写在某个满足 `PC=4√3` 的地方"会**通过核验** ——
   * 实测读数：八条条件全 `passed`，而 `|PE| = 12.93` 对 `|AE| = 3.46`（差 3.7 倍），
   * 图根本不是折出来的。
   */
  if (effectivePrompt !== undefined && obligationParse !== null) {
    diagnostics.push(...foldRigidityDiagnostics(effectivePrompt, obligationParse.ir, working))
  }
  diagnostics.push(...renderDegeneracyWarnings(working))
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
        ...(normalisation === null ? {} : { promptNormalisation: normalisation }),
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
      ...(normalisation === null ? {} : { promptNormalisation: normalisation }),
      ...(diagramVerification === undefined ? {} : { diagramVerification })
    }
  }
}

/**
 * **画出来的东西里，哪些是"近似"**（§3-F；设计 §S4.3 的"在文档与面板上如实声明是近似"）。
 *
 * ## 为什么要有它
 *
 * 圆台不是"画出来的圆台"，而是**内接多边形近似**。夹具那条路（`localPlanner` 的圆台夹具）
 * 早就把段数与**弦高误差**写进了假设，而**动作那条路（模型给三个数）此前一个字都没说** ——
 * 确认面板上什么都没有，用户会把一只 48 边形的多面体当成理想圆台。
 *
 * ## 为什么修在编译期
 *
 * 动作层（`compileSolidRoundFrustum`）只产出图元与诊断，**没有"假设"这条通道**；
 * 而编译期补出来的假设有一条既有的、能走到用户眼前的路：
 * `completionAssumptions` → 草稿预览 → 运行时 `assumptions()` → 确认面板。
 *
 * ## 数字只有一个真源
 *
 * 弦高误差由 `roundFrustumChordError` 算（与夹具那条路同一个函数），并取**两个半径里较大的
 * 那一个** —— 风险在较大半径那一环，而题面完全可能给一只上底更大的圆台。
 */
function approximationAssumptions(actions: readonly DraftAction[]): StructuredAssumption[] {
  const out: StructuredAssumption[] = []
  for (const action of actions) {
    if (action.actionId !== "solid.create_round_frustum") continue
    const inputs = (action.inputs ?? {}) as { radiusBottom?: unknown; radiusTop?: unknown; segments?: unknown }
    const bottom = typeof inputs.radiusBottom === "number" && Number.isFinite(inputs.radiusBottom) ? inputs.radiusBottom : null
    const top = typeof inputs.radiusTop === "number" && Number.isFinite(inputs.radiusTop) ? inputs.radiusTop : null
    // 两个半径缺一个就没什么可说的（那一笔本来就编不过，诊断在别处报）。
    if (bottom === null || top === null) continue
    const segments = typeof inputs.segments === "number" && Number.isInteger(inputs.segments) && inputs.segments >= 3
      ? inputs.segments : DEFAULT_SOLID_SEGMENTS
    const radius = Math.max(bottom, top)
    // 指名用的是哪一环：只说"弦高误差"而不说按哪个半径算，用户没法对照自己的题面。
    const where = radius === bottom ? "下底" : "上底"
    const chordError = roundFrustumChordError(radius, segments)
    out.push({
      id: `${action.actionKey}.round-frustum-approximation`,
      /**
       * 它既不是"缺省字段的默认值"，也不是"搜出来的一组坐标"：它说的是**这份几何本身是近似的**。
       * 所以新开一个 `kind`，而不是借 `witness` / `symbolic` 的名字。
       */
      kind: "approximation",
      value: { segments, radius, chordError },
      /**
       * 段数是一个**用户可以开口改**的旋钮（"用 96 段"），所以可覆盖 ——
       * 与"题目要求恒定"那类不可覆盖的取舍不同。
       */
      overridable: true,
      text: `圆台用正 ${segments} 边形近似（与圆柱 / 圆锥同一套分段口径）：两个底面是内接于圆的 ${segments} 边形，侧面是 ${segments} 个等腰梯形；${where}处弦高误差 ${chordError.toPrecision(3)} —— 多边形的边到理想圆弧的最大距离。它是近似，不是那个真的圆台。`
    })
  }
  return out
}

/** 只保留 `envelope.` 前缀的诊断路径，用于构造修复请求（修复只认字段路径）。 */function toParseErrors(diagnostics: readonly PlanDiagnostic[]): { code: string; path: string; detail: string }[] {
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
 * **首选入口语法**（S6）：`specForPrompt` 认得出形状从句、也推得出几何时，族与 spec 都由它给 ——
 * 一份解析，救援路径与离线入口共用。这里的两条正则只是**兜底**：形状从句缺失、或读不出时，
 * 才退回"题面里提到哪个词"这个更弱的判据。
 *
 * 判据只看**题面自己说要画什么**：判错的代价是**把棱柱题画成棱锥**，那比"这次不救"严重得多。
 *
 * 不认"四面体"：那种题面走的是 `solid.create_tetrahedron`，本来就不进这条路径
 * （救回只在 `solid.create_polyhedron` 上谈），所以不必在这里猜。
 */
function witnessShapeFor(prompt: string): WitnessShapeKind {
  if (/棱锥|pyramid/i.test(prompt)) return "pyramid"
  if (/棱柱|prism/i.test(prompt)) return "prism"
  /**
   * 台体走兜底时也报 `frustum`（而不是"任意多面体"）：这样拒绝的理由是**台体自己的那句**
   * （"需要底环 / 顶环 / 相似比"），而不是"任意多面体的坐标要由调用方给" —— 后者对台体是假话，
   * 没人会手写台体坐标。
   */
  if (/棱台/i.test(prompt)) return "frustum"
  /**
   * **裸的平面图形**（2026-10-11，乙案 Task 1）：题面只给了环与度量条件，没有立体家族。
   *
   * 这一支**排在立体之后**：`在四棱锥P-ABCD中` 那类题面先由上面三条接住，不会被它抢走。
   * 走到这里说明既没有立体字样、又提到了多边形 —— 报 `planar-figure` 比报 `polyhedron` 诚实：
   * 后者会给出"任意多面体的坐标要由调用方给"那句**对平面题是假话**的理由（与台体那条同源）。
   */
  if (/四边形|三角形|五边形|六边形/.test(prompt)) return "planar-figure"
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
  /**
   * **宿主是"恰好一笔自己写坐标的动作"**（乙案 Task 5）：多面体那一支与平面片那一支**互斥** ——
   * 同一个图形不会被两笔动作声明，两种都在场就说明这份计划里不止一个候选宿主，那时不猜。
   *
   * 平面片这一支是 Task 5 补上的：用户那句题面画的就是**平面四边形 + 翻折片**，
   * 模型声明它的动作是 `solid.create_face`（多面体根本表达不了开放曲面）。
   * 只认多面体的话，这一族**永远接不进候选替换** —— 内核已经把坐标造出来了，却落不了盘。
   */
  const polyhedra = plan.actions.flatMap((action, index) => (action.actionId === "solid.create_polyhedron" ? [index] : []))
  const faceIndexes = plan.actions.flatMap((action, index) => (action.actionId === "solid.create_face" ? [index] : []))
  const host = polyhedra.length === 1 && faceIndexes.length === 0
    ? { index: polyhedra[0]!, planar: false }
    : faceIndexes.length === 1 && polyhedra.length === 0
      ? { index: faceIndexes[0]!, planar: true }
      : null
  if (host === null) return null
  const index = host.index
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
  /**
   * **平面片没有 `faces`**：环就是 `vertices` 的顺序。所以平面宿主只写回坐标与点名，
   * 不往 `inputs` 里塞一个它不认的字段（多面体那一支的 `faces` 是它自己的）。
   */
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
  actions[index] = host.planar
    ? ({ ...action, inputs: { ...inputs, vertices, vertexNames } } as DraftAction)
    : ({ ...action, inputs: { ...inputs, vertices, faces, vertexNames } } as DraftAction)
  return { ...plan, actions }
}

/**
 * **折一个角时，把那个角从宿主面上剪掉**（2026-10-17 用户截图）。
 *
 * 现场：四边形 ABCD 是一整张面，`solid.fold` 只**追加**了折片 PEF，没有把 AEF 从底面上拿走。
 * 于是画面同时有“平放的 AEF”和“折起来的 PEF”——看起来像四边形旁边多挂了一个尖片，
 * 不是折角。核验只看点坐标，所以它一路通过。
 *
 * 这条变换做三件事（只在“折片三角形正好是宿主面的一个角”时触发）：
 * 1. 宿主面 `[A,B,C,D]` → 五边形 `[B,C,D,E,F]`（A 角剪掉）；
 * 2. E/F 由 `dynamic.create_bound_point` 固化成五边形的两个顶点（删掉那两笔 bound point）；
 * 3. A 单独保留成一个点（折前位置），供**折前题设**（AB / AD / ∠BAD / AE 比…）继续核验。
 *
 * 折片动作不动；它的 `vertices` 会被去掉，按点名从文档取 A/E/F（五边形顶点 + A 参考点）。
 */
function cutFoldedCorner(plan: Extract<PlanEnvelope, { kind: "plan" }>): Extract<PlanEnvelope, { kind: "plan" }> {
  const fold = plan.actions.find((action) => action.actionId === "solid.fold")
  if (!fold) return plan
  const foldInputs = fold.inputs as { vertexNames?: unknown; apex?: unknown }
  const apex = foldInputs.apex
  const names = foldInputs.vertexNames
  if (typeof apex !== "string" || !Array.isArray(names)) return plan
  const hingeNames = names.filter((name): name is string => typeof name === "string" && name !== apex)
  if (hingeNames.length !== 2) return plan

  const hostIndex = plan.actions.findIndex((action) => action.actionId === "solid.create_face")
  if (hostIndex < 0) return plan
  const host = plan.actions[hostIndex]!
  const hostInputs = host.inputs as { vertexNames?: unknown; vertices?: unknown }
  if (!Array.isArray(hostInputs.vertexNames) || !Array.isArray(hostInputs.vertices)) return plan
  const ring = hostInputs.vertexNames.filter((name): name is string => typeof name === "string")
  const positions = hostInputs.vertices as { x: number; y: number; z: number }[]
  if (ring.length !== positions.length) return plan
  const apexIndex = ring.indexOf(apex)
  if (apexIndex < 0) return plan
  const count = ring.length
  const previous = ring[(apexIndex - 1 + count) % count]!
  const next = ring[(apexIndex + 1) % count]!

  /** E/F 目前由 `dynamic.create_bound_point` 建在宿主面的两条邻边上；取它们的坐标。 */
  const bound = (name: string): { from: string; to: string; position: { x: number; y: number; z: number } } | null => {
    const action = plan.actions.find((candidate) => {
      if (candidate.actionId !== "dynamic.create_bound_point") return false
      const inputs = candidate.inputs as { label?: unknown; alias?: unknown }
      return inputs.label === name || inputs.alias === name
    })
    if (!action) return null
    const inputs = action.inputs as { hostEdge?: { from?: unknown; to?: unknown }; parameter?: unknown }
    if (inputs.hostEdge === undefined || typeof inputs.hostEdge.from !== "string" || typeof inputs.hostEdge.to !== "string") return null
    if (typeof inputs.parameter !== "number" || !Number.isFinite(inputs.parameter)) return null
    const fromIndex = ring.indexOf(inputs.hostEdge.from)
    const toIndex = ring.indexOf(inputs.hostEdge.to)
    if (fromIndex < 0 || toIndex < 0) return null
    const from = positions[fromIndex]!
    const to = positions[toIndex]!
    const t = inputs.parameter
    return { from: inputs.hostEdge.from, to: inputs.hostEdge.to, position: { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t } }
  }
  const edgesApex = (entry: { from: string; to: string }, other: string): boolean =>
    (entry.from === apex && entry.to === other) || (entry.from === other && entry.to === apex)
  const entries = hingeNames.map((name) => ({ name, entry: bound(name) }))
  if (entries.some((item) => item.entry === null)) return plan
  const previousEntry = entries.find((item) => edgesApex(item.entry!, previous))
  const nextEntry = entries.find((item) => item !== previousEntry && edgesApex(item.entry!, next))
  if (previousEntry === undefined || nextEntry === undefined) return plan

  const apexPosition = positions[apexIndex]!
  const rotated = [...ring.slice(apexIndex + 1), ...ring.slice(0, apexIndex)]
  const rotatedPositions = [
    ...positions.slice(apexIndex + 1),
    ...positions.slice(0, apexIndex)
  ]
  const pentagonNames = [...rotated, previousEntry.name, nextEntry.name]
  const pentagonPositions = [...rotatedPositions, previousEntry.entry!.position, nextEntry.entry!.position]

  const rewrittenHost = {
    ...host,
    inputs: { ...(host.inputs as Record<string, unknown>), vertices: pentagonPositions, vertexNames: pentagonNames }
  }
  const anchor = {
    actionId: "planar.create_point",
    actionKey: `cut-anchor-${apex}`,
    factIds: [],
    inputs: { alias: `${apex}-ref`, label: apex, points: [{ x: apexPosition.x, y: apexPosition.y }] }
  } as unknown as (typeof plan.actions)[number]
  const boundNames = new Set(hingeNames)
  const actions: (typeof plan.actions)[number][] = []
  for (const action of plan.actions) {
    if (action.actionId === "dynamic.create_bound_point") {
      const inputs = action.inputs as { label?: unknown; alias?: unknown }
      if (boundNames.has(String(inputs.label)) || boundNames.has(String(inputs.alias))) continue
    }
    if (action === fold) {
      actions.push(anchor)
      const inputs = action.inputs as Record<string, unknown>
      const { vertices: _stale, ...rest } = inputs
      actions.push({ ...action, inputs: rest } as typeof action)
      continue
    }
    actions.push(action === host ? rewrittenHost as typeof action : action)
  }
  return { ...plan, actions }
}

/**
 * **把引用折后点（P）的动作移到折之后**（2026-10-17 用户现场）。
 *
 * 计划里已经有 `solid.fold`，但线段（如 `PC`）排在它**前面** ⇒ 编译按顺序执行，
 * 找不到 `P`。折叠这一笔不能动（它的 A/E/F 依赖在前），所以只把**引用 P 的动作**后移。
 * 只动顺序、不改任何字段 —— 与"同一批按顺序执行"的语义一致。
 */
function moveFoldedPointReferencesAfterFold(plan: Extract<PlanEnvelope, { kind: "plan" }>): Extract<PlanEnvelope, { kind: "plan" }> {
  const foldIndex = plan.actions.findIndex((action) => action.actionId === "solid.fold")
  if (foldIndex < 0) return plan
  const fold = plan.actions[foldIndex]!
  const apexAs = (fold.inputs as { apexAs?: unknown }).apexAs
  if (typeof apexAs !== "string") return plan
  const references = (action: (typeof plan.actions)[number]): boolean => {
    const inputs = action.inputs as { vertexNames?: unknown } | null | undefined
    return Array.isArray(inputs?.vertexNames) && inputs.vertexNames.includes(apexAs)
  }
  const actions = [...plan.actions]
  const moved: (typeof plan.actions)[number][] = []
  for (let index = 0; index < actions.length; index += 1) {
    if (index !== foldIndex && index < foldIndex && references(actions[index]!)) {
      moved.push(actions[index]!)
      actions.splice(index, 1)
      index -= 1
    }
  }
  if (moved.length === 0) return plan
  const shiftedFoldIndex = actions.indexOf(fold)
  actions.splice(shiftedFoldIndex + 1, 0, ...moved)
  return { ...plan, actions }
}

/**
 * **把见证搜索给的坐标接进折片动作**（2026-10-17 用户现场，最后一块拼图）。
 *
 * 见证救援只替换**宿主动作**（平面片 / 多面体）的 `vertices`，而 `solid.fold` 里
 * 模型往往还手写了一份 A/E/F 的坐标、以及一个自己猜的折角。两份坐标不一致时：
 * 四边形是新的、折片还是旧的 ⇒ 第二遍核验必然失败（PE≠AE、PC≠4√3），救援被丢弃。
 *
 * 两档处理：
 * 1. **所有点名都能从“折之前”的文档里取到**（A 来自平面片、E/F 来自 bound point）
 *    ⇒ 去掉 `vertices`，让 `compileSolidFoldAction` 按点名取最新坐标（Task 13 的既有路径）；
 * 2. 取不全时，至少把与四边形同名的那几个顶点换成求解器给的坐标（E/F 保持原样）。
 *
 * 折角不在这里猜：替换完坐标后交给 `rescueWithSolvedFoldAngle` 按题面距离反求。
 */
function adoptWitnessCoordinatesInFold(
  plan: Extract<PlanEnvelope, { kind: "plan" }>,
  candidate: PolyhedronWitness,
  context: PlanCompileContext
): Extract<PlanEnvelope, { kind: "plan" }> {
  const folds = plan.actions.filter((action) => action.actionId === "solid.fold")
  if (folds.length === 0) return plan

  const apexNames = new Set(folds
    .map((entry) => (entry.inputs as { apexAs?: unknown }).apexAs)
    .filter((name): name is string => typeof name === "string"))
  const beforeFold: Extract<PlanEnvelope, { kind: "plan" }> = {
    ...plan,
    actions: plan.actions.filter((action) => {
      if (action.actionId === "solid.fold") return false
      /**
       * **引用折后点（P）的动作也要摘掉**：它们本来就会在“折之前”编不过，
       * 而这一遍只是拿来取 A/E/F 的坐标。留着它们会让文档变成 `null`，
       * 于是“全部点名可解析 ⇒ 去掉 vertices”这条最理想的路永远走不到。
       */
      const inputs = action.inputs as { vertexNames?: unknown } | null | undefined
      return !(Array.isArray(inputs?.vertexNames) && inputs.vertexNames.some((name) => apexNames.has(name)))
    }) as typeof plan.actions
  }
  const before = compileOnce(beforeFold, context).result.draftDocument
  const labelled = new Set(
    (before?.primitives ?? [])
      .filter((primitive) => primitive.type === "point3")
      .map((primitive) => (primitive as { label?: unknown }).label)
      .filter((label): label is string => typeof label === "string")
  )
  const positions = new Map(candidate.names.map((name, index) => [name, candidate.vertices[index]!]))

  return {
    ...plan,
    actions: plan.actions.map((action) => {
      if (action.actionId !== "solid.fold") return action
      const inputs = action.inputs as Record<string, unknown>
      const names = Array.isArray(inputs.vertexNames) ? inputs.vertexNames.filter((name): name is string => typeof name === "string") : []
      if (names.length === 0) return action
      // 全部点名都能从折前文档里取到 ⇒ 去掉过期的 vertices，按点名取最新坐标。
      if (names.every((name) => labelled.has(name))) {
        const { vertices: _stale, ...rest } = inputs
        return { ...action, inputs: rest } as typeof action
      }
      if (!Array.isArray(inputs.vertices)) return action
      // 取不全时，至少把四边形那几个同名顶点换成求解器给的坐标。
      const rewritten = inputs.vertices.map((vertex, index) => {
        const name = names[index]
        const found = name === undefined ? undefined : positions.get(name)
        return found === undefined ? vertex : { ...found }
      })
      return { ...action, inputs: { ...inputs, vertices: rewritten } } as typeof action
    }) as typeof plan.actions
  }
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
      /**
       * **必须说清"这组坐标是谁给的"**（设计 §6 的落点）：用户有权知道图上那组坐标
       * 是**系统按题面条件构造**出来的，不是模型手写的 —— 那正是这一案要换掉的东西。
       * 早先这句只写"搜出了这组坐标"，没说与模型的关系，"构造成功"与"模型给对了"就分不开。
       */
      text: `这份图上的坐标由**系统按题面条件构造**（不是模型给的；题面未给的量是系统自选的示例值，可在属性栏修改）：${found.assumptions.join("；")}`,
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
 * **补建题面点名、而图上没有的点**（2026-10-10 设计；用户现场：7 次逐字相同的失败）。
 *
 * ## 它挡的是什么
 *
 * 题设是**系统自己**从原话抽的（`O为 BD的中点`），而**没有任何一处**要求"题面点到的点必须真的
 * 建出来"——提示词只说"让坐标满足关系、用 `vertexNames` 说出顶点名"。于是模型交一笔四面体
 * 就能让计划合法地编译通过，那条题设却**永远无法核验**，门禁把整轮判 `failed`。
 *
 * ## 判据（缺一不补）
 *
 * 1. 第一遍编译**物化出了候选**、核验**不是 `passed`**、题面与题设都在手上；
 * 2. 确实存在"题设点到、图上没有"的名字（`missingNamedPoints`）；
 * 3. 那条题设的种类**唯一确定**该点的构造 —— 只做两种：
 *    `midpoint`（在两只端点之间取参数 `0.5`）与 `segmentRatio`（比值 `r` ⇒ 参数 `r/(1+r)`，
 *    方向由题设点序定）。**构造不唯一的一律不补**（交点、点到面的关系…那些要几何求解，不是补一笔动作）；
 * 4. 宿主是**那一只** `solid.create_polyhedron`（与核验器建点名表用的是同一只、同一份 `vertexNames`），
 *    且两只端点名都在它的 `vertexNames` 里；
 * 5. **要么全补、要么不补**：有一处算不出来就整批不补（宁可失败，不半补）。
 *
 * ## 两条纪律（与见证搜索那条救援同源）
 *
 * - **生成物不豁免核验**：补完**再跑同一个 `compileOnce`**，第二遍必须真的 `passed`，
 *   否则丢弃、把第一遍的结果原样交回；
 * - **系统替用户做的选择要显形**：一句人话进 `assumptions`，真实动作回写 `materialisedActions`
 *   （草稿层的再核验对着它，见 R37②）。
 */
interface MaterialisedPoint {
  name: string
  from: string
  to: string
  parameter: number
  kind: "midpoint" | "segmentRatio"
  sourceText: string
  /** 这笔动作在**补建后**的计划里的下标（假设文案要指出落在哪个字段）。 */
  index: number
}

/** 一条"题设点到、图上没有"的名字能不能补 —— 能就给出构造，不能就 `null`（整批因此不补）。 */
function constructiblePoint(entry: MissingNamedPoint, vertexNames: readonly string[], index: number): MaterialisedPoint | null {
  if (entry.missing.length !== 1) return null
  const name = entry.missing[0]
  if (entry.kind === "midpoint" && entry.targets.length === 3) {
    // `midpoint`：targets = [中点, 端点1, 端点2]。
    const [middle, first, second] = entry.targets
    if (middle !== name || !vertexNames.includes(first) || !vertexNames.includes(second) || first === second) return null
    return { name, from: first, to: second, parameter: 0.5, kind: "midpoint", sourceText: entry.sourceText, index }
  }
  if (entry.kind === "segmentRatio") {
    /**
     * **判据只有一处**（Task 10，2026-10-12）：四种锚法（`AE:AD` / `AE:ED` / `EA:DA` …）里
     * 哪一种、方向朝哪、分母是谁，全部由内核的 `ratioParameterFor` 说了算。
     *
     * 原先这里自己写了一遍、而且**只认未知点落在第 1、2 位那一种**（`[D,E,E,A]`），
     * 于是最常见的 `AE:AD=2:5`（解析成 `[A,E,A,D]`）根本补不出来 —— 偏偏那就是用户那句题面里的写法。
     * 收成一处之后，"两条路必然分叉"这件事在这一格上不可能再发生。
     */
    const resolved = ratioParameterFor(entry.targets, name, entry.value)
    if (!resolved.ok) return null
    if (!vertexNames.includes(resolved.from) || !vertexNames.includes(resolved.to)) return null
    return { name, from: resolved.from, to: resolved.to, parameter: resolved.parameter, kind: "segmentRatio", sourceText: entry.sourceText, index }
  }
  return null
}

/** 把补出来的点写成动作。宿主那只多面体的 `alias` / `vertexNames` / **棱的方向**都由这里判（**唯一一处**）。 */
function materialisedPointActions(
  entries: readonly MissingNamedPoint[],
  plan: Extract<PlanEnvelope, { kind: "plan" }>,
  document: GeometryDocument,
  aliases: Record<string, string>
): { actions: readonly Record<string, unknown>[]; points: MaterialisedPoint[] } | null {
  /**
   * **宿主可以是多面体，也可以是平面片**（Task 13，2026-10-12）。
   *
   * 原先这里只要 `solid.create_polyhedron` —— 而用户那道题的宿主是一只**平面四边形**
   *（`solid.create_face`），于是"点在边上且 `AE:AD=2:5`"这条**永远补不出来**
   *（实测：五条四边形条件 `passed`，两条定比分点停在 `unverified`）。
   *
   * 两种宿主本来就是**同一个形状**：都带 `vertexNames` + `vertices`，棱的 id 都是 `${宿主}:eN`
   *（`scene-graph` 的 `compileSolidFace` 与 `buildFromPoints` 用的是同一条命名约定），
   * 所以判据仍然是"**恰好一笔**能给出点名与棱的宿主"。
   */
  /**
   * **能补点的宿主：判据是"它有没有点名"，不是"它是哪一种形状"**（2026-10-14，用户现场）。
   *
   * 原先这里是 `actionId === "solid.create_polyhedron" || actionId === "solid.create_face"` ——
   * 于是**直三棱柱那道题补不了**（`E、F 分别为 AC 和 CC₁ 的中点`读出来也没用，宿主是
   * `solid.create_prism`），运行最后卡在"点名缺失：F"。用户当场把这件事说清了：
   * 按形状打补丁，下次是棱锥、再下次是圆锥 —— 永远在追现场。
   *
   * 这一层真正需要的只有两样：**顶点表**（用来验"两端都是点名"）与**按 `${宿主id}:eN`
   * 命名的棱**（下面按**候选文档**实测，找不到或不唯一就整批不补，见 `orientation`）。
   * 于是判据收成一句：**输入里带 ≥3 个点名的动作就是宿主** —— 棱柱、棱锥、棱台、多面体、
   * 平面片，以及以后新增的任何一种体，**自动都算**，不需要再改这一行。
   */
  const hosts = plan.actions.filter((action) => {
    const inputs = action.inputs as { vertexNames?: unknown } | null | undefined
    return typeof inputs === "object" && inputs !== null && Array.isArray(inputs.vertexNames)
      && inputs.vertexNames.length >= 3 && inputs.vertexNames.every((name) => typeof name === "string")
  })
  if (hosts.length !== 1) return null
  const inputs = hosts[0].inputs
  if (typeof inputs !== "object" || inputs === null) return null
  const alias = (inputs as { alias?: unknown }).alias
  const names = (inputs as { vertexNames?: unknown }).vertexNames
  if (typeof alias !== "string" || !Array.isArray(names) || !names.every((name) => typeof name === "string")) return null
  const vertexNames = names as string[]
  const hostId = aliases[alias]
  if (typeof hostId !== "string") return null

  /**
   * **棱的方向决定了参数往哪边量**（2026-10-10，实测踩到）。
   *
   * `hostEdge` 的解析是**顺序无关**的（`{from,to}` 与 `{to,from}` 是同一条棱），但 `parameter` 是
   * **沿那条棱自己的 `pointIds` 顺序**量的。于是 `DE=2EA` 若按 `D→A` 算参数 `2/3`，而内核那条棱
   * 的 `pointIds` 是 `A→D`，点就落到了 `1/3` 的位置 —— 第二遍核验于是 `failed`（不是 `passed`），
   * 救援如实放弃。中点（`0.5`）正好与方向无关，所以这个坑**只在比例分点上现形**。
   *
   * 判据写在**第一遍编译出来的候选文档**上（宿主是同一只、坐标没被改过），返回 `+1` 表示这条棱
   * 的方向就是 `from → to`，`-1` 表示反过来，`null` 表示**这条棱找不到或不唯一** ⇒ 不补。
   */
  /**
   * **找棱只看端点点名，不看 id 前缀**（2026-10-14 用户现场，与上面那条同一个教训）。
   *
   * 原先这里是 ``primitive.id.startsWith(`${hostId}:e`)`` —— 那是**某一种体自己的命名习惯**，
   * 棱柱就不是这么命名的，于是 `orientation` 一条棱都找不到 ⇒ 整批不补 ⇒ 又回到
   * "点名缺失：E / F"。而 `orientation` 下面真正需要的信息是**这条棱的两个端点是谁**，
   * 唯一性也由它自己强制（`matches.length !== 1` 就不补）。所以前缀这一问是多余且易错的。
   */
  const edges = document.primitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "edge3" }> => primitive.type === "edge3" && primitive.pointIds.length === 2)
  const labelOf = (id: string): string | undefined => {
    const primitive = document.primitives.find((candidate) => candidate.id === id)
    return primitive?.type === "point3" ? (primitive as { label?: string }).label : undefined
  }
  const orientation = (from: string, to: string): 1 | -1 | null => {
    const matches = edges.filter((edge) => {
      const labels = edge.pointIds.map(labelOf)
      return labels.every((label) => label === from || label === to) && new Set(labels).size === 2
    })
    if (matches.length !== 1) return null
    return labelOf(matches[0]!.pointIds[0]!) === from ? 1 : -1
  }

  /**
   * **"要么全补、要么不补"只对"能补的那几类"成立**（2026-10-15 用户现场，直三棱柱那道题）。
   *
   * 现场：题面同时有 `E、F 分别为 AC 和 CC₁ 的中点` 与 `BF ⊥ A₁B₁`。后者也点名了 F，
   * 于是 `missingNamedPoints` 给出**三条**条目：两条 `midpoint`（能补）+ 一条 `perpendicular`
   *（**不是**能用一笔动作定的构造）。原先的循环遍历**全部**条目，遇到 `perpendicular`
   * 那条 `constructiblePoint` 返回 `null` ⇒ **整批放弃** ⇒ E、F 一个都没建出来，
   * 运行最后卡在"点名缺失：F"。
   *
   * 判据说清楚：不可构造的那些条目**不是"算不出来的那一条"**，而是**期待** ——
   * "BF 垂直于 A₁B₁"正是要靠补出来的 F 去满足的（第二遍核验照样会判它，判不过就整批不补）。
   * 所以这里先收成"能补的那几类"，再在那几类之间执行全补或不补；
   * 而**没有被任何可补条目覆盖到的缺点名**仍然会让第二遍核验失败 ⇒ 救援如实放弃，
   * 不会出现"补了一半就交差"。
   */
  const constructible = entries.filter((entry) => entry.kind === "midpoint" || entry.kind === "segmentRatio")
  if (constructible.length === 0) return null

  const points: MaterialisedPoint[] = []
  for (const entry of constructible) {    const built = constructiblePoint(entry, vertexNames, plan.actions.length + points.length)
    /**
     * **要么全补、要么不补**（设计 §3.2）：有一条算不出来就整批不补。
     *
     * 说清这一支**真正挡住的是什么**（免得被读成第二道保险）：这些条目都来自"某条题设
     * 因为缺点名而未核验"，所以只要有一条补不了，**第二遍核验就不可能 `passed`**
     * ——下面那道 `second.result.diagramVerification?.status !== "passed"` 已经把结果拦住了。
     * 这里的提前返回**不改结论**，只是不去白跑那第二遍编译。**它没有独立的可观测判据**
     *（变异试过：改成 `continue` 全绿），这一点如实写在这里。
     */
    if (built === null) return null
    const direction = orientation(built.from, built.to)
    if (direction === null) return null
    /**
     * **这里不再自己翻参数**（Task 13，2026-10-12）。
     *
     * 朝向归一已经收在**写绑定的那一处**（`compileCreateBoundPoint` 按 `hostEdge` 的 `{from,to}` 判；
     * 实测过：面片的 `A—D` 棱存成 `D→A`，所以那里必须翻）。两边各翻一次会**翻回去** ——
     * 这正是"同一个判断写两遍必然分叉"：补建里翻一次、动作里再翻一次，`E` 就落到了 `3/5` 处，
     * 第二遍核验 `failed`、救援如实放弃，`AE:AD` 停在 `unverified`（本轮实测到的症状）。
     *
     * `orientation` 那一问**保留**：它问的是"这条棱找不找得到、唯不唯一"，
     * 找不到就**不该补**（动作那一步同样会拒）—— 与"从哪头量"是两件事。
     */
    const resolved = built
    /**
     * **同一个名字只补一次**（Task 10，2026-10-12）。
     *
     * 两条题设可能给出**同一个位置**（`AE:AD=2:5` 与 `AE:ED=2:3` 都指向 AD 的 2/5 处）——
     * 那是重复，不是冲突。原先这里会 push 两次，于是造出**两个都叫 `E` 的点**：
     * 点名表指到两个不同的位置，而这类重复在图上是看不出来的。
     * **真正的不相容由 `conflictingMaterialisedPoints` 在动手之前拒掉**（见那一处）。
     */
    if (points.some((point) => point.name === resolved.name)) continue
    points.push(resolved)
  }
  if (points.length === 0) return null
  return {
    points,
    actions: points.map((point) => ({
      actionId: "dynamic.create_bound_point",
      actionKey: point.name,
      factIds: [],
      inputs: {
        alias: point.name,
        host: { scope: "draft", alias },
        hostEdge: { from: point.from, to: point.to },
        parameter: point.parameter,
        label: point.name
      }
    }))
  }
}

/**
 * **同一个名字被两条以上题设算到不同的位置 ⇒ 不相容，拒绝**（Task 10，2026-10-12）。
 *
 * 计划 Task 10 的 RED 最后一条。今天的行为**不是拒绝**：`AE:AD=2:5`（E 在 AD 的 2/5 处）
 * 与 `AE:ED=3:1`（E 在 AD 的 3/4 处）同时出现时，整轮照旧 `ok`（实测读数 `expected true to be false`），
 * 而 `E` 一个都没落到图上 —— 用户看到的是一段"没有报错、但题设未核验"的运行。
 *
 * 两种错误的处置都要挡住：
 * - **静默挑一个**（后者覆盖前者）＝ 替用户改了题；
 * - **造两个都叫 `E` 的点** ＝ 点名表指到两个不同的位置，而图上看不出来。
 *
 * 比较用**规范形**（`from`/`to` 排序 + 参数折到同侧），所以同一条棱的两种写法
 *（`A→D` 的 0.4 与 `D→A` 的 0.6）不会被误判成冲突 —— 它们是**同一个点**。
 */
function conflictingMaterialisedPoints(
  entries: readonly MissingNamedPoint[],
  vertexNames: readonly string[],
  indexBase: number
): { name: string; detail: string } | null {
  const canonical = (point: MaterialisedPoint): string => {
    const swapped = point.from > point.to
    const from = swapped ? point.to : point.from
    const to = swapped ? point.from : point.to
    const parameter = swapped ? 1 - point.parameter : point.parameter
    return `${from}|${to}|${parameter.toFixed(12)}`
  }
  const seen = new Map<string, MaterialisedPoint>()
  for (const entry of entries) {
    if (entry.missing.length !== 1) continue
    const built = constructiblePoint(entry, vertexNames, indexBase)
    if (built === null) continue
    const previous = seen.get(built.name)
    if (previous === undefined) {
      seen.set(built.name, built)
      continue
    }
    if (canonical(previous) !== canonical(built)) {
      return {
        name: built.name,
        detail: `${previous.sourceText} 把它定在 ${previous.from}→${previous.to} 的 ${previous.parameter}，而 ${built.sourceText} 把它定在 ${built.from}→${built.to} 的 ${built.parameter}`
      }
    }
  }
  return null
}

/** 补建这件事**必须看得见**：一句人话 + 被定下来的值 + 落在哪个字段。 */function materialisedAssumptions(points: readonly MaterialisedPoint[]): StructuredAssumption[] {
  return points.map((point) => ({
    id: `materialised.${point.name}`,
    text: point.kind === "midpoint"
      ? `题面点到了 ${point.name}，图上原本没有这个点：系统按题设把它建在棱 ${point.from}${point.to} 的中点上。`
      : `题面点到了 ${point.name}（${point.sourceText}），图上原本没有这个点：系统按题设把它建在棱 ${point.from}${point.to} 上。`,
    kind: "witness",
    value: { name: point.name, from: point.from, to: point.to, parameter: point.parameter },
    overridable: true,
    path: `envelope.actions[${point.index}].inputs.parameter`
  }))
}

/**
 * **"翻折"必须是刚体运动**（Task 13，2026-10-12）—— 从**最终坐标**量的那一条判据。
 *
 * 题面里"将三角形AEF沿EF翻折至三角形PEF"这句话的唯一机器可读形状是
 * `figureIntent` 的 `fold` 变换（`{ face, hinge, apex, apexAs }`）。折是刚体运动，所以
 * `apexAs` 到折痕两端的距离必须与 `apex` 的一样 —— 这条判据**不管 `P` 是怎么来的**：
 * 走 `solid.fold` 的必然满足，手写坐标的就不一定。
 *
 * **为什么需要它**：没有这一条时，模型绕开 `solid.fold`、把 `P` 直接写在某个满足
 * `PC = 4√3` 的地方，**八条题设会条条通过**（实测：`|PE| = 12.93` 对 `|AE| = 3.46`），
 * 而图根本不是折出来的 —— 正是计划 RED 点名的"图形很像但**折后 `P` 错**"。
 *
 * 点名不全时不在这里判（那属于"未核验"那一套：缺谁、为什么缺，已有各自的文案）。
 */
function foldRigidityDiagnostics(
  prompt: string,
  ir: Parameters<typeof buildFigureIntent>[0]["ir"],
  document: GeometryDocument
): PlanDiagnostic[] {
  const at = (label: string): { x: number; y: number; z: number } | null => {
    const found = document.primitives.find((primitive) => primitive.type === "point3" && (primitive as { label?: unknown }).label === label)
    return found?.type === "point3" ? found.position : null
  }
  const distance = (left: { x: number; y: number; z: number }, right: { x: number; y: number; z: number }): number =>
    Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z)

  const out: PlanDiagnostic[] = []
  for (const transformation of buildFigureIntent({ prompt, ir, family: "solid" }).transformations) {
    if (transformation.kind !== "fold") continue
    const apex = at(transformation.apex)
    const apexAs = at(transformation.apexAs)
    const from = at(transformation.hinge.from)
    const to = at(transformation.hinge.to)
    if (apex === null || apexAs === null || from === null || to === null) continue

    const before = [distance(apex, from), distance(apex, to)]
    const after = [distance(apexAs, from), distance(apexAs, to)]
    if (!after.every(Number.isFinite) || !before.every(Number.isFinite)) continue
    const tolerance = Math.max(1e-6, 1e-6 * Math.max(...before, ...after))
    if (Math.abs(after[0]! - before[0]!) <= tolerance && Math.abs(after[1]! - before[1]!) <= tolerance) continue

    out.push(planDiagnostic(
      "geometry_validation",
      "fold_not_rigid",
      "envelope.actions",
      `题面说的是沿 ${transformation.hinge.from}${transformation.hinge.to} 把 ${transformation.apex} 翻折到 ${transformation.apexAs}，而折是**刚体运动**：到折痕两端的距离必须一样。实测 ${transformation.apexAs}${transformation.hinge.from}=${after[0]!.toFixed(6)} 而 ${transformation.apex}${transformation.hinge.from}=${before[0]!.toFixed(6)}，${transformation.apexAs}${transformation.hinge.to}=${after[1]!.toFixed(6)} 而 ${transformation.apex}${transformation.hinge.to}=${before[1]!.toFixed(6)} —— 这一只 ${transformation.apexAs} 不是折出来的，请用 solid.fold 让内核按折痕与折角算。`
    ))
  }
  return out
}

/**
 * **折角反求**（Task 12，2026-10-12）：题面给了"折完以后 `PC = 4√3`"，却**没给折角** ——
 * 那就把它**求**出来，而不是让模型自己手算（现场"连发 7 次、7 次死因各不相同"，
 * 查实的一条正是模型在自己手算折后坐标）。
 *
 * 判据顺序即护栏，每一步都在挡一种具体的坏结果：
 * 1. 第一遍没核验报告、或**已经通过** ⇒ 不管（"只救不抢"）；
 * 2. 计划里没有 `solid.fold` ⇒ 不是这一支的事；
 * 3. 折痕两端、待折点、目标点**都得在编译出来的文档里有点名坐标** —— 缺一个就不猜；
 * 4. 目标距离那条题设必须**逐字来自原话**（`fixedLength` 且两个点名、其中一个就是折后的名字）——
 *    绝不从"哪个数看起来像"去凑；
 * 5. 求解器说 `unreachable` / `degenerate` ⇒ **不救**（那是**证明无解**，与"没找到"分开）；
 * 6. 第二遍**必须** `ok` + 有草稿 + 核验 `passed`，三者缺一都不算救回 ——
 *    换句话说：**折角是求出来的，但"对不对"仍由既有核验器按最终坐标说了算**，
 *    没有任何"系统算的所以跳过核验"的豁免。
 *
 * 求出来的角**写进 `assumptions`**（一句人话 + 被定下来的值），因为题面没给过它。
 */
/**
 * **题面说要折，而计划里没有折那一笔 ⇒ 按题面把 `solid.fold` 补上**（选项②，2026-10-15）。
 *
 * ## 为什么需要它
 *
 * 现场那道题（`平面四边形 + 定比分点 + 沿 EF 翻折至 PEF，使 PC=4√3`）卡在**模型写不对计划**上：
 * 它两轮都在拼一只"折后的闭合体"（面塌了、折的引用又不在片上）。而**题面那句翻折一直是可读的** ——
 * `readFoldTransformations` 早就把它解析成 `{ face, hinge, apex, apexAs }`（Task 13 起），
 * 只是那份解析**此前只被用来判"折是不是刚体运动"**，从来没有人拿它去**补那一笔动作**。
 * 于是"题面说折、图上没有折"这件事，系统看得见，却不动手。
 *
 * ## 纪律（与另外三条救援逐条相同）
 *
 * 1. **只救不抢**：第一遍核验通过了就一步都不动（`status === "passed"` 直接返回 `null`）。
 * 2. **计划里已经有折就不碰**：那是折角反求的活，不是这一支的（否则会给同一只片补出第二笔折）。
 * 3. **点名必须真的在图上**：折片那三个名字（折痕两端 + 被带走的点）都要能在"折之前"的文档里
 *    找到，缺一个就**不补** —— 补一笔引用不到点的动作只会换来一句"引用缺失"，那不是救援。
 * 4. **折角这一半交给同一条救援**（"同一个判断不写两遍"）：题面给的是**折完之后的**距离/位置，
 *    所以补上来的那一笔先取 90°，再由 `rescueWithSolvedFoldAngle` 按题面条件**反求**折角；
 *    它自己也要过"第二遍必须真的通过"那一关。
 * 5. **补了什么要说出来**：写进 `assumptions`（人话 + 定下来的东西），因为计划里本来没有这一笔。
 */
function rescueWithSynthesisedFold(context: PlanCompileContext, first: CompileOnceOutcome): PlanCompileResult | null {
  const report = first.result.diagramVerification
  if (report === undefined || report.status === "passed") return null
  const plan = first.plan
  if (plan === null || context.prompt === undefined) return null
  if (plan.actions.some((action) => action.actionId === "solid.fold")) return null

  const fold = readFoldTransformations(context.prompt)[0]
  if (fold === undefined) return null

  /**
   * 折片上的三个点名 = 折痕两端 + 被带走的那个点；顺序按题面里那个三角形（`face`），**确定性**。
   * 取点走**文档的点名**（`label`），与折角反求"摘掉折叠再编译一次"是同一条口径：
   * `dynamic.create_bound_point` 建出来的 `E`、`F` 没有 `vertices` 数组，只能从文档取。
   */
  const flap = [...fold.face]
  if (flap.length !== 3 || !flap.includes(fold.apex) || !flap.includes(fold.hinge.from) || !flap.includes(fold.hinge.to)) return null
  /**
   * **折片只能建出 `P`，所以它必须排在任何引用 `P` 的动作之前**（2026-10-17 用户现场）。
   *
   * 现场最后那版计划是「四边形 → `PC` 线段 → …」：线段先引用 `P`、折却排在后面（或根本没有），
   * 于是整份计划在 `segment_reference_missing: P` 上编不过 —— 而这一遍也正是**取 A/E/F 坐标**要用
   * 的那一遍。原先它直接读 `first.result.draftDocument`，那份是 `null`，补折救援连门都进不去。
   * 现在先摘掉“引用 P 的动作”编一次（四边形 + E/F 都在），拿到点名；插好折之后再整体编。
   */
  const referencesFoldedPoint = (action: (typeof plan.actions)[number]): boolean => {
    const inputs = action.inputs as { vertexNames?: unknown } | null | undefined
    return Array.isArray(inputs?.vertexNames) && inputs.vertexNames.includes(fold.apexAs)
  }
  const preFold = compileOnce({ ...plan, actions: plan.actions.filter((action) => !referencesFoldedPoint(action)) }, context).result.draftDocument
  const document = preFold ?? first.result.draftDocument
  if (document === null) return null
  const labelled = new Set(
    document.primitives
      .filter((primitive) => primitive.type === "point3")
      .map((primitive) => (primitive as { label?: unknown }).label)
      .filter((label): label is string => typeof label === "string")
  )
  if (!flap.every((name) => labelled.has(name))) return null

  /**
   * **插在“第一个引用折后点（P）的动作”之前**：N 个引用点取最靠前的那个。
   */
  const firstReference = plan.actions.findIndex(referencesFoldedPoint)
  const insertAt = firstReference >= 0 ? firstReference : plan.actions.length
  const foldAction = {
    actionId: "solid.fold",
    actionKey: "synthesised-fold",
    factIds: [],
    inputs: {
      alias: "synthesised-fold",
      vertexNames: flap,
      hinge: { from: fold.hinge.from, to: fold.hinge.to },
      apex: fold.apex,
      apexAs: fold.apexAs,
      /** 先取 90°：题面没直接给折角时，由下面那条反求（或核验）说了算。 */
      angle: 90,
      label: `${fold.apex} 沿 ${fold.hinge.from}${fold.hinge.to} 折到 ${fold.apexAs}`
    }
  } as (typeof plan.actions)[number]

  const patched: Extract<PlanEnvelope, { kind: "plan" }> = {
    ...plan,
    actions: [
      ...plan.actions.slice(0, insertAt),
      foldAction,
      ...plan.actions.slice(insertAt)
    ] as typeof plan.actions
  }
  const disclosure = {
    id: `synthesised-fold.${fold.apexAs}`,
    text: `题面说的是把 ${fold.apex} 沿 ${fold.hinge.from}${fold.hinge.to} 翻折到 ${fold.apexAs}，而**计划里没有折这一笔**：系统按题面把这一笔补上（折角先取 90°，再按题面条件反求或核验）。`,
    kind: "witness" as const,
    value: { apex: fold.apex, apexAs: fold.apexAs, hingeFrom: fold.hinge.from, hingeTo: fold.hinge.to },
    overridable: true,
    path: `envelope.actions[${insertAt}].inputs`
  }

  const withFold = compileOnce(cutFoldedCorner(patched), context)
  const solved = rescueWithSolvedFoldAngle(context, withFold)
  if (solved !== null) return { ...solved, assumptions: [disclosure, ...solved.assumptions], materialisedActions: solved.actions }
  /** 题面若直接给了折角（不需要反求），就走普通那一关：第二遍必须 `ok` + 有草稿 + 核验通过。 */
  if (!withFold.result.ok || withFold.result.draftDocument === null || withFold.result.diagramVerification?.status !== "passed") return null
  return { ...withFold.result, assumptions: [disclosure, ...withFold.result.assumptions], materialisedActions: withFold.result.actions }
}

function rescueWithSolvedFoldAngle(context: PlanCompileContext, first: CompileOnceOutcome): PlanCompileResult | null {
  return rescueWithAnalyticFoldAngle(context, first) ?? rescueWithSearchedFoldAngle(context, first)
}

/** Numeric fallback for supported angle relations; the final whole-diagram check remains authoritative. */
function rescueWithSearchedFoldAngle(context: PlanCompileContext, first: CompileOnceOutcome): PlanCompileResult | null {
  if (first.result.diagramVerification === undefined || first.result.diagramVerification.status === "passed"
    || first.plan === null || first.obligations === null || context.prompt === undefined) return null
  const plan = first.plan
  const folds = plan.actions.filter(action => action.actionId === "solid.fold")
  // Coupled multi-fold systems need a separate solver, not sequential one-angle guesses.
  if (folds.length !== 1) return null
  const fold = folds[0]!
  const apexAs = (fold.inputs as { apexAs?: unknown }).apexAs
  if (typeof apexAs !== "string") return null
  const actionIndex = plan.actions.indexOf(fold)
  const patchedAt = (angle: number): Extract<PlanEnvelope, { kind: "plan" }> => ({
    ...plan,
    actions: plan.actions.map(action => action === fold
      ? { ...action, inputs: { ...(action.inputs as Record<string, unknown>), angle } }
      : action) as typeof plan.actions
  })
  // Shared across all relations, so a long prompt cannot multiply the compile budget.
  let remaining = 192
  for (const obligation of first.obligations.ir.obligations) {
    if (remaining <= 1) break
    if (!["planarAngle", "dihedral", "linePlaneAngle"].includes(obligation.kind)
      || obligation.judgeability !== "supported" || !obligation.targets.includes(apexAs)
      || typeof obligation.expected !== "number" || !Number.isFinite(obligation.expected)) continue
    const outcome = searchFoldAngles(angle => {
      const trial = compileOnce(patchedAt(angle), context).result
      const check = trial.diagramVerification?.checks.find(check => check.kind === obligation.kind && check.sourceText === obligation.sourceText)
      return check?.actual !== undefined && check.expected !== undefined ? check.actual - check.expected : NaN
    }, { maxEvaluations: Math.min(160, remaining - 1) })
    remaining -= outcome.evaluations
    for (const degrees of outcome.degrees) {
      if (remaining <= 0) break
      remaining -= 1
      const second = compileOnce(patchedAt(degrees), context)
      if (!second.result.ok || second.result.draftDocument === null || second.result.diagramVerification?.status !== "passed") continue
      return {
        ...second.result,
        assumptions: [...second.result.assumptions, {
          id: `searched-fold-angle.${apexAs}`,
          text: `题面关系（${obligation.sourceText}）未直接给折角：在 (0°,180°] 内有界数值搜索得到 ${degrees}°，并已回代核验全部题设。这只是数值见证，不保证枚举全部分支；未搜到不等于证明无解。候选角：${outcome.degrees.join("°、")}°。`,
          kind: "witness", value: { apexAs, angleDegrees: degrees, method: "bounded-numerical", complete: false,
            evaluations: outcome.evaluations, termination: outcome.termination, candidates: outcome.degrees },
          overridable: true, path: `envelope.actions[${actionIndex}].inputs.angle`
        }]
      }
    }
  }
  return null
}

function rescueWithAnalyticFoldAngle(context: PlanCompileContext, first: CompileOnceOutcome): PlanCompileResult | null {
  const report = first.result.diagramVerification
  if (report === undefined || report.status === "passed") return null
  if (first.plan === null || first.obligations === null || context.prompt === undefined) return null
  /**
   * **不要求 `draftDocument` 非空**（本轮实测踩到）：核验**没通过**时草稿往往是 `null`，
   * 而"没通过"恰恰是这一支**唯一**该管的场景 —— 早先那一句 `if (document === null) return null`
   * 把整条救援挡在门外（症状：`assumptions` 是空的，看着像"没救"，其实是**门都没进**）。
   * 坐标本来就从**计划的动作**上取（`planPoint`），不需要文档。
   */

  /**
   * **点名 → 坐标**从**计划自己的 `vertices` / `vertexNames`** 上取，不从文档的 `label` 上取。
   *
   * 理由（本轮实测踩到）：文档里的点**不一定带 `label`** —— 折那一笔的点名是靠
   * `diagramVerification` 的**点名表**（由动作推出来的）认出来的，而那张表在核验器里。
   * 计划里的 `vertices[index]` 与 `vertexNames[index]` 是**同一份输入的两个平行数组**，
   * 本来就是"这个点叫什么、在哪"的唯一来源，读它既准确又不必猜标签。
   */
  const plan = first.plan
  /**
   * **还有一条更全的取点路子：把折叠那几笔摘掉、编译一次，从那份"折之前"的文档里按点名取。**
   *
   * 为什么需要它（Task 13，2026-10-12）：`E`/`F` 现在可以由**前面几笔**
   * `dynamic.create_bound_point` 按定比分点建出来 —— 那种动作**没有 `vertices` 数组**，
   * 所以 `planPoint` 在他们身上取不到坐标。而它们的坐标本来就被算出来了：
   * `compileOnce` 的成功路径一定会给出 `working` 文档（`draftDocument: null` 只属于**动作报错**那条路），
   * 摘掉折叠之后那些条件本来就还不成立，所以这里**只看文档、不看结论**。
   *
   * 复用 `compileOnce` 而不是自己再写一遍"点在棱上的位置怎么算"：那套判据只有一份
   *（宿主棱的朝向、平面路径的弧长），抄第二份必然分叉 —— 本轮刚因为"两边各翻一次"栽过。
   */
  const apexNames = new Set(plan.actions
    .filter((action) => action.actionId === "solid.fold")
    .map((action) => (action.inputs as { apexAs?: unknown }).apexAs)
    .filter((name): name is string => typeof name === "string"))
  const withoutFold: Extract<PlanEnvelope, { kind: "plan" }> = {
    ...plan,
    actions: plan.actions.filter((action) => {
      if (action.actionId === "solid.fold") return false
      /**
       * **引用 P 的动作也摘掉**（2026-10-17）：线段 `PC` 排在折之前时，
       * 这一遍“折之前”的编译会因 `segment_reference_missing: P` 变成 `null`，
       * 而 `at()` 随后只能退回到计划里的 `vertices`（见证替换后已经删掉了）——
       * 于是折角反求连 A/E/F 都拿不到。摘掉引用方，拿 A/E/F 的那一遍才是干净的。
       */
      const inputs = action.inputs as { vertexNames?: unknown } | null | undefined
      return !(Array.isArray(inputs?.vertexNames) && inputs.vertexNames.some((name) => apexNames.has(name)))
    }) as typeof plan.actions
  }
  const beforeFold = compileOnce(withoutFold, context).result.draftDocument
  const fromDocument = (label: string): { x: number; y: number; z: number } | null => {
    if (beforeFold === null) return null
    const found = beforeFold.primitives.find((primitive) => primitive.type === "point3" && (primitive as { label?: unknown }).label === label)
    return found?.type === "point3" ? found.position : null
  }
  /** 先问"折之前"的文档（能覆盖点名建点），问不到再退回计划里那两个平行数组。 */
  const at = (label: string): { x: number; y: number; z: number } | null => fromDocument(label) ?? planPoint(label)
  const planPoint = (label: string): { x: number; y: number; z: number } | null => {
    for (const action of plan.actions) {
      const inputs = action.inputs as { vertices?: unknown; vertexNames?: unknown }
      if (!Array.isArray(inputs.vertices) || !Array.isArray(inputs.vertexNames)) continue
      const index = inputs.vertexNames.indexOf(label)
      if (index < 0) continue
      const point = inputs.vertices[index] as { x?: unknown; y?: unknown; z?: unknown } | undefined
      if (point === undefined) continue
      if (typeof point.x !== "number" || typeof point.y !== "number" || typeof point.z !== "number") continue
      return { x: point.x, y: point.y, z: point.z }
    }
    return null
  }

  for (const fold of first.plan.actions) {
    if (fold.actionId !== "solid.fold") continue
    const inputs = fold.inputs as { hinge?: { from?: unknown; to?: unknown }; apex?: unknown; apexAs?: unknown }
    const hinge = inputs.hinge
    const apex = inputs.apex
    const apexAs = inputs.apexAs
    if (typeof apex !== "string" || typeof apexAs !== "string") continue
    if (typeof hinge?.from !== "string" || typeof hinge.to !== "string") continue

    const moving = at(apex)
    const pivot = at(hinge.from)
    const alongTo = at(hinge.to)
    if (moving === null || pivot === null || alongTo === null) continue

    for (const obligation of first.obligations.ir.obligations) {
      /**
       * **`role` 不能限定成 `given`**：用户那句是"**使得** PC=4√3" —— 它是**要达成的目标**，
       * 解析器完全可能把它归成 target 而不是 given（这也正是它该有的语义）。
       * 两种角色都同样**逐字来自原话**，所以这里只要求"是原话里的定长条件 + 含折后点名"。
       */
      if (obligation.kind !== "fixedLength") continue
      if (obligation.judgeability !== "supported") continue
      if (typeof obligation.expected !== "number" || !(obligation.expected > 0)) continue
      const targets: readonly string[] = obligation.targets
      if (targets.length !== 2 || !targets.includes(apexAs)) continue
      const otherLabel: string = targets[0] === apexAs ? targets[1]! : targets[0]!
      if (otherLabel === apexAs) continue
      const target = at(otherLabel)
      if (target === null) continue

      const axisVector = { x: alongTo.x - pivot.x, y: alongTo.y - pivot.y, z: alongTo.z - pivot.z }
      const outcome = foldAnglesForTargetDistance(moving, pivot, axisVector, target, obligation.expected)
      if (outcome.status !== "solved") continue
      /**
       * **允许区间之外的那一支要说出来**（Task 12 的边界「两支角合法时另一支未披露」，2026-10-14）。
       *
       * `A·cosθ + B·sinθ = d² − K` 闭式**至多两支**角：`solved` 那一档只返回**允许区间内**的候选，
       * 另一支（`360° − θ`，也就是"朝折痕另一侧折"）被区间过滤掉了 —— 而**它同样满足题面那个距离**
       *（用户那道题：`C` 在底面内，`P(−θ)` 与 `P(θ)` 关于底面镜像，到 `C` 的距离一样）。
       * 只披露一支，用户会以为"折角只有这一个解"。
       *
       * 判据不新写：**拿同一个求解器、把区间放开**再问一次，差集就是那些"合法但没取"的支
       *（`a` 取反是同一个图形，所以放开区间不会造出假的支）。
       */
      const widened = foldAnglesForTargetDistance(moving, pivot, axisVector, target, obligation.expected, { minimumDegrees: -360, maximumDegrees: 360 })
      const extras = widened.status === "solved"
        ? widened.degrees.filter((degrees) => !outcome.degrees.some((kept) => Math.abs(kept - degrees) <= 1e-6))
        : []

      const actionIndex = first.plan.actions.indexOf(fold)
      /**
       * **没取的那一支也要说出来**（Task 12 的边界「两支角合法时另一支未披露」，2026-10-14）：
       * `A·cosθ + B·sinθ = d² − K` 闭式**至多两支**角，而 `solved` 那一档只返回**允许区间内**的候选 ——
       * 另一支（"朝折痕另一侧折"）被区间过滤掉了。它**同样满足**题面那个距离，所以必须披露，
       * 否则用户会以为"折角只有这一个解"。
       */
      for (const degrees of outcome.degrees) {

        const patched: Extract<PlanEnvelope, { kind: "plan" }> = {
          ...first.plan,
          actions: first.plan.actions.map((action) => action === fold
            ? { ...action, inputs: { ...(action.inputs as Record<string, unknown>), angle: degrees } }
            : action) as typeof first.plan.actions
        }
        const second = compileOnce(patched, context)
        if (!second.result.ok || second.result.draftDocument === null || second.result.diagramVerification?.status !== "passed") continue
        /**
         * **没取的那些支也要说出来**（Task 12 的边界「两支角合法时另一支未披露」，2026-10-14）：
         * 写上"另外还有 N 支（…）同样满足题面那个距离（差别只在朝折痕另一侧折），系统没有取它们"。
         * 不说出来，用户会以为"折角只有这一个解"。
         */
        const undisclosed = [...outcome.degrees.filter(other => Math.abs(other - degrees) > 1e-6), ...extras]
        const note = undisclosed.length === 0
          ? ""
          : `另外还有 ${undisclosed.length} 支折角（${undisclosed.join("°、")}°）同样满足题面那个距离（差别只在朝折痕另一侧折），系统没有取它们。`
        return {
          ...second.result,
          assumptions: [
            ...second.result.assumptions,
            {
              id: `solved-fold-angle.${apexAs}`,
              text: `题面给的是折完之后的距离（${obligation.sourceText}），没有直接给折角：系统按「绕 ${hinge.from}${hinge.to} 旋转、${apex} 折到 ${apexAs}」把它**反求**出来，得到折角 ${degrees}°。${note}`,
              kind: "witness",
              value: { apexAs, hingeFrom: hinge.from, hingeTo: hinge.to, angleDegrees: degrees },
              overridable: true,
              path: `envelope.actions[${actionIndex}].inputs.angle`
            }
          ]
        }
      }
    }
  }
  return null
}

/**
 * **线段排在建点之前 ⇒ 自动后移**（2026-10-17 评测现场）。
 *
 * 模型经常把 `solid.create_segment`（如 `EF`、`PC`）写在建 E/F/P 的那几笔之前。
 * 同一份计划按顺序执行，于是 `segment_reference_missing`。这只动**顺序**：
 * 把出错的那一笔移到末尾再编一次；仍然要求第二遍核验真的 `passed`。
 */
/**
 * **六条棱长 → 四面体坐标**（2026-10-19，P1-1）。
 *
 * 现场：三棱锥 P-ABC，底面等边 2，PA=PB=2，PC=√6；模型坐标算错，核验失败。
 * 六条棱都给了，坐标应由解析构造给出。这里是救援：只在模型计划失败时用题面重新构造，
 * 最终仍由同一个核验器按八条/六条题设判定。
 */
function pairKey(first: string, second: string): string {
  return [first, second].sort().join("-")
}

function parseLengthLiteral(literal: string): number | null {
  if (literal.startsWith("√")) {
    const value = Number(literal.slice(1))
    return Number.isFinite(value) && value > 0 ? Math.sqrt(value) : null
  }
  const value = Number(literal)
  return Number.isFinite(value) && value > 0 ? value : null
}

function readTetrahedronShape(prompt: string): { apex: string; base: [string, string, string] } | null {
  const pyramid = /三棱锥\s*([A-Z])\s*-\s*([A-Z])([A-Z])([A-Z])/.exec(prompt)
  if (pyramid !== null) return { apex: pyramid[1]!, base: [pyramid[2]!, pyramid[3]!, pyramid[4]!] }
  const tetrahedron = /四面体\s*([A-Z])([A-Z])([A-Z])([A-Z])/.exec(prompt)
  if (tetrahedron !== null) return { apex: tetrahedron[1]!, base: [tetrahedron[2]!, tetrahedron[3]!, tetrahedron[4]!] }
  return null
}

function rescueWithTetrahedronEdges(context: PlanCompileContext, first: CompileOnceOutcome): PlanCompileResult | null {
  if (first.result.diagramVerification?.status === "passed" || first.plan === null || first.obligations === null || context.prompt === undefined) return null
  const prompt = normalizeGeometryPrompt(context.prompt)
  const shape = readTetrahedronShape(prompt)
  if (shape === null) return null

  const lengths = new Map<string, number>()
  for (const obligation of first.obligations.ir.obligations) {
    if (obligation.kind !== "fixedLength" || obligation.targets.length !== 2 || typeof obligation.expected !== "number") continue
    lengths.set(pairKey(obligation.targets[0]!, obligation.targets[1]!), obligation.expected)
  }
  // `PA=PB=2` 这类链式写法解析器只读到后一段，这里补前一段。
  for (const match of prompt.matchAll(/([A-Z])([A-Z])=([A-Z])([A-Z])=([0-9.]+|√[0-9.]+)/g)) {
    const value = parseLengthLiteral(match[5]!)
    if (value === null) continue
    lengths.set(pairKey(match[1]!, match[2]!), value)
    lengths.set(pairKey(match[3]!, match[4]!), value)
  }
  for (const match of prompt.matchAll(/([A-Z])([A-Z])=([0-9.]+|√[0-9.]+)/g)) {
    const value = parseLengthLiteral(match[3]!)
    if (value !== null) lengths.set(pairKey(match[1]!, match[2]!), value)
  }

  const equilateral = /△?([A-Z])([A-Z])([A-Z])是边长为([0-9.]+)的等边三角形/.exec(prompt)
  if (equilateral !== null) {
    const names = [equilateral[1]!, equilateral[2]!, equilateral[3]!]
    const value = Number(equilateral[4])
    if (Number.isFinite(value) && value > 0 && names.every((name) => shape.base.includes(name))) {
      for (const [left, right] of [[names[0], names[1]], [names[1], names[2]], [names[0], names[2]]] as const) {
        lengths.set(pairKey(left!, right!), value)
      }
    }
  }

  const get = (left: string, right: string): number | undefined => lengths.get(pairKey(left, right))
  const [baseA, baseB, baseC] = shape.base
  const measures = {
    ab: get(baseA, baseB),
    ac: get(baseA, baseC),
    bc: get(baseB, baseC),
    pa: get(shape.apex, baseA),
    pb: get(shape.apex, baseB),
    pc: get(shape.apex, baseC)
  }
  if (Object.values(measures).some((value) => value === undefined)) return null
  const points = constructTetrahedron(measures as { ab: number; ac: number; bc: number; pa: number; pb: number; pc: number })
  if (points === null) return null

  const plan: Extract<PlanEnvelope, { kind: "plan" }> = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "由六条棱长构造的四面体",
    factIds: [],
    actions: [{
      actionId: "solid.create_polyhedron",
      actionKey: "tetrahedron",
      factIds: [],
      inputs: {
        alias: "tetrahedron",
        vertexNames: [baseA, baseB, baseC, shape.apex],
        vertices: [points.a, points.b, points.c, points.p],
        faces: [[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]]
      }
    }]
  }

  const compiled = compileOnce(plan, { ...context, prompt: expandExamShorthand(prompt) })
  if (!compiled.result.ok || compiled.result.draftDocument === null || compiled.result.diagramVerification?.status !== "passed") return null
  return {
    ...compiled.result,
    assumptions: [...compiled.result.assumptions, {
      id: "witness.tetrahedron",
      text: "六条棱长由解析构造给出坐标（不是模型心算）；最终仍按题设核验。",
      kind: "witness",
      value: { apex: shape.apex, base: shape.base, measures },
      overridable: true,
      path: "envelope.actions[0].inputs.vertices"
    }],
    materialisedActions: compiled.result.actions
  }
}

/**
 * **正方形底四棱锥的解析构造**（2026-10-19，P1-1，solid-10）。
 *
 * 题面：四棱锥 P-ABCD，底面正方形，AB=a，PC=PD=r，∠PCA=θ。坐标由
 * `constructSquarePyramid` 解出；这里只负责识别构型、取参数、重编核验。
 */
/**
 * **正四棱锥（只给底边与侧棱）**（2026-10-19，P1-1，solid-24）：
 * 顶点在底面中心正上方，h²=l²−a²/2；不依赖点名，图上的默认名是 A–D、P。
 */
/**
 * **正三棱锥（只给底边与侧棱）**（2026-10-19，P1-1）：
 * 顶点在底面正三角形中心正上方，h²=l²−a²/3；默认名 A、B、C、P。
 */
function rescueWithRegularTriangularPyramid(context: PlanCompileContext, first: CompileOnceOutcome): PlanCompileResult | null {
  if (first.result.diagramVerification?.status === "passed" || first.plan === null || context.prompt === undefined) return null
  const prompt = normalizeGeometryPrompt(context.prompt)
  if (!prompt.includes("正三棱锥")) return null
  const sideMatch = /底面边长(?:为)?\s*([0-9.]+|√[0-9.]+)/.exec(prompt)
  const lateralMatch = /侧棱长(?:为)?\s*([0-9.]+|√[0-9.]+)/.exec(prompt)
  if (sideMatch === null || lateralMatch === null) return null
  const side = parseLengthLiteral(sideMatch[1]!)
  const lateral = parseLengthLiteral(lateralMatch[1]!)
  if (side === null || lateral === null) return null
  const points = constructRegularTriangularPyramid(side, lateral)
  if (points === null) return null
  const plan: Extract<PlanEnvelope, { kind: "plan" }> = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "由底面边长与侧棱长解析构造的正三棱锥",
    factIds: [],
    actions: [{
      actionId: "solid.create_polyhedron",
      actionKey: "regular-triangular-pyramid",
      factIds: [],
      inputs: {
        alias: "regular-triangular-pyramid",
        vertexNames: ["A", "B", "C", "P"],
        vertices: [points.a, points.b, points.c, points.p],
        faces: [[0, 1, 2], [0, 1, 3], [1, 2, 3], [2, 0, 3]]
      }
    }]
  }
  const compiled = compileOnce(plan, { ...context, prompt: expandExamShorthand(prompt) })
  if (!compiled.result.ok || compiled.result.draftDocument === null) return null
  if (compiled.result.diagramVerification !== undefined && compiled.result.diagramVerification.status !== "passed") return null
  return {
    ...compiled.result,
    assumptions: [...compiled.result.assumptions, {
      id: "witness.regularTriangularPyramid",
      text: "正三棱锥按底边 a 与侧棱 l 解析构造：顶点在底面中心正上方，h²=l²−a²/3。",
      kind: "witness",
      value: { side, lateral },
      overridable: true,
      path: "envelope.actions[0].inputs.vertices"
    }],
    materialisedActions: compiled.result.actions
  }
}

function rescueWithRegularSquarePyramid(context: PlanCompileContext, first: CompileOnceOutcome): PlanCompileResult | null {
  if (first.result.diagramVerification?.status === "passed" || first.plan === null || context.prompt === undefined) return null
  const prompt = normalizeGeometryPrompt(context.prompt)
  if (!prompt.includes("正四棱锥")) return null
  const sideMatch = /底面边长(?:为)?\s*([0-9.]+|√[0-9.]+)/.exec(prompt)
  const lateralMatch = /侧棱长(?:为)?\s*([0-9.]+|√[0-9.]+)/.exec(prompt)
  if (sideMatch === null || lateralMatch === null) return null
  const side = parseLengthLiteral(sideMatch[1]!)
  const lateral = parseLengthLiteral(lateralMatch[1]!)
  if (side === null || lateral === null) return null
  const points = constructRegularSquarePyramid(side, lateral)
  if (points === null) return null
  const plan: Extract<PlanEnvelope, { kind: "plan" }> = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "由底面边长与侧棱长解析构造的正四棱锥",
    factIds: [],
    actions: [{
      actionId: "solid.create_polyhedron",
      actionKey: "regular-square-pyramid",
      factIds: [],
      inputs: {
        alias: "regular-square-pyramid",
        vertexNames: ["A", "B", "C", "D", "P"],
        vertices: [points.a, points.b, points.c, points.d, points.p],
        faces: [[0, 1, 2, 3], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]]
      }
    }]
  }
  const compiled = compileOnce(plan, { ...context, prompt: expandExamShorthand(prompt) })
  if (!compiled.result.ok || compiled.result.draftDocument === null) return null
  if (compiled.result.diagramVerification !== undefined && compiled.result.diagramVerification.status !== "passed") return null
  return {
    ...compiled.result,
    assumptions: [...compiled.result.assumptions, {
      id: "witness.regularSquarePyramid",
      text: "正四棱锥按底边 a 与侧棱 l 解析构造：顶点在底面中心正上方，h²=l²−a²/2。",
      kind: "witness",
      value: { side, lateral },
      overridable: true,
      path: "envelope.actions[0].inputs.vertices"
    }],
    materialisedActions: compiled.result.actions
  }
}

function rescueWithSquarePyramid(context: PlanCompileContext, first: CompileOnceOutcome): PlanCompileResult | null {
  if (first.result.diagramVerification?.status === "passed" || first.plan === null || first.obligations === null || context.prompt === undefined) return null
  const prompt = normalizeGeometryPrompt(context.prompt)
  if (!prompt.includes("正方形")) return null
  const shape = /四棱锥\s*([A-Z])\s*-\s*([A-Z])([A-Z])([A-Z])([A-Z])/.exec(prompt)
  if (shape === null) return null
  const apex = shape[1]!
  const base = [shape[2]!, shape[3]!, shape[4]!, shape[5]!] as const

  const lengths = new Map<string, number>()
  for (const obligation of first.obligations.ir.obligations) {
    if (obligation.kind !== "fixedLength" || obligation.targets.length !== 2 || typeof obligation.expected !== "number") continue
    lengths.set(pairKey(obligation.targets[0]!, obligation.targets[1]!), obligation.expected)
  }
  for (const match of prompt.matchAll(/([A-Z])([A-Z])=([A-Z])([A-Z])=([0-9.]+|√[0-9.]+)/g)) {
    const value = parseLengthLiteral(match[5]!)
    if (value === null) continue
    lengths.set(pairKey(match[1]!, match[2]!), value)
    lengths.set(pairKey(match[3]!, match[4]!), value)
  }
  for (const match of prompt.matchAll(/([A-Z])([A-Z])=([0-9.]+|√[0-9.]+)/g)) {
    const value = parseLengthLiteral(match[3]!)
    if (value !== null) lengths.set(pairKey(match[1]!, match[2]!), value)
  }
  const lengthOf = (left: string, right: string): number | undefined => lengths.get(pairKey(left, right))
  const side = lengthOf(base[0], base[1])
  const apexToC = lengthOf(apex, base[2])
  const apexToD = lengthOf(apex, base[3])
  if (side === undefined || apexToC === undefined || apexToD === undefined) return null
  const angle = new RegExp(`∠${apex}${base[2]}${base[0]}\\s*=\\s*([0-9.]+)°`).exec(prompt)
  if (angle === null) return null
  const anglePcaDegrees = Number(angle[1])
  const points = constructSquarePyramid({ side, apexToC, apexToD, anglePcaDegrees })
  if (points === null) return null

  const plan: Extract<PlanEnvelope, { kind: "plan" }> = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "由底面正方形与顶点距离/角度构造的四棱锥",
    factIds: [],
    actions: [{
      actionId: "solid.create_polyhedron",
      actionKey: "square-pyramid",
      factIds: [],
      inputs: {
        alias: "square-pyramid",
        vertexNames: [base[0], base[1], base[2], base[3], apex],
        vertices: [points.a, points.b, points.c, points.d, points.p],
        faces: [[0, 1, 2, 3], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]]
      }
    }]
  }
  const compiled = compileOnce(plan, { ...context, prompt: expandExamShorthand(prompt) })
  if (!compiled.result.ok || compiled.result.draftDocument === null || compiled.result.diagramVerification?.status !== "passed") return null
  return {
    ...compiled.result,
    assumptions: [...compiled.result.assumptions, {
      id: "witness.squarePyramid",
      text: "由底面正方形、PC=PD 与 ∠PCA 解析构造顶点坐标；最终仍按题设核验。",
      kind: "witness",
      value: { apex, base, side, apexToC, apexToD, anglePcaDegrees },
      overridable: true,
      path: "envelope.actions[0].inputs.vertices"
    }],
    materialisedActions: compiled.result.actions
  }
}

/**
 * **右三棱柱的解析构造**（2026-10-19，P1-1，solid-13）。
 *
 * 题面：三棱柱 ABC-A₁B₁C₁，AA₁=L，A₁C⊥底面，∠ACB=90°，
 * A₁ 到平面 BCC₁B₁ 的距离 d1，直线 AA₁ 与 BB₁ 的距离 d2。
 * 距离类条件目前解析器读不出，所以这里允许 **unverified** 结果，但绝不把 failed 当成功。
 */
function rescueWithRightPrism(context: PlanCompileContext, first: CompileOnceOutcome): PlanCompileResult | null {
  if (first.result.diagramVerification?.status === "passed" || first.plan === null || first.obligations === null || context.prompt === undefined) return null
  const prompt = normalizeGeometryPrompt(context.prompt)
  const shape = /三棱柱\s*([A-Z])([A-Z])([A-Z])\s*-\s*([A-Z])₁([A-Z])₁([A-Z])₁/.exec(prompt)
  if (shape === null) return null
  const base = [shape[1]!, shape[2]!, shape[3]!] as const
  const top = [`${shape[4]!}₁`, `${shape[5]!}₁`, `${shape[6]!}₁`] as const
  const rightAngle = new RegExp(`∠${base[0]}${base[2]}${base[1]}\\s*=\\s*90°`).test(prompt)
  if (!rightAngle) return null
  const lateral = new RegExp(`${base[0]}${top[0]}\\s*=\\s*([0-9.]+|√[0-9.]+)`).exec(prompt)
  const toPlane = new RegExp(`${top[0]}到平面[^，。]+?距离为([0-9.]+)`).exec(prompt)
  const lineDistance = /直线[^，。]+?距离为([0-9.]+)/.exec(prompt)
  if (lateral === null || toPlane === null || lineDistance === null) return null
  const lateralLength = parseLengthLiteral(lateral[1]!)
  const apexToPlane = Number(toPlane[1])
  const lateralLineDistance = Number(lineDistance[1])
  if (lateralLength === null || !Number.isFinite(apexToPlane) || !Number.isFinite(lateralLineDistance)) return null
  const points = constructRightPrism({ lateralLength, apexToPlane, lateralLineDistance })
  if (points === null) return null

  const plan: Extract<PlanEnvelope, { kind: "plan" }> = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "由侧棱长与两个距离构造的右三棱柱",
    factIds: [],
    actions: [{
      actionId: "solid.create_prism",
      actionKey: "right-prism",
      factIds: [],
      inputs: {
        alias: "right-prism",
        basePolygon: [points.a, points.b, points.c],
        vector: { x: points.a1.x - points.a.x, y: points.a1.y - points.a.y, z: points.a1.z - points.a.z },
        vertexNames: [base[0], base[1], base[2], top[0], top[1], top[2]]
      }
    }]
  }
  const compiled = compileOnce(plan, { ...context, prompt: expandExamShorthand(prompt) })
  if (!compiled.result.ok || compiled.result.draftDocument === null || compiled.result.diagramVerification?.status === "failed") return null
  const verified = compiled.result.diagramVerification?.status === "passed"
  return {
    ...compiled.result,
    assumptions: [...compiled.result.assumptions, {
      id: "witness.rightPrism",
      text: verified
        ? "由侧棱长与两个距离解析构造右三棱柱；最终已按题设核验。"
        : "由侧棱长与两个距离解析构造右三棱柱；距离类条件尚未被解析器读出，因此仍标未核验。",
      kind: "witness",
      value: { lateralLength, apexToPlane, lateralLineDistance },
      overridable: true,
      path: "envelope.actions[0].inputs.basePolygon"
    }],
    materialisedActions: compiled.result.actions
  }
}

/**
 * **等腰直角 + 等边 + 二面角**的解析构造（2026-10-19，P1-1，trig-23）。
 *
 * AB 为等腰直角三角形 ABC 的斜边，△ABD 为等边三角形，二面角 C-AB-D=θ。
 * 由 `constructDihedralTriangle` 给出两张共享 AB 的面；AB 长度不参与角度条件，
 * 取 2。二面角/等边能否核验取决于解析器，因此允许 `unverified`，不允许 `failed`。
 */
function rescueWithDihedralTriangle(context: PlanCompileContext, first: CompileOnceOutcome): PlanCompileResult | null {
  if (first.result.diagramVerification?.status === "passed" || first.plan === null || first.obligations === null || context.prompt === undefined) return null
  const prompt = normalizeGeometryPrompt(context.prompt)
  const right = /△([A-Z])([A-Z])([A-Z])为等腰直角三角形/.exec(prompt)
  const equilateral = /△([A-Z])([A-Z])([A-Z])为等边三角形/.exec(prompt)
  const dihedral = /二面角([A-Z])-([A-Z])([A-Z])-([A-Z])为([0-9.]+)°/.exec(prompt)
  if (right === null || equilateral === null || dihedral === null) return null
  const [a, b, c] = [right[1]!, right[2]!, right[3]!]
  const d = equilateral[3]!
  if (![equilateral[1], equilateral[2]].every((name) => name === a || name === b)) return null
  if (dihedral[1] !== c || ![dihedral[2], dihedral[3]].includes(a) || ![dihedral[2], dihedral[3]].includes(b) || dihedral[4] !== d) return null
  const dihedralDegrees = Number(dihedral[5])
  const points = constructDihedralTriangle({ ab: 2, dihedralDegrees })
  if (points === null) return null

  const plan: Extract<PlanEnvelope, { kind: "plan" }> = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "由等腰直角、等边与二面角构造的两张面",
    factIds: [],
    actions: [
      {
        actionId: "solid.create_face",
        actionKey: "triangle-abc",
        factIds: [],
        inputs: { alias: "ABC", vertexNames: [a, b, c], vertices: [points.a, points.b, points.c] }
      },
      {
        actionId: "solid.create_face",
        actionKey: "triangle-abd",
        factIds: [],
        inputs: { alias: "ABD", vertexNames: [a, b, d], vertices: [points.a, points.b, points.d] }
      }
    ]
  }
  const compiled = compileOnce(plan, { ...context, prompt: expandExamShorthand(prompt) })
  if (!compiled.result.ok || compiled.result.draftDocument === null || compiled.result.diagramVerification?.status === "failed") return null
  const verified = compiled.result.diagramVerification?.status === "passed"
  return {
    ...compiled.result,
    assumptions: [...compiled.result.assumptions, {
      id: "witness.dihedral",
      text: verified
        ? "由等腰直角、等边与二面角解析构造两张共享 AB 的面；已按题设核验。"
        : "由等腰直角、等边与二面角解析构造两张共享 AB 的面；部分角度条件未解析，仍标未核验。",
      kind: "witness",
      value: { a, b, c, d, ab: 2, dihedralDegrees },
      overridable: true,
      path: "envelope.actions"
    }],
    materialisedActions: compiled.result.actions
  }
}

/**
 * **折片题的规范重建**（2026-10-19，稳定性复跑）：不再依赖模型把“四边形 + E/F + fold”
 * 写对，而是用平面见证搜索构造 A–D，再按题面比例建 E/F、按题面补折、剪角、反求折角。
 *
 * 只处理“四边形 + 一个折片”这一族；别的结构仍走原有救援。
 */
function rescueWithFoldConstruction(context: PlanCompileContext, first: CompileOnceOutcome): PlanCompileResult | null {
  if (first.result.diagramVerification?.status === "passed" || first.plan === null || first.obligations === null || context.prompt === undefined) return null
  const prompt = normalizeGeometryPrompt(context.prompt)
  const fold = readFoldTransformations(prompt)[0]
  if (fold === undefined) return null
  const quad = /四边形\s*([A-Z])([A-Z])([A-Z])([A-Z])/.exec(prompt)
  if (quad === null) return null
  const hostNames = new Set([quad[1]!, quad[2]!, quad[3]!, quad[4]!])
  const searchIr = {
    ...first.obligations.ir,
    obligations: first.obligations.ir.obligations.filter((obligation) => obligation.targets.every((name) => hostNames.has(name)))
  }
  const found = searchWitness(witnessSearchInput(searchIr, prompt))
  if (found.status !== "verified_instance") return null
  const candidate = found.candidate
  if (candidate.names.length !== 4 || !candidate.names.includes(fold.apex)) return null

  const ratios = new Map<string, { from: string; to: string; parameter: number }>()
  for (const match of prompt.matchAll(/([A-Z])([A-Z])=([0-9]+(?:\.[0-9]+)?)\/([0-9]+)\s*([A-Z])([A-Z])/g)) {
    const numerator = Number(match[3])
    const denominator = Number(match[4])
    if (!(denominator > 0) || !Number.isFinite(numerator)) continue
    ratios.set(match[2]!, {
      from: match[1]!,
      to: match[6]!,
      parameter: Math.max(0, Math.min(1, numerator / denominator))
    })
  }
  const hingeNames = [...fold.face].filter((name) => name !== fold.apex)
  if (hingeNames.length !== 2 || hingeNames.some((name) => !ratios.has(name))) return null

  const hostAlias = "fold-host"
  const host = {
    actionId: "solid.create_face",
    actionKey: hostAlias,
    factIds: [],
    inputs: { alias: hostAlias, vertexNames: [...candidate.names], vertices: candidate.vertices }
  } as unknown as (typeof first.plan.actions)[number]
  const bounds = hingeNames.map((name) => {
    const ratio = ratios.get(name)!
    return {
      actionId: "dynamic.create_bound_point",
      actionKey: `fold-hinge-${name}`,
      factIds: [],
      inputs: {
        alias: name,
        label: name,
        host: { scope: "draft", alias: hostAlias },
        hostEdge: { from: ratio.from, to: ratio.to },
        parameter: ratio.parameter
      }
    } as unknown as (typeof first.plan.actions)[number]
  })
  const foldAction = {
    actionId: "solid.fold",
    actionKey: "fold-flap",
    factIds: [],
    inputs: {
      alias: "fold-flap",
      vertexNames: [...fold.face],
      hinge: { from: fold.hinge.from, to: fold.hinge.to },
      apex: fold.apex,
      apexAs: fold.apexAs,
      angle: 90
    }
  } as unknown as (typeof first.plan.actions)[number]
  const plan: Extract<PlanEnvelope, { kind: "plan" }> = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "由平面见证坐标 + 题面比例 + 折角反求构造的折片",
    factIds: [],
    actions: [host, ...bounds, foldAction]
  }
  const prepared = cutFoldedCorner(plan)
  const verificationContext = { ...context, prompt: expandExamShorthand(prompt) }
  const compiled = compileOnce(prepared, verificationContext)
  let result = compiled.result
  if (result.diagramVerification?.status !== "passed" || !result.ok || result.draftDocument === null) {
    const solved = rescueWithSolvedFoldAngle(context, { ...first, plan: prepared, result })
    if (solved === null) return null
    result = solved
  }
  if (!result.ok || result.draftDocument === null || result.diagramVerification?.status !== "passed") return null
  return {
    ...result,
    assumptions: [...result.assumptions, {
      id: "witness.foldConstruction",
      text: "折片由平面见证坐标 + 题面比例 + 折角反求规范重建；最终仍按题设核验。",
      kind: "witness",
      value: { candidate: candidate.names, hinge: fold.hinge, apex: fold.apex, apexAs: fold.apexAs },
      overridable: true,
      path: "envelope.actions"
    }],
    materialisedActions: result.actions
  }
}

/**
 * **面环自交 → 按平面角序重排**（2026-10-19，solid-9/20 现场）。
 *
 * 模型给了正确的顶点，但面环顺序写成蝴蝶结（`[0,2,1,3]`），内核报
 * `face ring … self-intersects`。这里只重排**被点名的那些多面体的面环**：
 * 以面中心为原点、面法向为轴，按 atan2 排序；顶点数组与点名顺序不动。
 */
function rescueWithSortedFaceRings(context: PlanCompileContext, first: CompileOnceOutcome): PlanCompileResult | null {
  if (first.result.ok || first.plan === null) return null
  const indexes = new Set<number>()
  for (const diagnostic of first.result.diagnostics) {
    if (!["degenerate_polyhedron", "degenerate_prism"].includes(diagnostic.code) || !/(self-intersects|自交)/i.test(diagnostic.detail)) continue
    const index = Number(/envelope\.actions\[(\d+)\]/.exec(diagnostic.path)?.[1])
    if (Number.isInteger(index) && index >= 0) indexes.add(index)
  }
  if (indexes.size === 0) return null

  const actions = first.plan.actions.map((action, index) => {
    if (!indexes.has(index)) return action
    if (action.actionId === "solid.create_prism") {
      const inputs = action.inputs as { basePolygon?: unknown }
      if (!Array.isArray(inputs.basePolygon)) return action
      const points = inputs.basePolygon as { x: number; y: number; z: number }[]
      if (points.length < 3) return action
      const center = points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length, z: sum.z + point.z / points.length }), { x: 0, y: 0, z: 0 })
      const edgeA = { x: points[1]!.x - points[0]!.x, y: points[1]!.y - points[0]!.y, z: points[1]!.z - points[0]!.z }
      let normal: { x: number; y: number; z: number } | null = null
      for (let cursor = 2; cursor < points.length; cursor += 1) {
        const edgeB = { x: points[cursor]!.x - points[0]!.x, y: points[cursor]!.y - points[0]!.y, z: points[cursor]!.z - points[0]!.z }
        const cross = {
          x: edgeA.y * edgeB.z - edgeA.z * edgeB.y,
          y: edgeA.z * edgeB.x - edgeA.x * edgeB.z,
          z: edgeA.x * edgeB.y - edgeA.y * edgeB.x
        }
        if (Math.hypot(cross.x, cross.y, cross.z) > 1e-12) { normal = cross; break }
      }
      if (normal === null) return action
      const length = Math.hypot(normal.x, normal.y, normal.z)
      const unitNormal = { x: normal.x / length, y: normal.y / length, z: normal.z / length }
      const firstVector = { x: points[0]!.x - center.x, y: points[0]!.y - center.y, z: points[0]!.z - center.z }
      const firstLength = Math.hypot(firstVector.x, firstVector.y, firstVector.z) || 1
      const u = { x: firstVector.x / firstLength, y: firstVector.y / firstLength, z: firstVector.z / firstLength }
      const v = {
        x: unitNormal.y * u.z - unitNormal.z * u.y,
        y: unitNormal.z * u.x - unitNormal.x * u.z,
        z: unitNormal.x * u.y - unitNormal.y * u.x
      }
      const sortedBase = points.map((point) => {
        const relative = { x: point.x - center.x, y: point.y - center.y, z: point.z - center.z }
        return { point, angle: Math.atan2(relative.x * v.x + relative.y * v.y + relative.z * v.z, relative.x * u.x + relative.y * u.y + relative.z * u.z) }
      }).sort((left, right) => left.angle - right.angle).map((entry) => entry.point)
      return { ...action, inputs: { ...(action.inputs as Record<string, unknown>), basePolygon: sortedBase } }
    }
    if (action.actionId !== "solid.create_polyhedron") return action
    const inputs = action.inputs as { vertices?: unknown; faces?: unknown }
    if (!Array.isArray(inputs.vertices) || !Array.isArray(inputs.faces)) return action
    const vertices = inputs.vertices as { x: number; y: number; z: number }[]
    const sortRing = (ring: number[]): number[] => {
      if (ring.length < 3) return ring
      const points = ring.map((vertexIndex) => vertices[vertexIndex]).filter((point): point is { x: number; y: number; z: number } => point !== undefined)
      if (points.length !== ring.length) return ring
      const center = points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length, z: sum.z + point.z / points.length }), { x: 0, y: 0, z: 0 })
      const edgeA = { x: points[1]!.x - points[0]!.x, y: points[1]!.y - points[0]!.y, z: points[1]!.z - points[0]!.z }
      let normal: { x: number; y: number; z: number } | null = null
      for (let cursor = 2; cursor < points.length; cursor += 1) {
        const edgeB = { x: points[cursor]!.x - points[0]!.x, y: points[cursor]!.y - points[0]!.y, z: points[cursor]!.z - points[0]!.z }
        const cross = {
          x: edgeA.y * edgeB.z - edgeA.z * edgeB.y,
          y: edgeA.z * edgeB.x - edgeA.x * edgeB.z,
          z: edgeA.x * edgeB.y - edgeA.y * edgeB.x
        }
        if (Math.hypot(cross.x, cross.y, cross.z) > 1e-12) { normal = cross; break }
      }
      if (normal === null) return ring
      const length = Math.hypot(normal.x, normal.y, normal.z)
      const unitNormal = { x: normal.x / length, y: normal.y / length, z: normal.z / length }
      const firstVector = { x: points[0]!.x - center.x, y: points[0]!.y - center.y, z: points[0]!.z - center.z }
      const firstLength = Math.hypot(firstVector.x, firstVector.y, firstVector.z) || 1
      const u = { x: firstVector.x / firstLength, y: firstVector.y / firstLength, z: firstVector.z / firstLength }
      const v = {
        x: unitNormal.y * u.z - unitNormal.z * u.y,
        y: unitNormal.z * u.x - unitNormal.x * u.z,
        z: unitNormal.x * u.y - unitNormal.y * u.x
      }
      return ring.map((vertexIndex, position) => {
        const point = points[position]!
        const relative = { x: point.x - center.x, y: point.y - center.y, z: point.z - center.z }
        return { vertexIndex, angle: Math.atan2(relative.x * v.x + relative.y * v.y + relative.z * v.z, relative.x * u.x + relative.y * u.y + relative.z * u.z) }
      }).sort((left, right) => left.angle - right.angle).map((entry) => entry.vertexIndex)
    }
    return {
      ...action,
      inputs: { ...(action.inputs as Record<string, unknown>), faces: (inputs.faces as unknown[]).map((ring) => Array.isArray(ring) ? sortRing(ring as number[]) : ring) }
    }
  })
  const sorted = { ...first.plan, actions }
  const compiled = compileOnce(sorted, context)
  if (!compiled.result.ok || compiled.result.draftDocument === null || compiled.result.diagramVerification?.status === "failed") return null
  return {
    ...compiled.result,
    assumptions: [...compiled.result.assumptions, {
      id: "witness.sortedFaceRings",
      text: "面环原先自交：按面内角序重排了环，顶点与点名顺序未动；最终仍按题设核验。",
      kind: "inferred",
      value: { actions: [...indexes] },
      overridable: true,
      path: "envelope.actions"
    }],
    materialisedActions: compiled.result.actions
  }
}

/**
 * **直四棱柱 + 梯形底**（2026-10-19，P1-1，solid-20）。由 AB、AD、CD 与体积解出高，
 * 再用 `solid.create_prism` 建底面 + 拉伸；垂直/平行条件仍交给题设核验。
 */
function rescueWithTrapezoidPrism(context: PlanCompileContext, first: CompileOnceOutcome): PlanCompileResult | null {
  if (first.result.diagramVerification?.status === "passed" || context.prompt === undefined) return null
  const prompt = normalizeGeometryPrompt(context.prompt)
  const shape = /直四棱柱\s*([A-Z])([A-Z])([A-Z])([A-Z])\s*-\s*([A-Z])₁([A-Z])₁([A-Z])₁([A-Z])₁/.exec(prompt)
  if (shape === null || !/AB\s*⊥\s*AD/.test(prompt) || !/AB\s*\/\/\s*CD/.test(prompt)) return null
  const base = [shape[1]!, shape[2]!, shape[3]!, shape[4]!] as const
  const top = [`${shape[5]!}₁`, `${shape[6]!}₁`, `${shape[7]!}₁`, `${shape[8]!}₁`] as const
  const lengths = new Map<string, number>()
  for (const match of prompt.matchAll(/([A-Z])([A-Z])\s*=\s*([0-9.]+|√[0-9.]+)/g)) {
    const value = parseLengthLiteral(match[3]!)
    if (value !== null) lengths.set(pairKey(match[1]!, match[2]!), value)
  }
  const ab = lengths.get(pairKey(base[0], base[1]))
  const ad = lengths.get(pairKey(base[0], base[3]))
  const cd = lengths.get(pairKey(base[2], base[3]))
  const volumeMatch = /体积为([0-9.]+)/.exec(prompt)
  if (ab === undefined || ad === undefined || cd === undefined || volumeMatch === null) return null
  const points = constructRightTrapezoidPrism({ ab, ad, cd, volume: Number(volumeMatch[1]) })
  if (points === null) return null
  const plan: Extract<PlanEnvelope, { kind: "plan" }> = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "由梯形底与体积构造的直四棱柱",
    factIds: [],
    actions: [{
      actionId: "solid.create_prism",
      actionKey: "trapezoid-prism",
      factIds: [],
      inputs: {
        alias: "trapezoid-prism",
        basePolygon: [points.a, points.b, points.c, points.d],
        vector: { x: 0, y: 0, z: points.a1.z },
        vertexNames: [base[0], base[1], base[2], base[3], top[0], top[1], top[2], top[3]]
      }
    }]
  }
  const compiled = compileOnce(plan, { ...context, prompt: expandExamShorthand(prompt) })
  if (!compiled.result.ok || compiled.result.draftDocument === null || compiled.result.diagramVerification?.status === "failed") return null
  const verified = compiled.result.diagramVerification?.status === "passed"
  return {
    ...compiled.result,
    assumptions: [...compiled.result.assumptions, {
      id: "witness.trapezoidPrism",
      text: verified
        ? "由梯形底与体积解出高的直四棱柱；已按题设核验。"
        : "由梯形底与体积解出高的直四棱柱；部分条件未解析，仍标未核验。",
      kind: "witness",
      value: { ab, ad, cd, volume: Number(volumeMatch[1]) },
      overridable: true,
      path: "envelope.actions[0].inputs.basePolygon"
    }],
    materialisedActions: compiled.result.actions
  }
}

/**
 * **PA⊥底面 + AD=CD + 平面 PAC⊥平面 PBD**（2026-10-19，P1-1，solid-9）。
 * 解析构造出 A/B/C/D/P；平面垂直条件仍交给题设核验。
 */
function rescueWithPerpendicularPyramid(context: PlanCompileContext, first: CompileOnceOutcome): PlanCompileResult | null {
  if (first.result.diagramVerification?.status === "passed" || context.prompt === undefined) return null
  const prompt = normalizeGeometryPrompt(context.prompt)
  const shape = /四棱锥\s*([A-Z])\s*-\s*([A-Z])([A-Z])([A-Z])([A-Z])/.exec(prompt)
  if (shape === null) return null
  const apex = shape[1]!
  const base = [shape[2]!, shape[3]!, shape[4]!, shape[5]!] as const
  if (!new RegExp(`${apex}${base[0]}\\s*⊥\\s*平面`).test(prompt)) return null
  if (!new RegExp(`${base[0]}${base[3]}\\s*=\\s*${base[2]}${base[3]}`).test(prompt)) return null
  if (!prompt.includes("平面PAC⊥平面PBD")) return null

  const lengths = new Map<string, number>()
  for (const match of prompt.matchAll(/((?:[A-Z]{2}=)+)([0-9.]+|√[0-9.]+)/g)) {
    const value = parseLengthLiteral(match[2]!)
    if (value === null) continue
    for (const pair of match[1]!.matchAll(/([A-Z])([A-Z])=/g)) lengths.set(pairKey(pair[1]!, pair[2]!), value)
  }
  for (const match of prompt.matchAll(/(?<!∠)([A-Z])([A-Z])\s*=\s*([0-9.]+|√[0-9.]+)(?![\d.°])/g)) {
    const value = parseLengthLiteral(match[3]!)
    if (value !== null) lengths.set(pairKey(match[1]!, match[2]!), value)
  }
  const pa = lengths.get(pairKey(apex, base[0]))
  const ab = lengths.get(pairKey(base[0], base[1]))
  const bc = lengths.get(pairKey(base[1], base[2]))
  const angleMatch = new RegExp(`∠${base[0]}${base[1]}${base[2]}\\s*=\\s*([0-9.]+)°`).exec(prompt)
  if (pa === undefined || ab === undefined || bc === undefined || angleMatch === null) return null
  const points = constructPerpendicularPyramid({ ab, bc, angleABC: Number(angleMatch[1]), pa })
  if (points === null) return null

  const plan: Extract<PlanEnvelope, { kind: "plan" }> = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "PA⊥底面且平面 PAC⊥平面 PBD 的四棱锥",
    factIds: [],
    actions: [{
      actionId: "solid.create_polyhedron",
      actionKey: "perpendicular-pyramid",
      factIds: [],
      inputs: {
        alias: "perpendicular-pyramid",
        vertexNames: [base[0], base[1], base[2], base[3], apex],
        vertices: [points.a, points.b, points.c, points.d, points.p],
        faces: [[0, 1, 2, 3], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]]
      }
    }]
  }
  const compiled = compileOnce(plan, { ...context, prompt: expandExamShorthand(prompt) })
  if (!compiled.result.ok || compiled.result.draftDocument === null || compiled.result.diagramVerification?.status === "failed") return null
  const verified = compiled.result.diagramVerification?.status === "passed"
  return {
    ...compiled.result,
    assumptions: [...compiled.result.assumptions, {
      id: "witness.perpendicularPyramid",
      text: verified
        ? "由 PA、AB、BC、∠ABC 与垂直平面条件解析构造四棱锥；已按题设核验。"
        : "由 PA、AB、BC、∠ABC 与垂直平面条件解析构造四棱锥；部分条件未解析，仍标未核验。",
      kind: "witness",
      value: { apex, base, pa, ab, bc, angleABC: Number(angleMatch[1]) },
      overridable: true,
      path: "envelope.actions[0].inputs.vertices"
    }],
    materialisedActions: compiled.result.actions
  }
}

/**
 * **外心条件**（2026-10-19，P3-4，trig-89）：`2AB·AO=|AB|²` 与 `2AC·AO=|AC|²`
 * 等价于 O 在 AB、AC 的垂直平分线上。取一个一般三角形与它的外心，直接重建平面图。
 */
function rescueWithCircumcenterPoint(context: PlanCompileContext, first: CompileOnceOutcome): PlanCompileResult | null {
  if (first.result.diagramVerification?.status === "passed" || context.prompt === undefined) return null
  const prompt = normalizeGeometryPrompt(context.prompt)
  if (!/2AB·AO=\|AB\|²/.test(prompt) || !/2AC·AO=\|AC\|²/.test(prompt)) return null
  const a = { x: 0, y: 0 }
  const b = { x: 4, y: 0 }
  const c = { x: 1, y: 3 }
  const o = { x: 2, y: 1 }
  const plan: Extract<PlanEnvelope, { kind: "plan" }> = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "由两条点积条件确定外心的平面三角形",
    factIds: [],
    actions: [
      { actionId: "planar.create_point", actionKey: "A", factIds: [], inputs: { alias: "A", points: [a], label: "A" } },
      { actionId: "planar.create_point", actionKey: "B", factIds: [], inputs: { alias: "B", points: [b], label: "B" } },
      { actionId: "planar.create_point", actionKey: "C", factIds: [], inputs: { alias: "C", points: [c], label: "C" } },
      { actionId: "planar.create_point", actionKey: "O", factIds: [], inputs: { alias: "O", points: [o], label: "O" } },
      { actionId: "planar.create_segment", actionKey: "AB", factIds: [], inputs: { alias: "AB", points: [a, b] } },
      { actionId: "planar.create_segment", actionKey: "BC", factIds: [], inputs: { alias: "BC", points: [b, c] } },
      { actionId: "planar.create_segment", actionKey: "CA", factIds: [], inputs: { alias: "CA", points: [c, a] } },
      { actionId: "planar.create_segment", actionKey: "AO", factIds: [], inputs: { alias: "AO", points: [a, o] } }
    ]
  } as Extract<PlanEnvelope, { kind: "plan" }>
  const compiled = compileOnce(plan, { ...context, prompt: expandExamShorthand(prompt) })
  if (!compiled.result.ok || compiled.result.draftDocument === null || compiled.result.diagramVerification?.status !== "passed") return null
  return {
    ...compiled.result,
    assumptions: [...compiled.result.assumptions, {
      id: "witness.circumcenter",
      text: "两条点积条件等价于 O 为外心；用一般三角形及其外心重建，最终按题设核验。",
      kind: "witness",
      value: { a, b, c, o },
      overridable: true,
      path: "envelope.actions"
    }],
    materialisedActions: compiled.result.actions
  }
}

/**
 * **结构清洗：顺序 + 非法折角**（2026-10-19，P1-3）。
 *
 * 修复稿经常一次带两个独立缺陷：`EF` 排在建点之前、折角写成 `0°`。原先是两次独立救援，
 * 第一处修好后第二处仍会挡住编译。这里在**同一份计划**上依次清洗，再走正常核验/折角反求。
 * 0° 不是合法折角，按安全默认 90° 回填并写进 `assumptions`（可覆盖），不静默。
 */
function rescueWithStructuralRepairs(context: PlanCompileContext, first: CompileOnceOutcome): PlanCompileResult | null {
  if (first.result.ok || first.plan === null) return null
  let plan = first.plan
  let compiled = first.result
  let changed = false
  for (let round = 0; round < 4; round += 1) {
    const diagnostic = compiled.diagnostics.find((entry) => entry.code === "segment_reference_missing")
    if (diagnostic === undefined) break
    const index = Number(/envelope\.actions\[(\d+)\]/.exec(diagnostic.path)?.[1])
    if (!Number.isInteger(index) || index < 0) return null
    const actions = [...plan.actions]
    const [moved] = actions.splice(index, 1)
    if (moved === undefined) return null
    actions.push(moved)
    plan = { ...plan, actions }
    changed = true
    compiled = compileOnce(plan, context).result
  }

  const defaults: { id: string; text: string; kind: "safe_default"; value: unknown; overridable: boolean; path: string }[] = []
  const patchedActions = plan.actions.map((action, index) => {
    if (action.actionId !== "solid.fold") return action
    const inputs = action.inputs as Record<string, unknown>
    const angle = inputs.angle
    if (typeof angle === "number" && Number.isFinite(angle) && angle > 0 && angle <= 180) return action
    const apexAs = typeof inputs.apexAs === "string" ? inputs.apexAs : "P"
    defaults.push({
      id: `default-fold-angle.${apexAs}`,
      text: `折角写成了 ${String(angle)}（不在 (0°,180°] 内）：按安全默认 90° 回填，最终仍由题设核验；可在面板改回。`,
      kind: "safe_default",
      value: { apexAs, angleDegrees: 90, reason: "invalid_fold_angle" },
      overridable: true,
      path: `envelope.actions[${index}].inputs.angle`
    })
    return { ...action, inputs: { ...inputs, angle: 90 } }
  })
  if (defaults.length > 0) {
    plan = { ...plan, actions: patchedActions as typeof plan.actions }
    changed = true
    compiled = compileOnce(plan, context).result
  }
  if (!changed) return null

  const withDefaults = (result: PlanCompileResult): PlanCompileResult => ({
    ...result,
    assumptions: [...result.assumptions, ...defaults],
    materialisedActions: result.actions
  })

  if (compiled.ok && compiled.draftDocument !== null && compiled.diagramVerification?.status === "passed") {
    const cut = cutFoldedCorner(plan)
    if (cut !== plan) {
      const cutCompiled = compileOnce(cut, context).result
      if (cutCompiled.ok && cutCompiled.draftDocument !== null && cutCompiled.diagramVerification?.status === "passed") {
        return withDefaults(cutCompiled)
      }
    }
    return withDefaults(compiled)
  }

  /** 90° 只是默认，题面若有目标角/距离，仍交给折角反求把它解出来。 */
  const solved = rescueWithSolvedFoldAngle(context, { ...first, plan, result: compiled })
  return solved === null ? null : withDefaults(solved)
}

function rescueWithSegmentOrder(context: PlanCompileContext, first: CompileOnceOutcome): PlanCompileResult | null {
  if (first.result.ok || first.plan === null) return null
  let plan = first.plan
  let compiled = first.result
  for (let round = 0; round < 4; round += 1) {
    const diagnostic = compiled.diagnostics.find((entry) => entry.code === "segment_reference_missing")
    if (diagnostic === undefined) return null
    const index = Number(/envelope\.actions\[(\d+)\]/.exec(diagnostic.path)?.[1])
    if (!Number.isInteger(index) || index < 0) return null
    const actions = [...plan.actions]
    const [moved] = actions.splice(index, 1)
    if (moved === undefined) return null
    actions.push(moved)
    plan = { ...plan, actions }
    compiled = compileOnce(plan, context).result
    if (compiled.ok && compiled.draftDocument !== null && compiled.diagramVerification?.status === "passed") {
      /** 顺序修好之后，折角剪裁也要照样生效（否则“画面还是四边形 + 尖片”）。 */
      const cut = cutFoldedCorner(plan)
      if (cut !== plan) {
        const cutCompiled = compileOnce(cut, context).result
        if (cutCompiled.ok && cutCompiled.draftDocument !== null && cutCompiled.diagramVerification?.status === "passed") {
          return { ...cutCompiled, materialisedActions: cutCompiled.actions }
        }
      }
      return { ...compiled, materialisedActions: compiled.actions }
    }
  }
  return null
}

function rescueWithMaterialisedPoints(context: PlanCompileContext, first: CompileOnceOutcome): PlanCompileResult | null {
  const report = first.result.diagramVerification
  if (report === undefined || report.status === "passed") return null
  if (first.plan === null || first.obligations === null || context.prompt === undefined) return null
  if (first.result.draftDocument === null) return null

  const entries = missingNamedPoints(first.obligations.legacy, first.plan, first.result.draftDocument, context.document)
  if (entries.length === 0) return null
  /**
   * **动手之前先查不相容**（Task 10）：两条题设把同一个点算到不同位置时，
   * 这一轮**拒绝**并把两条来源都摆出来 —— 而不是"挑一个"或"造两个都叫这个名字的点"。
   * 放在 `materialisedPointActions` **之前**：那一步只负责造，判据不归它。
   */
  const conflict = conflictingMaterialisedPoints(entries, vertexNamesOf(first.plan) ?? [], first.plan.actions.length)
  if (conflict !== null) {
    return {
      ...first.result,
      ok: false,
      draftDocument: null,
      operations: [],
      diagnostics: [...first.result.diagnostics, planDiagnostic(
        "geometry_validation",
        "incompatible_materialised_point",
        "envelope.actions",
        `题面里有两条以上的题设给同一个点 ${conflict.name} 算出了不相容的位置（${conflict.detail}）—— 不挑一个、也不造两个，这一轮停下。`
      )]
    }
  }
  const built = materialisedPointActions(entries, first.plan, first.result.draftDocument, first.result.aliases)
  if (built === null) return null

  const planned = { ...first.plan, actions: [...first.plan.actions, ...built.actions] }
  const second = compileOnce(planned, context)
  if (!second.result.ok || second.result.draftDocument === null || second.result.diagramVerification?.status !== "passed") return null

  return {
    ...second.result,
    assumptions: [...second.result.assumptions, ...materialisedAssumptions(built.points)],
    materialisedActions: second.result.actions
  }
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
  /**
   * **入口语法先行**（S6 接线）：认得出形状从句时，族与 spec 都由 `specForPrompt` 给。
   *
   * 这一份解析同时被**救援路径**与**离线入口**使用 —— 两个读数才可比（设计 §3.2）。
   * 认不出时（没有形状从句 / 点名表与数词对不上 / 两处读出来的底环不是同一组顶点）
   * **退回**"题面提到哪个词"这个更弱的判据：接线之前的行为逐字不变。
   */
  const shaped = specForPrompt(prompt, ir.obligations.filter((obligation) => obligation.role === "given"))
  return {
    obligations: ir,
    shape: shaped.status === "ok" ? shaped.recognised.family : witnessShapeFor(prompt),
    ...(shaped.status === "ok" ? { spec: shaped.spec } : {}),
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
function rescuedByWitnessSearch(context: PlanCompileContext, first: CompileOnceOutcome): WitnessRescue {
  const report = first.result.diagramVerification
  /** 模型自己的坐标已经过核验 ⇒ 连搜索都不调用（"只救不抢"），也**没有任何来源要标注**。 */
  if (report === undefined || report.status === "passed") return { status: "not-needed" }
  if (first.plan === null || first.obligations === null || context.prompt === undefined) {
    return { status: "declined", reason: "这一轮没有拿到可用的题面或计划，无法按题面条件构造坐标。" }
  }

  /**
   * **搜索只看这份平面图形能核验的那几条题设**（2026-10-17）。
   *
   * 这道题的题面里还有 `AE=2/5 AD`（E/F）与 `PC=4√3`（P）—— 平面图形候选里**没有** E/F/P，
   * 拿全量题设去搜，候选永远因为“点名缺失”落成 `unverified_instance`，于是一条都救不回来。
   * 折片那几条由后续的 `rescueWithSolvedFoldAngle` 在**补齐 E/F、解出折角之后**用同一份
   * 全量题设核验；这里只负责把 A–D 构造对。
   */
  const hostNames = (() => {
    const host = first.plan.actions.find((action) => action.actionId === "solid.create_face" || action.actionId === "solid.create_polyhedron")
    const inputs = host?.inputs as { vertexNames?: unknown } | undefined
    if (!Array.isArray(inputs?.vertexNames) || !inputs.vertexNames.every((name) => typeof name === "string")) return null
    return new Set(inputs.vertexNames as string[])
  })()
  const searchIr = hostNames === null
    ? first.obligations.ir
    : {
        ...first.obligations.ir,
        obligations: first.obligations.ir.obligations.filter((obligation) => obligation.targets.every((name) => hostNames.has(name)))
      }
  const found = searchWitness(witnessSearchInput(searchIr, context.prompt))

  if (found.status !== "verified_instance") {
    const why = found.status === "no_witness" ? found.failures : found.reasons
    return { status: "declined", reason: `没能按题面条件构造出坐标（${found.status}）：${(why[0] ?? "").slice(0, 300)}` }
  }

  const cleanedPlan = materialiseFoldHinges(first.plan)
  let candidatePlan = withWitnessCoordinates(cleanedPlan, found.candidate)
  /**
   * **宿主缺席时补一个**（Task 7，2026-10-12）。
   *
   * 现场：题面点了 `B`、`C`、`D`，而模型交的计划**根本没有声明那个平面四边形**
   *（图上只有 `A`、`E`、`F`、`P`）。`withWitnessCoordinates` 要求**恰好一笔宿主动作在场**
   * 才谈得上替换坐标 —— 于是内核把坐标造出来了也**落不了盘**。
   *
   * 三条纪律（判据全在 `figureMaterialisation.ts` 那一层，这里只负责接线）：
   * - 只有**上一句失败之后**才试（成功时一个字都不动，"只救不抢"）；
   * - 形状从句认不出、或认出来的**不是平面图形** ⇒ 不补（不猜拓扑）；
   * - 补出来的那一笔**坐标取内核构造的那一份**，本处一个数字都不算。
   */
  if (candidatePlan === null) {
    const withHost = synthesisedHostPlan(cleanedPlan, context.prompt, first.obligations.ir, found.candidate)
    if (withHost !== null) candidatePlan = withWitnessCoordinates(withHost, found.candidate)
  }
  if (candidatePlan === null) {
    return { status: "declined", reason: "构造出了坐标，但这份计划里没有能承接它的那一笔动作（既不是唯一的多面体，也不是唯一的平面片，或顶点个数 / 点名对不上）。" }
  }

  /**
   * **两块拼图在这里接上**（2026-10-17）：见证搜索给的是四边形的坐标，折片的坐标与折角
   * 还是模型手写的那一份。先把坐标接进折片，再让**现有的**折角反求按题面距离解一次。
   * 没有这一步，"正确的四边形 + 正确的折角"永远不会同时成立，救援每次都在第二遍核验失败。
   */
  const prepared = moveFoldedPointReferencesAfterFold(cutFoldedCorner(adoptWitnessCoordinatesInFold(candidatePlan, found.candidate, context)))
  const preparedFirst: CompileOnceOutcome = { ...first, plan: prepared, result: compileOnce(prepared, context).result }
  /**
   * 计划里**根本没有折那一笔**时（模型直接手写了 P），也要在替换完坐标之后按题面补上 ——
   * `rescueWithSynthesisedFold` 自己会再调折角反求；放在这里，它拿到的就是新的四边形坐标。
   */
  const synthesisedFold = rescueWithSynthesisedFold(context, preparedFirst)
  if (synthesisedFold !== null) {
    return {
      status: "rescued",
      result: {
        ...synthesisedFold,
        assumptions: [...synthesisedFold.assumptions, ...witnessAssumptions(found)],
        materialisedActions: synthesisedFold.actions
      }
    }
  }
  const solvedFold = rescueWithSolvedFoldAngle(context, preparedFirst)
  if (solvedFold !== null) {
    return {
      status: "rescued",
      result: {
        ...solvedFold,
        assumptions: [...solvedFold.assumptions, ...witnessAssumptions(found)],
        materialisedActions: solvedFold.actions
      }
    }
  }

  const second = { result: preparedFirst.result }
  if (!second.result.ok || second.result.draftDocument === null || second.result.diagramVerification?.status !== "passed") {
    return { status: "declined", reason: "构造出的坐标替换进去之后，第二遍核验没有通过 —— 按纪律丢弃，不产出半份草稿。" }
  }

  return {
    status: "rescued",
    result: {
      ...second.result,
      assumptions: [...second.result.assumptions, ...witnessAssumptions(found)],
      /**
       * 草稿层的再核验要对着**这一份**（R37②）：被替换过坐标与点名的候选图，
       * 拿模型的原始动作去核验会得出与图不符的结论。
       */
      materialisedActions: second.result.actions
    }
  }
}

/**
 * **按题面补一个缺掉的宿主**（Task 7）。返回 `null` 表示"不该补"或"补不了"。
 *
 * 三件事按顺序：
 * 1. **形状从句**（`specForPrompt`）认得出、**且是平面图形** —— 认不出就不猜拓扑；
 * 2. `planFigureMaterialisation` 判"能不能补"（名字唯一、环合法、点名都在题面里、
 *    没有既有宿主抢名字、没有读不懂的题设）；判据全在那一层，这里不重复；
 * 3. `materialisedHostAction` 把判断变成一笔真动作，**坐标取内核构造的那一份**。
 *
 * 别名写死成 `materialised-face`：它是**系统补的**，不是模型起的名字 ——
 * 用一个固定的、看得出来源的别名，账本与面板上就能一眼认出这一笔从哪来。
 */
const MATERIALISED_HOST_ALIAS = "materialised-face"

function synthesisedHostPlan(
  plan: Extract<PlanEnvelope, { kind: "plan" }>,
  prompt: string,
  ir: Parameters<typeof searchWitness>[0]["obligations"],
  candidate: PolyhedronWitness
): Extract<PlanEnvelope, { kind: "plan" }> | null {
  const shaped = specForPrompt(prompt, ir.obligations.filter((obligation) => obligation.role === "given"))
  if (shaped.status !== "ok" || shaped.recognised.family !== "planar-figure") return null

  const decision = planFigureMaterialisation({
    intent: buildFigureIntent({ prompt, ir, family: "solid" }),
    candidates: [{ shape: shaped.recognised.phrase, names: shaped.recognised.base, closed: false, sourceClauseIds: [] }],
    /**
     * 既有动作只交出"动作名 + 点名"两样：这一层不去看动作的其余字段
     *（它要判的只是"名字有没有被占用 / 是不是已经有一只图形"）。
     *
     * **"宿主"的定义必须与 `withWitnessCoordinates` 那一份逐字一致**（就是这两族动作）——
     * 第一版这里把**所有**动作都算成宿主，于是夹具里的 `planar.create_point` 让它判成
     * `existing_host`，**判据把自己挡住了**：一个点根本不是宿主。同一个词在两处含义不同，
     * 必然出现"一边说有、一边说没有"。
     */
    existingHosts: plan.actions
      .filter((action) => action.actionId === "solid.create_polyhedron" || action.actionId === "solid.create_face")
      .map((action) => {
        const inputs = isRecord(action.inputs) ? (action.inputs as Record<string, unknown>) : {}
        const declared = Array.isArray(inputs.vertexNames) ? inputs.vertexNames.filter((name): name is string => typeof name === "string") : []
        return { actionId: action.actionId, vertexNames: declared }
      })
  })

  const adapted = materialisedHostAction(decision, { names: candidate.names, vertices: candidate.vertices }, MATERIALISED_HOST_ALIAS)
  if (!adapted.ok) return null
  return { ...plan, actions: [...plan.actions, adapted.action] }
}

/** 见证搜索这条救援的三种结局（第三种带**为什么没救成**，见 `compilePlan` 的来源标注）。 */type WitnessRescue =
  | { status: "rescued"; result: PlanCompileResult }
  /** 模型自己的坐标已经通过核验：什么都没发生，也就没有来源可标。 */
  | { status: "not-needed" }
  | { status: "declined"; reason: string }

/**
 * **退回模型坐标时如实标注来源**（设计 §6 的硬约束：**永不静默采信**）。
 *
 * 只在"这份计划真的有模型手写的坐标、而系统没能按题面条件构造出更好的那一组"时才标注 ——
 * 没有可构造的坐标（模板 / 内核生成）时说这句话是假话；已经通过核验时（`not-needed`）
 * 也没有"退回"这回事。
 */
function labelModelCoordinates(first: CompileOnceOutcome, reason: string): PlanCompileResult {
  if (first.plan === null || !planHasFreeCoordinates(first.plan)) return first.result
  return {
    ...first.result,
    assumptions: [
      ...first.result.assumptions,
      {
        id: "witness.coordinate-source",
        text: `这份图上的坐标是**模型给的、未经条件构造**（系统尝试按题面条件构造，但没有拿到可用的坐标：${reason}）—— 这组坐标没有经过题面条件的构造，请按需核对。`,
        kind: "witness",
        /**
         * 值就是"这份坐标从哪来"这个事实本身（`source` + 为什么没构造出来）——
         * `value` 在 `StructuredAssumption` 里是必填的，而这里能填的也只有这件事。
         */
        value: { source: "model", constructed: false, reason },
        /**
         * **不可覆盖**：它是"这份坐标从哪来"的事实陈述，不是系统替用户选的一个值。
         * 允许覆盖等于让用户把来源信息改掉 —— 那正是 §6 要挡的静默。
         */
        overridable: false,
        path: "witness.coordinate-source"
      }
    ]
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
    advice.push("提醒：`planar.*` 动作在**平面上**作图，坐标只能有 `x`、`y`，**不接受 `z`** —— 带上 `z` 会被直接拒。立体图元（顶点/棱/面）请由 `solid.*` 动作一次建出；**要连两点之间的线**用 `solid.create_segment`（**只给两个点名**，两端必须是图上已经有的点），不要再用 `planar.*` 去补立体的边。")
  }
  const answerInPlan = errors.some((error) => error.path === "envelope.answer" || error.path === "envelope.toolResultRefs" || error.path === "envelope.questions")
  if (answerInPlan) {
    advice.push("提醒：`kind` 为 `plan` 时顶层**只能有** `schemaVersion`、`kind`、`goal`、`factIds`、`assumptions`、`relations`、`actions`。`answer` / `toolResultRefs` / `questions` 属于别的分支，**不要混进来**。")
  }
  /**
   * **引用没写作用域**（2026-10-17 评测现场）：模型把 `dynamic.create_bound_point.host`
   * 写成了裸别名 `"quad"`，传输层回 `a reference must declare scope`。修复必须给出
   * **完整形状**，否则模型下一轮还会写字符串。
   */
  const unscoped = errors.some((error) => error.code === "unscoped_reference")
  if (unscoped) {
    advice.push('提醒：`host` / `target` 这类引用必须是**作用域对象**，不能写裸别名：同一份计划里刚建的用 `{"scope":"draft","alias":"quad"}`，场景里已有的用 `{"scope":"scene","ref":{"documentId":"…","entityId":"…"}}`。')
  }
  const envelopeFailure = errors.some((error) => error.path.startsWith("envelope")) && !answerInPlan
  if (envelopeFailure) {
    advice.push("提醒：`kind` 为 `plan` 时顶层必须有 `goal` 与 `actions`（数组，至少一项）。")
  }
  /**
   * **信封被包成字符串**（2026-10-15 用户现场，翻折那道题）：读数
   * `expected the plan envelope object, got a string — the envelope must be a JSON object,
   * not text that contains one`。引擎那侧的强制转换（`coerceEnvelopeArgument`）**只在
   * "解出来确实是对象"时才用**，所以这一句出现意味着**解析失败**（写坏/被截断）或**解出来不是对象**；
   * 两种情形下模型该做的是同一件事：**把字段直接写进对象里**，而不是先把整份计划拼成一段文字。
   */
  const envelopeWasText = errors.some((error) => error.path === "envelope" && /not text that contains one/.test(error.detail))
  if (envelopeWasText) {
    advice.push("提醒：`plan_set_plan` 的那个参数必须是**对象本身**，不是**装着 JSON 的字符串** —— 请把 `goal` 与 `actions` 作为对象的字段**直接给出**，不要先把整份计划拼成一段文字再传（拼出来的那段还容易被写坏或被截断）。")
  }
  /**
   * **线段引用的点还没建出来**（2026-10-15 用户现场，同一道翻折题第二次读数）。
   *
   * 现场：模型**已经在用** `solid.create_segment`，但它把连线段放在了**建出 `E`、`F` 之前** ——
   * 同一份计划**按顺序**执行，于是两端都找不到。拒绝是对的，可**修复提示必须把"调换顺序"
   * 说成一个动作**：只说"必须是已经建出来的点"，模型两轮都在改名字（它没读成"移到后面"）。
   */
  const segmentReferenceMissing = errors.some((error) => error.code === "segment_reference_missing")
  if (segmentReferenceMissing) {
    advice.push("提醒：`solid.create_segment` 的两端必须**在这份文档里已经存在** —— 同一份计划**按顺序**执行，所以**建出这些点的笔要排在前面**（带 `vertexNames` 的实体 / 面片、`dynamic.create_bound_point`、`solid.fold` 都会建点）。修法是**把连线段的那几笔移到它们之后**（这是顺序问题，不是名字问题）；如果那个点确实没有任何一笔建它，就先补一笔。")
  }
  /**
   * **线段的 `vertexNames` 写空了 / 写错了个数**（2026-10-15 用户现场，第三次读数）。
   *
   * 那一轮模型在"改结构"（同时被多面体那两条错带着跑），交上来的修复稿里
   * `solid.create_segment` 的 `vertexNames` 是**空数组**。传输层已说清"要两个、给了 0 个"，
   * 但修复提示里再给一个**具体的例子**更省事 —— 这一栏是它最容易漏的。
   */
  const segmentNamesWrong = errors.some((error) => /\.inputs\.vertexNames$/.test(error.path) && /segment connects exactly two named points|two point names this segment connects/.test(error.detail))
  if (segmentNamesWrong) {
    advice.push('提醒：`solid.create_segment` 的 `vertexNames` 必须是**恰好两个点名**、写成数组，例如 `["E","F"]`（就是你要连的那两个点）—— 不能留空、也不收坐标。这两个点由**前面几笔**建出来（同一份计划按顺序执行）。')
  }
  /**
   * **开放曲面被强行“封口”成闭合体**（2026-10-17 用户现场）。
   *
   * 用户加了一句「画立体图形」，模型就把「平面四边形 + 翻折片」拿
   * `solid.create_polyhedron` 去封成体，内核逐条回：顶点共面 / 每条棱不在恰好两个面里 /
   * 体积为零。它需要知道的是**题面本身是开放曲面**，不是再补一个面。
   *
   * 判据只认内核这三句真几何诊断（`degenerate_polyhedron`）—— 别的拒因不往这条上引。
   */
  const unsupportedFaceCount = errors.some((error) => error.code === "unsupported_face_count")
  if (unsupportedFaceCount) {
    advice.push("提醒：内核只收**1 个面**（平面片）或**至少 4 个面**（闭合多面体）。2–3 个面是**开放壳** —— 请拆成多笔 `solid.create_face` **逐面建**（每笔给 vertices 与 vertexNames），不要再用 `solid.create_polyhedron` 的闭合形态去套，也不要为了凑 4 面硬加一个不存在的面。")
  }
  const flatOpenFigure = errors.some((error) => error.code === "degenerate_polyhedron"
    && /must not be coplanar|exactly two face rings|non-zero volume/.test(error.detail))
  if (flatOpenFigure) {
    advice.push("提醒：这是**平面四边形 + 翻折片**的**开放曲面**，不是闭合多面体 —— 不要用 `solid.create_polyhedron` 把平面片强行封成体（内核会因共面 / 棱不成对 / 体积为零拒绝）。正确结构是：`solid.create_face` 建平面四边形（给 `vertices` 与 `vertexNames`）、`dynamic.create_bound_point` 建 E / F、`solid.fold` 沿 EF 折出 P，`solid.create_segment` 只给两个点名连线段。「画立体图形」指在三维工作区显示这个折后形状，**不要求闭合体**；如果上一版已经是这个结构，只改坐标，不要再换形状。")
  }
  /**
   * **面片点数不够**（2026-10-15 用户现场，四棱锥那道题）：模型想给「线段 EF」建一笔面片，
   * 只给两个点 ⇒ `a planar face needs at least three vertices`。它需要的不是"再试一次"，
   * 而是知道**它真正想做的事没有对应的动作**：立体几何里没有"画线段"的动作，
   * 实体的棱已经画出来了。这句话写进提醒里，才不至于下一轮再拿面片去凑。
   */
  const shortFace = errors.some((error) => error.path.includes(".inputs.vertices") && error.detail.includes("at least three vertices"))
  if (shortFace) {
    advice.push("提醒：`solid.create_face` 至少要**三个**互异、不共线的共面点。**一条线段不要用面片去凑** —— 立体几何里**没有**「画线段」的动作，实体的棱已经由 `solid.*` 建好并画出来了；要说明 `EF` 请在文字里说，不要为它建面片。")
  }
  /** **重名**（同日现场，修复那一轮）：`vertexNames` 按下标与 `vertices` 一一对应，重名没有意义。 */
  const duplicateName = errors.some((error) => error.code === "duplicate_name")
  if (duplicateName) {
    advice.push("提醒：`vertexNames` 里**每个名字只能用一次**（它按下标与 `vertices` 一一对应）。想让同一个点在一笔动作里出现两次是做不到的 —— 去掉重复的那一个，或拆成两笔动作。")
  }
  /**
   * **面塌了**（2026-10-11 用户现场，第三堵墙）：`face ring [0,1,5] has zero area …
   * these vertices are collinear`。那句话很准，但**没告诉模型为什么塌** —— 现场是模型一直在拿
   * `solid.create_polyhedron` 去拼一只**开放**的图形（平面四边形 + 翻折片），而拼闭合体时
   * 最容易造出来的就是三点共线的面。所以这里与"多面体面数 / 顶点数不够"那一条说**同一件事**。
   */
  /**
   * **折片被画成共线三角面**（2026-10-19 稳定性复跑）。模型有时把 AEF 又平放成一张
   * 面片，三点共线；如果只让它“改坐标”，修复轮会继续微调。这里直接说结构：
   * 删掉面片，用 bound point E/F 建在宿主边上，再用 fold 折起来。
   */
  const degenerateFoldFace = errors.some((error) => error.code === "degenerate_face" && /共线|collinear/i.test(error.detail))
  if (degenerateFoldFace) {
    advice.push("提醒：这张三角面片的三个点共线。如果它就是折片 AEF，**删掉这张平放的面片**，改用 `dynamic.create_bound_point` 在宿主边 A–D / A–B 上建 E/F，再用 `solid.fold` 沿 EF 折出 P。不要继续微调这张面片的坐标。")
  }
  const duplicateFaceVertex = errors.some((error) => error.code === "degenerate_face" && /互异|distinct/i.test(error.detail))
  if (duplicateFaceVertex) {
    advice.push("提醒：这张面片的**顶点重复了**（同一个点出现两次，或两个顶点坐标重合）。`vertexNames` 与 `vertices` 必须**按下标一一对应且互不相同**；如果这是四边形 ABCD，就给四个不同顶点，不要用重复点凑数，也不要只改坐标继续试。")
  }
  const collapsedFace = errors.some((error) => /face ring/i.test(error.detail) && /zero area|collinear/i.test(error.detail))
  if (collapsedFace) {
    advice.push("提醒：有一只**面塌了**（三个点共线、面积为零）。要画**开放的**平面图形（四边形、三角形片、翻折片）就**不要**把它们拼成一只闭合多面体 —— 用 `solid.create_face` **一张一张**建（每张给 `vertices` 与 `vertexNames`，它不收 `faces`）。硬拼闭合体时，最容易造出来的就是三点共线的面。")
  }
  /**
   * **关系 / 题设核验没过**（2026-10-15 用户第三现场，四棱锥那道题）。
   *
   * 这一次**合同全过了**（信封、字段、名字都对），死在几何上：模型把顶点放在了**底面中心上方**，
   * 于是 `PD` 成了一条体对角线 —— 垂直残差 `0.81650 = √(2/3)`、`PD` 量出 `3.4641 = 2√3`
   *（`D=(0,0,0)`、`P=(2,2,2)` 给出的正是这两个数）。它**看得到**实测值（修复请求里带着），
   * 但"该怎么摆"没人告诉它，两次几何修复都没改对。
   *
   * 所以这条提醒不复述读数，而是说清**那句话的几何含义**：`棱 ⊥ 平面` 是"这条棱沿平面的法向"，
   * 长度条件由**坐标差**决定，两者一起才把点钉死。这是定义层面的澄清，不是替它算答案。
   */
  const relationFailed = errors.some((error) => error.code === "relation_not_satisfied" || error.code === "diagram_condition_failed")
  if (relationFailed) {
    advice.push("提醒：你给的坐标**不满足题面写下的关系**。`某条棱 ⊥ 平面` 的意思是那条棱**沿着平面的法向**：先把底面摆好（例如四个底面点都取同一个 `z`），再让那个顶点落在**垂足正上方** —— 顶点坐标 = 垂足 + 法向 × 棱长。**不要把顶点放在底面中心或别的顶点的正上方**（那会让这条棱变成斜线，残差与长度都不对）。`PD = 2` 这样的长度由两点的**坐标差**决定，与垂直关系**一起**才把这个点钉死；只满足其中一条，另一条就会实测出别的数。")
  }
  /**
   * **折的引用不在片上**（2026-10-15 用户现场，翻折那道题）—— 这一类错误此前**一条提示都没有**，
   * 而它恰恰是**约定**错误（不是几何算错）：现场读数「这片上有 `P、E、F`」说明模型把**折后**的
   * 名字写进了 `vertexNames`，而契约要的是**折前**的名字加 `apex`/`apexAs`。
   *
   * 提示分两半：① 这一笔的**约定**（折前名字、`apex` 是折前那个点、`apexAs` 是它折后叫什么、
   * 折痕两端也必须是这片上的点名）；② 这类题的**正确形状**（一张 `solid.create_face` 建折前的
   * 平面片 + 一笔 `solid.fold` 折它）—— 因为现场那两条错是**一起**出现的：模型在拼一只
   * "折后的闭合体"，于是既塌了面、又把折后的名字当成了片上的点名。
   */
  const foldReferenceMissing = errors.some((error) => error.code === "fold_reference_missing")
  if (foldReferenceMissing) {
    advice.push("提醒：`solid.fold` 的 `vertexNames` 要写**折前**的名字（平面上那个名字，例如 `A、E、F`），`apex` 是**折前**被带走的那个点（`A`）、`apexAs` 是它折后叫什么（`P`）；`hinge` 的两端也必须是这片上的点名。**不要把折后的名字（`P`）写进 `vertexNames`** —— 折后名字由 `apexAs` 一个字段交代，两者同时写会被当场拒。这类题的形状是：先用 `solid.create_face` 一张一张把**折前的平面片**建出来（带折前点名），再用 `solid.fold` 折它；**不要**去拼一只「折后的闭合体」。")
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
   *
   * **2026-10-10 扩到平面面片**：`solid.create_face` 同样产出带点名的自由坐标
   *（"平面四边形 + 翻折片"这类开放曲面的唯一表达方式），把它排除在外等于
   * "用面片画的图一律不核验"—— 那正是这条判据要防的事。
   */
  const hasVerifiableVertices = actions.some((action) => action.actionId === "solid.create_polyhedron" || action.actionId === "solid.create_face")
  if (!hasVerifiableVertices && (relations.length > 0 || /⊥|∥|垂直|平行/.test(prompt ?? ""))) {
    return [planDiagnostic("geometry_validation", "relation_not_checkable", "envelope.actions", `题目里读到了 ${relations.length} 条几何关系，但这份计划没有产出可核验的顶点（缺少 solid.create_polyhedron / solid.create_face），关系未被核验。`, "warning")]
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
