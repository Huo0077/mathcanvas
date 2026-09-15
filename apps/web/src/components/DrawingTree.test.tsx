import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { DrawingSheetSpec, DrawingViewSpec } from "@draw/dsl"

import { DrawingTree } from "./DrawingTree"

const sheets: DrawingSheetSpec[] = [
  { id: "sheet-1", name: "工程图纸", paper: "A4", orientation: "landscape", scale: 1, viewIds: ["view-front", "view-top"] }
]

const views: DrawingViewSpec[] = [
  { id: "view-front", kind: "front", x: 40, y: 40, width: 300, height: 220, scale: 1, visible: true, showProjectionLines: false, sourceIds: ["point3-1"] },
  { id: "view-top", kind: "top", x: 360, y: 40, width: 300, height: 220, scale: 2, visible: false, showProjectionLines: false }
]

const sourceLabels = { "point3-1": "A" }

function renderDrawingTree(overrides: { expandedIds?: string[]; filter?: string; activeViewId?: string | null } = {}) {
  const handlers = {
    onSelectSheet: vi.fn(),
    onSelectView: vi.fn(),
    onToggleView: vi.fn(),
    onToggleExpanded: vi.fn()
  }
  render(<DrawingTree
    sheets={sheets}
    views={views}
    activeSheetId="sheet-1"
    activeViewId={overrides.activeViewId ?? null}
    expandedIds={overrides.expandedIds ?? ["sheet-1"]}
    filter={overrides.filter ?? ""}
    sourceLabels={sourceLabels}
    {...handlers}
  />)
  return handlers
}

describe("drawing tree", () => {
  it("expands a sheet into view rows with kind, scale and source labels", () => {
    renderDrawingTree()

    const sheetItem = screen.getByRole("button", { name: "工程图纸" }).closest("li")
    expect(sheetItem?.querySelector('[data-view-id="view-front"]')).toBeTruthy()
    expect(screen.getByRole("button", { name: "主视图" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "俯视图" })).toBeTruthy()
    expect(screen.getByText("比例 2")).toBeTruthy()
    expect(screen.getByText("来源 A (point3-1)")).toBeTruthy()
    expect(screen.getByText("来源 全部空间对象")).toBeTruthy()
  })

  it("collapses a sheet and hides its view rows", () => {
    renderDrawingTree({ expandedIds: [] })

    expect(screen.getByRole("button", { name: "工程图纸" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "主视图" })).toBeNull()
  })

  it("selects a sheet and a view", () => {
    const bound = renderDrawingTree({ activeViewId: "view-front" })

    expect(screen.getByRole("button", { name: "工程图纸" }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("button", { name: "主视图" }).getAttribute("aria-pressed")).toBe("true")

    fireEvent.click(screen.getByRole("button", { name: "俯视图" }))
    expect(bound.onSelectView).toHaveBeenCalledWith("view-top")
  })

  it("toggles view visibility from the tree", () => {
    const bound = renderDrawingTree()

    fireEvent.click(screen.getByRole("button", { name: "隐藏 主视图" }))
    expect(bound.onToggleView).toHaveBeenCalledWith("view-front", false)

    fireEvent.click(screen.getByRole("button", { name: "显示 俯视图" }))
    expect(bound.onToggleView).toHaveBeenCalledWith("view-top", true)
  })

  it("filters views by kind and keeps sheets that still have matches", () => {
    renderDrawingTree({ filter: "俯视" })

    expect(screen.getByRole("button", { name: "俯视图" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "主视图" })).toBeNull()
  })
})
