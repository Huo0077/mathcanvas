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

  it("adds and renders a circle and an arc", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "添加圆" }))
    fireEvent.click(screen.getByRole("button", { name: "添加圆弧" }))

    expect(screen.getAllByText("新圆 C")).toHaveLength(2)
    expect(screen.getByRole("img", { name: "几何画布" }).querySelectorAll("circle")).toHaveLength(2)
    expect(screen.getByRole("img", { name: "几何画布" }).querySelectorAll("path")).toHaveLength(1)
  })
})
