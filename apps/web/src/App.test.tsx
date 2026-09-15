import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"

import { App } from "./App"
import { createDemoDocument } from "./demoDocument"
import { useSceneStore } from "./store"

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

describe("MathCanvas workbench", () => {
  beforeEach(() => {
    localStorage.clear()
    // `replace` deliberately keeps other workspaces' documents, so tests need a full store reset.
    const document = createDemoDocument()
    useSceneStore.setState({ document, workspaceDocuments: { [document.workspace]: document }, history: [], future: [], previewBase: null, error: null, treeTab: "model", expandedIds: ["sheet-1"], filterQuery: "" })
  })

  it("renders each workspace command from the shared Ribbon only once", () => {
    render(<App />)

    expect(screen.getAllByRole("button", { name: "添加点" })).toHaveLength(1)

    fireEvent.click(screen.getByRole("button", { name: "立体几何" }))
    expect(screen.getAllByRole("button", { name: "添加立方体" })).toHaveLength(1)

    fireEvent.click(screen.getByRole("button", { name: "工程制图" }))
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
    fireEvent.click(screen.getAllByText("新点 A")[0])

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

  it("explains when the selected object has no geometry constraints", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    fireEvent.click(screen.getAllByText("新点 A")[0])
    openInspectorSection("几何约束")

    expect(screen.getByText("暂无约束")).toBeTruthy()
    expect(screen.getByRole("button", { name: "+添加" })).toBeTruthy()
  })

  it("routes the CAD workspace to four engineering drawing views", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "工程制图" }))

    const engineeringDrawing = screen.getByRole("main", { name: "工程制图视图" })
    expect(engineeringDrawing).toBeTruthy()
    expect(engineeringDrawing.querySelectorAll("[data-drawing-view]")).toHaveLength(4)
    expect(screen.getAllByText("暂无可投影的空间对象")).toHaveLength(4)
    expect(screen.queryByRole("button", { name: "添加点" })).toBeNull()
    expect(screen.getByRole("region", { name: "工程状态栏" }).textContent).toContain("工程制图根据当前文档的 3D 点、棱和面显示四个视图。")

    expect((screen.getByRole("button", { name: "导出 SVG" }) as HTMLButtonElement).disabled).toBe(false)
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

    // The workspace stays retired, but 圆锥曲线 keeps a function entry so simple functions remain reachable there.
    fireEvent.click(screen.getByRole("button", { name: "圆锥曲线" }))
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
    fireEvent.click(screen.getByRole("button", { name: "工程制图" }))
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
    fireEvent.click(screen.getByRole("button", { name: "工程制图" }))
    fireEvent.click(screen.getByRole("tab", { name: "图层树" }))

    expect(screen.getByRole("button", { name: "几何" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "新建图层" }))
    expect(useSceneStore.getState().document.layers?.map((layer) => layer.name)).toContain("图层 1")

    fireEvent.click(screen.getByRole("button", { name: "图层 1" }))
    expect(useSceneStore.getState().document.activeLayerId).toBe("layer-1")
  })

  it("selects a sheet view from the CAD drawing tree and toggles its visibility", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "工程制图" }))
    fireEvent.click(screen.getByRole("tab", { name: "图纸树" }))

    const tree = screen.getByRole("region", { name: "模型与图纸树" })
    fireEvent.click(within(tree).getByRole("button", { name: "主视图" }))
    expect(within(tree).getByRole("button", { name: "主视图" }).getAttribute("aria-pressed")).toBe("true")

    fireEvent.click(within(tree).getByRole("button", { name: "隐藏 主视图" }))
    expect(useSceneStore.getState().document.drawingViews?.find((view) => view.id === "view-front")?.visible).toBe(false)
  })

  it("scales a projection viewport and persists the layout on the document", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "工程制图" }))

    fireEvent.click(screen.getByRole("button", { name: "放大 主视图" }))

    expect(useSceneStore.getState().document.drawingViews?.find((view) => view.id === "view-front")?.scale).toBe(1.5)
  })

  it("drafts 2D geometry into the active layer and hides it with that layer", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "工程制图" }))
    fireEvent.click(screen.getByRole("button", { name: "2D 绘图" }))
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))

    expect(useSceneStore.getState().document.primitives[0]).toMatchObject({ type: "point", layerId: "layer-geometry" })
    expect(screen.getByRole("region", { name: /模型视图/ })).toBeTruthy()

    fireEvent.click(screen.getByRole("tab", { name: "图层树" }))
    fireEvent.click(screen.getByRole("button", { name: "隐藏 几何" }))

    expect(screen.queryByRole("button", { name: /新点 A/ })).toBeNull()
  })

  it("refuses to draft on a hidden layer and explains the rejection in the status bar", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "工程制图" }))
    fireEvent.click(screen.getByRole("tab", { name: "图层树" }))
    fireEvent.click(screen.getByRole("button", { name: "隐藏 几何" }))
    fireEvent.click(screen.getByRole("button", { name: "2D 绘图" }))
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))

    expect(useSceneStore.getState().document.primitives).toHaveLength(0)
    expect(screen.getByText(/已隐藏，无法创建对象/)).toBeTruthy()
  })

  it("switches workspaces without losing each workspace document", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "圆锥曲线" }))
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    expect(screen.getAllByText("新点 A")).toHaveLength(2)

    fireEvent.click(screen.getByRole("button", { name: "立体几何" }))
    expect(screen.queryByRole("img", { name: "几何画布" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "圆锥曲线" }))
    expect(screen.getAllByText("新点 A")).toHaveLength(2)
    expect(screen.getByRole("button", { name: "圆锥曲线" }).getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: "立体几何" }))
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
    fireEvent.click(screen.getByRole("button", { name: "立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加立方体" }))

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
    fireEvent.click(screen.getByRole("button", { name: "立体几何" }))
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
    fireEvent.click(screen.getByRole("button", { name: "立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加空间点" }))

    fireEvent.change(screen.getByRole("spinbutton", { name: "坐标 X" }), { target: { value: "4" } })

    expect(useSceneStore.getState().document.primitives.filter((primitive) => primitive.type === "point3").at(-1)).toMatchObject({ position: { x: 4 } })
  })

  it("creates and edits a 3D solid from the workspace property inspector", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加立方体" }))

    expect(screen.getAllByText("立方体 1")[0]).toBeTruthy()
    expect(screen.getByText("立体几何属性")).toBeTruthy()
    fireEvent.change(screen.getByRole("spinbutton", { name: "尺寸 X" }), { target: { value: "5" } })
    expect(useSceneStore.getState().document.primitives.find((primitive) => primitive.id === "cube-1")).toMatchObject({ type: "cube", size: { x: 5 } })
  })

  it("creates point-driven 3D geometry from selected classroom points", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "立体几何" }))
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
    fireEvent.click(screen.getByRole("button", { name: "立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加空间点" }))

    fireEvent.change(screen.getByRole("spinbutton", { name: "坐标 X" }), { target: { value: "4" } })

    expect(useSceneStore.getState().document.primitives.filter((primitive) => primitive.type === "point3").at(-1)).toMatchObject({ position: { x: 4 } })
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
    fireEvent.click(screen.getAllByText("新点 A")[0])

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
    fireEvent.click(screen.getAllByText("新点 A").at(-1)!)
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

    expect(screen.getAllByText("新点 A").length).toBeGreaterThan(0)
    expect(screen.getAllByText("新点 B").length).toBeGreaterThan(0)
    expect(screen.getAllByText("新点 C").length).toBeGreaterThan(0)
    useSceneStore.getState().replace(previousDocument)
  })

  it("connects two selected points with a live segment reference", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    const pointRows = Array.from(globalThis.document.querySelectorAll(".object-row")).filter((row) => /新点 [A-Z]/.test(row.textContent ?? ""))
    const [first, second] = pointRows.slice(-2)
    fireEvent.click(first)
    fireEvent.click(second, { shiftKey: true })

    fireEvent.click(screen.getByRole("button", { name: "连接选中点" }))

    expect(screen.getByRole("img", { name: "几何画布" }).querySelector('[data-primitive-type="connection"]')).toBeTruthy()
  })

  it("requires a third point for a parabola connection", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    const pointRows = Array.from(globalThis.document.querySelectorAll(".object-row")).filter((row) => /新点 [A-Z]/.test(row.textContent ?? "")).slice(-3)
    fireEvent.click(pointRows[0])
    fireEvent.click(pointRows[1], { shiftKey: true })
    fireEvent.click(pointRows[2], { shiftKey: true })

    fireEvent.click(screen.getByRole("button", { name: "创建三点抛物线" }))

    expect(screen.getByRole("img", { name: "几何画布" }).querySelector('[data-connection-kind="parabola"]')).toBeTruthy()
  })

  it("binds a selected point to a path from the property bar", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    const pointRows = Array.from(globalThis.document.querySelectorAll(".object-row")).filter((row) => /新点 [A-Z]/.test(row.textContent ?? ""))
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
    expect(canvas.querySelectorAll('g[data-primitive-type="circle"] > circle:not([data-hit-target="true"])')).toHaveLength(1)
    fireEvent.change(screen.getByRole("spinbutton", { name: "半径" }), { target: { value: "4" } })
    expect((screen.getByRole("spinbutton", { name: "半径" }) as HTMLInputElement).value).toBe("4")
    openInspectorSection("外观样式")
    fireEvent.change(screen.getByLabelText("线条颜色"), { target: { value: "#ff0000" } })
    expect(canvas.querySelector('g[data-primitive-type="circle"] > circle:not([data-hit-target="true"])')?.getAttribute("stroke")).toBe("#ff0000")
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

  it("exposes play, pause, stop, and animation mode controls", () => {
    render(<App />)
    fireEvent.click(screen.getAllByText("参数直线")[0])
    openInspectorSection("动效演示")

    fireEvent.click(screen.getByRole("button", { name: "播放动画" }))
    expect(screen.getByRole("button", { name: "暂停动画" })).toBeTruthy()
    fireEvent.change(screen.getByRole("combobox", { name: "动画模式" }), { target: { value: "pingPong" } })
    fireEvent.click(screen.getByRole("button", { name: "暂停动画" }))
    expect(screen.getByRole("button", { name: "播放动画" })).toBeTruthy()
    expect((screen.getByRole("button", { name: "停止动画" }) as HTMLButtonElement).disabled).toBe(true)
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
    expect(preview?.querySelector('circle:not([data-hit-target="true"])')?.getAttribute("r")).toBe("4")
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
    const radiusOf = () => Number(canvas.querySelector('[data-primitive-type="circle"] circle:not([data-hit-target="true"])')!.getAttribute("r"))
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
    const pointLabelsBeforeDelete = screen.getAllByText(/新点 [A-Z]/)
    fireEvent.click(pointLabelsBeforeDelete[0])
    expect((screen.getByRole("button", { name: "删除对象" }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.keyDown(window, { key: "Delete" })

    expect(screen.queryAllByText(/新点 [A-Z]/)).toHaveLength(pointLabelsBeforeDelete.length - 2)
    expect((screen.getByRole("button", { name: "删除对象" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("locks a selected object and disables destructive actions", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    fireEvent.click(screen.getAllByText("新点 A")[0])
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

  it("creates and deletes a spatial measurement so its sources become deletable again", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加空间点" }))
    fireEvent.click(screen.getByRole("button", { name: "添加空间点" }))
    fireEvent.click(algebraRow("A"))
    fireEvent.click(algebraRow("B"), { shiftKey: true })
    openInspectorSection("几何约束")
    fireEvent.click(screen.getByRole("button", { name: "距离" }))

    expect(useSceneStore.getState().document.measurements).toHaveLength(1)
    const measurementId = useSceneStore.getState().document.measurements[0].id

    fireEvent.click(algebraRow("A"))
    fireEvent.keyDown(window, { key: "Delete" })
    expect(screen.getByRole("alert").textContent).toContain("object is referenced by another object")

    fireEvent.click(screen.getByRole("button", { name: `删除测量 ${measurementId}` }))
    expect(useSceneStore.getState().document.measurements).toHaveLength(0)

    fireEvent.click(algebraRow("A"))
    fireEvent.keyDown(window, { key: "Delete" })
    expect(useSceneStore.getState().document.primitives.some((primitive) => primitive.type === "point3" && primitive.label === "A")).toBe(false)
  })

  it("shows a small bottom-left guide when a feature button is clicked", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "圆锥曲线" }))

    expect(screen.queryByRole("status", { name: "操作指引" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "添加圆弧" }))
    const hint = screen.getByRole("status", { name: "操作指引" })
    expect(hint.textContent).toContain("圆心")
    expect(hint.textContent).toContain("终点")
  })

  it("replaces the guide on the next feature click and closes it on demand", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "圆锥曲线" }))
    fireEvent.click(screen.getByRole("button", { name: "添加折线" }))
    expect(screen.getByRole("status", { name: "操作指引" }).textContent).toContain("双击")

    fireEvent.click(screen.getByRole("button", { name: "添加函数" }))
    expect(screen.getByRole("status", { name: "操作指引" }).textContent).toContain("预设")

    fireEvent.click(screen.getByRole("button", { name: "关闭操作指引" }))
    expect(screen.queryByRole("status", { name: "操作指引" })).toBeNull()
  })

  it("dismisses the guide with Escape and clears it once a creation finishes", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "圆锥曲线" }))
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

  it("explains the dihedral workflow instead of only naming the measurement", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "立体几何" }))
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
    fireEvent.click(screen.getByRole("button", { name: "立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加空间点" }))

    expect(screen.getByRole("status", { name: "操作指引" }).textContent).toContain("Shift")
    // 成功添加只给指引，不该出现红色报错。
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("explains the two dihedral angle choices for selected faces", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加立方体" }))
    fireEvent.click(screen.getByRole("button", { name: "展开 立方体 1 拓扑 的子对象" }))
    fireEvent.click(algebraRow("面 1"))
    fireEvent.click(algebraRow("面 2"), { shiftKey: true })
    openInspectorSection("几何约束")

    expect(globalThis.document.querySelectorAll(".object-row.selected")).toHaveLength(2)
    expect(Array.from(globalThis.document.querySelectorAll(".object-row.selected .object-dot")).map((dot) => dot.getAttribute("data-object-type"))).toEqual(["face3", "face3"])
    expect(screen.getByText(/已选两个面/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "二面角内角" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "二面角外角" })).toBeTruthy()
  })

  it("cuts point-driven topology with an ordered section boundary", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加立方体" }))
    fireEvent.click(algebraRow("立方体 1 拓扑"))
    fireEvent.click(screen.getByRole("button", { name: "创建截面" }))

    const section = useSceneStore.getState().document.primitives.find((primitive) => primitive.type === "section")
    expect(section).toMatchObject({ classification: "polygon", status: "approximate", visible: true })
    const points = section?.type === "section" ? section.points : []
    expect(new Set(points.map((point) => `${point.x},${point.y},${point.z}`))).toEqual(new Set(["-2,0,-1", "2,0,-1", "2,0,1", "-2,0,1"]))
  })

  it("keeps a point-driven 3D document while switching workspaces", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加立方体" }))
    fireEvent.click(algebraRow("立方体 1 拓扑"))
    fireEvent.click(screen.getByRole("button", { name: "创建截面" }))

    fireEvent.click(screen.getByRole("button", { name: "圆锥曲线" }))
    fireEvent.click(screen.getByRole("button", { name: "立体几何" }))

    const primitives = useSceneStore.getState().document.primitives
    expect(useSceneStore.getState().document.workspace).toBe("geometry3d")
    expect(primitives.filter((primitive) => primitive.type === "point3")).toHaveLength(8)
    expect(primitives.some((primitive) => primitive.type === "polyhedron3")).toBe(true)
    expect(primitives.some((primitive) => primitive.type === "section")).toBe(true)
  })

  it("shows a WebGL fallback state instead of a silent blank 3D canvas", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "立体几何" }))

    expect(screen.getByText(/不支持 WebGL/)).toBeTruthy()
  })

  it("disables projected exports in the 3D workspace and keeps them in planar workspaces", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "立体几何" }))

    expect((screen.getByRole("button", { name: "导出 SVG" }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole("button", { name: "导出 PNG" }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole("button", { name: "导出 CSV" }) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByRole("button", { name: "圆锥曲线" }))
    expect((screen.getByRole("button", { name: "导出 SVG" }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("explains an invalid spatial construction instead of creating objects", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "立体几何" }))
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
    fireEvent.click(screen.getByRole("button", { name: "立体几何" }))
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
    fireEvent.click(screen.getByRole("button", { name: "立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加立方体" }))
    expect(useSceneStore.getState().document.primitives.some((primitive) => primitive.type === "cube")).toBe(true)

    fireEvent.click(screen.getByRole("button", { name: "撤销" }))
    expect(useSceneStore.getState().document.primitives).toHaveLength(0)

    fireEvent.click(screen.getByRole("button", { name: "重做" }))
    expect(useSceneStore.getState().document.primitives.some((primitive) => primitive.type === "cube")).toBe(true)
    expect(useSceneStore.getState().document.primitives.some((primitive) => primitive.type === "polyhedron3")).toBe(true)
  })
})
