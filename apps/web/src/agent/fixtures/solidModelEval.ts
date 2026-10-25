import { createEmptyDocument } from "@draw/dsl"
import { buildContext, compilePlan, createBudget, DRAFT_ACTION_IDS, parseDiagramObligations, parsePlanEnvelope,
  SKILL_MANIFESTS, type PlanRequest, type PlanCompileResult } from "@draw/agent-core"
import { createModelPlanner, type ModelPlannerProvider } from "../modelPlanner"
import { SYSTEM_PROMPT_VERSION } from "../systemPrompt"
import type { SolidProblem } from "./examSolid30.problems"
import { createSolidEvalTransport, type SolidEvalConfig, type SolidEvalTrace } from "./solidEvalTransport"

export interface SolidEvalRow extends SolidProblem {
  kind: string
  actions: number
  compiled: boolean
  hasDraft: boolean
  verification: string
  verified: boolean
  expectationMet: boolean
  rawPlan?: unknown
  failure?: string
  diagnostics?: PlanCompileResult["diagnostics"]
  checks?: PlanCompileResult["diagramVerification"]
  assumptions?: PlanCompileResult["assumptions"]
  traces: SolidEvalTrace[]
}
export interface SolidEvalReport {
  schemaVersion: "mathcanvas.solid-eval.v2"
  model: string
  sourceRevision: string
  promptVersion: string
  limits?: Pick<SolidEvalConfig, "maxRequests" | "maxTokens" | "timeoutMs">
  at: string
  status: "running" | "completed" | "cancelled" | "interrupted"
  currentProblemId?: string
  problems: number
  requests: number
  inputTokens: number
  outputTokens: number
  rows: SolidEvalRow[]
  summary: ReturnType<typeof summariseSolidEval>
}

/** A passed subset of givens cannot override a failed compiler or absent draft. */
export function isVerifiedSolidResult(row: Pick<SolidEvalRow, "kind" | "compiled" | "hasDraft" | "verification">): boolean {
  return row.kind === "plan" && row.compiled && row.hasDraft && row.verification === "passed"
}

export function summariseSolidEval(rows: readonly SolidEvalRow[]) {
  return {
    completed: rows.length,
    asPlan: rows.filter(r => r.kind === "plan").length,
    compiled: rows.filter(r => r.compiled && r.hasDraft).length,
    verified: rows.filter(r => !r.expectedDiagnostic && isVerifiedSolidResult(r)).length,
    expectedRejections: rows.filter(r => r.expectedDiagnostic && r.kind === "plan" && r.expectationMet).length,
    expectedClarifications: rows.filter(r => r.expectedDiagnostic && r.kind === "clarification" && r.expectationMet).length,
    expectationMet: rows.filter(r => r.expectationMet).length
  }
}

function emptyRow(problem: SolidProblem): SolidEvalRow {
  return { id: problem.id, prompt: problem.prompt, focus: problem.focus,
    ...(problem.expectedDiagnostic === undefined ? {} : { expectedDiagnostic: problem.expectedDiagnostic }),
    kind: "-", actions: 0, compiled: false, hasDraft: false, verification: "not_run",
    verified: false, expectationMet: false, traces: [] }
}

/** Used by both live evaluation and offline replay; no separate scoring implementation. */
export function evaluateSolidPlan(problem: SolidProblem, rawPlan: unknown): SolidEvalRow {
  const row = { ...emptyRow(problem), rawPlan }
  const parsed = parsePlanEnvelope(rawPlan)
  if (!parsed.ok) { row.kind = "invalid"; row.failure = parsed.errors.map(e => `${e.code}@${e.path}`).join("; "); return row }
  row.kind = parsed.value.kind
  if (parsed.value.kind !== "plan") {
    row.verification = "not_a_plan"
    row.expectationMet = Boolean(problem.expectedDiagnostic && parsed.value.kind === "clarification")
    return row
  }
  const result = compilePlan(parsed.value, { document: createEmptyDocument("geometry3d"), prompt: problem.prompt,
    conversationId: `solid-eval-${problem.id}`, documentGeneration: 0 })
  row.actions = parsed.value.actions.length
  row.compiled = result.ok
  row.hasDraft = result.draftDocument !== null
  row.verification = result.diagramVerification?.status ?? "none"
  row.diagnostics = result.diagnostics
  row.checks = result.diagramVerification
  row.assumptions = result.assumptions
  row.verified = isVerifiedSolidResult(row)
  row.expectationMet = problem.expectedDiagnostic
    ? !result.ok && !row.hasDraft && result.diagnostics.some(d => d.code === problem.expectedDiagnostic)
    : row.verified
  return row
}

function requestFor(problem: SolidProblem, signal: AbortSignal): PlanRequest {
  const run: PlanRequest["run"] = {
    runId: `solid-eval-${problem.id}`, conversationId: `solid-eval-${problem.id}`, promptMessageId: `msg-${problem.id}`,
    target: { projectId: "local", documentId: `doc-${problem.id}`, workspace: "geometry3d", epoch: `epoch-${problem.id}`, generation: 0, contentHash: "empty" },
    sources: [], textProfileId: "solid-eval", capabilityRevision: "eval", policyRevision: "local"
  }
  const budget = createBudget()
  return {
    run, userMessage: `请根据下面的题面画出示意图（只作图，不必求解，也不要给数值答案）：${problem.prompt}`, budget, signal,
    model: {
      context: buildContext({ run, observation: { facts: [], summary: "空场景" }, requestedSkillIds: SKILL_MANIFESTS.map(s => s.id),
        selectedRefs: [], availableActions: [...DRAFT_ACTION_IDS], budget, unreadClauses: parseDiagramObligations(problem.prompt).unverified }),
      tools: [{ id: "plan.set_plan", kind: "control", effect: "propose_plan", description: "提交本轮隔离构图计划", phases: ["planning"], workspaces: [] }]
    },
    conversation: { binding: { conversationId: run.conversationId, projectId: "local", documentId: run.target.documentId, workspace: "geometry3d", generation: 0 },
      summary: "", facts: [], messages: [], observation: { facts: [], summary: "空场景" }, warnings: [], estimatedCharacters: 128 }
  }
}

export async function runSolidEvaluation(input: {
  config: SolidEvalConfig
  problems: readonly SolidProblem[]
  sourceRevision: string
  save: (report: SolidEvalReport) => Promise<void>
  signal: AbortSignal
  fetcher?: typeof fetch
}): Promise<SolidEvalReport> {
  const transport = createSolidEvalTransport(input.config, input.fetcher)
  const provider: ModelPlannerProvider = { id: "solid-eval", modelId: input.config.model, dialect: "deepseek", revision: 1,
    capabilities: { tools: "verified", json: "unknown", vision: "unknown" }, maxOutputTokens: input.config.maxTokens }
  const planner = createModelPlanner({ resolveProvider: async () => ({ ok: true, provider }),
    runModel: request => transport.call(request, input.signal), cancelRun: async () => true })
  const report: SolidEvalReport = {
    schemaVersion: "mathcanvas.solid-eval.v2", model: input.config.model, sourceRevision: input.sourceRevision,
    promptVersion: SYSTEM_PROMPT_VERSION, at: new Date().toISOString(), status: "running", problems: input.problems.length,
    limits: { maxRequests: input.config.maxRequests, maxTokens: input.config.maxTokens, timeoutMs: input.config.timeoutMs },
    ...transport.usage, rows: [], summary: summariseSolidEval([])
  }
  const checkpoint = async () => {
    Object.assign(report, transport.usage)
    report.summary = summariseSolidEval(report.rows)
    await input.save(structuredClone(report))
  }
  await checkpoint()
  try {
    for (const problem of input.problems) {
      if (input.signal.aborted) break
      report.currentProblemId = problem.id
      await checkpoint()
      const traceStart = transport.traces.length
      let row: SolidEvalRow
      let rawPlan: unknown
      try {
        const outcome = await planner.plan(requestFor(problem, input.signal))
        if (!("failure" in outcome)) rawPlan = outcome.plan
        row = "failure" in outcome
          ? { ...emptyRow(problem), failure: `${outcome.failure.category}: ${outcome.failure.detail}` }
          : evaluateSolidPlan(problem, outcome.plan)
      } catch (error) {
        row = { ...emptyRow(problem), ...(rawPlan === undefined ? {} : { rawPlan }), failure: error instanceof Error ? error.message : String(error) }
      }
      row.traces = transport.traces.slice(traceStart)
      report.rows.push(row)
      delete report.currentProblemId
      await checkpoint()
    }
    return report
  } finally {
    report.status = input.signal.aborted ? "cancelled" : report.rows.length === input.problems.length ? "completed" : "interrupted"
    await checkpoint()
  }
}

/** Recompile saved plans against their original prompts without any provider access. */
export function replaySolidReport(value: unknown): SolidEvalReport {
  const report = value as Partial<SolidEvalReport> | null
  if (report?.schemaVersion !== "mathcanvas.solid-eval.v2" || !Array.isArray(report.rows)) throw new Error("Unsupported solid evaluation report")
  const rows = report.rows.map(row => {
    if (typeof row.id !== "string" || typeof row.prompt !== "string" || !Array.isArray(row.traces)) throw new Error("Invalid saved evaluation row")
    return row.rawPlan === undefined
      ? { ...emptyRow(row), traces: row.traces, failure: row.failure ?? "No saved plan to replay" }
      : { ...evaluateSolidPlan(row, row.rawPlan), traces: row.traces }
  })
  return { ...report, rows, summary: summariseSolidEval(rows) } as SolidEvalReport
}
