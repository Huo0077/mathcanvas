import { useMemo, useState } from "react"

import { createDefaultCadLayout, type DrawingSheetSpec, type GeometryDocument } from "@draw/dsl"

import { projectedDrawingForView } from "../projectionVisuals"
import { hasProjectableGeometry, projectionEmptyMessage, type ProjectionSource } from "../projectionSource"
import { DrawingSheetView } from "./DrawingSheetView"
import type { DrawingViewPatch } from "./DrawingViewport"

export type { ProjectionSource } from "../projectionSource"

interface EngineeringDrawingViewProps {
  document: GeometryDocument
  selectedIds: string[]
  activeViewId?: string | null
  /** 立体几何工作区的文档；有可投影内容时才提供，用于切换投影来源。 */
  spatialDocument?: GeometryDocument | null
  projectionSource?: ProjectionSource
  onProjectionSourceChange?: (source: ProjectionSource) => void
  onSelect: (id: string | null, additive?: boolean) => void
  onViewSelect?: (viewId: string) => void
  onViewLayoutChange?: (viewId: string, patch: DrawingViewPatch) => void
}

/** P7 继续投影四个正交视图；图纸布局是持久化文档状态，投影来源则可显式切换。 */
export function EngineeringDrawingView({ document, selectedIds, activeViewId = null, spatialDocument = null, projectionSource = "cad", onProjectionSourceChange, onSelect, onViewSelect, onViewLayoutChange }: EngineeringDrawingViewProps) {
  const [showProjectionLines, setShowProjectionLines] = useState(false)
  // 图纸布局（纸张、视图矩形）始终来自 CAD 文档，只有被投影的几何随来源切换。
  const layout = useMemo(() => createDefaultCadLayout(document), [document])
  const sheet: DrawingSheetSpec | null = layout.drawingSheets?.[0] ?? null
  const views = (layout.drawingViews ?? []).filter((view) => view.kind !== "model")
  const sourceDocument = projectionSource === "geometry3d" && spatialDocument ? spatialDocument : document
  const projectedDrawings = useMemo(() => views.map((view) => projectedDrawingForView(sourceDocument, view)).filter((drawing) => drawing !== null), [sourceDocument, views])
  const spatialHasGeometry = hasProjectableGeometry(spatialDocument)
  const cadHasGeometry = hasProjectableGeometry(document)
  const canSwitchSource = Boolean(spatialDocument && onProjectionSourceChange)

  const sourceControl = canSwitchSource
    ? <button
      type="button"
      data-projection-source={projectionSource}
      aria-pressed={projectionSource === "geometry3d"}
      title={spatialHasGeometry ? "四个视图投影立体几何工作区的模型；图纸布局仍属于当前 CAD 文档" : "立体几何工作区当前没有可投影的对象"}
      onClick={() => onProjectionSourceChange?.(projectionSource === "cad" ? "geometry3d" : "cad")}
    >{projectionSource === "cad" ? "投影来源：本图纸" : "投影来源：立体几何"}</button>
    : null

  // One toolbar for the whole CAD area: the sheet owns it and receives the projection controls as slots.
  if (!sheet) return null
  return <DrawingSheetView
    sheet={sheet}
    views={views}
    document={sourceDocument}
    selectedIds={selectedIds}
    mode="projection"
    projectedDrawings={projectedDrawings}
    activeViewId={activeViewId}
    projectionLinesOverride={showProjectionLines}
    projectionLinesControl={<>
      {sourceControl}
      <button type="button" aria-pressed={showProjectionLines} onClick={() => setShowProjectionLines((visible) => !visible)}>{showProjectionLines ? "隐藏投影线" : "显示投影线"}</button>
    </>}
    emptyStateAction={projectionSource === "cad" && !cadHasGeometry && spatialHasGeometry && canSwitchSource
      ? { label: "改为投影立体几何的模型", onClick: () => onProjectionSourceChange?.("geometry3d") }
      : null}
    emptyMessage={projectionEmptyMessage(projectionSource, cadHasGeometry, spatialHasGeometry)}
    onSelect={onSelect}
    onViewSelect={onViewSelect}
    onViewLayoutChange={onViewLayoutChange}
  />
}

/** 空视图提示：说明"看的是哪份文档"，并在另一份文档有内容时给出一键切换。 */
