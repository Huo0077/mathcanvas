import { fireEvent, render, screen } from "@testing-library/react"
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

describe("MathCanvas workbench", () => {
  beforeEach(() => {
    localStorage.clear()
    // `replace` deliberately keeps other workspaces' documents, so tests need a full store reset.
    const document = createDemoDocument()
    useSceneStore.setState({ document, workspaceDocuments: { [document.workspace]: document }, history: [], future: [], previewBase: null, error: null })
  })

  it("routes the CAD workspace to four engineering drawing views", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "工程制图" }))

    const engineeringDrawing = screen.getByRole("main", { name: "工程制图视图" })
    expect(engineeringDrawing).toBeTruthy()
    expect(engineeringDrawing.querySelectorAll("[data-drawing-view]")).toHaveLength(4)
    expect(screen.getAllByText("暂无可投影的空间对象")).toHaveLength(4)
    expect(screen.queryByRole("button", { name: "添加点" })).toBeNull()
    expect(screen.getByText("工程制图根据当前文档的 3D 点、棱和面显示四个视图。")).toBeTruthy()
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
    fireEvent.click(screen.getByRole("button", { name: "Add linear annotation" }))

    expect(useSceneStore.getState().document.engineeringAnnotations).toHaveLength(1)
    expect(useSceneStore.getState().document.engineeringAnnotations?.[0]).toMatchObject({ kind: "linear", sourceIds: ["point3-1", "point3-2"], view: "front" })
  })

  it("switches workspaces without losing each workspace document", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "圆锥曲线" }))
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    expect(screen.getAllByText("新点 A")).toHaveLength(2)

    fireEvent.click(screen.getByRole("button", { name: "微积分" }))
    expect(screen.getByRole("img", { name: "几何画布" }).querySelector('[data-intersection-info="true"]')).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "圆锥曲线" }))
    expect(screen.getAllByText("新点 A")).toHaveLength(2)
    expect(screen.getByRole("button", { name: "圆锥曲线" }).getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: "微积分" }))
  })

  it("shows the default intersection and updates it from the slope slider", () => {
    render(<App />)
    const canvas = screen.getByRole("img", { name: "几何画布" })
    expect(canvas.querySelector('[data-primitive-type="intersection"] [data-intersection-info="true"]')).toBeNull()
    expect(canvas.querySelector('[data-primitive-type="intersection"] [data-hit-target="true"]')?.getAttribute("r")).toBe("14")
    const slider = screen.getByRole("slider", { name: "直线斜率" })
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
    expect(screen.getByText("外观")).toBeTruthy()
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
    fireEvent.change(screen.getByRole("slider", { name: "直线斜率" }), { target: { value: "0.5" } })
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

  it("renders a typed function expression with common math notation", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加函数图像" }))
    fireEvent.change(screen.getByRole("textbox", { name: "函数表达式" }), { target: { value: "y = sin(x)^2" } })

    expect((screen.getByRole("textbox", { name: "函数表达式" }) as HTMLInputElement).value).toBe("y = sin(x)^2")
    const graphs = Array.from(screen.getByRole("img", { name: "几何画布" }).querySelectorAll('[data-primitive-type="function"] polyline:not([data-hit-target="true"])'))
    expect(graphs.some((graph) => !graph.getAttribute("points")?.includes("500,20"))).toBe(true)
  })

  it("applies common style properties to a selected line", () => {
    render(<App />)
    fireEvent.click(screen.getAllByText("y = 0")[0])
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

  it("adds and edits a sampled function in the workbench", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加函数图像" }))
    expect(screen.getByRole("textbox", { name: "函数表达式" })).toBeTruthy()
    expect(screen.getByRole("img", { name: "几何画布" }).querySelectorAll('[data-primitive-type="function"]').length).toBeGreaterThan(0)
    fireEvent.change(screen.getByRole("textbox", { name: "函数表达式" }), { target: { value: "2*x+1" } })
    fireEvent.change(screen.getByRole("spinbutton", { name: "定义域终点" }), { target: { value: "4" } })
    expect((screen.getByRole("textbox", { name: "函数表达式" }) as HTMLInputElement).value).toBe("2*x+1")
    expect((screen.getByRole("spinbutton", { name: "定义域终点" }) as HTMLInputElement).value).toBe("4")
  })

  it("inserts nested functions from the formula keyboard", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加函数图像" }))
    fireEvent.click(screen.getByRole("button", { name: "插入 sin" }))
    fireEvent.click(screen.getByRole("button", { name: "插入 ln" }))

    const formula = screen.getByRole("textbox", { name: "函数表达式" }) as HTMLTextAreaElement
    fireEvent.change(formula, { target: { value: "sin(ln(x))" } })

    expect(formula.value).toBe("sin(ln(x))")
    expect(screen.getByRole("button", { name: "插入对数" })).toBeTruthy()
  })

  it("creates linked calculus analysis objects from the function inspector", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加函数图像" }))
    fireEvent.click(screen.getByRole("button", { name: "创建导函数" }))
    fireEvent.click(screen.getByRole("button", { name: "创建切线" }))
    fireEvent.click(screen.getByRole("button", { name: "创建积分区域" }))

    const canvas = screen.getByRole("img", { name: "几何画布" })
    expect(canvas.querySelector('[data-primitive-type="derivative"]')).toBeTruthy()
    expect(canvas.querySelector('[data-primitive-type="tangent"]')).toBeTruthy()
    expect(canvas.querySelector('[data-primitive-type="integral"]')).toBeTruthy()
    expect(screen.getByText("导函数")).toBeTruthy()
  })

  it("keeps a visible formula editor for direct input", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加函数图像" }))

    expect(screen.getByRole("textbox", { name: "函数表达式" })).toBeTruthy()
    expect(screen.getByPlaceholderText("例如：y = e^x 或 sin(ln(x))")).toBeTruthy()
  })

  it("does not delete a function when Backspace is pressed in its formula editor", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加函数图像" }))
    const formula = screen.getByRole("textbox", { name: "函数表达式" })

    fireEvent.keyDown(formula, { key: "Backspace" })

    expect(screen.getByRole("textbox", { name: "函数表达式" })).toBeTruthy()
    expect(useSceneStore.getState().document.primitives.some((primitive) => primitive.type === "function")).toBe(true)
  })

  it("exposes play, pause, stop, and animation mode controls", () => {
    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "播放动画" }))
    expect(screen.getByRole("button", { name: "暂停动画" })).toBeTruthy()
    fireEvent.change(screen.getByRole("combobox", { name: "动画模式" }), { target: { value: "pingPong" } })
    fireEvent.click(screen.getByRole("button", { name: "暂停动画" }))
    expect(screen.getByRole("button", { name: "播放动画" })).toBeTruthy()
    expect((screen.getByRole("button", { name: "停止动画" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("creates a sampled intersection between a function and a conic", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加椭圆" }))
    fireEvent.click(screen.getByRole("button", { name: "添加函数图像" }))
    const rows = Array.from(globalThis.document.querySelectorAll(".object-row"))
    const ellipseRow = rows.find((row) => row.textContent?.includes("椭圆"))
    const functionRow = rows.find((row) => row.textContent?.includes("函数"))
    fireEvent.click(ellipseRow!)
    fireEvent.click(functionRow!, { shiftKey: true })

    expect(screen.getByRole("button", { name: "添加交点" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "添加交点" }))
    expect(screen.getAllByRole("button", { name: /交点/ }).some((button) => /(交点|交点集合)/.test(button.getAttribute("aria-label") ?? ""))).toBe(true)
    expect(screen.getByRole("img", { name: "几何画布" }).querySelectorAll('[data-primitive-type="intersectionSet"]')).toHaveLength(1)
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
    fireEvent.click(screen.getByRole("button", { name: "锁定对象" }))

    expect(screen.getByRole("button", { name: "解锁对象" })).toBeTruthy()
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
    expect(new Set(points.map((point) => `${point.x},${point.y},${point.z}`))).toEqual(new Set(["-2,0,-1", "2,0,-1", "2,0,1", "-2,0,1"]))
  })

  it("keeps a point-driven 3D document while switching workspaces", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加立方体" }))
    fireEvent.click(algebraRow("立方体 1 拓扑"))
    fireEvent.click(screen.getByRole("button", { name: "创建截面" }))

    fireEvent.click(screen.getByRole("button", { name: "微积分" }))
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

    fireEvent.click(screen.getByRole("button", { name: "微积分" }))
    expect((screen.getByRole("button", { name: "导出 SVG" }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("explains an invalid spatial construction instead of creating objects", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "由选中点创建空间直线" }))

    // The message has to say how to select, not just that the selection is wrong.
    expect(screen.getByRole("alert").textContent).toContain("Shift")
    expect(screen.getByRole("alert").textContent).toContain("空间点")
    expect(useSceneStore.getState().document.primitives.some((primitive) => primitive.type === "line3")).toBe(false)
  })

  it("recolours a 3D solid and its generated topology from the property inspector", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "立体几何" }))
    fireEvent.click(screen.getByRole("button", { name: "添加立方体" }))

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
