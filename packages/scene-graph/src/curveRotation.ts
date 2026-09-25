import type { CurveRotation, PrimitiveSpec } from "@draw/dsl"
import type { ConicPlacement } from "@draw/geometry-kernel"

/**
 * **曲线绕定点旋转的"喂料层"**（从 `operations.ts` 拆出，评审方案 2）。
 *
 * 约定：`pivot` 是那个**定点**、`angle` 是绕它的转角（弧度）；几何本身由内核的 `placedConic` 落地，
 * 这一层只负责把文档里的两种定点写法喂给它。
 *
 * "圆心是一个点图元"的圆（`centerPointId`）**不参与**这套放置：它的圆心由那个点直接给出，
 * 再叠一次刚体转动只会让圆心在两个来源之间打架 —— 两种能力各自独立，这里明确二选一。
 *
 * 拆出来的原因：依赖图（`./graph`）与 `operations.ts` 都要用 `curveRotationPivotId`，
 * 而这些函数又依赖不到两者中的任何一个，放在这里就没有环。
 */

/**
 * 曲线的"绕定点旋转"约定：`pivot` 是那个**定点**，`angle` 是绕它的转角（弧度）。
 * 几何本身由内核的 `placedConic` 落地，这一层只负责把文档里的两种定点写法喂给它。
 *
 * "圆心是一个点图元"的圆（`centerPointId`）**不参与**这套放置：它的圆心由那个点直接给出，
 * 再叠一次刚体转动只会让圆心在两个来源之间打架。两种能力各自独立，这里明确二选一。
 */
export function curveRotationOf(primitive: PrimitiveSpec): CurveRotation | undefined {
  if (primitive.type === "circle") return primitive.centerPointId ? undefined : primitive.rotationAbout
  return primitive.type === "ellipse" ? primitive.rotationAbout : undefined
}

/**
 * 把一个定点解析成世界坐标。
 *
 * 两种写法都支持：固定坐标（经典题型里那个定点），以及**点图元引用**
 * （先在曲线上放一个点、再让曲线绕它转）。引用悬空时返回 `undefined`，
 * 调用方按"没有放置"处理——曲线仍在原地画得出来，不会因为定点丢了就静默消失。
 *
 * `baseCenter` 一并带上：重算永远从基准几何出发，所以反复重算不会累积旋转（幂等）。
 */
export function resolveCurveRotation(
  primitive: PrimitiveSpec,
  lookup: (id: string) => PrimitiveSpec | undefined
): ConicPlacement | undefined {
  const rotation = curveRotationOf(primitive)
  if (!rotation) return undefined
  const baseCenter = { x: rotation.baseCenter.x, y: rotation.baseCenter.y }
  if (rotation.pivot.kind === "coordinate") return { pivot: { x: rotation.pivot.x, y: rotation.pivot.y }, angle: rotation.angle, baseCenter }
  const point = lookup(rotation.pivot.primitiveId)
  if (point?.type !== "point") return undefined
  return { pivot: { x: point.x, y: point.y }, angle: rotation.angle, baseCenter }
}

/** 这一层到处都要用：把"定点"解析器绑到某张图元查找表上。 */
export function placementResolver(primitives: readonly PrimitiveSpec[]): (primitive: PrimitiveSpec) => ConicPlacement | undefined {
  const byId = new Map(primitives.map((primitive) => [primitive.id, primitive]))
  return (primitive) => resolveCurveRotation(primitive, (id) => byId.get(id))
}

/** 曲线绕的定点是不是一个**点图元**；是的话返回它的 id（依赖图与平移都要用）。 */
export function curveRotationPivotId(primitive: PrimitiveSpec): string | null {
  const rotation = curveRotationOf(primitive)
  return rotation && rotation.pivot.kind === "primitive" ? rotation.pivot.primitiveId : null
}
