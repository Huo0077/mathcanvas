import { PDFDocument, StandardFonts, rgb } from "pdf-lib"

import type { DrawingViewSpec } from "@draw/dsl"

import type { ProjectedAnnotation, ProjectedDrawing, ProjectedPrimitive } from "../projectionVisuals"

const svgWidth = 1000
const svgHeight = 700
const viewCellWidth = 500
const viewCellHeight = 350

/**
 * Exporters only emit views the sheet keeps visible, so a hidden view never produces fabricated geometry.
 * Views without a persisted spec keep their projected content.
 */
export function selectExportableDrawings(drawings: ProjectedDrawing[], views: DrawingViewSpec[] = []): ProjectedDrawing[] {
  if (views.length === 0) return drawings
  return drawings.filter((drawing) => views.find((view) => view.kind === drawing.view)?.visible !== false)
}

interface DrawingBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

function finitePoint(point: { x: number; y: number; depth: number }): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.depth)
}

function primitivePoints(primitive: ProjectedPrimitive) {
  return primitive.kind === "point" ? [primitive.point] : primitive.points
}

function drawingPoints(drawing: ProjectedDrawing) {
  return [
    ...drawing.primitives.flatMap(primitivePoints),
    ...drawing.projectionLines.flatMap((line) => [line.from, line.to]),
    ...drawing.annotations.flatMap((annotation) => annotation.position ? [annotation.position] : [])
  ].filter(finitePoint)
}

function drawingBounds(drawing: ProjectedDrawing): DrawingBounds {
  const points = drawingPoints(drawing)
  if (points.length === 0) return { minX: -4, maxX: 4, minY: -4, maxY: 4 }
  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y))
  }
}

function worldTransform(drawing: ProjectedDrawing, cellX: number, cellY: number): string {
  const bounds = drawingBounds(drawing)
  const spanX = Math.max(bounds.maxX - bounds.minX, 1)
  const spanY = Math.max(bounds.maxY - bounds.minY, 1)
  const scale = Math.min((viewCellWidth - 48) / spanX, (viewCellHeight - 48) / spanY)
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2
  return `translate(${cellX + viewCellWidth / 2} ${cellY + viewCellHeight / 2}) scale(${scale} ${-scale}) translate(${-centerX} ${-centerY})`
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function svgPoint(point: { x: number; y: number; depth: number }): string {
  return `${point.x},${point.y}`
}

function svgPrimitive(primitive: ProjectedPrimitive): string {
  const points = primitivePoints(primitive).filter(finitePoint)
  if (points.length === 0) return ""
  const sourceId = escapeXml(primitive.sourceId)
  if (primitive.kind === "point") return `<circle data-source-id="${sourceId}" cx="${primitive.point.x}" cy="${primitive.point.y}" r="0.08" />`
  if (primitive.kind === "polygon") return `<polygon data-source-id="${sourceId}" points="${points.map(svgPoint).join(" ")}" />`
  return `<polyline data-source-id="${sourceId}" points="${points.map(svgPoint).join(" ")}" />`
}

function svgProjectionLine(line: ProjectedDrawing["projectionLines"][number]): string {
  if (!finitePoint(line.from) || !finitePoint(line.to)) return ""
  return `<line data-source-id="${escapeXml(line.sourceId)}" data-target-view="${line.targetView}" x1="${line.from.x}" y1="${line.from.y}" x2="${line.to.x}" y2="${line.to.y}" />`
}

function svgAnnotation(annotation: ProjectedAnnotation): string {
  if (!annotation.position || !finitePoint(annotation.position)) return `<text data-annotation-id="${escapeXml(annotation.id)}" data-status="${annotation.status}" x="0" y="0.3">${escapeXml(`${annotation.id}: ${annotation.status}`)}</text>`
  return `<text data-annotation-id="${escapeXml(annotation.id)}" data-status="${annotation.status}" x="${annotation.position.x}" y="${annotation.position.y}">${escapeXml(annotation.text)}</text>`
}

function svgDrawing(drawing: ProjectedDrawing, index: number): string {
  const cellX = index % 2 * viewCellWidth
  const cellY = Math.floor(index / 2) * viewCellHeight
  const diagnostics = drawing.diagnostics.map((diagnostic) => `<text class="diagnostic" x="-3.8" y="${-3.5 - drawing.diagnostics.indexOf(diagnostic) * 0.2}">${escapeXml(diagnostic)}</text>`).join("")
  return `<g data-drawing-view="${drawing.view}" transform="${worldTransform(drawing, cellX, cellY)}"><rect x="-3.9" y="-3.9" width="7.8" height="7.8" fill="#fbfcff" stroke="#c8d0df" stroke-width="0.02" /><g class="projection-lines">${drawing.projectionLines.map(svgProjectionLine).join("")}</g><g class="primitives">${drawing.primitives.map(svgPrimitive).join("")}</g><g class="annotations">${drawing.annotations.map(svgAnnotation).join("")}</g><g class="diagnostics">${diagnostics}</g></g>`
}

export function exportEngineeringSvg(drawings: ProjectedDrawing[]): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" role="img" aria-label="Engineering drawing export"><rect width="${svgWidth}" height="${svgHeight}" fill="#eef2f8" />${drawings.slice(0, 4).map(svgDrawing).join("")}</svg>`
}

function dxfNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6) : "0"
}

function dxfLayer(view: string, sourceId: string): string {
  return `${view}_${sourceId}`.replaceAll(/[^A-Za-z0-9_-]/g, "_").slice(0, 255)
}

function dxfEntity(values: (string | number)[]): string {
  return `${values.map((value) => typeof value === "number" ? dxfNumber(value) : value).join("\n")}\n`
}

function dxfPrimitive(drawing: ProjectedDrawing, primitive: ProjectedPrimitive): string {
  const points = primitivePoints(primitive).filter(finitePoint)
  if (points.length === 0) return ""
  const layer = dxfLayer(drawing.view, primitive.sourceId)
  if (primitive.kind === "point") return dxfEntity(["0", "POINT", "8", layer, "10", primitive.point.x, "20", primitive.point.y, "30", primitive.point.depth])
  if (primitive.kind === "polygon" || primitive.kind === "polyline") {
    return dxfEntity(["0", "LWPOLYLINE", "8", layer, "90", points.length, "70", primitive.kind === "polygon" ? 1 : 0, ...points.flatMap((point) => ["10", point.x, "20", point.y])])
  }
  return ""
}

function dxfLine(drawing: ProjectedDrawing, line: ProjectedDrawing["projectionLines"][number]): string {
  if (!finitePoint(line.from) || !finitePoint(line.to)) return ""
  return dxfEntity(["0", "LINE", "8", dxfLayer(drawing.view, line.sourceId), "10", line.from.x, "20", line.from.y, "30", line.from.depth, "11", line.to.x, "21", line.to.y, "31", line.to.depth])
}

function dxfText(drawing: ProjectedDrawing, annotation: ProjectedAnnotation): string {
  const position = annotation.position ?? { x: 0, y: 0, depth: 0 }
  return dxfEntity(["0", "TEXT", "8", dxfLayer(drawing.view, annotation.id), "10", position.x, "20", position.y, "30", position.depth, "40", 0.2, "1", `${annotation.text}`])
}

export function exportEngineeringDxf(drawings: ProjectedDrawing[]): string {
  const entities = drawings.slice(0, 4).map((drawing) => [
    ...drawing.primitives.map((primitive) => dxfPrimitive(drawing, primitive)),
    ...drawing.projectionLines.map((line) => dxfLine(drawing, line)),
    ...drawing.annotations.map((annotation) => dxfText(drawing, annotation)),
    ...drawing.diagnostics.map((diagnostic, index) => dxfEntity(["0", "TEXT", "8", dxfLayer(drawing.view, `diagnostic-${index}`), "10", -3, "20", -3 - index * 0.2, "40", 0.2, "1", diagnostic]))
  ]).flat().join("")
  return `0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`
}

function pdfPoint(point: { x: number; y: number; depth: number }, bounds: DrawingBounds, width: number, height: number) {
  const spanX = Math.max(bounds.maxX - bounds.minX, 1)
  const spanY = Math.max(bounds.maxY - bounds.minY, 1)
  const scale = Math.min((width - 80) / spanX, (height - 80) / spanY)
  return { x: 40 + (point.x - bounds.minX) * scale, y: 40 + (point.y - bounds.minY) * scale }
}

function drawPdfPrimitive(page: Awaited<ReturnType<PDFDocument["addPage"]>>, primitive: ProjectedPrimitive, bounds: DrawingBounds, width: number, height: number) {
  const points = primitivePoints(primitive).filter(finitePoint).map((point) => pdfPoint(point, bounds, width, height))
  if (points.length === 0) return
  if (primitive.kind === "point") {
    page.drawCircle({ x: points[0].x, y: points[0].y, size: 2.5, color: rgb(0.24, 0.35, 0.75) })
    return
  }
  for (let index = 1; index < points.length; index += 1) page.drawLine({ start: points[index - 1], end: points[index], thickness: 1, color: rgb(0.16, 0.24, 0.5) })
}

export async function exportEngineeringPdf(drawings: ProjectedDrawing[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const width = 720
  const height = 540
  drawings.slice(0, 4).forEach((drawing) => {
    const page = pdf.addPage([width, height])
    const bounds = drawingBounds(drawing)
    page.drawText(`${drawing.view} engineering view`, { x: 24, y: height - 28, size: 14, font, color: rgb(0.08, 0.13, 0.22) })
    drawing.primitives.forEach((primitive) => drawPdfPrimitive(page, primitive, bounds, width, height))
    drawing.projectionLines.forEach((line) => {
      if (!finitePoint(line.from) || !finitePoint(line.to)) return
      page.drawLine({ start: pdfPoint(line.from, bounds, width, height), end: pdfPoint(line.to, bounds, width, height), thickness: 0.6, color: rgb(0.8, 0.55, 0.1) })
    })
    drawing.annotations.forEach((annotation) => {
      const position = annotation.position ? pdfPoint(annotation.position, bounds, width, height) : { x: 32, y: 32 }
      page.drawText(annotation.text, { x: position.x, y: position.y, size: 9, font, color: annotation.status === "valid" ? rgb(0.08, 0.13, 0.22) : rgb(0.75, 0.3, 0.05) })
    })
    drawing.diagnostics.forEach((diagnostic, index) => page.drawText(diagnostic, { x: 24, y: height - 48 - index * 12, size: 7, font, color: rgb(0.75, 0.3, 0.05) }))
  })
  if (drawings.length === 0) pdf.addPage([width, height])
  return pdf.save()
}
