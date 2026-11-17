import type { GeometryDocument } from "@draw/dsl"

import type { DsDrawingIntent } from "./dsDrawingIntent"
import { canonicalContentHash } from "./hashing"

export const DS_CANDIDATE_BUNDLE_SCHEMA = "mathcanvas.ds_candidate_bundle.v1" as const

export type DsBundleKind = "synthetic_replay" | "live_authorized"

export interface DsBundleEvidenceChain {
  runId: string
  candidateHash: string
  documentHash: string
  cameraHash?: string
  viewportHash: string
}

export interface DsBundleProvenance {
  route: string
  modelId: string | null
  dsInvoked: boolean
  isLiveAuthorized: boolean
}

export interface DsBundleReviewStatus {
  agentVisualReview: "pending" | "reviewed_ok" | "reviewed_flagged"
  humanReviewed: "pending" | "approved" | "rejected"
}

export interface DsCandidateBundle {
  schemaVersion: typeof DS_CANDIDATE_BUNDLE_SCHEMA
  bundleKind: DsBundleKind
  revision: string
  caseId: string
  scopeId?: string
  workspace: GeometryDocument["workspace"]
  promptHash: string
  intent?: DsDrawingIntent
  planHash: string
  candidateHash: string
  documentHash: string
  document: GeometryDocument
  certificateStatus: "passed" | "partial" | "blocked" | "unverified"
  provenance: DsBundleProvenance
  evidenceChain: DsBundleEvidenceChain
  warnings: string[]
  reviewStatus: DsBundleReviewStatus
}

export interface DsBundleValidationResult {
  ok: true
  bundle: DsCandidateBundle
}

export interface DsBundleValidationError {
  ok: false
  code:
    | "invalid_schema"
    | "unsanitized_secret_or_prompt"
    | "forged_live_provenance"
    | "document_hash_mismatch"
    | "chain_hash_mismatch"
  detail: string
}

const FORBIDDEN_BUNDLE_KEYS = new Set([
  "apiKey",
  "api_key",
  "secret",
  "token",
  "authorization",
  "rawPrompt",
  "prompt",
  "rawResponse",
  "systemPrompt"
])

function containsForbiddenKeyOrSecret(value: unknown, seen = new Set<unknown>()): string | null {
  if (typeof value === "string") {
    if (/sk-[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._-]{16,}/i.test(value)) {
      return "secret_pattern_detected"
    }
    return null
  }
  if (typeof value !== "object" || value === null || seen.has(value)) return null
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = containsForbiddenKeyOrSecret(item, seen)
      if (hit !== null) return hit
    }
    return null
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_BUNDLE_KEYS.has(key)) return `forbidden_key:${key}`
    const hit = containsForbiddenKeyOrSecret(entry, seen)
    if (hit !== null) return hit
  }
  return null
}

/** Builds a hash-bound replayable candidate bundle from sanitized case metadata (0 paid API calls for synthetic replay). */
export function createDsCandidateBundle(input: {
  bundleKind: DsBundleKind
  revision: string
  caseId: string
  scopeId?: string
  promptHash: string
  intent?: DsDrawingIntent
  planHash: string
  document: GeometryDocument
  certificateStatus: DsCandidateBundle["certificateStatus"]
  provenance: DsBundleProvenance
  runId: string
  cameraHash?: string
  viewportHash: string
  warnings?: readonly string[]
}): DsCandidateBundle {
  const documentHash = canonicalContentHash(input.document)
  const candidateHash = documentHash
  return {
    schemaVersion: DS_CANDIDATE_BUNDLE_SCHEMA,
    bundleKind: input.bundleKind,
    revision: input.revision,
    caseId: input.caseId,
    ...(input.scopeId === undefined ? {} : { scopeId: input.scopeId }),
    workspace: input.document.workspace,
    promptHash: input.promptHash,
    ...(input.intent === undefined ? {} : { intent: input.intent }),
    planHash: input.planHash,
    candidateHash,
    documentHash,
    document: input.document,
    certificateStatus: input.certificateStatus,
    provenance: input.provenance,
    evidenceChain: {
      runId: input.runId,
      candidateHash,
      documentHash,
      ...(input.cameraHash === undefined ? {} : { cameraHash: input.cameraHash }),
      viewportHash: input.viewportHash
    },
    warnings: [...(input.warnings ?? [])],
    reviewStatus: {
      agentVisualReview: "pending",
      humanReviewed: "pending"
    }
  }
}

export function parseAndValidateDsCandidateBundle(raw: unknown): DsBundleValidationResult | DsBundleValidationError {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, code: "invalid_schema", detail: "bundle must be a JSON object" }
  }
  const secretHit = containsForbiddenKeyOrSecret(raw)
  if (secretHit !== null) {
    return { ok: false, code: "unsanitized_secret_or_prompt", detail: `sanitization check failed: ${secretHit}` }
  }
  const obj = raw as Record<string, unknown>
  if (obj.schemaVersion !== DS_CANDIDATE_BUNDLE_SCHEMA) {
    return { ok: false, code: "invalid_schema", detail: `unexpected schemaVersion: ${String(obj.schemaVersion)}` }
  }
  if (obj.bundleKind !== "synthetic_replay" && obj.bundleKind !== "live_authorized") {
    return { ok: false, code: "invalid_schema", detail: `invalid bundleKind: ${String(obj.bundleKind)}` }
  }
  if (typeof obj.caseId !== "string" || typeof obj.promptHash !== "string" || typeof obj.documentHash !== "string" || typeof obj.candidateHash !== "string") {
    return { ok: false, code: "invalid_schema", detail: "missing required string fields (caseId/promptHash/documentHash/candidateHash)" }
  }
  if (typeof obj.document !== "object" || obj.document === null) {
    return { ok: false, code: "invalid_schema", detail: "missing document payload" }
  }
  const provenance = obj.provenance as DsBundleProvenance | undefined
  if (!provenance || typeof provenance.route !== "string" || typeof provenance.dsInvoked !== "boolean" || typeof provenance.isLiveAuthorized !== "boolean") {
    return { ok: false, code: "invalid_schema", detail: "missing provenance metadata" }
  }
  if (obj.bundleKind === "live_authorized" && (!provenance.dsInvoked || !provenance.isLiveAuthorized)) {
    return { ok: false, code: "forged_live_provenance", detail: "live_authorized bundle requires dsInvoked=true and isLiveAuthorized=true" }
  }
  const computedDocHash = canonicalContentHash(obj.document)
  if (computedDocHash !== obj.documentHash) {
    return { ok: false, code: "document_hash_mismatch", detail: `documentHash mismatch: expected ${computedDocHash}, got ${obj.documentHash}` }
  }
  const chain = obj.evidenceChain as DsBundleEvidenceChain | undefined
  if (!chain || chain.documentHash !== obj.documentHash || chain.candidateHash !== obj.candidateHash || !chain.runId || !chain.viewportHash) {
    return { ok: false, code: "chain_hash_mismatch", detail: "evidenceChain hashes do not match bundle hashes" }
  }
  return { ok: true, bundle: obj as unknown as DsCandidateBundle }
}

export interface BundleRenderDeliveryObservation {
  runId: string
  traceCandidateHash?: string
  candidateHash: string
  documentHash: string
  cameraHash?: string
  previousCameraHash?: string
  cameraMoved?: boolean
  viewportHash: string
  evidenceStatus: string
  renderTier: string
  objectsCount: number
  labelsCount: number
  expectedLabelsCount?: number
  diagnosticErrors: readonly string[]
  diagnosticWarnings: readonly string[]
  hiddenLabels: readonly string[]
  committedDocumentHash?: string
  commitCount: number
  cancelledLateWrite?: boolean
  mainCanvasWritesBeforeConfirm?: number
}

export type DsRenderDeliveryClassification = "dsLiveRendered" | "bridge_replay_passed" | "blocked"

export interface BundleRenderDeliveryVerdict {
  passed: boolean
  classification: DsRenderDeliveryClassification
  blockers: string[]
  warnings: string[]
  humanReviewed: DsBundleReviewStatus["humanReviewed"]
}

/** Verifies identical hash chain and browser render/isolation invariants across confirmation -> render -> commit. */
export function verifyBundleRenderAndDelivery(
  bundle: DsCandidateBundle,
  observed: BundleRenderDeliveryObservation
): BundleRenderDeliveryVerdict {
  const blockers: string[] = []
  if (bundle.certificateStatus !== "passed") blockers.push(`certificate_not_passed:${bundle.certificateStatus}`)
  if (observed.runId !== bundle.evidenceChain.runId) blockers.push("run_id_mismatch")
  if (
    observed.traceCandidateHash !== undefined &&
    (observed.traceCandidateHash !== bundle.evidenceChain.candidateHash ||
      observed.traceCandidateHash !== observed.candidateHash)
  ) {
    blockers.push("trace_candidate_hash_mismatch")
  }
  if (observed.candidateHash !== bundle.evidenceChain.candidateHash) blockers.push("candidate_hash_mismatch")
  if (observed.documentHash !== bundle.evidenceChain.documentHash) blockers.push("document_hash_mismatch")
  if (observed.viewportHash !== bundle.evidenceChain.viewportHash) blockers.push("viewport_hash_mismatch")
  if (bundle.evidenceChain.cameraHash !== undefined && observed.cameraHash !== bundle.evidenceChain.cameraHash) {
    blockers.push("camera_hash_mismatch")
  }
  if (
    observed.cameraMoved === true &&
    observed.previousCameraHash !== undefined &&
    observed.cameraHash === observed.previousCameraHash
  ) {
    blockers.push("stale_camera_hash_after_orbit")
  }
  if (observed.renderTier !== "rendered") blockers.push(`unexpected_render_tier:${observed.renderTier}`)
  if (observed.evidenceStatus !== "passed") blockers.push(`canvas_evidence_${observed.evidenceStatus}`)
  if (observed.objectsCount <= 0) blockers.push("empty_canvas_objects")
  if ((observed.expectedLabelsCount ?? 0) > 0 && observed.labelsCount <= 0) blockers.push("missing_rendered_labels")
  if (observed.hiddenLabels.length > 0) blockers.push(`hidden_labels:${observed.hiddenLabels.join(",")}`)
  for (const err of observed.diagnosticErrors) blockers.push(`diagnostic_error:${err}`)
  if (observed.diagnosticWarnings.includes("label_overlap")) blockers.push("label_overlap")
  if ((observed.mainCanvasWritesBeforeConfirm ?? 0) > 0) blockers.push("unconfirmed_write_to_main_canvas")
  if (observed.commitCount > 1) blockers.push("duplicate_commit")
  if (observed.cancelledLateWrite === true) blockers.push("late_write_after_cancel")
  if (observed.committedDocumentHash !== undefined && observed.committedDocumentHash !== bundle.documentHash) {
    blockers.push("committed_document_hash_mismatch")
  }

  const passed = blockers.length === 0
  const isGenuineLiveDs =
    bundle.bundleKind === "live_authorized" && bundle.provenance.dsInvoked && bundle.provenance.isLiveAuthorized
  const classification: DsRenderDeliveryClassification = !passed
    ? "blocked"
    : isGenuineLiveDs
      ? "dsLiveRendered"
      : "bridge_replay_passed"

  return {
    passed,
    classification,
    blockers,
    warnings: [...observed.diagnosticWarnings],
    // Automated engineering checks never forge human/teacher readability sign-off.
    humanReviewed: bundle.reviewStatus.humanReviewed
  }
}
