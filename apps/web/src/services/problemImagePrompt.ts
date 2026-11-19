import { MAX_PROBLEM_IMAGES } from "./problemImageFiles"
import { ALLOWED_OBSERVATION_KINDS, imageReadingText, parseImageReadingItems, type ImageBox, type ImageObservationKind, type ImageReadingItem, type ProblemImageReading } from "./problemImageReader"
import {
  classifyObservation,
  computeReadingRevision,
  findDuplicateObservationIds,
  isDiagramLine,
  isGraphChoiceProblem,
  isGraphChoiceReading,
  observationDigest,
  observationId,
  observationRequiresConfirmation
} from "./problemImageReview"

const DIAGRAM_SECTION = "\n\n【配图参考（模型读图）】\n"

export interface ConfirmedObservationProof {
  id: string
  digest: string
  kind: ImageObservationKind
  image: number | null
  box: ImageBox | null
}

interface ImageEvidence {
  version: 1
  transcriptEdited: boolean
  diagram: ImageReadingItem[]
  uncertainties: ImageReadingItem[]
  reviewed: number[]
  revision?: string
  imageHashes?: string[]
  confirmations?: ConfirmedObservationProof[]
  unconfirmedObservations?: number
}

function sameBox(left: ImageBox | null, right: ImageBox | null): boolean {
  if (left === null || right === null) return left === right
  return left.every((value, index) => value === right[index])
}

function parseConfirmationProofs(value: unknown): ConfirmedObservationProof[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 40) return undefined
  const proofs: ConfirmedObservationProof[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return undefined
    const candidate = entry as Record<string, unknown>
    if (typeof candidate.id !== "string" || !candidate.id || typeof candidate.digest !== "string" || !candidate.digest) return undefined
    if (typeof candidate.kind !== "string" || !(ALLOWED_OBSERVATION_KINDS as readonly string[]).includes(candidate.kind)) return undefined
    if (candidate.image !== null && (typeof candidate.image !== "number" || !Number.isInteger(candidate.image) || candidate.image < 1)) return undefined
    const box = candidate.box === null
      ? null
      : Array.isArray(candidate.box) && candidate.box.length === 4 && candidate.box.every(coord => typeof coord === "number")
        ? candidate.box as ImageBox
        : undefined
    if (box === undefined) return undefined
    proofs.push({
      id: candidate.id,
      digest: candidate.digest,
      kind: candidate.kind as ImageObservationKind,
      image: candidate.image,
      box
    })
  }
  return proofs
}

export function imagePrompt(
  problem: string,
  instructions: string,
  observations: readonly string[] | ProblemImageReading,
  reviewed: readonly number[] = [],
  confirmedLines: readonly number[] = [],
  reviewMeta?: { revision?: string; imageHashes?: readonly string[] }
): string {
  const prompt = [problem.trim(), instructions.trim()].filter(Boolean).join("\n")
  if ("diagram" in observations) {
    const graphChoice = isGraphChoiceProblem(observations.problem)
    const imageHashes = reviewMeta?.imageHashes
    const validImageHashes = imageHashes === undefined ||
      (imageHashes.length >= 1 && imageHashes.length <= MAX_PROBLEM_IMAGES && imageHashes.every(hash => /^[a-f0-9]{64}$/.test(hash)))
    const revision = computeReadingRevision(observations, problem, imageHashes)
    const revisionValid = validImageHashes && (reviewMeta?.revision === undefined || reviewMeta.revision === revision)
    const effectiveReviewed = revisionValid ? [...reviewed] : []
    const effectiveConfirmed = revisionValid ? confirmedLines : []
    const duplicateIds = findDuplicateObservationIds(observations.diagram)
    const confirmedDiagram: ImageReadingItem[] = []
    const confirmations: ConfirmedObservationProof[] = []

    observations.diagram.forEach((item, index) => {
      if (graphChoice && isGraphChoiceReading(item.text)) return
      const explicitId = item.id?.trim()
      if (explicitId && duplicateIds.has(explicitId)) return
      const kind = classifyObservation(item)
      const needsConfirm = observationRequiresConfirmation(item)
      if (needsConfirm && !effectiveConfirmed.includes(index)) return
      confirmedDiagram.push(item)
      if (needsConfirm) {
        confirmations.push({
          id: observationId(item, index),
          digest: observationDigest(item),
          kind,
          image: item.image,
          box: item.box
        })
      }
    })

    const evidence: ImageEvidence = {
      version: 1,
      transcriptEdited: problem.trim() !== observations.problem,
      diagram: confirmedDiagram,
      uncertainties: observations.uncertainties.map(item => isDiagramLine(item)
        ? { ...item, text: "配图的连接或虚实线有疑点。线条读数以用户勾选的项目为准。" }
        : item),
      reviewed: effectiveReviewed,
      revision,
      ...(validImageHashes && imageHashes !== undefined ? { imageHashes: [...imageHashes] } : {}),
      ...(confirmations.length > 0 ? { confirmations } : {})
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
    const rawDiagram = parseImageReadingItems(value.diagram, MAX_PROBLEM_IMAGES)
    // The app can add two checks beyond the model's 40-item limit.
    const uncertainties = parseImageReadingItems(value.uncertainties, MAX_PROBLEM_IMAGES, 42)
    if (!rawDiagram || !uncertainties || value.reviewed.length > uncertainties.length
      || !value.reviewed.every((index: unknown) => typeof index === "number" && Number.isInteger(index) && index >= 0 && index < uncertainties.length)) return null

    const confirmations = parseConfirmationProofs(value.confirmations) ?? []
    const duplicateIds = findDuplicateObservationIds(rawDiagram)
    let unconfirmedObservations = 0
    const diagram = rawDiagram.filter((item) => {
      const explicitId = item.id?.trim()
      if (explicitId && duplicateIds.has(explicitId)) {
        unconfirmedObservations += 1
        return false
      }
      const kind = classifyObservation(item)
      if (kind === "label" || kind === "scalar") return true
      const digest = observationDigest(item)
      const matched = confirmations.some((proof) =>
        proof.digest === digest && proof.kind === kind && proof.image === item.image && sameBox(proof.box, item.box))
      if (!matched) {
        unconfirmedObservations += 1
        return false
      }
      return true
    })

    const revision = typeof value.revision === "string" && value.revision.length > 0 ? value.revision : undefined
    const imageHashes = value.imageHashes === undefined ? undefined :
      Array.isArray(value.imageHashes) && value.imageHashes.length >= 1 && value.imageHashes.length <= MAX_PROBLEM_IMAGES &&
        value.imageHashes.every((hash: unknown) => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash))
        ? value.imageHashes as string[] : null
    if (imageHashes === null) return null
    return {
      version: 1,
      transcriptEdited: value.transcriptEdited,
      diagram,
      uncertainties,
      reviewed: value.reviewed,
      ...(revision === undefined ? {} : { revision }),
      ...(imageHashes === undefined ? {} : { imageHashes }),
      ...(confirmations.length === 0 ? {} : { confirmations }),
      ...(unconfirmedObservations === 0 ? {} : { unconfirmedObservations })
    }
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
