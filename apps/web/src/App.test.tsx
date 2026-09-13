import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"

import { App } from "./App"

describe("MathCanvas workbench", () => {
  beforeEach(() => localStorage.clear())

  it("switches workspaces without losing each workspace document", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "圆锥曲线" }))
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    expect(screen.getAllByText("新点 A")).toHaveLength(2)

    fireEvent.click(screen.getByRole("button", { name: "微积分" }))
    expect(screen.getByText(/交点 P \(0\.00, 0\.00\)/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "圆锥曲线" }))
    expect(screen.getAllByText("新点 A")).toHaveLength(2)
    expect(screen.getByRole("button", { name: "圆锥曲线" }).getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: "微积分" }))
  })

  it("shows the default intersection and updates it from the slope slider", () => {
    render(<App />)
    expect(screen.getByText(/交点 P \(0\.00, 0\.00\)/)).toBeTruthy()
    const slider = screen.getByRole("slider", { name: "直线斜率" })
    fireEvent.change(slider, { target: { value: "0.25" } })
    expect(screen.getByText(/交点 P \(8\.00, 0\.00\)/)).toBeTruthy()
  })

  it("shows the selected line slope characteristics in the properties panel", () => {
    render(<App />)
    fireEvent.click(screen.getAllByText("参数直线")[0])

    expect(screen.getByText("斜率特征")).toBeTruthy()
    expect(screen.getByText("倾角")).toBeTruthy()
    expect(screen.getByText("截距")).toBeTruthy()
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
    const intersection = canvas.querySelector('[data-primitive-type="intersection"] text')!
    const before = intersection.textContent

    fireEvent.pointerDown(line, { clientX: 400, clientY: 140, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 400, clientY: 110, pointerId: 1 })
    expect(intersection.textContent).not.toBe(before)
    fireEvent.pointerUp(canvas, { clientX: 400, clientY: 110, pointerId: 1 })

    expect(intersection.textContent).not.toBe(before)
  })

  it("adds a point through the domain operation path", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    expect(screen.getByRole("img", { name: "几何画布" }).querySelectorAll('[data-primitive-type="point"]').length).toBeGreaterThan(0)
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
    expect(canvas.querySelectorAll('path:not([data-hit-target="true"])')).toHaveLength(1)
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

  it("adds and edits a sampled function in the workbench", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加函数图像" }))
    expect(screen.getAllByText("函数 1")).toHaveLength(2)
    expect(screen.getByRole("img", { name: "几何画布" }).querySelectorAll('[data-primitive-type="function"]')).toHaveLength(1)
    fireEvent.change(screen.getByRole("textbox", { name: "函数表达式" }), { target: { value: "2*x+1" } })
    fireEvent.change(screen.getByRole("spinbutton", { name: "定义域终点" }), { target: { value: "4" } })
    expect((screen.getByRole("textbox", { name: "函数表达式" }) as HTMLInputElement).value).toBe("2*x+1")
    expect((screen.getByRole("spinbutton", { name: "定义域终点" }) as HTMLInputElement).value).toBe("4")
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
    expect(screen.getAllByRole("button", { name: /隐藏 交点/ }).some((button) => /^隐藏 交点 \d+$/.test(button.getAttribute("aria-label") ?? ""))).toBe(true)
    expect(screen.getByRole("img", { name: "几何画布" }).querySelectorAll('[data-primitive-type="curveIntersection"]')).toHaveLength(1)
  })

  it("selects and deletes a point with the keyboard", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    const pointLabelsBeforeDelete = screen.getAllByText("新点 A")
    fireEvent.click(pointLabelsBeforeDelete[0])
    expect((screen.getByRole("button", { name: "删除对象" }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.keyDown(window, { key: "Delete" })

    expect(screen.getAllByText("新点 A")).toHaveLength(pointLabelsBeforeDelete.length - 2)
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
})
