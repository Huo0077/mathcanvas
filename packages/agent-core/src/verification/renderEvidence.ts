import type { VerificationCheck, VerificationReport } from "../contracts"

/**
 * **渲染证据契约与本地布局诊断**（Phase 4 / Task 4.1 + Task 4.2 的纯计算部分）。
 *
 * ## 这一层要解决的问题
 *
 * 在这之前，Agent 对"画出来好不好看"**完全没有判据**：它能算出立体有几个顶点、
 * 截面是几边形，但"这个实体被裁掉了没有""两个标签叠在一起了没有"只能靠猜。
 * 于是那几条视觉任务在记分卡里一直是 `not_supported`。
 *
 * 计划的阶段门槛写得很清楚：**"至少有一个纯本地视觉/布局验证路径，不依赖 provider vision
 * 才能发现明显布局错误。"** 换句话说，不能把这一步挂在"模型支持看图"上 ——
 * 那会让"这台环境没有视觉能力"变成"画错了也发现不了"。
 *
 * 所以这一层是**纯算术**：给它一批对象的包围盒与视口尺寸，它回答
 * "谁出界了、谁和谁叠了、画面是不是空的"。它不截图、不碰 DOM、不调模型。
 *
 * ## 三条纪律（逐条有测试）
 *
 * 1. **截图不进长期记忆**。`RenderEvidence` 是**本次运行的 artifact**；
 *    这里刻意不给它任何序列化入口，也没有把它写进会话事实的类型。
 * 2. **没有视觉能力时如实说 `not_supported`**，绝不伪造"我看到了"。
 *    `mode: "structured_only"` 就是这句话的类型化形式。
 * 3. **证据必须绑在某一版草稿上**。`draftVersion` 是必填，缺了连构造都不该发生 ——
 *    否则"用户确认的是不是他看过的那一份"这个问题会重新变成猜想
 *    （同一条理由见 `draftStore.ts` 的 `previewHash` 与 `workerContracts.ts` 的 `artifact`）。
 */

/** 屏幕坐标里的一个矩形（像素）。布局判定的基本单位。 */
export interface LayoutBox {
  /** 对象 id 或标签 id（用于把诊断指回具体对象）。 */
  id: string
  x: number
  y: number
  width: number
  height: number
  /** `label` = 文字标签的盒子；`object` = 图形本身的盒子。 */
  kind: "object" | "label"
  /**
   * 对象盒子的**呈现类别**。只对 `kind: "object"` 有意义。
   *
   * `marker` = 点 / 顶点这类本质上就只有一个记号的对象；`shape` = 有实际铺开面积的图形。
   *
   * 为什么要分开：`minVisibleAreaRatio`（最小可见面积）只对 `shape` 有意义。
   * 一个立方体有 8 个顶点，每个顶点在屏幕上只有几个像素 —— 拿"面积占比"去判它们，
   * 一份**完全正常**的文档会被报出 8 条 `tiny_object`。
   * 一个乱报警的检查器会被学会忽略，那比没有检查器更糟。
   */
  shape?: "marker" | "shape"
}

export interface Viewport {
  width: number
  height: number
}

/**
 * 一个可直接喂给 `diagnoseLayout` 的布局模型：视口 + 盒子。
 *
 * 单独成一个类型（而不是"到处传两个参数"），是为了让"谁算出来的盒子"与"谁判定"分开：
 * `layoutModel.ts` 从文档算盒子，`diagnoseLayout` 只判定。接线到真实渲染器时
 * 只需要换掉算盒子的那一个函数，判定逻辑一行都不用改。
 */
export interface LayoutModel {
  viewport: Viewport
  boxes: readonly LayoutBox[]
}

/** 一张截图 artifact。**只在本次运行内有效**，不进长期记忆。 */
export interface ScreenshotArtifact {
  /** MIME 类型；缺了它调用方无法判断能不能交给 provider。 */
  mimeType: string
  /** 图像字节（base64）。**刻意不是 Buffer/Uint8Array**：它要能过消息边界与日志脱敏。 */
  base64: string
  width: number
  height: number
}

export type RenderEvidenceMode =
  /** 只有结构化的包围盒与布局读数 —— **不需要 provider 有视觉能力**。 */
  | "structured_only"
  /** 结构化读数 + 截图，且 provider 的 vision 能力已验证。 */
  | "vision_verified"

export interface RenderEvidence {
  mode: RenderEvidenceMode
  /** 证据绑定的草稿身份。**必填**（见文件头纪律 3）。 */
  runId: string
  draftId: string
  draftVersion: number
  viewport: Viewport
  boxes: readonly LayoutBox[]
  screenshot?: ScreenshotArtifact
}

/** 一条布局诊断。`code` 稳定可枚举，供一次性修复与门禁消费。 */
export interface LayoutDiagnostic {
  code: "empty_canvas" | "clipped_object" | "label_overlap" | "tiny_object" | "degenerate_viewport"
  severity: "error" | "warning"
  detail: string
  /** 相关对象 id（空表示这是全局问题，例如画面为空）。 */
  objectIds: readonly string[]
}

export interface LayoutThresholds {
  /** 一个对象在视口里至少要有这么大比例的面积才算"看得见"。 */
  minVisibleAreaRatio: number
  /** 两个标签盒子重叠超过这个比例就算叠在一起。 */
  labelOverlapRatio: number
}

export const DEFAULT_LAYOUT_THRESHOLDS: LayoutThresholds = { minVisibleAreaRatio: 0.002, labelOverlapRatio: 0.2 }

function area(box: LayoutBox): number {
  return Math.max(0, box.width) * Math.max(0, box.height)
}

function intersectionArea(a: LayoutBox, b: LayoutBox): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return width <= 0 || height <= 0 ? 0 : width * height
}

/** 盒子与视口矩形的交叠面积。 */
function visibleArea(box: LayoutBox, viewport: Viewport): number {
  const width = Math.min(box.x + box.width, viewport.width) - Math.max(box.x, 0)
  const height = Math.min(box.y + box.height, viewport.height) - Math.max(box.y, 0)
  return width <= 0 || height <= 0 ? 0 : width * height
}

/** 盒子落在视口内的面积占比（0..1）。超出视口的部分不计。 */
export function visibleRatio(box: LayoutBox, viewport: Viewport): number {
  const total = area(box)
  return total <= 0 ? 0 : Math.min(1, visibleArea(box, viewport) / total)
}

/** 两个盒子的重叠面积 ÷ 较小那个的面积。标签叠加的判据。 */
export function overlapRatio(a: LayoutBox, b: LayoutBox): number {
  const smaller = Math.min(area(a), area(b))
  if (smaller <= 0) return 0
  return intersectionArea(a, b) / smaller
}

/**
 * **纯本地的布局诊断**。
 *
 * 判据刻意**保守**：只有当对象**真的出界**（有一部分在视口外）或者**真的太小**
 * （可见面积低于阈值）时才报，而不是"看起来可能不好"。
 * 一个会乱报警的检查器与没有检查器一样糟 —— 用户会学会忽略它。
 */
export function diagnoseLayout(
  viewport: Viewport,
  boxes: readonly LayoutBox[],
  thresholds: LayoutThresholds = DEFAULT_LAYOUT_THRESHOLDS
): LayoutDiagnostic[] {
  const diagnostics: LayoutDiagnostic[] = []

  if (!(viewport.width > 0) || !(viewport.height > 0)) {
    // 视口本身退化时，**后面每一条判定都没有意义** —— 如实说这一条，不去报一堆下游噪声。
    return [{ code: "degenerate_viewport", severity: "error", detail: `viewport is ${viewport.width}x${viewport.height}`, objectIds: [] }]
  }

  const objects = boxes.filter((box) => box.kind === "object")
  const labels = boxes.filter((box) => box.kind === "label")

  if (objects.length === 0) {
    // 空画布的判据是"**一个图形对象都没有**"，标签单独存在不算有内容。
    /**
     * **不 `return`**（实测缺陷修正）。原先这里直接返回，于是"没有对象盒子"时
     * **标签叠加永远查不出来** —— 而"只有标签、没有对象盒子"是真实存在的一种输入
     *（`apps/web/src/agent/renderLayoutInput.ts` 只产出标签盒子，因为屏幕上的标签
     * 已经由渲染层投影好了，而对象盒子要另一条路径）。
     *
     * 症状会很坏：两个标签叠在一起时，一次运行只报"画布是空的"，
     * 而"画布是空的"听起来像别的问题，排障会往错的方向走。
     */
    diagnostics.push({ code: "empty_canvas", severity: "error", detail: "no drawable object is inside the viewport", objectIds: [] })
  }

  for (const box of objects) {
    const ratio = visibleRatio(box, viewport)
    if (ratio <= 0) {
      diagnostics.push({ code: "clipped_object", severity: "error", detail: `${box.id} is entirely outside the viewport`, objectIds: [box.id] })
      continue
    }
    if (ratio < 1) {
      diagnostics.push({ code: "clipped_object", severity: "warning", detail: `${box.id} is only ${Math.round(ratio * 100)}% inside the viewport`, objectIds: [box.id] })
      continue
    }
    const viewportArea = viewport.width * viewport.height
    // 只有"有实际铺开面积"的对象才受最小可见面积约束（见 `LayoutBox.shape` 的注释）。
    if (box.shape === "shape" && viewportArea > 0 && area(box) / viewportArea < thresholds.minVisibleAreaRatio) {
      diagnostics.push({ code: "tiny_object", severity: "warning", detail: `${box.id} covers ${(area(box) / viewportArea * 100).toFixed(3)}% of the viewport`, objectIds: [box.id] })
    }
  }

  /**
   * 标签两两比对。**只比标签与标签**：图形互相压住是正常的（3D 里必然有遮挡），
   * 而标签叠在一起是真的看不清。
   */
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) {
      const ratio = overlapRatio(labels[i], labels[j])
      if (ratio >= thresholds.labelOverlapRatio) {
        diagnostics.push({ code: "label_overlap", severity: "warning", detail: `${labels[i].id} and ${labels[j].id} overlap by ${Math.round(ratio * 100)}%`, objectIds: [labels[i].id, labels[j].id] })
      }
    }
  }

  return diagnostics
}

/**
 * 把布局诊断折成**验证报告**（见 `contracts.VerificationReport`）。
 *
 * 判据与 `verification/taskVerification.ts` 同一条口径：**含糊不算通过**。
 * 空画布与完全出界是 `failed`；只有警告（部分出界 / 太小 / 标签叠）时，
 * 报告是 `passed` **但检查项里带着那条警告** —— 因为"能看见、但有一处小瑕疵"
 * 与"看不见"是两件事，把它们混成同一个 `failed` 会让这条信号失去分辨力。
 */
export function layoutVerificationReport(diagnostics: readonly LayoutDiagnostic[]): VerificationReport {
  const checks: VerificationCheck[] = diagnostics.map((diagnostic) => ({
    id: `layout:${diagnostic.code}`,
    status: diagnostic.severity === "error" ? "failed" : "passed",
    detail: diagnostic.detail,
    ...(diagnostic.objectIds.length === 0 ? {} : { path: diagnostic.objectIds[0] })
  }))
  const status: VerificationReport["status"] = checks.some((check) => check.status === "failed") ? "failed" : "passed"
  return {
    status,
    checks,
    next_actions: status === "passed" ? [] : diagnostics.filter((entry) => entry.severity === "error").map((entry) => entry.detail)
  }
}

/**
 * 能不能把截图交给 provider。
 *
 * 判据是"**provider 的 vision 能力已验证**"（不是"这家协议理论上支持图片"）。
 * 不满足时返回 `null` 并给出原因，调用方据此走 `structured_only` ——
 * 而不是发一张图出去然后假装看过。
 */
export function screenshotForProvider(evidence: RenderEvidence, visionVerified: boolean): { ok: true; screenshot: ScreenshotArtifact } | { ok: false; reason: string } {
  if (!visionVerified) return { ok: false, reason: "the provider's vision capability is not verified; using structured layout evidence only" }
  if (evidence.mode !== "vision_verified") return { ok: false, reason: `render evidence is ${evidence.mode}, not vision_verified` }
  if (evidence.screenshot === undefined) return { ok: false, reason: "no screenshot artifact was attached to this run" }
  const { mimeType, base64, width, height } = evidence.screenshot
  if (mimeType.length === 0) return { ok: false, reason: "the screenshot artifact has no mime type" }
  if (!mimeType.startsWith("image/")) return { ok: false, reason: `the screenshot artifact is ${mimeType}, which is not an image` }
  if (base64.length === 0) return { ok: false, reason: "the screenshot artifact has no bytes" }
  if (!(width > 0) || !(height > 0)) return { ok: false, reason: "the screenshot artifact has no drawable size" }
  return { ok: true, screenshot: evidence.screenshot }
}

/**
 * 证据身份是否完整（Task 4.1：「screenshot artifact 缺少 mime type、runId 或 draftVersion 时拒绝」）。
 *
 * 单独成一个函数，是因为这条判据要在**两个**地方用：构造证据时，以及从消息边界收到证据时。
 * 写成两遍必然会漂移，而漂移的后果是"一边接受、一边拒绝"（最难查的一类分叉）。
 */
export function evidenceIdentityProblem(evidence: Pick<RenderEvidence, "runId" | "draftId" | "draftVersion">): string | null {
  if (evidence.runId.length === 0) return "render evidence has no runId"
  if (evidence.draftId.length === 0) return "render evidence has no draftId"
  if (!Number.isInteger(evidence.draftVersion) || evidence.draftVersion < 1) return "render evidence has an invalid draftVersion"
  return null
}
