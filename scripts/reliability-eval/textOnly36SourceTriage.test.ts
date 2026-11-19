// @vitest-environment node
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import legacy from "../../test-fixtures/reliability/drawing-contracts-36.json"
import plan from "../../test-fixtures/reliability/text-only-36-plan.json"

type Triage = {
  suite: string
  runnable: false
  retained: { id: string; inputHash: string; source: string; textualFigureCue: boolean; status: "needs_original_paper_review" | "pdf_page_checked_needs_independent_review" | "pdf_page_checked_source_mismatch_requires_new_manifest"; sourceCorrection?: string; originalPaperUrl?: string; originalPaperSha256?: string; originalPaperPage?: number }[]
  excludedDuringPageReview: { sourceKey: string; reason: "embedded_figure_without_textual_cue" | "paper_question_mismatch"; sourceSha256: string; page: number }[]
  replacementCandidates: {
    slotId: string; category: "gaokao" | "joint"; sourceKey: string; sourceUrl: string; sourceSha256: string;
    questionNumber: number; status: "transcript_only_needs_paper" | "pdf_page_checked_needs_independent_review" | "page_preview_checked_needs_pdf_and_independent_review";
    originalPaperUrl?: string; originalPaperSha256?: string; originalPaperPage?: number;
    page?: number; questionSha256?: string; notes: string; previewImageUrl?: string; previewImageSha256?: string; previewPage?: number
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
      expect(row.status).toBe(["GK-P02", "GK-P03", "GK-P05", "GK-P08", "GK-P09"].includes(row.id) ? "pdf_page_checked_needs_independent_review" : row.id === "GK-P07" ? "pdf_page_checked_source_mismatch_requires_new_manifest" : "needs_original_paper_review")
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

  it("rejects misleading paper downloads when the printed question disagrees with the candidate", () => {
    const rejected = triage().excludedDuringPageReview.filter(row => row.reason === "paper_question_mismatch")
    expect(rejected).toEqual([
      { sourceKey: "2016-national-III-wrong-answer-paper#Q10", reason: "paper_question_mismatch", page: 4,
        sourceSha256: "a726ea29a53116a1d1ddbcaba0defe847fe95431c0ed046b470b0e38026c2373" },
      { sourceKey: "2020-national-I-wrong-scan#Q6", reason: "paper_question_mismatch", page: 1,
        sourceSha256: "2e57a1ae1f87fd18cbc4da2f5bb7f5ad08b64ef3d87d4d1abe273730feab04bd" }
    ])
    expect(triage().runnable).toBe(false)
  })

  it("checks six GK-S candidates against actual exam pages while independent approval remains pending", () => {
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
    expect(rows.find(row => row.slotId === "GK-S12")).toMatchObject({
      status: "pdf_page_checked_needs_independent_review",
      originalPaperUrl: "https://www.gcyls.cn/file/upload/202403/08/185520771.pdf",
      originalPaperSha256: "dcac3bb7e606f73710624313d119cce753e2d4eda25261dfd74e004b3f9ea36a",
      originalPaperPage: 2
    })
    expect(rows.find(row => row.slotId === "GK-S14")).toMatchObject({
      status: "pdf_page_checked_needs_independent_review",
      originalPaperUrl: "https://jhcee.cn/upload/file/20180806/1533545060595329.pdf",
      originalPaperSha256: "18119a7a31e9db6ed0c7afd23137b5d49e99c29adc281d43d1c3209f49078586",
      originalPaperPage: 3
    })
    expect(rows.find(row => row.slotId === "GK-S17")).toMatchObject({
      status: "pdf_page_checked_needs_independent_review",
      originalPaperUrl: "https://cdn.zizzs.com/zixunzhan/202310/2f7a402a-a096-4e6e-b162-11cbac3dec78.pdf",
      originalPaperSha256: "53a3e8489a098c52727aa8427c53b8c63fd779ae9eb5257acdd94716253cea09",
      originalPaperPage: 2
    })
    expect(rows.find(row => row.slotId === "GK-S16")).toMatchObject({
      status: "pdf_page_checked_needs_independent_review",
      originalPaperUrl: "https://dfiles.jiajiaoban.com/ohr/2019/08/20/164640_5d5bb370c2137.pdf",
      originalPaperSha256: "72a58f7b2a7c4db04efa63737ab5948b6d3662682a39b08bf5a308f4016e525a",
      originalPaperPage: 3
    })
    expect(rows.filter(row => row.status === "pdf_page_checked_needs_independent_review").map(row => row.slotId)).toEqual(["GK-S11", "GK-S12", "GK-S13", "GK-S14", "GK-S16", "GK-S17"])
    expect(triage().runnable).toBe(false)
  })

  it("keeps two rendered page previews separate from verified original PDF evidence", () => {
    const rows = triage().replacementCandidates.filter(row => row.category === "gaokao")
    expect(rows.find(row => row.slotId === "GK-S10")).toMatchObject({
      status: "page_preview_checked_needs_pdf_and_independent_review",
      previewImageUrl: "https://cdn.att.tthaoke.com/testpaper/preview/8/8b0d7586467107bcc47c3e8d0a1cb0e2/p002.jpg",
      previewImageSha256: "c55a6570ec1da8dcf1cf547b5560b73bba9ced867a9c68679a58fbc9f745cf86", previewPage: 2
    })
    expect(rows.find(row => row.slotId === "GK-S15")).toMatchObject({
      status: "page_preview_checked_needs_pdf_and_independent_review",
      previewImageUrl: "https://cdn.att.tthaoke.com/testpaper/preview/2/20fda96f61ae09480ea11dff410a071d/p003.jpg",
      previewImageSha256: "b4f7535e0d3d2e421c0c701c397b64b54314ddc2a50a61712d8e2229ccacf7af", previewPage: 3
    })
    expect(rows.filter(row => row.status === "page_preview_checked_needs_pdf_and_independent_review").map(row => row.slotId)).toEqual(["GK-S10", "GK-S15"])
    expect(rows.filter(row => row.status === "page_preview_checked_needs_pdf_and_independent_review" && row.originalPaperSha256)).toEqual([])
  })

  it("rechecks five retained planar problems from matching original exam pages", () => {
    const row = triage().retained.find(x => x.id === "GK-P09")
    expect(row).toMatchObject({
      status: "pdf_page_checked_needs_independent_review",
      originalPaperUrl: "https://cdn.zizzs.com/zixunzhan/202310/c15dec3e-666b-4c24-a7fb-7d66a2f1d1f1.pdf",
      originalPaperSha256: "56877d60bea527f9025ffa697672f228414c9e2c39b534518109646c637c2ed4",
      originalPaperPage: 2
    })
    expect(triage().retained.find(x => x.id === "GK-P02")).toMatchObject({
      status: "pdf_page_checked_needs_independent_review",
      originalPaperUrl: "https://m.shsbnu.net/pluginfile.php/54461/mod_folder/content/0/2022%E5%B9%B4%E9%AB%98%E8%80%83%E7%9C%9F%E9%A2%98%E5%85%A8%E5%9B%BD%E4%B9%99%E5%8D%B7%E7%90%86%E7%A7%91%E6%95%B0%E5%AD%A6%E8%AF%95%E5%8D%B7-%E5%AD%A6%E7%94%9F%E7%94%A8%E5%8D%B7.pdf",
      originalPaperSha256: "fb7509622fe55a681f6145067c0a91c6377aeb127f78cd3f60818c72551448dc", originalPaperPage: 5
    })
    expect(triage().retained.find(x => x.id === "GK-P05")).toMatchObject({
      status: "pdf_page_checked_needs_independent_review",
      originalPaperUrl: "https://imgs.app.gaokaozhitongche.com/resource/pdf/paper/202203/20220330210833_JN29ez.pdf",
      originalPaperSha256: "3318ba55310181e2320c92b46b2997a2d57d1547d21dea278d3f068975ba494d",
      originalPaperPage: 4
    })
    for (const [id, page] of [["GK-P03", 6], ["GK-P08", 5]] as const) {
      expect(triage().retained.find(x => x.id === id)).toMatchObject({
        status: "pdf_page_checked_needs_independent_review",
        originalPaperUrl: "https://m.shsbnu.net/pluginfile.php/54461/mod_folder/content/0/2022%E5%B9%B4%E9%AB%98%E8%80%83%E7%9C%9F%E9%A2%98%E5%85%A8%E5%9B%BD%E7%94%B2%E5%8D%B7%E7%90%86%E7%A7%91%E6%95%B0%E5%AD%A6%E8%AF%95%E5%8D%B7-%E5%AD%A6%E7%94%9F%E7%94%A8%E5%8D%B7.pdf",
        originalPaperSha256: "f8362915a798b85da50ece7be83783264ed3c4920328cb5b5911910475862625", originalPaperPage: page
      })
    }
    expect(triage().retained.filter(x => x.status === "pdf_page_checked_needs_independent_review").map(x => x.id)).toEqual(["GK-P02", "GK-P03", "GK-P05", "GK-P08", "GK-P09"])
  })

  it("flags GK-P07 as a wrong-year-paper attribution while preserving its frozen old prompt", () => {
    const row = triage().retained.find(x => x.id === "GK-P07")
    expect(row).toMatchObject({
      status: "pdf_page_checked_source_mismatch_requires_new_manifest",
      sourceCorrection: "2021 全国乙卷理科数学 第21题",
      originalPaperUrl: "https://17094505.s21i.faiusr.com/61/ABUIABA9GAAgvrzahwYozMrcogY.pdf",
      originalPaperSha256: "b634210a76e3fe59c084816466bfa2d134382b5c28d30e46dfa36a78b21e97c0",
      originalPaperPage: 4
    })
    expect(row?.source).toBe(legacy.cases.find(x => x.id === "GK-P07")?.source)
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
        if (!["GK-S11", "GK-S12", "GK-S13", "GK-S14", "GK-S16", "GK-S17", "GK-S10", "GK-S15"].includes(candidate.slotId)) expect(candidate.status).toBe("transcript_only_needs_paper")
      }
    }
  })
})
