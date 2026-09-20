import type { PrimitiveSpec } from "@draw/dsl"

/**
 * **派生对象**：值由别的对象算出来，因此不可拖拽、不可单独编辑。
 *
 * 判据只有这一处（`DERIVED_PRIMITIVE_TYPES`），三个使用方都从这里取：
 * - 画布 `interaction.ts`：决定"不给拖拽手柄"（派生对象拖的是它的来源，不是它自己）；
 * - 草稿预览 `apps/web/src/agent/draftCounts.ts`：统计"有多少个我改不了的对象"；
 * - 场景观察 `sceneObservation.ts`：告诉模型哪些对象不能直接编辑。
 *
 * **为什么放在 `@draw/agent-core` 而不是 `apps/web`**：它本来在 `apps/web/src/derivedPrimitives.ts`，
 * 但场景观察（agent-core）也需要同一份判据。两边各留一份拷贝一定会分叉 ——
 * 而这个项目已经因为"同一个判断写了两遍"吃过亏（来源解析的 `sourceLabel`/`cadInspectorSources` 漂移、
 * 导出用了 `document` 而显示用了来源文档）。依赖方向是 `@draw/web → @draw/agent-core`，
 * 所以中立点就在 agent-core，`apps/web` 从这里导入。
 *
 * 与 `primitiveVisibility`（在 apps/web 里）的分工：那个回答"画不画"，
 * 这里回答"能不能编辑"——两件事经常一起用，但不是同一件事
 *（隐藏的派生对象仍不可编辑，可见的派生对象也不可编辑）。
 */
export const DERIVED_PRIMITIVE_TYPES: ReadonlySet<PrimitiveSpec["type"]> = new Set([
  // 连接不含自己的坐标，完全由两个端点定义：拖它没有意义，要拖的是端点。
  "connection",
  "intersection",
  "lineCircleIntersection",
  "circleIntersection",
  "curveIntersection",
  "intersectionSet"
])

export function isDerivedPrimitive(primitive: PrimitiveSpec): boolean {
  return DERIVED_PRIMITIVE_TYPES.has(primitive.type)
}

/**
 * **内部近似细节**：圆类实体（圆柱 / 圆锥）多边形近似的细分顶点与母线。
 *
 * 它们**留在文档里**（面 / 棱 / 交线 / 剖切 / 布尔交集读的是它们的坐标，48 段精度照旧），
 * 但画布不画、对象列表不列、也不给模型看 —— 否则一个 48 段圆柱会显得有 88 个用户点。
 *
 * 与 `apps/web/src/primitiveVisibility.ts` 的 `isTessellationPrimitive` 是**同一判据**，
 * 放在这里是为了让场景观察不必依赖 app 包。两处的漂移由 `sceneObservation.test.ts` 里
 * 一条"同一份输入必须同判"的用例挡着（app 侧的 `isTessellationPrimitive` 也会被喂同一批样本）。
 */
export function isTessellationPrimitive(primitive: PrimitiveSpec): boolean {
  return (primitive.type === "point3" || primitive.type === "edge3") && primitive.tessellation === true
}
