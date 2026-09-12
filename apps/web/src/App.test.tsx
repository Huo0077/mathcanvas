import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { App } from "./App"

describe("MathCanvas workbench", () => {
  it("shows the default intersection and updates it from the slope slider", () => {
    render(<App />)
    expect(screen.getByText(/交点 P \(0\.00, 0\.00\)/)).toBeTruthy()
    const slider = screen.getByRole("slider", { name: "直线斜率" })
    fireEvent.change(slider, { target: { value: "0.25" } })
    expect(screen.getByText(/交点 P \(8\.00, 0\.00\)/)).toBeTruthy()
  })

  it("adds a point through the domain operation path", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    expect(screen.getAllByText("新点 A")).toHaveLength(2)
    expect(screen.getByRole("img", { name: "几何画布" }).querySelectorAll("circle")).toHaveLength(2)
  })

  it("creates and edits a circle through the canvas and properties", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加圆" }))
    const canvas = screen.getByRole("img", { name: "几何画布" })
    fireEvent.click(canvas, { clientX: 400, clientY: 140 })
    fireEvent.click(canvas, { clientX: 508, clientY: 140 })

    expect(screen.getAllByText("圆 1")).toHaveLength(3)
    expect(canvas.querySelectorAll("ellipse")).toHaveLength(1)
    fireEvent.change(screen.getByRole("spinbutton", { name: "半径" }), { target: { value: "4" } })
    expect((screen.getByRole("spinbutton", { name: "半径" }) as HTMLInputElement).value).toBe("4")
  })

  it("creates an arc from center, start, and end clicks", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加圆弧" }))
    const canvas = screen.getByRole("img", { name: "几何画布" })
    fireEvent.click(canvas, { clientX: 400, clientY: 140 })
    fireEvent.click(canvas, { clientX: 544, clientY: 140 })
    fireEvent.click(canvas, { clientX: 400, clientY: 20 })

    expect(screen.getAllByText("圆弧 1")).toHaveLength(2)
    expect(canvas.querySelectorAll("path")).toHaveLength(1)
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
})
