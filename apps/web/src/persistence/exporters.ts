import type { Coordinate, GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { adaptiveSampleFunctionSegments, evaluateParameterExpression, sampleHyperbolaBranches, sampleParabola } from "@draw/geometry-kernel"

import { svgStyleFor } from "../primitiveStyle"
import { resolveAnnotationPoint } from "../annotations"
import { clipFunctionSegmentsToBounds } from "../functionGraph"
import { VIEWBOX, WORLD_BOUNDS, WORLD_SCALE, rayToViewport, worldToSvg } from "../viewport"

const toX = (x: number) => worldToSvg({ x, y: 0 }).x
const toY = (y: number) => worldToSvg({ x: 0, y }).y
const radiusToSvg = (radius: number) => radius * WORLD_SCALE

function pointsAttribute(points: Coordinate[]): string {
  return points.map((point) => `${toX(point.x)},${toY(point.y)}`).join(" ")
}

function viewportLine(line: Extract<PrimitiveSpec, { type: "line" }>): { a: Coordinate; b: Coordinate } {
  const deltaX = line.b.x - line.a.x
  if (Math.abs(deltaX) < 1e-9) return { a: { x: line.a.x, y: WORLD_BOUNDS.minY }, b: { x: line.a.x, y: WORLD_BOUNDS.maxY } }
  const slope = (line.b.y - line.a.y) / deltaX
  return { a: { x: WORLD_BOUNDS.minX, y: line.a.y + slope * (WORLD_BOUNDS.minX - line.a.x) }, b: { x: WORLD_BOUNDS.maxX, y: line.a.y + slope * (WORLD_BOUNDS.maxX - line.a.x) } }
}

function viewportRay(ray: Extract<PrimitiveSpec, { type: "ray" }>): { a: Coordinate; b: Coordinate } {
  // 复用画布那份裁剪：旧实现是这里的一份**副本**，而且把 x 方向写反了（`unit.x > 0` 用了 minX），
  // 于是"从左侧向右射出的射线"在导出文件里停在左边缘，和用户在画布上看到的不是一条线。
  return rayToViewport(ray, WORLD_BOUNDS)
}

function sampledSegments(primitive: Extract<PrimitiveSpec, { type: "parabola" | "hyperbola" | "function" | "derivative" | "tangent" | "normal" | "secant" | "integral" | "analysisSet" }>): Coordinate[][] {
  try {
    if (primitive.type === "parabola") return [sampleParabola(primitive, [WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX], 128)]
    if (primitive.type === "hyperbola") {
      return sampleHyperbolaBranches(primitive, [WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX], 128)
    }
    if (primitive.type === "derivative") return [primitive.points]
    if (primitive.type === "tangent" || primitive.type === "normal" || primitive.type === "secant") return [[primitive.a, primitive.b]]
    if (primitive.type === "integral") return [primitive.points]
    if (primitive.type === "analysisSet") return []
    return clipFunctionSegmentsToBounds(adaptiveSampleFunctionSegments((x) => evaluateParameterExpression(primitive.expression, { x }), primitive.domain, { initialSteps: primitive.samples ?? 128, maxSteps: Math.max(primitive.samples ?? 128, 2048) }), WORLD_BOUNDS)
  } catch {
    return []
  }
}

function primitiveSvg(primitive: PrimitiveSpec): string {
  if (primitive.visible === false) return ""
  if (primitive.type === "line") {
    const visible = viewportLine(primitive)
    return `<line x1="${toX(visible.a.x)}" y1="${toY(visible.a.y)}" x2="${toX(visible.b.x)}" y2="${toY(visible.b.y)}" ${svgStyleFor(primitive)} />`
  }
  if (primitive.type === "segment") return `<line x1="${toX(primitive.a.x)}" y1="${toY(primitive.a.y)}" x2="${toX(primitive.b.x)}" y2="${toY(primitive.b.y)}" ${svgStyleFor(primitive)} />`
  if (primitive.type === "ray") {
    const visible = viewportRay(primitive)
    return `<line x1="${toX(visible.a.x)}" y1="${toY(visible.a.y)}" x2="${toX(visible.b.x)}" y2="${toY(visible.b.y)}" ${svgStyleFor(primitive)} />`
  }
  if (primitive.type === "polyline") return `<polyline points="${pointsAttribute(primitive.points)}" ${svgStyleFor(primitive)} />`
  if (primitive.type === "connection") return ""
  if (primitive.type === "locus") return ""
  if (primitive.type === "intersectionSet") return ""
  if (primitive.type === "cube" || primitive.type === "pyramid" || primitive.type === "cylinder" || primitive.type === "cone" || primitive.type === "point3" || primitive.type === "line3" || primitive.type === "segment3" || primitive.type === "ray3" || primitive.type === "plane3" || primitive.type === "circle3" || primitive.type === "edge3" || primitive.type === "face3" || primitive.type === "polyhedron3" || primitive.type === "section" || primitive.type === "intersectionLine" || primitive.type === "intersectionSolid" || primitive.type === "intersectionFace" || primitive.type === "intersectionPoint3") return ""
  if (primitive.type === "circle") return `<circle cx="${toX(primitive.center.x)}" cy="${toY(primitive.center.y)}" r="${radiusToSvg(primitive.radius)}" ${svgStyleFor(primitive)} />`
  if (primitive.type === "arc") return `<path d="M ${toX(primitive.center.x + primitive.radius * Math.cos(primitive.startAngle))} ${toY(primitive.center.y + primitive.radius * Math.sin(primitive.startAngle))} A ${radiusToSvg(primitive.radius)} ${radiusToSvg(primitive.radius)} 0 ${Math.abs(primitive.endAngle - primitive.startAngle) > Math.PI ? 1 : 0} ${primitive.endAngle >= primitive.startAngle ? 0 : 1} ${toX(primitive.center.x + primitive.radius * Math.cos(primitive.endAngle))} ${toY(primitive.center.y + primitive.radius * Math.sin(primitive.endAngle))}" ${svgStyleFor(primitive)} />`
  // SVG 有 `<ellipse>`，能**精确**表示（可旋转的）椭圆，所以这里不做任何采样：旧实现把椭圆写成 160 段
  // 折线，那是"逼近的圆"，放大就出棱——用户的原话是"我不要一个逼近的圆，我需要一个真的圆"。
  // `rotation` 在文档里是弧度，而 `rotate()` 吃角度；屏幕坐标顺时针为正，恰好等于世界坐标的逆时针为正，
  // 因此直接换算、不取负。旋转中心就是椭圆自己的圆心，所以没有旋转（0）时不写 `transform`。
  if (primitive.type === "ellipse") {
    const rotationDegrees = (primitive.rotation ?? 0) * 180 / Math.PI
    const transform = rotationDegrees === 0 ? "" : ` transform="rotate(${rotationDegrees} ${toX(primitive.center.x)} ${toY(primitive.center.y)})"`
    return `<ellipse cx="${toX(primitive.center.x)}" cy="${toY(primitive.center.y)}" rx="${radiusToSvg(primitive.radiusX)}" ry="${radiusToSvg(primitive.radiusY)}"${transform} ${svgStyleFor(primitive)} />`
  }
  if (primitive.type === "point") return `<circle cx="${toX(primitive.x)}" cy="${toY(primitive.y)}" r="6" ${svgStyleFor(primitive)} />`
  if (primitive.type === "intersection" || primitive.type === "lineCircleIntersection" || primitive.type === "circleIntersection" || primitive.type === "curveIntersection") return `<circle cx="${toX(primitive.x)}" cy="${toY(primitive.y)}" r="4" ${svgStyleFor(primitive)} />`
  // 抛物线与双曲线**没有**精确的 SVG 元素：`<path>` 的 `A` 命令画的是圆弧，不是圆锥曲线，
  // 硬套上去只会得到一条错误但看起来"精确"的曲线。它们如实继续用采样折线导出——
  // 宁可承认是逼近，也不要假装精确（椭圆不同，见上面的 `<ellipse>`）。
  const segments = sampledSegments(primitive)
  return segments.map((points) => `<polyline points="${pointsAttribute(points)}" ${svgStyleFor(primitive)} />`).join("")
}

function annotationSvg(annotation: GeometryDocument["annotations"][number], primitives: PrimitiveSpec[]): string {
  if (annotation.visible === false) return ""
  const point = resolveAnnotationPoint(annotation, primitives)
  if (!point) return ""
  const offset = annotation.offset ?? { x: 0.25, y: 0.25 }
  const labelPoint = { x: point.x + offset.x, y: point.y + offset.y }
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  return `<g data-annotation-id="${escape(annotation.id)}"><line x1="${toX(point.x)}" y1="${toY(point.y)}" x2="${toX(labelPoint.x)}" y2="${toY(labelPoint.y)}" stroke="#3d5afe" stroke-width="1.25" stroke-dasharray="3 3" /><circle cx="${toX(point.x)}" cy="${toY(point.y)}" r="3" fill="#ffffff" stroke="#3d5afe" stroke-width="1.5" /><text x="${toX(labelPoint.x) + 5}" y="${toY(labelPoint.y) - 5}" fill="#172033" font-size="13" font-weight="700">${escape(annotation.text)}</text></g>`
}

export function exportSvg(document: GeometryDocument): string {
  const grid = Array.from({ length: 21 }, (_, index) => { const x = toX(WORLD_BOUNDS.minX + index); return `<line x1="${x}" y1="${VIEWBOX.top}" x2="${x}" y2="${VIEWBOX.bottom}" />` }).join("")
  const horizontalGrid = Array.from({ length: 13 }, (_, index) => { const y = toY(WORLD_BOUNDS.minY + index); return `<line x1="${VIEWBOX.left}" y1="${y}" x2="${VIEWBOX.right}" y2="${y}" />` }).join("")
  const primitives = document.primitives.map(primitiveSvg).join("")
  const annotations = document.annotations.map((annotation) => annotationSvg(annotation, document.primitives)).join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX.width} ${VIEWBOX.height}" role="img" aria-label="MathCanvas 导出"><rect width="${VIEWBOX.width}" height="${VIEWBOX.height}" fill="#fbfcff" /><g stroke="#e6eaf2" stroke-width="1">${grid}${horizontalGrid}</g><line x1="${VIEWBOX.left}" y1="${toY(0)}" x2="${VIEWBOX.right}" y2="${toY(0)}" stroke="#9aa6bd" stroke-width="1.5" /><line x1="${toX(0)}" y1="${VIEWBOX.top}" x2="${toX(0)}" y2="${VIEWBOX.bottom}" stroke="#9aa6bd" stroke-width="1.5" />${primitives}${annotations}</svg>`
}

function csvCell(value: string | number | boolean): string {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function primitiveData(primitive: PrimitiveSpec): string {
  if (primitive.type === "point" || primitive.type === "intersection" || primitive.type === "lineCircleIntersection" || primitive.type === "circleIntersection" || primitive.type === "curveIntersection") return JSON.stringify({ x: primitive.x, y: primitive.y })
  if (primitive.type === "line" || primitive.type === "segment" || primitive.type === "ray") return JSON.stringify({ a: primitive.a, b: primitive.b })
  if (primitive.type === "polyline") return JSON.stringify({ points: primitive.points })
  if (primitive.type === "connection") return JSON.stringify({ kind: primitive.kind, startPointId: primitive.startPointId, endPointId: primitive.endPointId, control: primitive.control })
  if (primitive.type === "locus") return JSON.stringify({ sourcePointId: primitive.sourcePointId, parameterId: primitive.parameterId, domain: primitive.domain, samples: primitive.samples })
  if (primitive.type === "intersectionSet") return JSON.stringify({ objectA: primitive.objectA, objectB: primitive.objectB, points: primitive.points })
  if (primitive.type === "circle" || primitive.type === "arc") return JSON.stringify({ center: primitive.center, radius: primitive.radius })
  if (primitive.type === "parabola") return JSON.stringify({ vertex: primitive.vertex, focalParameter: primitive.focalParameter, axis: primitive.axis, rotation: primitive.rotation ?? 0 })
  if (primitive.type === "ellipse" || primitive.type === "hyperbola") return JSON.stringify({ center: primitive.center, radiusX: primitive.radiusX, radiusY: primitive.radiusY, axis: "axis" in primitive ? primitive.axis : undefined, rotation: primitive.rotation ?? 0 })
  if (primitive.type === "derivative") return JSON.stringify({ sourceId: primitive.sourceId, order: primitive.order, domain: primitive.domain, samples: primitive.samples, points: primitive.points, status: primitive.status })
  if (primitive.type === "tangent" || primitive.type === "normal") return JSON.stringify({ sourceId: primitive.sourceId, x: primitive.x, point: primitive.point, slope: primitive.slope, vertical: primitive.vertical ?? false, status: primitive.status })
  if (primitive.type === "secant") return JSON.stringify({ sourceId: primitive.sourceId, x1: primitive.x1, x2: primitive.x2, points: primitive.points, slope: primitive.slope, vertical: primitive.vertical ?? false, status: primitive.status })
  if (primitive.type === "integral") return JSON.stringify({ sourceId: primitive.sourceId, domain: primitive.domain, steps: primitive.steps, area: primitive.area, status: primitive.status, points: primitive.points })
  if (primitive.type === "analysisSet") return JSON.stringify({ sourceId: primitive.sourceId, domain: primitive.domain, samples: primitive.samples, results: primitive.results, status: primitive.status })
  if (primitive.type === "cube") return JSON.stringify({ origin: primitive.origin, size: primitive.size })
  if (primitive.type === "pyramid") return JSON.stringify({ baseCenter: primitive.baseCenter, baseSize: primitive.baseSize, height: primitive.height })
  if (primitive.type === "cylinder" || primitive.type === "cone") return JSON.stringify({ center: primitive.center, radius: primitive.radius, height: primitive.height, segments: primitive.segments })
  if (primitive.type === "point3") return JSON.stringify({ position: primitive.position, binding: primitive.binding })
  if (primitive.type === "line3") return JSON.stringify(primitive.definition)
  if (primitive.type === "segment3") return JSON.stringify({ pointIds: primitive.pointIds })
  if (primitive.type === "ray3") return JSON.stringify({ originId: primitive.originId, throughId: primitive.throughId })
  if (primitive.type === "plane3") return JSON.stringify(primitive.definition)
  if (primitive.type === "circle3") return JSON.stringify({ center: primitive.center, normal: primitive.normal, radius: primitive.radius })
  if (primitive.type === "edge3") return JSON.stringify({ pointIds: primitive.pointIds, faceIds: primitive.faceIds ?? [] })
  if (primitive.type === "face3") return JSON.stringify({ pointIds: primitive.pointIds, edgeIds: primitive.edgeIds ?? [], planeId: primitive.planeId })
  if (primitive.type === "polyhedron3") return JSON.stringify({ vertexIds: primitive.vertexIds, edgeIds: primitive.edgeIds, faceIds: primitive.faceIds, construction: primitive.construction })
  if (primitive.type === "section") return JSON.stringify({ sourceId: primitive.sourceId, plane: primitive.plane, points: primitive.points, classification: primitive.classification, status: primitive.status })
  if (primitive.type === "intersectionLine") return JSON.stringify({ sourceIds: primitive.sourceIds, segments: primitive.segments, classification: primitive.classification, status: primitive.status })
  if (primitive.type === "intersectionSolid") return JSON.stringify({ sourceIds: primitive.sourceIds, vertices: primitive.vertices, faces: primitive.faces, volume: primitive.volume, area: primitive.area, status: primitive.status })
  if (primitive.type === "intersectionFace") return JSON.stringify({ sourceIds: primitive.sourceIds, points: primitive.points, normal: primitive.normal, area: primitive.area, areaExact: primitive.areaExact, outerRingLength: primitive.outerRingLength, poleIndex: primitive.poleIndex, hint: primitive.hint, status: primitive.status })
  if (primitive.type === "intersectionPoint3") return JSON.stringify({ sourceIds: primitive.sourceIds, position: primitive.position, hint: primitive.hint, status: primitive.status })
  if (primitive.type === "function") return JSON.stringify({ expression: primitive.expression, domain: primitive.domain, samples: primitive.samples })
  const unsupportedPrimitive: never = primitive
  return JSON.stringify(unsupportedPrimitive)
}

/**
 * CSV 导出。
 *
 * 开头带 UTF-8 BOM：标签与诊断里大量是中文，而 Excel（Windows）在没有 BOM 时会按本地 ANSI 解码，
 * 打开就是乱码——"导出 CSV 给同事看"恰恰是最常见的用法。
 */
export function exportCsv(document: GeometryDocument): string {
  const rows = [
    ["id", "type", "label", "visible", "locked", "data"],
    ...document.primitives.map((primitive) => [primitive.id, primitive.type, primitive.label ?? "", primitive.visible !== false, primitive.locked === true, primitiveData(primitive)]),
    // Measurements are derived teaching results rather than geometry, so they get their own rows.
    ...document.measurements.map((measurement) => [
      measurement.id,
      "measurement3",
      measurement.metric === "dihedral" ? (measurement.dihedralKind === "exterior" ? "二面角外角" : "二面角内角") : measurement.metric,
      true,
      false,
      JSON.stringify({ sourceIds: measurement.sourceIds, metric: measurement.metric, dihedralKind: measurement.dihedralKind, value: measurement.value, unit: measurement.unit, precision: measurement.precision, status: measurement.status, explanation: measurement.explanation })
    ])
  ]
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`
}
