import type { DraftAction } from "@draw/scene-graph"

import type { DocumentHandle, ToolResult } from "../contracts"
import { compilePlan, type PlanCompileContext, type PlanCompileResult } from "../planCompiler"

/**
 * **草稿工具**（Task 2.4）。
 *
 * 计划原文的接口约定：
 * - "`draft.create`, `draft.stage_actions`, `draft.validate`, `draft.preview`, and `draft.discard`
 *   call only DraftStore/GeometryActionCompiler."
 * - "No tool function returns a fake `changed: true`; every write-like result references a draft
 *   artifact until Host consent."
 *
 * ## 两条纪律，逐条有测试
 *
 * 1. **这一层永远不说"文档改了"**：所有结果的 payload 里带的是**草稿工件**
 *   （草稿 id + 版本 + 预览哈希），不是新文档。真正写文档只有 `HostBridge.commit` 一条路，
 *   而那需要用户确认凭据。一个"看起来成功了"的 `changed: true` 会让协调器以为可以跳过确认 ——
 *   这正是计划点名要防的假成功。
 * 2. **失败要精确到原因与下一步**：动作层拒绝时把诊断原样带出来（`code` + `message`），
 *   并给出 `next_actions`（例如"换一个动作"或"先补一个来源"）。笼统的"失败了"会让模型反复试同一件事。
 *
 * 这一层**不 import `apps/web`**：草稿存储以接口注入（`DraftStorePort`），
 * 所以规则可在 agent-core 里单测，宿主接线属 Task 2.4 的后半。
 */

export interface DraftHandle {
  draftId: string
  draftVersion: number
  previewHash: string
}

/** 暂存可能失败的原因。与 G0.5 的 `DraftStore.StageReason` **逐字相同**（含 `unknown_draft`）。 */
export type DraftStageReason = "unknown_draft" | "stale_draft_version" | "compile_failed"

export interface DraftStageOutcome {
  ok: boolean
  /** 动作层/补丁层的原始诊断。 */
  diagnostics: { code: string; message: string }[]
  detail?: string
  handle?: DraftHandle
  /** 草稿被拒之后是否**原样未动**（版本与内容都没变）。 */
  unchanged: boolean
  /** 失败原因（成功时缺省）。与 G0.5 的 `DraftStore.StageReason` 同一套名字。 */
  reason?: DraftStageReason
}

export interface DraftPreflightOutcome {
  ok: boolean
  diagnostics: { code: string; message: string }[]
  detail?: string
}

/**
 * 宿主提供的草稿能力。与 G0.5 的 `DraftStore`（`apps/web/src/agent/draftStore.ts`）形状一致，
 * 但不直接依赖它 —— agent-core 不能依赖 app 包。
 */
export interface DraftStorePort {
  create(baseHandle: DocumentHandle): DraftHandle
  stage(draftId: string, actions: readonly DraftAction[], expectedDraftVersion: number): DraftStageOutcome
  /** 只校验不落草稿：用来回答"这批动作会不会被接受"。 */
  preflight(action: DraftAction[]): DraftPreflightOutcome
  discard(draftId: string): boolean
}

export type DraftToolName = "draft.create" | "draft.stage_actions" | "draft.validate" | "draft.preview" | "draft.discard" | "draft.compile_plan"

export interface DraftToolArtifact {
  kind: "draft"
  id: string
  draftVersion: number
  previewHash: string
}

/** 每个结果都带 `artifacts`，且**只**引用草稿工件 —— 计划要求"write-like result references a draft artifact"。 */
export type DraftToolResult<Payload> = ToolResult<Payload> & { artifacts: DraftToolArtifact[] }

export interface DraftTools {
  create(target: DocumentHandle): DraftToolResult<DraftHandle>
  stageActions(draftId: string, expectedDraftVersion: number, actions: readonly DraftAction[]): DraftToolResult<DraftHandle | null>
  validate(draftId: string, expectedDraftVersion: number, actions: readonly DraftAction[]): DraftToolResult<{ accepted: boolean }>
  preview(draftId: string, expectedDraftVersion: number, currentVersion: number): DraftToolResult<DraftHandle | null>
  discard(draftId: string): DraftToolResult<{ discarded: boolean }>
  /**
   * **把一份计划（不可信输入）编译成可暂存的动作**（Agent DSL 切片 Task 4）。
   *
   * 为什么它不属于 `DraftToolResult`：它**不产生草稿工件** —— 六层编译管线只回答
   * "这份计划能不能变成一批动作"，产出的是候选文档与诊断，落草稿是下一步。
   * 硬塞一个 `artifacts: [draft]` 进去，等于让"这份产物是哪一版草稿的"这句话变成假的。
   *
   * 失败时把**逐条诊断 + 一次性修复请求**一起交出去：调用方据此要么问用户
   *（`questions`），要么把修复请求发回模型（`repair`），而不是重发一遍。
   */
  compilePlan(plan: unknown, context: PlanCompileContext): ToolResult<PlanCompileResult>
}

function artifactOf(handle: DraftHandle): DraftToolArtifact {
  return { kind: "draft", id: handle.draftId, draftVersion: handle.draftVersion, previewHash: handle.previewHash }
}

function envelope<Payload>(status: ToolResult<Payload>["status"], summary: string, payload: Payload, artifacts: DraftToolArtifact[], diagnostics: ToolResult<Payload>["diagnostics"], nextActions: string[] = []): DraftToolResult<Payload> {
  return { status, summary, next_actions: nextActions, artifacts, payload, diagnostics }
}

/**
 * 草稿**版本**过旧 = 调用方拿的是上一轮看到的版本。
 *
 * 这必须被拒绝而不是"尽力合并"：合并等于把用户看过的预览悄悄换掉。
 */
function staleVersion(draftId: string, expected: number, current: number) {
  return { code: "stale_draft_version", severity: "warning" as const, message: `draft ${draftId} is at version ${current}, not ${expected}; re-read the preview before staging` }
}

export function createDraftTools(drafts: DraftStorePort): DraftTools {
  return {
    create(target) {
      const handle = drafts.create(target)
      return envelope("success", `created draft ${handle.draftId} v${handle.draftVersion}`, handle, [artifactOf(handle)], [])
    },

    stageActions(draftId, expectedDraftVersion, actions) {
      if (actions.length === 0) {
        return envelope("warning", "no actions to stage", null, [], [{ code: "empty_batch", severity: "warning", message: "a stage request needs at least one action" }], ["provide at least one action"])
      }

      const outcome = drafts.stage(draftId, actions, expectedDraftVersion)
      if (!outcome.ok) {
        const diagnostics = outcome.diagnostics.length > 0
          ? outcome.diagnostics.map((entry) => ({ code: entry.code, severity: "error" as const, message: entry.message }))
          : [{ code: "stage_failed", severity: "error" as const, message: outcome.detail ?? "the compiler refused the batch" }]

        // 失败时**必须**如实说明草稿没被动过 —— 否则模型会以为"部分生效了"而继续往上叠动作。
        const unchangedDiagnostic = outcome.unchanged
          ? []
          : [{ code: "draft_mutated_on_failure", severity: "error" as const, message: "the draft changed even though staging failed" }]

        return envelope("error", `staging was refused: ${diagnostics[0].message}`, null, [], [...diagnostics, ...unchangedDiagnostic], ["adjust the action or the referenced objects, then stage again"])
      }

      const handle = outcome.handle ?? { draftId, draftVersion: expectedDraftVersion, previewHash: "" }
      return envelope("success", `draft ${draftId} is now at v${handle.draftVersion}`, handle, [artifactOf(handle)], [])
    },

    validate(draftId, expectedDraftVersion, actions) {
      const outcome = drafts.preflight([...actions])
      void draftId
      void expectedDraftVersion
      if (!outcome.ok) {
        return envelope("error", `the batch would be refused: ${outcome.detail ?? outcome.diagnostics[0]?.message ?? "unknown"}`, { accepted: false },
          [], outcome.diagnostics.map((entry) => ({ code: entry.code, severity: "error" as const, message: entry.message })), ["change the actions so the compiler accepts them"])
      }
      return envelope("success", "the batch would be accepted", { accepted: true }, [], [])
    },

    preview(draftId, expectedDraftVersion, currentVersion) {
      if (expectedDraftVersion !== currentVersion) {
        return envelope("warning", `draft ${draftId} moved to v${currentVersion}`, null, [], [staleVersion(draftId, expectedDraftVersion, currentVersion)], ["re-read the draft preview"])
      }
      return envelope("success", `draft ${draftId} v${currentVersion} is current`, { draftId, draftVersion: currentVersion, previewHash: "" }, [], [])
    },

    discard(draftId) {
      const discarded = drafts.discard(draftId)
      return envelope(discarded ? "success" : "warning", discarded ? `discarded draft ${draftId}` : `draft ${draftId} was already gone`, { discarded }, [], discarded ? [] : [{ code: "unknown_draft", severity: "warning", message: `no draft ${draftId}` }])
    },

    /**
     * 六层编译管线（`planCompiler.compilePlan`）。返回值里没有草稿工件：
     * 编译**只产出候选文档**，落草稿是 `stageActions` 的事。
     *
     * 失败时的 `next_actions` 按**失败类型**给：能问用户就给"问用户"，
     * 只有模型能改的（字段格式）才给"按修复请求重发一次"。
     */
    compilePlan(plan, context) {
      const result = compilePlan(plan, context)
      if (result.ok) {
        return {
          status: "success",
          summary: `compiled ${result.actions.length} action(s) into an isolated draft`,
          next_actions: ["stage the compiled actions"],
          artifacts: [],
          payload: result,
          diagnostics: result.diagnostics.map((entry) => ({ code: entry.code, severity: entry.severity, message: `${entry.path}: ${entry.detail}` }))
        }
      }
      const blockingQuestions = result.questions.length > 0
      return {
        status: "error",
        summary: blockingQuestions
          ? `the plan needs more information: ${result.questions[0].text}`
          : `the plan was refused: ${result.diagnostics.find((entry) => entry.severity === "error")?.code ?? "unknown"}`,
        next_actions: blockingQuestions ? ["ask the user the clarification question"] : ["send one repair request built from `repair`"],
        artifacts: [],
        payload: result,
        diagnostics: result.diagnostics.map((entry) => ({ code: entry.code, severity: entry.severity, message: `${entry.path}: ${entry.detail}` })),
        ...(blockingQuestions ? {} : { recovery: { rootCauseHint: "the plan did not match the action contract", safeRetry: "revise_input" as const, stopCondition: "one repair attempt" } })
      }
    }
  }
}
