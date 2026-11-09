import { describe, expect, it } from "vitest"

import { imagePrompt, splitImagePrompt, type ImageAuditMeta } from "./problemImagePrompt"
import type { ProblemImageReading } from "./problemImageReader"

/**
 * **W4：题图证据要保住附件身份（2026-11-09）**。
 *
 * 历史缺口是"发送给 Agent 的只有一串 imageNotes 文本"：宿主再也拿不到"这是哪张图、
 * 哪个哈希"，于是无法在重读之后让旧证据失效。version 2 把附件句柄、目标与未解决缺口
 * 一起带走，并且**坏掉的哈希必须退回旧语义**（读不出证据 ≠ 有证据）。
 */

const sha = "a".repeat(64)
const reading: ProblemImageReading = {
  problem: "如图，求该几何体的体积。",
  diagram: [{ text: "图1", image: 1, box: null }],
  uncertainties: []
}

const audit: ImageAuditMeta = {
  attachments: [{ attachmentId: "image-1", sha256: sha, page: 1 }],
  target: "volume",
  gaps: [{ code: "missing_dimension", message: "体积目标没有任何可核验的数值尺寸。", required: true }],
  rereads: 2
}

describe("W4 — 附件身份随提示词一起送达", () => {
  it("round-trips attachments, target, gaps and the reread count", () => {
    const text = imagePrompt(reading.problem, "", reading, [], [], audit)
    const sent = splitImagePrompt(text)

    expect(sent.prompt).toBe(reading.problem)
    expect(sent.sourceAttachments).toEqual(audit.attachments)
    expect(sent.imageTarget).toBe("volume")
    expect(sent.imageGaps).toEqual(audit.gaps)
    expect(sent.imageEvidence?.rereads).toBe(2)
    expect(sent.imageNotes).toContain("图证据缺口（未解决）")
    expect(sent.imageNotes).toContain("定向重读 2 次")
  })

  it("keeps the legacy version-1 payload readable", () => {
    const legacy = imagePrompt(reading.problem, "", reading)
    const sent = splitImagePrompt(legacy)

    expect(sent.imageEvidence?.version).toBe(1)
    expect(sent.sourceAttachments).toBeUndefined()
    expect(sent.imageGaps).toBeUndefined()
  })

  it("drops the whole evidence block when an attachment hash is invalid", () => {
    const text = imagePrompt(reading.problem, "", reading, [], [], { ...audit, attachments: [{ attachmentId: "image-1", sha256: "zz", page: 1 }] })
    const sent = splitImagePrompt(text)

    expect(sent.imageEvidence).toBeUndefined()
    expect(sent.sourceAttachments).toBeUndefined()
    expect(sent.prompt).toBe(reading.problem)
  })

  it("never carries a missing gap beyond the payload cap", () => {
    const many = Array.from({ length: 20 }, () => ({ code: "missing_dimension" as const, message: "x", required: true }))
    const sent = splitImagePrompt(imagePrompt(reading.problem, "", reading, [], [], { ...audit, gaps: many }))
    expect(sent.imageGaps?.length).toBe(8)
  })
})
