import type { PlanRequest } from "@draw/agent-core"
import type { GeometryDocument } from "@draw/dsl"

export type ToolPhase = "construct" | "observe"

export interface ToolPhaseInput {
  readonly intentMode: "ds_intent" | "ds_action" | "legacy_actions"
  readonly hasExistingGeometry: boolean
  readonly hasSelectedRefs: boolean
  readonly requiresSceneObservation: boolean
  readonly observationCompleted: boolean
}

export interface SceneToolContextSnapshot {
  readonly hasExistingGeometry: boolean
  readonly hasSelectedRefs: boolean
  readonly requiresSceneObservation: boolean
}

/** Pure document-level scene check (never inspects case IDs or prompt text). */
export function hasExistingGeometryInDocument(document: GeometryDocument | null | undefined): boolean {
  if (!document) return false
  return document.primitives.length > 0 || Object.keys(document.parameters ?? {}).length > 0
}

export function deriveSceneToolContextFromRequest(
  request: PlanRequest,
  hasReadTools: boolean,
  liveDocument?: GeometryDocument | null
): SceneToolContextSnapshot {
  const hasSelectedRefs = request.model.context.selectedRefs.length > 0
  const hasSources = request.model.context.handles.sources.length > 0
  const docHasGeometry = liveDocument !== undefined ? hasExistingGeometryInDocument(liveDocument) : false
  // Only treat context.facts as requiring a read-tool round when read tools exist in this turn or live document confirms geometry.
  const hasExistingGeometry = docHasGeometry || (hasReadTools && request.model.context.facts.length > 0)
  return {
    hasExistingGeometry,
    hasSelectedRefs,
    requiresSceneObservation: hasExistingGeometry || hasSelectedRefs || hasSources
  }
}

export function selectToolPhase(input: ToolPhaseInput): ToolPhase {
  if (input.intentMode === "legacy_actions") {
    return "construct"
  }
  const needsObservation =
    input.hasExistingGeometry || input.hasSelectedRefs || input.requiresSceneObservation
  if (needsObservation && !input.observationCompleted) {
    return "observe"
  }
  return "construct"
}

export function partitionPublishedTools<TPlan, TRead = TPlan>(input: {
  intentMode: "ds_intent" | "ds_action" | "legacy_actions"
  phase: ToolPhase
  planTool: TPlan
  readTools: readonly TRead[]
}): {
  readonly publishedTools: readonly (TPlan | TRead)[]
  readonly publishedReadTools: readonly TRead[]
  readonly canOfferPlan: boolean
} {
  if (input.intentMode === "legacy_actions") {
    return {
      publishedTools: [input.planTool, ...input.readTools],
      publishedReadTools: [...input.readTools],
      canOfferPlan: true
    }
  }
  if (input.phase === "observe") {
    return {
      publishedTools: [...input.readTools],
      publishedReadTools: [...input.readTools],
      canOfferPlan: false
    }
  }
  return {
    publishedTools: [input.planTool],
    publishedReadTools: [],
    canOfferPlan: true
  }
}
