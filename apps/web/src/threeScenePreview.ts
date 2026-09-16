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
}
