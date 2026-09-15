import { useMemo } from "react"

import type { DrawingSheetSpec, DrawingViewSpec, GeometryDocument } from "@draw/dsl"

import { sheetPaperSize } from "../drawingGeometry"
import type { ProjectedDrawing } from "../projectionVisuals"
import { DrawingViewport, type DrawingViewPatch, type DrawingViewportMode } from "./DrawingViewport"

interface DrawingSheetViewProps {
  sheet: DrawingSheetSpec
  views: DrawingViewSpec[]
  document: GeometryDocument
  selectedIds: string[]
  mode: DrawingViewportMode
  projectedDrawings?: ProjectedDrawing[]
  activeViewId?: string | null
  projectionLinesOverride?: boolean
  ariaLabel?: string
  onSelect: (id: string | null, additive?: boolean) => void
  onViewSelect?: (viewId: string) => void
  onViewLayoutChange?: (viewId: string, patch: DrawingViewPatch) => void
  onCreateAt?: (coordinate: { x: number; y: number }) => void
}

/** The paper always contains every placed view, so a moved or scaled viewport is never clipped away. */
export function DrawingSheetView({ sheet, views, document, selectedIds, mode, projectedDrawings = [], activeViewId = null, projectionLinesOverride, ariaLabel = "工程制图视图", onSelect, onViewSelect, onViewLayoutChange, onCreateAt }: DrawingSheetViewProps) {
  const paper = useMemo(() => sheetPaperSize(sheet, views), [sheet, views])
  const drawingByView = useMemo(() => {
    const map = new Map<string, ProjectedDrawing>()
    for (const drawing of projectedDrawings) {
      const match = views.find((view) => view.kind === drawing.view)
      if (match) map.set(match.id, drawing)
    }
    return map
  }, [projectedDrawings, views])

  return <main className="engineering-drawing" aria-label={ariaLabel} data-sheet-id={sheet.id}>
    <div className="drawing-sheet" data-paper={sheet.paper} data-orientation={sheet.orientation} style={{ width: `${paper.width}px`, height: `${paper.height}px` }}>
      <div className="drawing-sheet-frame" aria-hidden="true" />
      <div className="drawing-sheet-title-block">
        <strong>{sheet.name}</strong>
        <span>{sheet.paper} · {sheet.orientation === "landscape" ? "横向" : "纵向"}</span>
        <span>图纸比例 {sheet.scale}</span>
        <span>{views.length} 个视图</span>
      </div>
      <div className="drawing-sheet-views">
        {views.filter((view) => view.visible !== false).map((view) => <div
          key={view.id}
          className="drawing-viewport-slot"
          data-view-id={view.id}
          data-hidden={view.visible === false ? "true" : "false"}
          style={{ left: `${view.x}px`, top: `${view.y}px`, width: `${view.width}px`, height: `${view.height}px` }}
        >
          <DrawingViewport
            view={view}
            sheetName={sheet.name}
            mode={mode}
            document={document}
            selectedIds={selectedIds}
            active={view.id === activeViewId}
            projectedDrawing={drawingByView.get(view.id) ?? null}
            projectionLinesOverride={projectionLinesOverride}
            onSelect={onSelect}
            onActivate={onViewSelect}
            onLayoutChange={onViewLayoutChange}
            onCreateAt={onCreateAt}
          />
        </div>)}
      </div>
    </div>
  </main>
}
