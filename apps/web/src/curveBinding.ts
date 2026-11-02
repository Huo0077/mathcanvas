import type { Coordinate, GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { cascadeDeletionClosure, parameterWindow, pathConstraint, type DomainOperation } from "@draw/scene-graph"

import { isDynamicPointPath } from "./dynamicPointPaths"

/** 曲线吸附默认判定半径（屏幕像素） */
export const CURVE_SNAP_RADIUS_PX = 14

export interface CurveSnapTarget {
  path: PrimitiveSpec
  point: Coordinate
  parameter: number
  branch: number
  distancePx: number
  clamped: boolean
}

export function pointParameterId(pointId: string): string {
  return `t-${pointId}`
}

export function isDomainRequired(path: PrimitiveSpec): boolean {
  return path.type === "parabola" || path.type === "hyperbola"
}

/**
 * 寻找距离指针最近的可见曲线在轨吸附目标。
 *
 * 具有循环依赖防护：若曲线在拓扑依赖图上是待绑定点的下游，则坚决拒绝吸附，防止形成环路。
 */
export function findNearestCurveTarget(
  document: GeometryDocument,
  pointer: Coordinate,
  scale: number,
  options?: {
    snapRadiusPx?: number
    excludeIds?: string[]
    previousBranch?: number
    draggedPointId?: string
  }
): CurveSnapTarget | null {
  const snapRadiusPx = options?.snapRadiusPx ?? CURVE_SNAP_RADIUS_PX
  const excludeIds = new Set(options?.excludeIds ?? [])
  if (options?.draggedPointId) excludeIds.add(options.draggedPointId)

  // 拓扑环路防护：计算当前点的下游闭包，防止点绑定到自身派生出的曲线上
  const downstreamIds = options?.draggedPointId
    ? new Set(cascadeDeletionClosure(document, [options.draggedPointId]))
    : null

  let bestTarget: CurveSnapTarget | null = null
  let bestDistancePx = snapRadiusPx

  for (const primitive of document.primitives) {
    if (primitive.visible === false || primitive.locked) continue
    if (excludeIds.has(primitive.id)) continue
    if (downstreamIds && downstreamIds.has(primitive.id)) continue
    if (!isDynamicPointPath(primitive)) continue

    const constraint = pathConstraint(primitive, document.parameters)
    if (!constraint) continue

    const projection = constraint.project(pointer, { previousBranch: options?.previousBranch })
    if (!projection || !projection.converged) continue

    const distPx = Math.hypot(pointer.x - projection.point.x, pointer.y - projection.point.y) * scale
    if (distPx <= bestDistancePx) {
      bestDistancePx = distPx
      bestTarget = {
        path: primitive,
        point: projection.point,
        parameter: projection.parameter,
        branch: projection.branch,
        distancePx: distPx,
        clamped: projection.clamped
      }
    }
  }

  return bestTarget
}

/**
 * 生成将已有自由点直接绑定到目标曲线的原子批量事务操作。
 */
export function createPointBindingOperations(
  document: GeometryDocument,
  pointId: string,
  target: CurveSnapTarget,
  pointLabel?: string
): DomainOperation[] {
  const parameterId = pointParameterId(pointId)
  const window = parameterWindow(target.path, document.parameters)
  const label = pointLabel ?? pointId

  const setParameterOp: DomainOperation = {
    op: "setParameter",
    id: parameterId,
    value: target.parameter,
    min: window.min,
    max: window.max,
    step: (window.max - window.min) / 100,
    label: `${label} 的路径参数`,
    ownerId: pointId
  }

  const updatePrimitiveOp: DomainOperation = {
    op: "updatePrimitive",
    id: pointId,
    patch: {
      x: target.point.x,
      y: target.point.y,
      binding: {
        kind: "onPath",
        pathId: target.path.id,
        parameterId,
        parameter: target.parameter,
        ...(isDomainRequired(target.path) ? { domain: [window.min, window.max] as [number, number] } : {}),
        ...(target.path.type === "hyperbola" ? { branch: (target.branch ?? 0) as 0 | 1 } : {})
      }
    }
  }

  return [setParameterOp, updatePrimitiveOp]
}

/**
 * 生成在目标曲线上直接创建在轨动点的原子批量事务操作。
 */
export function createBoundPointCreationOperations(
  document: GeometryDocument,
  pointId: string,
  pointLabel: string,
  target: CurveSnapTarget,
  cadLayerFields: Record<string, unknown> = {}
): DomainOperation[] {
  const parameterId = pointParameterId(pointId)
  const window = parameterWindow(target.path, document.parameters)

  const setParameterOp: DomainOperation = {
    op: "setParameter",
    id: parameterId,
    value: target.parameter,
    min: window.min,
    max: window.max,
    step: (window.max - window.min) / 100,
    label: `${pointLabel} 的路径参数`,
    ownerId: pointId
  }

  const addPrimitiveOp: DomainOperation = {
    op: "addPrimitive",
    primitive: {
      id: pointId,
      type: "point",
      x: target.point.x,
      y: target.point.y,
      ...cadLayerFields,
      label: pointLabel,
      binding: {
        kind: "onPath",
        pathId: target.path.id,
        parameterId,
        parameter: target.parameter,
        ...(isDomainRequired(target.path) ? { domain: [window.min, window.max] as [number, number] } : {}),
        ...(target.path.type === "hyperbola" ? { branch: (target.branch ?? 0) as 0 | 1 } : {})
      }
    }
  }

  return [setParameterOp, addPrimitiveOp]
}
