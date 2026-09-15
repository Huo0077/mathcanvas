import { type KeyboardEvent as ReactKeyboardEvent, useMemo, useState } from "react"
import type { GeometryDocument } from "@draw/dsl"

import { resolveProjectedDrawing, type ProjectedDrawing, type ProjectedPrimitive } from "../projectionVisuals"

interface EngineeringDrawingViewProps {
  document: GeometryDocument
  selectedIds: string[]
  onSelect: (id: string | null, additive?: boolean) => void
}

const viewDefinitions = [
  { view: "front" as const, label: "主视图" },
  { view: "top" as const, label: "俯视图" },
  { view: "left" as const, label: "左视图" },
  { view: "axonometric" as const, label: "轴测图" }
]

const drawingMetrics = {
  defaultMin: -4,
  defaultSpan: 8,
  paddingRatio: 0.12,
  minimumPadding: 0.6,
  pointRadiusRatio: 0.018
}

interface DrawingBounds {
  minX: number
  minY: number
  width: number
  height: number
}

function primitivePoints(primitive: ProjectedPrimitive) {
  return primitive.kind === "point" ? [primitive.point] : primitive.points
}

function viewBounds(drawing: ProjectedDrawing): DrawingBounds {
  const points = [
    ...drawing.primitives.flatMap(primitivePoints),
    ...drawing.projectionLines.flatMap((line) => [line.from, line.to])
  ]
  if (points.length === 0) return { minX: drawingMetrics.defaultMin, minY: drawingMetrics.defaultMin, width: drawingMetrics.defaultSpan, height: drawingMetrics.defaultSpan }
  const minX = Math.min(...points.map((point) => point.x))
  const maxX = Math.max(...points.map((point) => point.x))
  const minY = Math.min(...points.map((point) => point.y))
  const maxY = Math.max(...points.map((point) => point.y))
  const padding = Math.max((maxX - minX) * drawingMetrics.paddingRatio, (maxY - minY) * drawingMetrics.paddingRatio, drawingMetrics.minimumPadding)
  return { minX: minX - padding, minY: -(maxY + padding), width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 }
}

function svgPoints(primitive: Exclude<ProjectedPrimitive, { kind: "point" }>): string {
  return primitive.points.map((point) => `${point.x},${-point.y}`).join(" ")
}

function sourceLabel(document: GeometryDocument, sourceId: string): string {
  const primitive = document.primitives.find((candidate) => candidate.id === sourceId)
  return primitive?.label ? `${primitive.label} (${sourceId})` : sourceId
}

function sourceInteraction(sourceId: string, selected: boolean, label: string, onSelect: EngineeringDrawingViewProps["onSelect"]) {
  return {
    "aria-label": `选择 ${label}`,
    "aria-pressed": selected,
    "data-selected": selected ? "true" : "false",
    "data-source-id": sourceId,
    role: "button" as const,
    tabIndex: 0,
    onClick: (event: React.MouseEvent<SVGGElement>) => {
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

function renderPrimitive(primitive: ProjectedPrimitive, bounds: DrawingBounds, document: GeometryDocument, selectedIds: string[], onSelect: EngineeringDrawingViewProps["onSelect"]) {
  const selected = selectedIds.includes(primitive.sourceId)
  const label = sourceLabel(document, primitive.sourceId)
  const interaction = sourceInteraction(primitive.sourceId, selected, label, onSelect)
  const className = `engineering-drawing-primitive engineering-drawing-${primitive.kind}${selected ? " is-selected" : ""}`
  const pointRadius = Math.max(bounds.width, bounds.height) * drawingMetrics.pointRadiusRatio
  if (primitive.kind === "point") return <g key={primitive.sourceId} className={className} {...interaction}><circle cx={primitive.point.x} cy={-primitive.point.y} r={pointRadius} /></g>
  if (primitive.kind === "polygon") return <g key={primitive.sourceId} className={className} {...interaction}><polygon points={svgPoints(primitive)} /></g>
  return <g key={primitive.sourceId} className={className} {...interaction}><polyline points={svgPoints(primitive)} /></g>
}

function DrawingPanel({ definition, drawing, document, selectedIds, onSelect, showProjectionLines }: { definition: typeof viewDefinitions[number]; drawing: ProjectedDrawing; document: GeometryDocument; selectedIds: string[]; onSelect: EngineeringDrawingViewProps["onSelect"]; showProjectionLines: boolean }) {
  const bounds = viewBounds(drawing)
  const titleId = `engineering-drawing-title-${definition.view}`
  const hasPrimitives = drawing.primitives.length > 0
  return <section className="engineering-drawing-panel" data-drawing-view={definition.view} aria-labelledby={titleId}>
    <header className="engineering-drawing-panel-heading">
      <div><span className="panel-kicker">工程视图</span><h2 id={titleId}>{definition.label}</h2></div>
      <span className="engineering-drawing-panel-status">{hasPrimitives ? `${drawing.primitives.length} 个图元` : "空视图"}</span>
    </header>
    {hasPrimitives
      ? <svg className="engineering-drawing-svg" viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`} role="img" aria-label={`${definition.label}投影视图`}>
        <g className="engineering-drawing-axes" aria-hidden="true"><line x1={bounds.minX} y1="0" x2={bounds.minX + bounds.width} y2="0" /><line x1="0" y1={bounds.minY} x2="0" y2={bounds.minY + bounds.height} /></g>
        {showProjectionLines && <g className="engineering-drawing-projection-lines" aria-hidden="true">{drawing.projectionLines.map((line) => <line key={`${line.sourceId}-${line.targetView}`} data-testid="projection-line" data-source-id={line.sourceId} data-origin-view={line.originView} data-target-view={line.targetView} x1={line.from.x} y1={-line.from.y} x2={line.to.x} y2={-line.to.y} />)}</g>}
        <g className="engineering-drawing-primitives">{drawing.primitives.map((primitive) => renderPrimitive(primitive, bounds, document, selectedIds, onSelect))}</g>
      </svg>
      : <p className="engineering-drawing-empty" role="status">暂无可投影的空间对象</p>}
    {drawing.diagnostics.length > 0 && <details className="engineering-drawing-diagnostics"><summary>诊断 {drawing.diagnostics.length} 条</summary><ul>{drawing.diagnostics.map((diagnostic) => <li key={diagnostic}>{diagnostic}</li>)}</ul></details>}
  </section>
}

export function EngineeringDrawingView({ document, selectedIds, onSelect }: EngineeringDrawingViewProps) {
  const [showProjectionLines, setShowProjectionLines] = useState(false)
  const drawings = useMemo(() => viewDefinitions.map((definition) => ({ definition, drawing: resolveProjectedDrawing(document, definition.view) })), [document])
  return <main className="engineering-drawing" aria-label="工程制图视图"><div className="engineering-drawing-toolbar"><button type="button" aria-pressed={showProjectionLines} onClick={() => setShowProjectionLines((visible) => !visible)}>{showProjectionLines ? "隐藏投影线" : "显示投影线"}</button></div><div className="engineering-drawing-grid">{drawings.map(({ definition, drawing }) => <DrawingPanel key={definition.view} definition={definition} drawing={drawing} document={document} selectedIds={selectedIds} onSelect={onSelect} showProjectionLines={showProjectionLines} />)}</div></main>
}
