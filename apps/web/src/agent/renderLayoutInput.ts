import {
  adjustLayoutWithoutMutatingMath,
  type LayoutBox,
  type LayoutModel,
  type RenderEvidence,
  type ScreenshotArtifact,
  type Viewport,
  type VisualEvidenceTier
} from "@draw/agent-core"
import type { CandidateRenderEvidenceInput } from "./hostBridge"

/**
 * **已投影的点标签 → 布局盒子**（Phase 4 / Task 4.2，「标签叠加」这半条）。
 *
 * ## 为什么接在这里，而不是自己再写一次投影
 *
 * 屏幕坐标**已经算过一次**：`pointLabels.ts` 的 `pointLabelPlacements` 把每个空间点投影成
 * `{ left, top }`，那正是画布上真实标签所站的位置（覆盖层是 DOM，用同一组数定位）。
 * 再写一遍投影就是**第二个真源** —— 而两个投影一旦分叉，"诊断说没叠"与"用户看见叠了"
 * 会同时成立，且都言之凿凿。所以这里只做**换算**：拿已经算好的位置，套上标签的屏幕尺寸。
 *
 * 一个诚实的前提：`pointLabelPlacements` 返回的是标签的**锚点**（`left/top` 带 ±10px 偏移），
 * 不是盒子的左上角。这里按"锚点在左上方"处理 —— 与 `layoutModel.ts` 里
 * `labelSize` 的估算口径一致（两处都承认标签盒是**估算**，不是文本测量的结果）。
 *
 * ## 为什么只收标签
 *
 * 图形之间的遮挡在 3D 里是正常的，`diagnoseLayout` 也只对 `shape` 判最小可见面积。
 * 这里产出的是 `kind: "label"` 的盒子，于是"有没有叠"由 `diagnoseLayout` 现有的
 * `label_overlap` 判据回答 —— 判据只有一处。
 */
export interface LabelAnchor {
  /** 图元 id（诊断里指回具体对象）。 */
  key: string
  visible: boolean
  left: number
  top: number
}

/** 标签的屏幕尺寸（像素）。与 `layoutModel.ts` 的估算同量级，并且**显式可传**（便于测试与将来接真实测量）。 */
export const DEFAULT_LABEL_SIZE = { width: 28, height: 14 } as const

/**
 * 把已投影的标签锚点摊成布局模型。
 *
 * **只收 `visible` 的标签**：`project()` 会在点的深度落在视锥外时把它们标成不可见，
 * 而**不可见的标签不会被画出来** —— 把它们算进"叠了"是在报一个用户看不见的问题。
 */
export function layoutFromLabelAnchors(anchors: readonly LabelAnchor[], viewport: Viewport, labelSize: { width: number; height: number } = DEFAULT_LABEL_SIZE): LayoutModel {
  const boxes: LayoutBox[] = anchors
    .filter((anchor) => anchor.visible)
    .map((anchor) => ({
      id: `${anchor.key}#label`,
      kind: "label" as const,
      x: anchor.left,
      y: anchor.top,
      width: labelSize.width,
      height: labelSize.height
    }))
  return { viewport, boxes }
}

export interface RenderedLayoutInputResult {
  tier: VisualEvidenceTier
  viewport: Viewport
  boxes: LayoutBox[]
  missingRequiredLabels: string[]
  layoutStatus: "resolved" | "needs_human_review"
  documentHash: string
  cameraHash?: string
  hiddenEdges?: { shown: boolean; segments: number }
}

export function collectRenderLayoutEvidenceInput(input: {
  anchors: readonly LabelAnchor[]
  requiredLabels?: readonly string[]
  objects?: readonly LayoutBox[]
  viewport: Viewport
  labelSize?: { width: number; height: number }
  documentHash: string
  cameraHash?: string
  hiddenEdges?: { shown: boolean; segments: number }
}): RenderedLayoutInputResult {
  const labelModel = layoutFromLabelAnchors(input.anchors, input.viewport, input.labelSize)
  const visibleKeys = new Set(input.anchors.filter((a) => a.visible).map((a) => a.key))
  const missingRequiredLabels = (input.requiredLabels ?? []).filter((lbl) => !visibleKeys.has(lbl))
  const combined: LayoutBox[] = [...(input.objects ?? []), ...labelModel.boxes]
  const adjusted = adjustLayoutWithoutMutatingMath(input.viewport, combined)
  return {
    tier: "rendered",
    viewport: input.viewport,
    boxes: adjusted.boxes,
    missingRequiredLabels,
    layoutStatus: missingRequiredLabels.length > 0 ? "needs_human_review" : adjusted.status,
    documentHash: input.documentHash,
    ...(input.cameraHash === undefined ? {} : { cameraHash: input.cameraHash }),
    ...(input.hiddenEdges === undefined ? {} : { hiddenEdges: input.hiddenEdges })
  }
}

function utf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return globalThis.btoa(binary)
}

function screenshotForCanvas(canvas: Element, viewport: Viewport): ScreenshotArtifact | null {
  try {
    if (canvas.tagName.toLowerCase() === "svg") {
      return {
        mimeType: "image/svg+xml",
        base64: utf8Base64(new XMLSerializer().serializeToString(canvas)),
        width: viewport.width,
        height: viewport.height
      }
    }
    const renderedCanvas = canvas.tagName.toLowerCase() === "div" ? canvas.querySelector("canvas") : canvas
    if (!(renderedCanvas instanceof HTMLCanvasElement)) return null
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(renderedCanvas.toDataURL("image/png"))
    if (!match) return null
    return { mimeType: match[1], base64: match[2], width: renderedCanvas.width, height: renderedCanvas.height }
  } catch {
    return null
  }
}

function viewportAttribute(raw: string | null): Viewport | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as { width?: unknown; height?: unknown }
    if (typeof value.width !== "number" || typeof value.height !== "number") return null
    if (![value.width, value.height].every((entry) => Number.isFinite(entry) && entry > 0)) return null
    return { width: value.width, height: value.height }
  } catch {
    return null
  }
}

function layoutBoxesAttribute(raw: string | null): LayoutBox[] | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as unknown
    if (!Array.isArray(value)) return null
    if (!value.every((box) => {
      if (typeof box !== "object" || box === null) return false
      const candidate = box as Record<string, unknown>
      return typeof candidate.id === "string" && (candidate.kind === "object" || candidate.kind === "label") &&
        [candidate.x, candidate.y, candidate.width, candidate.height].every((entry) => typeof entry === "number" && Number.isFinite(entry)) &&
        (candidate.width as number) >= 0 && (candidate.height as number) >= 0
    })) return null
    return value as LayoutBox[]
  } catch {
    return null
  }
}

export function candidateRenderEvidenceFromCanvas(
  input: CandidateRenderEvidenceInput,
  root: ParentNode = globalThis.document
): RenderEvidence | null {
  const selector = input.candidate.workspace === "geometry3d" ? '[data-3d-scene="true"]' : "svg[data-canvas-evidence-status]"
  const canvas = root.querySelector(selector)
  if (!canvas) return null
  if (canvas.getAttribute("data-document-hash") !== input.documentHash) return null
  if (canvas.getAttribute("data-render-evidence-tier") !== "rendered") return null
  if (canvas.getAttribute("data-canvas-evidence-status") !== "passed") return null
  if (canvas.getAttribute("data-canvas-evidence-accepted") !== "true") return null
  if (canvas.getAttribute("data-canvas-diagnostic-errors")) return null
  if (canvas.getAttribute("data-canvas-hidden-labels")) return null
  const viewport = viewportAttribute(canvas.getAttribute("data-canvas-viewport"))
  const boxes = layoutBoxesAttribute(canvas.getAttribute("data-canvas-layout-boxes"))
  if (!viewport || !boxes) return null
  const screenshot = screenshotForCanvas(canvas, viewport)
  if (!screenshot) return null
  const cameraHash = canvas.getAttribute("data-camera-hash")
  return {
    mode: "rendered",
    evidenceTier: "rendered",
    runId: input.runId,
    draftId: input.draftId,
    draftVersion: input.draftVersion,
    documentHash: input.documentHash,
    viewport,
    boxes,
    screenshot,
    ...(cameraHash === null ? {} : { cameraHash })
  }
}
