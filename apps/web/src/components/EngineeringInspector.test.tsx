import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { createEmptyDocument, type PrimitiveSpec } from "@draw/dsl"
import { buildPrism, buildSolidTemplate, createBuilderContext } from "@draw/geometry-kernel"
import { applyOperation, patchPoint3, solidStatusReport } from "@draw/scene-graph"

import { useSceneStore } from "../store"
import { EngineeringInspector, type InspectorContext } from "./EngineeringInspector"
import { SolidDerivedReadings, type PropertiesBarProps } from "./PropertiesBar"

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

  it("hangs the common form on the measurement card, with a copy button", () => {
    /**
     * 用户口径（2026-09-19）：把数值转换重新加回来，但不要再做那块"把所有测量再列一遍"的置顶面板 ——
     * 分数就贴在数字已经在的地方（画布读数 + 这张测量卡片）。拖动出来的值认成常见值时带 ≈；
     * 精确值不带。
     */
    const document = createEmptyDocument("conics")
    const circle: PrimitiveSpec = { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 2 }
    document.primitives = [circle]
    document.measurements = [
      // 拖动出来的全精度浮点 ⇒ 吸附到 2/3（带 ≈）。
      { id: "m-length", kind: "measurement3", sourceIds: ["circle-1"], metric: "length", value: 0.667023, unit: "u", precision: "numeric-approximation", status: "valid", explanation: "" },
      // 精确的整数 ⇒ 不加后缀（避免 "5.000 u · 5" 这种重复）。
      { id: "m-radius", kind: "measurement3", sourceIds: ["circle-1"], metric: "radius", value: 2, unit: "u", precision: "numeric-approximation", status: "valid", explanation: "" }
    ]
    useSceneStore.setState({ document, workspaceDocuments: { conics: document }, history: [], future: [], error: null })
    renderInspector({ properties: { selectedPrimitive: circle, selectedIds: ["circle-1"], selectedCount: 1 } })

    const grids = Array.from(globalThis.document.querySelectorAll(".primitive-properties .metric-grid")).map((node) => node.textContent ?? "")
    expect(grids.some((value) => value.includes("0.667 u · ≈ 2/3"))).toBe(true)
    expect(grids.some((value) => value.includes("2.000 u"))).toBe(true)
    // 整数那条不加后缀：不要在 "2.000 u" 后面再挂一个 "· 2"。
    expect(grids.some((value) => value.includes("2.000 u ·"))).toBe(false)
    // 老师要把它贴进文档：精确形式单独给一个复制入口（只复制形式，不复制整个读数）。
    const copy = screen.getByLabelText("复制精确形式 长度测量")
    expect(copy).toBeTruthy()
    // 复制的就是形式本身（带 ≈，不伪装成精确值）。
    expect(copy.getAttribute("data-exact-form-text")).toBe("≈ 2/3")
    // 整数那条没有可复制的形式，就不给按钮。
    expect(screen.queryByLabelText("复制精确形式 半径测量")).toBeNull()
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

  /**
   * **派生立体读数**（Solid/Prism 切片 Task 5 的后半；规格 §3.4 / §6.2）。
   *
   * `solidStatusReport` 早就在生产层把内核的四态结论读了出来，但**没有一处渲染它** ——
   * 于是"精确 / 数值近似 / 不存在 / 退化"在界面上完全看不见，用户只能看到一个多面体。
   *
   * 这几条用例钉三件事：
   * 1. 选中一只**实体**（棱柱那种 `polyhedron3`，或立方体那样的模板实体）时，属性检查器里
   *    能看到它的外接球 / 内切球 / 截面读数；
   * 2. `exact` 与 `approximate` 必须**看得出来不一样**（状态、文案、残差）；
   * 3. `undefined` / `degenerate` 显示**内核给的原因**，而不是一个假值或一片空白。
   *
   * 断言打在 `data-derived-status` / `data-derived-code` 上而不是中文文案上：文案会改，
   * 而"这条读数的状态是什么"是这一层真正要守的事实。
   */
  describe("derived solid readings", () => {
    const PRISM_BASE = [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 3, z: 0 }, { x: 0, y: 3, z: 0 }]

    /** 一只斜棱柱 + 一个过它中心的水平截面（生产口径：`buildPrism` 就是内核那条构造）。 */
    function prismPrimitives(): PrimitiveSpec[] {
      const built = buildPrism({ base: PRISM_BASE, vector: { x: 1, y: 0.5, z: 3 } }, createBuilderContext("solid-1"))
      expect(built.diagnostics).toEqual([])
      // 截面的 `sourceId` 就是用户当初选中的那个实体 —— 棱柱这里正是它自己的多面体 id
      //（`App.addSection` 写的是 `selectedPrimitive.id`）。
      return [...built.primitives, { id: "section-1", type: "section", sourceId: built.polyhedronId!, plane: { normal: { x: 0, y: 0, z: 1 }, constant: -1.5 }, points: [], classification: "none", status: "undefined" }]
    }

    function storeDocument(primitives: PrimitiveSpec[]) {
      const document = { ...createEmptyDocument("geometry3d"), primitives }
      useSceneStore.setState({ document, workspaceDocuments: { geometry3d: document }, history: [], future: [], error: null })
      return document
    }

    /** 一行派生读数：它的状态与它显示出来的那句话。`solid` 用于同一 code 有多条时报明是哪一只实体。 */
    function reading(container: HTMLElement, code: string, solid?: string): { status: string | null; text: string } {
      const row = container.querySelector(`[data-derived-code="${code}"]${solid === undefined ? "" : `[data-derived-solid="${solid}"]`}`)
      return { status: row?.getAttribute("data-derived-status") ?? null, text: row?.textContent ?? "" }
    }

    /** 一只立方体 + 物化拓扑（模板实体那一支）。 */
    function cubeSetup() {
      const cube = { id: "cube-1", type: "cube" as const, origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 }, label: "立方体 1" }
      const built = buildSolidTemplate(cube)
      expect(built.diagnostics).toEqual([])
      return { cube, built }
    }

    /**
     * **拖一个顶点之后读数不许整块消失**（Fix round 1 / I2）。
     *
     * 按数值改一个模板顶点会把拓扑的记法翻成 `fromFaces`（归属改记在 `sourceId` 上，
     * 见 `patchPoint3`）。界面前一版只认 `kind: "template"`，于是这一步之后
     * `derivedSolidIdsOf` 返回空数组，**整块**派生读数（球与截面一起）无声消失 ——
     * 而 `solidStatusReport` 明明还在报这只实体。这条用例走的就是生产的翻法。
     */
    it("keeps the panel after a numeric vertex edit flips the topology notation", () => {
      const { cube, built } = cubeSetup()
      const before = { ...createEmptyDocument("geometry3d"), primitives: [cube, ...built.primitives] }
      const flipped = applyOperation(before, patchPoint3(built.vertexIds[0]!, { x: -3, y: -1, z: -1 }))
      expect(flipped.error).toBeUndefined()
      const topology = flipped.document.primitives.find((primitive) => primitive.id === built.polyhedronId)
      // 前提成立：记法真的翻了，归属还在。
      expect(topology?.type === "polyhedron3" && topology.construction).toMatchObject({ kind: "fromFaces", sourceId: "cube-1" })
      storeDocument(flipped.document.primitives)
      renderInspector({ properties: { selectedPrimitive: cube, selectedIds: [cube.id], selectedCount: 1 } })

      const panel = globalThis.document.querySelector("[data-derived-panel]")
      expect(panel).toBeTruthy()
      // 而且显示的就是内核此刻的结论（不是界面自己另算一份）。
      const expected = solidStatusReport(flipped.document).find((entry) => entry.solidId === built.polyhedronId && entry.code === "derived.circumsphere")
      expect(expected).toBeDefined()
      expect(reading(panel as HTMLElement, "derived.circumsphere").status).toBe(expected!.status)
    })

    /**
     * **同一只实体上的两条截面是两条不同的读数**（Fix round 1 / M1）。
     *
     * 报告里的截面读数原先只带 `solidId`（= 截面的 `sourceId`），两条截面因此产出两条
     * **一模一样**的记录：行长得一样、React key 还会撞。现在读数带上"是哪一刀"的 id，
     * 行标题用那条截面自己的标签 —— 两行读得出区别。
     */
    it("keeps two sections cut from one solid apart", () => {
      const { cube, built } = cubeSetup()
      const section = (id: string, z: number, label: string): PrimitiveSpec => ({ id, type: "section", sourceId: "cube-1", plane: { normal: { x: 0, y: 0, z: 1 }, constant: -z }, points: [], classification: "none", status: "undefined", label })
      storeDocument([cube, ...built.primitives, section("section-1", 1.6, "截面 1"), section("section-2", 0.4, "截面 2")])
      renderInspector({ properties: { selectedPrimitive: cube, selectedIds: [cube.id], selectedCount: 1 } })

      const rows = Array.from((globalThis.document.querySelector("[data-derived-panel]") as HTMLElement).querySelectorAll('[data-derived-code="derived.section"]'))
      expect(rows).toHaveLength(2)
      // 两条读数各自说明自己来自哪一刀。
      expect(rows.map((row) => row.getAttribute("data-derived-source"))).toEqual(["section-1", "section-2"])
      const labels = rows.map((row) => row.querySelector(".derived-reading-label")?.textContent ?? "")
      expect(new Set(labels).size).toBe(2)
      expect(labels.join(" ")).toContain("截面 2")
    })

    /**
     * **选中的是截面时显示这一刀自己的读数**（Fix round 1 / M2 / D2）。
     *
     * `App.addSection` 会把选择切到新建的截面上，所以"选中截面"不是边角情形 ——
     * 前一版在这里什么都不显示（读数在创建那一刻消失），用户必须先点回实体才看得见。
     */
    it("shows a selected section's own reading instead of nothing", () => {
      const { cube, built } = cubeSetup()
      const focus = { id: "section-2", type: "section" as const, sourceId: "cube-1", plane: { normal: { x: 0, y: 0, z: 1 }, constant: -0.4 }, points: [], classification: "none" as const, status: "undefined" as const, label: "截面 2" }
      storeDocument([cube, ...built.primitives, { id: "section-1", type: "section", sourceId: "cube-1", plane: { normal: { x: 0, y: 0, z: 1 }, constant: -1.6 }, points: [], classification: "none", status: "undefined", label: "截面 1" }, focus])
      renderInspector({ properties: { selectedPrimitive: focus, selectedIds: [focus.id], selectedCount: 1 } })

      const panel = globalThis.document.querySelector("[data-derived-panel]") as HTMLElement
      expect(panel).toBeTruthy()
      const rows = Array.from(panel.querySelectorAll("[data-derived-code]"))
      // 只显示这一刀：另一条截面与这只实体的球体读数都不掺进来。
      expect(rows).toHaveLength(1)
      expect(rows[0]!.getAttribute("data-derived-code")).toBe("derived.section")
      expect(rows[0]!.getAttribute("data-derived-source")).toBe("section-2")
      expect(rows[0]!.getAttribute("data-derived-status")).toBe("exact")
    })

    it("reports the selected prism's sphere and section statuses, with the kernel's reasons", () => {
      const primitives = prismPrimitives()
      storeDocument(primitives)
      const solid = primitives.find((primitive) => primitive.type === "polyhedron3")!
      renderInspector({ properties: { selectedPrimitive: solid, selectedIds: [solid.id], selectedCount: 1 } })

      const panel = globalThis.document.querySelector("[data-derived-panel]")
      expect(panel).toBeTruthy()
      const container = panel as HTMLElement
      // 斜棱柱：一般多面体不一定有外接球 / 内切球 → 两个都如实报"不存在"，并带上原因。
      expect(reading(container, "derived.circumsphere").status).toBe("undefined")
      expect(reading(container, "derived.circumsphere").text).toContain("外接球")
      expect(reading(container, "derived.insphere").status).toBe("undefined")
      expect(reading(container, "derived.insphere").text).toContain("内切球")
      // 截面读数是**内核算的**（不是图元上那个可能过期的 `classification` 字段）。
      expect(reading(container, "derived.section").status).toBe("exact")
      expect(reading(container, "derived.section").text).toContain("polygon")
      // `undefined` 那一行不许是空的：理由就在这里。
      expect(reading(container, "derived.circumsphere").text).toMatch(/没有外接球|找不到/)
    })

    it("reports a cube's exact readings as exact, so exact and undefined stay distinguishable", () => {
      const cube = { id: "cube-1", type: "cube" as const, origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 }, label: "立方体 1" }
      // 截面挂在**模板实体**上（`sourceId` 是 `cube-1`），而外接球 / 内切球挂在物化出来的
      // 多面体上 —— 两条归属口径不同，界面必须两条都收，否则"立方体的截面状态"会静默消失。
      const section = { id: "section-1", type: "section" as const, sourceId: "cube-1", plane: { normal: { x: 0, y: 0, z: 1 }, constant: -1 }, points: [], classification: "none" as const, status: "undefined" as const }
      storeDocument([cube, ...buildSolidTemplate(cube).primitives, section])
      renderInspector({ properties: { selectedPrimitive: cube, selectedIds: [cube.id], selectedCount: 1 } })

      const container = globalThis.document.querySelector("[data-derived-panel]") as HTMLElement
      expect(container).toBeTruthy()
      expect(reading(container, "derived.circumsphere").status).toBe("exact")
      expect(reading(container, "derived.insphere").status).toBe("exact")
      // `exact` 给的是**结论**（半径 / 球心），不是一句"有球"。
      expect(reading(container, "derived.circumsphere").text).toMatch(/半径/)
      // 而同一个面板上，`exact` 与 `undefined` 并存时状态各自成立（斜棱柱那份是 undefined）。
      expect(reading(container, "derived.section").status).toBe("exact")
    })

    it("shows nothing for an object that has no derived readings", () => {
      const point = { id: "point-1", type: "point" as const, x: 0, y: 0 }
      storeDocument([point])
      renderInspector({ properties: { selectedPrimitive: point, selectedIds: [point.id], selectedCount: 1 } })

      expect(globalThis.document.querySelector("[data-derived-panel]")).toBeNull()
    })

    it("renders an approximate reading as approximate, with its residual, and never blank for undefined", () => {
      /**
       * **四态里的 `approximate` 目前没有生产来源**（`solidStatusReport` 调的那三个求解器
       * 只会给 `exact` / `undefined` / `degenerate`）。所以这一条直接给渲染层喂几条
       * **生产形状**的读数（`SolidDerivedStatus`）：规格 §3.4/§10 要求四态保持可区分，
       * 而"将来内核给出 `approximate` 时界面会不会把它显示成精确"必须现在就钉住。
       */
      render(<SolidDerivedReadings entries={[
        { solidId: "solid-1", code: "derived.circumsphere", status: "exact", message: "外接球：半径 1.732，圆心 (0, 0, 0)。" },
        { solidId: "solid-2", code: "derived.circumsphere", status: "approximate", message: "外接球（数值近似，残差 0.00120）：半径 1.732。" },
        { solidId: "solid-3", code: "derived.insphere", status: "undefined", message: "内切球：该实体没有内切球。" },
        { solidId: "solid-4", code: "derived.section", status: "degenerate", message: "截面：实体顶点包含非有限坐标。" }
      ]} />)

      const container = globalThis.document.querySelector("[data-derived-panel]") as HTMLElement
      const statuses = Array.from(container.querySelectorAll("[data-derived-status]")).map((node) => node.getAttribute("data-derived-status"))
      expect(statuses).toEqual(["exact", "approximate", "undefined", "degenerate"])
      // `approximate` 与 `exact` 的**文案**也必须不同（颜色不是唯一的信息载体）。
      const labels = Array.from(container.querySelectorAll(".derived-status")).map((node) => node.textContent)
      expect(labels[0]).toBe("精确")
      expect(labels[1]).not.toBe(labels[0])
      // 残差要看得见 —— "数值近似"不带残差就没人知道它有多近似（这一条是 solid-2 那份）。
      expect(reading(container, "derived.circumsphere", "solid-2").status).toBe("approximate")
      expect(reading(container, "derived.circumsphere", "solid-2").text).toContain("残差")
      // `undefined` / `degenerate` 显示原因，而不是空白或假值。
      const reasons = Array.from(container.querySelectorAll(".derived-reading-message")).map((node) => node.textContent ?? "")
      expect(reasons[2]).toContain("没有内切球")
      expect(reasons[3]).toContain("非有限坐标")
    })
  })
})
