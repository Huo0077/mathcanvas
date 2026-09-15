import type { GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { projectVector3, type DrawingView, type ProjectedPoint } from "@draw/geometry-kernel"

export type { DrawingView, ProjectedPoint } from "@draw/geometry-kernel"

export interface ProjectedDrawing {
  view: DrawingView
  primitives: ProjectedPrimitive[]
  projectionLines: ProjectionLine[]
  annotations: ProjectedAnnotation[]
  diagnostics: string[]
}

export type ProjectedPrimitive =
  | { kind: "point"; sourceId: string; point: ProjectedPoint }
  | { kind: "polyline"; sourceId: string; points: ProjectedPoint[]; closed: boolean }
  | { kind: "polygon"; sourceId: string; points: ProjectedPoint[]; depth: number }

export interface ProjectionLine {
  sourceId: string
  from: ProjectedPoint
  to: ProjectedPoint
  targetView: DrawingView
}

export interface ProjectedAnnotation {
  id: string
  sourceIds: string[]
  kind: "linear" | "angular" | "tolerance" | "fillet" | "chamfer"
  text: string
  position: ProjectedPoint
  status: "valid" | "degenerate" | "insufficient-data"
}

type SpatialPrimitive = Extract<PrimitiveSpec, { type: "point3" | "edge3" | "face3" | "polyhedron3" | "cube" | "pyramid" | "cylinder" | "cone" }>

const templateTypes = new Set(["cube", "pyramid", "cylinder", "cone"])

function isTemplatePrimitive(primitive: PrimitiveSpec): primitive is Extract<SpatialPrimitive, { type: "cube" | "pyramid" | "cylinder" | "cone" }> {
  return templateTypes.has(primitive.type)
}

function isFiniteProjectedPoint(point: ProjectedPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.depth)
}

function sameScreenPoint(first: ProjectedPoint, second: ProjectedPoint): boolean {
  return Math.hypot(first.x - second.x, first.y - second.y) <= 1e-10
}

function averageDepth(points: ProjectedPoint[]): number {
  return points.reduce((sum, point) => sum + point.depth, 0) / points.length
}

function depthKey(primitive: ProjectedPrimitive): number {
  if (primitive.kind === "point") return primitive.point.depth
  if (primitive.kind === "polygon") return primitive.depth
  return averageDepth(primitive.points)
}

function sortProjectedPrimitives(primitives: ProjectedPrimitive[]): ProjectedPrimitive[] {
  return primitives
    .map((primitive, index) => ({ primitive, index }))
    .sort((first, second) => depthKey(first.primitive) - depthKey(second.primitive) || first.primitive.sourceId.localeCompare(second.primitive.sourceId) || first.index - second.index)
    .map(({ primitive }) => primitive)
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)]
}

export function resolveProjectedDrawing(document: GeometryDocument, view: DrawingView): ProjectedDrawing {
  const primitiveMap = new Map(document.primitives.map((primitive) => [primitive.id, primitive]))
  const templateSourceIds = new Set(document.primitives.flatMap((primitive) => primitive.type === "polyhedron3" && primitive.construction?.kind === "template" ? primitive.construction.sourceIds : []))
  const diagnostics: string[] = []
  const primitives: ProjectedPrimitive[] = []

  const addDiagnostic = (sourceId: string, message: string) => {
    const diagnostic = `${sourceId}: ${message}`
    if (!diagnostics.includes(diagnostic)) diagnostics.push(diagnostic)
  }

  const projectSourcePoint = (sourceId: string, pointId: string): ProjectedPoint | null => {
    const point = primitiveMap.get(pointId)
    if (point?.type !== "point3") {
      addDiagnostic(sourceId, `missing point3 reference ${pointId}`)
      return null
    }
    const projected = projectVector3(point.position, view)
    if (!projected || !isFiniteProjectedPoint(projected)) {
      addDiagnostic(sourceId, `point ${pointId} cannot be projected`)
      return null
    }
    return projected
  }

  const projectPointRing = (sourceId: string, pointIds: string[], minimum: number): ProjectedPoint[] | null => {
    const normalizedIds = pointIds.length > 1 && pointIds[0] === pointIds.at(-1) ? pointIds.slice(0, -1) : pointIds
    if (normalizedIds.length < minimum || uniqueIds(normalizedIds).length !== normalizedIds.length) {
      addDiagnostic(sourceId, `requires at least ${minimum} distinct points`)
      return null
    }
    const projected = normalizedIds.map((pointId) => projectSourcePoint(sourceId, pointId))
    if (projected.some((point): point is null => point === null)) return null
    const points = projected as ProjectedPoint[]
    for (let index = 1; index < points.length; index += 1) {
      if (sameScreenPoint(points[index - 1], points[index])) {
        addDiagnostic(sourceId, "projected geometry is degenerate")
        return null
      }
    }
    return points
  }

  const resolvePolyhedronReferences = (polyhedron: Extract<PrimitiveSpec, { type: "polyhedron3" }>) => {
    polyhedron.vertexIds.forEach((id) => {
      if (primitiveMap.get(id)?.type !== "point3") addDiagnostic(polyhedron.id, `missing point3 vertex ${id}`)
    })
    polyhedron.edgeIds.forEach((id) => {
      if (primitiveMap.get(id)?.type !== "edge3") addDiagnostic(polyhedron.id, `missing edge3 reference ${id}`)
    })
    polyhedron.faceIds.forEach((id) => {
      if (primitiveMap.get(id)?.type !== "face3") addDiagnostic(polyhedron.id, `missing face3 reference ${id}`)
    })
  }

  document.primitives.forEach((primitive) => {
    if (primitive.visible === false) return
    if (isTemplatePrimitive(primitive) && templateSourceIds.has(primitive.id)) return
    if (primitive.type === "point3") {
      const projected = projectVector3(primitive.position, view)
      if (!projected || !isFiniteProjectedPoint(projected)) {
        addDiagnostic(primitive.id, "point cannot be projected")
        return
      }
      primitives.push({ kind: "point", sourceId: primitive.id, point: projected })
      return
    }
    if (primitive.type === "edge3") {
      const points = projectPointRing(primitive.id, primitive.pointIds, 2)
      if (!points || points.length !== 2 || sameScreenPoint(points[0], points[1])) {
        if (points) addDiagnostic(primitive.id, "projected edge is degenerate")
        return
      }
      primitives.push({ kind: "polyline", sourceId: primitive.id, points, closed: false })
      return
    }
    if (primitive.type === "face3") {
      const points = projectPointRing(primitive.id, primitive.pointIds, 3)
      if (!points || new Set(points.map((point) => `${point.x}:${point.y}`)).size < 3) {
        if (points) addDiagnostic(primitive.id, "projected face is degenerate")
        return
      }
      primitives.push({ kind: "polygon", sourceId: primitive.id, points: [...points, points[0]], depth: averageDepth(points) })
      return
    }
    if (primitive.type === "polyhedron3") resolvePolyhedronReferences(primitive)
  })

  const unmaterializedTemplates = document.primitives.filter((primitive) => isTemplatePrimitive(primitive) && !templateSourceIds.has(primitive.id))
  unmaterializedTemplates.forEach((primitive) => addDiagnostic(primitive.id, "template topology is not materialized"))

  return {
    view,
    primitives: sortProjectedPrimitives(primitives),
    projectionLines: [],
    annotations: [],
    diagnostics
  }
}
