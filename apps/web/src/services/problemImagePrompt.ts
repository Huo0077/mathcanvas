import { MAX_PROBLEM_IMAGES } from "./problemImageFiles"
import { imageReadingText, parseImageReadingItems, type ImageReadingItem, type ProblemImageReading } from "./problemImageReader"
import { isDiagramLine, isGraphChoiceProblem, isGraphChoiceReading } from "./problemImageReview"

const DIAGRAM_SECTION = "\n\n【配图参考（模型读图）】\n"

interface ImageEvidence {
  version: 1
  transcriptEdited: boolean
  diagram: ImageReadingItem[]
  uncertainties: ImageReadingItem[]
  reviewed: number[]
}

export function imagePrompt(problem: string, instructions: string, observations: readonly string[] | ProblemImageReading, reviewed: readonly number[] = [], confirmedLines: readonly number[] = []): string {
  const prompt = [problem.trim(), instructions.trim()].filter(Boolean).join("\n")
  if ("diagram" in observations) {
    const graphChoice = isGraphChoiceProblem(observations.problem)
    const evidence: ImageEvidence = {
      version: 1,
      transcriptEdited: problem.trim() !== observations.problem,
      diagram: observations.diagram.filter((item, index) => (!graphChoice || !isGraphChoiceReading(item.text))
        && (!isDiagramLine(item) || confirmedLines.includes(index))),
      uncertainties: observations.uncertainties.map(item => isDiagramLine(item)
        ? { ...item, text: "配图的连接或虚实线有疑点。线条读数以用户勾选的项目为准。" }
        : item),
      reviewed: [...reviewed]
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
    if (value?.version !== 1 || typeof value.transcriptEdited !== "boolean" || !Array.isArray(value.reviewed)) return null
    const diagram = parseImageReadingItems(value.diagram, MAX_PROBLEM_IMAGES)
    // The app can add two checks beyond the model's 40-item limit.
    const uncertainties = parseImageReadingItems(value.uncertainties, MAX_PROBLEM_IMAGES, 42)
    if (!diagram || !uncertainties || value.reviewed.length > uncertainties.length
      || !value.reviewed.every((index: unknown) => typeof index === "number" && Number.isInteger(index) && index >= 0 && index < uncertainties.length)) return null
    return { version: 1, transcriptEdited: value.transcriptEdited, diagram, uncertainties, reviewed: value.reviewed }
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
  return [
    ...(evidence.transcriptEdited ? ["题干已由用户修订。"] : []),
    ...evidence.diagram.map(item => "- 配图读数 " + source(item)),
    ...evidence.uncertainties.map((item, index) =>
      "- " + (evidence.reviewed.includes(index) ? "用户已核对疑点 " : "待核对疑点 ") + source(item))
  ].join("\n")
}

export function splitImagePrompt(text: string): { prompt: string; imageNotes: string; imageEvidence?: ImageEvidence } {
  // Legacy imports called OCR observations confirmed. Treat those lines as image notes as well.
  const legacy = /^配图已核对[：:]([^\r\n]*)\r?\n/.exec(text)
  const input = legacy ? text.slice(legacy[0].length).trimStart() : text
  const boundary = input.lastIndexOf(DIAGRAM_SECTION)
  const notes = boundary < 0 ? "" : input.slice(boundary + DIAGRAM_SECTION.length)
  const evidence = readEvidence(notes)
  return {
    prompt: boundary < 0 ? input : input.slice(0, boundary),
    imageNotes: [legacy?.[1], evidence ? formatEvidence(evidence) : notes].filter(Boolean).join("\n"),
    ...(evidence === null ? {} : { imageEvidence: evidence })
  }
}
