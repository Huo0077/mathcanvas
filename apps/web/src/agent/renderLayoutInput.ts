import type { LayoutBox, LayoutModel, Viewport } from "@draw/agent-core"

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
