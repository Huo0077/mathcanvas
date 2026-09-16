import type { Vector3 } from "@draw/dsl"

/**
 * 交给 3D 场景的虚线预览：两个对象的交线线段集合，或单个实体截面的有序边界点。
 * 单独成文件，避免把非组件导出混进 `threeScene.tsx`（Fast Refresh 规则）。
 */
export interface ThreeScenePreview {
  kind: "intersection" | "section"
  segments: { a: Vector3; b: Vector3 }[]
  points: Vector3[]
  label: string
  /**
   * 截面预览的剖切面（法向 + 常数项，`normal · p + constant = 0`）与来源实体 id。
   * 只有边界点的话画布上只看到一条交线，看不出"切在哪"；带上平面才能在画布上画出剖切面片。
   */
  plane?: { normal: Vector3; constant: number }
  sourceId?: string
}
