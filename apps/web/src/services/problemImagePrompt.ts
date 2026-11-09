import { MAX_PROBLEM_IMAGES } from "./problemImageFiles"
import { imageReadingText, parseImageReadingItems, type ImageReadingItem, type ProblemImageReading } from "./problemImageReader"
import { isDiagramLine, isGraphChoiceProblem, isGraphChoiceReading } from "./problemImageReview"
import type { ImageEvidenceGap, ImageEvidenceTarget } from "./problemImageEvidence"

const DIAGRAM_SECTION = "\n\n【配图参考（模型读图）】\n"

/** W4：题图不再是"一串备注"，而是**带附件身份与目标缺口**的结构化证据。 */
export interface ImageSourceAttachment {
  attachmentId: string
  sha256: string
  page: number
}

export interface ImageAuditMeta {
  attachments: readonly ImageSourceAttachment[]
  target?: ImageEvidenceTarget
  gaps?: readonly Pick<ImageEvidenceGap, "code" | "message" | "required">[]
  rereads?: number
}

interface ImageEvidence {
  version: 1 | 2
  transcriptEdited: boolean
  diagram: ImageReadingItem[]
  uncertainties: ImageReadingItem[]
  reviewed: number[]
  attachments?: ImageSourceAttachment[]
  target?: ImageEvidenceTarget
  gaps?: Pick<ImageEvidenceGap, "code" | "message" | "required">[]
  rereads?: number
}

const SHA256 = /^[a-f0-9]{64}$/i

export function imagePrompt(problem: string, instructions: string, observations: readonly string[] | ProblemImageReading, reviewed: readonly number[] = [], confirmedLines: readonly number[] = [], audit?: ImageAuditMeta): string {
  const prompt = [problem.trim(), instructions.trim()].filter(Boolean).join("\n")
  if ("diagram" in observations) {
    const graphChoice = isGraphChoiceProblem(observations.problem)
    const evidence: ImageEvidence = {
      version: audit === undefined ? 1 : 2,
      transcriptEdited: problem.trim() !== observations.problem,
      diagram: observations.diagram.filter((item, index) => (!graphChoice || !isGraphChoiceReading(item.text))
        && (!isDiagramLine(item) || confirmedLines.includes(index))),
      uncertainties: observations.uncertainties.map(item => isDiagramLine(item)
        ? { ...item, text: "配图的连接或虚实线有疑点。线条读数以用户勾选的项目为准。" }
        : item),
      reviewed: [...reviewed],
      ...(audit === undefined ? {} : {
        attachments: audit.attachments.map(attachment => ({ ...attachment })),
        ...(audit.target === undefined ? {} : { target: audit.target }),
        ...(audit.gaps === undefined ? {} : { gaps: audit.gaps.map(gap => ({ ...gap })) }),
        ...(audit.rereads === undefined ? {} : { rereads: audit.rereads })
      })
    }
    return prompt + DIAGRAM_SECTION + JSON.stringify(evidence)
  }
  if (observations.length === 0) return prompt
  return prompt + DIAGRAM_SECTION + observations.map((item) => "- " + item.replace(/\s+/g, " ")).join("\n")
}

function readEvidence(notes: string): ImageEvidence | null {
  if (!notes.startsWith("{") || notes.length > 32_000) return null
  try {
    const value = JSON.parse(notes)
    if ((value?.version !== 1 && value?.version !== 2) || typeof value.transcriptEdited !== "boolean" || !Array.isArray(value.reviewed)) return null
    const diagram = parseImageReadingItems(value.diagram, MAX_PROBLEM_IMAGES)
    // The app can add two checks beyond the model's 40-item limit.
    const uncertainties = parseImageReadingItems(value.uncertainties, MAX_PROBLEM_IMAGES, 42)
    if (!diagram || !uncertainties || value.reviewed.length > uncertainties.length
      || !value.reviewed.every((index: unknown) => typeof index === "number" && Number.isInteger(index) && index >= 0 && index < uncertainties.length)) return null
    if (value.version === 1) return { version: 1, transcriptEdited: value.transcriptEdited, diagram, uncertainties, reviewed: value.reviewed }
    // W4：附件身份必须逐条合法；坏掉一条就整份退回 v1 语义（读不出图证据，不假装有）。
    if (!Array.isArray(value.attachments) || value.attachments.length === 0 || value.attachments.length > MAX_PROBLEM_IMAGES) return null
    const attachments: ImageSourceAttachment[] = []
    for (const attachment of value.attachments) {
      if (typeof attachment?.attachmentId !== "string" || !attachment.attachmentId
        || typeof attachment.sha256 !== "string" || !SHA256.test(attachment.sha256)
        || !Number.isInteger(attachment.page) || attachment.page < 1) return null
      attachments.push({ attachmentId: attachment.attachmentId, sha256: attachment.sha256.toLowerCase(), page: attachment.page })
    }
    const target: ImageEvidenceTarget | undefined = value.target === "volume" || value.target === "graph-choice" ? value.target : undefined
    const gaps = Array.isArray(value.gaps)
      ? value.gaps.slice(0, 8).filter((gap: unknown): gap is Pick<ImageEvidenceGap, "code" | "message" | "required"> => {
          const entry = gap as Record<string, unknown>
          return typeof entry?.code === "string" && typeof entry.message === "string" && typeof entry.required === "boolean"
        }).map((gap: Pick<ImageEvidenceGap, "code" | "message" | "required">) => ({ code: gap.code, message: gap.message.slice(0, 300), required: gap.required }))
      : []
    const rereads = Number.isInteger(value.rereads) && value.rereads >= 0 ? value.rereads : undefined
    return { version: 2, transcriptEdited: value.transcriptEdited, diagram, uncertainties, reviewed: value.reviewed,
      attachments, ...(target === undefined ? {} : { target }), gaps, ...(rereads === undefined ? {} : { rereads }) }
  } catch {
    return null
  }
}

function formatEvidence(evidence: ImageEvidence): string {
  const source = (item: ImageReadingItem) => {
    const label = item.image === null ? "原图" : "图 " + item.image
    const location = item.box ? " [" + item.box.join(", ") + "]" : "（位置待核对）"
    return label + location + " " + imageReadingText(item).replace(/\s+/g, " ")
  }
  const required = (evidence.gaps ?? []).filter(gap => gap.required)
  return [
    ...(evidence.transcriptEdited ? ["题干已由用户修订。"] : []),
    ...evidence.diagram.map(item => "- 配图读数 " + source(item)),
    ...evidence.uncertainties.map((item, index) =>
      "- " + (evidence.reviewed.includes(index) ? "用户已核对疑点 " : "待核对疑点 ") + source(item)),
    ...(evidence.rereads === undefined ? [] : [`- 本题已定向重读 ${evidence.rereads} 次。`]),
    ...required.map(gap => `- 图证据缺口（未解决）：${gap.message}`)
  ].join("\n")
}

export function splitImagePrompt(text: string): {
  prompt: string
  imageNotes: string
  imageEvidence?: ImageEvidence
  sourceAttachments?: ImageSourceAttachment[]
  imageTarget?: ImageEvidenceTarget
  imageGaps?: Pick<ImageEvidenceGap, "code" | "message" | "required">[]
} {
  // Legacy imports called OCR observations confirmed. Treat those lines as image notes as well.
  const legacy = /^配图已核对[：:]([^\r\n]*)\r?\n/.exec(text)
  const input = legacy ? text.slice(legacy[0].length).trimStart() : text
  const boundary = input.lastIndexOf(DIAGRAM_SECTION)
  const notes = boundary < 0 ? "" : input.slice(boundary + DIAGRAM_SECTION.length)
  const evidence = readEvidence(notes)
  return {
    prompt: boundary < 0 ? input : input.slice(0, boundary),
    imageNotes: [legacy?.[1], evidence ? formatEvidence(evidence) : notes].filter(Boolean).join("\n"),
    ...(evidence === null ? {} : { imageEvidence: evidence }),
    ...(evidence?.attachments === undefined ? {} : { sourceAttachments: evidence.attachments }),
    ...(evidence?.target === undefined ? {} : { imageTarget: evidence.target }),
    ...(evidence?.gaps === undefined ? {} : { imageGaps: evidence.gaps })
  }
}
