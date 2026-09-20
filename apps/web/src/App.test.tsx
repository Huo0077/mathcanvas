import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"

import { createEmptyDocument, encodeMgeo } from "@draw/dsl"
import { host3FromPrimitive } from "@draw/geometry-kernel"
import { recomputeDerivedObjects } from "@draw/scene-graph"

import { App } from "./App"
import { createDemoDocument } from "./demoDocument"
import { useSceneStore, withDocumentLayout } from "./store"

/** Algebra View rows are the closest user-facing handle on a document object; scope by row label to stay unambiguous. */
function algebraRow(label: string): HTMLElement {
  const row = Array.from(globalThis.document.querySelectorAll(".algebra-panel .object-row")).find((candidate) => candidate.querySelector(".object-name")?.textContent === label)
  if (!row) throw new Error(`missing algebra row ${label}`)
  return row as HTMLElement
}

function openInspectorSection(label: string): void {
  const trigger = screen.getByRole("button", { name: label })
  if (trigger.getAttribute("aria-expanded") === "false") fireEvent.click(trigger)
}

/** Planar points are labelled A, B, C … (the label is the object row's only text), so rows are matched by name. */
function pointObjectRows(): HTMLElement[] {
  return Array.from(globalThis.document.querySelectorAll(".algebra-panel .object-row")).filter((row) => /^[A-Z]$/.test(row.querySelector(".object-name")?.textContent ?? "")) as HTMLElement[]
}

describe("MathCanvas workbench", () => {
  beforeEach(() => {
    localStorage.clear()
    // `replace` deliberately keeps other workspaces' documents, so tests need a full store reset.
    const document = createDemoDocument()
    useSceneStore.setState({ document, workspaceDocuments: { [document.workspace]: document }, history: [], future: [], error: null, treeTab: "model", expandedIds: ["sheet-1"], filterQuery: "" })
  })

  it("renders each workspace command from the shared Ribbon only once", () => {
    render(<App />)

    expect(screen.getAllByRole("button", { name: "添加点" })).toHaveLength(1)

    fireEvent.click(screen.getByRole("button", { name: "跳转到立体几何" }))
    expect(screen.getAllByRole("button", { name: "添加立方体" })).toHaveLength(1)

    fireEvent.click(screen.getByRole("button", { name: "跳转到工程制图" }))
    expect(screen.getAllByRole("button", { name: "导出 SVG" })).toHaveLength(1)
  })

  it("shows a focused empty Inspector before an object is selected", () => {
    render(<App />)

    expect(screen.getByText("未选择任何图元")).toBeTruthy()
    expect(screen.getByText("在画布中点击点、直线或椭圆即可配置几何参数与外观参数")).toBeTruthy()
    expect(screen.queryByRole("slider", { name: "直线斜率" })).toBeNull()
    expect(screen.queryByRole("button", { name: "播放动画" })).toBeNull()
  })

  it("opens geometry parameters by default and keeps appearance collapsed", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    fireEvent.click(screen.getAllByText("A", { selector: ".object-name" })[0])

    expect(screen.getByRole("button", { name: "几何参数" }).getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByRole("button", { name: "外观样式" }).getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByLabelText("线条颜色")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "外观样式" }))
    expect(screen.getByLabelText("线条颜色")).toBeTruthy()
  })

  it("updates the bottom status prompt as a line is created", () => {
    render(<App />)
    const status = screen.getByRole("status", { name: "操作提示" })
    const canvas = screen.getByRole("img", { name: "几何画布" })

    fireEvent.click(screen.getByRole("button", { name: "添加直线" }))
    expect(status.textContent).toContain("第1步")
    fireEvent.click(canvas, { clientX: 320, clientY: 180 })
    expect(status.textContent).toContain("第2步")
  })

  it("keeps constraint and agent UI out of the right inspector but keeps the constraint data", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    fireEvent.click(screen.getAllByText("A", { selector: ".object-name" })[0])

    expect(screen.queryByText("几何约束")).toBeNull()
    expect(screen.queryByText("暂无约束")).toBeNull()
    expect(screen.queryByRole("button", { name: "+添加" })).toBeNull()
    expect(screen.queryByText("智能体 (Agent)")).toBeNull()
    expect(screen.queryByLabelText("智能体指令")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "跳转到工程制图" }))
    expect(screen.queryByRole("tab", { name: "约束" })).toBeNull()
    expect(screen.queryByText("智能体 (Agent)")).toBeNull()
    // 约束数据仍在文档模型里：旧 .mgeo 打开后不会丢数据。
    expect(useSceneStore.getState().document.constraints).toEqual([])
  })

  it("routes the CAD workspace to four engineering drawing views", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到工程制图" }))

    const engineeringDrawing = screen.getByRole("main", { name: "工程制图视图" })
    expect(engineeringDrawing).toBeTruthy()
    expect(engineeringDrawing.querySelectorAll("[data-drawing-view]")).toHaveLength(4)
    expect(screen.getAllByText("暂无可投影的空间对象")).toHaveLength(4)
    expect(screen.queryByRole("button", { name: "添加点" })).toBeNull()
    expect(screen.getByRole("region", { name: "工程状态栏" }).textContent).toContain("工程制图根据当前文档的 3D 点、棱和面显示四个视图。")

    expect((screen.getByRole("button", { name: "导出 SVG" }) as HTMLButtonElement).disabled).toBe(false)
  })

  /**
   * Task 0.6 Step 3 的后半：**来源解析必须在两份文档里找**。
   *
   * 真实缺陷：工程制图的来源标签与检查器"投影来源"列表过去**只查布局文档**
   *（`sourceLabels` / `cadInspectorSources` 都基于 `document.primitives`），
   * 于是切到"投影立体几何"之后，明明看得见的空间对象会被标成**"来源已删除"**。
   * 源 id 落在哪一份文档由来源上下文决定，不能假定它就是布局文档。
   */
  it("resolves engineering sources in the projected document instead of calling them deleted", () => {
    const layout = withDocumentLayout({
      ...createEmptyDocument("cad"),
      // 图纸视图记录来源 id —— 这在"先建空间模型、再在图纸里标注"的正常流程里必然发生。
      drawingViews: [{ id: "view-front", kind: "front" as const, x: 0, y: 0, width: 100, height: 80, scale: 1, visible: true, showProjectionLines: false, sourceIds: ["point3-1"] }]
    })
    const spatial = {
      ...createEmptyDocument("geometry3d"),
      primitives: [{ id: "point3-1", type: "point3" as const, position: { x: 2, y: 3, z: 4 }, label: "空间点 A" }]
    }
    useSceneStore.setState({
      document: layout,
      workspaceDocuments: { cad: layout, geometry3d: spatial },
      history: [],
      future: [],
      error: null,
      treeTab: "drawings",
      expandedIds: ["sheet-1"],
      filterQuery: ""
    })
    render(<App />)

    // 布局文档里没有这个 id —— 缺陷状态下这里显示的是裸 id「来源 point3-1」。
    expect(screen.getByRole("region", { name: "模型与图纸树" }).textContent).toContain("空间点 A")

    // 切到"立体几何"来源之后，检查器必须仍认识这个来源，而不是宣称它被删了。
    fireEvent.click(screen.getByRole("button", { name: "改为投影立体几何的模型" }))
    fireEvent.click(screen.getByRole("tab", { name: "数据" }))
    const sources = screen.getByRole("region", { name: "工程属性检查器" }).querySelector(".inspector-sources")
    expect(sources?.textContent).toContain("空间点 A")
    expect(sources?.querySelector('[data-source-id="point3-1"]')?.getAttribute("data-missing")).toBe("false")
  })

  it("routes CAD source selection back through the shared application state", () => {
    const cadDocument = {
      ...createEmptyDocument("cad"),
      primitives: [{ id: "point3-1", type: "point3" as const, position: { x: 2, y: 3, z: 4 }, label: "A" }]
    }
    useSceneStore.getState().replace(cadDocument)
    render(<App />)

    const sourceButtons = screen.getAllByRole("button", { name: /point3-1/ })
    expect(sourceButtons).toHaveLength(4)
    fireEvent.click(sourceButtons[0])
    expect(sourceButtons.every((button) => button.getAttribute("data-selected") === "true")).toBe(true)
  })

  it("creates a linear engineering annotation from two selected space points", () => {
    const cadDocument = {
      ...createEmptyDocument("cad"),
      primitives: [
        { id: "point3-1", type: "point3" as const, position: { x: 0, y: 0, z: 0 }, label: "A" },
        { id: "point3-2", type: "point3" as const, position: { x: 3, y: 4, z: 0 }, label: "B" }
      ]
    }
    useSceneStore.getState().replace(cadDocument)
    render(<App />)

    const sourceButtons = screen.getAllByRole("button", { name: /point3-/ })
    fireEvent.click(sourceButtons[0])
    fireEvent.click(sourceButtons[1], { shiftKey: true })
    fireEvent.click(screen.getByRole("tab", { name: "工程标注" }))
    fireEvent.click(screen.getByRole("button", { name: "Add linear annotation" }))

    expect(useSceneStore.getState().document.engineeringAnnotations).toHaveLength(1)
    expect(useSceneStore.getState().document.engineeringAnnotations?.[0]).toMatchObject({ kind: "linear", sourceIds: ["point3-1", "point3-2"], view: "front" })
  })

  it("no longer offers the calculus workspace anywhere in the shell", () => {
    render(<App />)

    expect(screen.queryByRole("button", { name: "微积分" })).toBeNull()

    // The workspace stays retired, but 平面几何 keeps a function entry so simple functions remain reachable there.
    fireEvent.click(screen.getByRole("button", { name: "跳转到平面几何" }))
    expect(screen.getByRole("button", { name: "添加函数" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "添加抛物线" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "添加椭圆" })).toBeTruthy()
  })

  it("still opens a legacy document saved in the retired workspace without crashing", () => {
    const legacy = {
      ...createEmptyDocument("calculus"),
      primitives: [{ id: "fn-1", type: "function" as const, expression: "x*x", domain: [-1, 1] as [number, number], label: "旧函数" }]
    }
    useSceneStore.getState().replace(legacy)
    render(<App />)

    // Compatibility promise: it opens, its objects are listed (so they can be inspected and deleted),
    // and the retired workspace is still not offered as a destination.
    expect(screen.getByText("旧函数")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "微积分" })).toBeNull()
  })

  it("undoes and redoes with the keyboard, the way most people expect", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到工程制图" }))
    fireEvent.click(screen.getByRole("button", { name: "添加空间点" }))
    expect(useSceneStore.getState().document.primitives).toHaveLength(1)

    fireEvent.keyDown(window, { key: "z", ctrlKey: true })
    expect(useSceneStore.getState().document.primitives).toHaveLength(0)

    fireEvent.keyDown(window, { key: "y", ctrlKey: true })
    expect(useSceneStore.getState().document.primitives).toHaveLength(1)

    fireEvent.keyDown(window, { key: "z", ctrlKey: true })
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true })
    expect(useSceneStore.getState().document.primitives).toHaveLength(1)
    // Cmd on macOS must behave the same way.
    fireEvent.keyDown(window, { key: "z", metaKey: true })
    expect(useSceneStore.getState().document.primitives).toHaveLength(0)
  })

  it("never steals an undo shortcut from a text field", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    const before = useSceneStore.getState().document.primitives.length

    const field = globalThis.document.createElement("input")
    globalThis.document.body.append(field)
    fireEvent.keyDown(field, { key: "z", ctrlKey: true })
    field.remove()

    expect(useSceneStore.getState().document.primitives).toHaveLength(before)
  })

  it("disables the history buttons when there is nothing to undo or redo", () => {
    render(<App />)
    const undoButton = () => screen.getByRole("button", { name: "撤销" }) as HTMLButtonElement
    const redoButton = () => screen.getByRole("button", { name: "重做" }) as HTMLButtonElement

    // A restored draft starts with no history, so an enabled-looking button used to do nothing at all.
    expect(undoButton().disabled).toBe(true)
    expect(redoButton().disabled).toBe(true)

    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    expect(undoButton().disabled).toBe(false)
    expect(redoButton().disabled).toBe(true)

    fireEvent.click(undoButton())
    expect(undoButton().disabled).toBe(true)
    expect(redoButton().disabled).toBe(false)
  })

  it("creates and activates layers from the CAD layer tree", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到工程制图" }))
    fireEvent.click(screen.getByRole("tab", { name: "图层树" }))

    expect(screen.getByRole("button", { name: "几何" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "新建图层" }))
    expect(useSceneStore.getState().document.layers?.map((layer) => layer.name)).toContain("图层 1")

    fireEvent.click(screen.getByRole("button", { name: "图层 1" }))
    expect(useSceneStore.getState().document.activeLayerId).toBe("layer-1")
  })

  it("selects a sheet view from the CAD drawing tree and toggles its visibility", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到工程制图" }))
    fireEvent.click(screen.getByRole("tab", { name: "图纸树" }))

    const tree = screen.getByRole("region", { name: "模型与图纸树" })
    fireEvent.click(within(tree).getByRole("button", { name: "主视图" }))
    expect(within(tree).getByRole("button", { name: "主视图" }).getAttribute("aria-pressed")).toBe("true")

    fireEvent.click(within(tree).getByRole("button", { name: "隐藏 主视图" }))
    expect(useSceneStore.getState().document.drawingViews?.find((view) => view.id === "view-front")?.visible).toBe(false)
  })

  it("scales a projection viewport and persists the layout on the document", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到工程制图" }))

    fireEvent.click(screen.getByRole("button", { name: "放大 主视图" }))

    expect(useSceneStore.getState().document.drawingViews?.find((view) => view.id === "view-front")?.scale).toBe(1.5)
  })

  it("drafts 2D geometry into the active layer and hides it with that layer", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到工程制图" }))
    fireEvent.click(screen.getByRole("button", { name: "2D 绘图" }))
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))

    expect(useSceneStore.getState().document.primitives[0]).toMatchObject({ type: "point", layerId: "layer-geometry" })
    expect(screen.getByRole("region", { name: /模型视图/ })).toBeTruthy()

    fireEvent.click(screen.getByRole("tab", { name: "图层树" }))
    fireEvent.click(screen.getByRole("button", { name: "隐藏 几何" }))

    expect(pointObjectRows()).toHaveLength(0)
  })

  it("refuses to draft on a hidden layer and explains the rejection in the status bar", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到工程制图" }))
    fireEvent.click(screen.getByRole("tab", { name: "图层树" }))
    fireEvent.click(screen.getByRole("button", { name: "隐藏 几何" }))
    fireEvent.click(screen.getByRole("button", { name: "2D 绘图" }))
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))

    expect(useSceneStore.getState().document.primitives).toHaveLength(0)
    expect(screen.getByText(/已隐藏，无法创建对象/)).toBeTruthy()
  })

  it("switches workspaces without losing each workspace document", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到平面几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    expect(screen.getAllByText("A", { selector: ".object-name" })).toHaveLength(1)

    fireEvent.click(screen.getByRole("button", { name: "跳转到立体几何" }))
    expect(screen.queryByRole("img", { name: "几何画布" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "跳转到平面几何" }))
    expect(screen.getAllByText("A", { selector: ".object-name" })).toHaveLength(1)
    expect(screen.getByRole("button", { name: "跳转到平面几何" }).getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: "跳转到立体几何" }))
  })

  it("shows the default intersection and updates it from the slope slider", () => {
    render(<App />)
    const canvas = screen.getByRole("img", { name: "几何画布" })
    expect(canvas.querySelector('[data-primitive-type="intersection"] [data-intersection-info="true"]')).toBeNull()
    expect(canvas.querySelector('[data-primitive-type="intersection"] [data-hit-target="true"]')?.getAttribute("r")).toBe("14")
    fireEvent.click(screen.getAllByText("参数直线")[0])
    const slider = screen.getByRole("slider", { name: "选中直线斜率" })
    fireEvent.change(slider, { target: { value: "0.25" } })
    expect(canvas.querySelector('[data-primitive-type="intersection"] [data-intersection-info="true"]')).toBeNull()
    fireEvent.click(screen.getAllByText("交点 P")[0])
    expect(canvas.querySelector('[data-primitive-type="intersection"] [data-intersection-info="true"]')?.textContent).toContain("交点 P (8.00, 0.00)")
  })

  it("creates and edits a 3D solid from the workspace property inspector", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加立方体" }))
    // 这个用例断言的是"改尺寸之后**物化顶点**跟着重算"，所以先把原点钉住（默认落点会变，见 addDefaultCube）。
    fireEvent.change(screen.getByRole("spinbutton", { name: "原点 X" }), { target: { value: "-2" } })

    expect(screen.getAllByText("立方体 1")[0]).toBeTruthy()
    expect(screen.getByText("立体几何属性")).toBeTruthy()
    const topology = useSceneStore.getState().document.primitives.find((primitive) => primitive.type === "polyhedron3")
    expect(topology).toMatchObject({ type: "polyhedron3", construction: { kind: "template", templateId: "cube" } })
    expect(useSceneStore.getState().document.primitives.filter((primitive) => primitive.type === "point3")).toHaveLength(8)
    fireEvent.change(screen.getByRole("spinbutton", { name: "尺寸 X" }), { target: { value: "5" } })
    expect(useSceneStore.getState().document.primitives.find((primitive) => primitive.id === "cube-1")).toMatchObject({ type: "cube", size: { x: 5 } })
    const movedPoint = topology?.type === "polyhedron3" ? useSceneStore.getState().document.primitives.find((primitive) => primitive.id === topology.vertexIds[1]) : null
    expect(movedPoint).toMatchObject({ type: "point3", position: { x: 3 } })
  })

  it("creates point-driven 3D geometry from selected classroom points", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加空间点" }))
    fireEvent.click(screen.getByRole("button", { name: "添加空间点" }))

    expect(useSceneStore.getState().document.primitives.filter((primitive) => primitive.type === "point3")).toHaveLength(2)
    fireEvent.click(screen.getByText("A"))
    fireEvent.click(screen.getByText("B"), { shiftKey: true })
    fireEvent.click(screen.getByRole("button", { name: "由选中点创建空间直线" }))

    expect(useSceneStore.getState().document.primitives.some((primitive) => primitive.type === "line3")).toBe(true)
  })

  it("edits the source coordinates of a selected space point", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加空间点" }))

    fireEvent.change(screen.getByRole("spinbutton", { name: "坐标 X" }), { target: { value: "4" } })

    expect(useSceneStore.getState().document.primitives.filter((primitive) => primitive.type === "point3").at(-1)).toMatchObject({ position: { x: 4 } })
  })

  it("creates and edits a 3D solid from the workspace property inspector", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加立方体" }))

    expect(screen.getAllByText("立方体 1")[0]).toBeTruthy()
    expect(screen.getByText("立体几何属性")).toBeTruthy()
    fireEvent.change(screen.getByRole("spinbutton", { name: "尺寸 X" }), { target: { value: "5" } })
    expect(useSceneStore.getState().document.primitives.find((primitive) => primitive.id === "cube-1")).toMatchObject({ type: "cube", size: { x: 5 } })
  })

  it("creates point-driven 3D geometry from selected classroom points", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加空间点" }))
    fireEvent.click(screen.getByRole("button", { name: "添加空间点" }))

    expect(useSceneStore.getState().document.primitives.filter((primitive) => primitive.type === "point3")).toHaveLength(2)
    fireEvent.click(screen.getByText("A"))
    fireEvent.click(screen.getByText("B"), { shiftKey: true })
    fireEvent.click(screen.getByRole("button", { name: "由选中点创建空间直线" }))

    expect(useSceneStore.getState().document.primitives.some((primitive) => primitive.type === "line3")).toBe(true)
  })

  it("edits the source coordinates of a selected space point", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加空间点" }))

    fireEvent.change(screen.getByRole("spinbutton", { name: "坐标 X" }), { target: { value: "4" } })

    expect(useSceneStore.getState().document.primitives.filter((primitive) => primitive.type === "point3").at(-1)).toMatchObject({ position: { x: 4 } })
  })

  /**
   * 空间圆轨道：**选几个点决定它长什么样**——1 个点定圆心（水平、默认半径）、2 个点用第二点定半径、
   * 3 个点用三点平面定朝向。它是"约束轨道"：建好之后能当动点的宿主（见 `pointHostOptions`）。
   */
  it("creates a circle track from one or two selected space points", () => {
    const circleTracks = () => useSceneStore.getState().document.primitives.filter((primitive) => primitive.type === "circle3")
    const points = () => useSceneStore.getState().document.primitives.filter((primitive): primitive is Extract<ReturnType<typeof useSceneStore.getState>["document"]["primitives"][number], { type: "point3" }> => primitive.type === "point3")

    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到立体几何" }))

    // 1 个点：以它为圆心的水平圆（法向 +Z），半径取默认值。
    fireEvent.click(screen.getByRole("button", { name: "添加空间点" }))
    fireEvent.click(screen.getAllByText("A")[0])
    fireEvent.click(screen.getByRole("button", { name: "添加空间圆轨道" }))

    expect(circleTracks()).toHaveLength(1)
    const single = circleTracks()[0] as { center: { x: number; y: number; z: number }; radius: number; normal: { x: number; y: number; z: number } }
    /**
     * 圆**自带圆心坐标**、不引用那个点：建的时候只取一次坐标（用户口径："我要的轨道圆是点在圆上
     * 而不是圆跟着点走"）。所以这里断言坐标相等，而不是断言引用了它的 id。
     */
    expect(single.center).toEqual(points()[0].position)
    expect("centerId" in single).toBe(false)
    expect(single.normal).toEqual({ x: 0, y: 0, z: 1 })
    expect(single.radius).toBeCloseTo(1.5, 6)

    // 检查器里能改半径：轨道半径就是它的参数。
    expect(screen.getByText("空间圆轨道")).toBeTruthy()
    fireEvent.change(screen.getByRole("spinbutton", { name: "圆轨道半径" }), { target: { value: "2.5" } })
    expect((circleTracks()[0] as { radius: number }).radius).toBeCloseTo(2.5, 6)

    // 撤销粒度：一次回到改半径之前，再一次整条轨道消失。
    fireEvent.click(screen.getByRole("button", { name: "撤销" }))
    expect((circleTracks()[0] as { radius: number }).radius).toBeCloseTo(1.5, 6)
    fireEvent.click(screen.getByRole("button", { name: "撤销" }))
    expect(circleTracks()).toHaveLength(0)

    // 2 个点：第二点当圆周上的点，半径 = 两点距离。
    fireEvent.click(screen.getByRole("button", { name: "添加空间点" }))
    fireEvent.click(screen.getAllByText("A")[0])
    fireEvent.click(screen.getAllByText("B")[0], { shiftKey: true })
    fireEvent.click(screen.getByRole("button", { name: "添加空间圆轨道" }))

    const [centre, rim] = points()
    const track = circleTracks()[0] as { center: { x: number; y: number; z: number }; radius: number }
    expect(track.center).toEqual(centre.position)
    expect(track.radius).toBeCloseTo(Math.hypot(rim.position.x - centre.position.x, rim.position.y - centre.position.y, rim.position.z - centre.position.z), 9)
  })

  /**
   * 轨道圆改成自带圆心之后，检查器里的圆心 X/Y/Z 就是**可编辑的真实字段**（写 `center3`）。
   * 顺带守住那条用户口径：拖点 / 删点都不再影响这条轨道。
   */
  it("edits a circle track's own centre and leaves the construction points free", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加空间点" }))
    fireEvent.click(screen.getAllByText("A")[0])
    fireEvent.click(screen.getByRole("button", { name: "添加空间圆轨道" }))

    const track = () => useSceneStore.getState().document.primitives.find((primitive) => primitive.type === "circle3") as { center: { x: number; y: number; z: number } }
    fireEvent.change(screen.getByRole("spinbutton", { name: "圆心 X" }), { target: { value: "4" } })
    expect(track().center.x).toBeCloseTo(4, 6)

    // 删掉那个点：轨道还在（它不再引用谁）。
    fireEvent.click(screen.getAllByText("A")[0])
    fireEvent.click(screen.getByRole("button", { name: "快速删除对象" }))
    expect(useSceneStore.getState().document.primitives.some((primitive) => primitive.type === "circle3")).toBe(true)
    expect(useSceneStore.getState().document.primitives.some((primitive) => primitive.type === "point3")).toBe(false)
  })

  /**
   * 用户反馈："圆轨道上的动点无法与定点建立直线连接"。
   *
   * 根因是 schema 的 `onHost` 允许类型里漏了 `circle3`：把点绑到轨道之后**整份文档**都算不合法，
   * 而 `addPrimitive`（加点、建线……）写入前要校验整份文档——于是轨道上有了动点之后，
   * **后续什么新对象都加不进来**（实测报 `point3 host binding is invalid`），
   * 用户看到的就是"无法与定点建立直线连接"。
   */
  it("still adds points and lines after a point is bound to a circle track", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加空间点" }))
    fireEvent.click(screen.getByRole("button", { name: "添加空间点" }))
    fireEvent.click(screen.getAllByText("A")[0])
    fireEvent.click(screen.getAllByText("B")[0], { shiftKey: true })
    fireEvent.click(screen.getByRole("button", { name: "添加空间圆轨道" }))

    // 第三个点绑到轨道上（宿主下拉里那条写着「圆轨道」）。
    fireEvent.click(screen.getByRole("button", { name: "添加空间点" }))
    const hostSelect = screen.getByRole("combobox", { name: "点宿主绑定" }) as HTMLSelectElement
    const orbitOption = Array.from(hostSelect.options).find((option) => option.textContent?.includes("圆轨道"))
    expect(orbitOption).toBeTruthy()
    fireEvent.change(hostSelect, { target: { value: orbitOption!.value } })

    const point3s = () => useSceneStore.getState().document.primitives.filter((primitive) => primitive.type === "point3")
    expect(point3s()).toHaveLength(3)

    // 关键：绑定之后**还能**再添加一个定点（绑定之前这段是通的，绑定之后就全被拒了）。
    fireEvent.click(screen.getByRole("button", { name: "添加空间点" }))
    expect(point3s()).toHaveLength(4)

    // 而且"动点 + 定点"真的能建出空间直线。
    fireEvent.click(screen.getAllByText("C")[0])
    fireEvent.click(screen.getAllByText("D")[0], { shiftKey: true })
    fireEvent.click(screen.getByRole("button", { name: "由选中点创建空间直线" }))
    expect(useSceneStore.getState().document.primitives.filter((primitive) => primitive.type === "line3")).toHaveLength(1)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  /**
   * 检查器里的「朝向」：空间面与圆轨道没有存欧拉角，所以给的是**相对**旋转（选轴 + 角度 + 应用），
   * 读数（当前法向）随后刷新。用户口径："也可以在右侧属性栏设置为 90 度。"
   */
  it("rotates a circle track from the inspector in one undoable step", () => {
    const trackNormal = () => (useSceneStore.getState().document.primitives.find((primitive) => primitive.type === "circle3") as { normal: { x: number; y: number; z: number } }).normal

    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加空间点" }))
    fireEvent.click(screen.getAllByText("A")[0])
    fireEvent.click(screen.getByRole("button", { name: "添加空间圆轨道" }))

    // 读数一开始就是文档里的值：水平圆（法向 +Z）。
    expect(screen.getByText("当前法向").parentElement?.textContent).toContain("(0.00, 0.00, 1.00)")

    fireEvent.change(screen.getByRole("combobox", { name: "旋转轴" }), { target: { value: "x" } })
    fireEvent.change(screen.getByRole("spinbutton", { name: "再转角度" }), { target: { value: "90" } })
    fireEvent.click(screen.getByRole("button", { name: "应用旋转" }))

    const turned = trackNormal()
    expect(turned.x).toBeCloseTo(0, 9)
    expect(turned.y).toBeCloseTo(-1, 9)
    expect(turned.z).toBeCloseTo(0, 9)
    // 读数跟着文档走（不是某一帧的局部状态）。
    expect(screen.getByText("当前法向").parentElement?.textContent).toContain("(0.00, -1.00, 0.00)")

    // 一次旋转 = 一步撤销：退回水平，而不是退回"圆没了"。
    fireEvent.click(screen.getByRole("button", { name: "撤销" }))
    expect(trackNormal()).toEqual({ x: 0, y: 0, z: 1 })
  })

  it("shows the selected line slope characteristics in the properties panel", () => {
    render(<App />)
    fireEvent.click(screen.getAllByText("参数直线")[0])

    expect(screen.getByText("斜率特征")).toBeTruthy()
    expect(screen.getByText("倾角")).toBeTruthy()
    expect(screen.getByText("截距")).toBeTruthy()
  })

  it("organizes selected properties into an inspector hierarchy", () => {
    render(<App />)
    fireEvent.click(screen.getAllByText("参数直线")[0])

    expect(screen.getByRole("region", { name: "属性检查器" })).toBeTruthy()
    expect(screen.getByText("当前图元")).toBeTruthy()
    expect(screen.getByRole("button", { name: "外观样式" })).toBeTruthy()
    expect(screen.getByText("直线", { selector: ".property-type-badge" })).toBeTruthy()
  })

  it("shows editable point coordinates when a point is selected", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    fireEvent.click(screen.getAllByText("A", { selector: ".object-name" })[0])

    expect(screen.getByRole("spinbutton", { name: "点 X" })).toBeTruthy()
    expect(screen.getByRole("spinbutton", { name: "点 Y" })).toBeTruthy()
  })

  it("drags a line body and updates its dependent intersection", () => {
    render(<App />)
    fireEvent.click(screen.getAllByText("参数直线")[0])
    fireEvent.change(screen.getByRole("slider", { name: "选中直线斜率" }), { target: { value: "0.5" } })
    const canvas = screen.getByRole("img", { name: "几何画布" })
    const line = canvas.querySelectorAll('[data-primitive-type="line"]')[1]
    const before = useSceneStore.getState().document.primitives.find((primitive) => primitive.type === "intersection")

    fireEvent.pointerDown(line, { clientX: 400, clientY: 140, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 400, clientY: 110, pointerId: 1 })
    fireEvent.pointerUp(canvas, { clientX: 400, clientY: 110, pointerId: 1 })

    const after = useSceneStore.getState().document.primitives.find((primitive) => primitive.type === "intersection")
    expect(after).not.toEqual(before)
    expect(canvas.querySelector('[data-primitive-type="intersection"] [data-intersection-info="true"]')).toBeNull()
  })

  it("pans the canvas with the middle mouse button without changing the document", () => {
    render(<App />)
    const canvas = screen.getByRole("img", { name: "几何画布" })
    const beforeRevision = useSceneStore.getState().document.revision
    const beforeCenter = canvas.getAttribute("data-viewport-center")

    fireEvent.pointerDown(canvas, { button: 1, clientX: 400, clientY: 220, pointerId: 7 })
    fireEvent.pointerMove(canvas, { button: 1, clientX: 500, clientY: 260, pointerId: 7 })
    fireEvent.pointerUp(canvas, { button: 1, clientX: 500, clientY: 260, pointerId: 7 })

    expect(canvas.getAttribute("data-viewport-center")).not.toBe(beforeCenter)
    expect(useSceneStore.getState().document.revision).toBe(beforeRevision)
  })

  it("pans when the middle-button gesture starts on an object", () => {
    render(<App />)
    const canvas = screen.getByRole("img", { name: "几何画布" })
    const line = canvas.querySelector('[data-primitive-type="line"]')!
    const beforeCenter = canvas.getAttribute("data-viewport-center")

    fireEvent.pointerDown(line, { button: 1, clientX: 400, clientY: 220, pointerId: 8 })
    fireEvent.pointerMove(canvas, { button: 1, clientX: 500, clientY: 260, pointerId: 8 })
    fireEvent.pointerUp(canvas, { button: 1, clientX: 500, clientY: 260, pointerId: 8 })

    expect(canvas.getAttribute("data-viewport-center")).not.toBe(beforeCenter)
  })

  it("pans the canvas with the middle mouse button without changing the document", () => {
    render(<App />)
    const canvas = screen.getByRole("img", { name: "几何画布" })
    const beforeRevision = useSceneStore.getState().document.revision
    const beforeCenter = canvas.getAttribute("data-viewport-center")

    fireEvent.pointerDown(canvas, { button: 1, clientX: 400, clientY: 220, pointerId: 7 })
    fireEvent.pointerMove(canvas, { button: 1, clientX: 500, clientY: 260, pointerId: 7 })
    fireEvent.pointerUp(canvas, { button: 1, clientX: 500, clientY: 260, pointerId: 7 })

    expect(canvas.getAttribute("data-viewport-center")).not.toBe(beforeCenter)
    expect(useSceneStore.getState().document.revision).toBe(beforeRevision)
  })

  it("pans when the middle-button gesture starts on an object", () => {
    render(<App />)
    const canvas = screen.getByRole("img", { name: "几何画布" })
    const line = canvas.querySelector('[data-primitive-type="line"]')!
    const beforeCenter = canvas.getAttribute("data-viewport-center")

    fireEvent.pointerDown(line, { button: 1, clientX: 400, clientY: 220, pointerId: 8 })
    fireEvent.pointerMove(canvas, { button: 1, clientX: 500, clientY: 260, pointerId: 8 })
    fireEvent.pointerUp(canvas, { button: 1, clientX: 500, clientY: 260, pointerId: 8 })

    expect(canvas.getAttribute("data-viewport-center")).not.toBe(beforeCenter)
  })

  it("adds a point through the domain operation path", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    expect(screen.getByRole("img", { name: "几何画布" }).querySelectorAll('[data-primitive-type="point"]').length).toBeGreaterThan(0)
  })

  it("creates a persistent point annotation from the property bar", () => {
    const previousDocument = useSceneStore.getState().document
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    fireEvent.click(screen.getAllByText("A", { selector: ".object-name" }).at(-1)!)
    openInspectorSection("外观样式")
    fireEvent.change(screen.getByRole("textbox", { name: "标注文本" }), { target: { value: "A" } })
    fireEvent.click(screen.getByRole("button", { name: "添加点标注" }))

    const canvas = screen.getByRole("img", { name: "几何画布" })
    expect(canvas.querySelector('[data-annotation-id] text')?.textContent).toBe("A")
    expect(screen.getByRole("button", { name: "删除标注 A" })).toBeTruthy()
    useSceneStore.getState().replace(previousDocument)
  })

  it("assigns sequential point labels for classroom-style constructions", () => {
    const previousDocument = useSceneStore.getState().document
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))

    expect(screen.getAllByText("A", { selector: ".object-name" }).length).toBeGreaterThan(0)
    expect(screen.getAllByText("B", { selector: ".object-name" }).length).toBeGreaterThan(0)
    expect(screen.getAllByText("C", { selector: ".object-name" }).length).toBeGreaterThan(0)
    expect(useSceneStore.getState().document.primitives.filter((primitive) => primitive.type === "point").map((primitive) => primitive.label)).toEqual(["A", "B", "C"])
    useSceneStore.getState().replace(previousDocument)
  })

  it("renames a selected primitive from the default data section", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    fireEvent.click(screen.getAllByText("A", { selector: ".object-name" })[0])

    // 重命名入口必须落在默认可见的「几何参数」区，而不是需要先展开的「外观样式」。
    expect(screen.getByRole("button", { name: "几何参数" }).getAttribute("aria-expanded")).toBe("true")
    const nameField = screen.getByRole("textbox", { name: "图元名称" }) as HTMLInputElement
    expect(nameField.value).toBe("A")
    fireEvent.change(nameField, { target: { value: "顶点 A1" } })

    expect(useSceneStore.getState().document.primitives.find((primitive) => primitive.type === "point")?.label).toBe("顶点 A1")
    expect(screen.getAllByText("顶点 A1").length).toBeGreaterThan(0)
  })

  it("connects two selected points with a live segment reference", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    const pointRows = pointObjectRows()
    const [first, second] = pointRows.slice(-2)
    fireEvent.click(first)
    fireEvent.click(second, { shiftKey: true })

    fireEvent.click(screen.getByRole("button", { name: "连接选中点" }))

    expect(screen.getByRole("img", { name: "几何画布" }).querySelector('[data-primitive-type="connection"]')).toBeTruthy()
  })

  /**
   * 连接线段只存两个点的引用，所以画布上的线段必须随着端点移动而重新定位。
   * 这里用改坐标的方式移动端点（而不是拖拽），断言渲染出来的线段几何确实变了。
   */
  it("keeps a connection segment attached when one of its points moves", () => {
    render(<App />)
    const placePoint = (x: string, y: string) => {
      fireEvent.click(screen.getByRole("button", { name: "添加点" }))
      fireEvent.click(pointObjectRows().at(-1)!)
      fireEvent.change(screen.getByRole("spinbutton", { name: "点 X" }), { target: { value: x } })
      fireEvent.change(screen.getByRole("spinbutton", { name: "点 Y" }), { target: { value: y } })
    }
    placePoint("0", "0")
    placePoint("4", "0")

    const rows = pointObjectRows()
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { shiftKey: true })
    fireEvent.click(screen.getByRole("button", { name: "连接选中点" }))

    const canvas = screen.getByRole("img", { name: "几何画布" })
    const segment = () => canvas.querySelector('[data-primitive-type="connection"] line:not([data-hit-target="true"])')!
    const geometry = () => {
      const element = segment()
      return [element.getAttribute("x1"), element.getAttribute("y1"), element.getAttribute("x2"), element.getAttribute("y2")].join(",")
    }
    const before = geometry()

    // Move the second point up by editing its Y: the segment must be re-derived from the points.
    fireEvent.click(pointObjectRows()[1])
    fireEvent.change(screen.getByRole("spinbutton", { name: "点 Y" }), { target: { value: "3" } })
    expect(geometry()).not.toBe(before)
  })

  /**
   * 用户反馈："动点（绑定）的内容完全没有提示，我也不知道如何将点固定到我创立的曲线或直线轨迹上面。"
   * 能力一直都在属性栏（「路径绑定」下拉 + 路径参数 + 记录轨迹），缺的是一句话把它说出来。
   */
  it("tells the user how to bind a selected point to a curve", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    fireEvent.click(pointObjectRows().at(-1)!)

    const statusPrompt = () => screen.getByRole("status", { name: "操作提示" }).textContent ?? ""
    // 默认平面文档里已经有一条直线可绑：提示要点名「路径绑定」和「动点」这两个词。
    expect(statusPrompt()).toContain("路径绑定")
    expect(statusPrompt()).toContain("动点")

    // 绑定之后：状态栏说明三种等价用法（拖动 / 路径参数 / 记录轨迹）。
    const pathSelect = screen.getByRole("combobox", { name: "点路径绑定" }) as HTMLSelectElement
    fireEvent.change(pathSelect, { target: { value: Array.from(pathSelect.options).find((option) => option.value)!.value } })

    expect(statusPrompt()).toContain("路径参数")
    expect(statusPrompt()).toContain("记录轨迹")
  })

  /**
   * 完整场景：一个**被约束在曲线上的动点** + 另一个点 → 连成线段 → 在画布上拖动动点。
   * 这条把三件事串在一起断言：把自由点变成动点、按点建连接、以及拖动时线段跟着端点走。
   */
  it("connects a curve-bound dynamic point to another point and follows it while dragging", () => {
    render(<App />)
    // 1. Bind the first point to the first available path (the x-axis line) so it becomes a dynamic point.
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    fireEvent.click(pointObjectRows().at(-1)!)
    const pathSelect = screen.getByRole("combobox", { name: "点路径绑定" }) as HTMLSelectElement
    fireEvent.change(pathSelect, { target: { value: Array.from(pathSelect.options).find((option) => option.value)!.value } })
    const dynamicId = useSceneStore.getState().document.primitives.find((primitive) => primitive.type === "point")!.id
    // Park it at t = 1, i.e. the line's own b, which is well inside the viewport.
    fireEvent.change(screen.getByRole("spinbutton", { name: "路径参数" }), { target: { value: "1" } })

    // 2. A second, free point.
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    fireEvent.click(pointObjectRows().at(-1)!)
    fireEvent.change(screen.getByRole("spinbutton", { name: "点 X" }), { target: { value: "0" } })
    fireEvent.change(screen.getByRole("spinbutton", { name: "点 Y" }), { target: { value: "0" } })

    // 3. Connect the two points with a segment.
    const rows = pointObjectRows()
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { shiftKey: true })
    fireEvent.click(screen.getByRole("button", { name: "连接选中点" }))

    const canvas = screen.getByRole("img", { name: "几何画布" })
    const segmentGeometry = () => {
      const element = canvas.querySelector('[data-primitive-type="connection"] line:not([data-hit-target="true"])')!
      return [element.getAttribute("x1"), element.getAttribute("y1"), element.getAttribute("x2"), element.getAttribute("y2")].join(",")
    }
    const before = segmentGeometry()
    expect(before).toBeTruthy()
    const dynamicBefore = useSceneStore.getState().document.primitives.find((primitive) => primitive.id === dynamicId)
    if (dynamicBefore?.type !== "point") throw new Error("dynamic point missing")
    const xBefore = dynamicBefore.x

    // 4. Drag the dynamic point on the canvas: it slides along its curve and the segment follows.
    const handle = canvas.querySelector('[data-primitive-type="point"] circle[data-hit-target="true"]')!
    const cx = Number(handle.getAttribute("cx"))
    const cy = Number(handle.getAttribute("cy"))
    fireEvent.pointerDown(handle, { clientX: cx, clientY: cy, pointerId: 3 })
    fireEvent.pointerMove(canvas, { clientX: cx + 70, clientY: cy + 20, pointerId: 3 })
    fireEvent.pointerUp(canvas, { clientX: cx + 70, clientY: cy + 20, pointerId: 3 })

    const dragged = useSceneStore.getState().document.primitives.find((primitive) => primitive.id === dynamicId)
    if (dragged?.type !== "point") throw new Error("dynamic point missing after drag")
    // It actually moved, it is still bound to its curve, and it stayed on that curve (y = 0).
    expect(dragged.x).not.toBeCloseTo(xBefore, 6)
    expect(dragged.binding?.kind).toBe("onPath")
    expect(dragged.y).toBeCloseTo(0, 6)
    // ...and the rendered segment was re-derived from the new endpoint positions.
    expect(segmentGeometry()).not.toBe(before)
  })

  it("requires a third point for a parabola connection", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    const pointRows = pointObjectRows().slice(-3)
    fireEvent.click(pointRows[0])
    fireEvent.click(pointRows[1], { shiftKey: true })
    fireEvent.click(pointRows[2], { shiftKey: true })

    fireEvent.click(screen.getByRole("button", { name: "创建三点抛物线" }))

    expect(screen.getByRole("img", { name: "几何画布" }).querySelector('[data-connection-kind="parabola"]')).toBeTruthy()
  })

  /**
   * 椭圆可以作为动点的约束曲线：参数是离心角 θ = 2πt，与圆的约定一致。
   * 抛物线与双曲线不在此列（无界自然参数没有规范的归一化映射），所以下拉里只能找到椭圆。
   */
  it("binds a selected point to an ellipse path and records its locus", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加椭圆" }))
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    fireEvent.click(pointObjectRows().at(-1)!)

    const pathSelect = screen.getByRole("combobox", { name: "点路径绑定" }) as HTMLSelectElement
    const ellipseOption = Array.from(pathSelect.options).find((option) => option.textContent?.includes("椭圆"))
    expect(ellipseOption).toBeTruthy()
    // Only the ellipse is bindable among the conics.
    expect(Array.from(pathSelect.options).some((option) => option.textContent?.includes("抛物线"))).toBe(false)
    fireEvent.change(pathSelect, { target: { value: ellipseOption!.value } })

    const parameterInput = screen.getByRole("spinbutton", { name: "路径参数" }) as HTMLInputElement
    expect(parameterInput).toBeTruthy()
    // X/Y stop being hand-editable once the point is constrained.
    expect((screen.getByRole("spinbutton", { name: "点 X" }) as HTMLInputElement).disabled).toBe(true)

    // t = 0.25 → θ = π/2, the top of the default ellipse.
    fireEvent.change(parameterInput, { target: { value: "0.25" } })
    expect(parameterInput.value).toBe("0.25")

    fireEvent.click(screen.getByRole("button", { name: "记录轨迹" }))
    expect(screen.getByRole("img", { name: "几何画布" }).querySelector('[data-primitive-type="locus"]')).toBeTruthy()
  })

  /**
   * 动点的核心交互：在画布上拖动一个被约束的点，它必须**沿曲线滑动**并保持约束。
   * 修复前这个拖拽会被静默丢弃 —— 增量被加到了 x/y 上，紧接着重算又用旧参数把坐标覆盖回去。
   */
  it("drags a point bound to a line along that line on the canvas", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    fireEvent.click(pointObjectRows().at(-1)!)

    // Bind to the first available path, which is the x-axis line y = 0.
    const pathSelect = screen.getByRole("combobox", { name: "点路径绑定" }) as HTMLSelectElement
    const lineOption = Array.from(pathSelect.options).find((option) => option.value)
    fireEvent.change(pathSelect, { target: { value: lineOption!.value } })

    const findPoint = () => useSceneStore.getState().document.primitives.find((primitive) => primitive.type === "point")
    const before = findPoint()
    if (before?.type !== "point") throw new Error("point missing")

    const canvas = screen.getByRole("img", { name: "几何画布" })
    const pointElement = canvas.querySelector('[data-primitive-type="point"]')
    expect(pointElement).toBeTruthy()
    fireEvent.pointerDown(pointElement!, { clientX: 400, clientY: 220, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 470, clientY: 260, pointerId: 1 })
    fireEvent.pointerUp(canvas, { clientX: 470, clientY: 260, pointerId: 1 })

    const after = findPoint()
    if (after?.type !== "point") throw new Error("point missing after drag")
    // It actually moved...
    expect(after).not.toEqual(before)
    // ...and it is still exactly on the line it is bound to (y = 0), so the constraint held.
    expect(after.y).toBeCloseTo(0, 6)
    expect(after.binding?.kind === "onPath" ? after.binding.parameter : null).not.toBeCloseTo(
      before.binding?.kind === "onPath" ? before.binding.parameter : -1,
      6
    )
  })

  /**
   * 动点必须有自己的驱动参数：绑定后不能再去借用文档里第一个参数（在圆锥曲线工作区就是 `slope`）。
   * 借用的后果是「路径参数」输入框完全失效（求值只认 parameterId 指向的那个参数）、
   * 而且拖点会把无关的直线一起转起来。
   */
  it("gives a bound point its own driving parameter and decouples it from the slope", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    fireEvent.click(pointObjectRows().at(-1)!)

    const pathSelect = screen.getByRole("combobox", { name: "点路径绑定" }) as HTMLSelectElement
    const lineOption = Array.from(pathSelect.options).find((option) => option.value)
    fireEvent.change(pathSelect, { target: { value: lineOption!.value } })

    const document = () => useSceneStore.getState().document
    const point = document().primitives.find((primitive) => primitive.type === "point")
    if (point?.type !== "point" || point.binding?.kind !== "onPath") throw new Error("binding missing")

    // Its own parameter, not the shared slope parameter.
    const parameterId = point.binding.parameterId
    expect(parameterId).toBeTruthy()
    expect(parameterId).not.toBe("slope")
    expect(document().parameters[parameterId!]).toBeTruthy()

    // The parameter box now actually drives the point.
    const slopeBefore = document().parameters.slope?.value
    const xBefore = point.x
    fireEvent.change(screen.getByRole("spinbutton", { name: "路径参数" }), { target: { value: "0.8" } })

    const moved = document().primitives.find((primitive) => primitive.type === "point")
    if (moved?.type !== "point") throw new Error("point missing")
    expect(moved.x).not.toBeCloseTo(xBefore, 6)
    // ...and it left the shared slope parameter alone.
    expect(document().parameters.slope?.value).toBeCloseTo(slopeBefore ?? 0, 9)

    // The locus sweeps that same dedicated parameter over the curve's natural window.
    // The first bindable path is the x-axis line, whose parameter is the affine ratio t,
    // so the window is ±2 in units of the a→b segment.
    fireEvent.click(screen.getByRole("button", { name: "记录轨迹" }))
    const locus = document().primitives.find((primitive) => primitive.type === "locus")
    expect(locus?.type === "locus" ? locus.parameterId : null).toBe(parameterId)
    expect(locus?.type === "locus" ? locus.domain : null).toEqual([-2, 2])
  })

  /**
   * 「动效演示」栏已按用户要求**删除**（原话："我觉得可以把动态演示的栏目删掉"）：
   * 播放时只看得到起始与结束两帧，与其修不如去掉。删掉之后动点仍然由三条通路驱动，
   * 这条用例钉住"面板确实没了"，并确认剩下的驱动通路仍然打在**动点自己的参数**上
   *（不是那条无关的直线）。
   */
  it("has no animation panel, and still drives the dynamic point from its own parameter", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    fireEvent.click(pointObjectRows().at(-1)!)
    const pathSelect = screen.getByRole("combobox", { name: "点路径绑定" }) as HTMLSelectElement
    fireEvent.change(pathSelect, { target: { value: Array.from(pathSelect.options).find((option) => option.value)!.value } })

    const document = () => useSceneStore.getState().document
    const pointBefore = document().primitives.find((primitive) => primitive.type === "point")
    if (pointBefore?.type !== "point" || pointBefore.binding?.kind !== "onPath") throw new Error("binding missing")
    const parameterId = pointBefore.binding.parameterId!
    const slopeBefore = document().parameters.slope.value

    // 面板与它的三个控件都不在了。
    expect(screen.queryByRole("button", { name: "动效演示" })).toBeNull()
    expect(screen.queryByRole("button", { name: "播放动画" })).toBeNull()
    expect(screen.queryByRole("button", { name: "停止动画" })).toBeNull()
    expect(screen.queryByRole("slider", { name: "动画参数" })).toBeNull()

    // 剩下的驱动通路仍然改**这个动点自己的参数**：改「路径参数」即可，直线斜率不受影响。
    const slider = screen.getByLabelText("路径参数") as HTMLInputElement
    expect(Number(slider.value)).toBeCloseTo(document().parameters[parameterId].value, 6)
    fireEvent.change(slider, { target: { value: "0.9" } })
    const pointAfter = document().primitives.find((primitive) => primitive.type === "point")
    if (pointAfter?.type !== "point") throw new Error("point missing")
    expect(pointAfter.x).not.toBeCloseTo(pointBefore.x, 6)
    expect(document().parameters.slope.value).toBeCloseTo(slopeBefore, 9)
  })

  /**
   * 平面测量此前完全没有入口（`measurementOptionsFor` 对非 geometry3d 直接返回空），
   * 所以画布上选两个点根本看不到"长度"按钮。这里验证入口与落库。
   */
  it("offers planar measurements for two selected points", () => {
    render(<App />)
    // Two points at the same default spot would be a degenerate length, so place them properly.
    const placePoint = (x: string, y: string) => {
      fireEvent.click(screen.getByRole("button", { name: "添加点" }))
      fireEvent.click(pointObjectRows().at(-1)!)
      fireEvent.change(screen.getByRole("spinbutton", { name: "点 X" }), { target: { value: x } })
      fireEvent.change(screen.getByRole("spinbutton", { name: "点 Y" }), { target: { value: y } })
    }
    placePoint("0", "0")
    placePoint("3", "4")

    const rows = pointObjectRows()
    expect(rows.length).toBeGreaterThanOrEqual(2)
    // One point alone offers nothing; two planar points offer a length.
    fireEvent.click(rows[0])
    expect(screen.queryByLabelText("平面测量工具")).toBeNull()
    fireEvent.click(rows[1], { shiftKey: true })
    expect(screen.getByLabelText("平面测量工具")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "长度" }))
    const measurements = useSceneStore.getState().document.measurements
    expect(measurements).toHaveLength(1)
    expect(measurements[0].metric).toBe("length")
    expect(measurements[0].sourceIds).toHaveLength(2)
    // The 3-4-5 triangle: the reading comes from the planar evaluator, not left undefined.
    expect(measurements[0].status).toBe("valid")
    expect(measurements[0].value).toBeCloseTo(5, 6)
  })

  /**
   * 新建实体的默认落点：四个模板**都坐在地面上**（底面正好在 z = 0、整体不低于地面），
   * 而且四个的**水平足迹互不重叠**。
   *
   * 用户反馈："你的立体几何内容好像原点位置错了，图有点怪。" 一量就发现四个模板各用一套约定：
   * 立方体 / 棱锥"中心在原点"（于是**一半埋在地面下**），圆柱躺在地面上，圆锥还**悬空** 3 格；
   * 而且立方体与棱锥的水平足迹本来就**互相重叠**（x ∈ [−2,0] 相交），先后添加两个会直接穿在一起。
   * 这里断的是**性质**（在地面上、互不重叠），不是某个具体坐标——以后调整默认位置也不会假红。
   */
  it("places every default template on the ground, with no horizontal overlap", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到立体几何" }))
    for (const name of ["添加立方体", "添加棱锥", "添加圆柱", "添加圆锥"]) fireEvent.click(screen.getByRole("button", { name }))

    const primitives = useSceneStore.getState().document.primitives
    type Solid = (typeof primitives)[number]
    const footprint = (solid: Solid | undefined) => {
      if (!solid) return null
      if (solid.type === "cube") return { minZ: solid.origin.z, maxZ: solid.origin.z + solid.size.z, minX: solid.origin.x, maxX: solid.origin.x + solid.size.x, minY: solid.origin.y, maxY: solid.origin.y + solid.size.y }
      if (solid.type === "pyramid") return { minZ: solid.baseCenter.z, maxZ: solid.baseCenter.z + solid.height, minX: solid.baseCenter.x - solid.baseSize.x / 2, maxX: solid.baseCenter.x + solid.baseSize.x / 2, minY: solid.baseCenter.y - solid.baseSize.y / 2, maxY: solid.baseCenter.y + solid.baseSize.y / 2 }
      if (solid.type === "cylinder" || solid.type === "cone") return { minZ: solid.center.z, maxZ: solid.center.z + solid.height, minX: solid.center.x - solid.radius, maxX: solid.center.x + solid.radius, minY: solid.center.y - solid.radius, maxY: solid.center.y + solid.radius }
      return null
    }

    const boxes = (["cube", "pyramid", "cylinder", "cone"] as const).map((type) => footprint(primitives.find((candidate) => candidate.type === type)))
    expect(boxes.every(Boolean)).toBe(true)
    for (const box of boxes) {
      // 底面落在地面上、整体在地面之上（不埋进地板，也不悬空）。
      expect(box!.minZ).toBeCloseTo(0, 9)
      expect(box!.maxZ).toBeGreaterThan(0)
    }
    // 两两不重叠：否则"先加一个立方体再加一个棱锥"会直接穿在一起。
    for (let first = 0; first < boxes.length; first += 1) {
      for (let second = first + 1; second < boxes.length; second += 1) {
        const a = boxes[first]!
        const b = boxes[second]!
        const overlaps = Math.min(a.maxX, b.maxX) > Math.max(a.minX, b.minX) && Math.min(a.maxY, b.maxY) > Math.max(a.minY, b.minY)
        expect({ pair: `${first}-${second}`, overlaps }).toEqual({ pair: `${first}-${second}`, overlaps: false })
      }
    }
  })

  /**
   * 抛物线与双曲线的轴向参数是无界的，所以绑定自带一个可编辑的「参数域」作为扫描窗口。
   * 之前这两类曲线根本不在下拉里（选了也不会动），这一条验证入口 + 域编辑 + 窗口联动。
   */
  it("binds a selected point to a parabola and lets its parameter domain be widened", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加抛物线" }))
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    fireEvent.click(pointObjectRows().at(-1)!)

    const pathSelect = screen.getByRole("combobox", { name: "点路径绑定" }) as HTMLSelectElement
    const parabolaOption = Array.from(pathSelect.options).find((option) => option.textContent?.includes("抛物线"))
    expect(parabolaOption).toBeTruthy()
    fireEvent.change(pathSelect, { target: { value: parabolaOption!.value } })

    // A conic binding carries an editable domain because its axial parameter is unbounded.
    const lower = screen.getByRole("spinbutton", { name: "参数域起" }) as HTMLInputElement
    const upper = screen.getByRole("spinbutton", { name: "参数域止" }) as HTMLInputElement
    expect(Number(upper.value)).toBeGreaterThan(Number(lower.value))

    const point = useSceneStore.getState().document.primitives.find((primitive) => primitive.type === "point")
    if (point?.type !== "point" || point.binding?.kind !== "onPath") throw new Error("binding missing")
    expect(point.binding.domain).toBeTruthy()

    // Widening the domain must widen the point's own parameter input too, otherwise the window edit is cosmetic.
    fireEvent.change(upper, { target: { value: "12" } })
    const widened = useSceneStore.getState().document.primitives.find((primitive) => primitive.id === point.id)
    expect(widened?.type === "point" && widened.binding?.kind === "onPath" ? widened.binding.domain?.[1] : null).toBe(12)
    expect((screen.getByLabelText("路径参数") as HTMLInputElement).max).toBe("12")
  })

  /**
   * 驱动参数的生命周期与可见性：绑定产生的参数要出现在「参数」面板里、标注它的归属、
   * 能被驱动，并在归属对象被删除时被回收 —— 而手工创建的参数不受影响。
   */
  it("shows the dynamic point's driver parameter and reclaims it with its point", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    fireEvent.click(pointObjectRows().at(-1)!)
    const pathSelect = screen.getByRole("combobox", { name: "点路径绑定" }) as HTMLSelectElement
    fireEvent.change(pathSelect, { target: { value: Array.from(pathSelect.options).find((option) => option.value)!.value } })

    const document = () => useSceneStore.getState().document
    const parameterId = Object.keys(document().parameters).find((id) => id.startsWith("t-"))
    expect(parameterId).toBeTruthy()
    // It is marked as generated by the point, which is what makes the cleanup safe.
    expect(document().parameters[parameterId!].ownerId).toBeTruthy()

    // It is listed in the parameter panel and attributed to its owner.
    expect(screen.getByLabelText(`参数值 ${parameterId}`)).toBeTruthy()
    expect(screen.getByText(/驱动/)).toBeTruthy()

    // Driving it moves the point: the first bindable path is the x-axis line, parameter = affine ratio.
    const before = document().primitives.find((primitive) => primitive.type === "point")
    fireEvent.change(screen.getByLabelText(`参数值 ${parameterId}`), { target: { value: "1.5" } })
    expect(document().primitives.find((primitive) => primitive.type === "point")).not.toEqual(before)

    // A hand-made parameter has no owner and must survive the point's deletion.
    fireEvent.click(screen.getByRole("button", { name: "新建参数" }))
    expect(Object.keys(document().parameters)).toContain("p1")

    fireEvent.click(pointObjectRows().at(-1)!)
    fireEvent.click(screen.getByRole("button", { name: "快速删除对象" }))
    // The generated driver parameter is reclaimed; the hand-made one (and the demo's own slope) stay.
    const remaining = Object.keys(document().parameters)
    expect(remaining).toContain("p1")
    expect(remaining.some((id) => id.startsWith("t-"))).toBe(false)
  })

  /**
   * 用户视角的那条规则：删掉一个图形，它带来的交点跟着一起消失，
   * **不需要**先去把交点删掉。删除前先断言交点确实存在，否则测试可能空过。
   */
  it("deletes a line together with its intersection in a single action", () => {
    render(<App />)
    const ids = () => useSceneStore.getState().document.primitives.map((primitive) => primitive.id)
    // The demo document ships with a parameter line crossing the x-axis, so an intersection exists.
    expect(ids()).toContain("intersection-main")

    fireEvent.click(screen.getAllByText("y = 0")[0])
    fireEvent.click(screen.getByRole("button", { name: "快速删除对象" }))

    expect(ids()).not.toContain("line-axis")
    expect(ids()).not.toContain("intersection-main")
    // The other line that met it at that point survives — only the deleted shape's dependents go.
    expect(ids()).toContain("line-slope")
    // No refusal error was shown.
    expect(screen.queryByText(/referenced by another object/)).toBeNull()
  })

  it("binds a selected point to a path from the property bar", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    const pointRows = pointObjectRows()
    fireEvent.click(pointRows.at(-1)!)
    const pathSelect = screen.getByRole("combobox", { name: "点路径绑定" }) as HTMLSelectElement
    const pathOption = Array.from(pathSelect.options).find((option) => option.value)
    expect(pathOption).toBeTruthy()
    fireEvent.change(pathSelect, { target: { value: pathOption!.value } })

    expect(screen.getByRole("spinbutton", { name: "路径参数" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "记录轨迹" }))
    expect(screen.getByRole("img", { name: "几何画布" }).querySelector('[data-primitive-type="locus"]')).toBeTruthy()
  })

  it("creates and edits a circle through the canvas and properties", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加圆" }))
    const canvas = screen.getByRole("img", { name: "几何画布" })
    fireEvent.click(canvas, { clientX: 400, clientY: 140 })
    fireEvent.click(canvas, { clientX: 508, clientY: 140 })

    expect(screen.getAllByText("圆 1")).toHaveLength(3)
    // `[data-shape-centre]` 是圆心那个小圆点（不是曲线本体），数曲线时要排掉它。
    expect(canvas.querySelectorAll('g[data-primitive-type="circle"] > circle:not([data-hit-target="true"]):not([data-shape-centre])')).toHaveLength(1)
    fireEvent.change(screen.getByRole("spinbutton", { name: "半径" }), { target: { value: "4" } })
    expect((screen.getByRole("spinbutton", { name: "半径" }) as HTMLInputElement).value).toBe("4")
    openInspectorSection("外观样式")
    fireEvent.change(screen.getByLabelText("线条颜色"), { target: { value: "#ff0000" } })
    expect(canvas.querySelector('g[data-primitive-type="circle"] > circle:not([data-hit-target="true"]):not([data-shape-centre])')?.getAttribute("stroke")).toBe("#ff0000")
  })

  it("creates an arc from center, start, and end clicks", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加圆弧" }))
    const canvas = screen.getByRole("img", { name: "几何画布" })
    fireEvent.click(canvas, { clientX: 400, clientY: 140 })
    fireEvent.click(canvas, { clientX: 544, clientY: 140 })
    fireEvent.click(canvas, { clientX: 400, clientY: 20 })

    expect(screen.getAllByText("圆弧 1")).toHaveLength(2)
    expect(canvas.querySelectorAll('[data-primitive-type="arc"] path:not([data-hit-target="true"])')).toHaveLength(1)
  })

  it("creates and edits a line through the canvas and properties", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加直线" }))
    const canvas = screen.getByRole("img", { name: "几何画布" })
    fireEvent.click(canvas, { clientX: 220, clientY: 200 })
    fireEvent.click(canvas, { clientX: 580, clientY: 80 })

    expect(screen.getAllByText("直线 1")).toHaveLength(2)
    expect(canvas.querySelectorAll("line").length).toBeGreaterThan(23)
    fireEvent.change(screen.getByRole("spinbutton", { name: "端点 A X" }), { target: { value: "-5" } })
    expect((screen.getByRole("spinbutton", { name: "端点 A X" }) as HTMLInputElement).value).toBe("-5")
  })

  it("creates and edits a segment through the canvas and properties", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加线段" }))
    const canvas = screen.getByRole("img", { name: "几何画布" })
    fireEvent.click(canvas, { clientX: 292, clientY: 200 })
    fireEvent.click(canvas, { clientX: 508, clientY: 80 })

    expect(screen.getAllByText("线段 1")).toHaveLength(2)
    expect(canvas.querySelectorAll('[data-primitive-type="segment"]')).toHaveLength(1)
    fireEvent.change(screen.getByRole("spinbutton", { name: "端点 B Y" }), { target: { value: "3" } })
    expect((screen.getByRole("spinbutton", { name: "端点 B Y" }) as HTMLInputElement).value).toBe("3")
  })

  it("creates and edits a ray through the canvas and properties", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加射线" }))
    const canvas = screen.getByRole("img", { name: "几何画布" })
    fireEvent.click(canvas, { clientX: 220, clientY: 200 })
    fireEvent.click(canvas, { clientX: 580, clientY: 80 })

    expect(screen.getAllByText("射线 1")).toHaveLength(2)
    expect(canvas.querySelectorAll('[data-primitive-type="ray"]')).toHaveLength(1)
    fireEvent.change(screen.getByRole("spinbutton", { name: "起点 A X" }), { target: { value: "-4" } })
    expect((screen.getByRole("spinbutton", { name: "起点 A X" }) as HTMLInputElement).value).toBe("-4")
  })

  it("creates and edits a polyline through the canvas and properties", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加折线" }))
    const canvas = screen.getByRole("img", { name: "几何画布" })
    fireEvent.click(canvas, { clientX: 220, clientY: 200 })
    fireEvent.click(canvas, { clientX: 400, clientY: 100 })
    fireEvent.click(canvas, { clientX: 580, clientY: 220 })
    fireEvent.doubleClick(canvas, { clientX: 650, clientY: 140 })

    expect(screen.getAllByText("折线 1")).toHaveLength(2)
    expect(canvas.querySelectorAll('[data-primitive-type="polyline"]')).toHaveLength(1)
    fireEvent.change(screen.getByRole("spinbutton", { name: "顶点 2 X" }), { target: { value: "-2" } })
    expect((screen.getByRole("spinbutton", { name: "顶点 2 X" }) as HTMLInputElement).value).toBe("-2")
  })

  it("adds and edits conic curves in the workbench", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加抛物线" }))
    expect(screen.getAllByText("抛物线 1")).toHaveLength(2)
    expect(screen.getByRole("spinbutton", { name: "焦参数" })).toBeTruthy()
    fireEvent.change(screen.getByRole("spinbutton", { name: "顶点 X" }), { target: { value: "1" } })
    expect((screen.getByRole("spinbutton", { name: "顶点 X" }) as HTMLInputElement).value).toBe("1")

    fireEvent.click(screen.getByRole("button", { name: "添加椭圆" }))
    expect(screen.getAllByText("椭圆 1")).toHaveLength(2)
    expect(screen.getByRole("spinbutton", { name: "横向半径" })).toBeTruthy()
    expect(screen.getByRole("img", { name: "几何画布" }).querySelectorAll('[data-primitive-type="ellipse"]')).toHaveLength(1)

    fireEvent.click(screen.getByRole("button", { name: "添加双曲线" }))
    expect(screen.getAllByText("双曲线 1")).toHaveLength(2)
    expect(screen.getByRole("combobox", { name: "双曲线轴向" })).toBeTruthy()
    expect(screen.getByRole("img", { name: "几何画布" }).querySelectorAll('[data-primitive-type="hyperbola"]')).toHaveLength(1)
  })

  it("rotates an ellipse from the properties panel", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加椭圆" }))

    const rotation = screen.getByRole("spinbutton", { name: "椭圆旋转角度" }) as HTMLInputElement
    fireEvent.change(rotation, { target: { value: "45" } })

    expect(rotation.value).toBe("45")
    expect(screen.getByRole("img", { name: "几何画布" }).querySelector('[data-drag-handle="rotation"]')).toBeTruthy()
  })

  it("shows vertical-major ellipse foci and fill styling", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加椭圆" }))
    fireEvent.change(screen.getByRole("spinbutton", { name: "纵向半径" }), { target: { value: "5" } })
    openInspectorSection("外观样式")
    fireEvent.change(screen.getByLabelText("填充颜色"), { target: { value: "#ffff00" } })

    expect(screen.getByText(/焦点：\(0\.00, 3\.00\) \/ \(0\.00, -3\.00\)/)).toBeTruthy()
    expect(screen.getByText("F₁")).toBeTruthy()
    expect(screen.getByText("F₂")).toBeTruthy()
    const ellipseGraphs = Array.from(screen.getByRole("img", { name: "几何画布" }).querySelectorAll('[data-primitive-type="ellipse"] polyline:not([data-hit-target="true"])'))
    expect(ellipseGraphs.some((graph) => graph.getAttribute("fill") === "#ffff00")).toBe(true)
  })

  it("disables every parabola geometry control after locking", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加抛物线" }))
    fireEvent.click(screen.getByRole("button", { name: "锁定图元" }))

    expect((screen.getByRole("spinbutton", { name: "焦参数" }) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole("combobox", { name: "抛物线轴向" }) as HTMLSelectElement).disabled).toBe(true)
    expect((screen.getByRole("spinbutton", { name: "抛物线旋转角度" }) as HTMLInputElement).disabled).toBe(true)
  })

  it("applies common style properties to a selected line", () => {
    render(<App />)
    fireEvent.click(screen.getAllByText("y = 0")[0])
    openInspectorSection("外观样式")
    fireEvent.change(screen.getByLabelText("线条颜色"), { target: { value: "#ff0000" } })
    fireEvent.change(screen.getByRole("spinbutton", { name: "线宽" }), { target: { value: "7" } })
    fireEvent.change(screen.getByRole("spinbutton", { name: "透明度" }), { target: { value: "0.5" } })
    fireEvent.change(screen.getByRole("combobox", { name: "线型" }), { target: { value: "8 6" } })

    const line = screen.getByRole("img", { name: "几何画布" }).querySelector('[data-primitive-type="line"] line:not([data-hit-target="true"])')!
    expect(line.getAttribute("stroke")).toBe("#ff0000")
    expect(line.getAttribute("stroke-width")).toBe("7")
    expect(line.getAttribute("stroke-dasharray")).toBe("8 6")
    expect(line.parentElement?.getAttribute("opacity")).toBe("0.5")
  })

  it("no longer exposes play, pause, stop, or animation mode controls", () => {
    // 用户要求删掉这一栏（见上一条用例的说明）：这里显式钉住"确实没有了"，
    // 免得以后有人看到 store 里还留着预览原语就把面板加回来。
    render(<App />)
    fireEvent.click(screen.getAllByText("参数直线")[0])

    expect(screen.queryByRole("button", { name: "动效演示" })).toBeNull()
    expect(screen.queryByRole("button", { name: "播放动画" })).toBeNull()
    expect(screen.queryByRole("button", { name: "暂停动画" })).toBeNull()
    expect(screen.queryByRole("button", { name: "停止动画" })).toBeNull()
    expect(screen.queryByRole("combobox", { name: "动画模式" })).toBeNull()
  })

  it("shows pointer coordinates and creates a persistent intersection on click", () => {
    render(<App />)
    const canvas = screen.getByRole("img", { name: "几何画布" })
    fireEvent.pointerMove(canvas, { clientX: 400, clientY: 220, pointerId: 1 })
    expect(screen.getByRole("status").textContent).toContain("(0.00, 0.00)")

    fireEvent.click(screen.getByRole("button", { name: "添加圆" }))
    fireEvent.click(canvas, { clientX: 400, clientY: 220 })
    fireEvent.click(canvas, { clientX: 466, clientY: 220 })
    const preview = canvas.querySelector('[data-auto-intersection]')
    expect(preview).toBeTruthy()
    expect(preview?.querySelector('[data-hit-target="true"]')?.getAttribute("r")).toBe("14")
    /**
     * 预览标记的半径从 4 改成了 3（用户反馈"平面画布中的线都太粗了，点也还是过大"，整块一起缩小）。
     * 这里钉住的仍然是**命中区与可见标记分开**这件事：命中圆保持 14，可见标记跟着整体视觉走。
     */
    expect(preview?.querySelector('circle:not([data-hit-target="true"])')?.getAttribute("r")).toBe("3")
    expect(preview?.querySelector('[data-intersection-info="true"]')).toBeNull()
    fireEvent.click(preview!)

    expect(useSceneStore.getState().document.primitives.some((primitive) => primitive.type === "lineCircleIntersection")).toBe(true)
    expect(canvas.querySelector('[data-intersection-info="true"]')).toBeTruthy()
  })

  it("keeps the sibling intersection marker after one solution is saved", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "line-a", type: "line", a: { x: -5, y: 0 }, b: { x: 5, y: 0 }, label: "直线 A" },
      { id: "circle-a", type: "circle", center: { x: 0, y: 0 }, radius: 3, label: "圆 A" }
    ]
    useSceneStore.getState().replace(document)
    render(<App />)
    const canvas = screen.getByRole("img", { name: "几何画布" })
    expect(canvas.querySelectorAll("[data-auto-intersection]")).toHaveLength(2)

    fireEvent.click(canvas.querySelector("[data-auto-intersection]")!)

    // Saving one intersection must not hide the other crossing of the same pair; the user still has to be
    // able to promote it to a persistent point.
    expect(canvas.querySelectorAll("[data-auto-intersection]")).toHaveLength(1)
  })

  it("shows every crossing of a line and a curve instead of only the first two", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "sine", type: "function", expression: "sin(x)", domain: [-7, 7], samples: 256, label: "正弦" },
      { id: "line-a", type: "line", a: { x: -7, y: 0 }, b: { x: 7, y: 0 }, label: "直线 A" }
    ]
    useSceneStore.getState().replace(document)

    render(<App />)

    expect(screen.getByRole("img", { name: "几何画布" }).querySelectorAll("[data-auto-intersection]")).toHaveLength(5)
  })

  it("zooms the planar canvas with the wheel and the zoom controls", () => {
    render(<App />)
    const canvas = screen.getByRole("img", { name: "几何画布" })
    const scaleOf = () => Number(canvas.getAttribute("data-viewport-scale"))
    const initial = scaleOf()

    fireEvent.wheel(canvas, { deltaY: -120, clientX: 400, clientY: 220 })
    expect(scaleOf()).toBeGreaterThan(initial)

    fireEvent.click(screen.getByRole("button", { name: "放大画布" }))
    const zoomedIn = scaleOf()
    expect(zoomedIn).toBeGreaterThan(initial)

    fireEvent.click(screen.getByRole("button", { name: "缩小画布" }))
    expect(scaleOf()).toBeLessThan(zoomedIn)

    fireEvent.click(screen.getByRole("button", { name: "重置视图" }))
    expect(scaleOf()).toBeCloseTo(initial)
    expect(canvas.getAttribute("data-viewport-center")).toBe("0,0")
  })

  it("scales circles and arcs with the canvas zoom", () => {
    render(<App />)
    const canvas = screen.getByRole("img", { name: "几何画布" })
    fireEvent.click(screen.getByRole("button", { name: "添加圆" }))
    fireEvent.click(canvas, { clientX: 400, clientY: 220 })
    fireEvent.click(canvas, { clientX: 466, clientY: 220 })
    // 排掉 `[data-shape-centre]`（圆心那个小圆点，半径固定 3px，不随缩放变化）。
    const radiusOf = () => Number(canvas.querySelector('[data-primitive-type="circle"] circle:not([data-hit-target="true"]):not([data-shape-centre])')!.getAttribute("r"))
    const before = radiusOf()

    fireEvent.click(screen.getByRole("button", { name: "放大画布" }))

    expect(radiusOf()).toBeGreaterThan(before)
  })

  it("adds a simple function and applies exp and trigonometric presets", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加函数" }))

    expect(screen.getByRole("img", { name: "几何画布" }).querySelectorAll('[data-primitive-type="function"]')).toHaveLength(1)
    expect(useSceneStore.getState().document.primitives.filter((primitive) => primitive.type === "function")).toHaveLength(1)
    // The preset list is the classroom-facing way to reach exp and trigonometric curves, so it is labelled in Chinese.
    expect(screen.getByRole("option", { name: "指数函数 e^x" })).toBeTruthy()
    expect(screen.getByRole("option", { name: "正弦 sin(x)" })).toBeTruthy()

    fireEvent.change(screen.getByRole("combobox", { name: "函数预设" }), { target: { value: "exponential" } })
    expect(useSceneStore.getState().document.primitives.find((primitive) => primitive.type === "function")).toMatchObject({ expression: "e^x" })
    expect((screen.getByLabelText("函数表达式") as HTMLTextAreaElement).value).toBe("e^x")

    fireEvent.change(screen.getByRole("combobox", { name: "函数预设" }), { target: { value: "sine" } })
    expect(useSceneStore.getState().document.primitives.find((primitive) => primitive.type === "function")).toMatchObject({ expression: "sin(x)", domain: [-2 * Math.PI, 2 * Math.PI] })
  })

  it("creates a derivative, a tangent and an integral region for the selected function", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加函数" }))
    const functionRow = () => screen.getAllByText("函数 1")[0]

    fireEvent.click(screen.getByRole("button", { name: "创建导函数" }))
    const derivative = useSceneStore.getState().document.primitives.find((primitive) => primitive.type === "derivative")
    expect(derivative).toMatchObject({ type: "derivative", sourceId: "function-1", order: 1 })
    expect(derivative?.type === "derivative" && derivative.points.length).toBeGreaterThan(1)

    fireEvent.click(functionRow())
    fireEvent.click(screen.getByRole("button", { name: "创建切线" }))
    const tangent = useSceneStore.getState().document.primitives.find((primitive) => primitive.type === "tangent")
    expect(tangent).toMatchObject({ type: "tangent", sourceId: "function-1", x: 0 })
    expect(tangent?.type === "tangent" && tangent.slope).toBeCloseTo(0, 6)

    fireEvent.click(functionRow())
    fireEvent.click(screen.getByRole("button", { name: "创建积分区域" }))
    const integral = useSceneStore.getState().document.primitives.find((primitive) => primitive.type === "integral")
    expect(integral).toMatchObject({ type: "integral", sourceId: "function-1", domain: [-6, 6] })
    expect(integral?.type === "integral" && integral.area).toBeCloseTo(144, 0)
  })

  it("keeps function, derivative and integral deletable as one object", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加函数" }))
    fireEvent.click(screen.getByRole("button", { name: "创建导函数" }))
    fireEvent.click(screen.getAllByText("函数 1")[0])
    fireEvent.click(screen.getByRole("button", { name: "删除对象" }))

    expect(useSceneStore.getState().document.primitives.filter((primitive) => primitive.type === "function" || primitive.type === "derivative")).toHaveLength(0)
    expect(screen.queryAllByRole("alert")).toHaveLength(0)
  })

  it("selects and deletes a point with the keyboard", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    const pointLabelsBeforeDelete = screen.getAllByText("A", { selector: ".object-name" })
    fireEvent.click(pointLabelsBeforeDelete[0])
    expect((screen.getByRole("button", { name: "删除对象" }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.keyDown(window, { key: "Delete" })

    expect(screen.queryAllByText("A", { selector: ".object-name" })).toHaveLength(pointLabelsBeforeDelete.length - 1)
    expect((screen.getByRole("button", { name: "删除对象" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("locks a selected object and disables destructive actions", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    fireEvent.click(screen.getAllByText("A", { selector: ".object-name" })[0])
    fireEvent.click(screen.getByRole("button", { name: "锁定图元" }))

    expect(screen.getByRole("button", { name: "解锁图元" })).toBeTruthy()
    expect((screen.getByRole("button", { name: "删除对象" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("groups a multi-selection and applies batch visibility", () => {
    render(<App />)
    fireEvent.click(screen.getAllByText("y = 0")[0])
    fireEvent.click(screen.getAllByText("参数直线")[0], { shiftKey: true })

    fireEvent.click(screen.getByRole("button", { name: "创建分组" }))
    expect(screen.getByRole("button", { name: "取消分组" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: /批量(隐藏|显示)/ }))
    expect(screen.getByRole("button", { name: "显示 y = 0" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "显示 参数直线" })).toBeTruthy()
  })

  it("offers six alignment actions for a multi-selection", () => {
    render(<App />)
    fireEvent.click(screen.getAllByText("y = 0")[0])
    fireEvent.click(screen.getAllByText("参数直线")[0], { shiftKey: true })

    for (const name of ["左对齐", "右对齐", "上对齐", "下对齐", "横向居中（X）", "纵向居中（Y）"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy()
    }
  })

  it("announces a rejected batch operation", () => {
    render(<App />)
    fireEvent.click(screen.getAllByText("y = 0")[0])
    fireEvent.click(screen.getAllByText("参数直线")[0], { shiftKey: true })
    fireEvent.click(screen.getByRole("button", { name: "锁定对象" }))
    fireEvent.click(screen.getByRole("button", { name: /批量(隐藏|显示)/ }))

    expect(screen.getByRole("alert").textContent).toContain("selection contains locked object")
  })

  it("deletes a spatial point together with the measurement that depends on it", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加空间点" }))
    fireEvent.click(screen.getByRole("button", { name: "添加空间点" }))
    fireEvent.click(algebraRow("A"))
    fireEvent.click(algebraRow("B"), { shiftKey: true })
    fireEvent.click(screen.getByRole("button", { name: "距离" }))

    expect(useSceneStore.getState().document.measurements).toHaveLength(1)

    // 测量随宿主一起注销：不再要求用户"先删测量再删点"（用户确认的级联语义）。
    fireEvent.click(algebraRow("A"))
    fireEvent.keyDown(window, { key: "Delete" })
    expect(useSceneStore.getState().document.measurements).toHaveLength(0)
    expect(useSceneStore.getState().document.primitives.some((primitive) => primitive.type === "point3" && primitive.label === "A")).toBe(false)
    // 另一个点不受影响。
    expect(useSceneStore.getState().document.primitives.some((primitive) => primitive.type === "point3" && primitive.label === "B")).toBe(true)
  })

  it("creates the very solution the user clicked on a pair with more than two crossings", () => {
    const document = recomputeDerivedObjects({
      ...createEmptyDocument("conics"),
      primitives: [
        { id: "line-1", type: "line", a: { x: -10, y: 0 }, b: { x: 10, y: 0 } },
        { id: "function-1", type: "function", expression: "sin(x)", domain: [-10, 10], samples: 400 }
      ]
    })
    useSceneStore.setState({ document, workspaceDocuments: { [document.workspace]: document }, history: [], future: [], error: null, treeTab: "model", expandedIds: [], filterQuery: "" })
    render(<App />)

    const previews = () => Array.from(globalThis.document.querySelectorAll("[data-auto-intersection]"))
    expect(previews().length).toBeGreaterThan(4)

    // 点第 5 个解：旧实现把索引 clamp 成 0|1，于是建出来的点落到第 2 个解上。
    fireEvent.click(previews()[4])
    const created = useSceneStore.getState().document.primitives.filter((primitive) => primitive.type === "curveIntersection") as { solutionIndex?: number; hint?: { x: number }; x: number }[]
    expect(created).toHaveLength(1)
    expect(created[0].solutionIndex).toBe(4)
    expect(created[0].hint?.x).toBeCloseTo(created[0].x, 9)

    // 再点另一个解：得到的是**另一个**点（每个解一个独立实体）。
    fireEvent.click(previews()[1])
    const all = useSceneStore.getState().document.primitives.filter((primitive) => primitive.type === "curveIntersection") as { x: number }[]
    expect(all).toHaveLength(2)
    expect(all[0].x).not.toBeCloseTo(all[1].x, 3)
  })

  it("shows a small bottom-left guide when a feature button is clicked", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到平面几何" }))

    expect(screen.queryByRole("status", { name: "操作指引" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "添加圆弧" }))
    const hint = screen.getByRole("status", { name: "操作指引" })
    expect(hint.textContent).toContain("圆心")
    expect(hint.textContent).toContain("终点")
  })

  it("replaces the guide on the next feature click and closes it on demand", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到平面几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加折线" }))
    expect(screen.getByRole("status", { name: "操作指引" }).textContent).toContain("双击")

    fireEvent.click(screen.getByRole("button", { name: "添加函数" }))
    expect(screen.getByRole("status", { name: "操作指引" }).textContent).toContain("预设")

    fireEvent.click(screen.getByRole("button", { name: "关闭操作指引" }))
    expect(screen.queryByRole("status", { name: "操作指引" })).toBeNull()
  })

  it("dismisses the guide with Escape and clears it once a creation finishes", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到平面几何" }))
    const canvas = screen.getByRole("img", { name: "几何画布" })

    fireEvent.click(screen.getByRole("button", { name: "添加直线" }))
    fireEvent.keyDown(window, { key: "Escape" })
    expect(screen.queryByRole("status", { name: "操作指引" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "添加直线" }))
    fireEvent.click(canvas, { clientX: 220, clientY: 200 })
    fireEvent.click(canvas, { clientX: 420, clientY: 260 })
    expect(useSceneStore.getState().document.primitives.some((primitive) => primitive.type === "line")).toBe(true)
    expect(screen.queryByRole("status", { name: "操作指引" })).toBeNull()
  })

  it("clears the selection with Escape once nothing needs cancelling", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到平面几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    fireEvent.click(algebraRow("A"))
    const deleteButton = () => screen.getByRole("button", { name: "删除对象" }) as HTMLButtonElement
    expect(deleteButton().disabled).toBe(false)
    const before = useSceneStore.getState().document.primitives.length

    // Esc 分级：第一次关掉刚弹出的指引，选择保持不变；第二次才清空选择，且不动文档。
    fireEvent.keyDown(window, { key: "Escape" })
    expect(screen.queryByRole("status", { name: "操作指引" })).toBeNull()
    expect(deleteButton().disabled).toBe(false)

    fireEvent.keyDown(window, { key: "Escape" })
    expect(deleteButton().disabled).toBe(true)
    expect(useSceneStore.getState().document.primitives).toHaveLength(before)
    expect(globalThis.document.querySelectorAll(".algebra-panel .object-row.selected")).toHaveLength(0)
    expect(algebraRow("A")).toBeTruthy()
  })

  it("explains the dihedral workflow instead of only naming the measurement", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加立方体" }))
    fireEvent.click(screen.getByRole("button", { name: "展开 立方体 1 拓扑 的子对象" }))
    fireEvent.click(algebraRow("面 1"))
    fireEvent.click(algebraRow("面 3"), { shiftKey: true })
    fireEvent.click(screen.getByRole("button", { name: "二面角内角" }))

    expect(useSceneStore.getState().document.measurements).toHaveLength(1)
    const hint = screen.getByRole("status", { name: "操作指引" })
    expect(hint.textContent).toContain("公共棱")
    expect(hint.textContent).toContain("外角")
  })

  it("confirms an added space point and points at the Shift multi-select", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加空间点" }))

    expect(screen.getByRole("status", { name: "操作指引" }).textContent).toContain("Shift")
    // 成功添加只给指引，不该出现红色报错。
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("explains the two dihedral angle choices for selected faces", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加立方体" }))
    fireEvent.click(screen.getByRole("button", { name: "展开 立方体 1 拓扑 的子对象" }))
    fireEvent.click(algebraRow("面 1"))
    fireEvent.click(algebraRow("面 2"), { shiftKey: true })

    expect(globalThis.document.querySelectorAll(".object-row.selected")).toHaveLength(2)
    expect(Array.from(globalThis.document.querySelectorAll(".object-row.selected .object-dot")).map((dot) => dot.getAttribute("data-object-type"))).toEqual(["face3", "face3"])
    expect(screen.getByText(/已选两个面/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "二面角内角" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "二面角外角" })).toBeTruthy()
  })

  it("cuts point-driven topology with an ordered section boundary", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加立方体" }))
    // 断言里的角坐标是按这个立方体算的（默认落点会变），所以把原点钉住。
    for (const [axis, value] of [["X", "-2"], ["Y", "-2"], ["Z", "-1"]] as const) fireEvent.change(screen.getByRole("spinbutton", { name: `原点 ${axis}` }), { target: { value } })
    fireEvent.click(algebraRow("立方体 1 拓扑"))
    fireEvent.click(screen.getByRole("button", { name: "创建截面" }))

    const section = useSceneStore.getState().document.primitives.find((primitive) => primitive.type === "section")
    expect(section).toMatchObject({ classification: "polygon", status: "approximate", visible: true })
    const points = section?.type === "section" ? section.points : []
    // 默认剖切面是过中心的水平面（世界 Z 轴朝上）：立方体原点 (-2,-2,-1)、尺寸 4×4×2 ⇒ 切在 z = 0。
    expect(new Set(points.map((point) => `${point.x},${point.y},${point.z}`))).toEqual(new Set(["-2,-2,0", "2,-2,0", "2,2,0", "-2,2,0"]))
    // 单一连通截面只有一环。
    expect(section?.type === "section" ? section.loops : []).toHaveLength(1)
  })

  it("binds a spatial point to a host and slides it along the host parameter", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加立方体" }))
    fireEvent.click(screen.getByRole("button", { name: "添加空间点" }))

    // 绑定到立方体的一条棱（模板实体生成了 12 条 edge3）。下拉的值是 `<模式>:<图元 id>`。
    const select = screen.getByRole("combobox", { name: "点宿主绑定" }) as HTMLSelectElement
    const edgeOption = Array.from(select.options).find((option) => option.value.startsWith("host:cube-1-edge"))
    expect(edgeOption).toBeTruthy()
    fireEvent.change(select, { target: { value: edgeOption!.value } })

    const readPoint = () => useSceneStore.getState().document.primitives.find((primitive) => primitive.type === "point3" && primitive.binding?.kind === "onHost") as Extract<ReturnType<typeof createEmptyDocument>["primitives"][number], { type: "point3" }> | undefined
    const bound = readPoint()!
    expect(bound).toBeTruthy()
    const hostPrimitive = useSceneStore.getState().document.primitives.find((primitive) => primitive.id === edgeOption!.value.slice("host:".length))!
    const host = host3FromPrimitive(hostPrimitive, useSceneStore.getState().document.primitives)!
    // 绑定这一步不移动点：初始参数取的就是"点当前坐标在宿主上的最近点"。
    expect(host.residual(bound.position)).toBeCloseTo(0, 6)

    // 改宿主参数：点沿宿主滑动，而且**仍然精确落在宿主上**（参数是唯一真值）。
    const parameterField = screen.getByRole("spinbutton", { name: "宿主参数" })
    fireEvent.change(parameterField, { target: { value: "1" } })
    const moved = readPoint()!
    expect((moved.binding as { parameter: number }).parameter).toBeCloseTo(1, 6)
    expect(host.residual(moved.position)).toBeCloseTo(0, 6)

    // 解绑回到自由点：坐标字段重新可编辑，绑定被移除。
    fireEvent.change(screen.getByRole("combobox", { name: "点宿主绑定" }), { target: { value: "" } })
    const freed = useSceneStore.getState().document.primitives.find((primitive) => primitive.id === bound.id) as { binding?: { kind: string } }
    expect(freed.binding?.kind).toBe("free")
  })

  /**
   * 用户要求："动点的约束应该可以在立方体内"。
   *
   * 这里走的是完整链路：下拉里选「实体内」→ 绑定写成 `inSolid` + 包围盒比例 `uvw` →
   * 点落在立方体里 → 把参数改到越界，点被**夹回实体表面**（而不是跑到盒子外面去）。
   */
  it("constrains a spatial point inside a cube", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加立方体" }))
    // 下面断言的是"点被夹在 (±2, ±2, ±2) 这个盒子里"，所以把立方体钉回那个位置（默认落点会变）。
    for (const [axis, value] of [["X", "-2"], ["Y", "-2"], ["Z", "-1"]] as const) fireEvent.change(screen.getByRole("spinbutton", { name: `原点 ${axis}` }), { target: { value } })
    fireEvent.click(screen.getByRole("button", { name: "添加空间点" }))

    const select = screen.getByRole("combobox", { name: "点宿主绑定" }) as HTMLSelectElement
    const volumeOption = Array.from(select.options).find((option) => option.value === "solid:cube-1")
    expect(volumeOption).toBeTruthy()
    expect(volumeOption!.textContent).toContain("实体内")
    fireEvent.change(select, { target: { value: volumeOption!.value } })

    const readPoint = () => useSceneStore.getState().document.primitives.find((primitive) => primitive.type === "point3" && primitive.binding?.kind === "inSolid")
    const bound = readPoint()
    if (bound?.type !== "point3" || bound.binding?.kind !== "inSolid") throw new Error("expected an inSolid binding")
    // 默认立方体是 (-2..2)³：绑定之后点必须在里面。
    expect(Math.abs(bound.position.x)).toBeLessThanOrEqual(2 + 1e-9)
    expect(Math.abs(bound.position.y)).toBeLessThanOrEqual(2 + 1e-9)
    expect(Math.abs(bound.position.z)).toBeLessThanOrEqual(2 + 1e-9)

    // 三个体内参数都在（u / v / w）。
    for (const label of ["体内参数 u", "体内参数 v", "体内参数 w"]) expect(screen.getByRole("spinbutton", { name: label })).toBeTruthy()

    // 参数越界：点被夹回表面，而不是跑到立方体外面。
    fireEvent.change(screen.getByRole("spinbutton", { name: "体内参数 u" }), { target: { value: "9" } })
    const clamped = readPoint()
    if (clamped?.type !== "point3") throw new Error("expected the bound point")
    expect(clamped.position.x).toBeLessThanOrEqual(2 + 1e-9)
    expect(clamped.position.x).toBeGreaterThanOrEqual(-2 - 1e-9)

    // 立方体整体平移：点跟着走（参数不变，坐标随之更新）。
    const before = clamped.position
    fireEvent.click(algebraRow("立方体 1"))
    const originX = screen.getByRole("spinbutton", { name: "原点 X" }) as HTMLInputElement
    fireEvent.change(originX, { target: { value: String(Number(originX.value) + 4) } })
    const moved = readPoint()
    if (moved?.type !== "point3") throw new Error("expected the bound point")
    expect(moved.position.x - before.x).toBeCloseTo(4, 6)
  })

  it("materializes a section into independent primitives", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加立方体" }))
    fireEvent.click(algebraRow("立方体 1 拓扑"))
    fireEvent.click(screen.getByRole("button", { name: "创建截面" }))

    fireEvent.click(screen.getByRole("button", { name: "转为图元" }))

    // 只统计物化出来的那些（模板立方体自己就带 6 个 face3，不能按类型总数断言）。
    const isMaterialized = (primitive: { id: string }) => primitive.id.startsWith("section-1-")
    const materialized = useSceneStore.getState().document.primitives.filter(isMaterialized)
    expect(materialized.filter((primitive) => primitive.type === "face3")).toHaveLength(1)
    expect(materialized.filter((primitive) => primitive.type === "edge3")).toHaveLength(4)
    expect(materialized.filter((primitive) => primitive.type === "point3")).toHaveLength(4)

    // 与来源解耦：删掉截面之后物化出来的几何仍然在。
    fireEvent.click(algebraRow("截面 1"))
    fireEvent.keyDown(window, { key: "Delete" })
    const after = useSceneStore.getState().document.primitives
    expect(after.some((primitive) => primitive.type === "section")).toBe(false)
    const kept = after.filter(isMaterialized)
    expect(kept.filter((primitive) => primitive.type === "face3")).toHaveLength(1)
    expect(kept.filter((primitive) => primitive.type === "edge3")).toHaveLength(4)
  })

  it("keeps a point-driven 3D document while switching workspaces", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加立方体" }))
    fireEvent.click(algebraRow("立方体 1 拓扑"))
    fireEvent.click(screen.getByRole("button", { name: "创建截面" }))

    fireEvent.click(screen.getByRole("button", { name: "跳转到平面几何" }))
    fireEvent.click(screen.getByRole("button", { name: "跳转到立体几何" }))

    const primitives = useSceneStore.getState().document.primitives
    expect(useSceneStore.getState().document.workspace).toBe("geometry3d")
    expect(primitives.filter((primitive) => primitive.type === "point3")).toHaveLength(8)
    expect(primitives.some((primitive) => primitive.type === "polyhedron3")).toBe(true)
    expect(primitives.some((primitive) => primitive.type === "section")).toBe(true)
  })

  it("shows a WebGL fallback state instead of a silent blank 3D canvas", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到立体几何" }))

    expect(screen.getByText(/不支持 WebGL/)).toBeTruthy()
  })

  it("disables projected exports in the 3D workspace and keeps them in planar workspaces", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到立体几何" }))

    expect((screen.getByRole("button", { name: "导出 SVG" }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole("button", { name: "导出 PNG" }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole("button", { name: "导出 CSV" }) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByRole("button", { name: "跳转到平面几何" }))
    expect((screen.getByRole("button", { name: "导出 SVG" }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("explains an invalid spatial construction instead of creating objects", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到立体几何" }))
    const command = screen.getByRole("button", { name: "由选中点创建空间直线" }) as HTMLButtonElement

    expect(command.disabled).toBe(true)
    expect(command.title).toContain("Shift")
    expect(command.title).toContain("空间点")
    // 预置条件不足时给左下角操作指引（说清要选什么），而不是一条只说"选择不对"的报错。
    const hint = screen.getByRole("status", { name: "操作指引" })
    expect(hint.textContent).toContain("Shift")
    expect(hint.textContent).toContain("空间点")
    expect(screen.queryByRole("alert")).toBeNull()
    expect(useSceneStore.getState().document.primitives.some((primitive) => primitive.type === "line3")).toBe(false)
  })

  it("recolours a 3D solid and its generated topology from the property inspector", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加立方体" }))
    openInspectorSection("外观样式")

    fireEvent.change(screen.getByLabelText("线条颜色"), { target: { value: "#ff0000" } })
    fireEvent.change(screen.getByLabelText("填充颜色"), { target: { value: "#00ff00" } })

    const primitives = useSceneStore.getState().document.primitives
    expect(primitives.find((primitive) => primitive.id === "cube-1")).toMatchObject({ style: { stroke: "#ff0000", fill: "#00ff00" } })
    const faces = primitives.filter((primitive) => primitive.type === "face3")
    expect(faces.length).toBeGreaterThan(0)
    for (const face of faces) expect(face.style?.stroke).toBe("#ff0000")
    for (const face of faces) expect(face.style?.fill).toBe("#00ff00")
  })

  it("undoes and redoes one 3D construction step at a time", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "跳转到立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加立方体" }))
    expect(useSceneStore.getState().document.primitives.some((primitive) => primitive.type === "cube")).toBe(true)

    fireEvent.click(screen.getByRole("button", { name: "撤销" }))
    expect(useSceneStore.getState().document.primitives).toHaveLength(0)

    fireEvent.click(screen.getByRole("button", { name: "重做" }))
    expect(useSceneStore.getState().document.primitives.some((primitive) => primitive.type === "cube")).toBe(true)
    expect(useSceneStore.getState().document.primitives.some((primitive) => primitive.type === "polyhedron3")).toBe(true)
  })

  /**
   * 体检发现的真缺陷：打开 `.mgeo` 走 `replace()`，而 `replace()` 有意保留"当前工作区缓存"，
   * 于是**选中状态**也被留了下来。图元 id 是确定性的（每个文档都从 `point-1` 开始），
   * 所以打开一个同样含 `point-1` 的文件后，属性栏会继续编辑"打开来的那个对象"——
   * 下一次改属性就悄悄改了别人。
   */
  it("clears the selection when another document is opened", async () => {
    const current = createEmptyDocument("conics")
    current.primitives = [{ id: "point-1", type: "point", x: 1, y: 1, label: "A" }]
    useSceneStore.getState().replace(current)
    render(<App />)
    fireEvent.click(algebraRow("A"))
    expect(screen.queryByText("未选择任何图元")).toBeNull()

    const opened = createEmptyDocument("conics")
    opened.metadata = { ...opened.metadata, name: "opened" }
    opened.primitives = [{ id: "point-1", type: "point", x: 5, y: 5, label: "A" }]

    // jsdom 的 File 还没有 `text()`（浏览器都有），用 FileReader 把这个 API 补上再走真实的打开路径。
    const proto = File.prototype as unknown as { text?: () => Promise<string> }
    const originalText = proto.text
    proto.text = function readAsText(this: File) {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error)
        reader.readAsText(this)
      })
    }
    try {
      const input = globalThis.document.querySelector('input[type="file"]') as HTMLInputElement
      Object.defineProperty(input, "files", { value: [new File([encodeMgeo(opened)], "opened.mgeo", { type: "application/json" })], configurable: true })
      fireEvent.change(input)

      await waitFor(() => expect(useSceneStore.getState().document.metadata.name).toBe("opened"))
      expect(screen.getByText("未选择任何图元")).toBeTruthy()
    } finally {
      if (originalText) proto.text = originalText
      else delete proto.text
    }
  })

  /**
   * 绕定点旋转的完整链路：选一个点 + 一条圆 → 点「绕定点旋转」→ 曲线从此过这个定点。
   *
   * 这条测试把四层串起来：DSL 的 `rotationAbout`、scene-graph 的依赖与重算、
   * 画布上的定点标记与旋转手柄、检查器里的定点 / 转角读数。
   * 断言用的是**不变量**（定点到圆心的距离 = 半径），不是某个中间坐标。
   */
  it("anchors a circle on a selected point so it rotates about that fixed point", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 3, label: "圆 c" },
      // 点故意**不在**圆上：命令要把它投影到曲线上，而不是拒绝。
      { id: "point-1", type: "point", x: 5, y: 0, label: "定点 P" }
    ]
    useSceneStore.setState({ document, workspaceDocuments: { [document.workspace]: document }, history: [], future: [], error: null })
    render(<App />)

    // 命令在"没选中合适组合"时是禁用的，并给出理由。
    const command = screen.getByRole("button", { name: "绕定点旋转" }) as HTMLButtonElement
    expect(command.disabled).toBe(true)
    expect(command.title).toContain("一个点和一个圆")

    fireEvent.click(algebraRow("定点 P"))
    fireEvent.click(algebraRow("圆 c"), { shiftKey: true })
    expect((screen.getByRole("button", { name: "绕定点旋转" }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "绕定点旋转" }))

    const circle = useSceneStore.getState().document.primitives.find((primitive) => primitive.id === "circle-1")
    expect(circle?.type).toBe("circle")
    if (circle?.type !== "circle") throw new Error("expected a circle")
    // 定点被拉到圆上（原来在 (5,0)，投影到 (3,0)），并且写成了点图元引用。
    expect(circle.rotationAbout?.pivot).toEqual({ kind: "primitive", primitiveId: "point-1" })
    expect(circle.rotationAbout?.angle).toBeCloseTo(0, 9)
    expect(Math.hypot(circle.center.x - 3, circle.center.y)).toBeCloseTo(3, 9)

    // 画布上有定点标记；圆不再单独给旋转手柄（拖圆本身就是绕定点转），但半径手柄在定点那一侧。
    const canvas = screen.getByRole("img", { name: "几何画布" })
    expect(canvas.querySelector('[data-rotation-anchor="circle-1"]')).toBeTruthy()
    expect(canvas.querySelector('[data-drag-handle="rotate"]')).toBeNull()
    expect(canvas.querySelector('[data-drag-handle="radius"]')).toBeTruthy()
    // 以定点为基准的圆不画圆心小圆点（用户要求"不需要标出圆心"）。
    expect(canvas.querySelector('[data-shape-centre="circle-1"]')).toBeNull()

    // 检查器给出定点与转角（标题与 Ribbon 按钮同名，所以按读数定位而不是按文字）。
    expect(screen.getByRole("spinbutton", { name: "绕定点转角" })).toBeTruthy()
    expect(screen.getByText(/定点：point-1/)).toBeTruthy()

    // 改转角之后曲线仍过定点：这是整件事的不变量。
    fireEvent.change(screen.getByRole("spinbutton", { name: "绕定点转角" }), { target: { value: "90" } })
    const turned = useSceneStore.getState().document.primitives.find((primitive) => primitive.id === "circle-1")
    if (turned?.type !== "circle") throw new Error("expected a circle")
    const pivot = useSceneStore.getState().document.primitives.find((primitive) => primitive.id === "point-1")
    if (pivot?.type !== "point") throw new Error("expected a point")
    expect(Math.hypot(turned.center.x - pivot.x, turned.center.y - pivot.y)).toBeCloseTo(3, 9)
    expect(turned.rotationAbout?.angle).toBeCloseTo(Math.PI / 2, 9)
  })

  /**
   * 拖动**定点所在的点**：整条曲线跟着一起搬，形状与转角都不变。
   *
   * 这是一处真实缺陷的回归（由 Playwright 验收抓到）：定点是点图元引用，而重算是拿
   * "新定点 + 旧基准中心"重新解一次，只让点动、基准不动的话曲线形状就变了 ——
   * 实测圆被拖成一个不再过定点的圆（定点落进圆内部，到圆心的距离只剩半径的 0.47 倍）。
   *
   * 这条测试在**单元层**把同一个缺陷钉住：单元层跑得快，e2e 只留一条浏览器事实核对。
   */
  it("carries the curve along when the fixed point itself is dragged", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      // 曲线已经定型：绕 P 转 0.6，基准中心在原点。
      { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 3, rotation: 0.6, rotationAbout: { pivot: { kind: "primitive", primitiveId: "point-p" }, angle: 0.6, baseCenter: { x: 0, y: 0 } } },
      { id: "point-p", type: "point", x: 3, y: 0, label: "P" }
    ]
    useSceneStore.setState({ document, workspaceDocuments: { [document.workspace]: document }, history: [], future: [], error: null })
    render(<App />)

    const canvas = screen.getByRole("img", { name: "几何画布" })
    const pointHit = canvas.querySelector<SVGCircleElement>('[data-primitive-type="point"] [data-hit-target="true"]')
    expect(pointHit).toBeTruthy()
    // 直接派发指针事件：`handleDragEnd` 拿的是拖完之后的 store，所以这里也照这条路走。
    fireEvent.pointerDown(pointHit!, { clientX: 420, clientY: 260, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 380, clientY: 300, pointerId: 1 })
    fireEvent.pointerUp(canvas, { clientX: 380, clientY: 300, pointerId: 1 })

    const after = useSceneStore.getState().document
    const circle = after.primitives.find((primitive) => primitive.id === "circle-1")
    const point = after.primitives.find((primitive) => primitive.id === "point-p")
    if (circle?.type !== "circle" || point?.type !== "point") throw new Error("expected a placed circle and its pivot point")
    // 半径不变、转角不变：跟着走的是位置，不是形状。
    expect(circle.radius).toBeCloseTo(3, 9)
    expect(circle.rotationAbout?.angle).toBeCloseTo(0.6, 9)
    // 基准中心确实跟着搬了（修复前它留在原点不动，于是曲线被重新解成一个不过定点的圆）。
    const baseCenter = circle.rotationAbout!.baseCenter
    expect(Math.hypot(baseCenter.x - 0, baseCenter.y - 0)).toBeGreaterThan(0.5)
    // 不变量：定点到基准中心的距离 = 半径，且定点到**解出来的**圆心距离也 = 半径。
    expect(Math.hypot(baseCenter.x - point.x, baseCenter.y - point.y)).toBeCloseTo(3, 9)
    expect(Math.hypot(circle.center.x - point.x, circle.center.y - point.y)).toBeCloseTo(3, 9)
  })

  /**
   * 用户口径（第二次修正）：「创建一个定点后，点击定点，右侧应该出现选择创建一个"动圆"，
   * 这个动圆不需要标出圆心，但需要能够修改半径。在删除定点后，这个动圆也会跟着消失」。
   *
   * 入口因此不再依赖"选中点 + Shift 选曲线"，而是：**选中一个点 → 右侧出现「创建动圆」**。
   * 这条把整条链路钉住：入口 → 曲线以该点为基准生成 → 不画圆心 → 半径可改（定点仍在圆上）→ 删点则曲线消失。
   */
  it("creates a moving circle through the selected point, without a centre marker", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [{ id: "point-1", type: "point", x: 2, y: 1, label: "P" }]
    useSceneStore.setState({ document, workspaceDocuments: { [document.workspace]: document }, history: [], future: [], error: null })
    render(<App />)

    // 选中这个点：右侧出现「创建动圆」入口。
    fireEvent.click(algebraRow("P"))
    const create = screen.getByRole("button", { name: "创建动圆" })
    fireEvent.click(create)

    const circle = useSceneStore.getState().document.primitives.find((primitive) => primitive.type === "circle")
    expect(circle?.type).toBe("circle")
    if (circle?.type !== "circle") throw new Error("expected a circle")
    // 以这个点为基准：定点落在圆上。
    expect(circle.radius).toBeGreaterThan(0)
    expect(Math.hypot(circle.center.x - 2, circle.center.y - 1)).toBeCloseTo(circle.radius, 9)

    // 半径可改，而且改完定点仍在圆上。
    fireEvent.change(screen.getByRole("spinbutton", { name: "半径" }), { target: { value: "5" } })
    const resized = useSceneStore.getState().document.primitives.find((primitive) => primitive.id === circle.id)
    if (resized?.type !== "circle") throw new Error("expected a circle")
    expect(resized.radius).toBeCloseTo(5, 9)
    expect(Math.hypot(resized.center.x - 2, resized.center.y - 1)).toBeCloseTo(5, 9)

    // 删除定点：动圆跟着消失（不留孤儿）。走 Ribbon 的「删除对象」，与用户实际动作一致。
    fireEvent.click(algebraRow("P"))
    fireEvent.click(screen.getByRole("button", { name: "删除对象" }))
    expect(useSceneStore.getState().document.primitives.filter((primitive) => primitive.type === "circle")).toEqual([])
  })

  /**
   * 用户口径 1：「创建一条曲线后，可以点击这条曲线，右侧功能栏里应有一个选项是创建一条在这个曲线上的切线。
   * 曲线包括抛物线，双曲线，圆，椭圆。」
   *
   * 这条把入口到几何整条链路钉住：选中曲线 → 右侧出现「创建切线」→ 点下去真的得到一条切线，
   * 而且它的切点**确实在曲线上**（不是随便画一条线）。四条曲线各来一次。
   */
  it("creates a tangent on every curve type the user named, from the inspector entry point", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 3, label: "圆 C" },
      { id: "ellipse-1", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 4, radiusY: 2, label: "椭圆 E" },
      { id: "hyperbola-1", type: "hyperbola", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2, axis: "x", label: "双曲线 H" },
      { id: "parabola-1", type: "parabola", vertex: { x: 0, y: 0 }, focalParameter: 2, axis: "y", label: "抛物线 P" }
    ]
    useSceneStore.setState({ document, workspaceDocuments: { [document.workspace]: document }, history: [], future: [], error: null })
    render(<App />)

    for (const [label, id] of [["圆 C", "circle-1"], ["椭圆 E", "ellipse-1"], ["双曲线 H", "hyperbola-1"], ["抛物线 P", "parabola-1"]] as const) {
      fireEvent.click(algebraRow(label))
      const create = screen.getByRole("button", { name: "创建切线" })
      expect(create, label).toBeTruthy()
      fireEvent.click(create)
      const tangents = useSceneStore.getState().document.primitives.filter((primitive) => primitive.type === "tangent")
      const tangent = tangents.at(-1)
      if (tangent?.type !== "tangent") throw new Error(`expected a tangent on ${label}`)
      expect(tangent.sourceId, label).toBe(id)
      expect(tangent.anchor, label).toEqual({ kind: "parameter", parameter: 0, branch: 0 })
      // 重算写出的几何：切点在曲线上，切线是一条真的线段。
      expect(tangent.status, label).toBe("approximate")
      expect(Math.hypot(tangent.b.x - tangent.a.x, tangent.b.y - tangent.a.y), label).toBeGreaterThan(0)
      expect((tangent.a.x + tangent.b.x) / 2, label).toBeCloseTo(tangent.point.x, 9)
    }
    // 圆上参数 0 的切点是 (3, 0)，切线竖直 —— 这是"切线"最容易被写错的那种情形。
    const circleTangent = useSceneStore.getState().document.primitives.find((primitive) => primitive.type === "tangent" && primitive.sourceId === "circle-1")
    if (circleTangent?.type !== "tangent") throw new Error("expected the circle tangent")
    expect(circleTangent.point.x).toBeCloseTo(3, 9)
    expect(circleTangent.point.y).toBeCloseTo(0, 9)
    expect(circleTangent.vertical).toBe(true)
  })

  /**
   * 用户口径 2 的前半：「动点在轨道上能够在动点位置画切线，同时切线能根据动点位置进行动态变化。」
   *
   * 关键是**动态**：不是"按当时的位置画一条静态切线"，而是"切线跟着动点走"。
   * 所以这条用例在创建之后继续改「路径参数」，断言切线跟着挪。
   */
  it("draws a tangent at a dynamic point and keeps it there while the point slides along its track", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 3, label: "圆 C" },
      { id: "point-a", type: "point", x: 3, y: 0, label: "A", binding: { kind: "onPath", pathId: "circle-1", parameter: 0, parameterId: "t-point-a" } }
    ]
    document.parameters = { "t-point-a": { id: "t-point-a", value: 0, min: 0, max: 6.28, step: 0.05, label: "驱动 A", ownerId: "point-a" } }
    useSceneStore.setState({ document, workspaceDocuments: { [document.workspace]: document }, history: [], future: [], error: null })
    render(<App />)

    fireEvent.click(algebraRow("A"))
    const create = screen.getByRole("button", { name: "在动点处作切线" })
    // 按钮必须可用：A 已经绑在圆上，这正是用户口径描述的场景。
    expect((create as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(create)

    const created = useSceneStore.getState().document.primitives.find((primitive) => primitive.type === "tangent")
    if (created?.type !== "tangent") throw new Error("expected a tangent")
    expect(created.anchor).toEqual({ kind: "point", pointId: "point-a" })
    expect(created.point.x).toBeCloseTo(3, 9)

    // 沿轨道滑动动点：切线必须跟着走，并始终切在动点身上。
    // 新切线会被自动选中，所以先回到 A 的属性面板（「路径参数」在点那一栏里）。
    fireEvent.click(algebraRow("A"))
    fireEvent.change(screen.getByRole("spinbutton", { name: "路径参数" }), { target: { value: "1.2" } })
    const after = useSceneStore.getState().document.primitives
    const point = after.find((primitive) => primitive.id === "point-a")
    const tangent = after.find((primitive) => primitive.type === "tangent")
    if (point?.type !== "point" || tangent?.type !== "tangent") throw new Error("unexpected types")
    expect(point.x).not.toBeCloseTo(3, 3)
    expect(tangent.point.x).toBeCloseTo(point.x, 9)
    expect(tangent.point.y).toBeCloseTo(point.y, 9)
    // 切点仍在圆上，切向仍与半径垂直。
    expect(Math.hypot(tangent.point.x, tangent.point.y)).toBeCloseTo(3, 9)
    expect(point.x * (tangent.b.x - tangent.a.x) + point.y * (tangent.b.y - tangent.a.y)).toBeCloseTo(0, 9)

    // 右侧还能把切点从"跟随动点"切回"曲线参数"：切换那一刻切线必须**留在原地**
    // （参数取的是当前切点在曲线上的投影，不是切点的横坐标 —— 后者会让切线跳到别处）。
    fireEvent.click(algebraRow(tangent.label ?? tangent.id))
    fireEvent.change(screen.getByRole("combobox", { name: "切点定位方式" }), { target: { value: "parameter" } })
    const switched = useSceneStore.getState().document.primitives.find((primitive) => primitive.id === tangent.id)
    if (switched?.type !== "tangent") throw new Error("expected the tangent")
    expect(switched.anchor?.kind).toBe("parameter")
    expect(switched.point.x).toBeCloseTo(tangent.point.x, 6)
    expect(switched.point.y).toBeCloseTo(tangent.point.y, 6)

    // 然后就能把切点参数直接摆到别处（用户口径 1 里"之后可以挪切点"的那一步）。
    fireEvent.change(screen.getByRole("spinbutton", { name: "切点参数" }), { target: { value: "3.1" } })
    const moved = useSceneStore.getState().document.primitives.find((primitive) => primitive.id === tangent.id)
    if (moved?.type !== "tangent") throw new Error("expected the tangent")
    expect(moved.anchor?.kind).toBe("parameter")
    // 参数就是圆自己的极角：参数 3.1 的切点 = (3cos3.1, 3sin3.1)。
    expect(moved.point.x).toBeCloseTo(3 * Math.cos(3.1), 9)
    expect(moved.point.y).toBeCloseTo(3 * Math.sin(3.1), 9)
  })

  /**
   * 用户口径 2 的后半：「第二动点能够作为圆心作圆，圆的半径能够调节，
   * 也能够根据动点位置进行动态变化。」
   *
   * 三个阶段各断言一次：点为圆心 → 半径可改 → 半径改由另一个动点驱动（圆始终过它）。
   */
  it("builds a circle on a second dynamic point and lets its radius follow the first one", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "circle-track", type: "circle", center: { x: 0, y: 0 }, radius: 3, label: "圆 C" },
      { id: "point-a", type: "point", x: 3, y: 0, label: "A", binding: { kind: "onPath", pathId: "circle-track", parameter: 0, parameterId: "t-point-a" } },
      { id: "point-b", type: "point", x: -2, y: 0, label: "B" }
    ]
    document.parameters = { "t-point-a": { id: "t-point-a", value: 0, min: 0, max: 6.28, step: 0.05, label: "驱动 A", ownerId: "point-a" } }
    useSceneStore.setState({ document, workspaceDocuments: { [document.workspace]: document }, history: [], future: [], error: null })
    render(<App />)

    // 1. 第二动点 B 作为圆心。
    fireEvent.click(algebraRow("B"))
    fireEvent.click(screen.getByRole("button", { name: "以点为圆心作圆" }))
    const created = useSceneStore.getState().document.primitives.find((primitive) => primitive.type === "circle" && primitive.id !== "circle-track")
    if (created?.type !== "circle") throw new Error("expected a circle at the point")
    expect(created.centerPointId).toBe("point-b")
    expect(created.center).toEqual({ x: -2, y: 0 })

    // 2. 半径能直接改。
    fireEvent.change(screen.getByRole("spinbutton", { name: "半径" }), { target: { value: "2.5" } })
    const resized = useSceneStore.getState().document.primitives.find((primitive) => primitive.id === created.id)
    if (resized?.type !== "circle") throw new Error("expected the circle")
    expect(resized.radius).toBeCloseTo(2.5, 9)
    // 圆心仍然由那个点给出。
    expect(resized.center).toEqual({ x: -2, y: 0 })

    // 3. 让半径跟随动点 A：圆从此始终过 A，A 一动半径就变。
    fireEvent.change(screen.getByRole("combobox", { name: "半径随动点" }), { target: { value: "point-a" } })
    const driven = useSceneStore.getState().document.primitives.find((primitive) => primitive.id === created.id)
    if (driven?.type !== "circle") throw new Error("expected the circle")
    expect(driven.radiusFrom).toEqual({ pointId: "point-a", factor: 1 })
    expect(Math.hypot(3 - driven.center.x, 0 - driven.center.y)).toBeCloseTo(driven.radius, 9)

    // A 沿轨道滑动 → 半径跟着变，而且圆**始终经过 A**。
    // 「路径参数」在点 A 的属性栏里，所以先把选中切回 A（上一句选的是圆）。
    fireEvent.click(algebraRow("A"))
    fireEvent.change(screen.getByRole("spinbutton", { name: "路径参数" }), { target: { value: "2.2" } })
    const settled = useSceneStore.getState().document.primitives
    const point = settled.find((primitive) => primitive.id === "point-a")
    const circle = settled.find((primitive) => primitive.id === created.id)
    if (point?.type !== "point" || circle?.type !== "circle") throw new Error("unexpected types")
    expect(Math.hypot(point.x - circle.center.x, point.y - circle.center.y)).toBeCloseTo(circle.radius, 9)
    expect(circle.radius).not.toBeCloseTo(2.5, 3)

    // 倍率：半径 = 2 × 距离。（回到圆自己的面板）
    fireEvent.click(algebraRow(created.label ?? created.id))
    fireEvent.change(screen.getByRole("spinbutton", { name: "半径倍率" }), { target: { value: "2" } })
    const doubled = useSceneStore.getState().document.primitives.find((primitive) => primitive.id === created.id)
    if (doubled?.type !== "circle") throw new Error("expected the circle")
    expect(doubled.radius).toBeCloseTo(2 * Math.hypot(point.x - doubled.center.x, point.y - doubled.center.y), 9)
  })

  /**
   * 用户反馈："切线不能在曲线上自由拖动"。
   *
   * 两个根因都在这一条里钉住：
   *  1. 画布上切线那一组**根本没有 `onPointerDown`** —— 只能点选，指针按下时拖动根本不成立；
   *  2. 就算起拖了，平移一条**算出来的**切线也是空操作（切点由 `anchor` 决定，平移会立刻被重算覆盖）。
   *
   * 这里走真实手势：在切线上按下 → 移到圆上另一点 → 抬手，断言切点真的沿着圆滑过去了。
   * jsdom 里 `getBoundingClientRect()` 全为 0，于是 client 坐标**一一对应** SVG 坐标
   * （`pointToSvg` 的宽高回退到 VIEWBOX 800×440、left/top 为 0）；
   * 默认取景下世界原点在 (400, 220)，`scale = 100/3`，所以：
   *   世界 (3, 0) → client (500, 220)：圆上参数 0，切线默认的切点
   *   世界 (0, 3) → client (400, 120)：圆上参数 π/2
   */
  it("drags a curve tangent along its curve on the canvas", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 3, label: "圆 C" },
      { id: "tangent-1", type: "tangent", sourceId: "circle-1", x: 0, point: { x: 3, y: 0 }, slope: 0, a: { x: 3, y: -3 }, b: { x: 3, y: 3 }, status: "approximate", vertical: true, anchor: { kind: "parameter", parameter: 0, branch: 0 }, label: "切线 1" }
    ]
    useSceneStore.setState({ document, workspaceDocuments: { [document.workspace]: document }, history: [], future: [], error: null })
    render(<App />)

    const canvas = screen.getByRole("img", { name: "几何画布" })
    const tangentGroup = canvas.querySelector('[data-primitive-type="tangent"]')
    expect(tangentGroup, "切线必须画在画布上").toBeTruthy()

    fireEvent.pointerDown(tangentGroup!, { clientX: 500, clientY: 220, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 400, clientY: 120, pointerId: 1 })
    fireEvent.pointerUp(canvas, { clientX: 400, clientY: 120, pointerId: 1 })

    const tangent = useSceneStore.getState().document.primitives.find((primitive) => primitive.id === "tangent-1")
    if (tangent?.type !== "tangent") throw new Error("expected the tangent")
    expect(tangent.status).toBe("approximate")
    // 切点真的沿圆滑到了参数 π/2 处 —— 也就是世界坐标 (0, 3)。
    expect(tangent.point.x).toBeCloseTo(0, 6)
    expect(tangent.point.y).toBeCloseTo(3, 6)
    expect(tangent.point.x).toBeCloseTo(3 * Math.cos(Math.PI / 2), 9)
    // 定位方式仍然是"曲线参数"，没有被悄悄改成别的。
    expect(tangent.anchor?.kind).toBe("parameter")
    // 切点仍在圆上，而且切线在这一点是**水平**的（参数 π/2 处切向沿 x 轴）。
    expect(Math.hypot(tangent.point.x, tangent.point.y)).toBeCloseTo(3, 6)
    expect(tangent.vertical).toBe(false)
    expect(tangent.a.y).toBeCloseTo(tangent.b.y, 6)
  })
})

/**
 * 顶级模块骨架：模块 A（传统工作区）是默认界面，模块 B（Agent 工作区）从左侧导航栏进入。
 * 这一组用例只钉住"两个板块的边界"——谁在什么条件下渲染、切换会不会丢掉画布内容。
 */
describe("top-level modules", () => {
  beforeEach(() => {
    localStorage.clear()
    const document = createDemoDocument()
    useSceneStore.setState({ document, workspaceDocuments: { [document.workspace]: document }, history: [], future: [], error: null, treeTab: "model", expandedIds: ["sheet-1"], filterQuery: "" })
  })

  it("opens on the traditional workspace and keeps the Agent area out of the DOM", () => {
    render(<App />)

    expect(globalThis.document.querySelector(".app-shell")?.getAttribute("data-app-module")).toBe("traditional")
    expect(screen.getByRole("button", { name: "传统工作区" }).getAttribute("aria-pressed")).toBe("true")
    // 模块 A：画布、Ribbon、三个工作区入口都在；模块 B 的输入框一个都不该被渲染出来。
    expect(screen.getByRole("img", { name: "几何画布" })).toBeTruthy()
    expect(screen.getByRole("region", { name: "功能区" })).toBeTruthy()
    expect(screen.queryByRole("textbox", { name: "对话输入" })).toBeNull()
    expect(screen.queryByRole("log", { name: "对话记录" })).toBeNull()
  })

  it("switches to the Agent workspace from the rail and back again", () => {
    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "Agent 工作区" }))

    expect(globalThis.document.querySelector(".app-shell")?.getAttribute("data-app-module")).toBe("agent")
    expect(screen.getByRole("textbox", { name: "对话输入" })).toBeTruthy()
    // 模块 B 里没有 Ribbon，也没有几何画布：两块界面不会互相串场。
    expect(screen.queryByRole("region", { name: "功能区" })).toBeNull()
    expect(screen.queryByRole("img", { name: "几何画布" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "返回画布" }))

    expect(globalThis.document.querySelector(".app-shell")?.getAttribute("data-app-module")).toBe("traditional")
    expect(screen.getByRole("img", { name: "几何画布" })).toBeTruthy()
  })

  it("keeps the geometry document untouched while visiting the Agent workspace", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    const before = useSceneStore.getState().document.primitives.length

    fireEvent.click(screen.getByRole("button", { name: "Agent 工作区" }))
    fireEvent.click(screen.getByRole("button", { name: "返回画布" }))

    expect(useSceneStore.getState().document.primitives.length).toBe(before)
    expect(screen.getByRole("img", { name: "几何画布" }).querySelectorAll('[data-primitive-type="point"]').length).toBeGreaterThan(0)
  })

  it("switches workspaces from the rail without leaving the traditional module", () => {
    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "跳转到立体几何" }))

    expect(useSceneStore.getState().document.workspace).toBe("geometry3d")
    expect(globalThis.document.querySelector(".app-shell")?.getAttribute("data-app-module")).toBe("traditional")
    expect(screen.getByRole("button", { name: "跳转到立体几何" }).getAttribute("aria-pressed")).toBe("true")
  })
})
