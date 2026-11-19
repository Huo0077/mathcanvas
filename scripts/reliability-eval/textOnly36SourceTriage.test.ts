// @vitest-environment node
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import legacy from "../../test-fixtures/reliability/drawing-contracts-36.json"
import plan from "../../test-fixtures/reliability/text-only-36-plan.json"

type Triage = {
  suite: string
  runnable: false
  retained: { id: string; inputHash: string; source: string; textualFigureCue: boolean; status: "needs_original_paper_review" }[]
  excludedDuringPageReview: { sourceKey: string; reason: "embedded_figure_without_textual_cue"; sourceSha256: string; page: number }[]
  replacementCandidates: {
    slotId: string; category: "gaokao" | "joint"; sourceKey: string; sourceUrl: string; sourceSha256: string;
    questionNumber: number; status: "transcript_only_needs_paper" | "pdf_page_checked_needs_independent_review";
    page?: number; questionSha256?: string; notes: string
  }[]
}
const triage = (): Triage => JSON.parse(readFileSync("test-fixtures/reliability/text-only-36-source-triage.json", "utf8")) as Triage
const sha = (value: string): boolean => /^[a-f0-9]{64}$/.test(value)

describe("text-only 36 source triage is candidate evidence, not a runnable exam suite", () => {
  it("rechecks all 23 retained prompts without falsely claiming original-paper clearance", () => {
    const data = triage()
    expect(data.suite).toBe("g3-f9-text-only-36-triage.v1")
    expect(data.runnable).toBe(false)
    expect(data.retained.map(row => row.id)).toEqual(plan.retainedCaseIds)
    for (const row of data.retained) {
      const old = legacy.cases.find(c => c.id === row.id)
      expect(old?.inputMode).toBe("text_only")
      expect(row.inputHash).toBe(old?.inputHash)
      expect(row.source).toBe(old?.source)
      expect(row.textualFigureCue).toBe(false)
      expect(row.status).toBe("needs_original_paper_review")
    }
  })

  it("records a real figure-bearing rejection even when its question does not say 如图", () => {
    const data = triage()
    const rejected = data.excludedDuringPageReview.find(row => row.sourceKey === "2025-Jiangxi-Shangjin-Autumn-Grade3#Q11")
    expect(rejected).toEqual({
      sourceKey: "2025-Jiangxi-Shangjin-Autumn-Grade3#Q11",
      reason: "embedded_figure_without_textual_cue",
      page: 1,
      sourceSha256: "07b2007e20ced2c4eacdc357f0b9209e093c398f7e5a6b6e75cb283481b5b1d1"
    })
    expect(data.replacementCandidates.some(row => row.sourceKey === rejected?.sourceKey)).toBe(false)
  })

  it("ties exactly 13 distinct provisional source records to the slots and requires source hashes", () => {
    const data = triage()
    expect(data.replacementCandidates.map(c => c.slotId)).toEqual(plan.replacementSlots.map(c => c.id))
    expect(new Set(data.replacementCandidates.map(c => c.sourceKey)).size).toBe(13)
    for (const candidate of data.replacementCandidates) {
      expect(sha(candidate.sourceSha256)).toBe(true)
      expect(candidate.sourceUrl).toMatch(/^https:/)
      expect(candidate.notes.length).toBeGreaterThan(10)
      expect(candidate.questionNumber).toBeGreaterThan(0)
      if (candidate.category === "joint") {
        expect(candidate.page).toBeGreaterThan(0)
        expect(candidate.status).toBe("pdf_page_checked_needs_independent_review")
      } else {
        expect(candidate.questionSha256 && sha(candidate.questionSha256)).toBe(true)
        expect(candidate.status).toBe("transcript_only_needs_paper")
      }
    }
  })
})
