import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"

import { App } from "./App"
import { agentNextPhaseFlags } from "./agent/featureFlags"
import { NEXT_PHASE_PREFERENCES_KEY } from "./persistence/nextPhasePreferences"

/**
 * **N3 的第一个产品入口，端到端那一半**（2026-10-05，用户批准）。
 *
 * 这条流程此前**根本走不通**：`WorkspaceTabs` 顶栏那个「设置」按钮**没有 `onClick`**，
 * 而 `WorkspaceTabs` 的 props 里也没有 `onSettings` —— 它是个**死按钮**。
 * 于是"约束拖动"这个能力的代码在、却没有入口，浏览器验收写不出来
 *（`docs/current-status.md` §一.2 第 1 条挂了很多轮）。
 *
 * 这条用例钉的是一条**用户真会走的路径**：
 * 点顶栏「设置」→ 到设置模块 → 用那里的实验性开关打开约束拖动 → `agentNextPhaseFlags()` 跟着变。
 *
 * **为什么必须是"用户真走的路"**：`App.tsx` 关着时走的是原来的 `translatePrimitive3`，
 * 而"打开"这件事如果只有测试能办到（比如一个测试专用钩子），那它就不是入口，
 * 而是把测试后门伪装成功能 —— N2 的先例明令禁止过。
 */
describe("N3 产品入口：设置 → 实验性功能 → 约束拖动", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("点顶栏「设置」能到设置模块，那里有关掉/打开约束拖动的开关", () => {
    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "设置" }))

    expect(document.querySelector('.app-module[data-module="settings"]')).toBeTruthy()
    expect(screen.getByRole("switch", { name: /约束拖动/ })).toBeTruthy()
  })

  it("在这个开关上打开之后，生产接线读到的 `constrainedDrag` 就是开的", () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "设置" }))

    fireEvent.click(screen.getByRole("switch", { name: /约束拖动/ }))

    expect(agentNextPhaseFlags().constrainedDrag).toBe(true)
    // 而且**只开这一个** —— 另外四个必须仍是关的。
    expect(agentNextPhaseFlags().witnessSearch).toBe(false)
    expect(agentNextPhaseFlags().proofExport).toBe(false)
  })

  it("存过的偏好在下次开应用时仍然有效（跨会话保持）", () => {
    localStorage.setItem(NEXT_PHASE_PREFERENCES_KEY, JSON.stringify({ constrainedDrag: true }))

    render(<App />)

    expect(agentNextPhaseFlags().constrainedDrag).toBe(true)
  })
})
