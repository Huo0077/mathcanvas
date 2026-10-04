import type { Vector3 } from "@draw/geometry-kernel"

import type { PlanRelation, PlanRelationKind, PlanRelationTarget } from "./contracts"

/**
 * **关系判据的唯一真源**（设计 2026-10-03 §5.3）。
 *
 * ## 为什么是坐标版，而不是直接用内核的 `constraintResidual3`
 *
 * `packages/geometry-kernel/src/constraints3d.ts` 的 `constraintResidual3` 吃的是
 * `ConstraintSpec.targets: string[]`（**图元 id**）+ 一份文档上下文。而本层要在
 * **草稿物化之前**判定"这批即将产出的坐标"—— 那时文档里还没有任何图元 id。所以这里的入参是
 * 坐标，数学与内核**逐式相同**：
 *
 * - 平行（线∥线）：`|u × v| / (|u||v|)`
 * - 垂直（线⊥线）：`|u · v| / (|u||v|)`
 * - 共面：`|n · (p − p0)|`，`n` 由三点叉积给出（与 `planeFromPoints` 同款）
 * - 线⊥平面：方向与法向的 `|u × n| / (|u||n|)`；线∥平面：`|u · n| / (|u||n|)`
 *
 * **同源不靠自己声明，靠测试核对**：`relations.test.ts` 里有一条把同一组几何同时喂给
 * 内核的 `diagnoseConstraints3` 与本模块，要求两者的 `satisfied` 判定落在同一个结论上。
 * 否则"容差有两套"这件事会以"这里说满足、内核说不满足"的形式出现，而且很难查。
 *
 * ## 容差
 *
 * 退化保护用内核同一个常量 `1e-10`（`constraints3d.ts` 的 `EPSILON`），"方向是否可用"的判据
 * 也照它。**不许在这里另发明一套精度** —— 内核在 `constraints3d.ts` 里已经为同一类陷阱
 * （归一化失败导致"永远满足"的假约束）写过注释。
 */

/** 退化保护：与 `packages/geometry-kernel/src/constraints3d.ts` 的 `EPSILON` 同值。 */
const EPSILON = 1e-10

/** 核验容差：与内核 `diagnoseConstraint3` 的默认值一致。 */
export const RELATION_TOLERANCE = 1e-6

export type RelationKind = PlanRelationKind
export type RelationTarget = PlanRelationTarget
export type Relation = PlanRelation

/** 取一个顶点的坐标；取不到返回 `null`（**不许拿默认值顶上**）。 */
export type RelationLookup = (target: RelationTarget) => Vector3 | null

const subtract = (first: Vector3, second: Vector3): Vector3 => ({ x: first.x - second.x, y: first.y - second.y, z: first.z - second.z })
const dot = (first: Vector3, second: Vector3): number => first.x * second.x + first.y * second.y + first.z * second.z
const cross = (first: Vector3, second: Vector3): Vector3 => ({
  x: first.y * second.z - first.z * second.y,
  y: first.z * second.x - first.x * second.z,
  z: first.x * second.y - first.y * second.x
})
const length = (vector: Vector3): number => Math.hypot(vector.x, vector.y, vector.z)

/** 一组顶点；任何一个取不到就返回 `null`（**缺少来源时报数据不足，不算满足**）。 */
function pointsOf(targets: readonly RelationTarget[], lookup: RelationLookup): Vector3[] | null {
  const resolved = targets.map((target) => lookup(target))
  return resolved.every((point): point is Vector3 => point !== null) ? resolved : null
}

/** 由三个顶点定平面法向（与 `planeFromPoints` 同款叉积）。三点共线时返回 `null`。 */
function planeNormalFrom(first: Vector3, second: Vector3, third: Vector3): Vector3 | null {
  const normal = cross(subtract(second, first), subtract(third, first))
  return length(normal) > EPSILON ? normal : null
}

/** 一条线段的方向；两端重合（退化）时返回 `null`。 */
function directionOf(first: Vector3, second: Vector3): Vector3 | null {
  const vector = subtract(second, first)
  return length(vector) > EPSILON ? vector : null
}

/**
 * 逐条算残差：**满足时返回一个小数、不满足时返回一个正数、算不了时返回 `null`**。
 *
 * 三态区分是刻意的：把"算不了"当成 0 会得到一个"永远满足"的假约束。调用方（`verifyRelations`）
 * 把 `null` 当成**失败**，理由见那里的注释。
 */
export function relationResidual(relation: Relation, lookup: RelationLookup): number | null {
  const resolved = pointsOf(relation.targets, lookup)
  if (!resolved) return null

  if (relation.kind === "perpendicular" || relation.kind === "parallel") {
    // 3 个顶点 = 线与线；5 个 = 线与平面（后 3 个定平面）。
    if (resolved.length === 5) {
      const line = directionOf(resolved[0], resolved[1])
      const normal = planeNormalFrom(resolved[2], resolved[3], resolved[4])
      if (!line || !normal) return null
      const scale = length(line) * length(normal)
      if (scale <= EPSILON) return null
      // 线 ⊥ 平面 ⇔ 方向 ∥ 法向；线 ∥ 平面 ⇔ 方向 ⊥ 法向。
      return relation.kind === "perpendicular"
        ? length(cross(line, normal)) / scale
        : Math.abs(dot(line, normal)) / scale
    }
    if (resolved.length !== 4) return null
    const first = directionOf(resolved[0], resolved[1])
    const second = directionOf(resolved[2], resolved[3])
    if (!first || !second) return null
    const scale = length(first) * length(second)
    if (scale <= EPSILON) return null
    return relation.kind === "perpendicular" ? Math.abs(dot(first, second)) / scale : length(cross(first, second)) / scale
  }

  if (relation.kind === "coplanar") {
    if (resolved.length < 4) return null
    const normal = planeNormalFrom(resolved[0], resolved[1], resolved[2])
    if (!normal) return null
    // 与内核同一条判据：其余每个点到该平面的距离取最大值。
    return Math.max(...resolved.slice(3).map((point) => Math.abs(dot(normal, subtract(point, resolved[0])))))
  }

  if (relation.kind === "pointOn") {
    if (resolved.length !== 4) return null
    const normal = planeNormalFrom(resolved[1], resolved[2], resolved[3])
    if (!normal) return null
    return Math.abs(dot(normal, subtract(resolved[0], resolved[1])))
  }

  if (relation.kind === "equalLength" || relation.kind === "ratio") {
    if (resolved.length !== 4) return null
    const first = length(subtract(resolved[1], resolved[0]))
    const second = length(subtract(resolved[3], resolved[2]))
    if (first <= EPSILON) return null
    if (relation.kind === "equalLength") return Math.abs(second - first)
    const ratio = relation.value
    if (ratio === undefined || !Number.isFinite(ratio)) return null
    return Math.abs(second / first - ratio)
  }

  // midpoint：第一个是中点，后两个是端点。
  if (resolved.length !== 3) return null
  const midpoint = {
    x: (resolved[1].x + resolved[2].x) / 2,
    y: (resolved[1].y + resolved[2].y) / 2,
    z: (resolved[1].z + resolved[2].z) / 2
  }
  return length(subtract(resolved[0], midpoint))
}

export interface RelationFailure {
  id: string
  kind: RelationKind
  residual: number | null
  detail: string
}

export interface RelationCheck {
  ok: boolean
  failures: RelationFailure[]
}

/**
 * 逐条核验；`tolerance` 缺省用 `RELATION_TOLERANCE`。
 *
 * **取不到顶点也算失败**（`residual === null` → 进 `failures`）：这条是刻意的。另一种做法是
 * "无法判定就不管它"，但那会让"模型写了一个不存在的顶点名"变成**静默通过** —— 与设计
 * §6「不静默给残图」直接冲突。宁可报一条"缺少有效顶点来源"，让模型下一轮改正。
 */
export function verifyRelations(relations: readonly Relation[], lookup: RelationLookup, tolerance = RELATION_TOLERANCE): RelationCheck {
  const failures: RelationFailure[] = []
  relations.forEach((relation, index) => {
    const id = relation.id ?? `relation-${index}`
    const residual = relationResidual(relation, lookup)
    if (residual === null) {
      failures.push({ id, kind: relation.kind, residual: null, detail: "缺少有效顶点来源，无法计算这条关系的残差。" })
      return
    }
    if (!(residual <= tolerance)) {
      failures.push({
        id,
        kind: relation.kind,
        residual,
        detail: `残差 ${residual.toExponential(2)} 超过容差 ${tolerance.toExponential(2)}。`
      })
    }
  })
  return { ok: failures.length === 0, failures }
}
