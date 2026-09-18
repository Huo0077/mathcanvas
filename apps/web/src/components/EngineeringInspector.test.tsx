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
   * 「精确形式」面板已按用户要求删除（2026-09-18：「删除右侧的"精确形式"，似乎没什么用」）。
   *
   * 这条用例反过来钉住**删除的边界**：面板、它的行、它的空状态文案都不再出现；
   * 但测量数据本身一点没动（内核里的 `exactFormOf` 与 `.mgeo` 里的 `measurements` 都保留），
   * 而且属性面板自己的入口仍然在——删掉的是一块只读展示，不是测量能力。
   */
  it("no longer renders the exact-form panel, while keeping the measurements themselves", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [{ id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 2 }]
    document.measurements = [
      { id: "m-area", kind: "measurement3", sourceIds: ["circle-1"], metric: "area", value: Math.PI * 4, unit: "u²", precision: "numeric-approximation", status: "valid", explanation: "" },
      { id: "m-length", kind: "measurement3", sourceIds: ["circle-1"], metric: "length", value: 0.666667, unit: "u", precision: "numeric-approximation", status: "valid", explanation: "" }
    ]
    useSceneStore.setState({ document, workspaceDocuments: { conics: document }, history: [], future: [], error: null })
    renderInspector()

    expect(screen.queryByLabelText("数值转换")).toBeNull()
    expect(screen.queryByText("精确形式")).toBeNull()
    expect(screen.queryByText("还没有测量：先在画布上量一个长度、角度或面积。")).toBeNull()
    expect(globalThis.document.querySelectorAll("[data-exact-form-panel], [data-exact-form-row]")).toHaveLength(0)

    // 测量数据还在文档里（面板删的是展示，不是数据）。
    expect(useSceneStore.getState().document.measurements).toHaveLength(2)
    expect(screen.getByLabelText("属性检查器")).toBeTruthy()
    expect(globalThis.document.querySelector(".panel-title")).toBeTruthy()
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
