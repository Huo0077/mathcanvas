import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { SolveResult } from "@draw/agent-core"

import type { AgentMessage } from "../../agentStore"
import { RunStatus } from "./RunStatus"

/**
 * Task 2.5 Step 1/3 里属于运行状态卡的部分。
 *
 * 计划原文："Loading has explicit progress; errors include a retry/revise action and field/fact links;
 * **no status relies only on color**."
 */
function message(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return { id: "m1", role: "assistant", text: "", createdAt: 1_000, ...overrides }
}

describe("explicit progress", () => {
  it("says what is happening and which step it is on, not just a spinner", () => {
    render(<RunStatus message={message({ pending: true, trace: [{ phase: "observing", status: "ok", summary: "读了 3 个对象", at: 1 }] })} />)

    expect(screen.getByText("进行中")).toBeTruthy()
    // 进度要说得出来：既说"进行中"，也说在**哪一步**。
    // （"读取场景"同时出现在进度摘要与轨迹行里，所以这里断言"至少出现一次"。）
    expect(screen.getAllByText(/读取场景/).length).toBeGreaterThan(0)
  })

  it("lists the whole trace so the user can see how far it got", () => {
    render(<RunStatus message={message({
      pending: true,
      trace: [
        { phase: "preflight", status: "ok", summary: "检查通过", at: 1 },
        { phase: "observing", status: "ok", summary: "读了 3 个对象", at: 2 },
        { phase: "planning", status: "warning", summary: "第一次输出不合规，正在修复", at: 3 }
      ]
    })} />)

    const items = globalThis.document.querySelectorAll(".agent-run-trace li")
    expect(items).toHaveLength(3)
    expect(items[2].textContent).toContain("规划")
    expect(items[2].textContent).toContain("修复")
  })

  it("offers a stop action while running", () => {
    const onStop = vi.fn()
    render(<RunStatus message={message({ pending: true })} onStop={onStop} />)

    screen.getByRole("button", { name: "停止" }).click()

    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it("renders nothing for a message with no run state at all", () => {
    const { container } = render(<RunStatus message={message({ text: "普通回复" })} />)

    // 没有运行状态的普通消息不该凭空多出一块卡片。
    expect(container.querySelector(".agent-run-status")).toBeNull()
  })
})

describe("commit receipt wins over an old draft", () => {
  it("shows committed even when the same answer message still carries its preview", () => {
    render(<RunStatus message={message({
      text: "已画出实例。", draft: { draftId: "d1", draftVersion: 1, previewHash: "p", stageCount: 1, undoesInOneStep: true },
      commit: { status: "committed" }
    })} />)
    expect(screen.getByText("已提交")).toBeTruthy()
    expect(screen.queryByText("等待你确认")).toBeNull()
  })
})
describe("status never relies on colour alone", () => {
  it("shows a single formatted clarification and a waiting state", () => {
    const { container } = render(<RunStatus message={message({ failure: { code: "needs_more_information", message: "请补充 **折角**，例如 `60°`。", retryable: false } })} />)
    expect(screen.getByText("等待补充信息")).toBeTruthy()
    expect(screen.getAllByText(/请补充/)).toHaveLength(1)
    expect(container.querySelector("strong")?.textContent).toBe("折角")
    expect(container.querySelector("code")?.textContent).toBe("60°")
  })

  it("labels completed read-only mathematical results as answered", () => {
    render(<RunStatus message={message({ text: "BD=2√85/5", commit: { status: "no_change" } })} />)
    expect(screen.getByText("已回答")).toBeTruthy()
  })
  it("gives every trace entry a word, not just a coloured dot", () => {
    render(<RunStatus message={message({
      pending: true,
      trace: [
        { phase: "preflight", status: "ok", summary: "a", at: 1 },
        { phase: "planning", status: "warning", summary: "b", at: 2 },
        { phase: "compiling", status: "error", summary: "c", at: 3 }
      ]
    })} />)

    const statuses = [...globalThis.document.querySelectorAll(".agent-trace-status")].map((node) => node.textContent)
    // 每条状态都有一个**词**；色觉障碍用户与灰度截图里靠的就是它。
    expect(statuses).toEqual(["成功", "注意", "失败"])
  })

  it("labels the overall state with a word too", () => {
    render(<RunStatus message={message({ pending: false, commit: { status: "committed" } })} />)

    expect(screen.getByText("已提交")).toBeTruthy()
  })
})

describe("errors are actionable", () => {
  it("shows the reason code and offers retry when the failure is retryable", () => {
    const onRetry = vi.fn()
    const onRevise = vi.fn()
    render(<RunStatus message={message({ failure: { code: "transport_retryable", message: "网络中断", retryable: true } })} onRetry={onRetry} onRevise={onRevise} />)

    expect(screen.getByRole("alert").textContent).toContain("网络中断")
    // 原因码要露出来：用户报问题时它比"失败了"有用得多。
    expect(screen.getByText(/transport_retryable/)).toBeTruthy()

    screen.getByRole("button", { name: "重试" }).click()
    screen.getByRole("button", { name: "改一改" }).click()
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRevise).toHaveBeenCalledTimes(1)
  })

  it("does not offer retry when retrying would not help", () => {
    // 认证失败重试一百次也一样 —— 给一个没用的按钮比不给更糟。
    render(<RunStatus message={message({ failure: { code: "auth_cannot_retry", message: "密钥无效", retryable: false } })} onRetry={vi.fn()} onRevise={vi.fn()} />)

    expect(screen.queryByRole("button", { name: "重试" })).toBeNull()
    expect(screen.getByRole("button", { name: "改一改" })).toBeTruthy()
  })

  it("reports a failed commit as an alert", () => {
    render(<RunStatus message={message({ commit: { status: "failed", detail: "文档已经被改过" } })} />)

    expect(screen.getByRole("alert").textContent).toContain("文档已经被改过")
  })
})

/**
 * 草稿的**确认 UI 已搬到 `ConfirmationPanel`**（第二十一批）：那里给的信息多得多
 *（精确计数、来源与目标、假设、近似、导出省略、删除警告）。
 *
 * 这里保留的断言只有一条，但很重要：**状态卡里不再重复渲染草稿按钮**。
 * 两处都渲染会让页面同时出现两个「确认并提交」—— 无障碍查询与用户都会面对歧义，
 * 而 e2e 会立刻以"找到多个按钮"报出来（这正是它被发现的方式）。
 */
describe("the status card leaves the draft UI to the confirmation panel", () => {
  const draftView = { draftId: "draft_1", draftVersion: 2, previewHash: "h", stageCount: 3, undoesInOneStep: true }

  it("says it is waiting for confirmation", () => {
    render(<RunStatus message={message({ draft: draftView })} />)

    expect(screen.getByText("等待你确认")).toBeTruthy()
  })

  it("does not render the draft buttons itself", () => {
    render(<RunStatus message={message({ draft: draftView })} onConfirm={vi.fn()} onDiscard={vi.fn()} />)

    // 草稿的按钮归确认面板；这里一个都不该有。
    expect(screen.queryByRole("button", { name: "确认并提交" })).toBeNull()
    expect(screen.queryByRole("button", { name: "丢弃草稿" })).toBeNull()
  })

  it("does not duplicate the draft numbers either", () => {
    render(<RunStatus message={message({ draft: draftView })} />)

    // 版本与动作数由确认面板给出（那里还有前后对比），状态卡只说"在等你确认"。
    expect(screen.queryByText("动作数")).toBeNull()
  })
})

/**
 * **W2 / T2：状态卡读宿主派生的交付语义，而不是"有没有收到回执"。**
 *
 * 旧实现里"运行走到 completed"就显示"已回答"；空白正文与请求补图都以 completed 结束，
 * 于是界面说了一句假话。现在 `solveResult.status` 优先，`failed` / `partial` 各有各的词。
 */
describe("W2 — delivery status comes from the host's solveResult", () => {
  const solve = (status: SolveResult["status"]): SolveResult => ({
    schemaVersion: "mathcanvas.solve.v1",
    problemRevision: "revision-1",
    status,
    answers: status === "answered" ? [{ goalId: "goal-1", kind: "conversation", displayText: "0", evidenceRefs: [] }] : [],
    unansweredGoalIds: status === "answered" ? [] : ["goal-1"],
    evidence: [],
    reasonCodes: [],
    clarificationQuestions: status === "needs_clarification" ? ["AB 的长是多少？"] : []
  })

  it("does not label an empty delivery as answered or no-change", () => {
    render(<RunStatus message={message({ text: "", commit: { status: "no_change" }, solveResult: solve("failed") })} />)

    expect(screen.getByText("未完成")).toBeTruthy()
    expect(screen.queryByText("已回答")).toBeNull()
    expect(screen.queryByText("无需改动")).toBeNull()
  })

  it("labels a partial delivery as partial instead of answered", () => {
    render(<RunStatus message={message({ text: "只答了第一问", commit: { status: "no_change" }, solveResult: solve("partial") })} />)

    expect(screen.getByText("部分回答")).toBeTruthy()
    expect(screen.queryByText("已回答")).toBeNull()
  })

  it("keeps the answered label only when the host accepted the delivery", () => {
    render(<RunStatus message={message({ text: "0", commit: { status: "no_change" }, solveResult: solve("answered") })} />)

    expect(screen.getByText("已回答")).toBeTruthy()
  })
})
