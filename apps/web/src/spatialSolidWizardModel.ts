import type { Vector3 } from "@draw/dsl"
import { planeThroughPoints } from "@draw/scene-graph"

import type { TeachingSolidInput } from "./spatialSolidCommands"

export type SolidPreset = "cube" | "box" | "tri-prism" | "quad-prism" | "tri-pyramid" | "quad-pyramid" | "sphere"

export interface SolidWizardDraft {
  preset: SolidPreset
  origin: Vector3
  width: number
  depth: number
  height: number
  offsetX: number
  offsetY: number
  useSelectedBase: boolean
  /** 球体预设用：半径（球心就是 `origin`，与其它预设共用"起点"那个字段）。 */
  radius: number
}

export const DEFAULT_SOLID_WIZARD_DRAFT: SolidWizardDraft = {
  preset: "box",
  origin: { x: 0, y: 0, z: 0 },
  width: 4,
  depth: 3,
  height: 3,
  offsetX: 0,
  offsetY: 0,
  useSelectedBase: false,
  radius: 2
}

export function solidWizardInput(draft: SolidWizardDraft, selectedBase?: Vector3[]): TeachingSolidInput | { error: string } {
  const { origin, width, depth, height, offsetX, offsetY } = draft
  /**
   * 球**先判**：它只用到球心与半径，共用不到下面那套"底面 / 拉伸向量 / 顶点偏移"的尺寸校验
   *（否则 `width/depth/height` 会给球带进一堆与它无关的合法性约束）。报错文案里点名"球"，
   * 免得它和棱锥那条错误混成一句看不出所以然的话。
   */
  if (draft.preset === "sphere") {
    const { radius } = draft
    if (!Number.isFinite(radius) || radius <= 0) return { error: "球的半径必须是有限正数" }
    if (![origin.x, origin.y, origin.z].every(Number.isFinite)) return { error: "球的球心必须是有限数" }
    return { kind: "sphere", center: origin, radius }
  }
  const isCube = draft.preset === "cube"
  const isBox = isCube || draft.preset === "box"
  const usesPresetBase = isBox || !draft.useSelectedBase
  const dimensions = [
    ...(usesPresetBase ? [width] : []),
    ...(!isCube && usesPresetBase ? [depth] : []),
    ...(!isCube ? [height] : [])
  ]
  const coordinates = [
    ...(usesPresetBase ? [origin.x, origin.y, origin.z] : []),
    ...(!isBox ? [offsetX, offsetY] : [])
  ]
  if (dimensions.some((length) => !Number.isFinite(length) || length <= 0) || coordinates.some((coordinate) => !Number.isFinite(coordinate))) {
    return { error: "当前使用的尺寸必须是有限正数，偏移及原点必须是有限数" }
  }
  if (draft.preset === "cube") return { kind: "box", origin, size: { x: width, y: width, z: width } }
  if (draft.preset === "box") return { kind: "box", origin, size: { x: width, y: depth, z: height } }

  let base: Vector3[]
  if (draft.useSelectedBase) {
    if (!selectedBase || selectedBase.length < 3) return { error: "请先选中一个至少有三个顶点的空间面" }
    base = selectedBase
  } else {
    base = draft.preset.startsWith("tri-")
      ? [origin, { x: origin.x + width, y: origin.y, z: origin.z }, { x: origin.x + width / 2, y: origin.y + depth, z: origin.z }]
      : [origin, { x: origin.x + width, y: origin.y, z: origin.z }, { x: origin.x + width, y: origin.y + depth, z: origin.z }, { x: origin.x, y: origin.y + depth, z: origin.z }]
  }
  if (draft.preset.endsWith("-prism")) return { kind: "prism", base, vector: { x: offsetX, y: offsetY, z: height } }

  const plane = planeThroughPoints(base)
  if (!plane) return { error: "底面顶点必须不共线且共面" }
  const center = base.reduce((sum, point) => ({ x: sum.x + point.x / base.length, y: sum.y + point.y / base.length, z: sum.z + point.z / base.length }), { x: 0, y: 0, z: 0 })
  return { kind: "pyramid", base, apex: {
    x: center.x + plane.normal.x * height + offsetX,
    y: center.y + plane.normal.y * height + offsetY,
    z: center.z + plane.normal.z * height
  } }
}