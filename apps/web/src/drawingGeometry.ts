import type { DrawingSheetSpec, DrawingViewSpec } from "@draw/dsl"

const paperSizes: Record<DrawingSheetSpec["paper"], { width: number; height: number }> = {
  A4: { width: 594, height: 420 },
  A3: { width: 840, height: 594 },
  A2: { width: 1188, height: 840 },
  custom: { width: 594, height: 420 }
}

const sheetMargin = 24

/** The paper always contains every placed view, so a moved or scaled viewport is never clipped away. */
export function sheetPaperSize(sheet: DrawingSheetSpec, views: DrawingViewSpec[]): { width: number; height: number } {
  const base = paperSizes[sheet.paper]
  const oriented = sheet.orientation === "portrait" ? { width: base.height, height: base.width } : base
  return {
    width: Math.max(oriented.width, ...views.map((view) => view.x + view.width), 0) + sheetMargin,
    height: Math.max(oriented.height, ...views.map((view) => view.y + view.height), 0) + sheetMargin
  }
}
