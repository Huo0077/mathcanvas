import type { CurriculumCase } from "./catalog"

export interface GoldCase extends CurriculumCase {
  unitId: string
  curriculumVersion: "2017-2025"
  taskKind: "proposition" | "non_propositional"
  origin: "authored"
  prompt: string
  goldGoal: { verdict: "true" | "false" | "underdetermined"; rationale: string; counterexample?: string; missingCondition?: string }
  reviewStatus: "internally_checked"
}

export interface GoldCaseAudit {
  invalidCases: string[]
  duplicateIds: string[]
  internalCaseIds: string[]
  teacherReviewedCaseIds: string[]
}

/**
 * This only checks the integrity and provenance of hand-authored fixtures.
 * It does NOT check the mathematical argument or produce Lean evidence.
 * Teacher sign-off needs an independent review artifact, absent from this input.
 */
export function auditGoldCases(cases: readonly GoldCase[], knownSubtypes: ReadonlySet<string>): GoldCaseAudit {
  const invalidCases: string[] = []
  const duplicateIds: string[] = []
  const internalCaseIds: string[] = []
  const seen = new Set<string>()
  for (const entry of cases) {
    if (seen.has(entry.caseId)) duplicateIds.push(entry.caseId)
    seen.add(entry.caseId)
    const expectedVerdict = entry.role === "positive" ? "true"
      : entry.role === "negative" ? "false"
        : entry.role === "ambiguous" ? "underdetermined" : null
    const valid = entry.caseId.trim().length > 0
      && knownSubtypes.has(entry.subtypeId)
      && entry.unitId === entry.subtypeId.split("/")[0]
      && entry.scope === "curriculum"
      && entry.curriculumVersion === "2017-2025"
      && entry.taskKind === "proposition"
      && entry.origin === "authored"
      && entry.reviewStatus === "internally_checked"
      && entry.prompt.trim().length > 0
      && entry.goldGoal.rationale.trim().length > 0
      && entry.goldGoal.verdict === expectedVerdict
      && (entry.role !== "negative" || (entry.goldGoal.counterexample?.trim().length ?? 0) > 0)
      && (entry.role !== "ambiguous" || (entry.goldGoal.missingCondition?.trim().length ?? 0) > 0)
    if (!valid) invalidCases.push(entry.caseId)
    else internalCaseIds.push(entry.caseId)
  }
  return { invalidCases, duplicateIds, internalCaseIds, teacherReviewedCaseIds: [] }
}
