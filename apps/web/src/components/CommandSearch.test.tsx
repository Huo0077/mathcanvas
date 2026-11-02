import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { CommandSearch } from "./CommandSearch"
import { searchCommands, type SearchableCommand } from "./commandSearchModel"

describe("CommandSearch and searchCommands", () => {
  const sampleCommands: SearchableCommand[] = [
    { id: "create-line", label: "直线", group: "绘制", prompt: "点击两点创建无限长直线" },
    { id: "create-segment", label: "线段", group: "绘制", prompt: "点击两点创建线段" },
    { id: "create-circle", label: "圆", group: "绘制", prompt: "点击圆心与圆周上的点" },
    { id: "create-cube", label: "正方体", group: "立体与截面", prompt: "创建标准正方体" },
    { id: "modify-delete", label: "删除", group: "修改", prompt: "删除选中对象", disabled: true, disabledReason: "未选择对象" }
  ]

  it("scores prefix matches above substring matches and prompt matches", () => {
    const results = searchCommands(sampleCommands, "线")
    expect(results.length).toBeGreaterThan(0)
    // "线段" starts with "线" -> score 0
    // "直线" contains "线" -> score 1
    expect(results[0].label).toBe("线段")
    expect(results[1].label).toBe("直线")
  })

  it("filters and executes matching command via keyboard Enter", () => {
    const onRun = vi.fn()
    render(<CommandSearch commands={sampleCommands} onRun={onRun} />)

    const input = screen.getByRole("textbox", { name: "搜索" })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: "正方体" } })

    expect(screen.getByRole("listbox", { name: "搜索结果" })).toBeTruthy()
    expect(screen.getByText("正方体")).toBeTruthy()

    fireEvent.keyDown(input, { key: "Enter" })
    expect(onRun).toHaveBeenCalledWith("create-cube")
  })

  it("does not execute disabled command when clicked", () => {
    const onRun = vi.fn()
    render(<CommandSearch commands={sampleCommands} onRun={onRun} />)

    const input = screen.getByRole("textbox", { name: "搜索" })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: "删除" } })

    const option = screen.getByText("删除")
    fireEvent.click(option)
    expect(onRun).not.toHaveBeenCalled()
  })
})
