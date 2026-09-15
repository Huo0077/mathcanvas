import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { AppChrome } from "./AppChrome"

describe("application chrome", () => {
  it("keeps workspace navigation in the tab bar and renders the shared ribbon", () => {
    render(<AppChrome activeWorkspace="conics" onWorkspaceChange={() => {}} ribbonGroups={[]} activeRibbonTab="home" ribbonExpanded={true} ribbonPinned={false} onRibbonTabChange={() => {}} onRibbonExpandedChange={() => {}} onRibbonPinnedChange={() => {}} onOpen={() => {}} onSave={() => {}} />)

    expect(screen.getByRole("navigation", { name: "工作模式" }).textContent).toContain("圆锥曲线")
    expect(screen.getByRole("button", { name: "工程制图" })).toBeTruthy()
    expect(screen.getByRole("region", { name: "功能区" })).toBeTruthy()
  })

  it("opens the temporary Ribbon when a workspace tab is clicked while collapsed", () => {
    const onRibbonTabChange = vi.fn()
    render(<AppChrome activeWorkspace="conics" onWorkspaceChange={() => {}} ribbonGroups={[]} activeRibbonTab={null} ribbonExpanded={false} ribbonPinned={false} onRibbonTabChange={onRibbonTabChange} onRibbonExpandedChange={() => {}} onRibbonPinnedChange={() => {}} />)

    fireEvent.click(screen.getByRole("button", { name: "工程制图" }))

    expect(onRibbonTabChange).toHaveBeenCalledWith("home")
  })
})
