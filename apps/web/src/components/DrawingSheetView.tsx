import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import type { DrawingSheetSpec, DrawingViewSpec, GeometryDocument } from "@draw/dsl"

import { sheetFitScale, sheetPaperSize } from "../drawingGeometry"
import type { ProjectedDrawing } from "../projectionVisuals"
import type { DrawingViewPatch, DrawingViewportMode, DraftControls, DraftCreation } from "./DrawingViewport"
import { DrawingViewport } from "./DrawingViewport"
import type { DragAction } from "../interaction"
import type { BoxSelectionMode, SelectionBox } from "@draw/geometry-kernel"
import type { GeometryEditRequest } from "../draftEditing"

/**
 * 2D 绘图的命令区。状态与落点逻辑都在 `DrawingViewport`（它需要 svg 的实时矩形来解析指针），这里只负责
 * 把它渲染到图纸之外：坐标 / 动态输入 / 角度约束 / 栅格捕捉 / 偏移-修剪-延伸。
 */
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
  /** 偏移 / 修剪 / 延伸请求。 */
  onEditSelected?: (request: GeometryEditRequest) => void
  /** 空视图时给出的下一步操作（例如"改为投影立体几何的模型"）。 */
  emptyStateAction?: { label: string; onClick: () => void } | null
  /** 空状态文案；投影来源不同，"空"的原因也不同。 */
  emptyMessage?: string
  /** Command slot rendered on the left of the sheet toolbar, so the whole CAD area has exactly one toolbar. */
  projectionLinesControl?: ReactNode
  /**
   * 可选的外部观察者：命令区状态变化时回调（测试与调试用）。
   * 注意与内部 `setDraftControls` 区分：图纸自己持有这份状态并渲染工具条，外部不参与渲染。
   */
  onDraftControlsChange?: (controls: DraftControls | null) => void
  /**
   * 渲染命令区的插槽。返回 null 表示"外层自己别处渲染"（此时视口也不在纸内渲染，见 `draftControlsHandledExternally`）。
   * 之所以是插槽而不是让 App 自己塞一条工具栏：图纸区按 `--drawing-toolbar-height` 定位，多一条高度不定的工具栏
   * 会把图纸挤到只剩一条缝（实测纸张因此被算成 20% 缩放）。
   */
  draftControlsSlot?: (controls: DraftControls) => ReactNode
  /** 外层已经负责渲染命令区：视口不再在图纸内渲染一份（避免出现两份输入框）。 */
  draftControlsHandledExternally?: boolean
  ariaLabel?: string
  onSelect: (id: string | null, additive?: boolean) => void
  onViewSelect?: (viewId: string) => void
  onViewLayoutChange?: (viewId: string, patch: DrawingViewPatch) => void
  onCreateAt?: (coordinate: { x: number; y: number }) => void
}

/** The paper always contains every placed view, so a moved or scaled viewport is never clipped away. */
export function DrawingSheetView({ sheet, views, document, selectedIds, mode, projectedDrawings = [], activeViewId = null, projectionLinesOverride, creation = null, onDragEnd, onBoxSelect, onEditSelected, projectionLinesControl, onDraftControlsChange, draftControlsSlot, emptyStateAction = null, emptyMessage, draftControlsHandledExternally = false, ariaLabel = "工程制图视图", onSelect, onViewSelect, onViewLayoutChange, onCreateAt }: DrawingSheetViewProps) {
  const paper = useMemo(() => sheetPaperSize(sheet, views), [sheet, views])
  const { width: paperWidth, height: paperHeight } = paper
  const [fit, setFit] = useState(1)
  /** 2D 绘图命令区：由活动绘图视口上报，渲染在这条图纸之外的工具栏里。 */
  const [draftControls, setDraftControls] = useState<DraftControls | null>(null)
  const publishDraftControls = useCallback((controls: DraftControls | null) => {
    setDraftControls(controls)
    onDraftControlsChange?.(controls)
  }, [onDraftControlsChange])
  /** User zoom on top of "fit". Fit alone is silent and can look like an accidental blow-up; this gives it a handle. */
  const [zoom, setZoom] = useState(1)
  const [wrapper, setWrapper] = useState<HTMLDivElement | null>(null)
  /** 最近一次 fit 用的可用尺寸，写在纸上便于排查"纸张为什么这么小"。 */
  const availableRef = useRef({ width: 0, height: 0 })
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
    availableRef.current = available
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
        {draftControls && draftControlsSlot ? draftControlsSlot(draftControls) : null}
        {projectionLinesControl}
        <button type="button" aria-label="适应图纸" disabled={zoom === 1} onClick={() => setZoom(1)}>适应窗口</button>
        <button type="button" aria-label="缩小图纸" disabled={scale <= 0.26} onClick={() => stepZoom(1 / 1.25)}>−</button>
        <button type="button" aria-label="放大图纸" disabled={scale >= 3.99} onClick={() => stepZoom(1.25)}>＋</button>
      </div>
      <span className="drawing-zoom-readout" data-sheet-zoom={zoomPercent} aria-live="polite">显示<strong>{zoomPercent}%</strong></span>
    </div>
    <div className="drawing-sheet-area" ref={setWrapper} data-zoomed={zoom > 1.001 ? "true" : "false"}>
      <div className="drawing-sheet" data-paper={sheet.paper} data-orientation={sheet.orientation} data-sheet-fit={fit.toFixed(3)} data-sheet-scale={scale.toFixed(3)} data-sheet-available={`${Math.round(availableRef.current.width)}x${Math.round(availableRef.current.height)}`} style={{ width: `${paper.width}px`, height: `${paper.height}px`, zoom: scale }}>
        <div className="drawing-sheet-frame" aria-hidden="true" />
        <div className="drawing-sheet-title-block">
          <strong>{sheet.name}</strong>
          <span>图幅 {sheet.paper}{sheet.orientation === "landscape" ? " 横" : " 纵"}</span>
          <span>比例 1:{sheet.scale}</span>
          <span>{views.length} 视图</span>
          <span>显示 {Math.round(scale * 100)}%</span>
        </div>
        <div className="drawing-sheet-views">
          {views.filter((view) => view.visible !== false).map((view, index) => <div
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
              emptyStateAction={emptyStateAction}
              emptyMessage={emptyMessage}
              onSelect={onSelect}
              onActivate={onViewSelect}
              onLayoutChange={onViewLayoutChange}
              onCreateAt={onCreateAt}
              onDragEnd={onDragEnd}
              onBoxSelect={onBoxSelect}
              onEditSelected={onEditSelected}
              onDraftControls={view.id === activeViewId || (activeViewId === null && index === 0) ? publishDraftControls : undefined}
              draftControlsHandledExternally={draftControlsHandledExternally || Boolean(draftControlsSlot)}
            />
          </div>)}
        </div>
      </div>
    </div>
  </main>
}
