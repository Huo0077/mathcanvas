import type { PrimitiveSpec } from "@draw/dsl"

/**
 * 能把点变成动点的"路径"类型。
 *
 * 属性栏的「路径绑定」下拉与状态栏的绑定提示都从这里取，避免两处各写一份列表后走偏：
 * 提示里说的候选必须与下拉里真的能选的完全一致（用户反馈："我也不知道如何将点固定到
 * 我创立的曲线或直线轨迹上面"——提示与下拉对不上，就等于没有提示）。
 */
export const DYNAMIC_POINT_PATH_TYPES = ["line", "segment", "ray", "polyline", "circle", "arc", "function", "ellipse", "parabola", "hyperbola"] as const

export function isDynamicPointPath(primitive: PrimitiveSpec): boolean {
  return (DYNAMIC_POINT_PATH_TYPES as readonly string[]).includes(primitive.type)
}

export function dynamicPointPaths(primitives: readonly PrimitiveSpec[]): PrimitiveSpec[] {
  return primitives.filter(isDynamicPointPath)
}
