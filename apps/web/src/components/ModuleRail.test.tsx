import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ModuleRail } from "./ModuleRail"

describe("module rail", () => {
  it("marks the active module and switches to the other one", () => {
    const onModuleChange = vi.fn()
    render(<ModuleRail activeModule="traditional" onModuleChange={onModuleChange} activeWorkspace="conics" />)

    const traditional = screen.getByRole("button", { name: "传统工作区" })
    const agent = screen.getByRole("button", { name: "Agent 工作区" })
    expect(traditional.getAttribute("aria-pressed")).toBe("true")
    expect(agent.getAttribute("aria-pressed")).toBe("false")

    fireEvent.click(agent)
    expect(onModuleChange).toHaveBeenCalledWith("agent")
  })

  it("shows the three workspace entries while module A is open and marks the active one", () => {
    render(<ModuleRail activeModule="traditional" onModuleChange={() => {}} activeWorkspace="geometry3d" />)

    const group = screen.getByRole("group", { name: "工作区" })
    expect(group.textContent).toContain("平面几何")
    // 入口名字带"跳转到"前缀：与标签栏里那个同名按钮区分开（见 ModuleRail 里的注释：
    // Playwright 的 `getByRole(name)` 是子串匹配，不加前缀会命中两个元素）。
    expect(screen.getByRole("button", { name: "跳转到立体几何" }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("button", { name: "跳转到平面几何" }).getAttribute("aria-pressed")).toBe("false")
  })

  it("forwards a workspace switch from the rail", () => {
    const onWorkspaceChange = vi.fn()
    render(<ModuleRail activeModule="traditional" onModuleChange={() => {}} activeWorkspace="conics" onWorkspaceChange={onWorkspaceChange} />)

    fireEvent.click(screen.getByRole("button", { name: "跳转到工程制图" }))
    expect(onWorkspaceChange).toHaveBeenCalledWith("cad")
  })

  it("hides the workspace entries inside the Agent module and forwards workspace switches", () => {
    const onWorkspaceChange = vi.fn()
    render(<ModuleRail activeModule="agent" onModuleChange={() => {}} activeWorkspace="conics" onWorkspaceChange={onWorkspaceChange} />)

    expect(screen.queryByRole("group", { name: "工作区" })).toBeNull()
    expect(screen.getByRole("navigation", { name: "全局模块" })).toBeTruthy()
  })
})
