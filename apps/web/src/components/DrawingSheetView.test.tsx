import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { createEmptyDocument, type DrawingSheetSpec, type DrawingViewSpec, type GeometryDocument } from "@draw/dsl"

import { resolveProjectedDrawing } from "../projectionVisuals"
import { sheetFitScale, sheetPaperSize } from "../drawingGeometry"
import { DrawingSheetView } from "./DrawingSheetView"
import { DraftControlsRow, type DraftControls } from "./DraftControlsRow"

const sheet: DrawingSheetSpec = { id: "sheet-1", name: "工程图纸", paper: "A4", orientation: "landscape", scale: 1, viewIds: ["view-front", "view-top"] }

const views: DrawingViewSpec[] = [
  { id: "view-front", kind: "front", x: 20, y: 20, width: 300, height: 220, scale: 1, visible: true, showProjectionLines: false },
  { id: "view-top", kind: "top", x: 340, y: 20, width: 300, height: 220, scale: 2, visible: true, showProjectionLines: false }
]

function pointDocument(): GeometryDocument {
  return { ...createEmptyDocument("cad"), primitives: [{ id: "point3-1", type: "point3", position: { x: 2, y: 3, z: 4 }, label: "A" }] }
}

function renderSheet(overrides: { document?: GeometryDocument; activeViewId?: string | null; mode?: "projection" | "draft" } = {}) {
  const document = overrides.document ?? pointDocument()
  const handlers = { onSelect: vi.fn(), onViewSelect: vi.fn(), onViewLayoutChange: vi.fn(), onCreateAt: vi.fn(), onEditSelected: vi.fn() }
  /** 命令区渲染在这条图纸之外的工具栏里；用与 App 相同的插槽接上去，并用观察者记录上报的状态。 */
  const published: { current: DraftControls | null } = { current: null }
  const isDraft = overrides.mode === "draft"
  const view = render(<DrawingSheetView
    sheet={sheet}
    views={views}
    document={document}
    selectedIds={[]}
    mode={overrides.mode ?? "projection"}
    projectedDrawings={[resolveProjectedDrawing(document, "front"), resolveProjectedDrawing(document, "top")]}
    activeViewId={overrides.activeViewId ?? null}
    onDraftControlsChange={isDraft ? (controls) => { published.current = controls } : undefined}
    draftControlsSlot={isDraft ? (controls) => <DraftControlsRow controls={controls} /> : undefined}
    {...handlers}
  />)
  return { ...handlers, published, container: view.container }
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
    expect(titleBlock.textContent).toContain("图幅 A4 横")
    expect(titleBlock.textContent).toContain("2 视图")
    expect(titleBlock.textContent).toContain("显示 100%")

    expect(document.querySelectorAll(".drawing-viewport-slot")).toHaveLength(2)
    expect(screen.getByRole("region", { name: "工程图纸 · 主视图" })).toBeTruthy()
    expect(screen.getByRole("region", { name: "工程图纸 · 俯视图" })).toBeTruthy()
  })

  it("places each viewport rectangle by its centre so sheet scaling keeps it centred", () => {
    renderSheet()

    const slot = document.querySelector('.drawing-viewport-slot[data-view-id="view-top"]') as HTMLElement
    // The slot is translated by -50%/-50%, so left/top carry the rectangle centre, not its corner.
    expect(slot.style.left).toBe(`${340 + 300 / 2}px`)
    expect(slot.style.top).toBe(`${20 + 220 / 2}px`)
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

  it("zooms the paper to fit the drawing area instead of leaving it a small card", () => {
    // The paper is wider than the area allows, so the width is the binding constraint.
    expect(sheetFitScale({ width: 1000, height: 1000 }, { width: 500, height: 400 })).toBe(2)
    // Taller area than the paper needs: height would overflow first.
    expect(sheetFitScale({ width: 1000, height: 200 }, { width: 500, height: 400 })).toBe(0.5)
    // Shrinking below 1:1 is also a fit, so a small window still shows the whole sheet.
    expect(sheetFitScale({ width: 250, height: 400 }, { width: 500, height: 400 })).toBe(0.5)
  })

  it("falls back to 1:1 when the area or the paper has no measurable size", () => {
    expect(sheetFitScale({ width: 0, height: 0 }, { width: 500, height: 400 })).toBe(1)
    expect(sheetFitScale({ width: 800, height: 600 }, { width: 0, height: 400 })).toBe(1)
  })

  it("renders the fitted sheet inside a dedicated layout box", () => {
    renderSheet()

    const area = document.querySelector(".drawing-sheet-area") as HTMLElement
    const paper = document.querySelector(".drawing-sheet") as HTMLElement
    expect(area.contains(paper)).toBe(true)
    // jsdom has no layout, so the measured box is empty and the sheet stays at 1:1.
    expect(paper.dataset.sheetFit).toBe("1.000")
    expect(paper.style.zoom).toBe("1")
  })

  it("renders the drafting commands on the toolbar, never inside the paper", async () => {
    // The command row used to live inside the paper, where CSS zoom both scaled it and let it overlap the
    // canvas. It must render on the toolbar (outside .drawing-sheet-area) and never inside the sheet.
    // The row appears one effect pass after mount: the viewport publishes, then the toolbar renders it.
    const { published, container } = renderSheet({ mode: "draft" })

    // Scope to THIS render's container: the file mounts several sheets and every render stays in the DOM.
    const root = container.querySelector(".engineering-drawing") as HTMLElement
    const toolbar = root.querySelector(".engineering-drawing-toolbar") as HTMLElement
    const sheetArea = root.querySelector(".drawing-sheet-area") as HTMLElement

    await waitFor(() => expect(root.querySelectorAll('input[aria-label="坐标输入"]')).toHaveLength(1))
    const coordinate = root.querySelectorAll('input[aria-label="坐标输入"]')
    expect(toolbar.contains(coordinate[0])).toBe(true)
    expect(sheetArea.querySelectorAll('input[aria-label="坐标输入"]')).toHaveLength(0)
    expect(sheetArea.querySelector('[data-draft-edit="offset"]')).toBeNull()
    // ...and the viewport published its state so the toolbar could render it.
    expect(published.current).not.toBeNull()
    expect(typeof published.current?.submitCoordinate).toBe("function")
  })

  it("gives the automatic fit an explicit zoom the user can override and reset", () => {
    renderSheet()
    const paper = document.querySelector(".drawing-sheet") as HTMLElement
    const readout = document.querySelector("[data-sheet-zoom]") as HTMLElement
    const fitButton = screen.getByRole("button", { name: "适应图纸" }) as HTMLButtonElement

    expect(readout.getAttribute("data-sheet-zoom")).toBe("100")
    expect(fitButton.disabled).toBe(true)

    fireEvent.click(screen.getByRole("button", { name: "放大图纸" }))
    expect(paper.dataset.sheetScale).toBe("1.250")
    expect(paper.style.zoom).toBe("1.25")
    expect(readout.getAttribute("data-sheet-zoom")).toBe("125")
    expect(fitButton.disabled).toBe(false)

    // Leaving fit mode hands the area a grab cursor so the override is discoverable.
    expect((document.querySelector(".drawing-sheet-area") as HTMLElement).dataset.zoomed).toBe("true")

    fireEvent.click(screen.getByRole("button", { name: "缩小图纸" }))
    fireEvent.click(screen.getByRole("button", { name: "缩小图纸" }))
    expect(paper.dataset.sheetScale).toBe("0.800")

    fireEvent.click(fitButton)
    expect(paper.dataset.sheetScale).toBe("1.000")
    expect(readout.getAttribute("data-sheet-zoom")).toBe("100")
    expect((document.querySelector(".drawing-sheet-area") as HTMLElement).dataset.zoomed).toBe("false")
  })
})
