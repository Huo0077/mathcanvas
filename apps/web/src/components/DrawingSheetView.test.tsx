import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { createEmptyDocument, type DrawingSheetSpec, type DrawingViewSpec, type GeometryDocument } from "@draw/dsl"

import { resolveProjectedDrawing } from "../projectionVisuals"
import { sheetPaperSize } from "../drawingGeometry"
import { DrawingSheetView } from "./DrawingSheetView"

const sheet: DrawingSheetSpec = { id: "sheet-1", name: "工程图纸", paper: "A4", orientation: "landscape", scale: 1, viewIds: ["view-front", "view-top"] }

const views: DrawingViewSpec[] = [
  { id: "view-front", kind: "front", x: 20, y: 20, width: 300, height: 220, scale: 1, visible: true, showProjectionLines: false },
  { id: "view-top", kind: "top", x: 340, y: 20, width: 300, height: 220, scale: 2, visible: true, showProjectionLines: false }
]

function pointDocument(): GeometryDocument {
  return { ...createEmptyDocument("cad"), primitives: [{ id: "point3-1", type: "point3", position: { x: 2, y: 3, z: 4 }, label: "A" }] }
}

function renderSheet(overrides: { document?: GeometryDocument; activeViewId?: string | null } = {}) {
  const document = overrides.document ?? pointDocument()
  const handlers = { onSelect: vi.fn(), onViewSelect: vi.fn(), onViewLayoutChange: vi.fn(), onCreateAt: vi.fn() }
  render(<DrawingSheetView
    sheet={sheet}
    views={views}
    document={document}
    selectedIds={[]}
    mode="projection"
    projectedDrawings={[resolveProjectedDrawing(document, "front"), resolveProjectedDrawing(document, "top")]}
    activeViewId={overrides.activeViewId ?? null}
    {...handlers}
  />)
  return handlers
}

describe("drawing sheet view", () => {
  it("renders paper bounds, a title block and one viewport per view", () => {
    renderSheet()

    const paper = document.querySelector(".drawing-sheet") as HTMLElement
    expect(paper.dataset.paper).toBe("A4")
    expect(paper.dataset.orientation).toBe("landscape")
    expect(paper.style.width).toBe(`${sheetPaperSize(sheet, views).width}px`)

    const titleBlock = document.querySelector(".drawing-sheet-title-block") as HTMLElement
    expect(titleBlock.textContent).toContain("工程图纸")
    expect(titleBlock.textContent).toContain("A4 · 横向")
    expect(titleBlock.textContent).toContain("2 个视图")

    expect(document.querySelectorAll(".drawing-viewport-slot")).toHaveLength(2)
    expect(screen.getByRole("region", { name: "工程图纸 · 主视图" })).toBeTruthy()
    expect(screen.getByRole("region", { name: "工程图纸 · 俯视图" })).toBeTruthy()
  })

  it("places each viewport at its persisted rectangle", () => {
    renderSheet()

    const slot = document.querySelector('.drawing-viewport-slot[data-view-id="view-top"]') as HTMLElement
    expect(slot.style.left).toBe("340px")
    expect(slot.style.top).toBe("20px")
    expect(slot.style.width).toBe("300px")
    expect(slot.style.height).toBe("220px")
  })

  it("marks the active viewport and reports selection", () => {
    const bound = renderSheet({ activeViewId: "view-top" })

    expect(document.querySelector('.drawing-viewport[data-view-id="view-top"]')?.getAttribute("data-active")).toBe("true")

    fireEvent.mouseDown(screen.getByRole("region", { name: "工程图纸 · 主视图" }))
    expect(bound.onViewSelect).toHaveBeenCalledWith("view-front")
  })

  it("routes layout changes back with the view id", () => {
    const bound = renderSheet()

    fireEvent.click(screen.getByRole("button", { name: "放大 俯视图" }))
    expect(bound.onViewLayoutChange).toHaveBeenCalledWith("view-top", { scale: 2.5 })
  })

  it("keeps the paper large enough for views that were moved outwards", () => {
    const moved = [{ ...views[0], x: 700, y: 500 }]
    const paper = sheetPaperSize(sheet, moved)

    expect(paper.width).toBeGreaterThanOrEqual(700 + moved[0].width)
    expect(paper.height).toBeGreaterThanOrEqual(500 + moved[0].height)
  })
})
