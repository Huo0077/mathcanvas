import { describe, expect, it } from "vitest"
import { summarizeDrawingRuns, type DrawingRun } from "./report"

const run = (overrides: Partial<DrawingRun> = {}): DrawingRun => ({
  caseId: "case-A", sourceSha256: "a".repeat(64), sourceSet: "development", kind: "drawing",
  disposition: "committed", requiredObligations: ["given-1", "given-2"], verifiedObligations: ["given-1", "given-2"],
  draftCreated: true, staged: true, certificateValid: true, committedWithKnownError: false, reasonCodes: [], ...overrides
})

describe("W5 drawing report fail-closed denominator", () => {
  it("counts each case once and divides verified obligations by all required obligations", () => {
    const result = summarizeDrawingRuns([run(), run({ caseId: "case-B", disposition: "unsupported", draftCreated: false, staged: false, certificateValid: false, verifiedObligations: [], reasonCodes: ["unsupported_clause"] })])
    expect(result.counts).toMatchObject({ attempted: 2, drafted: 1, staged: 1, verified: 1, committed: 1, unsupported: 1, committedWithKnownError: 0 })
    expect(result.obligationCoverage).toEqual({ verified: 2, required: 4, rate: 0.5 })
    expect(result.refusalRate).toBe(0.5)
    expect(result.failures).toEqual([{ caseId: "case-B", reasonCodes: ["unsupported_clause"] }])
  })
  it("forbids promoting tuned development cases into an independent holdout", () => {
    expect(() => summarizeDrawingRuns([run({ sourceSet: "development" })], { independentHoldout: true })).toThrow(/holdout/i)
  })
  it("counts unsafe commits and blocks release without hiding the failing denominator", () => {
    const report = summarizeDrawingRuns([run({ caseId: "bad-1", certificateValid: false }), run({ caseId: "bad-2", committedWithKnownError: true }), run({ caseId: "bad-3", verifiedObligations: ["given-1"] })])
    expect(report.counts).toMatchObject({ attempted: 3, committed: 3, committedWithKnownError: 1 })
    expect(report.releaseGate).toEqual({ passed: false, violations: [
      { caseId: "bad-1", code: "commit_without_certificate" }, { caseId: "bad-2", code: "committed_known_error" }, { caseId: "bad-3", code: "invalid_certificate_claim" }, { caseId: "bad-3", code: "commit_without_certificate" }
    ] })
  })
  it("does not combine answer-only questions with drawing denominators or accept duplicate cases", () => {
    expect(() => summarizeDrawingRuns([run({ kind: "answer-only" })])).toThrow(/drawing/i)
    expect(() => summarizeDrawingRuns([run(), run()])).toThrow(/duplicate/i)
  })
  it("records a clean refusal separately from a known false refusal", () => {
    const result = summarizeDrawingRuns([run({ disposition: "clarification", draftCreated: false, staged: false, certificateValid: false, verifiedObligations: [], expectedDrawable: true, reasonCodes: ["missing_fact"] })])
    expect(result.falseRefusalRate).toEqual({ count: 1, reviewed: 1, rate: 1 })
    expect(result.counts.clarification).toBe(1)
  })
})

describe("W5 preregistered holdout provenance", () => {
  const source = { caseId: "held-1", promptSha256: "b".repeat(64), sourceReference: "independent-exam-paper#7",
    oracleReference: "reviewed-oracle#7", reviewer: "external-teacher-1", reviewerIndependent: true,
    status: "frozen" as const, registeredBeforeRun: true }
  it("requires a frozen source and independently reviewed oracle before reporting holdout", () => {
    const outcome = run({ caseId: "held-1", sourceSha256: source.promptSha256, sourceSet: "holdout" })
    expect(summarizeDrawingRuns([outcome], { independentHoldout: true, preregistered: [source] }).counts.committed).toBe(1)
    for (const invalid of [{ ...source, reviewerIndependent: false }, { ...source, registeredBeforeRun: false },
      { ...source, promptSha256: "c".repeat(64) }, { ...source, oracleReference: "" }]) {
      expect(() => summarizeDrawingRuns([outcome], { independentHoldout: true, preregistered: [invalid] })).toThrow(/holdout|oracle|independent|hash/i)
    }
    expect(() => summarizeDrawingRuns([outcome], { independentHoldout: true })).toThrow(/preregistered/i)
  })
  it("refuses duplicate registration and excludes tuned source from the holdout score", () => {
    const held = run({ caseId: source.caseId, sourceSha256: source.promptSha256, sourceSet: "holdout" })
    expect(() => summarizeDrawingRuns([held], { independentHoldout: true, preregistered: [source, source] })).toThrow(/duplicate/i)
    expect(() => summarizeDrawingRuns([run()], { independentHoldout: true, preregistered: [source] })).toThrow(/holdout/i)
  })
})
