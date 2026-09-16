import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react"

import type { DrawingViewSpec, GeometryDocument, PrimitiveSpec } from "@draw/dsl"

import { drawingViewLabels, type ProjectedDrawing, type ProjectedPrimitive } from "../projectionVisuals"
import { TreeEyeIcon } from "./LayerTree"

export type DrawingViewportMode = "projection" | "draft"

export type DrawingViewPatch = Partial<Omit<DrawingViewSpec, "id">>

interface DrawingViewportProps {
  view: DrawingViewSpec
  sheetName: string
  mode: DrawingViewportMode
  document: GeometryDocument
  selectedIds: string[]
  active?: boolean
  projectedDrawing?: ProjectedDrawing | null
  /** Temporary projection-line override; the persisted `view.showProjectionLines` is the fallback. */
  projectionLinesOverride?: boolean
  onSelect: (id: string | null, additive?: boolean) => void
  onActivate?: (viewId: string) => void
  onLayoutChange?: (viewId: string, patch: DrawingViewPatch) => void
  onCreateAt?: (coordinate: { x: number; y: number }) => void
}

const drawingMetrics = {
  defaultMin: -4,
  defaultSpan: 8,
  paddingRatio: 0.12,
  minimumPadding: 0.6,
  pointRadiusRatio: 0.018
}

export interface DrawingBounds {
  minX: number
  minY: number
  width: number
  height: number
}

function boundsForPoints(points: { x: number; y: number }[]): DrawingBounds {
  if (points.length === 0) return { minX: drawingMetrics.defaultMin, minY: drawingMetrics.defaultMin, width: drawingMetrics.defaultSpan, height: drawingMetrics.defaultSpan }
  const minX = Math.min(...points.map((point) => point.x))
  const maxX = Math.max(...points.map((point) => point.x))
  const minY = Math.min(...points.map((point) => point.y))
  const maxY = Math.max(...points.map((point) => point.y))
  const padding = Math.max((maxX - minX) * drawingMetrics.paddingRatio, (maxY - minY) * drawingMetrics.paddingRatio, drawingMetrics.minimumPadding)
  return { minX: minX - padding, minY: -(maxY + padding), width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 }
}

function primitivePoints(primitive: ProjectedPrimitive) {
  return primitive.kind === "point" ? [primitive.point] : primitive.points
}

function viewBounds(drawing: ProjectedDrawing): DrawingBounds {
  return boundsForPoints([
    ...drawing.primitives.flatMap(primitivePoints),
    ...drawing.projectionLines.flatMap((line) => [line.from, line.to]),
    ...drawing.annotations.flatMap((annotation) => annotation.position ? [annotation.position] : [])
  ])
}

const planarTypes = new Set(["point", "line", "segment", "ray", "polyline", "circle", "arc"])

/** Planar primitives that survive both their own visibility flag and their layer's visibility. */
function visiblePlanarPrimitives(document: GeometryDocument): PrimitiveSpec[] {
  const hiddenLayers = new Set((document.layers ?? []).filter((layer) => layer.visible === false).map((layer) => layer.id))
  return document.primitives.filter((primitive) => {
    if (primitive.visible === false) return false
    if (!planarTypes.has(primitive.type)) return false
    return !(primitive.layerId && hiddenLayers.has(primitive.layerId))
  })
}

function draftBounds(document: GeometryDocument): DrawingBounds {
  const points: { x: number; y: number }[] = []
  for (const primitive of visiblePlanarPrimitives(document)) {
    if (primitive.type === "point") points.push({ x: primitive.x, y: primitive.y })
    else if (primitive.type === "line" || primitive.type === "segment" || primitive.type === "ray") points.push(primitive.a, primitive.b)
    else if (primitive.type === "polyline") points.push(...primitive.points)
    else if (primitive.type === "circle" || primitive.type === "arc") points.push({ x: primitive.center.x - primitive.radius, y: primitive.center.y - primitive.radius }, { x: primitive.center.x + primitive.radius, y: primitive.center.y + primitive.radius })
  }
  return boundsForPoints(points)
}

function svgPoints(primitive: Exclude<ProjectedPrimitive, { kind: "point" }>): string {
  return primitive.points.map((point) => `${point.x},${-point.y}`).join(" ")
}

function sourceLabel(document: GeometryDocument, sourceId: string): string {
  const primitive = document.primitives.find((candidate) => candidate.id === sourceId)
  return primitive?.label ? `${primitive.label} (${sourceId})` : sourceId
}

function sourceInteraction(sourceId: string, selected: boolean, label: string, onSelect: DrawingViewportProps["onSelect"]) {
  return {
    "aria-label": `选择 ${label}`,
    "aria-pressed": selected,
    "data-selected": selected ? "true" : "false",
    "data-source-id": sourceId,
    role: "button" as const,
    tabIndex: 0,
    onClick: (event: ReactMouseEvent<SVGGElement>) => {
      event.stopPropagation()
      onSelect(sourceId, event.shiftKey)
    },
    onKeyDown: (event: ReactKeyboardEvent<SVGGElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return
      event.preventDefault()
      onSelect(sourceId, event.shiftKey)
    }
  }
}

function renderProjectedPrimitive(primitive: ProjectedPrimitive, bounds: DrawingBounds, document: GeometryDocument, selectedIds: string[], onSelect: DrawingViewportProps["onSelect"]) {
  const selected = selectedIds.includes(primitive.sourceId)
  const label = sourceLabel(document, primitive.sourceId)
  const interaction = sourceInteraction(primitive.sourceId, selected, label, onSelect)
  const className = `engineering-drawing-primitive engineering-drawing-${primitive.kind}${selected ? " is-selected" : ""}`
  const pointRadius = Math.max(bounds.width, bounds.height) * drawingMetrics.pointRadiusRatio
  if (primitive.kind === "point") return <g key={primitive.sourceId} className={className} {...interaction}><circle cx={primitive.point.x} cy={-primitive.point.y} r={pointRadius} /></g>
  if (primitive.kind === "polygon") return <g key={primitive.sourceId} className={className} {...interaction}><polygon points={svgPoints(primitive)} /></g>
  return <g key={primitive.sourceId} className={className} {...interaction}><polyline points={svgPoints(primitive)} /></g>
}

function renderAnnotation(annotation: ProjectedDrawing["annotations"][number]) {
  if (!annotation.position) return null
  return <g key={annotation.id} className={`engineering-drawing-annotation engineering-drawing-annotation-${annotation.status}`} data-testid="engineering-annotation" data-annotation-id={annotation.id} data-status={annotation.status} data-source-ids={annotation.sourceIds.join(",")}><text x={annotation.position.x} y={-annotation.position.y}>{annotation.text}</text></g>
}

function renderInvalidAnnotation(annotation: ProjectedDrawing["annotations"][number]) {
  if (annotation.position) return null
  return <div key={annotation.id} className={`engineering-drawing-annotation engineering-drawing-annotation-${annotation.status}`} data-testid="engineering-annotation" data-annotation-id={annotation.id} data-status={annotation.status}>{annotation.id}: {annotation.status} · {annotation.explanation}</div>
}

/** Draft primitives reuse the P7 selection contract: the payload stays the stable document object id. */
function renderDraftPrimitive(primitive: PrimitiveSpec, bounds: DrawingBounds, selectedIds: string[], onSelect: DrawingViewportProps["onSelect"]) {
  const selected = selectedIds.includes(primitive.id)
  const label = `${(primitive as { label?: string }).label ?? primitive.id}`
  const interaction = sourceInteraction(primitive.id, selected, label, onSelect)
  const className = `engineering-drawing-primitive engineering-drawing-draft engineering-drawing-draft-${primitive.type}${selected ? " is-selected" : ""}`
  const pointRadius = Math.max(bounds.width, bounds.height) * drawingMetrics.pointRadiusRatio
  const wrap = (child: React.ReactNode) => <g key={primitive.id} className={className} data-primitive-id={primitive.id} {...interaction}>{child}</g>

  if (primitive.type === "point") return wrap(<circle cx={primitive.x} cy={-primitive.y} r={pointRadius} />)
  if (primitive.type === "circle") return wrap(<circle cx={primitive.center.x} cy={-primitive.center.y} r={primitive.radius} />)
  if (primitive.type === "arc") {
    const steps = 24
    const points: string[] = []
    for (let index = 0; index <= steps; index += 1) {
      const angle = primitive.startAngle + (primitive.endAngle - primitive.startAngle) * (index / steps)
      points.push(`${primitive.center.x + primitive.radius * Math.cos(angle)},${-(primitive.center.y + primitive.radius * Math.sin(angle))}`)
    }
    return wrap(<polyline points={points.join(" ")} />)
  }
  if (primitive.type === "polyline") return wrap(<polyline points={primitive.points.map((point) => `${point.x},${-point.y}`).join(" ")} />)
  if (primitive.type === "line") {
    const dx = primitive.b.x - primitive.a.x
    const dy = primitive.b.y - primitive.a.y
    const length = Math.hypot(dx, dy) || 1
    const reach = Math.max(bounds.width, bounds.height) * 2
    const from = { x: primitive.a.x - (dx / length) * reach, y: primitive.a.y - (dy / length) * reach }
    const to = { x: primitive.b.x + (dx / length) * reach, y: primitive.b.y + (dy / length) * reach }
    return wrap(<line x1={from.x} y1={-from.y} x2={to.x} y2={-to.y} />)
  }
  if (primitive.type === "ray") {
    const dx = primitive.b.x - primitive.a.x
    const dy = primitive.b.y - primitive.a.y
    const length = Math.hypot(dx, dy) || 1
    const reach = Math.max(bounds.width, bounds.height) * 2
    const to = { x: primitive.b.x + (dx / length) * reach, y: primitive.b.y + (dy / length) * reach }
    return wrap(<line x1={primitive.a.x} y1={-primitive.a.y} x2={to.x} y2={-to.y} />)
  }
  if (primitive.type === "segment") return wrap(<line x1={primitive.a.x} y1={-primitive.a.y} x2={primitive.b.x} y2={-primitive.b.y} />)
  return null
}

export function DrawingViewport({ view, sheetName, mode, document, selectedIds, active = false, projectedDrawing = null, projectionLinesOverride, onSelect, onActivate, onLayoutChange, onCreateAt }: DrawingViewportProps) {
  const label = drawingViewLabels[view.kind]
  const title = `${sheetName} · ${label}`
  const draftPrimitives = mode === "draft" ? visiblePlanarPrimitives(document) : []
  const bounds = mode === "draft" ? draftBounds(document) : projectedDrawing ? viewBounds(projectedDrawing) : boundsForPoints([])
  const showProjectionLines = mode === "projection" && (projectionLinesOverride ?? view.showProjectionLines)
  const hasDrawingContent = mode === "draft"
    ? draftPrimitives.length > 0
    : Boolean(projectedDrawing && (projectedDrawing.primitives.length > 0 || projectedDrawing.annotations.some((annotation) => annotation.position)))
  const statusText = mode === "draft"
    ? `${draftPrimitives.length} 个二维图元`
    : projectedDrawing && projectedDrawing.primitives.length > 0 ? `${projectedDrawing.primitives.length} 个图元` : "空视图"
  const changeScale = (delta: number) => onLayoutChange?.(view.id, { scale: Math.max(0.1, Number((view.scale + delta).toFixed(2))) })

  const handleSvgClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (mode !== "draft" || !onCreateAt) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const x = bounds.minX + ((event.clientX - rect.left) / rect.width) * bounds.width
    const y = -(bounds.minY + ((event.clientY - rect.top) / rect.height) * bounds.height)
    onCreateAt({ x, y })
  }

  return <section
    className={`engineering-drawing-panel drawing-viewport${active ? " is-active" : ""}`}
    role="region"
    aria-label={title}
    title={title}
    data-drawing-view={view.kind}
    data-view-id={view.id}
    data-viewport-mode={mode}
    data-active={active ? "true" : "false"}
    data-view-visible={view.visible === false ? "false" : "true"}
    onFocusCapture={() => onActivate?.(view.id)}
    onMouseDown={() => onActivate?.(view.id)}
  >
    <div className="drawing-viewport-heading">
      <div className="drawing-viewport-label"><span>工程视图</span><h3>{label}</h3></div>
      <span className="engineering-drawing-panel-status">{statusText}</span>
      <div className="drawing-viewport-actions">
        <button type="button" aria-label={`缩小 ${label}`} disabled={view.scale <= 0.1} onClick={() => changeScale(-0.5)}>−</button>
        <button type="button" aria-label={`放大 ${label}`} onClick={() => changeScale(0.5)}>＋</button>
        <button className="icon-button" type="button" aria-label={`${view.visible === false ? "显示" : "隐藏"} ${label}`} aria-pressed={view.visible === false} onClick={() => onLayoutChange?.(view.id, { visible: view.visible === false })}><TreeEyeIcon visible={view.visible !== false} /></button>
      </div>
    </div>
    {/* 未物化的视图不画坐标轴：四个空框已经由标题的「空视图」说明，重复的占位文字只会变成噪声。 */}
    {(mode === "draft" || hasDrawingContent) && <svg className="engineering-drawing-svg" viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`} role="img" aria-label={`${title}投影视图`} data-viewport-mode={mode} onClick={handleSvgClick}>
      <g className="engineering-drawing-axes" aria-hidden="true"><line x1={bounds.minX} y1="0" x2={bounds.minX + bounds.width} y2="0" /><line x1="0" y1={bounds.minY} x2="0" y2={bounds.minY + bounds.height} /></g>
      {showProjectionLines && projectedDrawing && <g className="engineering-drawing-projection-lines" aria-hidden="true">{projectedDrawing.projectionLines.map((line) => <line key={`${line.sourceId}-${line.targetView}`} data-testid="projection-line" data-source-id={line.sourceId} data-origin-view={line.originView} data-target-view={line.targetView} x1={line.from.x} y1={-line.from.y} x2={line.to.x} y2={-line.to.y} />)}</g>}
      <g className="engineering-drawing-primitives">{mode === "draft" ? draftPrimitives.map((primitive) => renderDraftPrimitive(primitive, bounds, selectedIds, onSelect)) : (projectedDrawing?.primitives ?? []).map((primitive) => renderProjectedPrimitive(primitive, bounds, document, selectedIds, onSelect))}</g>
      {mode === "projection" && <g className="engineering-drawing-annotations">{(projectedDrawing?.annotations ?? []).map(renderAnnotation)}</g>}
    </svg>}
    {/* The drafting surface stays clickable while empty so the first 2D object can be placed. */}
    {!hasDrawingContent && <p className="engineering-drawing-empty" role="status">{mode === "draft" ? "当前图层还没有二维图元" : "暂无可投影的空间对象"}</p>}
    {mode === "projection" && <div className="engineering-drawing-annotation-statuses">{(projectedDrawing?.annotations ?? []).map(renderInvalidAnnotation)}</div>}
    {mode === "projection" && projectedDrawing && projectedDrawing.diagnostics.length > 0 && <details className="engineering-drawing-diagnostics"><summary>诊断 {projectedDrawing.diagnostics.length} 条</summary><ul>{projectedDrawing.diagnostics.map((diagnostic) => <li key={diagnostic}>{diagnostic}</li>)}</ul></details>}
  </section>
}
