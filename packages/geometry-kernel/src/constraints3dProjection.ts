import type { ConstraintSpec, Plane3Primitive, PrimitiveSpec, Vector3 } from "@draw/dsl"

import { constraintResidual3, diagnoseConstraint3, isLineLike3, projectPointOntoLine3, projectPointOntoPlane3, type ConstraintDiagnostic3 } from "./constraints3d"
import { addVector3, dotVector3, lengthVector3, normalizeVector3, planeFromPoints, scaleVector3, subtractVector3 } from "./geometry3d"

/**
 * **3D 约束的点投影**（N3「动态拖动保持约束」的第一块内核砖）。
 *
 * ## 它与 `solvePoint3Constraints` 的分工
 *
 * 那一个**只诊断、绝不动点**（文件头与一条用例钉着这条），本文件这一个**真的改坐标**。
 * 两条路都要留着：拖动前问"现在差多少"，拖动中问"该挪到哪"。合成一个函数的结果是
 * "只想量一下"的调用方被顺手改了几何 —— 那正是这个项目最忌讳的静默破坏。
 *
 * ## 它**不做**什么（第 1 版边界，全部如实进 `skipped`）
 *
 * - 不做通用约束求解：没有迭代优化、没有 RNG、没有时钟。顺序投影跑固定次数，
 *   **同一份输入必然给同一份输出**（这一点是刻意的：拖动要可撤销、可重放）。
 * - 不做"把一条线转过去"（`parallel` / `perpendicular` 的线状写法）：那要先决定旋转哪一侧的点，
 *   是一个产品判断，不是数学结论。需要动却没规则时**如实报 `no-projection-rule`**，
 *   绝不假装已经满足。
 * - 不报"过约束 / 矛盾"这类结论：本层只说"每条被判过的约束是否在容差内"。
 *   把"没做"说成"矛盾"、把"跳过"说成"满足"，都会让上层的门禁读到假绿。
 *
 * ## 为什么有 `satisfied` 也有 `exhausted`
 *
 * - `satisfied`：**每一条**约束都被判过、且都在容差内。`skipped` 非空时恒为 `false` ——
 *   fail-closed。它是"能不能把这组坐标当作满足约束"的唯一判据。
 * - `exhausted`：次数用完还没到定点，说明这次的结果是**半成品**（还在动），
 *   与"停下来了但没满足"是两件事。两者都为 `false` 时读 `skipped`。
 */

/** 为什么这条约束**没有**被投影。每一种都对应一个不同的下一步，不许合并。 */
export type Point3ProjectionSkipCode =
  /** 点名在图元表里取不到，**或**取到的图元种类对不上这条约束（例如 pointOnLine 的第二项不是线）。 */
  | "missing-target"
  /** 平面（2D）约束，内核没有它的空间判据。 */
  | "planar-only"
  /** 点名都取到了，但这组几何退化（方向为零、三点共线……），残差算不出来。 */
  | "no-judge"
  /** 需要动，而这一版还没有它的投影规则。 */
  | "no-projection-rule"
  /** 这条约束牵涉的点一个都不许动（都在 `anchoredPointIds` 里）。 */
  | "no-movable-point"

export interface Point3ProjectionSkip {
  constraintId: string
  code: Point3ProjectionSkipCode
  /** 给人看的原因。末尾一律是"这一批/这一版"，与"它就是错的"分开说。 */
  reason: string
}

export interface Point3ProjectionOptions {
  /**
   * **不许动的点**：拖动时用户抓住的那个点、被锁定宿主牵住的点。
   *
   * 这是本函数的**唯一**自由度裁剪入口。刻意不做"按绑定推可动方向"（那是
   * `constraintIR.reportFreeDegrees` 的活）：这里只回答"把谁挪到哪"，
   * 谁不能挪由调用方说了算。
   */
  anchoredPointIds?: readonly string[]
  /** 顺序投影的轮数上限；缺省 `max(12, 约束条数 + 1)`（与 2D 的 `solveLineConstraints` 同量级）。 */
  maxIterations?: number
  /** 残差容差；缺省 `1e-6`（与 `diagnoseConstraint3` 的默认值同源）。 */
  tolerance?: number
}

export interface Point3ProjectionResult {
  /** **全部** `point3` 的最终坐标（含没动过的）—— 调用方拿它去写文档。 */
  positions: Map<string, Vector3>
  /** 真的被挪动过的点 id，按图元顺序。没动过的不列。 */
  movedPointIds: string[]
  /** 逐条约束的读数（与入参同序），诊断口径与 `diagnoseConstraint3` 一致。 */
  diagnostics: ConstraintDiagnostic3[]
  /** 没有被投影的约束**及原因**。非空 ⇒ `satisfied` 必为 `false`。 */
  skipped: Point3ProjectionSkip[]
  /** 每一条约束都被判过且在容差内。fail-closed 的提交门禁。 */
  satisfied: boolean
  /** 轮数用完了还没到定点：结果是半成品（还在动），不要当"停稳了"读。 */
  exhausted: boolean
  /** 实际跑了几轮（`exhausted` 为 `true` 时等于上限）。 */
  iterations: number
}

const DEFAULT_MAX_ITERATIONS = 12
const DEFAULT_TOLERANCE = 1e-6
/** 判定"这个点真的被挪了"的阈值：低于它按没动处理，免得把浮点尾巴记成一堆 moved。 */
const MOVED_EPSILON = 1e-9

/** 内核没有空间判据的约束（与 `constraintIR.ts` 的 `NO_SPATIAL_JUDGE` 同一件事，理由见那里）。 */
const NO_SPATIAL_JUDGE: ReadonlySet<ConstraintSpec["type"]> = new Set<ConstraintSpec["type"]>(["coincident"])

/** 这一版**有投影规则**的约束。其余需要动时如实报 `no-projection-rule`。 */
const PROJECTABLE: ReadonlySet<ConstraintSpec["type"]> = new Set<ConstraintSpec["type"]>([
  "pointOnLine",
  "pointOnPlane",
  "collinear",
  "coplanar",
  "fixedDistance"
])

type Point3 = Extract<PrimitiveSpec, { type: "point3" }>

function isPoint3(primitive: PrimitiveSpec | undefined): primitive is Point3 {
  return primitive?.type === "point3"
}

function samePosition(first: Vector3, second: Vector3): boolean {
  return Math.abs(first.x - second.x) <= MOVED_EPSILON
    && Math.abs(first.y - second.y) <= MOVED_EPSILON
    && Math.abs(first.z - second.z) <= MOVED_EPSILON
}

/** 把 `target` 的坐标写成 `position`，并如实回答"这一次真的动了吗"。 */
function moveTo(target: Point3, position: Vector3): boolean {
  if (samePosition(target.position, position)) return false
  target.position.x = position.x
  target.position.y = position.y
  target.position.z = position.z
  return true
}

type ApplyOutcome = { kind: "moved" } | { kind: "nothing" } | { kind: "skipped"; code: Point3ProjectionSkipCode; reason: string }

/**
 * 一次投影。三条前提**先判后动**：
 * ① 这条约束有没有判据（没有 → `no-judge`）；② 它现在满足了吗（满足 → 什么都不做，
 * **即使它的点全被锚住也不算问题**）；③ 需要动时，有没有规则、有没有可动的点。
 *
 * 第 ② 条的顺序很关键：先问"要不要动"再问"能不能动"，否则一条**本来就满足**的约束
 * 会因为它的点被锚住而被记成 `no-movable-point`，把一个好结果报成问题。
 */
function applyConstraint(
  constraint: ConstraintSpec,
  map: ReadonlyMap<string, PrimitiveSpec>,
  movable: (id: string) => boolean,
  tolerance: number
): ApplyOutcome {
  if (NO_SPATIAL_JUDGE.has(constraint.type)) {
    return { kind: "skipped", code: "planar-only", reason: `${constraint.type} 是平面（2D）约束，内核没有它的空间判据，这一版不投影。` }
  }
  const missing = constraint.targets.filter((target) => !map.has(target))
  if (missing.length > 0) {
    return { kind: "skipped", code: "missing-target", reason: `点名 ${missing.join("、")} 在这份文档里取不到，无法投影（不是「已满足」）。` }
  }

  const residual = constraintResidual3(constraint, map)
  if (residual === null) {
    return { kind: "skipped", code: "no-judge", reason: "点名都取到了，但这组几何退化（方向为零、三点共线之类），残差算不出来。" }
  }
  if (residual <= tolerance) return { kind: "nothing" }
  if (!PROJECTABLE.has(constraint.type)) {
    return {
      kind: "skipped",
      code: "no-projection-rule",
      reason: `${constraint.type} 需要动这些点，而这一版还没有它的投影规则（这一版只做 pointOnLine / pointOnPlane / collinear / coplanar / fixedDistance 的拖动投影）。`
    }
  }

  const primitive = (id: string): PrimitiveSpec | undefined => map.get(id)

  if (constraint.type === "pointOnLine") {
    const target = primitive(constraint.targets[0])
    const line = primitive(constraint.targets[1])
    if (!isPoint3(target) || !isLineLike3(line)) {
      return { kind: "skipped", code: "missing-target", reason: "pointOnLine 要一个点与一条线状图元，这份文档里的点名对不上。" }
    }
    if (!movable(target.id)) return { kind: "skipped", code: "no-movable-point", reason: `pointOnLine 的 ${target.id} 在 anchoredPointIds 里，这条约束没法在不违反锚点的前提下满足。` }
    const foot = projectPointOntoLine3(target.position, line, map)
    if (foot === null) return { kind: "skipped", code: "no-judge", reason: "直线退化（两端点重合），垂足有无穷多个，不编一个出来。" }
    return moveTo(target, foot) ? { kind: "moved" } : { kind: "nothing" }
  }

  if (constraint.type === "pointOnPlane") {
    const target = primitive(constraint.targets[0])
    const plane = primitive(constraint.targets[1])
    if (!isPoint3(target) || plane?.type !== "plane3") {
      return { kind: "skipped", code: "missing-target", reason: "pointOnPlane 要一个点与一张平面，这份文档里的点名对不上。" }
    }
    if (!movable(target.id)) return { kind: "skipped", code: "no-movable-point", reason: `pointOnPlane 的 ${target.id} 在 anchoredPointIds 里，这条约束没法在不违反锚点的前提下满足。` }
    const foot = projectPointOntoPlane3(target.position, plane as Plane3Primitive, map)
    if (foot === null) return { kind: "skipped", code: "no-judge", reason: "平面法向归一化失败或基点取不到，落点算不出来。" }
    return moveTo(target, foot) ? { kind: "moved" } : { kind: "nothing" }
  }

  if (constraint.type === "collinear") {
    const [first, second] = [primitive(constraint.targets[0]), primitive(constraint.targets[1])]
    const extras = constraint.targets.slice(2).map(primitive)
    if (!isPoint3(first) || !isPoint3(second) || extras.some((entry) => !isPoint3(entry))) {
      return { kind: "skipped", code: "missing-target", reason: "collinear 要一串空间点，这份文档里的点名对不上。" }
    }
    const direction = subtractVector3(second.position, first.position)
    const squared = dotVector3(direction, direction)
    if (squared <= MOVED_EPSILON * MOVED_EPSILON) {
      return { kind: "skipped", code: "no-judge", reason: "collinear 的前两个点重合，这条直线没有方向，投影目标不确定。" }
    }
    const movableExtras = (extras as Point3[]).filter((entry) => movable(entry.id))
    if (movableExtras.length === 0) return { kind: "skipped", code: "no-movable-point", reason: "collinear 里除前两点外的点都在 anchoredPointIds 里，没有可动的点。" }
    let moved = false
    for (const extra of movableExtras) {
      const ratio = dotVector3(subtractVector3(extra.position, first.position), direction) / squared
      moved = moveTo(extra, addVector3(first.position, scaleVector3(direction, ratio))) || moved
    }
    return moved ? { kind: "moved" } : { kind: "nothing" }
  }

  if (constraint.type === "coplanar") {
    const anchors = constraint.targets.slice(0, 3).map(primitive)
    const extras = constraint.targets.slice(3).map(primitive)
    if (anchors.some((entry) => !isPoint3(entry)) || extras.some((entry) => !isPoint3(entry))) {
      return { kind: "skipped", code: "missing-target", reason: "coplanar 要一串空间点，这份文档里的点名对不上。" }
    }
    const [first, second, third] = anchors as Point3[]
    const plane = planeFromPoints(first.position, second.position, third.position)
    if (!plane) return { kind: "skipped", code: "no-judge", reason: "coplanar 的前三个点共线，定不出平面，投影目标不确定。" }
    const unit = normalizeVector3(plane.normal)
    if (lengthVector3(unit) <= MOVED_EPSILON) return { kind: "skipped", code: "no-judge", reason: "coplanar 定出的平面法向归一化失败，落点算不出来。" }
    const movableExtras = (extras as Point3[]).filter((entry) => movable(entry.id))
    if (movableExtras.length === 0) return { kind: "skipped", code: "no-movable-point", reason: "coplanar 里除前三点外的点都在 anchoredPointIds 里，没有可动的点。" }
    let moved = false
    for (const extra of movableExtras) {
      const distance = dotVector3(subtractVector3(extra.position, first.position), unit)
      moved = moveTo(extra, subtractVector3(extra.position, scaleVector3(unit, distance))) || moved
    }
    return moved ? { kind: "moved" } : { kind: "nothing" }
  }

  // fixedDistance：保留第一个点、挪第二个（与 2D `projectLineConstraint` 的"动第二个"同口径）。
  // 第二个点不许动时反过来挪第一个 —— 否则拖动一个被锚住的点会得到一个"改不动"的死结。
  const first = primitive(constraint.targets[0])
  const second = primitive(constraint.targets[1])
  if (!isPoint3(first) || !isPoint3(second) || constraint.value === undefined) {
    return { kind: "skipped", code: "missing-target", reason: "fixedDistance 要两个空间点与一个距离值，这份文档里的点名或值对不上。" }
  }
  const direction = subtractVector3(second.position, first.position)
  const length = lengthVector3(direction)
  if (length <= MOVED_EPSILON) {
    return { kind: "skipped", code: "no-judge", reason: "fixedDistance 的两个点重合，往哪个方向分开是个产品判断，不猜。" }
  }
  const unit = scaleVector3(direction, 1 / length)
  if (movable(second.id)) return moveTo(second, addVector3(first.position, scaleVector3(unit, constraint.value))) ? { kind: "moved" } : { kind: "nothing" }
  if (movable(first.id)) return moveTo(first, subtractVector3(second.position, scaleVector3(unit, constraint.value))) ? { kind: "moved" } : { kind: "nothing" }
  return { kind: "skipped", code: "no-movable-point", reason: "fixedDistance 的两个点都在 anchoredPointIds 里，这条约束没法在不违反锚点的前提下满足。" }
}

/**
 * **把点投影到约束上**（顺序投影 / Gauss–Seidel 式，与 2D 的 `solveLineConstraints` 同一个思路）。
 *
 * @param primitives 现有图元。**只读**：内部逐点克隆，返回的坐标在 `positions` 里，
 *   入参数组与其中的对象**一个字段都不会被改**（有用例钉着）。
 * @param constraints 文档里的空间约束（`GeometryDocument.constraints`）。
 */
export function projectPoint3Constraints(
  primitives: readonly PrimitiveSpec[],
  constraints: readonly ConstraintSpec[],
  options: Point3ProjectionOptions = {}
): Point3ProjectionResult {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE
  const maxIterations = options.maxIterations ?? Math.max(DEFAULT_MAX_ITERATIONS, constraints.length + 1)
  const anchored = new Set(options.anchoredPointIds ?? [])

  /**
   * 逐点克隆。**必须克隆**：内部是按引用改坐标的，不克隆就等于把调用方的文档改掉，
   * 而这发生在一个"只是问一下该挪到哪"的函数里时最难查。
   */
  const working = primitives.map((primitive): PrimitiveSpec => primitive.type === "point3"
    ? { ...primitive, position: { ...primitive.position } }
    : primitive)
  const map = new Map(working.map((primitive) => [primitive.id, primitive]))
  const movable = (id: string): boolean => map.get(id)?.type === "point3" && !anchored.has(id)

  const skipped = new Map<string, Point3ProjectionSkip>()
  let satisfied = false
  let exhausted = true
  let iterations = 0

  for (let pass = 0; pass < maxIterations; pass += 1) {
    iterations = pass + 1
    /**
     * 每一趟重新收集 `skipped`：上一趟修不了的约束，这一趟可能已经被**别的**约束顺手带满足了
     * （顺序投影的顺序就是这样起作用的）。不重算会留下一条过期的"没修好"。
     */
    skipped.clear()
    let applied = false
    for (const constraint of constraints) {
      const outcome = applyConstraint(constraint, map, movable, tolerance)
      if (outcome.kind === "moved") applied = true
      else if (outcome.kind === "skipped") skipped.set(constraint.id, { constraintId: constraint.id, code: outcome.code, reason: outcome.reason })
    }
    if (skipped.size === 0 && constraints.every((constraint) => {
      const residual = constraintResidual3(constraint, map)
      return residual !== null && residual <= tolerance
    })) {
      satisfied = true
      exhausted = false
      break
    }
    // 定点：这一趟没有挪动任何点，再转也不会变。停下来，但**不声称满足**。
    if (!applied) {
      exhausted = false
      break
    }
  }

  const original = new Map(primitives.filter(isPoint3).map((primitive) => [primitive.id, primitive.position]))
  const positions = new Map<string, Vector3>()
  const movedPointIds: string[] = []
  for (const primitive of working) {
    if (!isPoint3(primitive)) continue
    positions.set(primitive.id, { ...primitive.position })
    const before = original.get(primitive.id)
    if (before !== undefined && !samePosition(before, primitive.position)) movedPointIds.push(primitive.id)
  }

  return {
    positions,
    movedPointIds,
    diagnostics: constraints.map((constraint) => diagnoseConstraint3(constraint, map, tolerance)),
    skipped: [...skipped.values()],
    satisfied,
    exhausted,
    iterations
  }
}
