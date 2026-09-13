import { type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useRef, useState } from "react"
import type { Coordinate, GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { evaluateParameterExpression, sampleEllipse, sampleFunction, sampleHyperbola, sampleParabola } from "@draw/geometry-kernel"

const toX = (x: number) => 40 + ((x + 10) / 20) * 720
const toY = (y: number) => 320 - ((y + 6) / 12) * 360
type CreationMode = "line" | "segment" | "ray" | "polyline" | "circle" | "arc" | null

interface GraphicsViewProps {
  document: GeometryDocument
  selectedIds: string[]
  creationMode: CreationMode
  onSelect: (id: string | null, additive?: boolean) => void
  onCanvasClick: (coordinate: Coordinate) => void
  onCanvasDoubleClick: (coordinate: Coordinate) => void
  onBoxSelect: (bounds: { minX: number; minY: number; maxX: number; maxY: number }) => void
}

function eventToWorld(event: ReactMouseEvent<SVGElement>): Coordinate {
  const svg = event.currentTarget.ownerSVGElement ?? event.currentTarget as SVGSVGElement
  const bounds = svg.getBoundingClientRect()
  const width = bounds.width || 800
  const height = bounds.height || 380
  const viewX = ((event.clientX - bounds.left) / width) * 800
  const viewY = ((event.clientY - bounds.top) / height) * 380
  return { x: (viewX - 400) / 36, y: (140 - viewY) / 30 }
}

export function GraphicsView({ document, selectedIds, creationMode, onSelect, onCanvasClick, onCanvasDoubleClick, onBoxSelect }: GraphicsViewProps) {
  const [dragStart, setDragStart] = useState<Coordinate | null>(null)
  const [dragCurrent, setDragCurrent] = useState<Coordinate | null>(null)
  const suppressClick = useRef(false)
  const lines = document.primitives.filter((primitive): primitive is Extract<typeof primitive, { type: "line" }> => primitive.type === "line" && primitive.visible !== false)
  const rays = document.primitives.filter((primitive): primitive is Extract<typeof primitive, { type: "ray" }> => primitive.type === "ray" && primitive.visible !== false)
  const segments = document.primitives.filter((primitive): primitive is Extract<typeof primitive, { type: "segment" }> => primitive.type === "segment" && primitive.visible !== false)
  const polylines = document.primitives.filter((primitive): primitive is Extract<typeof primitive, { type: "polyline" }> => primitive.type === "polyline" && primitive.visible !== false)
  const parabolas = document.primitives.filter((primitive): primitive is Extract<typeof primitive, { type: "parabola" }> => primitive.type === "parabola" && primitive.visible !== false)
  const ellipses = document.primitives.filter((primitive): primitive is Extract<typeof primitive, { type: "ellipse" }> => primitive.type === "ellipse" && primitive.visible !== false)
  const hyperbolas = document.primitives.filter((primitive): primitive is Extract<typeof primitive, { type: "hyperbola" }> => primitive.type === "hyperbola" && primitive.visible !== false)
  const functions = document.primitives.filter((primitive): primitive is Extract<typeof primitive, { type: "function" }> => primitive.type === "function" && primitive.visible !== false)
  const circles = document.primitives.filter((primitive): primitive is Extract<typeof primitive, { type: "circle" }> => primitive.type === "circle" && primitive.visible !== false)
  const arcs = document.primitives.filter((primitive): primitive is Extract<typeof primitive, { type: "arc" }> => primitive.type === "arc" && primitive.visible !== false)
  const points = document.primitives.filter((primitive): primitive is Extract<typeof primitive, { type: "point" }> => primitive.type === "point" && primitive.visible !== false)
  const intersections = document.primitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "intersection" | "lineCircleIntersection" | "circleIntersection" | "curveIntersection" }> => ["intersection", "lineCircleIntersection", "circleIntersection", "curveIntersection"].includes(primitive.type) && primitive.visible !== false)
  const viewportLine = (line: Extract<PrimitiveSpec, { type: "line" }>) => {
    const deltaX = line.b.x - line.a.x
    if (Math.abs(deltaX) < 1e-9) return { a: { x: line.a.x, y: -6 }, b: { x: line.a.x, y: 6 } }
    const slope = (line.b.y - line.a.y) / deltaX
    return { a: { x: -10, y: line.a.y + slope * (-10 - line.a.x) }, b: { x: 10, y: line.a.y + slope * (10 - line.a.x) } }
  }
  const viewportRay = (ray: Extract<PrimitiveSpec, { type: "ray" }>) => {
    const length = Math.hypot(ray.b.x - ray.a.x, ray.b.y - ray.a.y)
    if (!Number.isFinite(length) || length === 0) return { a: ray.a, b: ray.b }
    const unit = { x: (ray.b.x - ray.a.x) / length, y: (ray.b.y - ray.a.y) / length }
    const limits = [unit.x > 0 ? (-10 - ray.a.x) / unit.x : Infinity, unit.x < 0 ? (10 - ray.a.x) / unit.x : Infinity, unit.y > 0 ? (-6 - ray.a.y) / unit.y : Infinity, unit.y < 0 ? (6 - ray.a.y) / unit.y : Infinity].filter((value) => value >= 0 && Number.isFinite(value))
    const distance = Math.min(...limits, 20)
    return { a: ray.a, b: { x: ray.a.x + unit.x * distance, y: ray.a.y + unit.y * distance } }
  }
  const pointsAttribute = (points: Coordinate[]) => points.map((point) => `${toX(point.x)},${toY(point.y)}`).join(" ")
  const functionPoints = (primitive: Extract<PrimitiveSpec, { type: "function" }>) => {
    try {
      return sampleFunction((x) => evaluateParameterExpression(primitive.expression, { x }), primitive.domain, primitive.samples ?? 128)
    } catch {
      return []
    }
  }
  const handleObjectClick = (event: ReactMouseEvent<SVGElement>, id: string) => { event.stopPropagation(); if (creationMode) onCanvasClick(eventToWorld(event)); else onSelect(id, event.shiftKey) }
  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => { if (creationMode) return; const coordinate = eventToWorld(event); setDragStart(coordinate); setDragCurrent(coordinate) }
  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => { if (dragStart) setDragCurrent(eventToWorld(event)) }
  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>) => { if (!dragStart) return; const end = eventToWorld(event); const bounds = { minX: Math.min(dragStart.x, end.x), minY: Math.min(dragStart.y, end.y), maxX: Math.max(dragStart.x, end.x), maxY: Math.max(dragStart.y, end.y) }; if (Math.abs(end.x - dragStart.x) > 0.15 || Math.abs(end.y - dragStart.y) > 0.15) { suppressClick.current = true; onBoxSelect(bounds) }; setDragStart(null); setDragCurrent(null) }
  const selectionRect = dragStart && dragCurrent ? { x: toX(Math.min(dragStart.x, dragCurrent.x)), y: toY(Math.max(dragStart.y, dragCurrent.y)), width: Math.abs(toX(dragCurrent.x) - toX(dragStart.x)), height: Math.abs(toY(dragCurrent.y) - toY(dragStart.y)) } : null
  return <main className="graphics"><div className="canvas-card"><svg viewBox="0 0 800 380" role="img" aria-label="几何画布" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onDoubleClick={(event) => creationMode === "polyline" && onCanvasDoubleClick(eventToWorld(event))} onClick={(event) => { if (suppressClick.current) { suppressClick.current = false; return }; if (creationMode) onCanvasClick(eventToWorld(event)); else if (!dragStart) onSelect(null) }}>
    <g stroke="#e6eaf2" strokeWidth="1">{Array.from({ length: 21 }, (_, index) => <line key={`v-${index}`} x1={40 + index * 36} y1="20" x2={40 + index * 36} y2="340" />)}{Array.from({ length: 11 }, (_, index) => <line key={`h-${index}`} x1="40" y1={20 + index * 32} x2="760" y2={20 + index * 32} />)}</g>
    <line x1="40" y1={toY(0)} x2="760" y2={toY(0)} stroke="#9aa6bd" strokeWidth="1.5" /><line x1={toX(0)} y1="20" x2={toX(0)} y2="340" stroke="#9aa6bd" strokeWidth="1.5" />
    {lines.map((line) => { const visible = viewportLine(line); return <line key={line.id} data-primitive-type="line" onClick={(event) => handleObjectClick(event, line.id)} x1={toX(visible.a.x)} y1={toY(visible.a.y)} x2={toX(visible.b.x)} y2={toY(visible.b.y)} stroke="#172033" strokeWidth={selectedIds.includes(line.id) ? 5 : 3} /> })}
    {rays.map((ray) => { const visible = viewportRay(ray); return <line key={ray.id} data-primitive-type="ray" onClick={(event) => handleObjectClick(event, ray.id)} x1={toX(visible.a.x)} y1={toY(visible.a.y)} x2={toX(visible.b.x)} y2={toY(visible.b.y)} stroke="#7c3aed" strokeWidth={selectedIds.includes(ray.id) ? 5 : 3} /> })}
    {segments.map((segment) => <line key={segment.id} data-primitive-type="segment" onClick={(event) => handleObjectClick(event, segment.id)} x1={toX(segment.a.x)} y1={toY(segment.a.y)} x2={toX(segment.b.x)} y2={toY(segment.b.y)} stroke="#0b7285" strokeWidth={selectedIds.includes(segment.id) ? 5 : 3} />)}
    {polylines.map((polyline) => <polyline key={polyline.id} data-primitive-type="polyline" onClick={(event) => handleObjectClick(event, polyline.id)} points={polyline.points.map((point) => `${toX(point.x)},${toY(point.y)}`).join(" ")} fill="none" stroke="#b45309" strokeWidth={selectedIds.includes(polyline.id) ? 5 : 3} />)}
    {parabolas.map((parabola) => <polyline key={parabola.id} data-primitive-type="parabola" onClick={(event) => handleObjectClick(event, parabola.id)} points={pointsAttribute(sampleParabola(parabola, [-10, 10], 128))} fill="none" stroke="#db2777" strokeWidth={selectedIds.includes(parabola.id) ? 5 : 3} />)}
    {ellipses.map((ellipse) => <polyline key={ellipse.id} data-primitive-type="ellipse" onClick={(event) => handleObjectClick(event, ellipse.id)} points={pointsAttribute(sampleEllipse(ellipse, 160))} fill="none" stroke="#0891b2" strokeWidth={selectedIds.includes(ellipse.id) ? 5 : 3} />)}
    {hyperbolas.map((hyperbola) => { const branch = sampleHyperbola(hyperbola, [-10, 10], 128); const opposite = branch.map((point) => hyperbola.axis === "x" ? { x: point.x, y: 2 * hyperbola.center.y - point.y } : { x: 2 * hyperbola.center.x - point.x, y: point.y }); return <g key={hyperbola.id} data-primitive-type="hyperbola" onClick={(event) => handleObjectClick(event, hyperbola.id)}><polyline points={pointsAttribute(branch)} fill="none" stroke="#9333ea" strokeWidth={selectedIds.includes(hyperbola.id) ? 5 : 3} /><polyline points={pointsAttribute(opposite)} fill="none" stroke="#9333ea" strokeWidth={selectedIds.includes(hyperbola.id) ? 5 : 3} /></g> })}
    {functions.map((primitive) => <polyline key={primitive.id} data-primitive-type="function" onClick={(event) => handleObjectClick(event, primitive.id)} points={pointsAttribute(functionPoints(primitive))} fill="none" stroke="#16a34a" strokeWidth={selectedIds.includes(primitive.id) ? 5 : 3} />)}
    {circles.map((circle) => <g key={circle.id} onClick={(event) => handleObjectClick(event, circle.id)}><ellipse cx={toX(circle.center.x)} cy={toY(circle.center.y)} rx={circle.radius * 36} ry={circle.radius * 30} fill="none" stroke="#0f8a63" strokeWidth={selectedIds.includes(circle.id) ? 5 : 3} /><text x={toX(circle.center.x) + circle.radius * 36 + 8} y={toY(circle.center.y)} fill="#172033" fontSize="14" fontWeight="700">{circle.label ?? circle.id}</text></g>)}
    {arcs.map((arc) => <path key={arc.id} onClick={(event) => handleObjectClick(event, arc.id)} d={`M ${toX(arc.center.x + arc.radius * Math.cos(arc.startAngle))} ${toY(arc.center.y + arc.radius * Math.sin(arc.startAngle))} A ${arc.radius * 36} ${arc.radius * 30} 0 ${Math.abs(arc.endAngle - arc.startAngle) > Math.PI ? 1 : 0} ${arc.endAngle >= arc.startAngle ? 0 : 1} ${toX(arc.center.x + arc.radius * Math.cos(arc.endAngle))} ${toY(arc.center.y + arc.radius * Math.sin(arc.endAngle))}`} fill="none" stroke="#f08a24" strokeWidth={selectedIds.includes(arc.id) ? 5 : 3} />)}
    {points.map((point) => <g key={point.id} onClick={(event) => handleObjectClick(event, point.id)}><circle cx={toX(point.x)} cy={toY(point.y)} r="6" fill="#3d5afe" /><text x={toX(point.x) + 12} y={toY(point.y) + 5} fill="#172033" fontSize="14" fontWeight="700">{point.label ?? point.id}</text></g>)}
    {intersections.map((primitive) => <g key={primitive.id} data-primitive-type={primitive.type} onClick={(event) => handleObjectClick(event, primitive.id)}><circle cx={toX(primitive.x)} cy={toY(primitive.y)} r="7" fill="#f04f5f" /><text x={toX(primitive.x) + 12} y={toY(primitive.y) - 12} fill="#172033" fontSize="14" fontWeight="700">{primitive.label ?? "交点 P"} ({primitive.x.toFixed(2)}, {primitive.y.toFixed(2)})</text></g>)}
    {selectionRect && <rect className="selection-rect" x={selectionRect.x} y={selectionRect.y} width={selectionRect.width} height={selectionRect.height} />}
  </svg></div></main>
}
