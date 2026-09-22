import type { Coordinate, Vector3 } from "@draw/dsl"

import { coordinateInput, degenerateDiagnostic, derivedNode, missingSourceDiagnostic, numberInput, pointInput, vector3Input } from "./evaluator"
import { triangleCenterNode, triangleRadiusNode } from "./triangleCenters"
import type { DerivedNode, MeasurementNode } from "./types"

/**
 * **派生圆**（设计规格 §4.3 末句："所有中心、半径和圆均作为 DAG 下游节点"）。
 *
 * 一个圆 = 圆心 + 半径，两者都是**节点**而不是塞进圆里的数字：
 *
 * ```text
 * 顶点节点(A,B,C) --> 圆心节点(内心/外心) --\
 *                                        >-- 圆节点
 * 顶点节点(A,B,C) --> 半径节点(r/R) -----/
 * ```
 *
 * 这样"改一个顶点 → 圆心与半径各自重算 → 圆跟着走"就是图的拓扑序自动保证的事情，
 * 不需要在圆里再写一遍三角形几何。三角形的顶点一动，`getAffectedPrimitiveIds` 那条链
 * （点 → 圆心 / 半径 → 圆）也随之确定。
 *
 * 圆的值里带 `kind`，是为了让上层能区分"内切圆 / 外接圆 / 显式给圆心半径"——
 * 界面上它们该有不同的说明，而几何本身只有圆心与半径。
 */

export type DerivedCircleKind = "incircle" | "circumcircle" | "explicit"

export interface DerivedCircle {
  readonly center: Coordinate | Vector3
  readonly radius: number
  readonly kind: DerivedCircleKind
}

export interface DerivedCircleNodeOptions {
  readonly centerId: string
  readonly radiusId: string
  readonly kind?: DerivedCircleKind
}

/** 由"圆心节点 + 半径节点"造一个圆节点。两个来源都得有值，否则是结构化诊断。 */
export function derivedCircleNode(id: string, options: DerivedCircleNodeOptions): DerivedNode<DerivedCircle> {
  return derivedNode<DerivedCircle>(id, [options.centerId, options.radiusId], (inputs) => {
    const center = pointInput(inputs, options.centerId)
    if (!center) return { status: "undefined", diagnostic: missingSourceDiagnostic(id, options.centerId, `圆心 ${options.centerId} 没有可用的坐标。`) }
    const radius = numberInput(inputs, options.radiusId)
    if (radius === null) return { status: "undefined", diagnostic: missingSourceDiagnostic(id, options.radiusId, `半径 ${options.radiusId} 没有可用的数值。`) }
    // 半径为 0 或负数画不出圆（schema 也要求 radius > 0）：如实报退化，不给一个看不见的圆。
    if (!(radius > 0)) return { status: "degenerate", diagnostic: degenerateDiagnostic(id, `半径必须为正数，实际为 ${radius}。`) }
    return { status: "exact", value: { center, radius, kind: options.kind ?? "explicit" } }
  })
}

export interface TriangleCircleOptions {
  readonly metric: "incircle" | "circumcircle"
  readonly pointIds: readonly [string, string, string]
  readonly space?: "plane" | "space"
  readonly tolerance?: number
}

export interface TriangleCircleNodes {
  readonly center: DerivedNode<Coordinate | Vector3>
  readonly radius: MeasurementNode
  readonly circle: DerivedNode<DerivedCircle>
}

/**
 * 三角形的内切圆 / 外接圆：三个节点一次登记好（圆心、半径、圆）。
 *
 * 三个节点共享同一组顶点来源，因此"顶点动了只重算下游"在图上是可验证的：
 * 圆的直接上游只有圆心与半径两个节点（见 `circle.dependsOn`）。
 */
export function triangleCircleNodes(id: string, options: TriangleCircleOptions): TriangleCircleNodes {
  const centerId = `${id}:center`
  const radiusId = `${id}:radius`
  const circle = options.metric === "incircle"
    ? { center: triangleCenterNode(centerId, { kind: "incenter", pointIds: options.pointIds, ...(options.space ? { space: options.space } : {}), ...(options.tolerance === undefined ? {} : { tolerance: options.tolerance }) }),
        radius: triangleRadiusNode(radiusId, { metric: "inradius", pointIds: options.pointIds, ...(options.space ? { space: options.space } : {}), ...(options.tolerance === undefined ? {} : { tolerance: options.tolerance }) }),
        kind: "incircle" as const }
    : { center: triangleCenterNode(centerId, { kind: "circumcenter", pointIds: options.pointIds, ...(options.space ? { space: options.space } : {}), ...(options.tolerance === undefined ? {} : { tolerance: options.tolerance }) }),
        radius: triangleRadiusNode(radiusId, { metric: "circumradius", pointIds: options.pointIds, ...(options.space ? { space: options.space } : {}), ...(options.tolerance === undefined ? {} : { tolerance: options.tolerance }) }),
        kind: "circumcircle" as const }
  return {
    center: circle.center,
    radius: circle.radius,
    circle: derivedCircleNode(id, { centerId, radiusId, kind: circle.kind })
  }
}

/** 圆心的坐标读取（适配层用）：二维点返回 `Coordinate`，三维点返回 `Vector3`。 */
export const readCircleCenter = coordinateInput
export const readCircleCenter3 = vector3Input
