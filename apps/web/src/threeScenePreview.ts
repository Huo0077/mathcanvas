import type { Vector3 } from "@draw/dsl"

import type { IntersectionPreview3d } from "./intersectionPreviews3d"
import type { IntersectionPreview } from "./intersectionPreview3d"

/**
 * 交给 3D 场景的虚线预览。
 *
 * 三种：
 * - `intersection`：两个对象的交线（公共边界线段 + 端点交点）；
 * - `solid`：两个实体公共区域的**整体表面**（布尔交集的面片 + 面环 + 顶点交点）；
 * - `section`：单个实体的默认剖切平面截面（既有语义）。
 *
 * `key` 是稳定标识：3D 场景按它做增量同步（只重建变了的那一份），点击时也按它回传是**哪一份**预览。
 * 单独成文件，避免把非组件导出混进 `threeScene.tsx`（Fast Refresh 规则）。
 */
export interface ThreeScenePreview {
  key: string
  kind: "intersection" | "face" | "point" | "section"
  /** 预览涉及的对象 ID（点击创建时的来源）。 */
  sourceIds: string[]
  segments: { a: Vector3; b: Vector3 }[]
  points: Vector3[]
  /** 交面：这一面的法向、面积与形心（形心既是读数，也是创建图元时的 `hint`）。 */
  normal?: Vector3
  area?: number
  hint?: Vector3
  /**
   * 交面（曲面区域）：`points` 是"前导外环 + 其余环反向缝合"的多边形，这里是前导外环的顶点数。
   * 渲染方据此把填充三角化成**环向条带**（扇形会把两圈之间的洞整块填掉）。平面区域没有这个字段。
   */
  outerRingLength?: number
  /** 交点：位置。 */
  position?: Vector3
  /** 状态栏用它说明"这一份是什么、点下去创建什么"。 */
  label: string
  /**
   * 截面预览的剖切面（法向 + 常数项，`normal · p + constant = 0`）与来源实体 id。
   * 只有边界点的话画布上只看到一条交线，看不出"切在哪"；带上平面才能在画布上画出剖切面片。
   */
  plane?: { normal: Vector3; constant: number }
  sourceId?: string
  /** 用户当前选中的对象正属于这一份预览：画得更实，状态栏也优先说它。 */
  focused?: boolean
}

/**
 * 自动枚举出来的一份交线 / 交面 → 画布预览。
 * `focused` 由当前选择决定：选中的两个对象正是这一对时，它是用户"正在看"的那一份。
 */
export function toScenePreview(preview: IntersectionPreview3d, selectedIds: string[]): ThreeScenePreview {
  return {
    key: preview.key,
    kind: preview.kind,
    sourceIds: preview.sourceIds,
    segments: preview.segments,
    points: preview.points,
    normal: preview.normal,
    area: preview.area,
    hint: preview.hint,
    outerRingLength: preview.outerRingLength,
    position: preview.position,
    label: preview.label,
    focused: preview.sourceIds.every((id) => selectedIds.includes(id))
  }
}

/** 单个实体的默认剖切平面截面 → 画布预览；不是截面（或没有可预览内容）时返回 null。 */
export function toSectionScenePreview(preview: IntersectionPreview | null): ThreeScenePreview | null {
  if (!preview || preview.kind !== "section" || !preview.sourceId) return null
  return {
    key: `section:${preview.sourceId}`,
    kind: "section",
    sourceIds: preview.sourceIds,
    segments: [],
    points: preview.points,
    label: preview.label,
    plane: preview.plane,
    sourceId: preview.sourceId,
    focused: true
  }
}

/**
 * 选择驱动的交线预览（两个**面 / 平面**这类不参与自动枚举的对象之间）。
 *
 * 自动枚举只覆盖顶层实体之间的相交；用户按住 Alt 选中两个面（或一个面 + 一个实体）时，
 * 交线预览仍要走选择驱动的这条路——否则状态栏说"点击即可创建为截线图元"，画布上却没有可点的东西。
 * key 与自动预览同一套命名，调用方按 key 去重，同一对不会画两遍。
 */
export function toSelectionLineScenePreview(preview: IntersectionPreview | null): ThreeScenePreview | null {
  if (!preview || preview.kind !== "intersection" || preview.segments.length === 0) return null
  const [first, second] = preview.sourceIds
  if (!first || !second) return null
  const pairKey = first < second ? `${first}|${second}` : `${second}|${first}`
  return {
    key: `pair:${pairKey}:线`,
    kind: "intersection",
    sourceIds: [first, second],
    segments: preview.segments,
    points: [],
    label: preview.label,
    focused: true
  }
}
