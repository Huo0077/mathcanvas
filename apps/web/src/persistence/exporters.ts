import type { Coordinate, GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { evaluateParameterExpression, sampleEllipse, sampleFunction, sampleHyperbola, sampleParabola } from "@draw/geometry-kernel"

const toX = (x: number) => 40 + ((x + 10) / 20) * 720
const toY = (y: number) => 320 - ((y + 6) / 12) * 300

function pointsAttribute(points: Coordinate[]): string {
  return points.map((point) => `${toX(point.x)},${toY(point.y)}`).join(" ")
}

function viewportLine(line: Extract<PrimitiveSpec, { type: "line" }>): { a: Coordinate; b: Coordinate } {
  const deltaX = line.b.x - line.a.x
  if (Math.abs(deltaX) < 1e-9) return { a: { x: line.a.x, y: -6 }, b: { x: line.a.x, y: 6 } }
  const slope = (line.b.y - line.a.y) / deltaX
  return { a: { x: -10, y: line.a.y + slope * (-10 - line.a.x) }, b: { x: 10, y: line.a.y + slope * (10 - line.a.x) } }
}

function viewportRay(ray: Extract<PrimitiveSpec, { type: "ray" }>): { a: Coordinate; b: Coordinate } {
  const length = Math.hypot(ray.b.x - ray.a.x, ray.b.y - ray.a.y)
  if (!Number.isFinite(length) || length === 0) return { a: ray.a, b: ray.b }
  const unit = { x: (ray.b.x - ray.a.x) / length, y: (ray.b.y - ray.a.y) / length }
  const limits = [unit.x > 0 ? (-10 - ray.a.x) / unit.x : Infinity, unit.x < 0 ? (10 - ray.a.x) / unit.x : Infinity, unit.y > 0 ? (-6 - ray.a.y) / unit.y : Infinity, unit.y < 0 ? (6 - ray.a.y) / unit.y : Infinity].filter((value) => value >= 0 && Number.isFinite(value))
  const distance = Math.min(...limits, 20)
  return { a: ray.a, b: { x: ray.a.x + unit.x * distance, y: ray.a.y + unit.y * distance } }
}

function sampledPoints(primitive: Extract<PrimitiveSpec, { type: "parabola" | "ellipse" | "hyperbola" | "function" }>): Coordinate[] {
  try {
    if (primitive.type === "parabola") return sampleParabola(primitive, [-10, 10], 128)
    if (primitive.type === "ellipse") return sampleEllipse(primitive, 160)
    if (primitive.type === "hyperbola") return sampleHyperbola(primitive, [-10, 10], 128)
    return sampleFunction((x) => evaluateParameterExpression(primitive.expression, { x }), primitive.domain, primitive.samples ?? 128)
  } catch {
    return []
  }
}

function primitiveSvg(primitive: PrimitiveSpec): string {
  if (primitive.visible === false) return ""
  const selectedStroke = primitive.type === "point" || primitive.type === "intersection" || primitive.type === "lineCircleIntersection" || primitive.type === "circleIntersection" || primitive.type === "curveIntersection" ? "#f04f5f" : "#172033"
  if (primitive.type === "line") {
    const visible = viewportLine(primitive)
    return `<line x1="${toX(visible.a.x)}" y1="${toY(visible.a.y)}" x2="${toX(visible.b.x)}" y2="${toY(visible.b.y)}" stroke="${selectedStroke}" stroke-width="3" />`
  }
  if (primitive.type === "segment") return `<line x1="${toX(primitive.a.x)}" y1="${toY(primitive.a.y)}" x2="${toX(primitive.b.x)}" y2="${toY(primitive.b.y)}" stroke="#0b7285" stroke-width="3" />`
  if (primitive.type === "ray") {
    const visible = viewportRay(primitive)
    return `<line x1="${toX(visible.a.x)}" y1="${toY(visible.a.y)}" x2="${toX(visible.b.x)}" y2="${toY(visible.b.y)}" stroke="#7c3aed" stroke-width="3" />`
  }
  if (primitive.type === "polyline") return `<polyline points="${pointsAttribute(primitive.points)}" fill="none" stroke="#b45309" stroke-width="3" />`
  if (primitive.type === "circle") return `<ellipse cx="${toX(primitive.center.x)}" cy="${toY(primitive.center.y)}" rx="${primitive.radius * 36}" ry="${primitive.radius * 30}" fill="none" stroke="#0f8a63" stroke-width="3" />`
  if (primitive.type === "arc") return `<path d="M ${toX(primitive.center.x + primitive.radius * Math.cos(primitive.startAngle))} ${toY(primitive.center.y + primitive.radius * Math.sin(primitive.startAngle))} A ${primitive.radius * 36} ${primitive.radius * 30} 0 ${Math.abs(primitive.endAngle - primitive.startAngle) > Math.PI ? 1 : 0} ${primitive.endAngle >= primitive.startAngle ? 0 : 1} ${toX(primitive.center.x + primitive.radius * Math.cos(primitive.endAngle))} ${toY(primitive.center.y + primitive.radius * Math.sin(primitive.endAngle))}" fill="none" stroke="#f08a24" stroke-width="3" />`
  if (primitive.type === "point") return `<circle cx="${toX(primitive.x)}" cy="${toY(primitive.y)}" r="6" fill="#3d5afe" />`
  if (primitive.type === "intersection" || primitive.type === "lineCircleIntersection" || primitive.type === "circleIntersection" || primitive.type === "curveIntersection") return `<circle cx="${toX(primitive.x)}" cy="${toY(primitive.y)}" r="7" fill="#f04f5f" />`
  if (primitive.type === "hyperbola") {
    const branch = sampledPoints(primitive)
    const opposite = branch.map((point) => primitive.axis === "x" ? { x: point.x, y: 2 * primitive.center.y - point.y } : { x: 2 * primitive.center.x - point.x, y: point.y })
    return `<polyline points="${pointsAttribute(branch)}" fill="none" stroke="#9333ea" stroke-width="3" /><polyline points="${pointsAttribute(opposite)}" fill="none" stroke="#9333ea" stroke-width="3" />`
  }
  const points = sampledPoints(primitive)
  return `<polyline points="${pointsAttribute(points)}" fill="none" stroke="${primitive.type === "function" ? "#16a34a" : "#db2777"}" stroke-width="3" />`
}

export function exportSvg(document: GeometryDocument): string {
  const grid = Array.from({ length: 21 }, (_, index) => `<line x1="${40 + index * 36}" y1="20" x2="${40 + index * 36}" y2="340" />`).join("")
  const horizontalGrid = Array.from({ length: 11 }, (_, index) => `<line x1="40" y1="${20 + index * 32}" x2="760" y2="${20 + index * 32}" />`).join("")
  const primitives = document.primitives.map(primitiveSvg).join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 380" role="img" aria-label="MathCanvas 导出"><rect width="800" height="380" fill="#fbfcff" /><g stroke="#e6eaf2" stroke-width="1">${grid}${horizontalGrid}</g><line x1="40" y1="${toY(0)}" x2="760" y2="${toY(0)}" stroke="#9aa6bd" stroke-width="1.5" /><line x1="${toX(0)}" y1="20" x2="${toX(0)}" y2="340" stroke="#9aa6bd" stroke-width="1.5" />${primitives}</svg>`
}

function csvCell(value: string | number | boolean): string {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function primitiveData(primitive: PrimitiveSpec): string {
  if (primitive.type === "point" || primitive.type === "intersection" || primitive.type === "lineCircleIntersection" || primitive.type === "circleIntersection" || primitive.type === "curveIntersection") return JSON.stringify({ x: primitive.x, y: primitive.y })
  if (primitive.type === "line" || primitive.type === "segment" || primitive.type === "ray") return JSON.stringify({ a: primitive.a, b: primitive.b })
  if (primitive.type === "polyline") return JSON.stringify({ points: primitive.points })
  if (primitive.type === "circle" || primitive.type === "arc") return JSON.stringify({ center: primitive.center, radius: primitive.radius })
  if (primitive.type === "parabola") return JSON.stringify({ vertex: primitive.vertex, focalParameter: primitive.focalParameter, axis: primitive.axis })
  if (primitive.type === "ellipse" || primitive.type === "hyperbola") return JSON.stringify({ center: primitive.center, radiusX: primitive.radiusX, radiusY: primitive.radiusY, axis: "axis" in primitive ? primitive.axis : undefined })
  return JSON.stringify({ expression: primitive.expression, domain: primitive.domain, samples: primitive.samples })
}

export function exportCsv(document: GeometryDocument): string {
  const rows = [["id", "type", "label", "visible", "locked", "data"], ...document.primitives.map((primitive) => [primitive.id, primitive.type, primitive.label ?? "", primitive.visible !== false, primitive.locked === true, primitiveData(primitive)])]
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`
}
