import type { GeometryDocument, PrimitiveSpec, Vector3 } from "@draw/dsl"
import { isPlanarOnlyConstraint3, projectPoint3Constraints, type Point3ProjectionResult } from "@draw/geometry-kernel"
import { patchPoint3, type DomainOperation } from "@draw/scene-graph"

/**
 * **拖动一个空间点时保持已声明的约束**（N3 的接线层；实施计划 `Phase N3` 的 GREEN）。
 *
 * ## 这一层做什么、不做什么
 *
 * 做：把"抬手时那一次整体平移"翻译成一次**受约束的求解**，并把结果装成**一个事务**。
 * 不拥有任何几何判据 —— 判定只有 `projectPoint3Constraints` 一处（内核），
 * 本文件连一次点积都不算。
 *
 * ## 三条语义（都必须写清楚，否则接线处会读错）
 *
 * 1. **被拖点是"暖启动"，不是硬锚。** 先把被拖点放到 `原位置 + delta`，再让投影去满足约束 ——
 *    所以它可能**贴回约束上、不在指针正下方**。这正是"拖动保持约束"的意思（设计 §B 的原文是
 *    "拖动点**接近**指针"）。若把它当硬锚，那么"拖一个被约束在平面上的点"会 100% 被拒，
 *    因为这个点自己就违反了它自己的约束 —— 那条路等于把功能做死。
 * 2. **不许动的是锁定点与绑定点**（`anchoredPointIds`）。绑定点（`onHost` / `onFace` /
 *    `onSurface` / `inSolid` / `derived`）的坐标由重算从宿主参数算出，投影改它只会让文档
 *    "坐标对不上绑定"；锁定点是被用户显式钉住的。两者都交给锚点集，而不是在这里另判一遍。
 * 3. **只有 `satisfied` 才提交，而且提交是原子的。** 内核的判据是 fail-closed 的
 *    （跳过任何一条约束都不算满足），投影没跑完（`exhausted`）也不算。提交走
 *    `applyBatch` → `commitTransaction`，所以**一步撤销是白拿的**。
 *
 * ## 开关关着的时候
 *
 * `enabled === false` 时**只**返回 `passthrough`，调用方照旧走那一次
 * `apply({ op: "translatePrimitive3", id, delta })` —— 这就是"关闭 flag 时旧路径逐字回归"
 * 的实现方式，不是靠"看起来没变"。
 *
 * ## 这一批如实不支持的（一律 `passthrough`，交给旧路径）
 *
 * 非 `point3` 的被拖对象（面 / 线 / 模板实体的跟随者另有语义）、绑定点、锁定对象、
 * 以及**没有任何空间约束**的文档（没东西要保，旧路径就是对的）。
 */

export interface ConstrainedDragRequest {
  document: GeometryDocument
  /** 被拖动的图元 id（`onDragEnd` 回带的那个）。 */
  draggedId: string
  /** 从按下到抬手的**累计世界位移**。 */
  delta: Vector3
  /** `agentNextPhaseFlags().constrainedDrag`。 */
  enabled: boolean
}

/**
 * 四种出口，判据各不相同，**不许压成一个布尔值**：
 * - `passthrough`：这一批不管这条路，调用方走原来的 `translatePrimitive3`；
 * - `noop`：求解成功但**一个坐标都没变**（约束把这次拖动完全抵消了），不要提交空事务；
 * - `refused`：拖到这里没法同时满足已声明的约束 —— **拒绝，并把原因说清楚**；
 * - `commit`：把这批点坐标用**一次**事务写下去。
 */
export type ConstrainedDragOutcome =
  | { kind: "passthrough"; reason: string }
  | { kind: "noop"; reason: string }
  | { kind: "refused"; reason: string }
  | { kind: "commit"; operations: DomainOperation[]; note: string }

/** 浮点尾巴：与内核判定"这个点被挪过"的阈值同量级。 */
const SAME_POSITION_EPSILON = 1e-9

function samePosition(first: Vector3, second: Vector3): boolean {
  return Math.abs(first.x - second.x) <= SAME_POSITION_EPSILON
    && Math.abs(first.y - second.y) <= SAME_POSITION_EPSILON
    && Math.abs(first.z - second.z) <= SAME_POSITION_EPSILON
}

/** 一个点的坐标是否**由别的东西决定**（绑定点）—— 投影改它只会让文档自相矛盾。 */
function isBoundPoint(primitive: Extract<PrimitiveSpec, { type: "point3" }>): boolean {
  return primitive.binding !== undefined && primitive.binding.kind !== "free"
}

/** 锚点集：被拖动的那个点**不在**里面（它是暖启动），锁定点与绑定点在。 */
function anchorIdsFor(document: GeometryDocument): string[] {
  const ids: string[] = []
  for (const primitive of document.primitives) {
    if (primitive.type !== "point3") continue
    if (primitive.locked === true || isBoundPoint(primitive)) ids.push(primitive.id)
  }
  return ids
}

function describeFailure(projection: Point3ProjectionResult, constraints: GeometryDocument["constraints"]): string {
  /**
   * **可证的矛盾优先说**：那是"我知道它不成立"，与下面那句"我还没满足它"不是一件事。
   * 先说后者会把一个**证明过**的结论降级成一句含糊的"没算出来"。
   */
  if (projection.contradictions.length > 0) {
    return projection.contradictions.map((entry) => `${entry.reason}（${entry.constraintIds.join("、")}）`).join("；")
  }
  const byId = new Map(constraints.map((constraint) => [constraint.id, constraint]))
  const parts = projection.skipped.map((entry) => {
    const constraint = byId.get(entry.constraintId)
    return `${constraint?.type ?? "约束"}「${entry.constraintId}」：${entry.reason}`
  })
  for (const id of projection.analysis.unsatisfiedConstraintIds) {
    const constraint = byId.get(id)
    parts.push(`${constraint?.type ?? "约束"}「${id}」拖后仍然不满足`)
  }
  return parts.length > 0 ? parts.join("；") : "约束没有给出具体原因"
}

/**
 * 决定这一次拖动怎么提交。**纯函数**：不读 store、不碰时钟、不改入参文档。
 */
export function planConstrainedDrag3(request: ConstrainedDragRequest): ConstrainedDragOutcome {
  const { document, draggedId, delta, enabled } = request
  if (!enabled) return { kind: "passthrough", reason: "constrainedDrag 关闭：走原来的整体平移。" }

  const dragged = document.primitives.find((primitive) => primitive.id === draggedId)
  if (dragged?.type !== "point3") {
    return { kind: "passthrough", reason: "约束拖动这一批只支持空间点；其余对象走原来的整体平移。" }
  }
  if (isBoundPoint(dragged)) {
    return { kind: "passthrough", reason: "这个点是绑定点（坐标由宿主参数算出），走原来的路径。" }
  }
  if (dragged.locked === true) {
    return { kind: "passthrough", reason: "对象已锁定：原来的路径会如实拒绝它。" }
  }

  const planar = document.constraints.filter((constraint) => isPlanarOnlyConstraint3(constraint.type))
  const spatial = document.constraints.filter((constraint) => !isPlanarOnlyConstraint3(constraint.type))
  if (spatial.length === 0) {
    return {
      kind: "passthrough",
      reason: planar.length === 0 ? "这份文档没有空间约束，没有要保住的东西。" : "这份文档只有平面约束，3D 拖动不参与它们。"
    }
  }

  const target: Vector3 = { x: dragged.position.x + delta.x, y: dragged.position.y + delta.y, z: dragged.position.z + delta.z }
  // 暖启动：先把被拖点放到用户拖到的位置，再让投影把它（连同别的点）拉回约束上。
  const warmStart: PrimitiveSpec[] = document.primitives.map((primitive) => primitive.id === dragged.id
    ? { ...primitive, position: { ...target } }
    : primitive)

  const projection = projectPoint3Constraints(warmStart, spatial, { anchoredPointIds: anchorIdsFor(document) })
  if (!projection.satisfied) {
    const detail = describeFailure(projection, spatial)
    // 矛盾是**证明过**的结论，文案不许与"没能同时满足"混用同一句话。
    if (projection.contradictions.length > 0) {
      return { kind: "refused", reason: `这些约束本身不可能同时成立，已拒绝。${detail}` }
    }
    return {
      kind: "refused",
      reason: projection.exhausted
        ? `拖到这里，约束在轮数内没能同时满足（还在动，这不等于"无解"）。${detail}`
        : `拖到这里会破坏已声明的约束，已拒绝。${detail}`
    }
  }

  /**
   * 操作集按**与原始文档**逐点比对得出（不是与暖启动比对）：被拖点被投影拉回来时，
   * "它相对暖启动动了"和"它相对原文档动了"是两个不同的判断，而事务要写的是后者。
   */
  const operations: DomainOperation[] = []
  for (const primitive of document.primitives) {
    if (primitive.type !== "point3") continue
    const finalPosition = projection.positions.get(primitive.id)
    if (finalPosition === undefined || samePosition(finalPosition, primitive.position)) continue
    operations.push(patchPoint3(primitive.id, finalPosition))
  }
  if (operations.length === 0) {
    return { kind: "noop", reason: "约束把这次拖动完全抵消了：没有可提交的坐标变化。" }
  }

  const notes: string[] = [`已按约束调整 ${operations.length} 个点`]
  if (projection.analysis.remainingDof > 0) notes.push(`还剩 ${projection.analysis.remainingDof} 个自由度未定`)
  if (projection.analysis.overconstrained) {
    notes.push(`其中 ${projection.analysis.redundantConstraintIds.length} 条约束是冗余的（${projection.analysis.redundantConstraintIds.join("、")}）`)
  }
  if (planar.length > 0) notes.push(`${planar.length} 条平面约束不参与 3D 拖动`)
  return { kind: "commit", operations, note: notes.join("；") }
}
