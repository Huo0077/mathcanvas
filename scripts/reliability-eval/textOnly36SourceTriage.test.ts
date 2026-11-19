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
    originalPaperUrl?: string; originalPaperSha256?: string; originalPaperPage?: number;
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

  it("checks GK-S11 and GK-S13 against actual exam pages while independent approval remains pending", () => {
    const rows = triage().replacementCandidates.filter(row => row.category === "gaokao")
    const confirmed = rows.find(row => row.slotId === "GK-S11")
    expect(confirmed).toMatchObject({
      status: "pdf_page_checked_needs_independent_review",
      originalPaperUrl: "https://file.xdf.cn/uploads/160608/543_160608121058bHjwEnUk5DcQ21OX.pdf",
      originalPaperSha256: "877b895c319357aae7fb1dcb5362b68f69053ac4c35598c98e0ed38a6729b5c7",
      originalPaperPage: 1
    })
    expect(rows.find(row => row.slotId === "GK-S13")).toMatchObject({
      status: "pdf_page_checked_needs_independent_review",
      originalPaperUrl: "https://m.shsbnu.net/pluginfile.php/54461/mod_folder/content/0/2022%E5%B9%B4%E9%AB%98%E8%80%83%E7%9C%9F%E9%A2%98%E5%85%A8%E5%9B%BD%E4%B9%99%E5%8D%B7%E7%90%86%E7%A7%91%E6%95%B0%E5%AD%A6%E8%AF%95%E5%8D%B7-%E5%AD%A6%E7%94%9F%E7%94%A8%E5%8D%B7.pdf",
      originalPaperSha256: "fb7509622fe55a681f6145067c0a91c6377aeb127f78cd3f60818c72551448dc",
      originalPaperPage: 2
    })
    expect(rows.filter(row => row.status === "pdf_page_checked_needs_independent_review").map(row => row.slotId)).toEqual(["GK-S11", "GK-S13"])
    expect(triage().runnable).toBe(false)
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
        if (!["GK-S11", "GK-S13"].includes(candidate.slotId)) expect(candidate.status).toBe("transcript_only_needs_paper")
      }
    }
  })
})
