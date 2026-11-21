import type { PlanDiagnostic } from "./contracts"

export type ReliabilityFailureCode =
  | "syntax_unsupported"
  | "missing_entity"
  | "binding_ambiguous"
  | "topology_invalid"
  | "residual_failed"
  | "unknown_numeric"
  | "stale"
  | "cancelled"
  | "transport_failure"
  | "capability_missing"

export type ReliabilityRepairAction =
  | "return_boundary"
  | "complete_hosts_from_dag"
  | "clarify_binding"
  | "repair_topology"
  | "retry_local_params"
  | "escalate_precision"
  | "drop_candidate"
  | "retry_transport"

export interface ReliabilityDiagnostic {
  code: ReliabilityFailureCode
  sourceCode: string
  stage: PlanDiagnostic["stage"] | "runtime"
  detail: string
  obligationId?: string
  entityId?: string
  nodeId?: string
  sourceSpan?: { start: number; end: number; text?: string }
  expected?: string | number
  actual?: string | number
  residual?: number
  candidateHash?: string
  failureSignature?: string
  provenUnsat: false
  recoverable: boolean
  priorityAction: ReliabilityRepairAction
}

export type RepairStopReason =
  | "stagnant_candidate"
  | "no_progress"
  | "capability_missing"
  | "repair_budget_exhausted"
  | "cancelled"
  | "stale"

export interface SolveOutcomeSummary {
  status: "solved" | "not-found" | "timeout" | "budget_exhausted" | "underdetermined" | "cancelled"
  code: ReliabilityFailureCode
  provenUnsat: false
  detail: string
  evaluations: number
}

const CAPABILITY_CODES = new Set([
  "not_supported",
  "unsupported",
  "unsupported_capability",
  "unsupported_operator",
  "unsupported_action",
  "capability_missing"
])

function sanitizeNonUnsatText(detail: string): string {
  return detail
    .replaceAll("无解", "在当前搜索域内未找到可行解")
    .replaceAll("unsatisfiable", "unresolved_in_budget")
    .replaceAll("impossible", "unresolved_in_budget")
}

export function normalizeSolveOutcome(input: {
  status: "solved" | "not-found" | "timeout" | "budget_exhausted" | "underdetermined" | "cancelled"
  detail: string
  evaluations?: number
}): SolveOutcomeSummary {
  const code: ReliabilityFailureCode =
    input.status === "cancelled"
      ? "cancelled"
      : input.status === "underdetermined"
        ? "missing_entity"
        : "residual_failed"

  return {
    status: input.status,
    code,
    provenUnsat: false,
    detail: sanitizeNonUnsatText(input.detail),
    evaluations: input.evaluations ?? 0
  }
}

export function classifyDiagnosticCode(sourceCode: string, detail = ""): {
  code: ReliabilityFailureCode
  recoverable: boolean
  priorityAction: ReliabilityRepairAction
} {
  const lower = `${sourceCode} ${detail}`.toLowerCase()
  if (CAPABILITY_CODES.has(sourceCode) || lower.includes("not supported") || lower.includes("capability missing")) {
    return { code: "capability_missing", recoverable: false, priorityAction: "return_boundary" }
  }
  if (lower.includes("unsupported_syntax") || lower.includes("syntax_unsupported") || lower.includes("unsupported_derivative")) {
    return { code: "syntax_unsupported", recoverable: false, priorityAction: "return_boundary" }
  }
  if (lower.includes("ambiguous") || lower.includes("binding_ambiguous")) {
    return { code: "binding_ambiguous", recoverable: true, priorityAction: "clarify_binding" }
  }
  if (lower.includes("missing_entity") || lower.includes("missing_host") || lower.includes("unknown_ref") || lower.includes("unmaterialized")) {
    return { code: "missing_entity", recoverable: true, priorityAction: "complete_hosts_from_dag" }
  }
  if (lower.includes("topology") || lower.includes("winding") || lower.includes("non_coplanar") || lower.includes("degenerate")) {
    return { code: "topology_invalid", recoverable: true, priorityAction: "repair_topology" }
  }
  if (lower.includes("unknown_numeric") || lower.includes("ill_conditioned")) {
    return { code: "unknown_numeric", recoverable: true, priorityAction: "escalate_precision" }
  }
  if (lower.includes("stale")) {
    return { code: "stale", recoverable: false, priorityAction: "drop_candidate" }
  }
  if (lower.includes("cancelled")) {
    return { code: "cancelled", recoverable: false, priorityAction: "drop_candidate" }
  }
  if (lower.includes("transport") || lower.includes("timeout")) {
    return { code: "transport_failure", recoverable: true, priorityAction: "retry_transport" }
  }
  return { code: "residual_failed", recoverable: true, priorityAction: "retry_local_params" }
}

export function computeFailureSignature(
  candidateHash: string,
  diagnostics: ReadonlyArray<Pick<ReliabilityDiagnostic, "code" | "sourceCode" | "obligationId" | "entityId" | "detail">>
): string {
  const diagPart = diagnostics
    .map((d) => `${d.code}:${d.sourceCode}:${d.obligationId ?? ""}:${d.entityId ?? ""}:${d.detail}`)
    .sort()
    .join("|")
  return `${candidateHash}::${diagPart}`
}

export function classifyPlanDiagnostics(
  diagnostics: readonly PlanDiagnostic[],
  options: { candidateHash?: string; residual?: number } = {}
): ReliabilityDiagnostic[] {
  const candidateHash = options.candidateHash ?? "candidate-unknown"
  const mapped: ReliabilityDiagnostic[] = diagnostics
    .filter((d) => d.severity === "error")
    .map((d) => {
      const classified = classifyDiagnosticCode(d.code, d.detail)
      const entityMatch = /actions\[(\d+)\]/.exec(d.path)
      return {
        code: classified.code,
        sourceCode: d.code,
        stage: d.stage,
        detail: d.detail,
        ...(entityMatch ? { nodeId: `action:${entityMatch[1]}` } : {}),
        ...(options.residual === undefined ? {} : { residual: options.residual }),
        candidateHash,
        provenUnsat: false as const,
        recoverable: classified.recoverable,
        priorityAction: classified.priorityAction
      }
    })
  const signature = computeFailureSignature(candidateHash, mapped)
  return mapped.map((entry) => ({ ...entry, failureSignature: signature }))
}

export function createRepairStagnationTracker() {
  const seenKeys = new Set<string>()
  let lastCandidateHash: string | undefined
  let lastErrCodes: string | undefined
  let sameCodeStreak = 0
  let bestErrorCount: number | undefined
  let bestResidual: number | undefined

  return {
    record(input: {
      candidateHash: string
      diagnostics: readonly ReliabilityDiagnostic[]
      residual?: number
      /** When true, only stop on changed candidate with no progress or explicit residual stagnation; allows caller retry window on identical fixture mocks without residuals. */
      allowIdenticalWithoutResidual?: boolean
    }): { shouldStop: boolean; stopReason?: RepairStopReason; signature: string; detail: string } {
      const signature = computeFailureSignature(input.candidateHash, input.diagnostics)

      const unrecoverable = input.diagnostics.find((d) => !d.recoverable)
      if (unrecoverable) {
        return {
          shouldStop: true,
          stopReason: unrecoverable.code === "cancelled"
            ? "cancelled"
            : unrecoverable.code === "stale"
              ? "stale"
              : "capability_missing",
          signature,
          detail: `unrecoverable fault (${unrecoverable.code}: ${unrecoverable.sourceCode}): ${unrecoverable.detail}`
        }
      }

      const hasResidualFailure = input.diagnostics.some((d) => d.code === "residual_failed" || typeof d.residual === "number")
      if (seenKeys.has(signature)) {
        if (!input.allowIdenticalWithoutResidual || hasResidualFailure || typeof input.residual === "number") {
          return {
            shouldStop: true,
            stopReason: "stagnant_candidate",
            signature,
            detail: `stagnant candidate + failure signature repeated (${signature})`
          }
        }
      }
      seenKeys.add(signature)

      const errCount = input.diagnostics.length
      const errCodes = [...new Set(input.diagnostics.map((d) => {
        const prefix = d.sourceCode === "diagram_condition_failed" ? d.detail.split("：")[0]?.trim().slice(0, 24) ?? "" : ""
        return prefix ? `${d.code}:${d.sourceCode}:${prefix}` : `${d.code}:${d.sourceCode}`
      }))].sort().join(",")
      const sameFailureCodes = lastErrCodes !== undefined && errCodes === lastErrCodes
      const hasResidual = typeof input.residual === "number" && Number.isFinite(input.residual)
      const candidateChanged = lastCandidateHash !== undefined && input.candidateHash !== lastCandidateHash
      const nextStreak = sameFailureCodes ? sameCodeStreak + 1 : 1
      if (bestErrorCount !== undefined && (hasResidual || errCount > 0) && (!input.allowIdenticalWithoutResidual || candidateChanged || hasResidualFailure || hasResidual)) {
        const errorImproved = errCount < bestErrorCount
        const residualImproved = hasResidual && bestResidual !== undefined && input.residual! < bestResidual - 1e-12
        const blockForErrorCount =
          hasResidual
            ? !residualImproved
            : !candidateChanged || (sameFailureCodes && !errorImproved && nextStreak >= 3)
        if (!errorImproved && !residualImproved && blockForErrorCount) {
          return {
            shouldStop: true,
            stopReason: "no_progress",
            signature,
            detail: `no repair progress across candidates (errors=${errCount}, bestErrors=${bestErrorCount}${hasResidual ? `, residual=${input.residual}` : ""})`
          }
        }
      }

      lastCandidateHash = input.candidateHash
      lastErrCodes = errCodes
      sameCodeStreak = nextStreak
      if (errCount > 0 || bestErrorCount === undefined) {
        bestErrorCount = bestErrorCount === undefined ? errCount : Math.min(bestErrorCount, errCount)
      }
      if (hasResidual) {
        bestResidual = bestResidual === undefined ? input.residual! : Math.min(bestResidual, input.residual!)
      }
      return { shouldStop: false, signature, detail: "progressing" }
    }
  }
}
