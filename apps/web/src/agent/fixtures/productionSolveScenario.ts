import { createEmptyDocument } from "@draw/dsl"
import { contentFingerprint } from "@draw/scene-graph"
import { createSolveContext, type WorkspaceId, type SolveAuditEvent } from "@draw/agent-core"
import { createDefaultSolveSession } from "../../services/solveSession"
import { createAgentReliabilityFlags } from "../reliabilityFlags"
import { selectProblemPlanner, startProblemSolve } from "../problemSolveService"

export interface ProductionScenario {
  prompt: string
  workspace: WorkspaceId
  providerReplies: readonly (unknown | ((goalId: string) => unknown))[]
  attachments?: readonly { name: string; bytes: Uint8Array }[]
  flags: "legacy" | "reliability"
  /** W4：宿主审计出的图证据缺口（真实实现来自 `problemImagePipeline`）。 */
  imageGaps?: readonly { code: string; message: string; required: boolean }[]
}
export interface ProductionScenarioResult {
  stageNames: string[]
  solveStatus: string
  unansweredGoalIds: string[]
  requiredGoalCount: number
  problemRevision: string
  providerCalls: number
  requestedSkillIds: readonly string[]
  liveWrites: number
  auditEvents: SolveAuditEvent[]
}

/** Real production router/runtime/coordinator; only provider transport is a deterministic script. */
export async function runProductionScenario(input: ProductionScenario): Promise<ProductionScenarioResult> {
  const document = createEmptyDocument(input.workspace)
  const runId = "production-scenario"
  const hash = async (text: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, "0")).join("")
  const attachments = await Promise.all((input.attachments ?? []).map(async (attachment, index) => ({
    attachmentId: `scenario-attachment-${index + 1}`,
    sha256: [...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(attachment.bytes)))].map(byte => byte.toString(16).padStart(2, "0")).join(""),
    page: 1
  })))
  const context = await createSolveContext({ runId, conversationId: "scenario", prompt: input.prompt,
    attachments, corrections: [], sceneRevision: contentFingerprint(document) }, hash)
  const session = createDefaultSolveSession(runId)
  let providerCalls = 0
  let liveWrites = 0
  const auditEvents: SolveAuditEvent[] = []
  const selection = await selectProblemPlanner({ prompt: input.prompt, imageNotes: "", solveSession: session,
    requiredGoals: context.understanding.goals.map(goal => ({ goalId: goal.goalId, kind: goal.expectedKind,
      sourceText: context.understanding.ir.obligations.find(item => item.id === goal.goalId)?.sourceText ?? "" })),
    modelPlanner: {
      resolveProvider: async () => ({ ok: true, provider: { id: "script-provider", modelId: "offline", dialect: "openai_native", revision: 1,
        capabilities: { json: "unknown", tools: "unknown", vision: "unknown" } } }),
      runModel: async () => {
        const reply = input.providerReplies[providerCalls++]
        const envelope = typeof reply === "function" ? reply(context.understanding.goals[0]?.goalId ?? "") : reply
        if (!envelope) throw new Error("provider script exhausted")
        return { ok: true, events: [{ kind: "delta", requestId: "req", attemptId: "attempt", text: JSON.stringify(envelope) }] }
      }
    }
  })
  const flags = input.flags === "legacy" ? createAgentReliabilityFlags() : createAgentReliabilityFlags({ answerSemanticsV1: true, goalTrackingV1: true, mathVerificationV1: true })
  const runtime = startProblemSolve({ context, session, flags, hashText: hash,
    ...(input.imageGaps === undefined ? {} : { imageGaps: input.imageGaps }), runtime: {
    planner: selection.planner, onSolveAudit: event => auditEvents.push(event), readDocument: () => document,
    writeDocument: () => { liveWrites += 1; throw new Error("no automatic document writes") },
    readSceneDocuments: () => [{ handle: { projectId: "scenario", documentId: document.metadata.id, workspace: input.workspace,
      epoch: "epoch", generation: document.revision, contentHash: contentFingerprint(document) }, document }],
    exportPreflight: { preflight: () => { throw new Error("no export") } }, projectId: "scenario", runId,
    requestedSkillIds: selection.requestedSkillIds
  } })
  const run = { runId, conversationId: "scenario", promptMessageId: "prompt", target: { projectId: "scenario", documentId: document.metadata.id,
    workspace: input.workspace, epoch: "epoch", generation: document.revision, contentHash: contentFingerprint(document) },
    sources: [], textProfileId: selection.textProfileId, capabilityRevision: "offline-scenario", policyRevision: "local" }
  const stageNames: string[] = []
  for await (const event of runtime.coordinator.start({ run, userMessage: input.prompt })) stageNames.push(event.phase)
  return { stageNames, solveStatus: runtime.solveResult()?.status ?? "absent",
    unansweredGoalIds: runtime.solveResult()?.unansweredGoalIds ?? [], requiredGoalCount: context.understanding.goals.length,
    providerCalls, requestedSkillIds: selection.requestedSkillIds, liveWrites, auditEvents, problemRevision: context.problemRevision }
}
