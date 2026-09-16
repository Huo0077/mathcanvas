import type { DrawingSheetSpec, DrawingViewSpec } from "@draw/dsl"

const paperSizes: Record<DrawingSheetSpec["paper"], { width: number; height: number }> = {
  A4: { width: 594, height: 420 },
  A3: { width: 840, height: 594 },
  A2: { width: 1188, height: 840 },
  custom: { width: 594, height: 420 }
}

/**
 * Extra paper around the outermost view, on every side. The drawing frame is inset from this edge and the title
 * block sits inside the frame, so this margin is what keeps both of them off the views instead of overlapping.
 */
const sheetMargin = 100

/**
 * Paper size = the nominal sheet, grown only when a view would fall outside it. The drawing frame itself is
 * an inset on this rectangle (see `.drawing-sheet-frame`), so the nominal A4 block is the whole paper.
 */
export function sheetPaperSize(sheet: DrawingSheetSpec, views: DrawingViewSpec[]): { width: number; height: number } {
  const base = paperSizes[sheet.paper]
  const oriented = sheet.orientation === "portrait" ? { width: base.height, height: base.width } : base
  return {
    width: Math.max(oriented.width, ...views.map((view) => view.x + view.width), 0) + sheetMargin,
    height: Math.max(oriented.height, ...views.map((view) => view.y + view.height), 0) + sheetMargin
  }
}

/**
 * Uniform fit factor for the paper inside the drawing area. PDF-style zoom-to-fit: the paper keeps its aspect
 * ratio (a circle must stay a circle) and touches whichever side runs out first, so the sheet fills the canvas
 * instead of floating as a small card. A missing or degenerate container keeps the sheet at 1:1.
 */
export function sheetFitScale(available: { width: number; height: number }, paper: { width: number; height: number }): number {
  if (paper.width <= 0 || paper.height <= 0) return 1
  if (available.width <= 0 || available.height <= 0) return 1
  return Math.min(available.width / paper.width, available.height / paper.height)
}
