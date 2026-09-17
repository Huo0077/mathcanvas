import type { DrawingSheetSpec, DrawingViewSpec, GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { conic3FromCircle3, projectConic3, projectVector3, resolveEngineeringAnnotation, type DrawingView, type ProjectedConic2, type ProjectedPoint, type Vector3 } from "@draw/geometry-kernel"

export type { DrawingView, ProjectedPoint } from "@draw/geometry-kernel"

/** Renderer-neutral labels shared by the drawing tree, the sheet viewports and the exporters. */
export const drawingViewLabels: Record<DrawingViewSpec["kind"], string> = {
  model: "模型视图",
  front: "主视图",
  top: "俯视图",
  left: "左视图",
  axonometric: "轴测图"
}

/** P7 keeps projecting the four orthographic views; the drafting view is the planar 2D surface. */
export const defaultSheetViewSize = { width: 560, height: 380 }

export function defaultDraftView(sheet: DrawingSheetSpec | null, views: DrawingViewSpec[]): DrawingViewSpec {
  const existing = views.find((view) => view.kind === "model")
  if (existing) return existing
  return {
    id: "view-model",
    kind: "model",
    x: 24,
    y: 24,
    width: defaultSheetViewSize.width,
    height: defaultSheetViewSize.height,
    scale: sheet?.scale ?? 1,
    visible: true,
    showProjectionLines: false
  }
}

/** The projected drawing for a document view spec, or null when the view cannot be projected. */
export function projectedDrawingForView(document: GeometryDocument, view: DrawingViewSpec): ProjectedDrawing | null {
  if (view.kind === "model") return null
  return resolveProjectedDrawing(document, view.kind)
}

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
  originView: DrawingView
  targetView: DrawingView
}

export interface ProjectedAnnotation {
  id: string
  sourceIds: string[]
  kind: "linear" | "angular" | "tolerance" | "fillet" | "chamfer"
  text: string
  position?: ProjectedPoint
  explanation: string
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

/** 投影椭圆的相对弦高容差与段数夹取范围（见 `projectedEllipseSegments`）。 */
const PROJECTED_CURVE_RELATIVE_TOLERANCE = 1e-3
const MIN_PROJECTED_CURVE_SEGMENTS = 12
const MAX_PROJECTED_CURVE_SEGMENTS = 1024

type ProjectedEllipse2 = Extract<ProjectedConic2, { kind: "ellipse" }>

/**
 * 投影椭圆的采样段数：解弦高不等式 `R(1 − cos(π/n)) ≤ tol`
 * （[MathWorld sagitta](https://mathworld.wolfram.com/Sagitta.html)，与 `conicSampling.segmentsForSagitta` 同一判据）。
 *
 * 容差取**相对量** `tol = 1e-3·R`：投影视图按内容自适应取景（`DrawingViewport.viewBounds`），
 * 屏幕上椭圆的半径与它的世界尺寸成正比，于是世界半径 300 px 时弦高 ≤ 0.3 px，满足 §5.6 的"屏幕误差 < 0.5 px"。
 * 曲率半径取 `a²/b`——椭圆在短轴端弯得最厉害，用 `a` 会低估弦高（与 `sampleClosedConic` 同一理由）。
 */
function projectedEllipseSegments(semiMajor: number, semiMinor: number): number {
  const curvatureRadius = semiMinor > 0 ? (semiMajor * semiMajor) / semiMinor : semiMajor
  const radius = Math.max(curvatureRadius, semiMajor)
  if (!Number.isFinite(radius) || radius <= 0) return MIN_PROJECTED_CURVE_SEGMENTS
  const tolerance = radius * PROJECTED_CURVE_RELATIVE_TOLERANCE
  const needed = Math.ceil(Math.PI / Math.acos(1 - tolerance / radius))
  if (!Number.isFinite(needed)) return MAX_PROJECTED_CURVE_SEGMENTS
  return Math.max(MIN_PROJECTED_CURVE_SEGMENTS, Math.min(MAX_PROJECTED_CURVE_SEGMENTS, needed))
}

/**
 * 从**解析椭圆**采样：`center + a·cos t·major + b·sin t·minor`，`major = (cos rotation, sin rotation)`。
 *
 * 首尾放**同一个点**（不是重算 `t = 2π`：`sin 2π = −2.45e-16`，重算会在闭合处留下一道浮点缝）；
 * 深度一律取圆心的深度——解析记录只带一个中心深度，整条曲线按它参与前后排序。
 */
function sampleProjectedEllipse(ellipse: ProjectedEllipse2): ProjectedPoint[] {
  const segments = projectedEllipseSegments(ellipse.semiMajor, ellipse.semiMinor)
  const major = { x: Math.cos(ellipse.rotation), y: Math.sin(ellipse.rotation) }
  const minor = { x: -Math.sin(ellipse.rotation), y: Math.cos(ellipse.rotation) }
  const points: ProjectedPoint[] = []
  for (let index = 0; index < segments; index += 1) {
    const parameter = (index / segments) * Math.PI * 2
    const alongMajor = ellipse.semiMajor * Math.cos(parameter)
    const alongMinor = ellipse.semiMinor * Math.sin(parameter)
    points.push({
      x: ellipse.center.x + alongMajor * major.x + alongMinor * minor.x,
      y: ellipse.center.y + alongMajor * major.y + alongMinor * minor.y,
      depth: ellipse.center.depth
    })
  }
  points.push({ ...points[0] })
  return points
}

const projectionTargets: DrawingView[] = ["front", "top", "left", "axonometric"]

function resolveProjectionLines(document: GeometryDocument, originView: DrawingView): ProjectionLine[] {
  const lines: ProjectionLine[] = []
  document.primitives.forEach((primitive) => {
    if (primitive.type !== "point3" || primitive.visible === false) return
    const from = projectVector3(primitive.position, originView)
    if (!from || !isFiniteProjectedPoint(from)) return
    projectionTargets.forEach((targetView) => {
      if (targetView === originView) return
      const to = projectVector3(primitive.position, targetView)
      if (!to || !isFiniteProjectedPoint(to)) return
      lines.push({ sourceId: primitive.id, from, to, originView, targetView })
    })
  })
  return lines
}

function annotationText(annotation: ReturnType<typeof resolveEngineeringAnnotation>): string {
  if (annotation.value === undefined) return `${annotation.id}: ${annotation.status}`
  const unit = annotation.unit ?? (annotation.kind === "angular" ? "deg" : "mm")
  const tolerance = annotation.tolerance ? ` +${annotation.tolerance.upper}/-${annotation.tolerance.lower}` : ""
  return `${annotation.id}: ${annotation.value.toFixed(3)} ${unit}${tolerance}`
}

function resolveProjectedAnnotations(document: GeometryDocument, view: DrawingView): ProjectedAnnotation[] {
  return (document.engineeringAnnotations ?? [])
    .filter((annotation) => annotation.view === view)
    .map((annotation) => {
      const resolved = resolveEngineeringAnnotation(document, annotation)
      return {
        id: resolved.id,
        sourceIds: resolved.sourceIds,
        kind: resolved.kind,
        text: annotationText(resolved),
        position: resolved.position,
        explanation: resolved.explanation,
        status: resolved.status
      }
    })
}

export function resolveProjectedDrawing(document: GeometryDocument, view: DrawingView): ProjectedDrawing {
  const primitiveMap = new Map(document.primitives.map((primitive) => [primitive.id, primitive]))
  const templateSourceIds = new Set(document.primitives.flatMap((primitive) => primitive.type === "polyhedron3" && primitive.construction?.kind === "template" ? primitive.construction.sourceIds : []))
  const diagnostics: string[] = []
  const primitives: ProjectedPrimitive[] = []

  /** 空间圆的圆心要从点表里解析（`circle3` 只存 `centerId`）。 */
  const pointPositions = new Map<string, { position: Vector3 }>()
  document.primitives.forEach((primitive) => {
    if (primitive.type === "point3") pointPositions.set(primitive.id, primitive)
  })

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
    if (primitive.type === "circle3") {
      /**
       * 空间圆投影成**真椭圆**：先经解析层把圆投影成椭圆（`projectConic3`），再从这里采样。
       * 采样结果是既有的 `polyline` 图元，所以三个消费方（`DrawingViewport` / `engineeringExporters`）
       * 完全不用改；`sourceId` 仍是这个 `circle3`，选中与高亮照旧。
       */
      const conic = conic3FromCircle3(primitive, pointPositions)
      if (!conic) {
        addDiagnostic(primitive.id, `missing point3 reference ${primitive.centerId}`)
        return
      }
      const projected = projectConic3(conic, view)
      if (!projected) {
        addDiagnostic(primitive.id, "circle cannot be projected")
        return
      }
      if (projected.kind === "segment") {
        // 边视：真椭圆退化成一条线段，如实投影（不是零面积椭圆、也不是干脆不画）。
        if (!isFiniteProjectedPoint(projected.a) || !isFiniteProjectedPoint(projected.b) || sameScreenPoint(projected.a, projected.b)) {
          addDiagnostic(primitive.id, "projected circle is degenerate")
          return
        }
        primitives.push({ kind: "polyline", sourceId: primitive.id, points: [projected.a, projected.b], closed: false })
        return
      }
      primitives.push({ kind: "polyline", sourceId: primitive.id, points: sampleProjectedEllipse(projected), closed: true })
      return
    }
    if (primitive.type === "polyhedron3") resolvePolyhedronReferences(primitive)
  })

  const unmaterializedTemplates = document.primitives.filter((primitive) => isTemplatePrimitive(primitive) && !templateSourceIds.has(primitive.id))
  unmaterializedTemplates.forEach((primitive) => addDiagnostic(primitive.id, "template topology is not materialized"))

  const annotations = resolveProjectedAnnotations(document, view)
  annotations.forEach((annotation) => {
    if (annotation.status !== "valid") addDiagnostic(annotation.id, `${annotation.status}: ${annotation.explanation}`)
  })

  return {
    view,
    primitives: sortProjectedPrimitives(primitives),
    projectionLines: resolveProjectionLines(document, view),
    annotations,
    diagnostics
  }
}
