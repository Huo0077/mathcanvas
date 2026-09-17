import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { createEmptyDocument } from "@draw/dsl"
import { host3FromPrimitive } from "@draw/geometry-kernel"

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

/** Planar points are labelled A, B, C … (the label is the object row's only text), so rows are matched by name. */
function pointObjectRows(): HTMLElement[] {
  return Array.from(globalThis.document.querySelectorAll(".algebra-panel .object-row")).filter((row) => /^[A-Z]$/.test(row.querySelector(".object-name")?.textContent ?? "")) as HTMLElement[]
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

    fireEvent.click(screen.getByRole("button", { name: "工程制图" }))
    expect(screen.queryByRole("tab", { name: "约束" })).toBeNull()
    expect(screen.queryByText("智能体 (Agent)")).toBeNull()
    // 约束数据仍在文档模型里：旧 .mgeo 打开后不会丢数据。
    expect(useSceneStore.getState().document.constraints).toEqual([])
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

    // The workspace stays retired, but 平面几何 keeps a function entry so simple functions remain reachable there.
    fireEvent.click(screen.getByRole("button", { name: "平面几何" }))
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

    expect(pointObjectRows()).toHaveLength(0)
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
    fireEvent.click(screen.getByRole("button", { name: "平面几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    expect(screen.getAllByText("A", { selector: ".object-name" })).toHaveLength(1)

    fireEvent.click(screen.getByRole("button", { name: "立体几何" }))
    expect(screen.queryByRole("img", { name: "几何画布" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "平面几何" }))
    expect(screen.getAllByText("A", { selector: ".object-name" })).toHaveLength(1)
    expect(screen.getByRole("button", { name: "平面几何" }).getAttribute("aria-pressed")).toBe("true")
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
   * 动画必须驱动**选中动点自己的参数**。之前动画目标写死成 `"slope"`，
   * 所以在圆锥曲线工作区里选中一个动点按「播放」，动的是那条无关的直线。
   */
  it("animates the selected dynamic point instead of the slope line", () => {
    vi.useFakeTimers()
    try {
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

      // Open the animation panel and scrub its slider: it targets the point's own parameter.
      fireEvent.click(screen.getByRole("button", { name: "动效演示" }))
      const scrub = screen.getByRole("slider", { name: "动画参数" }) as HTMLInputElement
      expect(scrub.value).toBeCloseTo(document().parameters[parameterId].value, 6)
      fireEvent.change(scrub, { target: { value: "0.9" } })
      const pointAfterScrub = document().primitives.find((primitive) => primitive.type === "point")
      if (pointAfterScrub?.type !== "point") throw new Error("point missing")
      expect(pointAfterScrub.x).not.toBeCloseTo(pointBefore.x, 6)
      expect(document().parameters.slope.value).toBeCloseTo(slopeBefore, 9)

      // Playing advances that same parameter and leaves the slope alone.
      const beforePlay = document().parameters[parameterId].value
      fireEvent.click(screen.getByRole("button", { name: "播放动画" }))
      act(() => {
        vi.advanceTimersByTime(400)
      })
      expect(document().parameters[parameterId].value).not.toBeCloseTo(beforePlay, 6)
      expect(document().parameters.slope.value).toBeCloseTo(slopeBefore, 9)

      fireEvent.click(screen.getByRole("button", { name: "停止动画" }))
    } finally {
      vi.useRealTimers()
    }
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

    // Widening the domain must widen the animation slider too, otherwise the window edit is cosmetic.
    fireEvent.change(upper, { target: { value: "12" } })
    const widened = useSceneStore.getState().document.primitives.find((primitive) => primitive.id === point.id)
    expect(widened?.type === "point" && widened.binding?.kind === "onPath" ? widened.binding.domain?.[1] : null).toBe(12)
    fireEvent.click(screen.getByRole("button", { name: "动效演示" }))
    expect((screen.getByRole("slider", { name: "动画参数" }) as HTMLInputElement).max).toBe("12")
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
    fireEvent.click(screen.getByRole("button", { name: "立体几何" }))
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

  it("shows a small bottom-left guide when a feature button is clicked", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "平面几何" }))

    expect(screen.queryByRole("status", { name: "操作指引" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "添加圆弧" }))
    const hint = screen.getByRole("status", { name: "操作指引" })
    expect(hint.textContent).toContain("圆心")
    expect(hint.textContent).toContain("终点")
  })

  it("replaces the guide on the next feature click and closes it on demand", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "平面几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加折线" }))
    expect(screen.getByRole("status", { name: "操作指引" }).textContent).toContain("双击")

    fireEvent.click(screen.getByRole("button", { name: "添加函数" }))
    expect(screen.getByRole("status", { name: "操作指引" }).textContent).toContain("预设")

    fireEvent.click(screen.getByRole("button", { name: "关闭操作指引" }))
    expect(screen.queryByRole("status", { name: "操作指引" })).toBeNull()
  })

  it("dismisses the guide with Escape and clears it once a creation finishes", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "平面几何" }))
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
    fireEvent.click(screen.getByRole("button", { name: "平面几何" }))
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
    // 默认剖切面是过中心的水平面（世界 Z 轴朝上）：立方体原点 (-2,-2,-1)、尺寸 4×4×2 ⇒ 切在 z = 0。
    expect(new Set(points.map((point) => `${point.x},${point.y},${point.z}`))).toEqual(new Set(["-2,-2,0", "2,-2,0", "2,2,0", "-2,2,0"]))
    // 单一连通截面只有一环。
    expect(section?.type === "section" ? section.loops : []).toHaveLength(1)
  })

  it("binds a spatial point to a host and slides it along the host parameter", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加立方体" }))
    fireEvent.click(screen.getByRole("button", { name: "添加空间点" }))

    // 绑定到立方体的一条棱（模板实体生成了 12 条 edge3）。
    const select = screen.getByRole("combobox", { name: "点宿主绑定" }) as HTMLSelectElement
    const edgeOption = Array.from(select.options).find((option) => option.value.startsWith("cube-1-edge"))
    expect(edgeOption).toBeTruthy()
    fireEvent.change(select, { target: { value: edgeOption!.value } })

    const readPoint = () => useSceneStore.getState().document.primitives.find((primitive) => primitive.type === "point3" && primitive.binding?.kind === "onHost") as Extract<ReturnType<typeof createEmptyDocument>["primitives"][number], { type: "point3" }> | undefined
    const bound = readPoint()!
    expect(bound).toBeTruthy()
    const hostPrimitive = useSceneStore.getState().document.primitives.find((primitive) => primitive.id === edgeOption!.value)!
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

  it("materializes a section into independent primitives", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "立体几何" }))
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
    fireEvent.click(screen.getByRole("button", { name: "立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加立方体" }))
    fireEvent.click(algebraRow("立方体 1 拓扑"))
    fireEvent.click(screen.getByRole("button", { name: "创建截面" }))

    fireEvent.click(screen.getByRole("button", { name: "平面几何" }))
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

    fireEvent.click(screen.getByRole("button", { name: "平面几何" }))
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
