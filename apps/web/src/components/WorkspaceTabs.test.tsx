import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { WorkspaceTabs } from "./WorkspaceTabs"

function renderTabs(overrides: Partial<Parameters<typeof WorkspaceTabs>[0]> = {}) {
  return render(<WorkspaceTabs
    activeWorkspace="conics"
    activeTab="home"
    expanded
    pinned={false}
    onWorkspaceChange={() => {}}
    onTabChange={() => {}}
    onExpandedChange={() => {}}
    onPinnedChange={() => {}}
    {...overrides}
  />)
}

describe("workspace tab bar", () => {
  it("keeps the workspace tabs and the ribbon switches", () => {
    renderTabs()

    expect(screen.getByRole("group", { name: "工作区标签" }).textContent).toContain("平面几何")
    expect(screen.getByRole("button", { name: "立体几何" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "收起功能区" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "固定功能区" })).toBeTruthy()
  })

  /**
   * 用户口径：「把顶部的 MathCanvas 一栏中图片的内容放到下面一栏（平面几何、立体几何）的右端」。
   *
   * 命令组从顶栏**下沉**到这一栏的右端，且仍然在标签栏容器内部 —— 这条用例把归属钉住，
   * 免得以后又被挪回顶栏。按钮的无障碍名字没变，所以既有查询照旧可用。
   */
  it("carries the file commands, search and settings on its right end", () => {
    renderTabs({ onOpen: () => {}, onSave: () => {}, onUndo: () => {}, onRedo: () => {}, canUndo: true, canRedo: false })

    const bar = screen.getByRole("navigation", { name: "工作模式" })
    const actions = bar.querySelector(".workspace-tabs-actions")!
    expect(actions).toBeTruthy()
    for (const name of ["打开 .mgeo", "保存 .mgeo", "撤销", "重做", "设置"]) {
      expect(actions.contains(screen.getByRole("button", { name }))).toBe(true)
    }
    expect(screen.getByPlaceholderText("搜索工具、命令或定理...")).toBeTruthy()
    // 高亮的「用户中心」按钮已按用户口径删除。
    expect(screen.queryByRole("button", { name: "用户中心" })).toBeNull()
    // 历史按钮的禁用状态照旧。
    expect(screen.getByRole("button", { name: "重做" }).hasAttribute("disabled")).toBe(true)
  })

  it("still switches workspaces and pops the ribbon when collapsed", () => {
    const onWorkspaceChange = vi.fn()
    const onTabChange = vi.fn()
    renderTabs({ onWorkspaceChange, onTabChange, expanded: false })

    // 标签栏里的工作区按钮名字就是纯标签；带"跳转到"前缀的那个在左侧模块栏（见 ModuleRail）。
    fireEvent.click(screen.getByRole("button", { name: "工程制图" }))

    expect(onWorkspaceChange).toHaveBeenCalledWith("cad")
    expect(onTabChange).toHaveBeenCalledWith("home")
  })
})
