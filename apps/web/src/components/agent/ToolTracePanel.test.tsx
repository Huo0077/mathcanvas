import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { AgentTraceEntry } from "../../agentStore"
import { ToolTracePanel } from "./ToolTracePanel"

/**
 * **工具与运行轨迹面板**（Task 2.6 Step 4）。
 *
 * 计划原文把遥测分成两层：
 * "Render a user-facing trace with short summaries; keep detailed diagnostics behind an
 * **opt-in** developer view."
 *
 * 这个文件钉住的就是**"opt-in"到底意味着什么**：
 * 1. 用户默认看到的是**短摘要**（一句人话 + 文字状态），不是原始账本；
 * 2. 详细诊断**默认关着** —— 而且要看必须**用户自己点开**；
 * 3. 状态**不能只靠颜色**（每行都有文字）；
 * 4. 没有轨迹时**整块不渲染**（一个空的"运行轨迹"会被读成"跑了但什么都没发生"）。
 */
function entry(partial: Partial<AgentTraceEntry> = {}): AgentTraceEntry {
  return { phase: "planning", status: "ok", summary: "规划这一步要做什么", at: 1_000, ...partial }
}

describe("tool trace panel", () => {
  it("shows each step as a short summary with a word, not just a colour", () => {
    render(<ToolTracePanel trace={[entry(), entry({ phase: "compiling", summary: "暂存 1 个动作" })]} />)

    const items = screen.getAllByRole("listitem")
    expect(items.map((item) => item.textContent)).toEqual([
      "规划规划这一步要做什么成功",
      "暂存草稿暂存 1 个动作成功"
    ])
  })

  it("keeps the detailed developer view closed until the user opens it", () => {
    const { container } = render(<ToolTracePanel trace={[entry()]} diagnostics={["planning: asking for a plan (from preflight)"]} />)

    const details = container.querySelector("details")
    expect(details).not.toBeNull()
    // **默认关着**：这是 "opt-in" 的全部含义。开着就等于把账本摊在用户面前。
    expect(details!.hasAttribute("open")).toBe(false)
    // 但内容在 DOM 里（原生 `<details>` 的好处：可被"页内查找"与屏幕阅读器发现）。
    expect(container.textContent).toContain("planning: asking for a plan (from preflight)")
  })

  it("renders no developer section at all when there are no diagnostics", () => {
    const { container } = render(<ToolTracePanel trace={[entry()]} />)

    expect(container.querySelector("details")).toBeNull()
  })

  it("renders nothing at all without a trace", () => {
    const { container } = render(<ToolTracePanel trace={[]} />)

    // 一个空的"运行轨迹"会被读成"跑了但什么都没发生"，那是错的 —— 我们只是**还不知道**。
    expect(container.firstChild).toBeNull()
  })

  it("marks a failed step in words as well as in the data attribute", () => {
    const { container } = render(<ToolTracePanel trace={[entry({ phase: "failed", status: "error", summary: "没有完成" })]} />)

    const item = container.querySelector("li")!
    expect(item.getAttribute("data-status")).toBe("error")
    expect(item.textContent).toContain("失败")
  })
})
