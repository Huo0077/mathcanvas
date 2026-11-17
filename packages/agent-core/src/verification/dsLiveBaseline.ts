export type DsFailureBoundary =
  | "passed"
  | "false_positive_confirmable"
  | "verification_split_not_supported"
  | "partial_single_shot_no_validating_repair"
  | "partial_exhausted_or_unrepaired"
  | "zero_candidate_waiting"
  | "zero_candidate_failed"

export interface RawDsLiveCaseSnapshot {
  readonly id: string
  readonly route?: string
  readonly dsInvoked?: boolean
  readonly terminal: string
  readonly requests: number
  readonly passed: boolean
  readonly primitiveCount: number
  readonly verificationStatus: string | null
  readonly certificateStatus: string | null
  readonly contractStatus: "passed" | "partial" | "failed" | "incomplete"
  readonly objectCoverage: number
  readonly obligationCoverage: number
  readonly missingEntityIds: readonly string[]
  readonly failedObligationIds: readonly string[]
  readonly failedObligationKinds: readonly string[]
}

export interface SanitizedDsLiveCaseEntry {
  readonly id: string
  readonly route: string
  readonly dsInvoked: boolean
  readonly hasCandidate: boolean
  readonly confirmable: boolean
  readonly terminal: string
  readonly primitiveCount: number
  readonly objectCoverage: number
  readonly obligationCoverage: number
  readonly certificateStatus: string | null
  readonly verificationStatus: string | null
  readonly contractStatus: "passed" | "partial" | "failed" | "incomplete"
  readonly missingEntityIds: readonly string[]
  readonly failedObligationKinds: readonly string[]
  readonly failedObligationCount: number
  readonly failureBoundary: DsFailureBoundary
  readonly requestCount: number
}

export interface SanitizedDsLiveSummary {
  readonly schemaVersion: "ds-live-baseline-sanitized.v1"
  readonly sourceRevision: string
  readonly modelId: string
  readonly routeMode: string
  readonly denominator: number
  readonly completed: number
  readonly passed: number
  readonly partial: number
  readonly failed: number
  readonly incomplete: number
  readonly previewCount: number
  readonly confirmableCount: number
  readonly falsePositiveConfirmableCount: number
  readonly verificationSplitCount: number
  readonly singleShotPartialCount: number
  readonly zeroCandidateCount: number
  readonly zeroCandidateWaitingCount: number
  readonly requestCount: number
  readonly maxRequests: number
  readonly maxPerCase: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly costUsd: null
  readonly costKnown: false
  readonly sceneWrites: number
  readonly meanObjectCoverage: number
  readonly meanObligationCoverage: number
  readonly falsePositiveCaseIds: readonly string[]
  readonly verificationSplitCaseIds: readonly string[]
  readonly singleShotPartialCaseIds: readonly string[]
  readonly zeroCandidateCaseIds: readonly string[]
  readonly zeroCandidateWaitingCaseIds: readonly string[]
  readonly cases: readonly SanitizedDsLiveCaseEntry[]
}

const FORBIDDEN_KEYS = new Set([
  "prompt",
  "rawprompt",
  "usermessage",
  "messages",
  "requestlog",
  "responsetext",
  "rawresponse",
  "apikey",
  "secret",
  "authorization",
  "bearer",
  "token"
])

const SECRET_VALUE_RE = /\bsk-[A-Za-z0-9_-]{8,}|\bBearer\s+[A-Za-z0-9._-]{6,}/i

/** Classifies a single DS-live run into its exact failure or divergence boundary. */
export function classifyDsFailureBoundary(input: {
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
  const hasCandidate = input.primitiveCount > 0
  if (input.passed && input.contractStatus === "passed" && input.terminal === "awaiting_confirmation") {
    return "passed"
  }
  const prodPassed = input.verificationStatus === "passed" && input.certificateStatus === "passed"
  if (prodPassed && (input.terminal === "awaiting_confirmation" || !input.passed)) {
    return "false_positive_confirmable"
  }
  if (!hasCandidate) {
    return input.terminal === "waiting" ? "zero_candidate_waiting" : "zero_candidate_failed"
  }
  if (
    input.objectCoverage === 1 &&
    input.obligationCoverage === 1 &&
    input.failedObligationIds.length === 0 &&
    (input.verificationStatus === "not_supported" || input.certificateStatus !== "passed")
  ) {
    return "verification_split_not_supported"
  }
  if (input.requests <= 1) {
    return "partial_single_shot_no_validating_repair"
  }
  return "partial_exhausted_or_unrepaired"
}

/** Rejects any object containing forbidden raw prompts, model transcripts, or secret markers. */
export function assertSanitizedDsLiveLedger(value: unknown, seen = new Set<unknown>()): void {
  if (typeof value === "string") {
    if (SECRET_VALUE_RE.test(value)) {
      throw new Error("forbidden secret pattern detected in sanitized DS baseline ledger")
    }
    return
  }
  if (typeof value !== "object" || value === null || seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) assertSanitizedDsLiveLedger(item, seen)
    return
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
      throw new Error(`forbidden unsanitized key "${key}" detected in DS baseline ledger`)
    }
    assertSanitizedDsLiveLedger(entry, seen)
  }
}

/** Builds and strictly validates the sanitized 36-case DS baseline summary. */
export function summarizeDsLiveBaseline(
  suiteCaseIds: readonly string[],
  rawCases: readonly RawDsLiveCaseSnapshot[],
  meta: {
    sourceRevision: string
    modelId: string
    routeMode: string
    maxRequests: number
    maxPerCase: number
    expectedRequests: number
    inputTokens: number
    outputTokens: number
    sceneWrites: number
  }
): SanitizedDsLiveSummary {
  if (rawCases.length !== suiteCaseIds.length) {
    throw new Error(`case count mismatch: expected ${suiteCaseIds.length} missing or extra cases, got ${rawCases.length}`)
  }

  const byId = new Map<string, RawDsLiveCaseSnapshot>()
  for (const entry of rawCases) {
    if (byId.has(entry.id)) {
      throw new Error(`duplicate case id in DS baseline: ${entry.id}`)
    }
    byId.set(entry.id, entry)
  }

  const cases: SanitizedDsLiveCaseEntry[] = []
  for (const id of suiteCaseIds) {
    const raw = byId.get(id)
    if (!raw) {
      throw new Error(`missing suite case id in DS baseline: ${id}`)
    }
    const hasCandidate = raw.primitiveCount > 0
    const confirmable = raw.terminal === "awaiting_confirmation"
    const boundary = classifyDsFailureBoundary(raw)
    cases.push({
      id,
      route: raw.route ?? meta.routeMode,
      dsInvoked: raw.dsInvoked ?? raw.requests > 0,
      hasCandidate,
      confirmable,
      terminal: raw.terminal,
      primitiveCount: raw.primitiveCount,
      objectCoverage: raw.objectCoverage,
      obligationCoverage: raw.obligationCoverage,
      certificateStatus: raw.certificateStatus,
      verificationStatus: raw.verificationStatus,
      contractStatus: raw.contractStatus,
      missingEntityIds: [...raw.missingEntityIds],
      failedObligationKinds: [...new Set(raw.failedObligationKinds)],
      failedObligationCount: raw.failedObligationIds.length,
      failureBoundary: boundary,
      requestCount: raw.requests
    })
  }

  const passed = cases.filter((c) => c.contractStatus === "passed").length
  const partial = cases.filter((c) => c.contractStatus === "partial").length
  const failed = cases.filter((c) => c.contractStatus === "failed").length
  const incomplete = cases.filter((c) => c.contractStatus === "incomplete").length
  const requestCount = cases.reduce((sum, c) => sum + c.requestCount, 0)
  if (requestCount !== meta.expectedRequests) {
    throw new Error(`requestCount sum mismatch: expected ${meta.expectedRequests}, got ${requestCount}`)
  }

  const falsePositiveCaseIds = cases.filter((c) => c.failureBoundary === "false_positive_confirmable").map((c) => c.id)
  const verificationSplitCaseIds = cases.filter((c) => c.failureBoundary === "verification_split_not_supported").map((c) => c.id)
  const singleShotPartialCaseIds = cases.filter((c) => c.failureBoundary === "partial_single_shot_no_validating_repair").map((c) => c.id)
  const zeroCandidateCaseIds = cases.filter((c) => !c.hasCandidate).map((c) => c.id)
  const zeroCandidateWaitingCaseIds = cases.filter((c) => c.failureBoundary === "zero_candidate_waiting").map((c) => c.id)

  const summary: SanitizedDsLiveSummary = {
    schemaVersion: "ds-live-baseline-sanitized.v1",
    sourceRevision: meta.sourceRevision,
    modelId: meta.modelId,
    routeMode: meta.routeMode,
    denominator: suiteCaseIds.length,
    completed: cases.length - incomplete,
    passed,
    partial,
    failed,
    incomplete,
    previewCount: cases.filter((c) => c.hasCandidate).length,
    confirmableCount: cases.filter((c) => c.confirmable).length,
    falsePositiveConfirmableCount: falsePositiveCaseIds.length,
    verificationSplitCount: verificationSplitCaseIds.length,
    singleShotPartialCount: singleShotPartialCaseIds.length,
    zeroCandidateCount: zeroCandidateCaseIds.length,
    zeroCandidateWaitingCount: zeroCandidateWaitingCaseIds.length,
    requestCount,
    maxRequests: meta.maxRequests,
    maxPerCase: meta.maxPerCase,
    inputTokens: meta.inputTokens,
    outputTokens: meta.outputTokens,
    costUsd: null,
    costKnown: false,
    sceneWrites: meta.sceneWrites,
    meanObjectCoverage: cases.reduce((s, c) => s + c.objectCoverage, 0) / cases.length,
    meanObligationCoverage: cases.reduce((s, c) => s + c.obligationCoverage, 0) / cases.length,
    falsePositiveCaseIds,
    verificationSplitCaseIds,
    singleShotPartialCaseIds,
    zeroCandidateCaseIds,
    zeroCandidateWaitingCaseIds,
    cases
  }

  assertSanitizedDsLiveLedger(summary)
  return summary
}
