/**
 * Agent 的**传输契约**（设计规格 §6「核心数据契约」+ 附录 A「计划与动作的协议示例」）。
 *
 * 这份文件只放**类型与常量**；运行时校验在 `schemas.ts`（`parsePlanEnvelope` / `parseDraftAction`）。
 * 计划的分工是"单一来源生成 TS 校验与 Rust 传输类型"——TS 侧就是这两个文件的组合。
 */

export type RunId = string
export type DraftId = string
export type ProfileId = string

/** 计划里 Agent 只面向这三个工作区（`calculus` 已退役，不进 Agent 面）。 */
export type WorkspaceId = "conics" | "geometry3d" | "cad"

/**
 * 一份文档的句柄。
 *
 * `generation` **单调递增（含撤销/重做）**：否则"撤销回旧内容"会让旧授权复活（ABA）。
 * 导入/替换产生新 `epoch`；`contentHash` 只看影响语义的内容（见 `canonicalContentHash`）。
 */
export interface DocumentHandle {
  projectId: string
  documentId: string
  workspace: WorkspaceId
  epoch: string
  generation: number
  contentHash: string
}

/** **必须带 documentId**：名称不是 ID；跨文档对象只能作为已授权读取来源。 */
export interface EntityRef {
  documentId: string
  entityId: string
}

/** 工程制图类能力的来源上下文：图纸文档 + 几何文档（+ 可选视图）。 */
export interface SourceContext {
  layout: DocumentHandle
  geometry: DocumentHandle
  viewId?: string
}

export interface RunContext {
  runId: RunId
  conversationId: string
  promptMessageId: string
  target: DocumentHandle
  sources: SourceContext[]
  textProfileId: ProfileId
  visionProfileId?: ProfileId
  capabilityRevision: string
  policyRevision: string
}

// ---------------------------------------------------------------- 会话上下文（规格 §5）

/**
 * **这一轮绑到哪条会话、哪份文档的第几版**（规格 §5.1/§5.4）。
 *
 * 为什么 `workspace` 与 `generation` 也在里面：一次运行要么整体属于某个会话的某个版本，
 * 要么整轮作废。少了 `generation`，"模型看到的是哪一版"与"用户确认的是哪一版"就对不上；
 * 少了 `workspace`，跨工作区的引用就没有可判定的边界。
 */
export interface ConversationBinding {
  conversationId: string
  projectId: string
  documentId: string
  workspace: WorkspaceId
  generation: number
}

/** 进规划上下文的一条消息：**只含已经说过的话**（在途状态与草稿视图都不在这里）。 */
export interface ConversationMessageView {
  id: string
  role: "user" | "assistant"
  text: string
  createdAt: number
}

/**
 * 一条会话事实的四种状态。
 *
 * 前三种与 SQLite 那一侧逐字一致（`confirmed` / `stale` / `retracted`）；
 * `draft` 是**界面侧的临时态**：未确认的草稿只能停在这里，**永远不许**变成 `confirmed`
 *（规格 §1.2"未确认草稿不得进入长期会话记忆"、§10"摘要模型不能直接升级确认事实"）。
 */
export type ConversationFactStatus = "confirmed" | "stale" | "retracted" | "draft"

/** 进规划上下文的一条事实。只有 `status === "confirmed"` 会被当作事实交给模型。 */
export interface ConversationFactView {
  id: string
  key: string
  /** 人话一句；会原样进提示词。 */
  text: string
  status: ConversationFactStatus
  /**
   * **这条事实是在哪份文档上确认的**（规格 §5.1）。
   *
   * 会话的事实表是**会话级**的，而这个应用里换工作区就是换文档 —— 少了这一项，
   * 在立体几何里确认的"第 3 版新增 solid-1"会出现在平面几何那一轮的提示词里，
   * 而那份文档里根本没有这个对象（§9 门点名的"会话之间不串事实"）。
   * 可选：旧数据没有这一项，按"未知"处理（保留并留一条警告，不静默丢）。
   */
  documentId?: string
}

export type SafeRetry = "none" | "same_request" | "refresh_context" | "revise_input"

export interface Recovery {
  rootCauseHint: string
  safeRetry: SafeRetry
  stopCondition: string
}

export type ToolResultStatus = "success" | "warning" | "error"

export interface ToolArtifact {
  kind: "entity" | "draft" | "image" | "export"
  id: string
}

export interface ToolDiagnostic {
  code: string
  severity: "info" | "warning" | "error"
  message: string
}

/** 每个工具结果都必须自带 `status` / `summary` / `next_actions` / `artifacts` / `diagnostics`。 */
export interface ToolResult<Payload> {
  status: ToolResultStatus
  summary: string
  next_actions: string[]
  artifacts: ToolArtifact[]
  payload: Payload
  diagnostics: ToolDiagnostic[]
  recovery?: Recovery
}

/** 协议版本号。PlanEnvelope 顶层严格包含 `schemaVersion`。 */
export const PLAN_SCHEMA_VERSION = "mathcanvas.plan.v1"

export type PlanKind = "plan" | "clarification" | "answer"

/** 新对象的内部引用；`inputs.alias` 定义它。 */
export interface DraftScopeRef {
  scope: "draft"
  alias: string
}

/** 既有对象的引用；**不带 raw 文档内容或权限 token**。 */
export interface SceneScopeRef {
  scope: "scene"
  ref: EntityRef
}

export type ScopedReference = DraftScopeRef | SceneScopeRef

/**
 * 计划与动作的协议里用的动作类型。
 *
 * **刻意复用动作层的 `DraftAction`，而不是在这里再定义一个"长得一样"的接口。**
 *
 * 第一版这里有一份自己的 `DraftAction`（`inputs: Record<string, unknown>`）。后果是
 * `PlanEnvelope.actions` 的类型与编译器要的类型**不是同一个东西**，于是接线时
 * "解析出来的动作传不进 `commitTransaction`"，只能在中间加一层无意义的转换 ——
 * 而任何转换都意味着"有一处可以悄悄改字段"。
 *
 * 运行时仍然严格校验（`parseDraftAction` 逐字段构造，绝不做断言），所以复用类型
 * 不会削弱不可信输入的处理：**形状必须由校验产生，而不是由断言声称**。
 */
export type { DraftAction } from "@draw/scene-graph"
import type { DraftAction } from "@draw/scene-graph"

/**
 * **规划器替你做的假设**（人话，每条一句），例如"把「直径 6」读作半径 3"。
 *
 * 为什么它在**信封**上，而不是由界面从计划里猜：
 * 一个自然语言计划必然包含"我替你定了"的部分（半径、边长、取哪个分支）。这些不是错误，
 * 但用户必须**看见**它们才能谈得上确认 —— 否则他确认的是一件自己没看过的事。
 * 界面（`AssumptionList` / `ConfirmationPanel`）与宿主共用这一份声明，不许各写一套。
 *
 * 可选：不声明假设与"没有假设"是同一件事（`undefined`），**不要**用空数组表示
 * "我检查过、确实没有" —— 那两句话的语义不同，而线上只能承载一种。
 */
export type EnvelopeAssumptions = string[]

export type PlanEnvelope =
  | { schemaVersion: string; kind: "plan"; goal: string; factIds: string[]; assumptions?: EnvelopeAssumptions; actions: DraftAction[] }
  | { schemaVersion: string; kind: "clarification"; goal: string; factIds: string[]; assumptions?: EnvelopeAssumptions; questions: string[] }
  | { schemaVersion: string; kind: "answer"; goal: string; factIds: string[]; assumptions?: EnvelopeAssumptions; answer: string; toolResultRefs: string[] }

export interface ParseError {
  code: string
  path: string
  detail: string
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: ParseError[] }

// ---------------------------------------------------------------- 参数审计的公共词汇（规格 §6.2/§6.3）

/**
 * **字段缺失时怎么办**（规格 §6.3 的四档）。
 *
 * 四档必须分开，因为"回填一个安全默认"与"逼用户回答"在用户看来是两件事：
 * - `given`：字段已经给了（审计只需要原样保留，**绝不覆盖显式约束**）；
 * - `safe_default`：有公认的默认，回填之后必须**写进 `assumptions`**（不能静默发生）；
 * - `infer_from_facts`：能从已确认事实/用户原话里读出来（"棱长 3" → size 3）；
 * - `ask_user`：没有安全默认 → `clarification`（**不是**失败：问用户比编一个数好）；
 * - `reject`：连问都不该问（例如"把散面拼成 Prism"）→ 直接拒绝。
 */
export type PlanDefaultPolicy = "given" | "safe_default" | "infer_from_facts" | "ask_user" | "reject"

/**
 * **结构化假设**（审计/补全的产出）。
 *
 * 信封上的 `assumptions` 仍然是 `string[]`（界面与宿主共用那一份，见 `EnvelopeAssumptions`），
 * 而这个结构多带三样东西：这条假设**改的是哪个字段**（`kind` + `value`）、
 * 用户**能不能覆盖**它（`overridable`）。三者都是"用户看到这句话之后要做什么"必须的，
 * 而它们无法从一句人话里可靠地反推出来。
 */
export interface StructuredAssumption {
  id: string
  /** 会进 `EnvelopeAssumptions` 的那句话（人话，一句）。 */
  text: string
  kind: "safe_default" | "inferred" | "witness" | "symbolic"
  /** 被定下来的值（可 JSON 序列化）。 */
  value: unknown
  /** 用户改口之后能不能覆盖（默认特值可以；"题目要求恒定"这类不可以）。 */
  overridable: boolean
  /** 这条假设落在哪个字段（`envelope.actions[2].inputs.parameter`）。 */
  path?: string
}

/** **结构化澄清问题**：问题 + 为什么必须问 + 缺的是哪个字段。 */
export interface ClarificationQuestion {
  id: string
  text: string
  /** 为什么不能替用户定（例如"平面无穷多，挑一个等于换了一道题"）。 */
  reason: string
  /** 缺失字段的路径；有它才能把回答精确写回计划。 */
  path?: string
}

/** 逐条字段错误：**路径 + 原因码**，供一次性修复使用。 */
export interface RepairFieldError {
  code: string
  path: string
  detail: string
}

/**
 * **一次性修复请求**（规格 §7 + 计划 Task 4）。
 *
 * 只带三样东西：`reason` / `errors`（路径 + 原因）/ `allowedChanges`（允许改哪几处）。
 * **刻意不带模型上一轮的原话**：回显会把它的散文再送回去，形成自我强化的循环；
 * 而"允许改哪几处"是从错误路径算出来的，所以第二次尝试不必重新描述整个合同。
 */
export interface RepairRequest {
  reason: string
  errors: RepairFieldError[]
  allowedChanges: string[]
  /** 第几次修复（从 1 开始）；`MAX_REPAIR_ATTEMPTS` 之外不再给机会。 */
  attempt: number
}

/** 修复只给**一次**（计划 Global Constraints："Repair is limited to one request"）。 */
export const MAX_REPAIR_ATTEMPTS = 1

/**
 * **这份计划是怎么被验证的**（规格 §8.2/§10）。
 *
 * "数值采样验证"与"形式证明"必须能分开：把它们合并成一句"已验证"，
 * 就是在把采样说成证明 —— 规格 §10 明令不许。所以这是一个判别联合，
 * 而不是一个布尔值加一句描述。
 */
export type PlanVerification =
  | { kind: "formal"; detail: string }
  | { kind: "numeric_sampling"; detail: string }

/**
 * **六层编译的层名**（规格 §6.2）。
 *
 * 每一层都必须能被指名：一条诊断只说"计划不成立"是没用的，用户与模型都要知道
 * **卡在哪一层**（传输解析 / 字段审计 / 引用解析 / 参数补全 / 几何语义校验 / 动作编译）。
 */
export type PlanStage = "transport" | "field_audit" | "reference_resolution" | "parameter_completion" | "geometry_validation" | "action_compile"

/** 一条编译诊断：**层 + 原因码 + 字段路径**（路径不是装饰：一次性修复只允许改这几处）。 */
export interface PlanDiagnostic {
  stage: PlanStage
  code: string
  /** 字段路径（`envelope.actions[2].inputs.parameter`）。 */
  path: string
  detail: string
  severity: "info" | "warning" | "error"
}

/** 只保留错误级诊断（给修复请求与界面用）。 */
export function errorDiagnostics(diagnostics: readonly PlanDiagnostic[]): PlanDiagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.severity === "error")
}
