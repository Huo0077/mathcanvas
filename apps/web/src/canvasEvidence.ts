import type { GeometryDocument } from "@draw/dsl"
import { canonicalContentHash, diagnoseLayout, renderEvidenceStaleness, type LayoutBox, type LayoutDiagnostic, type Viewport } from "@draw/agent-core"

/**
 * **真实画布证据**（Task 16）。
 *
 * ## 计划原话与这里的对应关系
 *
 * > "仅查内存文档不算视觉通过"；"四族实际画布/相机/标签均同草稿版本"；
 * > "改题或撤销后旧图证据 stale"；"点名遮挡、3D 虚实线/相机不可见做反例"。
 *
 * 所以这个模块只做一件事：**把已经渲染出来的东西量下来**，再交给既有的判据。
 *
 * - **盒子**来自 `[data-primitive-type]` 组里那些真实图元元素的几何属性
 *   （`circle` 的 `cx/cy/r`、`line` 的 `x1/y1/x2/y2`、`polyline`/`polygon` 的 `points`…）；
 * - **标签**只收**点名标签**（2D 是点组里的 `<text>`，3D 是点标注覆盖层 `[data-point-id]`）——
 *   把测量读数、交点说明那些文字也算进"点名遮挡"会凭空造出一堆假报警；
 * - **诊断**交给 `@draw/agent-core` 的 `diagnoseLayout`（判据只有一处，这里不重写）：
 *   `label_overlap` 就是"点名遮挡"，`clipped_object` 就是"出画布"。
 * - **相机看不见**读的是**集合差**：文档里有名字的点，画布上没画出标签的那些
 *   （`pointLabelPlacements` 在深度落到视锥外时不产出标签 ⇒ 覆盖层里就没有它）。
 *
 * ## 边界（如实写在这里）
 *
 * ① 坐标是**渲染器自己的坐标系**（2D 的 `viewBox`、3D 覆盖层的像素位移），不是设备像素；
 *    判"叠没叠、出没出界"用同一套坐标就够了，但**不能**拿它去当真实像素尺寸的断言。
 * ② `[data-hit-target]` 那种透明命中区**不计入**盒子 —— 它是交互用的，不是用户看见的图形
 *    （算进去会让每个点都有 24×24 的"可见面积"，把真正的"太小/出界"淹掉）。
 * ③ 零宽/零高的退化几何（竖直线的盒子）按 **1** 处理：画面上线是有粗细的，
 *    记 0 会让它被判成"完全出界"。
 * ④ 3D 的"虚实线"不在这一层：那是 Three.js 内部的材质选择，DOM 里读不到；
 *    这一层给的是**相机可见性**与**标签**两件事（见任务卡上记的那条边界）。
 */

/** 点名标签盒子的估算尺寸（与 `agent/renderLayoutInput.ts` 的 `DEFAULT_LABEL_SIZE` 同量级）。 */
export const LABEL_BOX_SIZE = { width: 28, height: 14 } as const

export interface CanvasEvidence {
  workspace: GeometryDocument["workspace"]
  objectsMeasurable: boolean
  /** 这份证据绑在**哪一版内容**上（`canonicalContentHash`）。 */
  documentHash: string
  revision: number
  viewport: Viewport
  boxes: LayoutBox[]
  diagnostics: LayoutDiagnostic[]
  /** 文档里有名字、而画布这次没画出来的点名（相机看不见 / 被过滤）。 */
  hiddenLabels: string[]
  /**
   * **3D 的虚实线**（Task 16 的边界，2026-10-14）：这次画了几段隐藏棱的虚线、以及那个显示开关的状态。
   *
   * 为什么必须有这一栏：虚线画在 WebGL 里、DOM 量不到，于是"画布上有没有那些虚线"在证据面上
   * **根本没有落点**（上一版只给相机可见性与标签）。数字由**真的建了它的那一层**
   *（`threeSceneContent` 的同步）写到场景容器上，这一层只读着转述 —— 不在这里重算"哪几条棱算隐藏"。
   */
  hiddenEdges: { shown: boolean; segments: number }
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

function numberAttribute(element: Element, name: string): number | null {
  const raw = element.getAttribute(name)
  if (raw === null || raw.trim() === "") return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

/** 退化几何按 1 处理（见文件头边界 ③）。 */
function sized(width: number, height: number): { width: number; height: number } {
  return { width: Math.max(1, width), height: Math.max(1, height) }
}

function rectFromPoints(raw: string | null): Rect | null {
  if (raw === null) return null
  const numbers = raw.trim().split(/[\s,]+/).map(Number)
  if (numbers.length < 4 || numbers.some((value) => !Number.isFinite(value))) return null
  const xs: number[] = []
  const ys: number[] = []
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    xs.push(numbers[index])
    ys.push(numbers[index + 1])
  }
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const box = sized(Math.max(...xs) - minX, Math.max(...ys) - minY)
  return { x: minX, y: minY, ...box }
}

/** 一个**已渲染**元素的几何盒子；认不出形状就返回 `null`（不猜）。 */
function elementRect(element: Element, labelSize: { width: number; height: number }): Rect | null {
  const tag = element.tagName.toLowerCase()
  if (tag === "circle") {
    const cx = numberAttribute(element, "cx")
    const cy = numberAttribute(element, "cy")
    const r = numberAttribute(element, "r")
    if (cx === null || cy === null || r === null || r <= 0) return null
    return { x: cx - r, y: cy - r, width: 2 * r, height: 2 * r }
  }
  if (tag === "line") {
    const x1 = numberAttribute(element, "x1")
    const y1 = numberAttribute(element, "y1")
    const x2 = numberAttribute(element, "x2")
    const y2 = numberAttribute(element, "y2")
    if (x1 === null || y1 === null || x2 === null || y2 === null) return null
    const box = sized(Math.abs(x2 - x1), Math.abs(y2 - y1))
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), ...box }
  }
  if (tag === "polyline" || tag === "polygon") return rectFromPoints(element.getAttribute("points"))
  if (tag === "rect") {
    const x = numberAttribute(element, "x")
    const y = numberAttribute(element, "y")
    const width = numberAttribute(element, "width")
    const height = numberAttribute(element, "height")
    if (x === null || y === null || width === null || height === null) return null
    return { x, y, ...sized(width, height) }
  }
  if (tag === "text") {
    const x = numberAttribute(element, "x")
    const y = numberAttribute(element, "y")
    if (x === null || y === null) return null
    return { x, y, width: labelSize.width, height: labelSize.height }
  }
  return null
}

function union(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null
  const minX = Math.min(...rects.map((rect) => rect.x))
  const minY = Math.min(...rects.map((rect) => rect.y))
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width))
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height))
  return { x: minX, y: minY, ...sized(maxX - minX, maxY - minY) }
}

/** 点名标签的文字（2D 是 `<text>` 的内容，3D 覆盖层是元素文本 / `data-point-id`）。 */
function labelName(element: Element): string | null {
  const text = (element.textContent ?? "").trim()
  if (text.length > 0) return text
  const id = element.getAttribute("data-point-id")
  return id !== null && id.trim().length > 0 ? id.trim() : null
}

export interface MeasuredCanvas {
  boxes: LayoutBox[]
  /** 画布这次**真的画出来**的点名，按渲染顺序。 */
  renderedLabels: string[]
}

/**
 * 从**已渲染的 DOM**量盒子与点名标签。
 *
 * 只读属性、不碰布局引擎：这样 jsdom 里也能跑（`getBoundingClientRect` 在 jsdom 里恒为 0，
 * 拿它当判据会让"画布证据"在单测里永远为空）。
 */
export function measureRenderedCanvas(root: ParentNode, labelSize: { width: number; height: number } = LABEL_BOX_SIZE): MeasuredCanvas {
  const boxes: LayoutBox[] = []
  const renderedLabels: string[] = []

  // ① 点名标签：2D 的点组里的 `<text>` + 3D 的点标注覆盖层。
  /**
   * **同一个字母画了两次也要收两次**（2026-10-12 由本任务的画布读数抓到的真问题）：
   * 翻折题里折片自己的 `E`/`F` 与边上那两个点位置重合，画布上就是两个标签叠在一起。
   * 早先这里按名字去重，于是"画了两遍"这件事在证据里被自己抹掉了 —— 而它正是
   * `diagnoseLayout` 的 `label_overlap` 该报的东西。名字集合（`renderedLabels`）照旧去重，
   * 因为那是用来与文档点名求差的。
   */
  const labelElements: Element[] = [
    ...root.querySelectorAll('[data-primitive-type="point"] text'),
    ...root.querySelectorAll("[data-point-id]")
  ]
  const seen = new Map<string, number>()
  for (const element of labelElements) {
    // Overlay nodes are deliberately retained across camera frames. A retained node is
    // not visible evidence when the renderer (or its ancestor) has hidden it.
    if (element.closest("[hidden]")) continue
    const name = labelName(element)
    if (name === null) continue
    const rect = tagRect(element, labelSize)
    if (rect === null) continue
    const count = (seen.get(name) ?? 0) + 1
    seen.set(name, count)
    if (!renderedLabels.includes(name)) renderedLabels.push(name)
    boxes.push({ id: count === 1 ? `label:${name}` : `label:${name}#${count}`, kind: "label", ...rect })
  }

  // ② 图形对象：每个 `[data-primitive-type]` 组一个盒子（组内可见几何的并集）。
  const groups = [...root.querySelectorAll("[data-primitive-type]")]
  const seenTypes = new Map<string, number>()
  for (const group of groups) {
    const type = group.getAttribute("data-primitive-type") ?? "unknown"
    const index = seenTypes.get(type) ?? 0
    seenTypes.set(type, index + 1)
    const rects = [...group.querySelectorAll("circle, line, polyline, polygon, rect, path")]
      .filter((element) => element.getAttribute("data-hit-target") === null)
      .map((element) => elementRect(element, labelSize))
      .filter((rect): rect is Rect => rect !== null)
    const rect = union(rects)
    if (rect === null) continue
    boxes.push({ id: `${type}#${index}`, kind: "object", shape: type === "point" ? "marker" : "shape", ...rect })
  }

  return { boxes, renderedLabels }
}

/** 2D 的 `<text>` 用属性给盒子；3D 覆盖层用它的 `style.left/top`。 */
function tagRect(element: Element, labelSize: { width: number; height: number }): Rect | null {
  const fromAttributes = elementRect(element, labelSize)
  if (fromAttributes !== null) return fromAttributes
  const style = (element as HTMLElement).style
  if (style === undefined || style === null) return null
  const left = Number.parseFloat(style.left)
  const top = Number.parseFloat(style.top)
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null
  return { x: left, y: top, ...labelSize }
}

/** 文档里**有名字**的点（细分顶点不算：它们本来就不展示，也不带标签）。 */
export function namedPointLabels(document: GeometryDocument): string[] {
  const names: string[] = []
  for (const primitive of document.primitives) {
    if (primitive.type !== "point" && primitive.type !== "point3") continue
    if (primitive.type === "point3" && primitive.tessellation === true) continue
    const label = primitive.label
    if (typeof label !== "string" || label.trim().length === 0) continue
    if (!names.includes(label)) names.push(label)
  }
  return names
}

/** 文档里有名字、而画布这次没画出来的点名（按文档顺序）。 */
export function hiddenPointLabels(document: GeometryDocument, renderedLabels: readonly string[]): string[] {
  const rendered = new Set(renderedLabels)
  return namedPointLabels(document).filter((name) => !rendered.has(name))
}

/**
 * 量一份**真实画布**的证据。
 *
 * `document` 是画布**这一刻正在渲染**的那一份（不是草稿里的候选）—— 两者的内容哈希相等，
 * 才叫"画布与草稿同版本"。
 *
 * `objectsMeasurable = false` 是给 **3D 画布**用的：它的图形画在 WebGL 里，DOM 里量不到，
 * 只有点标注覆盖层是 DOM。那时**不报 `empty_canvas`**（场景是满的，报"空的"是假报警 ——
 * 一个乱报警的检查器会被学会忽略），只在 `data-canvas-objects-measurable="false"` 上说清
 * "这一份没有对象盒子"，标签那几条判据照常跑。
 */
export function canvasEvidenceOf(input: { document: GeometryDocument; root: ParentNode; viewport: Viewport; labelSize?: { width: number; height: number }; objectsMeasurable?: boolean; hiddenEdges?: { shown: boolean; segments: number } }): CanvasEvidence {
  const objectsMeasurable = input.objectsMeasurable ?? true
  const measured = measureRenderedCanvas(input.root, input.labelSize ?? LABEL_BOX_SIZE)
  const judged = objectsMeasurable ? measured.boxes : measured.boxes.filter((box) => box.kind === "label")
  const diagnostics = diagnoseLayout(input.viewport, judged).filter((entry) => objectsMeasurable || entry.code !== "empty_canvas")
  return {
    workspace: input.document.workspace,
    objectsMeasurable,
    documentHash: canonicalContentHash(input.document),
    revision: input.document.revision,
    viewport: input.viewport,
    boxes: measured.boxes,
    diagnostics,
    hiddenLabels: hiddenPointLabels(input.document, measured.renderedLabels),
    // 缺省（2D 画布、或调用方没给）如实记"没画、0 段"，不编一个数。
    hiddenEdges: input.hiddenEdges ?? { shown: false, segments: 0 }
  }
}

/**
 * 挂到画布根元素上的属性。
 *
 * 属性名与 `renderEvidence.ts` 的字段一一对应，**人话与数字分开**：
 * 数字给断言用，`data-canvas-diagnostics` 的码给"哪里不好"用（码是稳定可枚举的闭集）。
 */
export function canvasEvidenceAttributes(evidence: CanvasEvidence, objectsMeasurable = true, currentDocument?: GeometryDocument): Record<string, string> {
  // Consumption checks the live content, not the snapshot's own identity. The scope here
  // is a live workspace canvas, not an agent draft or a confirmation authorization.
  const staleness = currentDocument === undefined ? null : renderEvidenceStaleness(
    { draftId: evidence.workspace, draftVersion: evidence.revision + 1, documentHash: evidence.documentHash },
    { draftId: currentDocument.workspace, documentHash: canonicalContentHash(currentDocument) }
  )
  if (staleness?.stale) return {
    "data-canvas-evidence-status": "stale",
    "data-canvas-evidence-accepted": "false",
    "data-canvas-evidence-stale-reason": staleness.kind
  }
  const measurable = evidence.objectsMeasurable && objectsMeasurable
  const status = staleness === null ? "unbound"
    : evidence.hiddenLabels.length > 0 || evidence.diagnostics.some((entry) => entry.severity === "error") ? "failed"
      : measurable ? "passed" : "partial"
  return {
    "data-canvas-evidence-status": status,
    "data-canvas-evidence-accepted": status === "passed" ? "true" : "false",
    "data-document-hash": evidence.documentHash,
    "data-document-revision": String(evidence.revision),
    "data-canvas-boxes": String(evidence.boxes.filter((box) => box.kind === "object").length),
    "data-canvas-labels": String(evidence.boxes.filter((box) => box.kind === "label").length),
    "data-canvas-diagnostics": evidence.diagnostics.map((entry) => entry.code).join(","),
    /**
     * **只报"看不见"那一档**（`error`）：完全出界、画布为空、视口退化。
     * 与 `diagnoseLayout` 的口径一致 —— 警告级（有一处小瑕疵）不该被当失败读，
     * 所以分开放，断言也分开。
     */
    "data-canvas-diagnostic-errors": evidence.diagnostics.filter((entry) => entry.severity === "error").map((entry) => entry.code).join(","),
    "data-canvas-hidden-labels": evidence.hiddenLabels.join(","),
    /**
     * **3D 虚实线**（Task 16 边界）：`shown` 是那个显示开关、`hidden-edges` 是**这次真的画了**
     * 几段隐藏棱的虚线。两者分开报 —— "开关开着"与"画面上真有那些虚线"是两件事。
     */
    "data-canvas-hidden-edges-shown": evidence.hiddenEdges.shown ? "true" : "false",
    "data-canvas-hidden-edges": String(evidence.hiddenEdges.segments),
    "data-canvas-objects-measurable": measurable ? "true" : "false"
  }
}
