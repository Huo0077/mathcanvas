/**
 * **底面内部派生点**（T4，2026-11-05 四题修复）。
 *
 * 见 [修复设计](../../../../docs/superpowers/specs/2026-11-05-solid-geometry-four-cases-design.md) §4.3
 * "棱锥内部垂足"。
 *
 * ## 为什么需要这一层
 *
 * 内核此前的棱锥垂足**必须是底面环上的点名顶点**（`constructPyramidWitness` 的
 * `if (!base.names.includes(foot)) reject(...)`）。Case 3 的题面是
 * `AC 与 BD 相交于点 O，PO ⊥ 平面 ABCD` —— `O` 是**对角线交点**，不是环顶点，
 * 于是整条链在入口就被拒掉。
 *
 * 直接把 `O` 换成 `A`、或把 `O` 塞进底面环（`A-B-O-C-D`）都是**改题面**：
 * 前者让顶点不在题面说的位置，后者给底面加了一个不存在的顶点。
 * 正确的做法是：**底面环仍然只有 A/B/C/D**，`O` 是一条**带来源的派生点**。
 *
 * ## 派生点带什么
 *
 * - `point`：坐标（由底面环自己算出来，不是题面给的）；
 * - `hostEdge` + `parameter`：它落在哪条线段上、参数是多少 —— 落盘时可以变成
 *   `dynamic.create_bound_point`（**绑定点**，不是"位置碰巧正确的自由点"）；
 * - `source`：用户看得懂的来源（"AC 与 BD 的交点"）。
 *
 * ## 拒绝是值不是异常
 *
 * 引用缺失、两条线重合/平行（交点不唯一）、交点落在端点（退化）、
 * 点名与底点重名、四点不共面 —— 全部结构化拒绝，绝不回退到"取 A"或"取自由高度"。
 */

import { crossVector3, dotVector3, lengthVector3, subtractVector3, type Vector3 } from "../geometry3d"
import type { DerivedBasePoint } from "./solidShapeSpec"

/** 派生点的几何结果（内核内部用；不依赖 `WitnessConstructRejection`，避免循环引用）。 */
export interface ResolvedDerivedPoint {
  name: string
  point: Vector3
  /** 落在哪条线段上（按题面的方向）。 */
  hostEdge: readonly [string, string]
  /** 线段参数，`(0, 1)` 开区间。 */
  parameter: number
  /** 用户可见来源。 */
  source: string
}

export type DerivedPointsResult =
  | { status: "ok"; points: ResolvedDerivedPoint[]; assumptions: string[] }
  | { status: "rejected"; code: "degenerate-base" | "non-finite-value" | "duplicate-name" | "missing-height-reference"; message: string; points: string[] }

const TOLERANCE = 1e-9

function rejected(code: Extract<DerivedPointsResult, { status: "rejected" }>["code"], message: string, points: string[]): DerivedPointsResult {
  return { status: "rejected", code, message, points }
}

/**
 * 两条线段的唯一交点（**线段内部**）。
 *
 * 在底面自己的平面里解：法向取两条方向向量的叉积，平面内取一组正交基再解 2×2。
 * 三种"交点不唯一 / 不存在"的情形分开报：
 * - 方向平行（叉积为零）⇒ 平行或重合，交点不唯一；
 * - 四点不共面 ⇒ 三维里这两条线根本不在同一张平面上，本层不做；
 * - 交点落在端点或线段外（`t`/`u` 不在开区间）⇒ 那不是"内部交点"。
 */
function segmentIntersection(
  first: readonly [Vector3, Vector3],
  second: readonly [Vector3, Vector3]
): { point: Vector3; parameter: number } | { reason: "parallel" | "non-coplanar" | "outside" } {
  const [p1, p2] = first
  const [p3, p4] = second
  const d1 = subtractVector3(p2, p1)
  const d2 = subtractVector3(p4, p3)
  if (!(lengthVector3(d1) > TOLERANCE) || !(lengthVector3(d2) > TOLERANCE)) return { reason: "outside" }
  const normal = crossVector3(d1, d2)
  const normalLength = lengthVector3(normal)
  if (!(normalLength > TOLERANCE)) return { reason: "parallel" }
  /** 共面：`p3`、`p4` 到「过 p1、法向 normal」的平面的距离都必须可忽略。 */
  const toPlane = (point: Vector3): number => Math.abs(dotVector3(subtractVector3(point, p1), normal)) / normalLength
  if (toPlane(p3) > TOLERANCE || toPlane(p4) > TOLERANCE) return { reason: "non-coplanar" }
  const unitNormal = { x: normal.x / normalLength, y: normal.y / normalLength, z: normal.z / normalLength }
  const e1 = { x: d1.x / lengthVector3(d1), y: d1.y / lengthVector3(d1), z: d1.z / lengthVector3(d1) }
  const e2 = crossVector3(unitNormal, e1)
  const project = (point: Vector3): { x: number; y: number } => ({
    x: dotVector3(subtractVector3(point, p1), e1),
    y: dotVector3(subtractVector3(point, p1), e2)
  })
  const a = lengthVector3(d1)
  const start = project(p3)
  const end = project(p4)
  const direction = { x: end.x - start.x, y: end.y - start.y }
  /**
   * `p1 + t·d1 = p3 + u·d2`，在 `(e1, e2)` 基里是
   * `t·(a, 0) = (start.x, start.y) + u·(dir.x, dir.y)`。
   * 第二行先解 `u = -start.y / dir.y`（`dir.y = 0` ⇒ 两条线在这个平面里平行）。
   */
  if (Math.abs(direction.y) <= TOLERANCE * Math.max(1, lengthVector3(d2))) return { reason: "parallel" }
  const u = -start.y / direction.y
  const t = (start.x + u * direction.x) / a
  if (!(t > 0 && t < 1 && u > 0 && u < 1)) return { reason: "outside" }
  return {
    point: { x: p1.x + d1.x * t, y: p1.y + d1.y * t, z: p1.z + d1.z * t },
    parameter: t
  }
}

/**
 * 解出全部派生点。`definitions` 为空 ⇒ 返回空结果（不改变既有行为）。
 *
 * **一个派生点只能来自一种来源**（本期只有 `diagonal-intersection`）：认不出的
 * `kind` 直接拒绝，而不是"悄悄跳过"——跳过等于把题面点名的一个点弄丢。
 */
export function resolveDerivedBasePoints(input: {
  baseNames: readonly string[]
  basePoints: readonly Vector3[]
  definitions: readonly DerivedBasePoint[]
}): DerivedPointsResult {
  const { baseNames, basePoints, definitions } = input
  if (definitions.length === 0) return { status: "ok", points: [], assumptions: [] }
  const at = new Map<string, Vector3>()
  for (const [index, name] of baseNames.entries()) {
    const point = basePoints[index]
    if (point === undefined) return rejected("degenerate-base", `底面点名 ${name} 没有对应坐标。`, [name])
    at.set(name, point)
  }
  const resolved: ResolvedDerivedPoint[] = []
  const usedNames = new Set(baseNames)
  const assumptions: string[] = []
  for (const definition of definitions) {
    if (definition.kind !== "diagonal-intersection") {
      return rejected("degenerate-base", `派生点 ${definition.name} 的来源 ${String((definition as { kind?: unknown }).kind)} 尚无解析实现。`, [definition.name])
    }
    if (typeof definition.name !== "string" || definition.name.length === 0) {
      return rejected("missing-height-reference", "派生点缺少点名。", [])
    }
    if (usedNames.has(definition.name)) {
      return rejected("duplicate-name", `派生点 ${definition.name} 与已有底点重名，无法区分。`, [definition.name])
    }
    const [firstLine, secondLine] = definition.lines
    if (firstLine.length !== 2 || secondLine.length !== 2) {
      return rejected("degenerate-base", `派生点 ${definition.name} 的每条线必须恰好两个端点。`, [definition.name])
    }
    const endpoints = [firstLine[0], firstLine[1], secondLine[0], secondLine[1]]
    for (const name of endpoints) {
      if (!at.has(name)) return rejected("missing-height-reference", `派生点 ${definition.name} 引用了底面上不存在的点 ${name}。`, [definition.name, name])
    }
    if (firstLine[0] === firstLine[1] || secondLine[0] === secondLine[1]) {
      return rejected("degenerate-base", `派生点 ${definition.name} 的一条线两端是同一个点，没有方向。`, [definition.name])
    }
    const intersection = segmentIntersection(
      [at.get(firstLine[0])!, at.get(firstLine[1])!],
      [at.get(secondLine[0])!, at.get(secondLine[1])!]
    )
    if ("reason" in intersection) {
      const why = intersection.reason === "parallel"
        ? `两条线 ${firstLine.join("")} 与 ${secondLine.join("")} 平行或重合，交点不唯一`
        : intersection.reason === "non-coplanar"
          ? `两条线 ${firstLine.join("")} 与 ${secondLine.join("")} 不在同一张平面上`
          : `两条线 ${firstLine.join("")} 与 ${secondLine.join("")} 的交点不在两条线段内部`
      return rejected("degenerate-base", `派生点 ${definition.name} 无法确定：${why}。`, [definition.name, ...endpoints])
    }
    if (!Number.isFinite(intersection.point.x) || !Number.isFinite(intersection.point.y) || !Number.isFinite(intersection.point.z)) {
      return rejected("non-finite-value", `派生点 ${definition.name} 的坐标不是有限数值。`, [definition.name])
    }
    usedNames.add(definition.name)
    resolved.push({
      name: definition.name,
      point: intersection.point,
      hostEdge: [firstLine[0], firstLine[1]],
      parameter: intersection.parameter,
      source: `${firstLine.join("")} 与 ${secondLine.join("")} 的交点`
    })
    assumptions.push(
      `辅助点 ${definition.name} 取 ${firstLine.join("")} 与 ${secondLine.join("")} 的交点（${definition.name} = (${[
        intersection.point.x,
        intersection.point.y,
        intersection.point.z
      ]
        .map((value) => (Math.abs(value) < 1e-12 ? "0" : value.toPrecision(6)))
        .join(", ")})）。它**不是**底面环上的顶点，环仍然是 ${baseNames.join("")}。`
    )
  }
  return { status: "ok", points: resolved, assumptions }
}
