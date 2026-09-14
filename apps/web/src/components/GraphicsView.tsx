import { type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react"
import type { Coordinate, GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { adaptiveSampleFunctionSegments, evaluateParameterExpression, sampleEllipse, sampleHyperbolaBranches, sampleParabola } from "@draw/geometry-kernel"
import { applyOperation, recomputeDerivedObjects, type DomainOperation } from "@draw/scene-graph"

import { createDragAction, getDragHandle, rotationHandlePoint, type DragAction, type DragHandle } from "../interaction"
import { resolveAnnotationPoint } from "../annotations"
import { clipFunctionSegmentsToBounds } from "../functionGraph"
import { getIntersectionPreviews, type IntersectionPreview } from "../intersectionPreview"
import { dashFor, fillFor, opacityFor, strokeFor, strokeWidthFor } from "../primitiveStyle"
import { DEFAULT_VIEWPORT, VIEWBOX, WORLD_SCALE, rayToViewport, svgToWorld, visibleWorldBounds, worldToSvg, type Viewport } from "../viewport"

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
  onCreateIntersection: (preview: IntersectionPreview) => void
}

function eventToSvg(event: ReactMouseEvent<SVGElement> | ReactPointerEvent<SVGElement>): Coordinate {
  const svg = event.currentTarget.ownerSVGElement ?? event.currentTarget as SVGSVGElement
  const bounds = svg.getBoundingClientRect()
  const width = bounds.width || VIEWBOX.width
  const height = bounds.height || VIEWBOX.height
  return { x: ((event.clientX - bounds.left) / width) * VIEWBOX.width, y: ((event.clientY - bounds.top) / height) * VIEWBOX.height }
}

function eventToWorld(event: ReactMouseEvent<SVGElement> | ReactPointerEvent<SVGElement>, viewport: Viewport): Coordinate {
  return svgToWorld(eventToSvg(event), viewport)
}

function rotateFeature(center: Coordinate, x: number, y: number, rotation: number): Coordinate {
  return { x: center.x + x * Math.cos(rotation) - y * Math.sin(rotation), y: center.y + x * Math.sin(rotation) + y * Math.cos(rotation) }
}

function conicFeatures(primitive: Extract<PrimitiveSpec, { type: "parabola" | "ellipse" | "hyperbola" }>): Array<{ label: string; point: Coordinate }> {
  if (primitive.type === "parabola") {
    const distance = primitive.focalParameter / 2
    return [
      { label: "V", point: primitive.vertex },
      { label: "F", point: rotateFeature(primitive.vertex, primitive.axis === "x" ? distance : 0, primitive.axis === "y" ? distance : 0, primitive.rotation ?? 0) }
    ]
  }
  const major = Math.max(primitive.radiusX, primitive.radiusY)
  const minor = Math.min(primitive.radiusX, primitive.radiusY)
  const distance = primitive.type === "ellipse" ? Math.sqrt(Math.max(major ** 2 - minor ** 2, 0)) : Math.sqrt(primitive.radiusX ** 2 + primitive.radiusY ** 2)
  const alongX = primitive.type === "hyperbola" ? primitive.axis === "x" : primitive.radiusX >= primitive.radiusY
  return [
    { label: "C", point: primitive.center },
    { label: "F₁", point: rotateFeature(primitive.center, alongX ? distance : 0, alongX ? 0 : distance, primitive.rotation ?? 0) },
    { label: "F₂", point: rotateFeature(primitive.center, alongX ? -distance : 0, alongX ? 0 : -distance, primitive.rotation ?? 0) }
  ]
}

function pointsAttribute(points: Coordinate[], viewport: Viewport): string {
  return points.map((point) => `${worldToSvg({ x: point.x, y: 0 }, viewport).x},${worldToSvg({ x: 0, y: point.y }, viewport).y}`).join(" ")
}

export function GraphicsView({ document, selectedIds, creationMode, onSelect, onCanvasClick, onCanvasDoubleClick, onBoxSelect, onDragEnd, onCreateIntersection }: GraphicsViewProps) {
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT)
  const [dragStart, setDragStart] = useState<Coordinate | null>(null)
  const [dragCurrent, setDragCurrent] = useState<Coordinate | null>(null)
  const [dragState, setDragState] = useState<{ id: string; handle: DragHandle; origin: Coordinate; pointerId: number } | null>(null)
  const [panState, setPanState] = useState<{ start: Coordinate; center: Coordinate; pointerId: number } | null>(null)
  const [spacePressed, setSpacePressed] = useState(false)
  const [hoverCoordinate, setHoverCoordinate] = useState<Coordinate | null>(null)
  const [hoverPrimitiveType, setHoverPrimitiveType] = useState<string | null>(null)
  const suppressClick = useRef(false)
  const worldBounds = visibleWorldBounds(viewport)
  const toX = (x: number) => worldToSvg({ x, y: 0 }, viewport).x
  const toY = (y: number) => worldToSvg({ x: 0, y }, viewport).y
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
  const intersectionPreviews = useMemo(() => {
    const persistentPairs = new Set(previewDocument.primitives.flatMap((primitive) => {
      if (primitive.type === "intersection") return [[primitive.lineA, primitive.lineB].sort().join("::")]
      if (primitive.type === "lineCircleIntersection") return [[primitive.lineId, primitive.circleId].sort().join("::")]
      if (primitive.type === "circleIntersection") return [[primitive.circleA, primitive.circleB].sort().join("::")]
      if (primitive.type === "curveIntersection") return [[primitive.objectA, primitive.objectB].sort().join("::")]
      return []
    }))
    return getIntersectionPreviews(previewDocument).filter((preview) => !persistentPairs.has([preview.objectA, preview.objectB].sort().join("::")))
  }, [previewDocument])
  const pointById = new Map(displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "point" }> => primitive.type === "point").map((point) => [point.id, point]))
  const connectionEndpoints = (connection: Extract<PrimitiveSpec, { type: "connection" }>) => {
    const start = pointById.get(connection.startPointId)
    const end = pointById.get(connection.endPointId)
    return start && end ? { start, end } : null
  }
  const connectionControl = (connection: Extract<PrimitiveSpec, { type: "connection" }>) => connection.control?.thirdPointId ? pointById.get(connection.control.thirdPointId) : undefined
  const locusSegments = (locus: Extract<PrimitiveSpec, { type: "locus" }>): Coordinate[][] => {
    const source = displayPrimitives.find((primitive): primitive is Extract<PrimitiveSpec, { type: "point" }> => primitive.id === locus.sourcePointId && primitive.type === "point")
    const parameter = previewDocument.parameters[locus.parameterId]
    if (!source || source.binding?.kind !== "onPath" || !parameter) return []
    const points: Coordinate[] = []
    const samples = Math.max(2, Math.min(4096, locus.samples))
    for (let index = 0; index < samples; index += 1) {
      const value = locus.domain[0] + (locus.domain[1] - locus.domain[0]) * index / (samples - 1)
      const nextParameters = { ...previewDocument.parameters, [locus.parameterId]: { ...parameter, value, expression: undefined } }
      const nextDocument = recomputeDerivedObjects({ ...previewDocument, parameters: nextParameters }, [locus.parameterId, source.id])
      const nextPoint = nextDocument.primitives.find((primitive): primitive is Extract<PrimitiveSpec, { type: "point" }> => primitive.id === source.id && primitive.type === "point")
      if (nextPoint && Number.isFinite(nextPoint.x) && Number.isFinite(nextPoint.y)) points.push({ x: nextPoint.x, y: nextPoint.y })
    }
    return points.length > 1 ? [points] : []
  }

  const viewportLine = (line: Extract<PrimitiveSpec, { type: "line" }>) => {
    const deltaX = line.b.x - line.a.x
    if (Math.abs(deltaX) < 1e-9) return { a: { x: line.a.x, y: worldBounds.minY }, b: { x: line.a.x, y: worldBounds.maxY } }
    const slope = (line.b.y - line.a.y) / deltaX
    return { a: { x: worldBounds.minX, y: line.a.y + slope * (worldBounds.minX - line.a.x) }, b: { x: worldBounds.maxX, y: line.a.y + slope * (worldBounds.maxX - line.a.x) } }
  }
  const functionSegments = (primitive: Extract<PrimitiveSpec, { type: "function" }>) => {
    try { return clipFunctionSegmentsToBounds(adaptiveSampleFunctionSegments((x) => evaluateParameterExpression(primitive.expression, { x }), primitive.domain, { initialSteps: primitive.samples ?? 128, maxSteps: Math.max(primitive.samples ?? 128, 2048) }), worldBounds) } catch { return [] }
  }
  const handleObjectClick = (event: ReactMouseEvent<SVGElement>, id: string) => { event.stopPropagation(); if (creationMode) onCanvasClick(eventToWorld(event, viewport)); else onSelect(id, event.shiftKey) }
  const beginDrag = (event: ReactPointerEvent<SVGElement>, id: string) => {
    if (event.button === 1 || (event.button === 0 && spacePressed)) return
    event.stopPropagation()
    if (creationMode) return
    const primitive = document.primitives.find((candidate) => candidate.id === id)
    if (!primitive) return
    onSelect(id, event.shiftKey)
    const handle = getDragHandle(primitive, eventToWorld(event, viewport))
    if (!handle) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDragState({ id, handle, origin: eventToWorld(event, viewport), pointerId: event.pointerId })
  }
  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (creationMode || dragState) return
    if (event.button === 1 || (event.button === 0 && spacePressed)) {
      event.preventDefault()
      event.currentTarget.setPointerCapture?.(event.pointerId)
      setPanState({ start: eventToSvg(event), center: viewport.center, pointerId: event.pointerId })
      return
    }
    const coordinate = eventToWorld(event, viewport)
    setDragStart(coordinate)
    setDragCurrent(coordinate)
  }
  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (panState && event.pointerId === panState.pointerId) {
      const current = eventToSvg(event)
      setViewport({ ...viewport, center: { x: panState.center.x + (panState.start.x - current.x) / viewport.scale, y: panState.center.y + (current.y - panState.start.y) / viewport.scale } })
      return
    }
    const coordinate = eventToWorld(event, viewport)
    setHoverCoordinate(coordinate)
    const primitiveGroup = (event.target as Element).closest<SVGGElement>("[data-primitive-type]")
    setHoverPrimitiveType(primitiveGroup?.getAttribute("data-primitive-type") ?? null)
    if (dragState) { if (event.pointerId === dragState.pointerId) setDragCurrent(coordinate); return }
    if (dragStart) setDragCurrent(coordinate)
  }
  const finishDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (panState && event.pointerId === panState.pointerId) {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
      setPanState(null)
      return
    }
    if (dragState && event.pointerId === dragState.pointerId) {
      const primitive = document.primitives.find((candidate) => candidate.id === dragState.id)
      const current = eventToWorld(event, viewport)
      const action = primitive && createDragAction(primitive, dragState.handle, dragState.origin, current)
      if (primitive && action && Math.hypot(current.x - dragState.origin.x, current.y - dragState.origin.y) > 0.01) { suppressClick.current = true; onDragEnd(primitive.id, action) }
      setDragState(null)
      setDragCurrent(null)
      return
    }
    if (!dragStart) return
    const end = eventToWorld(event, viewport)
    const bounds = { minX: Math.min(dragStart.x, end.x), minY: Math.min(dragStart.y, end.y), maxX: Math.max(dragStart.x, end.x), maxY: Math.max(dragStart.y, end.y) }
    if (Math.abs(end.x - dragStart.x) > 0.15 || Math.abs(end.y - dragStart.y) > 0.15) { suppressClick.current = true; onBoxSelect(bounds) }
    setDragStart(null)
    setDragCurrent(null)
  }
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => { if (event.code === "Space") { event.preventDefault(); setSpacePressed(true) } }
    const handleKeyUp = (event: KeyboardEvent) => { if (event.code === "Space") setSpacePressed(false) }
    const handleBlur = () => setSpacePressed(false)
    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)
    window.addEventListener("blur", handleBlur)
    return () => { window.removeEventListener("keydown", handleKeyDown); window.removeEventListener("keyup", handleKeyUp); window.removeEventListener("blur", handleBlur) }
  }, [])
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
  const renderAnnotations = () => previewDocument.annotations.filter((annotation) => annotation.visible !== false).map((annotation) => {
    const point = resolveAnnotationPoint(annotation, displayPrimitives)
    if (!point) return null
    const offset = annotation.offset ?? { x: 0.25, y: 0.25 }
    const labelPoint = { x: point.x + offset.x, y: point.y + offset.y }
    return <g key={annotation.id} data-annotation-id={annotation.id} className="annotation-marker" pointerEvents="none"><line x1={toX(point.x)} y1={toY(point.y)} x2={toX(labelPoint.x)} y2={toY(labelPoint.y)} /><circle cx={toX(point.x)} cy={toY(point.y)} r="3" /><text x={toX(labelPoint.x) + 5} y={toY(labelPoint.y) - 5}>{annotation.text}</text></g>
  })
  const renderIntersectionPreviews = () => intersectionPreviews.map((preview) => <g key={`${preview.objectA}-${preview.objectB}-${preview.solutionIndex}`} data-auto-intersection="true" onClick={(event) => { event.stopPropagation(); onCreateIntersection(preview) }}><circle cx={toX(preview.point.x)} cy={toY(preview.point.y)} r="8" fill="var(--color-panel)" stroke="var(--color-warning)" strokeWidth="2" strokeDasharray="3 2" /><text x={toX(preview.point.x) + 12} y={toY(preview.point.y) - 10} fill="var(--color-warning)" fontSize="12" fontWeight="700">交点 ({preview.point.x.toFixed(2)}, {preview.point.y.toFixed(2)}){preview.approximate ? " · 近似" : ""}</text></g>)

  const firstGridX = Math.ceil(worldBounds.minX)
  const firstGridY = Math.ceil(worldBounds.minY)
  const verticalGridCount = Math.max(0, Math.floor(worldBounds.maxX) - firstGridX + 1)
  const horizontalGridCount = Math.max(0, Math.floor(worldBounds.maxY) - firstGridY + 1)
  return <main className="graphics"><div className="canvas-card">{hoverCoordinate && <div className="coordinate-readout" data-coordinate-readout="true" role="status">{hoverPrimitiveType ? `${hoverPrimitiveType} · ` : ""}({hoverCoordinate.x.toFixed(2)}, {hoverCoordinate.y.toFixed(2)})</div>}<svg className={panState ? "is-panning" : dragState ? "is-dragging" : undefined} data-viewport-center={`${viewport.center.x},${viewport.center.y}`} viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`} role="img" aria-label="几何画布" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerLeave={() => { setHoverCoordinate(null); setHoverPrimitiveType(null) }} onPointerUp={finishDrag} onPointerCancel={finishDrag} onDoubleClick={(event) => creationMode === "polyline" && onCanvasDoubleClick(eventToWorld(event, viewport))} onClick={(event) => { if (suppressClick.current) { suppressClick.current = false; return }; if (creationMode) onCanvasClick(eventToWorld(event, viewport)); else if (!dragStart) onSelect(null) }}>
    <g stroke="#e6eaf2" strokeWidth="1">{Array.from({ length: verticalGridCount }, (_, index) => { const x = toX(firstGridX + index); return <line key={`v-${firstGridX + index}`} x1={x} y1={VIEWBOX.top} x2={x} y2={VIEWBOX.bottom} /> })}{Array.from({ length: horizontalGridCount }, (_, index) => { const y = toY(firstGridY + index); return <line key={`h-${firstGridY + index}`} x1={VIEWBOX.left} y1={y} x2={VIEWBOX.right} y2={y} /> })}</g>
    <line x1={VIEWBOX.left} y1={toY(0)} x2={VIEWBOX.right} y2={toY(0)} stroke="#9aa6bd" strokeWidth="1.5" /><line x1={toX(0)} y1={VIEWBOX.top} x2={toX(0)} y2={VIEWBOX.bottom} stroke="#9aa6bd" strokeWidth="1.5" />
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "line" }> => primitive.type === "line" && primitive.visible !== false).map((line) => { const visible = viewportLine(line); return <g key={line.id} data-primitive-type="line" opacity={opacityFor(line)} onPointerDown={(event) => beginDrag(event, line.id)} onClick={(event) => handleObjectClick(event, line.id)}><line data-hit-target="true" x1={toX(visible.a.x)} y1={toY(visible.a.y)} x2={toX(visible.b.x)} y2={toY(visible.b.y)} stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><line x1={toX(visible.a.x)} y1={toY(visible.a.y)} x2={toX(visible.b.x)} y2={toY(visible.b.y)} stroke={strokeFor(line)} strokeWidth={strokeWidthFor(line, selectedIds.includes(line.id))} strokeDasharray={dashFor(line)} />{renderHandles(line)}</g> })}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "ray" }> => primitive.type === "ray" && primitive.visible !== false).map((ray) => { const visible = rayToViewport(ray, worldBounds); return <g key={ray.id} data-primitive-type="ray" opacity={opacityFor(ray)} onPointerDown={(event) => beginDrag(event, ray.id)} onClick={(event) => handleObjectClick(event, ray.id)}><line data-hit-target="true" x1={toX(visible.a.x)} y1={toY(visible.a.y)} x2={toX(visible.b.x)} y2={toY(visible.b.y)} stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><line x1={toX(visible.a.x)} y1={toY(visible.a.y)} x2={toX(visible.b.x)} y2={toY(visible.b.y)} stroke={strokeFor(ray)} strokeWidth={strokeWidthFor(ray, selectedIds.includes(ray.id))} strokeDasharray={dashFor(ray)} />{renderHandles(ray)}</g> })}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "segment" }> => primitive.type === "segment" && primitive.visible !== false).map((segment) => <g key={segment.id} data-primitive-type="segment" opacity={opacityFor(segment)} onPointerDown={(event) => beginDrag(event, segment.id)} onClick={(event) => handleObjectClick(event, segment.id)}><line data-hit-target="true" x1={toX(segment.a.x)} y1={toY(segment.a.y)} x2={toX(segment.b.x)} y2={toY(segment.b.y)} stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><line x1={toX(segment.a.x)} y1={toY(segment.a.y)} x2={toX(segment.b.x)} y2={toY(segment.b.y)} stroke={strokeFor(segment)} strokeWidth={strokeWidthFor(segment, selectedIds.includes(segment.id))} strokeDasharray={dashFor(segment)} />{renderHandles(segment)}</g>)}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "polyline" }> => primitive.type === "polyline" && primitive.visible !== false).map((polyline) => <g key={polyline.id} data-primitive-type="polyline" opacity={opacityFor(polyline)} onPointerDown={(event) => beginDrag(event, polyline.id)} onClick={(event) => handleObjectClick(event, polyline.id)}><polyline data-hit-target="true" points={pointsAttribute(polyline.points, viewport)} fill="none" stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><polyline points={pointsAttribute(polyline.points, viewport)} fill="none" stroke={strokeFor(polyline)} strokeWidth={strokeWidthFor(polyline, selectedIds.includes(polyline.id))} strokeDasharray={dashFor(polyline)} />{renderHandles(polyline)}</g>)}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "parabola" }> => primitive.type === "parabola" && primitive.visible !== false).map((parabola) => { const sampled = sampleParabola(parabola, [worldBounds.minX, worldBounds.maxX], 128); return <g key={parabola.id} data-primitive-type="parabola" opacity={opacityFor(parabola)} onPointerDown={(event) => beginDrag(event, parabola.id)} onClick={(event) => handleObjectClick(event, parabola.id)}><polyline data-hit-target="true" points={pointsAttribute(sampled, viewport)} fill="none" stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><polyline points={pointsAttribute(sampled, viewport)} fill="none" stroke={strokeFor(parabola)} strokeWidth={strokeWidthFor(parabola, selectedIds.includes(parabola.id))} strokeDasharray={dashFor(parabola)} />{renderHandles(parabola)}</g> })}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "ellipse" }> => primitive.type === "ellipse" && primitive.visible !== false).map((ellipse) => { const sampled = sampleEllipse(ellipse, 160); return <g key={ellipse.id} data-primitive-type="ellipse" opacity={opacityFor(ellipse)} onPointerDown={(event) => beginDrag(event, ellipse.id)} onClick={(event) => handleObjectClick(event, ellipse.id)}><polyline data-hit-target="true" points={pointsAttribute(sampled, viewport)} fill="none" stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><polyline points={pointsAttribute(sampled, viewport)} fill={fillFor(ellipse)} stroke={strokeFor(ellipse)} strokeWidth={strokeWidthFor(ellipse, selectedIds.includes(ellipse.id))} strokeDasharray={dashFor(ellipse)} />{renderHandles(ellipse)}</g> })}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "hyperbola" }> => primitive.type === "hyperbola" && primitive.visible !== false).map((hyperbola) => { const [branch, opposite] = sampleHyperbolaBranches(hyperbola, [worldBounds.minX, worldBounds.maxX], 128); return <g key={hyperbola.id} data-primitive-type="hyperbola" opacity={opacityFor(hyperbola)} onPointerDown={(event) => beginDrag(event, hyperbola.id)} onClick={(event) => handleObjectClick(event, hyperbola.id)}><polyline data-hit-target="true" points={pointsAttribute(branch, viewport)} fill="none" stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><polyline data-hit-target="true" points={pointsAttribute(opposite, viewport)} fill="none" stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><polyline points={pointsAttribute(branch, viewport)} fill="none" stroke={strokeFor(hyperbola)} strokeWidth={strokeWidthFor(hyperbola, selectedIds.includes(hyperbola.id))} strokeDasharray={dashFor(hyperbola)} /><polyline points={pointsAttribute(opposite, viewport)} fill="none" stroke={strokeFor(hyperbola)} strokeWidth={strokeWidthFor(hyperbola, selectedIds.includes(hyperbola.id))} strokeDasharray={dashFor(hyperbola)} />{renderHandles(hyperbola)}</g> })}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "function" }> => primitive.type === "function" && primitive.visible !== false).map((primitive) => <g key={primitive.id} data-primitive-type="function" opacity={opacityFor(primitive)} onPointerDown={(event) => beginDrag(event, primitive.id)} onClick={(event) => handleObjectClick(event, primitive.id)}>{functionSegments(primitive).map((points, index) => <polyline key={`${primitive.id}-hit-${index}`} data-hit-target="true" points={pointsAttribute(points, viewport)} fill="none" stroke="transparent" strokeWidth="18" pointerEvents="stroke" />)}{functionSegments(primitive).map((points, index) => <polyline key={`${primitive.id}-${index}`} points={pointsAttribute(points, viewport)} fill="none" stroke={strokeFor(primitive)} strokeWidth={strokeWidthFor(primitive, selectedIds.includes(primitive.id))} strokeDasharray={dashFor(primitive)} />)}</g>)}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "derivative" }> => primitive.type === "derivative" && primitive.visible !== false).map((primitive) => <g key={primitive.id} data-primitive-type="derivative" opacity={opacityFor(primitive)} onClick={(event) => handleObjectClick(event, primitive.id)}><polyline data-hit-target="true" points={pointsAttribute(primitive.points, viewport)} fill="none" stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><polyline points={pointsAttribute(primitive.points, viewport)} fill="none" stroke={strokeFor(primitive)} strokeWidth={strokeWidthFor(primitive, selectedIds.includes(primitive.id))} strokeDasharray={dashFor(primitive)} /></g>)}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "tangent" | "normal" | "secant" }> => ["tangent", "normal", "secant"].includes(primitive.type) && primitive.visible !== false).map((primitive) => <g key={primitive.id} data-primitive-type={primitive.type} opacity={opacityFor(primitive)} onClick={(event) => handleObjectClick(event, primitive.id)}><line data-hit-target="true" x1={toX(primitive.a.x)} y1={toY(primitive.a.y)} x2={toX(primitive.b.x)} y2={toY(primitive.b.y)} stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><line x1={toX(primitive.a.x)} y1={toY(primitive.a.y)} x2={toX(primitive.b.x)} y2={toY(primitive.b.y)} stroke={strokeFor(primitive)} strokeWidth={strokeWidthFor(primitive, selectedIds.includes(primitive.id))} strokeDasharray={dashFor(primitive)} /></g>)}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "integral" }> => primitive.type === "integral" && primitive.visible !== false && primitive.points.length > 1).map((primitive) => <g key={primitive.id} data-primitive-type="integral" opacity={opacityFor(primitive)} onClick={(event) => handleObjectClick(event, primitive.id)}><polygon points={pointsAttribute([{ x: primitive.domain[0], y: 0 }, ...primitive.points, { x: primitive.domain[1], y: 0 }], viewport)} fill={fillFor(primitive)} fillOpacity="0.25" stroke={strokeFor(primitive)} strokeWidth={strokeWidthFor(primitive, selectedIds.includes(primitive.id))} /></g>)}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "analysisSet" }> => primitive.type === "analysisSet" && primitive.visible !== false).map((primitive) => <g key={primitive.id} data-primitive-type="analysisSet" opacity={opacityFor(primitive)} onClick={(event) => handleObjectClick(event, primitive.id)}>{primitive.results.map((result, index) => <g key={`${primitive.id}-${result.kind}-${index}`} data-analysis-kind={result.kind}><circle cx={toX(result.x)} cy={toY(result.y)} r="6" fill={fillFor(primitive)} stroke={strokeFor(primitive)} strokeWidth="2" /><text x={toX(result.x) + 8} y={toY(result.y) - 8} fill={strokeFor(primitive)} fontSize="12" fontWeight="700">{result.kind}</text></g>)}</g>)}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "circle" }> => primitive.type === "circle" && primitive.visible !== false).map((circle) => <g key={circle.id} data-primitive-type="circle" opacity={opacityFor(circle)} onPointerDown={(event) => beginDrag(event, circle.id)} onClick={(event) => handleObjectClick(event, circle.id)}><circle data-hit-target="true" cx={toX(circle.center.x)} cy={toY(circle.center.y)} r={circle.radius * WORLD_SCALE} fill="none" stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><circle cx={toX(circle.center.x)} cy={toY(circle.center.y)} r={circle.radius * WORLD_SCALE} fill={fillFor(circle)} stroke={strokeFor(circle)} strokeWidth={strokeWidthFor(circle, selectedIds.includes(circle.id))} strokeDasharray={dashFor(circle)} /><text x={toX(circle.center.x) + circle.radius * WORLD_SCALE + 8} y={toY(circle.center.y)} fill="#172033" fontSize="14" fontWeight="700">{circle.label ?? circle.id}</text>{renderHandles(circle)}</g>)}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "arc" }> => primitive.type === "arc" && primitive.visible !== false).map((arc) => { const path = `M ${toX(arc.center.x + arc.radius * Math.cos(arc.startAngle))} ${toY(arc.center.y + arc.radius * Math.sin(arc.startAngle))} A ${arc.radius * WORLD_SCALE} ${arc.radius * WORLD_SCALE} 0 ${Math.abs(arc.endAngle - arc.startAngle) > Math.PI ? 1 : 0} ${arc.endAngle >= arc.startAngle ? 0 : 1} ${toX(arc.center.x + arc.radius * Math.cos(arc.endAngle))} ${toY(arc.center.y + arc.radius * Math.sin(arc.endAngle))}`; return <g key={arc.id} data-primitive-type="arc" opacity={opacityFor(arc)} onPointerDown={(event) => beginDrag(event, arc.id)} onClick={(event) => handleObjectClick(event, arc.id)}><path data-hit-target="true" d={path} fill="none" stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><path d={path} fill="none" stroke={strokeFor(arc)} strokeWidth={strokeWidthFor(arc, selectedIds.includes(arc.id))} strokeDasharray={dashFor(arc)} />{renderHandles(arc)}</g> })}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "point" }> => primitive.type === "point" && primitive.visible !== false).map((point) => <g key={point.id} data-primitive-type="point" opacity={opacityFor(point)} onPointerDown={(event) => beginDrag(event, point.id)} onClick={(event) => handleObjectClick(event, point.id)}><circle data-hit-target="true" cx={toX(point.x)} cy={toY(point.y)} r="14" fill="transparent" pointerEvents="all" /><circle cx={toX(point.x)} cy={toY(point.y)} r="6" fill={fillFor(point)} stroke={strokeFor(point)} strokeWidth={strokeWidthFor(point, selectedIds.includes(point.id))} strokeDasharray={dashFor(point)} /><text x={toX(point.x) + 12} y={toY(point.y) + 5} fill="#172033" fontSize="14" fontWeight="700">{point.label ?? point.id}</text></g>)}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "intersection" | "lineCircleIntersection" | "circleIntersection" | "curveIntersection" }> => ["intersection", "lineCircleIntersection", "circleIntersection", "curveIntersection"].includes(primitive.type) && primitive.visible !== false).map((primitive) => { const selected = selectedIds.includes(primitive.id); return <g key={primitive.id} data-primitive-type={primitive.type} opacity={opacityFor(primitive)} onClick={(event) => handleObjectClick(event, primitive.id)}><circle data-hit-target="true" cx={toX(primitive.x)} cy={toY(primitive.y)} r="14" fill="transparent" pointerEvents="all" /><circle cx={toX(primitive.x)} cy={toY(primitive.y)} r={selected ? 5 : 4} fill={fillFor(primitive)} stroke={strokeFor(primitive)} strokeWidth={strokeWidthFor(primitive, selected)} strokeDasharray={dashFor(primitive)} />{selected && <text data-intersection-info="true" x={toX(primitive.x) + 9} y={toY(primitive.y) - 9} fill="#172033" fontSize="11" fontWeight="600">{primitive.label ?? "交点 P"} ({primitive.x.toFixed(2)}, {primitive.y.toFixed(2)})</text>}</g> })}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "intersectionSet" }> => primitive.type === "intersectionSet" && primitive.visible !== false).map((primitive) => { const selected = selectedIds.includes(primitive.id); return <g key={primitive.id} data-primitive-type="intersectionSet" opacity={opacityFor(primitive)} onClick={(event) => handleObjectClick(event, primitive.id)}>{primitive.points.map((point, index) => <g key={`${primitive.id}-point-${index}`}><circle data-hit-target="true" cx={toX(point.x)} cy={toY(point.y)} r="14" fill="transparent" pointerEvents="all" /><circle cx={toX(point.x)} cy={toY(point.y)} r={selected ? 5 : 4} fill={fillFor(primitive)} stroke={strokeFor(primitive)} strokeWidth={strokeWidthFor(primitive, selected)} strokeDasharray={dashFor(primitive)} />{selected && <text data-intersection-info="true" x={toX(point.x) + 9} y={toY(point.y) - 9} fill="#172033" fontSize="11" fontWeight="600">{primitive.label ?? "交点集合"} {index + 1} ({point.x.toFixed(2)}, {point.y.toFixed(2)})</text>}</g>)}</g> })}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "parabola" | "ellipse" | "hyperbola" }> => selectedIds.includes(primitive.id) && ["parabola", "ellipse", "hyperbola"].includes(primitive.type) && primitive.visible !== false).map((primitive) => <g key={`${primitive.id}-features`} data-feature-marker="true">{conicFeatures(primitive).map((feature) => <g key={`${primitive.id}-${feature.label}`}><circle cx={toX(feature.point.x)} cy={toY(feature.point.y)} r="5" fill="#ffffff" stroke="#f04f5f" strokeWidth="2" /><text x={toX(feature.point.x) + 9} y={toY(feature.point.y) - 9} fill="#f04f5f" fontSize="13" fontWeight="700">{feature.label}</text></g>)}</g>)}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "connection" }> => primitive.type === "connection" && primitive.kind !== "parabola" && primitive.visible !== false).map((connection) => { const endpoints = connectionEndpoints(connection); if (!endpoints) return null; return <g key={connection.id} data-primitive-type="connection" opacity={opacityFor(connection)} onClick={(event) => handleObjectClick(event, connection.id)}><line data-hit-target="true" x1={toX(endpoints.start.x)} y1={toY(endpoints.start.y)} x2={toX(endpoints.end.x)} y2={toY(endpoints.end.y)} stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><line x1={toX(endpoints.start.x)} y1={toY(endpoints.start.y)} x2={toX(endpoints.end.x)} y2={toY(endpoints.end.y)} stroke={strokeFor(connection)} strokeWidth={strokeWidthFor(connection, selectedIds.includes(connection.id))} strokeDasharray={dashFor(connection)} /></g> })}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "connection" }> => primitive.type === "connection" && primitive.kind === "parabola" && primitive.visible !== false).map((connection) => { const endpoints = connectionEndpoints(connection); const control = connectionControl(connection); if (!endpoints || !control) return null; const path = `M ${toX(endpoints.start.x)} ${toY(endpoints.start.y)} Q ${toX(control.x)} ${toY(control.y)} ${toX(endpoints.end.x)} ${toY(endpoints.end.y)}`; return <g key={connection.id} data-primitive-type="connection" data-connection-kind="parabola" opacity={opacityFor(connection)} onClick={(event) => handleObjectClick(event, connection.id)}><path data-hit-target="true" d={path} fill="none" stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><path d={path} fill="none" stroke={strokeFor(connection)} strokeWidth={strokeWidthFor(connection, selectedIds.includes(connection.id))} strokeDasharray={dashFor(connection)} /></g> })}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "locus" }> => primitive.type === "locus" && primitive.visible !== false).map((locus) => <g key={locus.id} data-primitive-type="locus" opacity={opacityFor(locus)} onClick={(event) => handleObjectClick(event, locus.id)}>{locusSegments(locus).map((points, index) => <polyline key={`${locus.id}-${index}`} points={pointsAttribute(points, viewport)} fill="none" stroke={strokeFor(locus)} strokeWidth={strokeWidthFor(locus, selectedIds.includes(locus.id))} strokeDasharray={dashFor(locus)} />)}</g>)}
    {renderAnnotations()}
    {renderIntersectionPreviews()}
    {selectionRect && <rect className="selection-rect" x={selectionRect.x} y={selectionRect.y} width={selectionRect.width} height={selectionRect.height} />}
  </svg></div></main>
}
