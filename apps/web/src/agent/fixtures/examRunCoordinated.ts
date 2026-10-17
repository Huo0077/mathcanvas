import {
  createBudget, errorDiagnostics, examTrialVerdictOf, parsePlanEnvelope,
  type Budget, type CommitterPort, type ExamCase, type ExamRunBudget, type ExamRunCaseResult,
  type PlanOutcome, type RunEvent, type WorkspaceId
} from "@draw/agent-core"
import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { contentFingerprint } from "@draw/scene-graph"

import { createAgentRuntime } from "../agentRuntime"
import { MODEL_PLANNER_SKILL_IDS, planWorkspaceFor } from "../agentRunner"
import { planRequestFor } from "./benchmarkPlanningEval"
import { budgetWithProviderRequestCap } from "./examRequestBudget"
import { workspaceForFamily, type ExamRunAdapterDeps } from "./examRunContracts"

type StageOutcome = Awaited<ReturnType<CommitterPort["stage"]>>

/** Runs the real product runtime on isolated documents. Never grants consent or commits. */
export function createCoordinatedExamRunCase(deps: ExamRunAdapterDeps): (examCase: ExamCase, trial: number, budget?: ExamRunBudget) => Promise<ExamRunCaseResult> {
  const now = deps.now ?? (() => Date.now())
  return async (examCase, trial, outer?: ExamRunBudget): Promise<ExamRunCaseResult> => {
    const started = now()
    const runId = `exam-${examCase.id}-${trial}`
    let workspace = deps.workspaceOf?.(examCase) ?? workspaceForFamily(examCase.family)
    const documents = new Map<WorkspaceId, GeometryDocument>()
    const current = () => {
      let document = documents.get(workspace)
      if (!document) { document = createEmptyDocument(workspace); documents.set(workspace, document) }
      return document
    }
    const initial = planRequestFor(examCase.prompt, workspace, runId, current())
    const capped = outer === undefined ? undefined : budgetWithProviderRequestCap(createBudget(), outer)
    const inner = capped ?? createBudget()
    let budgetDenied = false
    const budget: Budget = { ...inner, consume(kind, amount) {
      const decision = inner.consume(kind, amount)
      if (!decision.ok) budgetDenied = true
      return decision
    } }
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
    const parsed = outcome === null ? null : parsePlanEnvelope(outcome.plan)
    const detail = events.at(-1)?.detail ?? "coordinator produced no terminal event"
    let verdict: Pick<ExamRunCaseResult, "outcome" | "failureLayer">
    if (plannerError !== null || budgetDenied) {
      verdict = { outcome: "error" }
    } else if (parsed === null) {
      verdict = { outcome: "error" }
    } else if (!parsed.ok) {
      verdict = { outcome: "rejected", failureLayer: "schema" }
    } else if (parsed.value.kind !== "plan") {
      verdict = examTrialVerdictOf({ kind: parsed.value.kind })
    } else if (runtime.coordinator.phase() === "waiting") {
      verdict = { outcome: "rejected", failureLayer: "plan" }
    } else if (lastStage !== undefined && !lastStage.ok) {
      verdict = examTrialVerdictOf({ kind: "plan", compile: { accepted: false, errorStages: errorDiagnostics(lastStage.planDiagnostics ?? []).map((entry) => entry.stage) } })
    } else if (lastStage?.ok) {
      const id = runtime.draftId()
      const preview = id === null ? null : runtime.drafts.getPreview(id)
      verdict = examTrialVerdictOf({ kind: "plan", repaired: attempts.length > 1,
        compile: { accepted: true, errorStages: [], ...(preview?.diagramVerification === undefined ? {} : { verification: preview.diagramVerification.status }) }
      })
      // Passing compilation alone is never evidence of passing the product confirmation gate.
      if (verdict.outcome !== "rejected" && runtime.coordinator.phase() !== "awaiting_confirmation") verdict = { outcome: "error" }
    } else {
      verdict = { outcome: "error" }
    }
    const costError = plannerError ?? (budgetDenied ? new Error(detail) : null)
    const result = { ...verdict, costUsd: deps.costOf({ examCase, trial, outcome, error: costError, attempts }), latencyMs: now() - started, detail }
    runtime.discardDraft()
    return result
  }
}
