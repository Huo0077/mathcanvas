import type { HashText, SolveContext } from "@draw/agent-core"

import {
  auditProblemImage,
  buildImageFact,
  IMAGE_REREAD_LIMIT,
  mergeImageEvidence,
  planImageReread,
  regionKey,
  requiredImageGaps,
  type AttachmentHandle,
  type DiagramItemInput,
  type AuditProblemImageInput,
  type ImageEvidenceAudit,
  type ImageEvidenceConflict,
  type ImageEvidenceFact,
  type ImageEvidenceGap,
  type ImageEvidenceTarget,
  type ImageRegion
} from "./problemImageEvidence"

/**
 * **图像证据流水线（W4，2026-11-09）**。
 *
 * W6 的证据层回答"这条读数从哪来、缺不缺来源"；本模块把它推进到**可解题**的一步：
 *
 * 1. 按**目标**（体积 / 图形选项）算出还缺哪些字段（`requiredImageGaps`，在证据层）；
 * 2. 缺口驱动**受控重读**（最多 2 次，按区域去重，重复无变化立即停止）；
 * 3. 每次重读后**重新审计**，冲突保留第一次读数（用户更正优先）；
 * 4. 审计结果改写 `sourceRevision` —— 旧证据因此失效，不能拿改图之前的核验给新图背书。
 *
 * 这一层**不发请求**：真正的读图由 `problemImageReader` 注入（`reread`），
 * 所以"该不该读、读哪里、读了几次、停在哪一步"全部可以脱网验证。
 */

export interface ImageRereadRequest {
  attachmentId: string
  region: ImageRegion
  /** 缺口码，例如 `missing_dimension`：读图提示词只补这些字段。 */
  missing: readonly string[]
  attempt: number
}

export type ImageRereadStop = "resolved" | "no_required_gap" | "budget_exhausted" | "no_change"

export interface ImageRereadOutcome {
  audit: ImageEvidenceAudit
  /** 重读后**仍然**存在的目标缺口；非空就不许把这一题当成已读完。 */
  required: ImageEvidenceGap[]
  used: number
  conflicts: ImageEvidenceConflict[]
  requests: ImageRereadRequest[]
  stopped: ImageRereadStop
}

export interface ImagePipelineInput extends AuditProblemImageInput {
  target: ImageEvidenceTarget
  reread(request: ImageRereadRequest): Promise<readonly DiagramItemInput[]>
  limit?: number
}

const round4 = (value: number): number => Math.round(value * 10_000) / 10_000
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/** 裁图局部坐标 → 原图归一化坐标。缩略图坐标不能冒充原图坐标。 */
export function toOriginalRegion(local: ImageRegion, crop: ImageRegion): ImageRegion {
  const x = round4(clamp01(crop.x + local.x * crop.width))
  const y = round4(clamp01(crop.y + local.y * crop.height))
  const width = round4(Math.min(clamp01(local.width * crop.width), 1 - x))
  const height = round4(Math.min(clamp01(local.height * crop.height), 1 - y))
  return { x, y, width, height }
}

/** `ImageRegion` → 读图框选用的 `[left, top, right, bottom]`。 */
export function regionToBox(region: ImageRegion): [number, number, number, number] {
  return [region.x, region.y, round4(region.x + region.width), round4(region.y + region.height)]
}

function factKey(fact: ImageEvidenceFact): string {
  return `${fact.ref.attachmentId}:${regionKey(fact.ref.region)}:${fact.ref.sourceKind}:${fact.text}`
}

function sameFacts(before: readonly ImageEvidenceFact[], after: readonly ImageEvidenceFact[]): boolean {
  if (before.length !== after.length) return false
  const keys = new Set(before.map(factKey))
  return after.every((fact) => keys.has(factKey(fact)))
}

/** 题面缺口 + 目标缺口合在一起，按语义去重（同码同区同文案只留一条）。 */
function mergeGaps(problemGaps: readonly ImageEvidenceGap[], targetGaps: readonly ImageEvidenceGap[]): ImageEvidenceGap[] {
  const seen = new Set<string>()
  const merged: ImageEvidenceGap[] = []
  for (const gap of [...problemGaps, ...targetGaps]) {
    const key = `${gap.code}:${gap.required}:${gap.attachmentId ?? ""}:${gap.region === undefined ? "" : regionKey(gap.region)}:${gap.message}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(gap)
  }
  return merged
}

function hasRequired(gaps: readonly ImageEvidenceGap[]): boolean {
  return gaps.some((gap) => gap.required)
}

/**
 * **受控重读循环**：缺口 → 读哪块 → 合并 → 重新审计，直到缺口消失 / 预算用尽 / 读数没变化。
 *
 * 三种停止都要**如实**返回：缺口没消就去要用户补条件，不能把"读了两遍还是没读到"当成读到了。
 */
export async function runImageRereadCycle(input: ImagePipelineInput): Promise<ImageRereadOutcome> {
  const limit = input.limit ?? IMAGE_REREAD_LIMIT
  const diagram: DiagramItemInput[] = [...input.diagram]
  let audit = auditProblemImage({ ...input, diagram })
  let required = requiredImageGaps(input.target, audit.facts, input.problem)
  // No OCR box: retry only the authorised attachment once at full-image scope; never fabricate coordinates.
  if (required.some(gap => gap.required && gap.attachmentId === undefined) && input.attachments.length > 0) {
    required = required.map(gap => gap.required && gap.attachmentId === undefined
      ? { ...gap, attachmentId: input.attachments[0]!.attachmentId, region: { x: 0, y: 0, width: 1, height: 1 } } : gap)
  }
  const conflicts: ImageEvidenceConflict[] = []
  const requests: ImageRereadRequest[] = []
  let used = 0
  let stopped: ImageRereadStop = "resolved"

  for (;;) {
    if (!hasRequired(required)) break
    const plan = planImageReread({ ...audit, gaps: mergeGaps(audit.gaps, required) }, used, limit)
    const target = plan.regions[0]
    if (!plan.allowed || target === undefined) {
      stopped = plan.reasonCodes.includes("budget_exhausted") ? "budget_exhausted" : "no_required_gap"
      break
    }
    const request: ImageRereadRequest = {
      attachmentId: target.attachmentId,
      region: target.region,
      missing: [...new Set(mergeGaps(audit.gaps, required).filter((gap) => gap.required).map((gap) => gap.code))],
      attempt: used + 1
    }
    requests.push(request)
    const incoming = await input.reread(request)
    used += 1
    const incomingFacts = incoming.flatMap((item) => {
      const fact = buildImageFact(item, input.attachments, input.conversationId)
      return fact === null ? [] : [fact]
    })
    const merged = mergeImageEvidence(audit.facts, incomingFacts)
    conflicts.push(...merged.conflicts)
    const unchanged = sameFacts(audit.facts, merged.facts)
    diagram.push(...incoming)
    audit = { ...auditProblemImage({ ...input, diagram }), facts: merged.facts }
    required = requiredImageGaps(input.target, merged.facts, input.problem)
    if (unchanged) {
      stopped = "no_change"
      break
    }
  }

  return { audit, required, used, conflicts, requests, stopped }
}

/**
 * 审计内容的**稳定**序列化：同一份读数（不论模型列出顺序）得到同一个摘要。
 * 日期、随机 id、图片字节都不进摘要 —— 否则每轮都会"看起来变了"。
 */
export function imageAuditDigestSource(audit: ImageEvidenceAudit): string {
  const facts = audit.facts
    .map((fact) => ({
      attachmentId: fact.ref.attachmentId,
      sha256: fact.ref.sha256.toLowerCase(),
      page: fact.ref.page,
      region: regionKey(fact.ref.region),
      sourceKind: fact.ref.sourceKind,
      text: fact.text
    }))
    .map((entry) => JSON.stringify(entry))
    .sort()
  const gaps = audit.gaps
    .map((gap) => JSON.stringify({ code: gap.code, required: gap.required, region: gap.region === undefined ? null : regionKey(gap.region) }))
    .sort()
  return JSON.stringify({ facts, gaps })
}

/**
 * 把审计结果写回题面身份：`sourceRevision` 变化 ⇒ 之前绑定的宿主证据全部失效
 * （`acceptSolvedCandidate` 逐条核对 sourceRevision）。
 *
 * 题面原文与 `problemRevision` 一个字都不动：读图不是改题，用户真正改题必须重建上下文。
 * 没有任何读数时保持原 revision —— "没看图"不该让旧证据失效。
 */
export async function applyImageAudit(context: SolveContext, audit: ImageEvidenceAudit, hash: HashText): Promise<SolveContext> {
  if (audit.facts.length === 0 && audit.gaps.length === 0) return context
  const sourceRevision = await hash(JSON.stringify({
    conversationId: context.conversationId,
    problemRevision: context.problemRevision,
    imageEvidence: imageAuditDigestSource(audit)
  }))
  return { ...context, sourceRevision }
}

/** 附件句柄（`AttachmentHandle`）→ 题面身份用的来源附件。 */
export function sourceAttachmentsOf(attachments: readonly AttachmentHandle[]): { attachmentId: string; sha256: string; page: number }[] {
  return attachments.map((attachment) => ({ attachmentId: attachment.attachmentId, sha256: attachment.sha256, page: attachment.page ?? 1 }))
}

/**
 * **W7 接线：把图上的三视图读数变成可派生的事实来源**。
 *
 * 图像管线只给出"主视图 4×3 的矩形"这样的**读数**；这里把它们整理成一条规范句
 * （`三视图读数：主视图 4×3 矩形；…`），随题面进入解题上下文。宿主的
 * `parseOrthographicViews` 只认这条规范句里的视图身份与尺寸 —— 因此体积判据
 * 用的仍是题图读数，而不是模型自己编的题设。
 */
export function orthographicViewReadings(items: readonly { text: string }[]): string | undefined {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const item of items) {
    const text = item.text.replace(/\s+/g, "")
    const label = /主视图|正视图/.test(text) ? "主视图"
      : /俯视图/.test(text) ? "俯视图"
        : /左视图|侧视图/.test(text) ? "左视图"
          : undefined
    if (label === undefined || seen.has(label)) continue
    const size = /(\d+(?:\.\d+)?)[×xX*](\d+(?:\.\d+)?)/.exec(text)
    if (size === null) continue
    seen.add(label)
    const shape = /三角形|三棱锥/.test(text) ? " 三角形"
      : /矩形|长方形|四边形|正方形/.test(text) ? " 矩形"
        : ""
    lines.push(`${label} ${size[1]}×${size[2]}${shape}`)
  }
  return lines.length === 0 ? undefined : `三视图读数：${lines.join("；")}`
}
