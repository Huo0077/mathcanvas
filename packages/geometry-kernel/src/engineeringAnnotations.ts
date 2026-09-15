import type { EngineeringAnnotation, GeometryDocument, PrimitiveSpec, Vector3 } from "@draw/dsl"

import { distanceVector3 } from "./geometry3d"
import { projectVector3, type ProjectedPoint } from "./projections3d"

export interface ResolvedEngineeringAnnotation extends EngineeringAnnotation {
  value?: number
  position?: ProjectedPoint
  projectedPoints: ProjectedPoint[]
}

const EPSILON = 1e-10

function pointById(primitives: Map<string, PrimitiveSpec>, id: string): Vector3 | null {
  const primitive = primitives.get(id)
  return primitive?.type === "point3" ? primitive.position : null
}

function edgeById(primitives: Map<string, PrimitiveSpec>, id: string): [Vector3, Vector3] | null {
  const primitive = primitives.get(id)
  if (primitive?.type !== "edge3") return null
  const first = pointById(primitives, primitive.pointIds[0])
  const second = pointById(primitives, primitive.pointIds[1])
  return first && second ? [first, second] : null
}

function averageProjected(points: ProjectedPoint[]): ProjectedPoint {
  const sum = points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y, depth: total.depth + point.depth }), { x: 0, y: 0, depth: 0 })
  return { x: sum.x / points.length, y: sum.y / points.length, depth: sum.depth / points.length }
}

function result(annotation: EngineeringAnnotation, status: EngineeringAnnotation["status"], explanation: string, value?: number, points: Vector3[] = []): ResolvedEngineeringAnnotation {
  const projectedPoints = points.map((point) => projectVector3(point, annotation.view)).filter((point): point is ProjectedPoint => point !== null)
  if (projectedPoints.length !== points.length) return { ...annotation, status: "insufficient-data", value: undefined, position: undefined, projectedPoints: [], explanation: "来源坐标无法投影" }
  return { ...annotation, status, value, position: projectedPoints.length ? averageProjected(projectedPoints) : undefined, projectedPoints, explanation }
}

function resolveLinearSources(primitives: Map<string, PrimitiveSpec>, sourceIds: string[]): [Vector3, Vector3] | null {
  if (sourceIds.length === 2) {
    const first = pointById(primitives, sourceIds[0])
    const second = pointById(primitives, sourceIds[1])
    return first && second ? [first, second] : null
  }
  return sourceIds.length === 1 ? edgeById(primitives, sourceIds[0]) : null
}

function resolveAngleSources(primitives: Map<string, PrimitiveSpec>, sourceIds: string[]): [Vector3, Vector3, Vector3] | null {
  if (sourceIds.length === 3) {
    const first = pointById(primitives, sourceIds[0])
    const vertex = pointById(primitives, sourceIds[1])
    const second = pointById(primitives, sourceIds[2])
    return first && vertex && second ? [first, vertex, second] : null
  }
  if (sourceIds.length === 2) {
    const first = edgeById(primitives, sourceIds[0])
    const second = edgeById(primitives, sourceIds[1])
    if (!first || !second) return null
    return [first[1], first[0], second[1]]
  }
  return null
}

export function resolveEngineeringAnnotation(document: GeometryDocument, annotation: EngineeringAnnotation): ResolvedEngineeringAnnotation {
  const primitives = new Map(document.primitives.map((primitive) => [primitive.id, primitive]))
  if (annotation.kind === "linear" || annotation.kind === "tolerance") {
    const points = resolveLinearSources(primitives, annotation.sourceIds)
    if (!points) return result(annotation, "insufficient-data", "需要两个空间点或一条空间棱")
    const value = distanceVector3(points[0], points[1])
    if (value <= EPSILON) return result(annotation, "degenerate", "线性尺寸来源长度为零")
    return result(annotation, "valid", annotation.kind === "tolerance" ? "线性公差尺寸有效" : "线性尺寸有效", value, points)
  }
  if (annotation.kind === "angular") {
    const points = resolveAngleSources(primitives, annotation.sourceIds)
    if (!points) return result(annotation, "insufficient-data", "需要三个空间点或两条空间棱")
    const first = { x: points[0].x - points[1].x, y: points[0].y - points[1].y, z: points[0].z - points[1].z }
    const second = { x: points[2].x - points[1].x, y: points[2].y - points[1].y, z: points[2].z - points[1].z }
    if (distanceVector3(points[0], points[1]) <= EPSILON || distanceVector3(points[2], points[1]) <= EPSILON) return result(annotation, "degenerate", "角度来源向量长度为零")
    const cosine = Math.max(-1, Math.min(1, (first.x * second.x + first.y * second.y + first.z * second.z) / (Math.hypot(first.x, first.y, first.z) * Math.hypot(second.x, second.y, second.z))))
    return result(annotation, "valid", "角度尺寸有效", Math.acos(cosine) * 180 / Math.PI, points)
  }
  return result(annotation, "insufficient-data", "圆角或倒角标注需要已有工程几何来源")
}
