import type { GeometryDocument } from "@draw/dsl"
import {
  canonicalContentHash,
  compilePlan,
  PLAN_SCHEMA_VERSION,
  type PlanDiagnostic,
  type PlanRelations
} from "@draw/agent-core"
import {
  createIdAllocator,
  type DocumentHandle,
  type DraftAction
} from "@draw/scene-graph"
import type { DraftStore, StageResult } from "./draftStore"

export interface SpeculativeCheckpoint {
  readonly stepIndex: number
  readonly candidateHash: string
  readonly candidateDocument: GeometryDocument
  readonly actionCount: number
  readonly primitiveCount: number
}

export interface SpeculativeSnapshot {
  readonly runId: string
  readonly stepIndex: number
  readonly baseHash: string
  readonly candidateHash: string
  readonly primitiveCount: number
  readonly actions: readonly DraftAction[]
  readonly historyHashes: readonly string[]
  readonly speculativeOnly: true
}

export type SpeculativeStepStatus = "accepted" | "repairable" | "blocked"

export interface SpeculativeStepResult {
  readonly ok: boolean
  readonly status: SpeculativeStepStatus
  readonly stepIndex: number
  readonly candidateHash: string
  readonly primitiveCount: number
  readonly diagnostics: readonly PlanDiagnostic[]
  readonly detail?: string
}

export interface SpeculativeCanvas {
  applyAction(
    action: DraftAction,
    options?: {
      readonly prompt?: string
      readonly relations?: PlanRelations
    }
  ): SpeculativeStepResult
  rollback(steps?: number): SpeculativeSnapshot
  revertToStep(targetStep: number): SpeculativeSnapshot
  discard(): SpeculativeSnapshot
  snapshot(): SpeculativeSnapshot
  currentDocument(): GeometryDocument
  promoteToDraftStore(
    draftStore: DraftStore,
    baseHandle?: DocumentHandle,
    options?: {
      readonly prompt?: string
      readonly relations?: PlanRelations
      readonly obligationIR?: boolean
      readonly witnessSearch?: boolean
      readonly proofExport?: boolean
      readonly enableCompleteCertificate?: boolean
      readonly selectedScopeId?: string
    }
  ): Promise<StageResult>
}

function classifyFailedStatus(diagnostics: readonly PlanDiagnostic[]): Exclude<SpeculativeStepStatus, "accepted"> {
  if (diagnostics.some((d) => d.code === "cyclic_dependency" || d.code === "cross_scope_violation")) {
    return "blocked"
  }
  return "repairable"
}

/**
 * Isolated exploratory workspace for step-by-step action execution and rollback.
 * Never mutates the caller's live document and never writes to MainCanvas/HostBridge.
 */
export function createSpeculativeCanvas(
  baseDocument: GeometryDocument,
  options: { readonly runId?: string; readonly maxSteps?: number } = {}
): SpeculativeCanvas {
  const runId = options.runId ?? "speculative-run"
  const maxSteps = options.maxSteps ?? 64
  const initialDoc = structuredClone(baseDocument) as GeometryDocument
  const initialHash = canonicalContentHash(initialDoc)

  let checkpoints: SpeculativeCheckpoint[] = [
    {
      stepIndex: 0,
      candidateHash: initialHash,
      candidateDocument: structuredClone(initialDoc) as GeometryDocument,
      actionCount: 0,
      primitiveCount: initialDoc.primitives.length
    }
  ]
  let stagedActions: DraftAction[] = []

  const snapshot = (): SpeculativeSnapshot => {
    const tip = checkpoints[checkpoints.length - 1]!
    return {
      runId,
      stepIndex: tip.stepIndex,
      baseHash: initialHash,
      candidateHash: tip.candidateHash,
      primitiveCount: tip.primitiveCount,
      actions: stagedActions.map((action) => structuredClone(action) as DraftAction),
      historyHashes: checkpoints.map((cp) => cp.candidateHash),
      speculativeOnly: true
    }
  }

  return {
    applyAction(action, stepOptions) {
      const currentTip = checkpoints[checkpoints.length - 1]!
      if (stagedActions.length >= maxSteps) {
        return {
          ok: false,
          status: "blocked",
          stepIndex: currentTip.stepIndex,
          candidateHash: currentTip.candidateHash,
          primitiveCount: currentTip.primitiveCount,
          diagnostics: [],
          detail: `speculative step cap (${maxSteps}) reached`
        }
      }

      const candidateActions = [...stagedActions, structuredClone(action) as DraftAction]
      const workingBase = structuredClone(initialDoc) as GeometryDocument
      const needs3dWorkspace = candidateActions.some(
        (act) => act.actionId.startsWith("solid.") || act.actionId.startsWith("derived.") || act.actionId.startsWith("section.")
      )
      if (needs3dWorkspace && workingBase.workspace !== "geometry3d") {
        workingBase.workspace = "geometry3d"
      }
      const allocator = createIdAllocator(workingBase.primitives.map((p) => p.id))
      const compiled = compilePlan(
        {
          schemaVersion: PLAN_SCHEMA_VERSION,
          kind: "plan",
          goal: `speculative step ${candidateActions.length}`,
          factIds: [],
          ...(stepOptions?.relations === undefined ? {} : { relations: stepOptions.relations }),
          actions: candidateActions
        },
        {
          document: workingBase,
          workspace: workingBase.workspace,
          capabilityRevision: "speculative",
          conversationId: runId,
          idAllocator: allocator,
          ...(stepOptions?.prompt === undefined ? {} : { prompt: stepOptions.prompt })
        }
      )

      if (!compiled.ok || compiled.draftDocument === null) {
        return {
          ok: false,
          status: classifyFailedStatus(compiled.diagnostics),
          stepIndex: currentTip.stepIndex,
          candidateHash: currentTip.candidateHash,
          primitiveCount: currentTip.primitiveCount,
          diagnostics: compiled.diagnostics,
          detail: compiled.diagnostics[0]?.detail ?? "speculative step compile failed"
        }
      }

      const nextDoc = structuredClone(compiled.draftDocument) as GeometryDocument
      const nextHash = canonicalContentHash(nextDoc)
      const nextStepIndex = currentTip.stepIndex + 1
      stagedActions = candidateActions
      checkpoints = [
        ...checkpoints,
        {
          stepIndex: nextStepIndex,
          candidateHash: nextHash,
          candidateDocument: nextDoc,
          actionCount: candidateActions.length,
          primitiveCount: nextDoc.primitives.length
        }
      ]
      return {
        ok: true,
        status: "accepted",
        stepIndex: nextStepIndex,
        candidateHash: nextHash,
        primitiveCount: nextDoc.primitives.length,
        diagnostics: compiled.diagnostics
      }
    },

    rollback(steps = 1) {
      const targetIndex = Math.max(0, checkpoints.length - 1 - Math.max(0, Math.trunc(steps)))
      checkpoints = checkpoints.slice(0, targetIndex + 1)
      const target = checkpoints[checkpoints.length - 1]!
      stagedActions = stagedActions.slice(0, target.actionCount)
      return snapshot()
    },

    revertToStep(targetStep) {
      const bounded = Math.max(0, Math.min(checkpoints.length - 1, Math.trunc(targetStep)))
      checkpoints = checkpoints.slice(0, bounded + 1)
      const target = checkpoints[checkpoints.length - 1]!
      stagedActions = stagedActions.slice(0, target.actionCount)
      return snapshot()
    },

    discard() {
      checkpoints = [checkpoints[0]!]
      stagedActions = []
      return snapshot()
    },

    snapshot,

    currentDocument() {
      return checkpoints[checkpoints.length - 1]!.candidateDocument
    },

    async promoteToDraftStore(draftStore, baseHandle, promoteOptions) {
      const draft = draftStore.create(structuredClone(initialDoc) as GeometryDocument, baseHandle)
      return draftStore.stage(
        draft.draftId,
        stagedActions.map((action) => structuredClone(action) as DraftAction),
        draft.draftVersion,
        promoteOptions?.prompt,
        promoteOptions?.relations,
        promoteOptions?.obligationIR,
        promoteOptions?.witnessSearch,
        promoteOptions?.proofExport,
        undefined,
        {
          ...(promoteOptions?.enableCompleteCertificate === undefined
            ? {}
            : { enableCompleteCertificate: promoteOptions.enableCompleteCertificate }),
          runId,
          ...(promoteOptions?.selectedScopeId === undefined ? {} : { selectedScopeId: promoteOptions.selectedScopeId })
        }
      )
    }
  }
}
