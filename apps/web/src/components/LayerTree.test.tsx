import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { LayerSpec } from "@draw/dsl"

import { LayerTree } from "./LayerTree"

const layers: LayerSpec[] = [
  { id: "layer-geometry", name: "几何", kind: "geometry", visible: true, locked: false, printable: true },
  { id: "layer-detail", name: "细部", parentId: "layer-geometry", kind: "geometry", visible: true, locked: false, printable: true },
  { id: "layer-dimension", name: "尺寸", kind: "dimension", visible: false, locked: true, printable: true }
]

function renderLayerTree(overrides: { layers?: LayerSpec[]; expandedIds?: string[]; filter?: string } = {}) {
  const handlers = {
    onActivate: vi.fn(),
    onToggleVisibility: vi.fn(),
    onToggleLocked: vi.fn(),
    onAdd: vi.fn(),
    onDelete: vi.fn(),
    onToggleExpanded: vi.fn()
  }
  const view = render(<LayerTree
    layers={overrides.layers ?? layers}
    activeLayerId="layer-geometry"
    expandedIds={overrides.expandedIds ?? ["layer-geometry"]}
    filter={overrides.filter ?? ""}
    {...handlers}
  />)
  return { ...handlers, view }
}

describe("layer tree", () => {
  it("nests child layers inside their parent row", () => {
    renderLayerTree()

    const parentItem = screen.getByRole("button", { name: "几何" }).closest("li")
    const childItem = screen.getByRole("button", { name: "细部" }).closest("li")

    expect(parentItem?.querySelector('[data-layer-id="layer-detail"]')).toBeTruthy()
    expect(parentItem?.getAttribute("data-depth")).toBe("0")
    expect(childItem?.getAttribute("data-depth")).toBe("1")
    expect(screen.getByRole("button", { name: "尺寸" }).closest("li")?.getAttribute("data-depth")).toBe("0")
  })

  it("hides child layers while the parent is collapsed", () => {
    renderLayerTree({ expandedIds: [] })

    expect(screen.queryByRole("button", { name: "细部" })).toBeNull()
    expect(screen.getByRole("button", { name: "几何" })).toBeTruthy()
  })

  it("marks the active layer and reports activation", () => {
    const bound = renderLayerTree()

    expect(screen.getByRole("button", { name: "几何" }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("button", { name: "尺寸" }).getAttribute("aria-pressed")).toBe("false")

    fireEvent.click(screen.getByRole("button", { name: "尺寸" }))
    expect(bound.onActivate).toHaveBeenCalledWith("layer-dimension")
  })

  it("toggles subtree visibility and locking", () => {
    const bound = renderLayerTree()

    fireEvent.click(screen.getByRole("button", { name: "隐藏 几何" }))
    expect(bound.onToggleVisibility).toHaveBeenCalledWith("layer-geometry", false)

    fireEvent.click(screen.getByRole("button", { name: "解锁 尺寸" }))
    expect(bound.onToggleLocked).toHaveBeenCalledWith("layer-dimension", false)
  })

  it("filters layers by name", () => {
    renderLayerTree({ filter: "尺" })

    expect(screen.getByRole("button", { name: "尺寸" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "几何" })).toBeNull()
  })

  it("creates a root layer and a child layer under a parent", () => {
    const bound = renderLayerTree()

    fireEvent.click(screen.getByRole("button", { name: "新建图层" }))
    expect(bound.onAdd).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole("button", { name: "在 几何 下新建子图层" }))
    expect(bound.onAdd).toHaveBeenCalledWith("layer-geometry")
  })

  it("deletes a layer through the operation callback", () => {
    const bound = renderLayerTree()

    fireEvent.click(screen.getByRole("button", { name: "删除 尺寸" }))
    expect(bound.onDelete).toHaveBeenCalledWith("layer-dimension")
  })

  it("protects the last geometry layer from deletion", () => {
    const bound = renderLayerTree({ layers: [layers[0]] })

    const geometryDelete = screen.getByRole("button", { name: "删除 几何" }) as HTMLButtonElement
    expect(geometryDelete.disabled).toBe(true)
    expect(geometryDelete.title).toBe("至少保留一个几何图层")
    expect(bound.onDelete).not.toHaveBeenCalled()
  })
})
