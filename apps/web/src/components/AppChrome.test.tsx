import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { AppChrome } from "./AppChrome"

describe("application chrome", () => {
  it("keeps workspace navigation beside the common drawing tools", () => {
    render(<AppChrome activeWorkspace="conics" onWorkspaceChange={() => {}} ribbonGroups={[]} onOpen={() => {}} onSave={() => {}} />)

    expect(screen.getByRole("group", { name: "工作区标签" }).textContent).toContain("平面几何")
    expect(screen.getByRole("button", { name: "工程制图" })).toBeTruthy()
    expect(screen.getByRole("toolbar", { name: "绘图工具" })).toBeTruthy()
  })

  it("labels the planar workspace 平面几何 while it stays the selected conics workspace", () => {
    render(<AppChrome activeWorkspace="conics" onWorkspaceChange={() => {}} ribbonGroups={[]} />)

    expect(screen.getByRole("button", { name: "平面几何" }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.queryByRole("button", { name: "圆锥曲线" })).toBeNull()
  })

  it("switches workspace through the segmented toolbar", () => {
    const onRibbonTabChange = vi.fn()
    render(<AppChrome activeWorkspace="conics" onWorkspaceChange={onRibbonTabChange} ribbonGroups={[]} />)

    fireEvent.click(screen.getByRole("button", { name: "工程制图" }))

    expect(onRibbonTabChange).toHaveBeenCalledWith("cad")
  })
})
