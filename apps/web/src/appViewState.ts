import { isSampledPrimitiveType, type GeometryDocument, type PrimitiveSpec } from "@draw/dsl"

import { point3ToolAvailability } from "./spatialTools"
import { solidTypes } from "./solidCommands"

/**
 * **App 的派生视图状态**（从 `App.tsx` 拆出来的纯计算，评审方案 2）。
 *
 * 这里全是"从文档 + 选中算出来的东西"：选中了谁、能不能建某一类对象、活动图层能不能画、
 * 标注与定点旋转的入参够不够。它们过去散在 `App.tsx` 里、与命令工厂的调用交织在一起，
 * 于是**只能靠渲染整棵 App 才能验**；搬成纯函数之后，喂一份文档就能直接问。
 *
 * ## 为什么返回类型靠推断，而不是手写 interface
 *
 * 它只有一个消费者（`App.tsx` 里那一次解构），字段名本身就是契约。手写一份二十多个字段的
 * interface 等于把同一份清单抄两遍，抄漏一处也只有类型检查能发现 —— 那就让类型检查直接管着
 * 返回值：少一个字段，解构处当场报错。
 *
 * ## 两条口径
 *
 * 1. **"能不能创建"一律看全仓库同一张表**：`isSampledPrimitiveType` 来自 `@draw/dsl`。
 *    这里以前自己抄了一份类型名单，切线因此既不能预览交点、也不能手动创建（用户报的就是这条）。
 * 2. **空选中不算"全部锁定 / 全部可见"**：`allSelectedLocked` / `allSelectedVisible` 在
 *    `selectedIds` 为空时是 `false` —— 没有选中对象时，"批量锁定"这类命令不该可用。
 */
export function deriveAppViewState({ document, selectedIds }: { document: GeometryDocument; selectedIds: string[] }) {
  /** 选中栈里最后一个是"当前"对象（多选时以最后点的那个为准）。这一行原来也住在 `App.tsx`。 */
  const selectedId = selectedIds.at(-1) ?? null
  const selectedPrimitive = selectedId ? document.primitives.find((primitive) => primitive.id === selectedId) ?? null : null
  const selectedPointIds = selectedIds.filter((id) => document.primitives.find((primitive) => primitive.id === id)?.type === "point")
  const selectedPoint3Ids = selectedIds.filter((id) => document.primitives.find((primitive) => primitive.id === id)?.type === "point3")
  const point3ToolState = point3ToolAvailability(selectedPoint3Ids.length, selectedIds.length)
  const canCreateLine3 = point3ToolState.line
  const canCreatePlane3 = point3ToolState.plane
  const canCreateFace3 = point3ToolState.face
  const canCreateCircle3 = point3ToolState.circle
  const canCreatePointConnection = (selectedIds.length === 2 || selectedIds.length === 3) && selectedPointIds.length === selectedIds.length
  /**
   * "能不能由这两个对象创建交点"用的是**全仓库同一张表**（`@draw/dsl` 的 `SAMPLED_PRIMITIVE_TYPES`）。
   * 这里以前自己抄了一份类型名单，切线因此既不能预览交点、也不能手动创建 —— 用户报的正是这一条。
   */
  const canCreateIntersection = canCreatePointConnection || (selectedIds.length === 2 && selectedIds.every((id) => {
    const primitive = document.primitives.find((candidate) => candidate.id === id)
    return primitive ? isSampledPrimitiveType(primitive.type) : false
  }))
  const allSelectedLocked = selectedIds.length > 0 && selectedIds.every((id) => document.primitives.find((primitive) => primitive.id === id)?.locked)
  const allSelectedVisible = selectedIds.length > 0 && selectedIds.every((id) => document.primitives.find((primitive) => primitive.id === id)?.visible !== false)
  const canCreateSection = selectedPrimitive !== null && solidTypes.includes(selectedPrimitive.type as typeof solidTypes[number])
  const cadActiveLayer = (document.layers ?? []).find((layer) => layer.id === document.activeLayerId) ?? null
  const cadActiveLayerBlockedReason = cadActiveLayer?.visible === false
    ? `图层「${cadActiveLayer.name}」已隐藏，无法创建对象`
    : cadActiveLayer?.locked ? `图层「${cadActiveLayer.name}」已锁定，无法创建对象` : null

  const cadAnnotationSources = selectedIds.filter((id) => {
    const primitive = document.primitives.find((candidate) => candidate.id === id)
    return primitive?.type === "point3" || primitive?.type === "edge3"
  })
  const cadPoint3SourceCount = cadAnnotationSources.filter((id) => document.primitives.find((primitive) => primitive.id === id)?.type === "point3").length
  const cadEdge3SourceCount = cadAnnotationSources.filter((id) => document.primitives.find((primitive) => primitive.id === id)?.type === "edge3").length
  const canCreateLinearAnnotation = cadPoint3SourceCount === 2 || cadEdge3SourceCount === 1
  const canCreateAngularAnnotation = cadPoint3SourceCount === 3 || cadEdge3SourceCount === 2
  /**
   * "绕定点旋转"要先有一个点、再有一条封闭曲线（圆 / 椭圆）。
   * 顺序无所谓：命令自己会把点投影到曲线上，所以用户点一个近处的点也能用。
   */
  const rotationAnchor = (() => {
    const selected = selectedIds.map((id) => document.primitives.find((primitive) => primitive.id === id)).filter((primitive): primitive is PrimitiveSpec => Boolean(primitive))
    const point = selected.find((primitive) => primitive.type === "point")
    const curve = selected.find((primitive) => primitive.type === "circle" || primitive.type === "ellipse")
    return point?.type === "point" && curve && (curve.type === "circle" || curve.type === "ellipse") ? { point, curve } : null
  })()
  const canAnchorRotation = rotationAnchor !== null && !rotationAnchor.curve.locked
  return {
    selectedId,
    selectedPrimitive,
    selectedPointIds,
    selectedPoint3Ids,
    point3ToolState,
    canCreateLine3,
    canCreatePlane3,
    canCreateFace3,
    canCreateCircle3,
    canCreatePointConnection,
    canCreateIntersection,
    canCreateSection,
    allSelectedLocked,
    allSelectedVisible,
    cadActiveLayer,
    cadActiveLayerBlockedReason,
    cadAnnotationSources,
    cadPoint3SourceCount,
    cadEdge3SourceCount,
    canCreateLinearAnnotation,
    canCreateAngularAnnotation,
    rotationAnchor,
    canAnchorRotation
  }
}
