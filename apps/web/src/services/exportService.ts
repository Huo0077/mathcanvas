import type { GeometryDocument } from "@draw/dsl"

import { collectWinAnsiLoss } from "@draw/agent-core"
import type { ProjectedDrawing } from "../projectionVisuals"

/**
 * **导出预检**（Task 0.6 Step 4）。
 *
 * 计划的要求是"在产出文件**之前**说清损失"：不支持的来源类型、3D 直接导出、WinAnsi 字符丢失、
 * 不可投影拓扑，全部显式列出；**有损失就必须由用户确认**（计划 G0.5 的 Gate 之一）。
 *
 * 为什么必须显式：用户拿到一个"悄悄少了几个对象"的 DXF，比拿到一句"这 2 个对象无法导出"糟糕得多。
 */

export type ExportFormat = "svg" | "dxf" | "pdf" | "png"

export interface ExportOmission {
  sourceId: string
  kind: string
  reason: string
}

export interface FontLoss {
  original: string
  substituted: string
  reason: string
}

export interface ExportPlan {
  format: ExportFormat
  /** 本次导出会写进去的图元（**真实 id**，不是只给总数）。 */
  projectedEntityIds: string[]
  projectedEntityCount: number
  /** 支持写出的视图。 */
  views: string[]
  /** 被略过的东西与原因。 */
  omitted: ExportOmission[]
  /** WinAnsi 承载不了的文本（只对 DXF 这类有编码限制的格式有意义）。 */
  fontLoss: FontLoss[]
  /** 数值近似写进文件的说明（例如投影是采样出来的）。 */
  approximationNotes: string[]
  /** 来源文档句柄（跨文档时必须能说清"读的是哪两份"）。 */
  sourceDocuments: string[]
  /** 没有损失、也没有阻止项时为 true。 */
  supported: boolean
  /** 有损失（略过 / 字体替换 / 近似）时必须为 true —— 调用方据此要求用户确认。 */
  requiresUserAcceptance: boolean
  /** 直接拒绝的原因（如 3D 场景不做 PNG）。 */
  blockedReasons: string[]
}

export interface ExportPlanInput {
  drawings: ProjectedDrawing[]
  format: ExportFormat
  /** 投影来源文档（点/棱/面/实体的真正出处）。 */
  sourceDocument: GeometryDocument
  layoutDocumentId: string
  geometryDocumentId: string
}

/**
 * 投影**画不出来**、因此也导不出去的类型。
 *
 * 判据是"投影器会不会为它产出可写出的图元"，而不是"它是不是一个好对象"：
 * 平面交点集合、轨迹、连接、以及 3D 的解析交线/交面都在这条线之外。
 */
const UNEXPORTABLE_TYPES = new Set([
  "connection",
  "locus",
  "intersectionSet",
  "analysisSet",
  "intersectionLine",
  "intersectionFace",
  "intersectionPoint3",
  "section",
  "intersectionSolid"
])

/** WinAnsi 装不下的字符：DXF 的文本编码是 WinAnsi，中文会被写成 `?`。 */
function collectFontLoss(document: GeometryDocument, format: ExportFormat): FontLoss[] {
  // 只有走 WinAnsi 的格式需要报这条；SVG / PDF 能带 UTF-8。
  // 规则本身在 `@draw/agent-core`：Agent 侧的导出预检也要报同一条损失，
  // 两处各写一份必然分叉（而分叉的症状是"界面说有损失、Agent 说没有"）。
  if (format !== "dxf") return []
  return collectWinAnsiLoss(document.primitives as { label?: string }[])
}

export function buildExportPlan(input: ExportPlanInput): ExportPlan {
  const { drawings, format, sourceDocument, layoutDocumentId, geometryDocumentId } = input
  const blockedReasons: string[] = []
  const omitted: ExportOmission[] = []
  const projectedEntityIds: string[] = []
  const approximationNotes: string[] = []

  // 计划点名：3D 场景没有直接的 SVG / PNG 导出，要走 CAD 投影。
  if (format === "png") blockedReasons.push("a 3D scene is not exported directly as PNG; use the CAD sheet's vector export instead")

  for (const drawing of drawings) {
    for (const primitive of drawing.primitives) projectedEntityIds.push(primitive.sourceId)
    if (drawing.diagnostics.length > 0) approximationNotes.push(...drawing.diagnostics.map((note) => `${drawing.view}: ${note}`))
  }

  /**
   * **对全量来源做差集**，而不是只看"已经画出来的那些"。
   *
   * 实测发现的真实坑：`connection` / `intersectionSet` 这类来源**根本不会出现在投影结果里** ——
   * 只遍历 `drawing.primitives` 的话，它们既不在 `projectedEntityIds` 里、也不在 `omitted` 里，
   * 等于**静默消失**。计划点名的正是这一类（"unsupported connection/locus/intersectionSet"）。
   */
  const projected = new Set(projectedEntityIds)
  for (const primitive of sourceDocument.primitives) {
    if (projected.has(primitive.id)) continue
    if (!UNEXPORTABLE_TYPES.has(primitive.type)) continue
    omitted.push({ sourceId: primitive.id, kind: primitive.type, reason: `${primitive.type} cannot be projected, so it is not supported by the ${format} exporter` })
  }

  const fontLoss = collectFontLoss(sourceDocument, format)
  const uniqueIds = [...new Set(projectedEntityIds)]
  // 同一份来源被多个视图投影时只报一次省略。
  const uniqueOmitted = [...new Map(omitted.map((entry) => [entry.sourceId, entry])).values()]

  return {
    format,
    projectedEntityIds: uniqueIds,
    projectedEntityCount: uniqueIds.length,
    views: drawings.map((drawing) => drawing.view),
    omitted: uniqueOmitted,
    fontLoss,
    approximationNotes,
    sourceDocuments: [layoutDocumentId, geometryDocumentId],
    supported: blockedReasons.length === 0 && uniqueOmitted.length === 0,
    requiresUserAcceptance: blockedReasons.length > 0 || uniqueOmitted.length > 0 || fontLoss.length > 0,
    blockedReasons
  }
}
