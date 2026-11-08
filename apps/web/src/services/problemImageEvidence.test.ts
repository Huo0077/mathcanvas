import { describe, expect, it } from "vitest"

import type { ImageBox } from "./problemImageReader"
import {
  auditProblemImage,
  buildImageFact,
  diagnosticLine,
  mergeImageEvidence,
  planImageReread,
  validateImageRef,
  type AttachmentHandle,
  type ImageEvidenceFact
} from "./problemImageEvidence"

/**
 * **W6 / T6：题图证据必须能追到原图区域，且冲突不许静默覆盖。**
 *
 * 这一组只测纯函数（不发模型请求、不读用户文件）：
 * ① 关键尺寸缺失/符号化 → 必须触发受控重读，而不是"按常见版本补数"；
 * ② 同一区域两次读数不同 → 记录冲突；用户更正优先，但原始读数保留；
 * ③ 重读最多 2 次、只限本次授权附件，跨会话/未知附件一律拒绝；
 * ④ 诊断只写句柄/哈希/短摘要，绝不写 base64 图片。
 */

const shaA = "a".repeat(64)
const shaB = "b".repeat(64)

const attachments: AttachmentHandle[] = [
  { attachmentId: "att-1", sha256: shaA, conversationId: "conv-1" },
  { attachmentId: "att-2", sha256: shaB, conversationId: "conv-1" }
]

const box: ImageBox = [0.1, 0.2, 0.4, 0.6]
const region = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }

function audit(overrides: Partial<Parameters<typeof auditProblemImage>[0]> = {}) {
  return auditProblemImage({
    attachments,
    conversationId: "conv-1",
    problem: "如图，沿对角线 AC 把矩形折起。求折后 BD 的长。",
    diagram: [],
    uncertainties: [],
    transcriptEdited: false,
    ...overrides
  })
}

describe("W6 — 关键尺寸缺失才触发重读", () => {
  it("flags a symbolic/absent dimension as a required reread", () => {
    const result = audit({ problem: "如图，长方体的高为 h，底面边长为 3。求体积。" })

    expect(result.gaps.some((gap) => gap.code === "missing_dimension" && gap.required)).toBe(true)
    const plan = planImageReread(result, 0)
    expect(plan.allowed).toBe(true)
    expect(plan.regions.length).toBeGreaterThan(0)
  })

  it("does not bother the reader when the dimension is a number", () => {
    const result = audit({ problem: "如图，长方体的高为 3，底面边长为 4。求体积。" })

    expect(result.gaps.some((gap) => gap.code === "missing_dimension")).toBe(false)
    expect(planImageReread(result, 0).allowed).toBe(false)
  })

  it("flags a vector whose direction is missing instead of guessing it", () => {
    const missing = audit({ problem: "如图，求向量 a 与 b 的夹角。", diagram: [{ text: "向量 a", image: 1, box }] })
    expect(missing.gaps.some((gap) => gap.code === "vector_direction_missing")).toBe(true)

    const present = audit({ problem: "如图，求向量 a 与 b 的夹角。", diagram: [
      { text: "向量 a", image: 1, box, arrow: { from: [0, 0], to: [1, 1] } },
      { text: "向量 b", image: 1, box, arrow: { from: [0, 0], to: [-1, 0.5] } }
    ] })
    expect(present.gaps.some((gap) => gap.code === "vector_direction_missing")).toBe(false)
  })
})

describe("W6 — 证据引用可追溯、且只限本次授权附件", () => {
  it("builds a normalised reference with attachment id, hash and region", () => {
    const fact = buildImageFact({ text: "AB=4", image: 1, box }, attachments, "conv-1")
    expect(fact).not.toBeNull()
    expect(fact?.ref).toMatchObject({ attachmentId: "att-1", sha256: shaA, page: 1, region, sourceKind: "ocr" })
  })

  it("rejects an out-of-range region, a bad hash and a foreign attachment", () => {
    expect(validateImageRef({ attachmentId: "att-1", sha256: shaA, page: 1, region: { ...region, width: 0 }, sourceKind: "ocr" })).toBe(false)
    expect(validateImageRef({ attachmentId: "att-1", sha256: shaA, page: 1, region: { ...region, x: 0.9, width: 0.4 }, sourceKind: "ocr" })).toBe(false)
    expect(validateImageRef({ attachmentId: "att-1", sha256: "zz", page: 1, region, sourceKind: "ocr" })).toBe(false)
    expect(validateImageRef({ attachmentId: "ghost", sha256: shaA, page: 1, region, sourceKind: "ocr" }, attachments, "conv-1")).toBe(false)
  })

  it("re-reads at most twice, deduplicated by region", () => {
    const result = audit({ problem: "如图，长方体的高为 h，宽为 w，底面边长为 3。求体积。", diagram: [
      { text: "底面", image: 1, box },
      { text: "侧面", image: 2, box: [0.5, 0.5, 0.7, 0.7] }
    ] })

    const first = planImageReread(result, 0)
    expect(first.allowed).toBe(true)
    expect(first.regions.length).toBeLessThanOrEqual(2)
    expect(new Set(first.regions.map((item) => `${item.attachmentId}:${item.region.x}`)).size).toBe(first.regions.length)

    const exhausted = planImageReread(result, 2)
    expect(exhausted.allowed).toBe(false)
    expect(exhausted.reasonCodes).toContain("budget_exhausted")
  })
})

describe("W6 — 次序变化不制造重复，冲突不静默覆盖", () => {
  it("matches facts by region, not by the order the model listed them", () => {
    const first = audit({ diagram: [
      { text: "A：开口向上", image: 1, box: [0.1, 0.1, 0.3, 0.3] },
      { text: "B：开口向下", image: 1, box: [0.6, 0.1, 0.8, 0.3] }
    ] })
    const second = audit({ diagram: [
      { text: "B：开口向下", image: 1, box: [0.6, 0.1, 0.8, 0.3] },
      { text: "A：开口向上", image: 1, box: [0.1, 0.1, 0.3, 0.3] }
    ] })

    const merged = mergeImageEvidence(first.facts, second.facts)
    expect(merged.conflicts).toEqual([])
    expect(merged.facts).toHaveLength(2)
  })

  it("keeps the user correction and records the visual conflict", () => {
    const ocr: ImageEvidenceFact = {
      id: "fact-ocr",
      ref: { attachmentId: "att-1", sha256: shaA, page: 1, region, sourceKind: "ocr" },
      text: "AC=6",
      confidence: "low"
    }
    const corrected: ImageEvidenceFact = {
      id: "fact-user",
      ref: { attachmentId: "att-1", sha256: shaA, page: 1, region, sourceKind: "user_correction" },
      text: "AC=5",
      confidence: "high"
    }

    const merged = mergeImageEvidence([ocr], [corrected])
    expect(merged.facts).toHaveLength(1)
    expect(merged.facts[0]?.text).toBe("AC=5")
    expect(merged.facts[0]?.ref.sourceKind).toBe("user_correction")
    expect(merged.conflicts[0]).toMatchObject({ kept: "fact-user", dropped: "fact-ocr", reason: "user_correction_wins" })
  })

  it("keeps the first reading and records a plain visual conflict when neither is a user correction", () => {
    const first: ImageEvidenceFact = { id: "f1", ref: { attachmentId: "att-1", sha256: shaA, page: 1, region, sourceKind: "ocr" }, text: "AB=4", confidence: "low" }
    const second: ImageEvidenceFact = { id: "f2", ref: { attachmentId: "att-1", sha256: shaA, page: 1, region, sourceKind: "model_guess" }, text: "AB=6", confidence: "low" }

    const merged = mergeImageEvidence([first], [second])
    expect(merged.facts.map((fact) => fact.text)).toEqual(["AB=4"])
    expect(merged.conflicts[0]?.reason).toBe("visual_conflict")
  })
})

describe("W6 — 诊断只留句柄与短摘要", () => {
  it("never prints image bytes or base64 payloads", () => {
    const payload = "data:image/png;base64," + "A".repeat(400)
    const line = diagnosticLine([{ id: "f1", ref: { attachmentId: "att-1", sha256: shaA, page: 1, region, sourceKind: "ocr" }, text: payload, confidence: "high" }])

    expect(line).not.toContain("base64")
    expect(line).not.toContain("A".repeat(80))
    expect(line).toContain("att-1")
    expect(line).toContain(shaA.slice(0, 8))
    expect(line.length).toBeLessThanOrEqual(320)
  })
})
