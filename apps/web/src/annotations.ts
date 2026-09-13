import type { AnnotationFeature, AnnotationSpec, Coordinate, PrimitiveSpec } from "@draw/dsl"
import { evaluateParameterExpression } from "@draw/geometry-kernel"

function rotateFeature(center: Coordinate, x: number, y: number, rotation: number): Coordinate {
  return { x: center.x + x * Math.cos(rotation) - y * Math.sin(rotation), y: center.y + x * Math.sin(rotation) + y * Math.cos(rotation) }
}

function conicFeaturePoint(primitive: Extract<PrimitiveSpec, { type: "parabola" | "ellipse" | "hyperbola" }>, feature: AnnotationFeature, index = 0): Coordinate | null {
  if (primitive.type === "parabola") {
    if (feature === "vertex") return primitive.vertex
    if (feature === "focus") {
      const distance = primitive.focalParameter / 2
      return rotateFeature(primitive.vertex, primitive.axis === "x" ? distance : 0, primitive.axis === "y" ? distance : 0, primitive.rotation ?? 0)
    }
    return null
  }
  if (feature === "center") return primitive.center
  const alongX = primitive.type === "hyperbola" ? primitive.axis === "x" : primitive.radiusX >= primitive.radiusY
  const distance = feature === "focus"
    ? primitive.type === "ellipse" ? Math.sqrt(Math.max(primitive.radiusX ** 2, primitive.radiusY ** 2) - Math.min(primitive.radiusX ** 2, primitive.radiusY ** 2)) : Math.sqrt(primitive.radiusX ** 2 + primitive.radiusY ** 2)
    : alongX ? Math.max(primitive.radiusX, primitive.radiusY) : Math.max(primitive.radiusX, primitive.radiusY)
  const sign = index % 2 === 0 ? 1 : -1
  return rotateFeature(primitive.center, alongX ? sign * distance : 0, alongX ? 0 : sign * distance, primitive.rotation ?? 0)
}

function pointFromPrimitive(primitive: PrimitiveSpec, feature?: AnnotationFeature, index = 0, primitives: PrimitiveSpec[] = []): Coordinate | null {
  if (primitive.type === "point") return { x: primitive.x, y: primitive.y }
  if (primitive.type === "intersection" || primitive.type === "lineCircleIntersection" || primitive.type === "circleIntersection" || primitive.type === "curveIntersection") return { x: primitive.x, y: primitive.y }
  if (primitive.type === "intersectionSet") return primitive.points[index] ?? primitive.points[primitive.selectedIndex ?? 0] ?? null
  if (primitive.type === "line" || primitive.type === "segment" || primitive.type === "ray") {
    if (feature === "start") return primitive.a
    if (feature === "end") return primitive.b
    return { x: (primitive.a.x + primitive.b.x) / 2, y: (primitive.a.y + primitive.b.y) / 2 }
  }
  if (primitive.type === "polyline") {
    if (feature === "start") return primitive.points[0]
    if (feature === "end") return primitive.points.at(-1) ?? null
    return primitive.points[Math.min(index, primitive.points.length - 1)] ?? null
  }
  if (primitive.type === "circle" || primitive.type === "arc") {
    if (feature === "start" && primitive.type === "arc") return { x: primitive.center.x + primitive.radius * Math.cos(primitive.startAngle), y: primitive.center.y + primitive.radius * Math.sin(primitive.startAngle) }
    if (feature === "end" && primitive.type === "arc") return { x: primitive.center.x + primitive.radius * Math.cos(primitive.endAngle), y: primitive.center.y + primitive.radius * Math.sin(primitive.endAngle) }
    return primitive.center
  }
  if (primitive.type === "parabola" || primitive.type === "ellipse" || primitive.type === "hyperbola") return conicFeaturePoint(primitive, feature ?? (primitive.type === "parabola" ? "vertex" : "center"), index)
  if (primitive.type === "function") {
    const x = (primitive.domain[0] + primitive.domain[1]) / 2
    try { return { x, y: evaluateParameterExpression(primitive.expression, { x }) } } catch { return { x, y: 0 } }
  }
  if (primitive.type === "connection") {
    const start = primitives.find((candidate) => candidate.id === primitive.startPointId)
    const end = primitives.find((candidate) => candidate.id === primitive.endPointId)
    const startPoint = start && pointFromPrimitive(start, "point", 0, primitives)
    const endPoint = end && pointFromPrimitive(end, "point", 0, primitives)
    if (!startPoint || !endPoint) return null
    return feature === "start" ? startPoint : feature === "end" ? endPoint : { x: (startPoint.x + endPoint.x) / 2, y: (startPoint.y + endPoint.y) / 2 }
  }
  if (primitive.type === "locus") {
    const source = primitives.find((candidate) => candidate.id === primitive.sourcePointId)
    return source ? pointFromPrimitive(source, "point", 0, primitives) : null
  }
  return null
}

export function resolveAnnotationPoint(annotation: AnnotationSpec, primitives: PrimitiveSpec[]): Coordinate | null {
  const anchor = annotation.anchor
  if (anchor?.kind === "coordinate") return { x: anchor.x, y: anchor.y }
  if (!anchor && Number.isFinite(annotation.x) && Number.isFinite(annotation.y)) return { x: annotation.x!, y: annotation.y! }
  const primitiveId = anchor?.kind === "primitive" ? anchor.primitiveId : annotation.target
  if (!primitiveId) return null
  const primitive = primitives.find((candidate) => candidate.id === primitiveId)
  return primitive ? pointFromPrimitive(primitive, anchor?.kind === "primitive" ? anchor.feature : undefined, anchor?.kind === "primitive" ? anchor.index : 0, primitives) : null
}

export interface AnnotationFeatureOption {
  feature: AnnotationFeature
  index?: number
  label: string
}

export function annotationFeatureOptions(primitive: PrimitiveSpec): AnnotationFeatureOption[] {
  if (primitive.type === "point") return [{ feature: "point", label: "点" }]
  if (primitive.type === "line" || primitive.type === "segment" || primitive.type === "ray" || primitive.type === "polyline" || primitive.type === "connection") return [{ feature: "start", label: "起点" }, { feature: "end", label: "终点" }]
  if (primitive.type === "circle") return [{ feature: "center", label: "圆心" }]
  if (primitive.type === "arc") return [{ feature: "center", label: "圆心" }, { feature: "start", label: "起点" }, { feature: "end", label: "终点" }]
  if (primitive.type === "parabola") return [{ feature: "vertex", label: "顶点" }, { feature: "focus", label: "焦点" }]
  if (primitive.type === "ellipse" || primitive.type === "hyperbola") return [{ feature: "center", label: "中心" }, { feature: "focus", index: 0, label: "焦点 F₁" }, { feature: "focus", index: 1, label: "焦点 F₂" }, { feature: "vertex", index: 0, label: "顶点 V₁" }, { feature: "vertex", index: 1, label: "顶点 V₂" }]
  if (primitive.type === "intersectionSet") return primitive.points.map((_, index) => ({ feature: "intersection", index, label: `交点 ${index + 1}` }))
  if (["intersection", "lineCircleIntersection", "circleIntersection", "curveIntersection"].includes(primitive.type)) return [{ feature: "intersection", label: "交点" }]
  if (primitive.type === "function") return [{ feature: "center", label: "函数点" }]
  return [{ feature: "point", label: "标记点" }]
}
