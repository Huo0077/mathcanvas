import type { ToolResult, ToolDiagnostic } from "../contracts"
import type { SceneEntitySummary, SceneObservation } from "../sceneObservation"

/**
 * **场景工具**（Task 2.4）。
 *
 * 计划原文："Read tools call observation services" 并且 Step 2 要求测
 * **ambiguous label resolution**、**missing source document**、**unsupported primitive/action responses**。
 *
 * 这一层很薄，但薄得有理由：它把 `SceneObservation`（Task 2.2 的纯观察层）包成
 * **带 `ToolResult` 信封的工具**，并且做三件观察层不该管的事：
 * 1. **把 `ambiguous_label` 变成一次"去问用户"**，而不是让模型自己挑一个；
 * 2. **把缺文档 / 缺实体转成 `next_actions`**，让模型知道下一步该做什么；
 * 3. **带上文档来源**（`documentId`）—— 平台有两份文档，答案不说清来自哪一份就没法用。
 */

export interface SceneTools {
  inspect(documentId: string, limit?: number): ToolResult<SceneEntitySummary[]>
  searchEntities(documentId: string, query: string, limit?: number): ToolResult<SceneEntitySummary[]>
  describeEntities(documentId: string, entityIds: string[]): ToolResult<unknown>
  dependencies(documentId: string, entityId: string): ToolResult<unknown>
  /** 标签 → 实体；重名时返回候选并让调用方去问用户。 */
  resolveLabel(documentId: string, label: string): ToolResult<SceneEntitySummary | null>
}

function diagnosticsFrom(detail: string, code: string): ToolDiagnostic[] {
  return [{ code, severity: "error", message: detail }]
}

export function createSceneTools(observation: SceneObservation): SceneTools {
  return {
    inspect(documentId, limit) {
      const outcome = observation.inspect(documentId, { limit })
      if (!outcome.ok) {
        return { status: "error", summary: `cannot inspect ${documentId}: ${outcome.reason}`, next_actions: ["check which documents this run is scoped to", "ask the user to reopen the document"], artifacts: [], payload: [], diagnostics: diagnosticsFrom(outcome.detail, outcome.reason) }
      }
      return { status: outcome.result.status, summary: outcome.result.summary, next_actions: [], artifacts: [], payload: outcome.result.payload, diagnostics: outcome.result.diagnostics }
    },

    searchEntities(documentId, query, limit) {
      const outcome = observation.search(documentId, query, { limit })
      if (!outcome.ok) {
        return { status: "error", summary: `cannot search ${documentId}: ${outcome.reason}`, next_actions: ["check which documents this run is scoped to"], artifacts: [], payload: [], diagnostics: diagnosticsFrom(outcome.detail, outcome.reason) }
      }
      return { status: outcome.result.status, summary: outcome.result.summary, next_actions: [], artifacts: [], payload: outcome.result.payload, diagnostics: outcome.result.diagnostics }
    },

    describeEntities(documentId, entityIds) {
      const outcome = observation.describe(documentId, entityIds)
      if (!outcome.ok) {
        return { status: "error", summary: `cannot describe the requested objects in ${documentId}`, next_actions: ["use scene.search_entities to find valid ids first"], artifacts: [], payload: [], diagnostics: diagnosticsFrom(outcome.detail, outcome.reason) }
      }
      return { status: outcome.result.status, summary: outcome.result.summary, next_actions: [], artifacts: [], payload: outcome.result.payload, diagnostics: outcome.result.diagnostics }
    },

    dependencies(documentId, entityId) {
      const outcome = observation.dependencies(documentId, entityId)
      if (!outcome.ok) {
        return { status: "error", summary: `cannot read dependencies of ${entityId}`, next_actions: ["use scene.search_entities to find valid ids first"], artifacts: [], payload: [], diagnostics: diagnosticsFrom(outcome.detail, outcome.reason) }
      }
      return { status: outcome.result.status, summary: outcome.result.summary, next_actions: [], artifacts: [], payload: outcome.result.payload, diagnostics: outcome.result.diagnostics }
    },

    resolveLabel(documentId, label) {
      const outcome = observation.resolveLabel(documentId, label)
      if (outcome.ok) {
        return { status: "success", summary: `${label} resolves to ${outcome.entity.entityId}`, next_actions: [], artifacts: [], payload: outcome.entity, diagnostics: [] }
      }
      if (outcome.reason === "ambiguous_label") {
        // **不猜**：把候选全列出来，让调用方去问用户。
        return {
          status: "warning",
          summary: `${label} matches ${outcome.candidates.length} objects in ${documentId}`,
          next_actions: ["ask the user which object they meant, or use an exact id"],
          artifacts: [],
          payload: null,
          diagnostics: [{ code: "ambiguous_label", severity: "warning", message: `${label} matches ${outcome.candidates.map((candidate) => candidate.entityId).join(", ")}` }]
        }
      }
      if (outcome.reason === "document_not_in_context" || outcome.reason === "stale_source") {
        return { status: "error", summary: `cannot resolve ${label}: ${outcome.reason}`, next_actions: ["check which documents this run is scoped to"], artifacts: [], payload: null, diagnostics: diagnosticsFrom(outcome.detail, outcome.reason) }
      }
      return { status: "error", summary: `no object matches ${label} in ${documentId}`, next_actions: ["use scene.search_entities to list what is there"], artifacts: [], payload: null, diagnostics: diagnosticsFrom(`no object matches ${label}`, "entity_not_found") }
    }
  }
}
