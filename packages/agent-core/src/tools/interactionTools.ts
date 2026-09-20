import type { ToolResult } from "../contracts"

/**
 * **交互工具**（Task 2.4 的 `interaction.*`）。
 *
 * 计划原文：
 * - "`interaction.ask_clarification` transitions the run to `waiting_input`"
 * - "`interaction.propose_view` calls ViewService after UI policy"
 * - "`interaction.propose_export` calls ExportPlan preflight"
 *
 * ## 这一层的共同点：它们都**只提议，不执行**
 *
 * 三个工具没有一个会改文档或直接产出文件。`ask_clarification` 把运行交给用户回答、
 * `propose_view` 只建议视角（改不改由 UI 策略决定）、`propose_export` 只把预检结论摆出来。
 * 计划那句 "No tool function returns a fake `changed: true`" 在这里同样是硬约束。
 *
 * ## `propose_export` 为什么**消费**预检而不是自己算
 *
 * 导出预检（`apps/web/src/services/exportService.ts` 的 `buildExportPlan`）已经完整实现了
 * "哪些来源会被略过 / 哪些字会被写坏 / 哪些格式被阻止"，而且它才是导出时**真正**会用的那份。
 * 在这里再算一遍的结果必然是**建议与执行不一致** —— 用户按 Agent 的说法确认，拿到的文件却不是那样。
 * 所以工具收的是预检结果，只负责把它**如实且有限地**讲给模型。
 */

export interface ExportPreflightSummary {
  format: string
  supported: boolean
  requiresUserAcceptance: boolean
  omitted: { sourceId: string; kind: string; reason: string }[]
  fontLoss: { original: string; substituted: string; reason: string }[]
  approximationNotes: string[]
  blockedReasons: string[]
  projectedEntityCount: number
}

export interface ExportPreflightPort {
  /** 调用**真实**的导出预检。 */
  preflight(input: { format: "svg" | "dxf" | "pdf" | "png" }): ExportPreflightSummary | { error: string }
}

export interface ExportProposal {
  format: string
  /** 预检是否允许产出文件。 */
  supported: boolean
  /** 必须由用户接受损失才能导出。 */
  requiresUserAcceptance: boolean
  /** 会写进文件的图元数量。 */
  objectCount: number
  /** 有界的三类损失说明。 */
  losses: { omitted: ExportPreflightSummary["omitted"]; fontLoss: ExportPreflightSummary["fontLoss"]; approximationNotes: string[] }
  /** 预检阻止导出的原因（例如 3D 场景没有直接 PNG）。 */
  blockedReasons: string[]
}

export interface InteractionTools {
  proposeExport(format: "svg" | "dxf" | "pdf" | "png"): ToolResult<ExportProposal | null>
  askClarification(question: string): ToolResult<{ question: string } | null>
  /** 视角建议：只提议，改不改由 UI 策略决定。 */
  proposeView(view: string): ToolResult<{ view: string } | null>
}

/** 单次提议里最多列几条损失 —— 提议不该把整份预检倒进上下文。 */
export const MAX_PROPOSED_LOSSES = 6

function bounded<T>(entries: readonly T[]): { entries: T[]; truncated: boolean } {
  return entries.length <= MAX_PROPOSED_LOSSES
    ? { entries: [...entries], truncated: false }
    : { entries: entries.slice(0, MAX_PROPOSED_LOSSES), truncated: true }
}

export function createInteractionTools(preflight: ExportPreflightPort): InteractionTools {
  return {
    proposeExport(format) {
      const outcome = preflight.preflight({ format })
      if ("error" in outcome) {
        // 预检自己失败（例如没有可投影的来源）：如实报错，**不要**给一个"看起来能导出"的提议。
        return {
          status: "error",
          summary: `cannot plan a ${format.toUpperCase()} export: ${outcome.error}`,
          next_actions: ["check that the target document has something to export", "ask the user which source to project"],
          artifacts: [],
          payload: null,
          diagnostics: [{ code: "export_preflight_failed", severity: "error", message: outcome.error }],
          recovery: { rootCauseHint: outcome.error, safeRetry: "refresh_context", stopCondition: "the target document still has nothing exportable" }
        }
      }

      const omitted = bounded(outcome.omitted)
      const fontLoss = bounded(outcome.fontLoss)
      const approximationNotes = bounded(outcome.approximationNotes)
      const truncated = omitted.truncated || fontLoss.truncated || approximationNotes.truncated

      const proposal: ExportProposal = {
        format: outcome.format,
        supported: outcome.supported,
        requiresUserAcceptance: outcome.requiresUserAcceptance,
        objectCount: outcome.projectedEntityCount,
        losses: { omitted: omitted.entries, fontLoss: fontLoss.entries, approximationNotes: approximationNotes.entries },
        blockedReasons: outcome.blockedReasons
      }

      const diagnostics: ToolResult<ExportProposal>["diagnostics"] = []
      if (truncated) diagnostics.push({ code: "truncated_losses", severity: "warning", message: `only the first ${MAX_PROPOSED_LOSSES} losses of each kind are listed` })
      if (outcome.requiresUserAcceptance) diagnostics.push({ code: "needs_acceptance", severity: "warning", message: "this export loses information or is blocked; the user must accept it explicitly" })

      // 有阻止项 → 不能导出（`supported: false`）；有损失但没阻止 → 需要用户接受。
      const status: ToolResult<ExportProposal>["status"] = outcome.supported ? (outcome.requiresUserAcceptance ? "warning" : "success") : "error"
      const nextActions = outcome.supported
        ? outcome.requiresUserAcceptance
          ? ["tell the user exactly what will be lost, then wait for acceptance"]
          : []
        : ["report the blocking reason to the user", "suggest a format that is supported"]

      return {
        status,
        summary: outcome.supported
          ? `a ${outcome.format.toUpperCase()} export would contain ${outcome.projectedEntityCount} object(s)`
          : `a ${outcome.format.toUpperCase()} export is blocked`,
        next_actions: nextActions,
        artifacts: [],
        payload: proposal,
        diagnostics: outcome.blockedReasons.length > 0
          ? [...diagnostics, ...outcome.blockedReasons.map((reason) => ({ code: "export_blocked", severity: "error" as const, message: reason }))]
          : diagnostics
      }
    },

    askClarification(question) {
      const trimmed = question.trim()
      if (trimmed.length === 0) {
        return { status: "error", summary: "a clarification needs an actual question", next_actions: ["ask a specific question"], artifacts: [], payload: null, diagnostics: [{ code: "empty_question", severity: "error", message: "the question was empty" }] }
      }
      // 这个工具的作用是把运行交给用户，而不是自己猜一个答案。
      return { status: "success", summary: `waiting for the user: ${trimmed}`, next_actions: ["wait for the user's answer before staging anything"], artifacts: [], payload: { question: trimmed }, diagnostics: [] }
    },

    proposeView(view) {
      const trimmed = view.trim()
      if (trimmed.length === 0) {
        return { status: "error", summary: "a view proposal needs a view", next_actions: ["name a view or an angle"], artifacts: [], payload: null, diagnostics: [{ code: "empty_view", severity: "error", message: "the view was empty" }] }
      }
      // 只提议。是否采纳由 UI 策略决定 —— 在这里改视角会让"用户没要求"的视图变化发生。
      return { status: "success", summary: `proposing the ${trimmed} view`, next_actions: ["let the user accept the view change"], artifacts: [], payload: { view: trimmed }, diagnostics: [] }
    }
  }
}
