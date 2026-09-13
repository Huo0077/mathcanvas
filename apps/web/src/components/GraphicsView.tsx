import { type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useMemo, useRef, useState } from "react"
import type { Coordinate, GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { evaluateParameterExpression, sampleEllipse, sampleFunctionSegments, sampleHyperbolaBranches, sampleParabola } from "@draw/geometry-kernel"
import { applyOperation, type DomainOperation } from "@draw/scene-graph"

import { createDragAction, getDragHandle, rotationHandlePoint, type DragAction, type DragHandle } from "../interaction"
import { dashFor, fillFor, opacityFor, strokeFor, strokeWidthFor } from "../primitiveStyle"
import { VIEWBOX, WORLD_BOUNDS, WORLD_SCALE, svgToWorld, worldToSvg } from "../viewport"

type CreationMode = "line" | "segment" | "ray" | "polyline" | "circle" | "arc" | null

interface GraphicsViewProps {
  document: GeometryDocument
  selectedIds: string[]
  creationMode: CreationMode
  onSelect: (id: string | null, additive?: boolean) => void
  onCanvasClick: (coordinate: Coordinate) => void
  onCanvasDoubleClick: (coordinate: Coordinate) => void
  onBoxSelect: (bounds: { minX: number; minY: number; maxX: number; maxY: number }) => void
  onDragEnd: (id: string, action: DragAction) => void
}

function eventToWorld(event: ReactMouseEvent<SVGElement> | ReactPointerEvent<SVGElement>): Coordinate {
  const svg = event.currentTarget.ownerSVGElement ?? event.currentTarget as SVGSVGElement
  const bounds = svg.getBoundingClientRect()
  const width = bounds.width || VIEWBOX.width
  const height = bounds.height || VIEWBOX.height
  const svgPoint = { x: ((event.clientX - bounds.left) / width) * VIEWBOX.width, y: ((event.clientY - bounds.top) / height) * VIEWBOX.height }
  return svgToWorld(svgPoint)
}

const toX = (x: number) => worldToSvg({ x, y: 0 }).x
const toY = (y: number) => worldToSvg({ x: 0, y }).y

function pointsAttribute(points: Coordinate[]): string {
  return points.map((point) => `${toX(point.x)},${toY(point.y)}`).join(" ")
}

export function GraphicsView({ document, selectedIds, creationMode, onSelect, onCanvasClick, onCanvasDoubleClick, onBoxSelect, onDragEnd }: GraphicsViewProps) {
  const [dragStart, setDragStart] = useState<Coordinate | null>(null)
  const [dragCurrent, setDragCurrent] = useState<Coordinate | null>(null)
  const [dragState, setDragState] = useState<{ id: string; handle: DragHandle; origin: Coordinate; pointerId: number } | null>(null)
  const suppressClick = useRef(false)
  const previewDocument = useMemo(() => {
    if (!dragState || !dragCurrent) return document
    const primitive = document.primitives.find((candidate) => candidate.id === dragState.id)
    if (!primitive) return document
    const action = createDragAction(primitive, dragState.handle, dragState.origin, dragCurrent)
    if (!action) return document
    const operation: DomainOperation = action.kind === "translate"
      ? { op: "translatePrimitive", id: primitive.id, delta: action.delta }
      : { op: "updatePrimitive", id: primitive.id, patch: action.patch }
    const result = applyOperation(document, operation)
    return result.changed ? result.document : document
  }, [document, dragCurrent, dragState])
  const displayPrimitives = previewDocument.primitives

  const viewportLine = (line: Extract<PrimitiveSpec, { type: "line" }>) => {
    const deltaX = line.b.x - line.a.x
    if (Math.abs(deltaX) < 1e-9) return { a: { x: line.a.x, y: WORLD_BOUNDS.minY }, b: { x: line.a.x, y: WORLD_BOUNDS.maxY } }
    const slope = (line.b.y - line.a.y) / deltaX
    return { a: { x: WORLD_BOUNDS.minX, y: line.a.y + slope * (WORLD_BOUNDS.minX - line.a.x) }, b: { x: WORLD_BOUNDS.maxX, y: line.a.y + slope * (WORLD_BOUNDS.maxX - line.a.x) } }
  }
  const viewportRay = (ray: Extract<PrimitiveSpec, { type: "ray" }>) => {
    const length = Math.hypot(ray.b.x - ray.a.x, ray.b.y - ray.a.y)
    if (!Number.isFinite(length) || length === 0) return { a: ray.a, b: ray.b }
    const unit = { x: (ray.b.x - ray.a.x) / length, y: (ray.b.y - ray.a.y) / length }
    const limits = [unit.x > 0 ? (WORLD_BOUNDS.minX - ray.a.x) / unit.x : Infinity, unit.x < 0 ? (WORLD_BOUNDS.maxX - ray.a.x) / unit.x : Infinity, unit.y > 0 ? (WORLD_BOUNDS.minY - ray.a.y) / unit.y : Infinity, unit.y < 0 ? (WORLD_BOUNDS.maxY - ray.a.y) / unit.y : Infinity].filter((value) => value >= 0 && Number.isFinite(value))
    const distance = Math.min(...limits, 20)
    return { a: ray.a, b: { x: ray.a.x + unit.x * distance, y: ray.a.y + unit.y * distance } }
  }
  const functionSegments = (primitive: Extract<PrimitiveSpec, { type: "function" }>) => {
    try { return sampleFunctionSegments((x) => evaluateParameterExpression(primitive.expression, { x }), primitive.domain, primitive.samples ?? 128) } catch { return [] }
  }
  const handleObjectClick = (event: ReactMouseEvent<SVGElement>, id: string) => { event.stopPropagation(); if (creationMode) onCanvasClick(eventToWorld(event)); else onSelect(id, event.shiftKey) }
  const beginDrag = (event: ReactPointerEvent<SVGElement>, id: string) => {
    event.stopPropagation()
    if (creationMode) return
    const primitive = document.primitives.find((candidate) => candidate.id === id)
    if (!primitive) return
    onSelect(id, event.shiftKey)
    const handle = getDragHandle(primitive, eventToWorld(event))
    if (!handle) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDragState({ id, handle, origin: eventToWorld(event), pointerId: event.pointerId })
  }
  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => { if (creationMode || dragState) return; const coordinate = eventToWorld(event); setDragStart(coordinate); setDragCurrent(coordinate) }
  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const coordinate = eventToWorld(event)
    if (dragState) { if (event.pointerId === dragState.pointerId) setDragCurrent(coordinate); return }
    if (dragStart) setDragCurrent(coordinate)
  }
  const finishDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragState && event.pointerId === dragState.pointerId) {
      const primitive = document.primitives.find((candidate) => candidate.id === dragState.id)
      const current = eventToWorld(event)
      const action = primitive && createDragAction(primitive, dragState.handle, dragState.origin, current)
      if (primitive && action && Math.hypot(current.x - dragState.origin.x, current.y - dragState.origin.y) > 0.01) { suppressClick.current = true; onDragEnd(primitive.id, action) }
      setDragState(null)
      setDragCurrent(null)
      return
    }
    if (!dragStart) return
    const end = eventToWorld(event)
    const bounds = { minX: Math.min(dragStart.x, end.x), minY: Math.min(dragStart.y, end.y), maxX: Math.max(dragStart.x, end.x), maxY: Math.max(dragStart.y, end.y) }
    if (Math.abs(end.x - dragStart.x) > 0.15 || Math.abs(end.y - dragStart.y) > 0.15) { suppressClick.current = true; onBoxSelect(bounds) }
    setDragStart(null)
    setDragCurrent(null)
  }
  const selectionRect = dragStart && dragCurrent ? { x: toX(Math.min(dragStart.x, dragCurrent.x)), y: toY(Math.max(dragStart.y, dragCurrent.y)), width: Math.abs(toX(dragCurrent.x) - toX(dragStart.x)), height: Math.abs(toY(dragCurrent.y) - toY(dragStart.y)) } : null
  const renderHandles = (primitive: PrimitiveSpec) => {
    if (!selectedIds.includes(primitive.id) || primitive.locked) return null
    const handles: { handle: DragHandle; point: Coordinate }[] = []
    if (primitive.type === "line" || primitive.type === "segment" || primitive.type === "ray") handles.push({ handle: "a", point: primitive.a }, { handle: "b", point: primitive.b })
    if (primitive.type === "polyline") primitive.points.forEach((point, index) => handles.push({ handle: `vertex-${index}`, point }))
    if (primitive.type === "parabola") handles.push({ handle: "vertex", point: primitive.vertex }, { handle: "rotation", point: rotationHandlePoint(primitive) })
    if (primitive.type === "circle") handles.push({ handle: "radius", point: { x: primitive.center.x + primitive.radius, y: primitive.center.y } })
    if (primitive.type === "arc") {
      handles.push({ handle: "startAngle", point: { x: primitive.center.x + primitive.radius * Math.cos(primitive.startAngle), y: primitive.center.y + primitive.radius * Math.sin(primitive.startAngle) } })
      handles.push({ handle: "endAngle", point: { x: primitive.center.x + primitive.radius * Math.cos(primitive.endAngle), y: primitive.center.y + primitive.radius * Math.sin(primitive.endAngle) } })
      const middleAngle = (primitive.startAngle + primitive.endAngle) / 2
      handles.push({ handle: "radius", point: { x: primitive.center.x + primitive.radius * Math.cos(middleAngle), y: primitive.center.y + primitive.radius * Math.sin(middleAngle) } })
    }
    if (primitive.type === "ellipse" || primitive.type === "hyperbola") {
      const rotation = primitive.rotation ?? 0
      handles.push(
        { handle: "radiusX", point: { x: primitive.center.x + primitive.radiusX * Math.cos(rotation), y: primitive.center.y + primitive.radiusX * Math.sin(rotation) } },
        { handle: "radiusY", point: { x: primitive.center.x - primitive.radiusY * Math.sin(rotation), y: primitive.center.y + primitive.radiusY * Math.cos(rotation) } },
        { handle: "rotation", point: rotationHandlePoint(primitive) }
      )
    }
    return <g className="drag-handles" aria-hidden="true">{handles.map(({ handle, point }) => <circle key={handle} data-drag-handle={handle} cx={toX(point.x)} cy={toY(point.y)} r="6" onPointerDown={(event) => beginDrag(event, primitive.id)} />)}</g>
  }

  return <main className="graphics"><div className="canvas-card"><svg className={dragState ? "is-dragging" : undefined} viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`} role="img" aria-label="几何画布" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={finishDrag} onPointerCancel={finishDrag} onDoubleClick={(event) => creationMode === "polyline" && onCanvasDoubleClick(eventToWorld(event))} onClick={(event) => { if (suppressClick.current) { suppressClick.current = false; return }; if (creationMode) onCanvasClick(eventToWorld(event)); else if (!dragStart) onSelect(null) }}>
    <g stroke="#e6eaf2" strokeWidth="1">{Array.from({ length: 21 }, (_, index) => { const x = worldToSvg({ x: WORLD_BOUNDS.minX + index, y: 0 }).x; return <line key={`v-${index}`} x1={x} y1={VIEWBOX.top} x2={x} y2={VIEWBOX.bottom} /> })}{Array.from({ length: 13 }, (_, index) => { const y = worldToSvg({ x: 0, y: WORLD_BOUNDS.minY + index }).y; return <line key={`h-${index}`} x1={VIEWBOX.left} y1={y} x2={VIEWBOX.right} y2={y} /> })}</g>
    <line x1={VIEWBOX.left} y1={toY(0)} x2={VIEWBOX.right} y2={toY(0)} stroke="#9aa6bd" strokeWidth="1.5" /><line x1={toX(0)} y1={VIEWBOX.top} x2={toX(0)} y2={VIEWBOX.bottom} stroke="#9aa6bd" strokeWidth="1.5" />
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "line" }> => primitive.type === "line" && primitive.visible !== false).map((line) => { const visible = viewportLine(line); return <g key={line.id} data-primitive-type="line" opacity={opacityFor(line)} onPointerDown={(event) => beginDrag(event, line.id)} onClick={(event) => handleObjectClick(event, line.id)}><line data-hit-target="true" x1={toX(visible.a.x)} y1={toY(visible.a.y)} x2={toX(visible.b.x)} y2={toY(visible.b.y)} stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><line x1={toX(visible.a.x)} y1={toY(visible.a.y)} x2={toX(visible.b.x)} y2={toY(visible.b.y)} stroke={strokeFor(line)} strokeWidth={strokeWidthFor(line, selectedIds.includes(line.id))} strokeDasharray={dashFor(line)} />{renderHandles(line)}</g> })}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "ray" }> => primitive.type === "ray" && primitive.visible !== false).map((ray) => { const visible = viewportRay(ray); return <g key={ray.id} data-primitive-type="ray" opacity={opacityFor(ray)} onPointerDown={(event) => beginDrag(event, ray.id)} onClick={(event) => handleObjectClick(event, ray.id)}><line data-hit-target="true" x1={toX(visible.a.x)} y1={toY(visible.a.y)} x2={toX(visible.b.x)} y2={toY(visible.b.y)} stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><line x1={toX(visible.a.x)} y1={toY(visible.a.y)} x2={toX(visible.b.x)} y2={toY(visible.b.y)} stroke={strokeFor(ray)} strokeWidth={strokeWidthFor(ray, selectedIds.includes(ray.id))} strokeDasharray={dashFor(ray)} />{renderHandles(ray)}</g> })}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "segment" }> => primitive.type === "segment" && primitive.visible !== false).map((segment) => <g key={segment.id} data-primitive-type="segment" opacity={opacityFor(segment)} onPointerDown={(event) => beginDrag(event, segment.id)} onClick={(event) => handleObjectClick(event, segment.id)}><line data-hit-target="true" x1={toX(segment.a.x)} y1={toY(segment.a.y)} x2={toX(segment.b.x)} y2={toY(segment.b.y)} stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><line x1={toX(segment.a.x)} y1={toY(segment.a.y)} x2={toX(segment.b.x)} y2={toY(segment.b.y)} stroke={strokeFor(segment)} strokeWidth={strokeWidthFor(segment, selectedIds.includes(segment.id))} strokeDasharray={dashFor(segment)} />{renderHandles(segment)}</g>)}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "polyline" }> => primitive.type === "polyline" && primitive.visible !== false).map((polyline) => <g key={polyline.id} data-primitive-type="polyline" opacity={opacityFor(polyline)} onPointerDown={(event) => beginDrag(event, polyline.id)} onClick={(event) => handleObjectClick(event, polyline.id)}><polyline data-hit-target="true" points={pointsAttribute(polyline.points)} fill="none" stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><polyline points={pointsAttribute(polyline.points)} fill="none" stroke={strokeFor(polyline)} strokeWidth={strokeWidthFor(polyline, selectedIds.includes(polyline.id))} strokeDasharray={dashFor(polyline)} />{renderHandles(polyline)}</g>)}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "parabola" }> => primitive.type === "parabola" && primitive.visible !== false).map((parabola) => { const sampled = sampleParabola(parabola, [-10, 10], 128); return <g key={parabola.id} data-primitive-type="parabola" opacity={opacityFor(parabola)} onPointerDown={(event) => beginDrag(event, parabola.id)} onClick={(event) => handleObjectClick(event, parabola.id)}><polyline data-hit-target="true" points={pointsAttribute(sampled)} fill="none" stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><polyline points={pointsAttribute(sampled)} fill="none" stroke={strokeFor(parabola)} strokeWidth={strokeWidthFor(parabola, selectedIds.includes(parabola.id))} strokeDasharray={dashFor(parabola)} />{renderHandles(parabola)}</g> })}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "ellipse" }> => primitive.type === "ellipse" && primitive.visible !== false).map((ellipse) => { const sampled = sampleEllipse(ellipse, 160); return <g key={ellipse.id} data-primitive-type="ellipse" opacity={opacityFor(ellipse)} onPointerDown={(event) => beginDrag(event, ellipse.id)} onClick={(event) => handleObjectClick(event, ellipse.id)}><polyline data-hit-target="true" points={pointsAttribute(sampled)} fill="none" stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><polyline points={pointsAttribute(sampled)} fill="none" stroke={strokeFor(ellipse)} strokeWidth={strokeWidthFor(ellipse, selectedIds.includes(ellipse.id))} strokeDasharray={dashFor(ellipse)} />{renderHandles(ellipse)}</g> })}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "hyperbola" }> => primitive.type === "hyperbola" && primitive.visible !== false).map((hyperbola) => { const [branch, opposite] = sampleHyperbolaBranches(hyperbola, [-10, 10], 128); return <g key={hyperbola.id} data-primitive-type="hyperbola" opacity={opacityFor(hyperbola)} onPointerDown={(event) => beginDrag(event, hyperbola.id)} onClick={(event) => handleObjectClick(event, hyperbola.id)}><polyline data-hit-target="true" points={pointsAttribute(branch)} fill="none" stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><polyline data-hit-target="true" points={pointsAttribute(opposite)} fill="none" stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><polyline points={pointsAttribute(branch)} fill="none" stroke={strokeFor(hyperbola)} strokeWidth={strokeWidthFor(hyperbola, selectedIds.includes(hyperbola.id))} strokeDasharray={dashFor(hyperbola)} /><polyline points={pointsAttribute(opposite)} fill="none" stroke={strokeFor(hyperbola)} strokeWidth={strokeWidthFor(hyperbola, selectedIds.includes(hyperbola.id))} strokeDasharray={dashFor(hyperbola)} />{renderHandles(hyperbola)}</g> })}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "function" }> => primitive.type === "function" && primitive.visible !== false).map((primitive) => <g key={primitive.id} data-primitive-type="function" opacity={opacityFor(primitive)} onPointerDown={(event) => beginDrag(event, primitive.id)} onClick={(event) => handleObjectClick(event, primitive.id)}>{functionSegments(primitive).map((points, index) => <polyline key={`${primitive.id}-hit-${index}`} data-hit-target="true" points={pointsAttribute(points)} fill="none" stroke="transparent" strokeWidth="18" pointerEvents="stroke" />)}{functionSegments(primitive).map((points, index) => <polyline key={`${primitive.id}-${index}`} points={pointsAttribute(points)} fill="none" stroke={strokeFor(primitive)} strokeWidth={strokeWidthFor(primitive, selectedIds.includes(primitive.id))} strokeDasharray={dashFor(primitive)} />)}</g>)}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "circle" }> => primitive.type === "circle" && primitive.visible !== false).map((circle) => <g key={circle.id} data-primitive-type="circle" opacity={opacityFor(circle)} onPointerDown={(event) => beginDrag(event, circle.id)} onClick={(event) => handleObjectClick(event, circle.id)}><circle data-hit-target="true" cx={toX(circle.center.x)} cy={toY(circle.center.y)} r={circle.radius * WORLD_SCALE} fill="none" stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><circle cx={toX(circle.center.x)} cy={toY(circle.center.y)} r={circle.radius * WORLD_SCALE} fill={fillFor(circle)} stroke={strokeFor(circle)} strokeWidth={strokeWidthFor(circle, selectedIds.includes(circle.id))} strokeDasharray={dashFor(circle)} /><text x={toX(circle.center.x) + circle.radius * WORLD_SCALE + 8} y={toY(circle.center.y)} fill="#172033" fontSize="14" fontWeight="700">{circle.label ?? circle.id}</text>{renderHandles(circle)}</g>)}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "arc" }> => primitive.type === "arc" && primitive.visible !== false).map((arc) => { const path = `M ${toX(arc.center.x + arc.radius * Math.cos(arc.startAngle))} ${toY(arc.center.y + arc.radius * Math.sin(arc.startAngle))} A ${arc.radius * WORLD_SCALE} ${arc.radius * WORLD_SCALE} 0 ${Math.abs(arc.endAngle - arc.startAngle) > Math.PI ? 1 : 0} ${arc.endAngle >= arc.startAngle ? 0 : 1} ${toX(arc.center.x + arc.radius * Math.cos(arc.endAngle))} ${toY(arc.center.y + arc.radius * Math.sin(arc.endAngle))}`; return <g key={arc.id} data-primitive-type="arc" opacity={opacityFor(arc)} onPointerDown={(event) => beginDrag(event, arc.id)} onClick={(event) => handleObjectClick(event, arc.id)}><path data-hit-target="true" d={path} fill="none" stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><path d={path} fill="none" stroke={strokeFor(arc)} strokeWidth={strokeWidthFor(arc, selectedIds.includes(arc.id))} strokeDasharray={dashFor(arc)} />{renderHandles(arc)}</g> })}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "point" }> => primitive.type === "point" && primitive.visible !== false).map((point) => <g key={point.id} data-primitive-type="point" opacity={opacityFor(point)} onPointerDown={(event) => beginDrag(event, point.id)} onClick={(event) => handleObjectClick(event, point.id)}><circle data-hit-target="true" cx={toX(point.x)} cy={toY(point.y)} r="14" fill="transparent" pointerEvents="all" /><circle cx={toX(point.x)} cy={toY(point.y)} r="6" fill={fillFor(point)} /><text x={toX(point.x) + 12} y={toY(point.y) + 5} fill="#172033" fontSize="14" fontWeight="700">{point.label ?? point.id}</text></g>)}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "intersection" | "lineCircleIntersection" | "circleIntersection" | "curveIntersection" }> => ["intersection", "lineCircleIntersection", "circleIntersection", "curveIntersection"].includes(primitive.type) && primitive.visible !== false).map((primitive) => <g key={primitive.id} data-primitive-type={primitive.type} opacity={opacityFor(primitive)} onClick={(event) => handleObjectClick(event, primitive.id)}><circle cx={toX(primitive.x)} cy={toY(primitive.y)} r="7" fill={fillFor(primitive)} stroke={strokeFor(primitive)} strokeWidth={strokeWidthFor(primitive, false)} strokeDasharray={dashFor(primitive)} /><text x={toX(primitive.x) + 12} y={toY(primitive.y) - 12} fill="#172033" fontSize="14" fontWeight="700">{primitive.label ?? "交点 P"} ({primitive.x.toFixed(2)}, {primitive.y.toFixed(2)})</text></g>)}
    {selectionRect && <rect className="selection-rect" x={selectionRect.x} y={selectionRect.y} width={selectionRect.width} height={selectionRect.height} />}
  </svg></div></main>
}
