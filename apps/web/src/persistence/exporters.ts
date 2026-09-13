import type { Coordinate, GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { evaluateParameterExpression, sampleEllipse, sampleFunctionSegments, sampleHyperbola, sampleParabola } from "@draw/geometry-kernel"

import { VIEWBOX, WORLD_BOUNDS, WORLD_SCALE, worldToSvg } from "../viewport"

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
  const length = Math.hypot(ray.b.x - ray.a.x, ray.b.y - ray.a.y)
  if (!Number.isFinite(length) || length === 0) return { a: ray.a, b: ray.b }
  const unit = { x: (ray.b.x - ray.a.x) / length, y: (ray.b.y - ray.a.y) / length }
  const limits = [unit.x > 0 ? (WORLD_BOUNDS.minX - ray.a.x) / unit.x : Infinity, unit.x < 0 ? (WORLD_BOUNDS.maxX - ray.a.x) / unit.x : Infinity, unit.y > 0 ? (WORLD_BOUNDS.minY - ray.a.y) / unit.y : Infinity, unit.y < 0 ? (WORLD_BOUNDS.maxY - ray.a.y) / unit.y : Infinity].filter((value) => value >= 0 && Number.isFinite(value))
  const distance = Math.min(...limits, 20)
  return { a: ray.a, b: { x: ray.a.x + unit.x * distance, y: ray.a.y + unit.y * distance } }
}

function sampledSegments(primitive: Extract<PrimitiveSpec, { type: "parabola" | "ellipse" | "hyperbola" | "function" }>): Coordinate[][] {
  try {
    if (primitive.type === "parabola") return [sampleParabola(primitive, [WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX], 128)]
    if (primitive.type === "ellipse") return [sampleEllipse(primitive, 160)]
    if (primitive.type === "hyperbola") {
      const branch = sampleHyperbola(primitive, [WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX], 128)
      const opposite = branch.map((point) => primitive.axis === "x" ? { x: point.x, y: 2 * primitive.center.y - point.y } : { x: 2 * primitive.center.x - point.x, y: point.y })
      return [branch, opposite]
    }
    return sampleFunctionSegments((x) => evaluateParameterExpression(primitive.expression, { x }), primitive.domain, primitive.samples ?? 128)
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
  if (primitive.type === "circle") return `<circle cx="${toX(primitive.center.x)}" cy="${toY(primitive.center.y)}" r="${radiusToSvg(primitive.radius)}" fill="none" stroke="#0f8a63" stroke-width="3" />`
  if (primitive.type === "arc") return `<path d="M ${toX(primitive.center.x + primitive.radius * Math.cos(primitive.startAngle))} ${toY(primitive.center.y + primitive.radius * Math.sin(primitive.startAngle))} A ${radiusToSvg(primitive.radius)} ${radiusToSvg(primitive.radius)} 0 ${Math.abs(primitive.endAngle - primitive.startAngle) > Math.PI ? 1 : 0} ${primitive.endAngle >= primitive.startAngle ? 0 : 1} ${toX(primitive.center.x + primitive.radius * Math.cos(primitive.endAngle))} ${toY(primitive.center.y + primitive.radius * Math.sin(primitive.endAngle))}" fill="none" stroke="#f08a24" stroke-width="3" />`
  if (primitive.type === "point") return `<circle cx="${toX(primitive.x)}" cy="${toY(primitive.y)}" r="6" fill="#3d5afe" />`
  if (primitive.type === "intersection" || primitive.type === "lineCircleIntersection" || primitive.type === "circleIntersection" || primitive.type === "curveIntersection") return `<circle cx="${toX(primitive.x)}" cy="${toY(primitive.y)}" r="7" fill="#f04f5f" />`
  const segments = sampledSegments(primitive)
  const stroke = primitive.type === "function" ? "#16a34a" : primitive.type === "hyperbola" ? "#9333ea" : "#db2777"
  return segments.map((points) => `<polyline points="${pointsAttribute(points)}" fill="none" stroke="${stroke}" stroke-width="3" />`).join("")
}

export function exportSvg(document: GeometryDocument): string {
  const grid = Array.from({ length: 21 }, (_, index) => { const x = toX(WORLD_BOUNDS.minX + index); return `<line x1="${x}" y1="${VIEWBOX.top}" x2="${x}" y2="${VIEWBOX.bottom}" />` }).join("")
  const horizontalGrid = Array.from({ length: 13 }, (_, index) => { const y = toY(WORLD_BOUNDS.minY + index); return `<line x1="${VIEWBOX.left}" y1="${y}" x2="${VIEWBOX.right}" y2="${y}" />` }).join("")
  const primitives = document.primitives.map(primitiveSvg).join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX.width} ${VIEWBOX.height}" role="img" aria-label="MathCanvas 导出"><rect width="${VIEWBOX.width}" height="${VIEWBOX.height}" fill="#fbfcff" /><g stroke="#e6eaf2" stroke-width="1">${grid}${horizontalGrid}</g><line x1="${VIEWBOX.left}" y1="${toY(0)}" x2="${VIEWBOX.right}" y2="${toY(0)}" stroke="#9aa6bd" stroke-width="1.5" /><line x1="${toX(0)}" y1="${VIEWBOX.top}" x2="${toX(0)}" y2="${VIEWBOX.bottom}" stroke="#9aa6bd" stroke-width="1.5" />${primitives}</svg>`
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
  if (primitive.type === "parabola") return JSON.stringify({ vertex: primitive.vertex, focalParameter: primitive.focalParameter, axis: primitive.axis, rotation: primitive.rotation ?? 0 })
  if (primitive.type === "ellipse" || primitive.type === "hyperbola") return JSON.stringify({ center: primitive.center, radiusX: primitive.radiusX, radiusY: primitive.radiusY, axis: "axis" in primitive ? primitive.axis : undefined, rotation: primitive.rotation ?? 0 })
  return JSON.stringify({ expression: primitive.expression, domain: primitive.domain, samples: primitive.samples })
}

export function exportCsv(document: GeometryDocument): string {
  const rows = [["id", "type", "label", "visible", "locked", "data"], ...document.primitives.map((primitive) => [primitive.id, primitive.type, primitive.label ?? "", primitive.visible !== false, primitive.locked === true, primitiveData(primitive)])]
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`
}
