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
