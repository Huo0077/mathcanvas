import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { createEmptyDocument, type PrimitiveSpec } from "@draw/dsl"

import { useSceneStore } from "../store"
import { EngineeringInspector, type InspectorContext } from "./EngineeringInspector"
import type { PropertiesBarProps } from "./PropertiesBar"

const baseContext: InspectorContext = {
  sheetName: "工程图纸",
  viewName: "主视图",
  layerName: "几何",
  layerVisible: true,
  layerLocked: false,
  commandPrompt: "选择对象",
  unit: "mm"
}

function propertiesProps(overrides: Partial<PropertiesBarProps> = {}): PropertiesBarProps {
  return {
    value: 0.5,
    min: 0.15,
    max: 0.85,
    step: 0.05,
    onChange: vi.fn(),
    selectedPrimitive: null,
    selectedIds: [],
    selectedCount: 0,
    selectedGroupId: null,
    allSelectedVisible: true,
    canCreateIntersection: false,
    onUpdatePrimitive: vi.fn(),
    onToggleSelectedVisibility: vi.fn(),
    onToggleSelectedLock: vi.fn(),
    onCreateGroup: vi.fn(),
    onDeleteGroup: vi.fn(),
    onCreateIntersection: vi.fn(),
    onAlign: vi.fn(),
    onToggleBatchVisibility: vi.fn(),
    onAddAnnotation: vi.fn(),
    onAddEngineeringAnnotation: vi.fn(),
    onCreateMeasurement: vi.fn(),
    onCreateConstraint: vi.fn(),
    onDeleteMeasurement: vi.fn(),
    ...overrides
  }
}

function text(selector: string): string {
  return globalThis.document.querySelector(selector)?.textContent ?? ""
}

function renderInspector(options: { activeTab?: "data" | "appearance" | "constraints" | "engineering"; properties?: Partial<PropertiesBarProps>; context?: Partial<InspectorContext>; sources?: { id: string; label: string; missing: boolean }[] } = {}) {
  const onTabChange = vi.fn()
  render(<EngineeringInspector
    activeTab={options.activeTab ?? "data"}
    onTabChange={onTabChange}
    context={{ ...baseContext, ...options.context }}
    sources={options.sources ?? []}
    constraints={<div data-testid="constraints-slot">约束列表</div>}
    properties={propertiesProps(options.properties)}
  />)
  return { onTabChange }
}

describe("engineering inspector", () => {
  beforeEach(() => {
    const document = createEmptyDocument("cad")
    useSceneStore.setState({ document, workspaceDocuments: { cad: document }, history: [], future: [], previewBase: null, error: null })
  })

  it("shows sheet, view and layer context when nothing is selected", () => {
    renderInspector()

    expect(text('[data-context="sheet"]')).toContain("工程图纸")
    expect(text('[data-context="view"]')).toContain("主视图")
    expect(text('[data-context="layer"]')).toContain("几何")
    expect(text('[data-context="layer"]')).toContain("可编辑")
    expect(text('[data-context="command"]')).toContain("选择对象")
  })

  it("reports a hidden active layer instead of pretending it is editable", () => {
    renderInspector({ context: { layerVisible: false } })

    expect(text('[data-context="layer"]')).toContain("已隐藏")
  })

  it("shows the assigned layer of a selected 2D object", () => {
    const primitive: PrimitiveSpec = { id: "point-1", type: "point", x: 0, y: 0, label: "点 1", layerId: "layer-geometry" }
    renderInspector({ properties: { selectedPrimitive: primitive, selectedIds: ["point-1"], selectedCount: 1 }, context: { selectedLayerName: "几何" } })

    expect(text('[data-context="selected-layer"]')).toContain("几何")
    expect(globalThis.document.querySelector('[data-context="sheet"]')).toBeNull()
  })

  it("keeps multi-selection on batch actions without single-object fields", () => {
    renderInspector({ properties: { selectedIds: ["a", "b"], selectedCount: 2 } })

    expect(screen.getByText("批量编辑 · 2 个对象")).toBeTruthy()
    expect(screen.queryByLabelText("线条颜色")).toBeNull()
  })

  it("lists projection sources and marks deleted ones", () => {
    renderInspector({ sources: [{ id: "point3-1", label: "A", missing: false }, { id: "point3-gone", label: "point3-gone", missing: true }] })

    expect(screen.getByText("A (point3-1)")).toBeTruthy()
    expect(screen.getByText("来源已删除")).toBeTruthy()
    expect(globalThis.document.querySelector('[data-source-id="point3-gone"]')?.getAttribute("data-missing")).toBe("true")
  })

  it("puts constraint diagnostics on their own tab", () => {
    renderInspector({ activeTab: "constraints" })

    expect(screen.getByTestId("constraints-slot")).toBeTruthy()
    expect(globalThis.document.querySelector('[data-context="sheet"]')).toBeNull()
  })

  it("keeps engineering annotation actions on the engineering tab only", () => {
    const document = {
      ...createEmptyDocument("cad"),
      primitives: [
        { id: "point3-1", type: "point3" as const, position: { x: 0, y: 0, z: 0 }, label: "A" },
        { id: "point3-2", type: "point3" as const, position: { x: 3, y: 4, z: 0 }, label: "B" }
      ]
    }
    useSceneStore.setState({ document, workspaceDocuments: { cad: document } })
    const primitive = document.primitives[0]

    renderInspector({ properties: { selectedPrimitive: primitive, selectedIds: ["point3-1", "point3-2"], selectedCount: 2 } })
    expect(screen.queryByRole("button", { name: "Add linear annotation" })).toBeNull()

    renderInspector({ activeTab: "engineering", properties: { selectedPrimitive: primitive, selectedIds: ["point3-1", "point3-2"], selectedCount: 2 } })
    expect(screen.getAllByRole("button", { name: "Add linear annotation" }).length).toBeGreaterThan(0)
  })

  it("moves between tabs with the arrow keys", () => {
    const bound = renderInspector()

    fireEvent.keyDown(screen.getByRole("tablist", { name: "属性面板标签" }), { key: "ArrowRight" })
    expect(bound.onTabChange).toHaveBeenCalledWith("appearance")
  })

  it("switches tabs when a tab is clicked", () => {
    const bound = renderInspector()

    fireEvent.click(screen.getByRole("tab", { name: "约束" }))
    expect(bound.onTabChange).toHaveBeenCalledWith("constraints")
  })
})
