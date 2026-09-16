import type { PrimitiveSpec } from "@draw/dsl"
import { extendPrimitive, offsetPrimitive, trimPrimitive, type GeometryEdit, type PlanarSnapPrimitive } from "@draw/geometry-kernel"
import type { PrimitiveUpdatePatch } from "@draw/scene-graph"

/**
 * 把「偏移 / 修剪 / 延伸」的内核结果组装成文档补丁，并在这里做前置条件校验。
 *
 * 放在纯函数里而不是组件里，是为了让规则可测、可复用（视口只负责按钮与提示）：
 * - 偏移：需要**恰好选中 1 个**受支持的图元；
 * - 修剪 / 延伸：需要**恰好选中 2 个**，顺序是「先边界、后被修改的对象」——选中顺序就是 `selectedIds` 的顺序；
 * - 修剪保留目标 **a 端**所在的一半，延伸把目标的 **b 端**拉到边界（规则写进视口提示里，不做隐式猜测）。
 */
export type GeometryEditRequest = { kind: "offset"; distance: number } | { kind: "trim" } | { kind: "extend" }

/**
 * 偏移是**新建**一个平行对象（AutoCAD 的 OFFSET 语义），修剪/延伸才是原地修改。
 * 这一点很容易写错成"把选中对象移开"——那其实是移动命令。
 */
export type GeometryEditOutcome =
  | { ok: true; kind: "create"; primitive: PrimitiveSpec }
  | { ok: true; kind: "update"; id: string; patch: PrimitiveUpdatePatch }
  | { ok: false; error: string }

const editableTypes = ["line", "segment", "ray", "polyline", "circle", "arc"] as const

/** 能参与这三种修改的平面图元；其它类型返回 null（不猜）。 */
export function planarEditTarget(primitive: PrimitiveSpec | undefined): PlanarSnapPrimitive | null {
  if (!primitive) return null
  return (editableTypes as readonly string[]).includes(primitive.type) ? primitive as PlanarSnapPrimitive : null
}

export function patchForGeometryEdit(edit: GeometryEdit): PrimitiveUpdatePatch {
  if (edit.kind === "line-like") return { a: edit.a, b: edit.b }
  if (edit.kind === "polyline") return { points: edit.points }
  return { radius: edit.radius }
}

export function resolveGeometryEdit(selected: PrimitiveSpec[], request: GeometryEditRequest, options: { nextId: string }): GeometryEditOutcome {
  if (request.kind === "offset") {
    if (selected.length !== 1) return { ok: false, error: "偏移需要恰好选中一个图元（当前选中 " + selected.length + " 个）" }
    const target = planarEditTarget(selected[0])
    if (!target) return { ok: false, error: "该图元不支持偏移" }
    if (target.locked) return { ok: false, error: "对象已锁定，无法修改" }
    const result = offsetPrimitive(target, request.distance)
    if (!result) return { ok: false, error: "该偏移距离会让半径变成 0 或负数" }
    const geometry = patchForGeometryEdit(result)
    // 复制样式与图层，但不继承参数绑定（`slopeParameter`）：新对象不该被原对象的参数继续驱动。
    const { slopeParameter: _ignored, ...rest } = target as PrimitiveSpec & { slopeParameter?: string }
    return {
      ok: true,
      kind: "create",
      primitive: { ...rest, ...geometry, id: options.nextId, label: `${target.label ?? target.id} 偏移` } as PrimitiveSpec
    }
  }

  if (selected.length !== 2) return { ok: false, error: `${request.kind === "trim" ? "修剪" : "延伸"}需要选中 2 个图元：先选边界，再选被修改的对象（当前 ${selected.length} 个）` }
  const boundary = planarEditTarget(selected[0])
  const target = planarEditTarget(selected[1])
  if (!boundary || !target) return { ok: false, error: "边界或目标图元类型不支持该操作" }
  if (target.locked) return { ok: false, error: "对象已锁定，无法修改" }
  if (target.type !== "line" && target.type !== "segment" && target.type !== "ray") return { ok: false, error: "修剪与延伸目前只支持直线、线段和射线" }
  // 规则固定：修剪保留 a 端那一半，延伸拉 b 端——用端点本身作为 "near"，不隐式取中点。
  const near = request.kind === "trim" ? target.a : target.b
  const result = request.kind === "trim" ? trimPrimitive(target, boundary, near) : extendPrimitive(target, boundary, near)
  if (!result) {
    return { ok: false, error: request.kind === "trim" ? "边界与目标没有交点，无法修剪" : "该方向上没有可以延伸到的交点" }
  }
  return { ok: true, kind: "update", id: target.id, patch: patchForGeometryEdit(result) }
}
