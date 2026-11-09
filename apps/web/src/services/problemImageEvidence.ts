import type { ImageBox, ImageReadingItem } from "./problemImageReader"
import { isGraphChoiceProblem } from "./problemImageReview"

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
  | "missing_option_readings"
  | "missing_shape_features"

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

/** 读图框选 `[left, top, right, bottom]` → 归一化区域；裁图回映也要用它。 */
export function regionOfBox(box: ImageBox | null | undefined): ImageRegion {
  return regionOf(box)
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

/** 一个目标到底还需要什么（W4）：缺口不是"再读一遍"，而是**具体字段**。 */
export type ImageEvidenceTarget = "volume" | "graph-choice"

/** 只有要求计算体积时才应用体积尺寸门禁；“给定体积求面积”不能反向拦截。 */
export function imageEvidenceTargetOf(problem: string): ImageEvidenceTarget | undefined {
  if (isGraphChoiceProblem(problem)) return "graph-choice"
  const firstOption = /(?:^|\s|[（）()])A\s*[.．、]/u.exec(problem)
  const stem = firstOption === null ? problem : problem.slice(0, firstOption.index + firstOption[0].indexOf("A"))
  const blankTarget = [...stem.matchAll(/(体积|容积|表面积|面积|周长|长度|半径)(?:为|是|等于)?\s*\$?\s*[（(]\s*(?:\\quad)?\s*[）)]/gu)].at(-1)
  if (blankTarget !== undefined) return blankTarget[1] === "体积" || blankTarget[1] === "容积" ? "volume" : undefined
  const lastQuestion = [...stem.matchAll(/(?:则|那么|求|计算|问)/gu)].at(-1)
  const targetClause = lastQuestion === undefined ? stem : stem.slice(lastQuestion.index)
  if (/(?:体积|容积)/u.test(targetClause) && !/(?:表面积|面积|周长|长度|半径)(?:为|是|等于|多少)/u.test(targetClause)) return "volume"
  return undefined
}

const NUMBER_TOKEN = String.raw`[+\-−]?\d+(?:\.\d+)?|\\sqrt\s*\{[^{}]+\}|√\d+(?:\.\d+)?`
const DIMENSION_READING = new RegExp(
  `(宽度|宽|长度|长|高度|高|半径|直径|边长|底面积|侧面积|表面积|体积|角度)\\s*(?:为|是|等于|＝|=|:|：)?\\s*(${NUMBER_TOKEN})`
)
const EQUALITY_READING = new RegExp(`([A-Za-z][A-Za-z0-9_]{0,3})\\s*=\\s*(${NUMBER_TOKEN})`)

export interface ImageDimensionReading {
  label: string
  value: number
  fact: ImageEvidenceFact
}

/**
 * **模型猜测永远不是题设**：`model_guess` 即使自称 `high` 也只能算待核对的候选。
 * 反过来，OCR 的低置信读数同样不升级 —— 缺省就是保守。
 */
export function isGivenImageFact(fact: ImageEvidenceFact): boolean {
  if (fact.ref.sourceKind === "model_guess") return false
  if (fact.ref.sourceKind === "user_correction" || fact.ref.sourceKind === "confirmed_line") return true
  return fact.confidence === "high"
}

/** 把一条读数降回它应有的等级：猜测不因为标了 `high` 就变成题设。 */
export function promoteImageFact(fact: ImageEvidenceFact): ImageEvidenceFact {
  return fact.ref.sourceKind === "model_guess" ? { ...fact, confidence: "low" } : fact
}

/** 只有"有数值的尺寸"才算体积输入；`高 h`、`图1` 都不是。 */
export function imageDimensionReading(fact: ImageEvidenceFact): ImageDimensionReading | null {
  const text = fact.text.replace(/\s+/g, " ")
  const reading = DIMENSION_READING.exec(text) ?? EQUALITY_READING.exec(text)
  if (reading === null) return null
  const value = parseDimension(reading[2]!)
  return value === undefined ? null : { label: reading[1]!, value, fact }
}

const SHAPE_OPTION = /^\s*(?:选项\s*)?([A-D])\s*[:.、)．）]\s*(.+)$/
const OPTION_DETAIL = /对称|单调|递增|递减|上升|下降|极[大小]|峰|谷|开口|拐点|零点|相切|穿过|经过|交于|相交|渐近|顶点|最小值|最大值/
/** 可判形状特征：零点 / 极值 / 符号走向。`开口向上` 只是外观描述，不能单独判选项。 */
const SHAPE_FEATURE = /零点|极[大小]|峰|谷|穿过|过原点|经过原点|交于|相交|渐近|最小值|最大值|x\s*=\s*[-−]?\d|y\s*=\s*[-−]?\d/

/**
 * **目标所需证据**（W4）。返回的缺口只是"还缺什么"，**不等于已经解决**：
 * 调用方（`problemImagePipeline`）重读之后必须重新审计一次，才能说缺口消了。
 */
/** 题干数字不伪装成图上证据，只用于避免“题干已给量却被判零尺寸”的误拦截。 */
function statedDimensions(problem: string): { label: string; value: number }[] {
  // 选项中的数字是候选答案，不能当题设。网格单格尺寸可算一项，但不能替代物体轮廓尺寸。
  const firstOption = /(?:^|\s|[（）()])A\s*[.．、]/u.exec(problem)
  const stem = firstOption === null ? problem : problem.slice(0, firstOption.index + firstOption[0].indexOf("A"))
  const readings: { label: string; value: number }[] = []
  const pattern = /(容器高|水深|弧长|底面半径|半径|直径|底面边长|边长|高度|高|长度|宽度|宽)\s*(?:为|是|等于|＝|=|:|：)?\s*\$?\s*(\d+(?:\.\d+)?)(?=\s*(?:\$|\\mathrm\b|[尺米厘千]|cm\b|mm\b|m\b|[，,。；;（(]|$))/gu
  for (const match of stem.matchAll(pattern)) {
    const label = match[1]!, value = Number(match[2])
    if (Number.isFinite(value) && !readings.some(item => item.label === label && item.value === value)) readings.push({ label, value })
  }
  return readings
}

export function requiredImageGaps(target: ImageEvidenceTarget, facts: readonly ImageEvidenceFact[], problem = ""): ImageEvidenceGap[] {
  const gaps: ImageEvidenceGap[] = []
  const anchor = facts[0]
  const place: { attachmentId?: string; region?: ImageRegion } =
    anchor === undefined ? {} : { attachmentId: anchor.ref.attachmentId, region: anchor.ref.region }
  const given = facts.filter(isGivenImageFact)
  const dimensions = given.flatMap((fact) => {
    const reading = imageDimensionReading(fact)
    return reading === null ? [] : [reading]
  })

  if (target === "volume") {
    // 不把题干转录成图像证据：仅在“是否缺尺寸”这一问里合并两类数值。
    const written = statedDimensions(problem)
    const amount = dimensions.length + written.filter(item => !dimensions.some(reading => reading.label === item.label && reading.value === item.value)).length
    const isOnlySphere = /球/u.test(problem) && !/圆柱|圆锥|圆台|柱体/u.test(problem)
      && !/柱|锥|棱台/u.test(dimensions.map(reading => reading.fact.text).join(" "))
  const singleSufficient = amount === 1 && isOnlySphere
    && (dimensions.some(reading => /半径|直径/u.test(reading.fact.text)) || written.some(item => /半径|直径/u.test(item.label)))
    if (amount < 2 && !singleSufficient) {
      gaps.push({
        code: "missing_dimension",
        required: true,
        ...place,
        message: amount === 0
          ? "体积目标没有任何可核验的数值尺寸；图上的定位标签不算尺寸，不允许按常见版本补数。"
          : "体积目标至少需要两组可核验的数值尺寸，当前只有一组。"
      })
    }
    return gaps
  }

  const options = new Set<string>()
  let feature = false
  for (const fact of given) {
    const text = fact.text.normalize("NFKC")
    for (const line of text.split(/[\n;；]/)) {
      const match = SHAPE_OPTION.exec(line)
      if (match !== null && OPTION_DETAIL.test(match[2]!)) options.add(match[1]!)
    }
    if (SHAPE_FEATURE.test(text)) feature = true
  }
  const missing = ["A", "B", "C", "D"].filter((choice) => !options.has(choice))
  if (missing.length > 0) {
    gaps.push({
      code: "missing_option_readings",
      required: true,
      ...place,
      message: `图形选择题缺少选项 ${missing.join("、")} 的可判读数；题干文字解析成功不等于选项图已经读到。`
    })
  }
  if (!feature) {
    gaps.push({
      code: "missing_shape_features",
      required: true,
      ...place,
      message: "图形选项没有读到零点、极值或符号走向；只凭选项字母不能终答。"
    })
  }
  return gaps
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
