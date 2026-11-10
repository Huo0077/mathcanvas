/** Aggregate only de-identified, source-bound drawing outcomes. Never store prompts, model output or keys here. */
export interface DrawingRun {
  caseId: string
  sourceSha256: string
  sourceSet: "development" | "holdout" | "synthetic"
  kind: "drawing" | "answer-only"
  disposition: "committed" | "clarification" | "unsupported" | "failed"
  requiredObligations: readonly string[]
  verifiedObligations: readonly string[]
  draftCreated: boolean
  staged: boolean
  certificateValid: boolean
  committedWithKnownError: boolean
  /** Human/independent oracle result. Undefined means not independently reviewed. */
  expectedDrawable?: boolean
  reasonCodes: readonly string[]
}

/** Attestation metadata. External source and reviewer must be independently checked before release. */
export interface PreregisteredDrawingCase {
  caseId: string
  promptSha256: string
  sourceReference: string
  oracleReference: string
  reviewer: string
  reviewerIndependent: boolean
  status: "frozen" | "draft"
  registeredBeforeRun: boolean
}

export interface DrawingSummary {
  counts: { attempted: number; drafted: number; staged: number; verified: number; committed: number;
    committedWithKnownError: number; clarification: number; unsupported: number; failed: number }
  obligationCoverage: { verified: number; required: number; rate: number | null }
  refusalRate: number | null
  falseRefusalRate: { count: number; reviewed: number; rate: number | null }
  failures: { caseId: string; reasonCodes: string[] }[]
  releaseGate: { passed: boolean; violations: { caseId: string; code: string }[] }
}
const hash = /^[a-f0-9]{64}$/i
export function summarizeDrawingRuns(runs: readonly DrawingRun[], options: { independentHoldout?: boolean; preregistered?: readonly PreregisteredDrawingCase[] } = {}): DrawingSummary {
  const registrations = options.independentHoldout ? options.preregistered : undefined
  if (options.independentHoldout && !registrations?.length) throw new Error("independent holdout requires preregistered source and oracle")
  const registered = new Map<string, PreregisteredDrawingCase>()
  for (const entry of registrations ?? []) {
    if (!entry.caseId || registered.has(entry.caseId)) throw new Error("duplicate holdout preregistration")
    registered.set(entry.caseId, entry)
  }
  const ids = new Set<string>()
  const counts: DrawingSummary["counts"] = { attempted: 0, drafted: 0, staged: 0, verified: 0, committed: 0,
    committedWithKnownError: 0, clarification: 0, unsupported: 0, failed: 0 }
  let required = 0, verified = 0, falseRefusals = 0, reviewedRefusals = 0
  const failures: DrawingSummary["failures"] = []
  const violations: DrawingSummary["releaseGate"]["violations"] = []
  for (const item of runs) {
    if (!item.caseId || ids.has(item.caseId)) throw new Error("duplicate or missing case id")
    ids.add(item.caseId)
    if (item.kind !== "drawing") throw new Error("answer-only results need their own denominator, not drawing")
    if (!hash.test(item.sourceSha256)) throw new Error("invalid source SHA-256")
    if (options.independentHoldout) {
      if (item.sourceSet !== "holdout") throw new Error("development or synthetic cases are not independent holdout")
      const entry = registered.get(item.caseId)
      if (!entry || entry.promptSha256 !== item.sourceSha256 || !hash.test(entry.promptSha256)) throw new Error("holdout source hash does not match preregistration")
      if (entry.status !== "frozen" || !entry.registeredBeforeRun || !entry.sourceReference || !entry.oracleReference
        || !entry.reviewer || !entry.reviewerIndependent) throw new Error("holdout independent oracle preregistration incomplete")
    }
    const all = new Set(item.requiredObligations), passed = new Set(item.verifiedObligations)
    if (all.size !== item.requiredObligations.length || passed.size !== item.verifiedObligations.length
      || [...passed].some(id => !all.has(id))) throw new Error("invalid obligation identity")
    if (item.staged && !item.draftCreated) throw new Error("staged result without draft")
    if (item.certificateValid && (!item.staged || passed.size !== all.size || all.size === 0)) violations.push({ caseId: item.caseId, code: "invalid_certificate_claim" })
    if (item.disposition === "committed" && (!item.certificateValid || passed.size !== all.size)) violations.push({ caseId: item.caseId, code: "commit_without_certificate" })
    if (item.committedWithKnownError) violations.push({ caseId: item.caseId, code: "committed_known_error" })
    counts.attempted++
    if (item.draftCreated) counts.drafted++
    if (item.staged) counts.staged++
    if (item.certificateValid) counts.verified++
    counts[item.disposition]++
    if (item.committedWithKnownError) counts.committedWithKnownError++
    required += all.size
    verified += passed.size
    if (item.disposition !== "committed") {
      failures.push({ caseId: item.caseId, reasonCodes: [...item.reasonCodes] })
      if (item.expectedDrawable !== undefined) {
        reviewedRefusals++
        if (item.expectedDrawable) falseRefusals++
      }
    }
  }
  const refused = counts.attempted - counts.committed
  return { counts, obligationCoverage: { verified, required, rate: required ? verified / required : null },
    refusalRate: counts.attempted ? refused / counts.attempted : null,
    falseRefusalRate: { count: falseRefusals, reviewed: reviewedRefusals, rate: reviewedRefusals ? falseRefusals / reviewedRefusals : null },
    failures, releaseGate: { passed: violations.length === 0, violations } }
}
