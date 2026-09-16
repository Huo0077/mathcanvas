import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"

import type { DrawingSheetSpec, DrawingViewSpec, GeometryDocument } from "@draw/dsl"

import { sheetFitScale, sheetPaperSize } from "../drawingGeometry"
import type { ProjectedDrawing } from "../projectionVisuals"
import type { DrawingViewPatch, DrawingViewportMode, DraftCreation } from "./DrawingViewport"
import { DrawingViewport } from "./DrawingViewport"
import type { DragAction } from "../interaction"
import type { BoxSelectionMode, SelectionBox } from "@draw/geometry-kernel"

interface DrawingSheetViewProps {
  sheet: DrawingSheetSpec
  views: DrawingViewSpec[]
  document: GeometryDocument
  selectedIds: string[]
  mode: DrawingViewportMode
  projectedDrawings?: ProjectedDrawing[]
  activeViewId?: string | null
  projectionLinesOverride?: boolean
  /** 进行中的二维创建步骤，用于在绘图视口里画橡皮筋预览。 */
  creation?: DraftCreation | null
  /** 夹点拖动提交（与数学画布共用 DragAction 语义）。 */
  onDragEnd?: (id: string, action: DragAction) => void
  /** 框选提交：方向决定语义（左→右完全包含 / 右→左相交）。 */
  onBoxSelect?: (box: SelectionBox, mode: BoxSelectionMode) => void
  /** Command slot rendered on the left of the sheet toolbar, so the whole CAD area has exactly one toolbar. */
  projectionLinesControl?: ReactNode
  ariaLabel?: string
  onSelect: (id: string | null, additive?: boolean) => void
  onViewSelect?: (viewId: string) => void
  onViewLayoutChange?: (viewId: string, patch: DrawingViewPatch) => void
  onCreateAt?: (coordinate: { x: number; y: number }) => void
}

/** The paper always contains every placed view, so a moved or scaled viewport is never clipped away. */
export function DrawingSheetView({ sheet, views, document, selectedIds, mode, projectedDrawings = [], activeViewId = null, projectionLinesOverride, creation = null, onDragEnd, onBoxSelect, projectionLinesControl, ariaLabel = "工程制图视图", onSelect, onViewSelect, onViewLayoutChange, onCreateAt }: DrawingSheetViewProps) {
  const paper = useMemo(() => sheetPaperSize(sheet, views), [sheet, views])
  const { width: paperWidth, height: paperHeight } = paper
  const [fit, setFit] = useState(1)
  /** User zoom on top of "fit". Fit alone is silent and can look like an accidental blow-up; this gives it a handle. */
  const [zoom, setZoom] = useState(1)
  const [wrapper, setWrapper] = useState<HTMLDivElement | null>(null)
  const scale = fit * zoom
  const zoomPercent = Math.round(scale * 100)
  const stepZoom = (factor: number) => setZoom((current) => Math.min(4, Math.max(0.25, Number((current * factor).toFixed(3)))))

  // A different sheet or paper size re-fits from scratch rather than keeping a stale user zoom.
  useEffect(() => {
    setZoom(1)
  }, [paperWidth, paperHeight])

  /**
   * The A4 sheet is smaller than most work areas, so it is zoomed to fit instead of floating in the middle.
   * The factor comes from the layout box and is uniform, so the drawing keeps its proportions. The area keeps
   * a margin of its own, which is what turns "zoomed past fit" into a scrollable sheet instead of a crop.
   */
  const measure = useCallback(() => {
    if (!wrapper) return
    const style = getComputedStyle(wrapper)
    const padding = { x: parseFloat(style.paddingLeft) + parseFloat(style.paddingRight), y: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) }
    const available = {
      width: wrapper.clientWidth - (Number.isFinite(padding.x) ? padding.x : 0),
      height: wrapper.clientHeight - (Number.isFinite(padding.y) ? padding.y : 0)
    }
    // Clamped so a collapsed or momentarily unmeasured box cannot produce an absurd zoom.
    const next = Math.min(4, Math.max(0.2, sheetFitScale(available, { width: paperWidth, height: paperHeight })))
    setFit((current) => Math.abs(current - next) > 0.002 ? next : current)
  }, [wrapper, paperWidth, paperHeight])

  useEffect(() => {
    if (!wrapper) return
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
    measure()
    observer?.observe(wrapper)
    return () => observer?.disconnect()
  }, [wrapper, measure])

  // The area can change size without a resize of itself (the toolbar wrapping, a scrollbar appearing), so the
  // fit is re-measured whenever its own box changes.
  useEffect(() => {
    measure()
  }, [measure, wrapper?.clientWidth, wrapper?.clientHeight])

  const drawingByView = useMemo(() => {
    const map = new Map<string, ProjectedDrawing>()
    for (const drawing of projectedDrawings) {
      const match = views.find((view) => view.kind === drawing.view)
      if (match) map.set(match.id, drawing)
    }
    return map
  }, [projectedDrawings, views])

  return <main className="engineering-drawing" aria-label={ariaLabel} data-sheet-id={sheet.id}>
    <div className="engineering-drawing-toolbar">
      <div className="drawing-toolbar-group" role="group" aria-label="图纸显示">
        {projectionLinesControl}
        <button type="button" aria-label="适应图纸" disabled={zoom === 1} onClick={() => setZoom(1)}>适应窗口</button>
        <button type="button" aria-label="缩小图纸" disabled={scale <= 0.26} onClick={() => stepZoom(1 / 1.25)}>−</button>
        <button type="button" aria-label="放大图纸" disabled={scale >= 3.99} onClick={() => stepZoom(1.25)}>＋</button>
      </div>
      <span className="drawing-zoom-readout" data-sheet-zoom={zoomPercent} aria-live="polite">显示<strong>{zoomPercent}%</strong></span>
    </div>
    <div className="drawing-sheet-area" ref={setWrapper} data-zoomed={zoom > 1.001 ? "true" : "false"}>
      <div className="drawing-sheet" data-paper={sheet.paper} data-orientation={sheet.orientation} data-sheet-fit={fit.toFixed(3)} data-sheet-scale={scale.toFixed(3)} style={{ width: `${paper.width}px`, height: `${paper.height}px`, zoom: scale }}>
        <div className="drawing-sheet-frame" aria-hidden="true" />
        <div className="drawing-sheet-title-block">
          <strong>{sheet.name}</strong>
          <span>图幅 {sheet.paper}{sheet.orientation === "landscape" ? " 横" : " 纵"}</span>
          <span>比例 1:{sheet.scale}</span>
          <span>{views.length} 视图</span>
          <span>显示 {Math.round(scale * 100)}%</span>
        </div>
        <div className="drawing-sheet-views">
          {views.filter((view) => view.visible !== false).map((view) => <div
            key={view.id}
            className="drawing-viewport-slot"
            data-view-id={view.id}
            data-hidden={view.visible === false ? "true" : "false"}
            style={{ left: `${view.x + view.width / 2}px`, top: `${view.y + view.height / 2}px`, width: `${view.width}px`, height: `${view.height}px` }}
          >
            <DrawingViewport
              view={view}
              sheetName={sheet.name}
              mode={mode}
              document={document}
              selectedIds={selectedIds}
              active={view.id === activeViewId}
              projectedDrawing={drawingByView.get(view.id) ?? null}
              creation={creation}
              projectionLinesOverride={projectionLinesOverride}
              onSelect={onSelect}
              onActivate={onViewSelect}
              onLayoutChange={onViewLayoutChange}
              onCreateAt={onCreateAt}
              onDragEnd={onDragEnd}
              onBoxSelect={onBoxSelect}
            />
          </div>)}
        </div>
      </div>
    </div>
  </main>
}
