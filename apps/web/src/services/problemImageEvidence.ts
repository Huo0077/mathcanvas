import type { ImageBox, ImageReadingItem } from "./problemImageReader"

/**
 * **题图证据与受控重读（W6 / T6，2026-11-08）**。
 *
 * 这里只做**纯函数**：不发起模型请求、不读取用户文件。它回答三个问题：
 *
 * 1. 这条读数**来自哪里**（哪个附件、哪个哈希、哪个归一化区域、谁给的）；
 * 2. 图上的关键证据**缺了什么**（符号化尺寸、没有方向的向量…）；
 * 3. 要不要重读、重读哪一块 —— 最多 2 次，且只限**本次会话授权的附件**。
 *
 * ## 为什么证据要带 sha256 + 区域
 *
 * 历史故障（mm-005 / mm-009 / mm-075）不是"看错了一个字"，而是**关键尺寸没有来源**，
 * 于是模型用"常见版本"补了一个数。把每条读数绑到 `(attachmentId, sha256, region)` 上之后，
 * "这个 3 是哪来的"才有唯一答案；附件被删、被换、跨会话引用时，引用立即失效。
 *
 * ## 冲突不静默覆盖
 *
 * 同一区域两次读数不同：**用户更正优先**，同时把被覆盖的原读数与原因记进 `conflicts`。
 * 没有用户更正时保留第一次读数（更接近首读）并标记 `visual_conflict`，绝不"取平均"或"挑好看的"。
 */

export const IMAGE_REREAD_LIMIT = 2

export type ImageSourceKind = "ocr" | "model_guess" | "user_correction" | "confirmed_line"

export interface AttachmentHandle {
  attachmentId: string
  /** 小写/大写十六进制均可，长度必须是 64。 */
  sha256: string
  /** 默认 1。 */
  page?: number
  /** 附件属于哪次会话；跨会话引用一律拒绝。 */
  conversationId?: string
}

export interface ImageRegion {
  x: number
  y: number
  width: number
  height: number
}

export interface ImageEvidenceRef {
  attachmentId: string
  sha256: string
  page: number
  /** `[0,1]` 归一化坐标；不允许用缩略图坐标冒充原图坐标。 */
  region: ImageRegion
  sourceKind: ImageSourceKind
}

export interface ImageEvidenceFact {
  id: string
  ref: ImageEvidenceRef
  text: string
  confidence: "high" | "low"
  unit?: string
  parsedValue?: number
}

export type ImageEvidenceGapCode =
  | "missing_dimension"
  | "vector_direction_missing"
  | "missing_source_ref"
  | "transcript_edited"

export interface ImageEvidenceGap {
  code: ImageEvidenceGapCode
  message: string
  /** `true` = 这条缺失会影响数学结论，值得用一次受限重读。 */
  required: boolean
  attachmentId?: string
  region?: ImageRegion
}

export interface ImageEvidenceConflict {
  kept: string
  dropped: string
  reason: "user_correction_wins" | "visual_conflict"
  key: string
}

export interface ImageEvidenceAudit {
  facts: ImageEvidenceFact[]
  gaps: ImageEvidenceGap[]
  attachments: AttachmentHandle[]
}

export interface RereadPlan {
  allowed: boolean
  used: number
  limit: number
  regions: { attachmentId: string; region: ImageRegion }[]
  reasonCodes: string[]
}

const FULL_IMAGE: ImageRegion = { x: 0, y: 0, width: 1, height: 1 }
const SHA256 = /^[a-f0-9]{64}$/i

const roundKey = (value: number): string => value.toFixed(4)

export function regionKey(region: ImageRegion): string {
  return `${roundKey(region.x)},${roundKey(region.y)},${roundKey(region.width)},${roundKey(region.height)}`
}

function validRegion(region: ImageRegion): boolean {
  const values = [region.x, region.y, region.width, region.height]
  return values.every((value) => Number.isFinite(value))
    && region.x >= 0 && region.y >= 0
    && region.width > 0 && region.height > 0
    && region.x + region.width <= 1 + 1e-9
    && region.y + region.height <= 1 + 1e-9
}

/**
 * 校验一条证据引用。给了 `attachments` 时必须**属于本次授权会话**，
 * 且哈希与登记值一致 —— 附件被替换后旧引用立即失效。
 */
export function validateImageRef(ref: ImageEvidenceRef, attachments?: readonly AttachmentHandle[], conversationId?: string): boolean {
  if (typeof ref.attachmentId !== "string" || ref.attachmentId.length === 0) return false
  if (!SHA256.test(ref.sha256)) return false
  if (!Number.isInteger(ref.page) || ref.page < 1) return false
  if (!validRegion(ref.region)) return false
  if (!["ocr", "model_guess", "user_correction", "confirmed_line"].includes(ref.sourceKind)) return false
  if (attachments !== undefined) {
    const attachment = attachments.find((candidate) => candidate.attachmentId === ref.attachmentId)
    if (attachment === undefined) return false
    if (attachment.sha256.toLowerCase() !== ref.sha256.toLowerCase()) return false
    if (conversationId !== undefined && attachment.conversationId !== undefined && attachment.conversationId !== conversationId) return false
    if ((attachment.page ?? 1) !== ref.page) return false
  }
  return true
}

function regionOf(box: ImageBox | null | undefined): ImageRegion {
  if (box === null || box === undefined) return FULL_IMAGE
  // 归一化坐标保留 4 位小数：既避免 0.30000000000000004 这类浮点噪声，
  // 也让"同一块区域"的键在两次读数之间稳定可比。
  const round = (value: number): number => Math.round(value * 10_000) / 10_000
  return { x: round(box[0]), y: round(box[1]), width: round(box[2] - box[0]), height: round(box[3] - box[1]) }
}

export interface DiagramItemInput {
  text: string
  image: number | null
  box: ImageBox | null
  arrow?: { from: [number, number]; to: [number, number] }
  sourceKind?: ImageSourceKind
}

/**
 * 把一条读数绑到授权附件上。`image` 是 1 起始的附件序号；对不上就返回 `null`（不猜）。
 */
export function buildImageFact(item: DiagramItemInput, attachments: readonly AttachmentHandle[], conversationId?: string): ImageEvidenceFact | null {
  if (item.image === null) return null
  const attachment = attachments[item.image - 1]
  if (attachment === undefined) return null
  const region = regionOf(item.box)
  const ref: ImageEvidenceRef = {
    attachmentId: attachment.attachmentId,
    sha256: attachment.sha256,
    page: attachment.page ?? 1,
    region,
    sourceKind: item.sourceKind ?? "ocr"
  }
  if (!validateImageRef(ref, attachments, conversationId)) return null
  return {
    id: `fact-${attachment.attachmentId}-${regionKey(region)}`,
    ref,
    text: item.text,
    confidence: item.box === null ? "low" : "high"
  }
}

/** 数值或根式才算"有来源的尺寸"；`h`、`k` 这类符号不算。 */
function parseDimension(value: string): number | undefined {
  const text = value.replace(/\s/g, "").replace(/\\sqrt\s*\{([^{}]+)\}/g, "√$1").replace(/[，,。；;、]/g, "")
  const radical = /^√(\d+(?:\.\d+)?)$/.exec(text)
  if (radical !== null) return Math.sqrt(Number(radical[1]))
  const plain = /^[+\-−]?\d+(?:\.\d+)?$/.exec(text)
  return plain === null ? undefined : Number(plain[0]!.replace("−", "-"))
}

const DIMENSION = /(长度|长|宽度|宽|高度|高|半径|直径|边长|底面积|侧面积|表面积|体积|角度)\s*(?:为|是|等于)\s*([^\s，。；,;、]{1,10})/g

function dimensionGaps(problem: string, fallback: { attachmentId: string; region: ImageRegion } | undefined): ImageEvidenceGap[] {
  const gaps: ImageEvidenceGap[] = []
  for (const match of problem.matchAll(DIMENSION)) {
    const value = match[2]!
    if (parseDimension(value) !== undefined) continue
    gaps.push({
      code: "missing_dimension",
      message: `题面把「${match[1]}」写成「${value}」，图上没有可核验的数值；不允许按常见版本补数。`,
      required: true,
      ...(fallback === undefined ? {} : { attachmentId: fallback.attachmentId, region: fallback.region })
    })
  }
  return gaps
}

/** 有"向量/箭头"的题里，每支向量都必须有方向；读不到就是条件缺失，不是默认向右。 */
function vectorGaps(problem: string, arrows: number, fallback: { attachmentId: string; region: ImageRegion } | undefined): ImageEvidenceGap[] {
  if (!/向量|箭头/.test(problem) || arrows > 0) return []
  return [{
    code: "vector_direction_missing",
    message: "题面依赖图中的向量，但没有读到任何起点与终点都有效的箭头；不能默认方向。",
    required: true,
    ...(fallback === undefined ? {} : { attachmentId: fallback.attachmentId, region: fallback.region })
  }]
}

export interface AuditProblemImageInput {
  attachments: readonly AttachmentHandle[]
  conversationId?: string
  problem: string
  diagram: readonly DiagramItemInput[]
  uncertainties?: readonly DiagramItemInput[]
  /** 用户改过题干：图上读数与用户更正可能冲突，需要保留原文对照。 */
  transcriptEdited?: boolean
}

export function auditProblemImage(input: AuditProblemImageInput): ImageEvidenceAudit {
  const facts: ImageEvidenceFact[] = []
  const gaps: ImageEvidenceGap[] = []
  let arrows = 0
  for (const item of input.diagram) {
    const fact = buildImageFact(item, input.attachments, input.conversationId)
    if (fact === null) {
      gaps.push({ code: "missing_source_ref", message: `读数「${item.text.slice(0, 40)}」没有可追溯的附件位置。`, required: false })
      continue
    }
    facts.push(fact)
    if (item.arrow !== undefined && item.arrow.from.every(Number.isFinite) && item.arrow.to.every(Number.isFinite)
      && (item.arrow.from[0] !== item.arrow.to[0] || item.arrow.from[1] !== item.arrow.to[1])) arrows += 1
  }

  const fallbackRef = facts[0]?.ref
  const fallback = fallbackRef === undefined
    ? input.attachments[0] === undefined ? undefined : { attachmentId: input.attachments[0].attachmentId, region: FULL_IMAGE }
    : { attachmentId: fallbackRef.attachmentId, region: fallbackRef.region }

  gaps.push(...dimensionGaps(input.problem, fallback))
  gaps.push(...vectorGaps(input.problem, arrows, fallback))
  if (input.transcriptEdited === true) {
    gaps.push({ code: "transcript_edited", message: "题干已由用户修订；图上读数与题干的冲突按用户更正优先。", required: false })
  }

  return { facts, gaps, attachments: [...input.attachments] }
}

/** 同一块区域只认一条：先到先留；用户更正可以覆盖 OCR，并留下冲突记录。 */
export function mergeImageEvidence(previous: readonly ImageEvidenceFact[], next: readonly ImageEvidenceFact[]): { facts: ImageEvidenceFact[]; conflicts: ImageEvidenceConflict[] } {
  const merged: ImageEvidenceFact[] = []
  const conflicts: ImageEvidenceConflict[] = []
  const incoming = new Map<string, ImageEvidenceFact[]>()
  for (const fact of next) {
    const key = `${fact.ref.attachmentId}:${regionKey(fact.ref.region)}`
    const list = incoming.get(key) ?? []
    list.push(fact)
    incoming.set(key, list)
  }

  const take = (existing: ImageEvidenceFact, candidate: ImageEvidenceFact): void => {
    const key = `${existing.ref.attachmentId}:${regionKey(existing.ref.region)}`
    if (existing.text === candidate.text) {
      // 文本一致时保留更可信的来源（用户更正 > 已确认线条 > OCR > 模型猜测）。
      const rank: Record<ImageSourceKind, number> = { user_correction: 3, confirmed_line: 2, ocr: 1, model_guess: 0 }
      if (rank[candidate.ref.sourceKind] > rank[existing.ref.sourceKind]) merged.push({ ...candidate, id: existing.id })
      else merged.push(existing)
      return
    }
    if (candidate.ref.sourceKind === "user_correction") {
      merged.push(candidate)
      conflicts.push({ kept: candidate.id, dropped: existing.id, reason: "user_correction_wins", key })
      return
    }
    if (existing.ref.sourceKind === "user_correction") {
      conflicts.push({ kept: existing.id, dropped: candidate.id, reason: "user_correction_wins", key })
      merged.push(existing)
      return
    }
    conflicts.push({ kept: existing.id, dropped: candidate.id, reason: "visual_conflict", key })
    merged.push(existing)
  }

  for (const fact of previous) {
    const key = `${fact.ref.attachmentId}:${regionKey(fact.ref.region)}`
    const candidates = incoming.get(key) ?? []
    incoming.delete(key)
    const first = candidates[0]
    if (first === undefined) merged.push(fact)
    else take(fact, first)
  }
  for (const candidates of incoming.values()) merged.push(...candidates)
  return { facts: merged, conflicts }
}

/**
 * **受控重读计划**：只对"会影响条件"的缺口重读；最多 `limit` 次；按区域去重。
 * 调用方负责真正发请求 —— 这一层只回答"该不该、读哪里"。
 */
export function planImageReread(audit: ImageEvidenceAudit, used: number, limit = IMAGE_REREAD_LIMIT): RereadPlan {
  const seen = new Set<string>()
  const regions: { attachmentId: string; region: ImageRegion }[] = []
  for (const gap of audit.gaps) {
    if (!gap.required || gap.attachmentId === undefined || gap.region === undefined) continue
    if (!audit.attachments.some((attachment) => attachment.attachmentId === gap.attachmentId)) continue
    const key = `${gap.attachmentId}:${regionKey(gap.region)}`
    if (seen.has(key)) continue
    seen.add(key)
    regions.push({ attachmentId: gap.attachmentId, region: gap.region })
  }

  if (used >= limit) return { allowed: false, used, limit, regions: [], reasonCodes: ["budget_exhausted"] }
  if (regions.length === 0) return { allowed: false, used, limit, regions: [], reasonCodes: ["no_required_gap"] }
  return { allowed: true, used, limit, regions: regions.slice(0, Math.max(0, limit - used)), reasonCodes: ["missing_evidence"] }
}

const BASE64_PAYLOAD = /data:[^\s]{0,80}?,[A-Za-z0-9+/=]{16,}/g

/**
 * **诊断行**：只有句柄、哈希前缀、区域与短摘要。
 * 图片字节与 base64 一律抹掉 —— 日志不是证据存放处。
 */
export function diagnosticLine(facts: readonly ImageEvidenceFact[]): string {
  const parts = facts.map((fact) => {
    const text = fact.text.replace(BASE64_PAYLOAD, "[image-bytes-omitted]").replace(/\s+/g, " ").slice(0, 40)
    const region = fact.ref.region
    return `${fact.ref.attachmentId}@${regionKey(region)} sha256:${fact.ref.sha256.slice(0, 8)} ${fact.ref.sourceKind} "${text}"`
  })
  return `image evidence: ${parts.join("; ")}`.slice(0, 320)
}

/** 供调用方构造 item（兼容 `ImageReadingItem` 的既有形状）。 */
export function diagramItemOf(item: ImageReadingItem, sourceKind: ImageSourceKind = "ocr"): DiagramItemInput {
  return { text: item.text, image: item.image, box: item.box, ...(item.arrow === undefined ? {} : { arrow: item.arrow }), sourceKind }
}
