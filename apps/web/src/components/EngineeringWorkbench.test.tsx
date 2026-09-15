import { fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

import { createEmptyDocument } from "@draw/dsl"

import { EngineeringWorkbench, type CadMode } from "./EngineeringWorkbench"

function renderWorkbench(overrides: { mode?: CadMode; canvas?: ReactNode } = {}) {
  const onModeChange = vi.fn()
  render(<EngineeringWorkbench
    document={createEmptyDocument("cad")}
    mode={overrides.mode ?? "projection"}
    onModeChange={onModeChange}
    commandBar={<div data-testid="command-slot">命令栏</div>}
    leftDock={<div data-testid="left-slot">树面板</div>}
    canvas={overrides.canvas ?? <div data-testid="canvas-slot">图纸</div>}
    inspector={<div data-testid="inspector-slot">属性</div>}
    statusBar={<div data-testid="status-slot">状态</div>}
  />)
  return { onModeChange }
}

describe("engineering workbench shell", () => {
  it("renders the command bar, both docks, the canvas slot and the status region", () => {
    renderWorkbench()

    expect(screen.getByRole("region", { name: "工程命令栏" }).contains(screen.getByTestId("command-slot"))).toBe(true)
    expect(screen.getByRole("region", { name: "模型与图纸树" }).contains(screen.getByTestId("left-slot"))).toBe(true)
    expect(screen.getByRole("region", { name: "工程图视口" }).contains(screen.getByTestId("canvas-slot"))).toBe(true)
    expect(screen.getByRole("region", { name: "工程属性检查器" }).contains(screen.getByTestId("inspector-slot"))).toBe(true)
    expect(screen.getByRole("region", { name: "工程状态栏" }).contains(screen.getByTestId("status-slot"))).toBe(true)
  })

  it("exposes the current document revision for diagnostics", () => {
    renderWorkbench()

    expect(screen.getByRole("region", { name: "工程图视口" }).closest("[data-revision]")?.getAttribute("data-revision")).toBe("0")
  })

  it("switches between the projection and drafting modes", () => {
    const { onModeChange } = renderWorkbench()

    expect(screen.getByRole("button", { name: "3D 投影" }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("button", { name: "2D 绘图" }).getAttribute("aria-pressed")).toBe("false")

    fireEvent.click(screen.getByRole("button", { name: "2D 绘图" }))
    expect(onModeChange).toHaveBeenCalledWith("draft")
  })

  it("marks the drafting mode as active when it is selected", () => {
    renderWorkbench({ mode: "draft" })

    expect(screen.getByRole("button", { name: "2D 绘图" }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("region", { name: "工程图视口" }).closest("[data-cad-mode]")?.getAttribute("data-cad-mode")).toBe("draft")
  })

  it("lets narrow layouts collapse and reopen both docks", () => {
    renderWorkbench()

    fireEvent.click(screen.getByRole("button", { name: "收起模型与图纸树" }))
    expect(screen.getByRole("button", { name: "展开模型与图纸树" })).toBeTruthy()
    expect(screen.queryByTestId("left-slot")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "收起工程属性检查器" }))
    expect(screen.queryByTestId("inspector-slot")).toBeNull()
    expect(screen.getByTestId("canvas-slot")).toBeTruthy()
  })
})
