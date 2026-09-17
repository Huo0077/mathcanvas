import type { PrimitiveSpec } from "@draw/dsl"

/**
 * 细分图元 = 圆类实体（圆柱 / 圆锥）**多边形近似**的内部细节：细分顶点，以及连接两环 / 顶点的母线。
 *
 * 用户口径：①"立体里的圆相关的内容不要这么多标点啊，只需要四个点就够了"；②"有太多母线，用不上这些"。
 * 每个圆现在只把 4 个象限点当用户点，只有两个底环（圆锥是底环）的棱当用户棱，其余由 `buildSolidTemplate`
 * 标上 `tessellation: true`：它们**仍然留在文档里**（面 / 棱 / 交线 / 剖切 / 布尔交集读的是它们的坐标，
 * 48 段精度照旧），但画布不画、对象列表不列、也不能点选——否则一个 48 段圆柱会一次冒出 88 个点、
 * 48 条母线和 88 个标签。
 *
 * 单独成模块是为了让"谁算用户对象"只有一处定义：画布（`threeScene`）与对象树（`AlgebraView`）
 * 都从这里判断，避免两边各写一份条件而慢慢分叉。
 */
export function isTessellationPrimitive(primitive: PrimitiveSpec): boolean {
  return (primitive.type === "point3" || primitive.type === "edge3") && primitive.tessellation === true
}

/** 用户看得见的图元：显式隐藏的不算，近似的细分图元也不算。 */
export function isUserVisiblePrimitive(primitive: PrimitiveSpec): boolean {
  return primitive.visible !== false && !isTessellationPrimitive(primitive)
}
