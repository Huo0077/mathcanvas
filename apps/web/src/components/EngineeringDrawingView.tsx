import { useMemo, useState } from "react"

import { createDefaultCadLayout, type DrawingSheetSpec, type GeometryDocument } from "@draw/dsl"

import { projectedDrawingForView } from "../projectionVisuals"
import { DrawingSheetView } from "./DrawingSheetView"
import type { DrawingViewPatch } from "./DrawingViewport"

interface EngineeringDrawingViewProps {
  document: GeometryDocument
  selectedIds: string[]
  activeViewId?: string | null
  onSelect: (id: string | null, additive?: boolean) => void
  onViewSelect?: (viewId: string) => void
  onViewLayoutChange?: (viewId: string, patch: DrawingViewPatch) => void
}

/** P7 keeps projecting the four orthographic views; the sheet layout is persisted but the source data is not copied. */
export function EngineeringDrawingView({ document, selectedIds, activeViewId = null, onSelect, onViewSelect, onViewLayoutChange }: EngineeringDrawingViewProps) {
  const [showProjectionLines, setShowProjectionLines] = useState(false)
  const layout = useMemo(() => createDefaultCadLayout(document), [document])
  const sheet: DrawingSheetSpec | null = layout.drawingSheets?.[0] ?? null
  const views = (layout.drawingViews ?? []).filter((view) => view.kind !== "model")
  const projectedDrawings = useMemo(() => views.map((view) => projectedDrawingForView(document, view)).filter((drawing) => drawing !== null), [document, views])

  return <>
    <div className="engineering-drawing-toolbar"><button type="button" aria-pressed={showProjectionLines} onClick={() => setShowProjectionLines((visible) => !visible)}>{showProjectionLines ? "隐藏投影线" : "显示投影线"}</button></div>
    {sheet && <DrawingSheetView
      sheet={sheet}
      views={views}
      document={document}
      selectedIds={selectedIds}
      mode="projection"
      projectedDrawings={projectedDrawings}
      activeViewId={activeViewId}
      projectionLinesOverride={showProjectionLines}
      onSelect={onSelect}
      onViewSelect={onViewSelect}
      onViewLayoutChange={onViewLayoutChange}
    />}
  </>
}
