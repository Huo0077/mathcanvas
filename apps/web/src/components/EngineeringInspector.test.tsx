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
    onDeleteMeasurement: vi.fn(),
    onCreateDerivative: vi.fn(),
    onCreateTangent: vi.fn(),
    onCreateIntegral: vi.fn(),
    ...overrides
  }
}

function text(selector: string): string {
  return globalThis.document.querySelector(selector)?.textContent ?? ""
}

function renderInspector(options: { activeTab?: "data" | "appearance" | "engineering"; properties?: Partial<PropertiesBarProps>; context?: Partial<InspectorContext>; sources?: { id: string; label: string; missing: boolean }[] } = {}) {
  const onTabChange = vi.fn()
  render(<EngineeringInspector
    activeTab={options.activeTab ?? "data"}
    onTabChange={onTabChange}
    context={{ ...baseContext, ...options.context }}
    sources={options.sources ?? []}
    properties={propertiesProps(options.properties)}
  />)
  return { onTabChange }
}

describe("engineering inspector", () => {
  beforeEach(() => {
    const document = createEmptyDocument("cad")
    useSceneStore.setState({ document, workspaceDocuments: { cad: document }, history: [], future: [], error: null })
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

  it("shows no constraint or agent UI in the CAD inspector", () => {
    renderInspector()

    expect(screen.queryByRole("tab", { name: "约束" })).toBeNull()
    expect(screen.queryByText("约束列表")).toBeNull()
    expect(screen.queryByText("智能体 (Agent)")).toBeNull()
  })

  /**
   * 用户口径："旁边增加一个数据转换功能，能够识别到图中的小数，并且在功能内输出分数形式，
   * 无理数也能输出，该功能入口在右侧属性栏最高处"。
   */
  it("lists an exact form for every valid measurement, above everything else", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [{ id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 2 }]
    document.measurements = [
      { id: "m-area", kind: "measurement3", sourceIds: ["circle-1"], metric: "area", value: Math.PI * 4, unit: "u²", precision: "numeric-approximation", status: "valid", explanation: "" },
      // 退化测量不该出行（与"常驻数字不画假数字"同一条纪律）。
      { id: "m-degenerate", kind: "measurement3", sourceIds: ["circle-1"], metric: "perimeter", value: undefined, unit: "u", precision: "numeric-approximation", status: "degenerate", explanation: "" }
    ]
    useSceneStore.setState({ document, workspaceDocuments: { conics: document }, history: [], future: [], error: null })
    renderInspector()

    const panel = screen.getByLabelText("数值转换")
    const rows = panel.querySelectorAll("[data-exact-form-row]")
    expect(rows).toHaveLength(1)
    expect(rows[0].getAttribute("data-exact-form-kind")).toBe("pi-multiple")
    expect(rows[0].getAttribute("data-exact-form-text")).toBe("4π")
    expect(panel.textContent).toContain("面积")
    expect(panel.textContent).toContain("12.566")

    // 入口在**最高处**：它必须排在属性面板自己的标题之前。
    const panelTitle = globalThis.document.querySelector(".panel-title")!
    expect(panel.compareDocumentPosition(panelTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("says there is nothing to convert when the document has no measurements", () => {
    renderInspector()

    expect(screen.getByLabelText("数值转换").textContent).toContain("还没有测量")
  })

  it("keeps supported measurement actions reachable from the data tab", () => {
    const document = {
      ...createEmptyDocument("geometry3d"),
      primitives: [
        { id: "face3-1", type: "face3" as const, pointIds: ["point3-1", "point3-2", "point3-3"], label: "面 1" },
        { id: "face3-2", type: "face3" as const, pointIds: ["point3-2", "point3-3", "point3-4"], label: "面 3" }
      ]
    }
    useSceneStore.setState({ document, workspaceDocuments: { geometry3d: document } })

    renderInspector({ properties: { selectedPrimitive: document.primitives[0], selectedIds: ["face3-1", "face3-2"], selectedCount: 2 } })

    expect(screen.getByRole("button", { name: "二面角内角" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "二面角外角" })).toBeTruthy()
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

    fireEvent.click(screen.getByRole("tab", { name: "工程标注" }))
    expect(bound.onTabChange).toHaveBeenCalledWith("engineering")
  })
})
