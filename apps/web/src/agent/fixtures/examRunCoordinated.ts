import {
  classifyDsFailureBoundary, createBudget, errorDiagnostics, examTrialVerdictOf, parsePlanEnvelope,
  type Budget, type CommitterPort, type DsFailureBoundary, type ExamCase, type ExamRunBudget, type ExamRunCaseResult,
  type PlanOutcome, type RunEvent, type WorkspaceId
} from "@draw/agent-core"
import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { contentFingerprint } from "@draw/scene-graph"

import { createAgentRuntime } from "../agentRuntime"
import { MODEL_PLANNER_SKILL_IDS, planWorkspaceFor } from "../agentRunner"
import { planRequestFor } from "./benchmarkPlanningEval"
import { budgetWithProviderRequestCap } from "./examRequestBudget"
import { workspaceForFamily, type ExamRunAdapterDeps } from "./examRunContracts"
import {
  createG3CaseTrace,
  recordBoundary,
  withCandidateHash,
  type G3CaseTrace
} from "./g3DsCaseTrace"
import { planOf } from "@draw/agent-core"

type StageOutcome = Awaited<ReturnType<CommitterPort["stage"]>>

export interface CoordinatedExamRunDeps extends ExamRunAdapterDeps {
  readonly revision?: string
  readonly onTrace?: (trace: G3CaseTrace) => void
}

/** Runs the real product runtime on isolated documents. Never grants consent or commits. */
export function createCoordinatedExamRunCase(deps: CoordinatedExamRunDeps): (examCase: ExamCase, trial: number, budget?: ExamRunBudget) => Promise<ExamRunCaseResult> {
  const now = deps.now ?? (() => Date.now())
  return async (examCase, trial, outer?: ExamRunBudget): Promise<ExamRunCaseResult> => {
    const started = now()
    const runId = `exam-${examCase.id}-${trial}`
    let trace = createG3CaseTrace({
      caseId: examCase.id,
      runId,
      revision: deps.revision ?? "local-working-tree"
    })
    let workspace = deps.workspaceOf?.(examCase) ?? workspaceForFamily(examCase.family)
    const documents = new Map<WorkspaceId, GeometryDocument>()
    const current = () => {
      let document = documents.get(workspace)
      if (!document) { document = createEmptyDocument(workspace); documents.set(workspace, document) }
      return document
    }
    const publicInput = {
      id: examCase.id,
      prompt: examCase.prompt,
      workspace
    }
    const initial = planRequestFor(publicInput.prompt, publicInput.workspace, runId, current())
    const capped = outer === undefined ? undefined : budgetWithProviderRequestCap(createBudget(), outer)
    const inner = capped ?? createBudget()
    let budgetDenied = false
    const budget: Budget = {
      ...inner,
      consume(kind, amount) {
        const decision = inner.consume(kind, amount)
        if (!decision.ok) budgetDenied = true
        return decision
      },
      consumeAll(items) {
        const decision = inner.consumeAll(items)
        if (!decision.ok) budgetDenied = true
        return decision
      }
    }
    const attempts: PlanOutcome[] = []
    let plannerError: unknown = null
    let lastStage: StageOutcome | undefined
    const runtime = createAgentRuntime({
      readDocument: current,
      // A benchmark must never apply a preview, even accidentally.
      writeDocument: () => { throw new Error("exam runtime cannot commit a user document") },
      readSceneDocuments: () => {
        const document = current()
        return [{ handle: { ...initial.run.target, documentId: document.metadata.id, workspace, epoch: `epoch:${document.metadata.id}`, generation: document.revision, contentHash: contentFingerprint(document) }, document }]
      },
      planner: { async plan(request) {
        lastStage = undefined
        try {
          const outcome = await deps.planner.plan({ ...request, ...(capped === undefined ? {} : { beforeProviderRequest: capped.beforeProviderRequest }) })
          attempts.push(outcome)
          return outcome
        } catch (error) { plannerError = error; throw error }
      } },
      budget,
      onStageOutcome: (outcome) => { lastStage = outcome },
      requestedSkillIds: MODEL_PLANNER_SKILL_IDS,
      projectId: initial.run.target.projectId,
      runId,
      conversationId: runId,
      ...(deps.geometryWorkerFactory === undefined ? {} : { geometryWorkerFactory: deps.geometryWorkerFactory }),
      // Keep benchmark runs reproducible: do not inherit a user's experimental preferences.
      agentNextPhaseFlags: { obligationIR: deps.compileFlags?.diagramObligationIR ?? false, witnessSearch: deps.compileFlags?.diagramWitnessSearch ?? false, constrainedDrag: false, openProblemCompiler: false, proofExport: false },
      exportPreflight: { preflight: () => ({ error: "export is not measured by this exam adapter" }) },
      prepare(plan) {
        const target = planWorkspaceFor(plan) ?? workspace
        const switched = target !== workspace
        workspace = target
        current()
        return { ok: true, switched }
      }
    })
    const events: RunEvent[] = []
    for await (const event of runtime.coordinator.start({ run: initial.run, userMessage: examCase.prompt })) events.push(event)
    const outcome = attempts.at(-1) ?? null
    const parsed = outcome === null ? null : parsePlanEnvelope(planOf(outcome))
    const detail = events.at(-1)?.detail ?? "coordinator produced no terminal event"
    let verdict: Pick<ExamRunCaseResult, "outcome" | "failureLayer">
    if (plannerError !== null || budgetDenied) {
      verdict = { outcome: "error" }
      trace = recordBoundary(trace, { boundary: "provider", code: budgetDenied ? "budget_denied" : "planner_error" })
    } else if (parsed === null) {
      verdict = { outcome: "error" }
      trace = recordBoundary(trace, { boundary: "schema", code: "missing_plan_outcome" })
    } else if (!parsed.ok) {
      verdict = { outcome: "rejected", failureLayer: "schema" }
      trace = recordBoundary(trace, { boundary: "schema", code: "plan_envelope_invalid" })
    } else if (parsed.value.kind !== "plan") {
      verdict = examTrialVerdictOf({ kind: parsed.value.kind })
      if (verdict.outcome === "rejected") {
        trace = recordBoundary(trace, { boundary: "stage", code: `non_plan_${parsed.value.kind}` })
      }
    } else if (runtime.coordinator.phase() === "waiting") {
      verdict = { outcome: "rejected", failureLayer: "plan" }
      trace = recordBoundary(trace, { boundary: "stage", code: "stalled_waiting" })
    } else if (lastStage !== undefined && !lastStage.ok) {
      const stages = errorDiagnostics(lastStage.planDiagnostics ?? []).map((entry) => entry.stage)
      verdict = examTrialVerdictOf({ kind: "plan", compile: { accepted: false, errorStages: stages } })
      trace = recordBoundary(trace, { boundary: "stage", code: stages[0] ? `stage_${stages[0]}` : "stage_rejected" })
    } else if (lastStage?.ok) {
      const id = runtime.draftId()
      const preview = id === null ? null : runtime.drafts.getPreview(id)
      const certHash = preview?.drawingCertificate?.candidateHash
      if (certHash) trace = withCandidateHash(trace, certHash)
      verdict = examTrialVerdictOf({ kind: "plan", repaired: attempts.length > 1,
        compile: { accepted: true, errorStages: [], ...(preview?.diagramVerification === undefined ? {} : { verification: preview.diagramVerification.status }) }
      })
      if (preview?.diagramVerification && preview.diagramVerification.status !== "passed") {
        trace = recordBoundary(trace, { boundary: "verification", code: `verification_${preview.diagramVerification.status}` })
      }
      // Passing compilation alone is never evidence of passing the product confirmation gate.
      if (verdict.outcome !== "rejected" && runtime.coordinator.phase() !== "awaiting_confirmation") {
        verdict = { outcome: "error" }
        trace = recordBoundary(trace, { boundary: "stage", code: "not_awaiting_confirmation" })
      }
    } else {
      verdict = { outcome: "error" }
      trace = recordBoundary(trace, { boundary: "stage", code: "no_stage_outcome" })
    }
    const costError = plannerError ?? (budgetDenied ? new Error(detail) : null)
    const result = { ...verdict, costUsd: deps.costOf({ examCase, trial, outcome, error: costError, attempts }), latencyMs: now() - started, detail }
    deps.onTrace?.(trace)
    runtime.discardDraft()
    return result
  }
}

/** Diagnostic boundary helper reusing agent-core classification without altering grading outcomes. */
export function classifyCoordinatedRunBoundary(input: {
  terminal: string
  requests: number
  passed: boolean
  primitiveCount: number
  verificationStatus: string | null
  certificateStatus: string | null
  contractStatus: string
  objectCoverage: number
  obligationCoverage: number
  missingEntityIds: readonly string[]
  failedObligationIds: readonly string[]
}): DsFailureBoundary {
  return classifyDsFailureBoundary(input)
}
