import { expect, it } from "vitest"

import { auditExamSources, type ExamSourceRecord } from "./examSources"
import officialIndex from "../../docs/taxonomy/high-school-2025-source-index.json"
import candidates from "../../docs/taxonomy/exam-source-candidates.json"

const unitIds = new Set(officialIndex.expectedUnits.map((unit) => unit.unitId))
const commentary: ExamSourceRecord = {
  sourceId: "exam-2025-shanghai-commentary", examYear: 2025, paperId: "shanghai-autumn-math",
  url: "https://www.shmeea.edu.cn/page/02200/20250608/19462.html", publishedOn: "2025-06-08",
  sourceSha256: "E8EE022A64E3568DF262DE2ADB5F6604DBA2ABD28E581F4EE0017DFDEE80DAD1",
  evidenceKind: "commentary_only", fullPaperReviewed: false, answerReviewed: false,
  topics: [{ unitId: "selective-sequences", questionId: null }]
}

/** Break guarded: an authority mentioning a topic is not an audited problem and answer. */
it("keeps official commentary out of verified exam gold", () => {
  const report = auditExamSources([commentary], unitIds)
  expect(report.candidateUnitIds).toEqual(["selective-sequences"])
  expect(report.verifiedGoldCaseIds).toEqual([])
  expect(report.invalidSources).toEqual([])
})

/** Break guarded: self-reported review flags must not upgrade a commentary-only article. */
it("rejects forged full-question status when source is only a commentary", () => {
  const forged: ExamSourceRecord = { ...commentary, fullPaperReviewed: true, answerReviewed: true, goldCaseId: "pretend-case" }
  const report = auditExamSources([forged], unitIds)
  expect(report.invalidSources).toContain("exam-2025-shanghai-commentary")
  expect(report.verifiedGoldCaseIds).toEqual([])
})

/** Break guarded: unknown syllabus tags and duplicate source identities cannot enlarge the denominator. */
it("rejects unknown curricular units and duplicate official source ids", () => {
  const result = auditExamSources([commentary, { ...commentary, topics: [{ unitId: "unlisted-math", questionId: "Q1" }] }], unitIds)
  expect(result.duplicateIds).toEqual(["exam-2025-shanghai-commentary"])
  expect(result.invalidSources).toContain("exam-2025-shanghai-commentary")
})

/** Break guarded: recorded article URLs are metadata-only, never substituted for exam cases. */
it("preserves candidate references while the actual past-paper cases remain unmeasured", () => {
  const report = auditExamSources(candidates.sources as ExamSourceRecord[], unitIds)
  expect(candidates.sources).toHaveLength(3) // Shanghai, National I and National II remain separate papers
  expect(candidates.sources.map((record) => record.paperId)).toEqual([
    "shanghai-autumn-math", "national-I-math", "national-II-math"
  ])
  expect(report.invalidSources).toEqual([])
  expect(report.duplicateIds).toEqual([])
  expect(report.candidateUnitIds).toContain("selective-analytic-geometry")
  expect(report.verifiedGoldCaseIds).toEqual([])
  expect(candidates.scope).toBe("source_only_not_past_paper_gold")
})

/** Break guarded: a valid HTTPS page outside a reviewed authority is not an official exam source. */
it("rejects a lookalike commentary hosted outside the reviewed exam authorities", () => {
  const result = auditExamSources([{ ...commentary, url: "https://example.org/exam-review" }], unitIds)
  expect(result.invalidSources).toContain(commentary.sourceId)
  expect(result.candidateUnitIds).toEqual([])
})
