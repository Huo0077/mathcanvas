import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"

import { createAgentConversation, useAgentStore } from "../../agentStore"
import { AgentWorkspace } from "./AgentWorkspace"

/**
 * `zustand` 的 `setState` 是浅合并：只换 `conversations` 会让上一个用例留下的
 * `activeConversation` 对象继续指着旧数组里的那条对话，于是用例之间会互相污染。
 * 这里一次把三件相关状态一起重置。
 */
function resetAgentStore(): void {
  useAgentStore.setState({ ...emptyAgentState(), activeConversationId: null, pendingReplyId: null })
}

function emptyAgentState() {
  const conversation = createAgentConversation()
  return { conversations: [conversation], activeConversation: conversation }
}

describe("agent workspace", () => {
  beforeEach(() => {
    localStorage.clear()
    resetAgentStore()
  })

  it("keeps the empty state focused on the composer until the first prompt", () => {
    render(<AgentWorkspace onBackToWorkspace={() => {}} />)

    expect(screen.getByRole("heading", { name: "有什么数学问题要一起做？" })).toBeTruthy()
    expect(screen.getByRole("log", { name: "对话记录" }).textContent).toContain("发送第一条指令后")
    expect(screen.getByRole("button", { name: "发送" }).hasAttribute("disabled")).toBe(true)
  })

  it("sends a multi-line prompt with the button and appends it to the transcript", async () => {
    render(<AgentWorkspace onBackToWorkspace={() => {}} />)

    const input = screen.getByRole("textbox", { name: "对话输入" })
    fireEvent.change(input, { target: { value: "画一个正方体\n并求它的体积" } })
    fireEvent.click(screen.getByRole("button", { name: "发送" }))

    const log = screen.getByRole("log", { name: "对话记录" })
    expect(log.querySelectorAll("[data-message-role]")).toHaveLength(2)
    expect(log.textContent).toContain("画一个正方体")
    /**
     * **期望在 Fix round 1 / Minor 1 里改过**：输入框原先在按下发送**那一刻**就清空，
     * 而被拒的指令（例如内容像密钥，浏览器与桌面同一条边界）会因此凭空消失。
     * 现在它**在发送被接受之后**才清空（一次微任务），被拒时保留原文并给一句说明。
     */
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(""))
  })

  it("sends with Enter and keeps a newline for Shift+Enter", () => {
    render(<AgentWorkspace onBackToWorkspace={() => {}} />)

    const input = screen.getByRole("textbox", { name: "对话输入" })
    fireEvent.change(input, { target: { value: "第一行" } })
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true })
    expect(screen.getByRole("log", { name: "对话记录" }).querySelectorAll("[data-message-role]")).toHaveLength(0)

    fireEvent.keyDown(input, { key: "Enter", shiftKey: false })
    expect(screen.getByRole("log", { name: "对话记录" }).querySelectorAll("[data-message-role]")).toHaveLength(2)
  })

  it("renders fenced code from an assistant reply in its own code block", () => {
    useAgentStore.getState().sendPrompt("给我一段脚本")
    useAgentStore.getState().resolvePendingReply("照下面这样写：\n```js\nconst a = 1\n```")

    render(<AgentWorkspace onBackToWorkspace={() => {}} />)

    const code = screen.getByRole("log", { name: "对话记录" }).querySelector("code")
    expect(code?.textContent).toBe("const a = 1")
    expect(code?.closest("[data-code-language]")?.getAttribute("data-code-language")).toBe("js")
  })

  it("starts a new conversation and switches between transcripts from the sidebar", () => {
    useAgentStore.getState().sendPrompt("第一条对话")
    useAgentStore.getState().resolvePendingReply("收到")

    render(<AgentWorkspace onBackToWorkspace={() => {}} />)
    expect(screen.getByRole("log", { name: "对话记录" }).textContent).toContain("第一条对话")

    fireEvent.click(screen.getByRole("button", { name: "新建对话" }))
    expect(screen.getByRole("button", { name: "发送" }).hasAttribute("disabled")).toBe(true)

    // 侧栏里"打开对话"按钮的无障碍名字是「标题 + 轮数·时间」，删除按钮是「删除对话：标题」；
    // 用 ^ 锚定标题，只命中前者。新对话是插入到列表头部的，所以不能按位置取第一个。
    fireEvent.click(screen.getByRole("button", { name: /^第一条对话/ }))
    expect(screen.getByRole("log", { name: "对话记录" }).textContent).toContain("第一条对话")
  })

  it("offers a way back into the canvas workspace", () => {
    let back = 0
    render(<AgentWorkspace onBackToWorkspace={() => { back += 1 }} />)

    fireEvent.click(screen.getByRole("button", { name: "返回画布" }))
    expect(back).toBe(1)
  })
})

/**
 * Task 2.5 Step 2：**生产路径上不再有演示回复**。
 *
 * 组件早先自己挂 `setTimeout` 调 `composeDemoReply` 造一段常量文本。现在它只负责
 * "发起 + 显示"：谁去跑由注入的 `onRun` 决定。下面这几条守住这条边界。
 */
describe("the workspace never invents a reply", () => {
  beforeEach(() => {
    localStorage.clear()
    resetAgentStore()
  })

  it("hands the prompt and the prompt message id to the injected runner", () => {
    // `promptMessageId` 是运行账本与界面消息对应的依据（计划原句）。
    const runs: { prompt: string; promptMessageId: string }[] = []
    render(<AgentWorkspace onBackToWorkspace={() => {}} onRun={(prompt, promptMessageId) => { runs.push({ prompt, promptMessageId }) }} />)

    fireEvent.change(screen.getByRole("textbox", { name: "对话输入" }), { target: { value: "建一个立方体" } })
    fireEvent.click(screen.getByRole("button", { name: "发送" }))

    expect(runs).toHaveLength(1)
    expect(runs[0].prompt).toBe("建一个立方体")
    // 必须是**那条用户消息的 id**，而不是随便一个字符串。
    const conversation = useAgentStore.getState().activeConversation!
    const userMessage = conversation.messages.find((message) => message.role === "user")!
    expect(runs[0].promptMessageId).toBe(userMessage.id)
  })

  it("shows the running state instead of a fabricated answer", () => {
    render(<AgentWorkspace onBackToWorkspace={() => {}} onRun={() => {}} />)

    fireEvent.change(screen.getByRole("textbox", { name: "对话输入" }), { target: { value: "建一个立方体" } })
    fireEvent.click(screen.getByRole("button", { name: "发送" }))

    const log = screen.getByRole("log", { name: "对话记录" })
    // 有用户消息与在途助手消息，但**没有任何**编造出来的回答文本。
    expect(log.querySelectorAll("[data-message-role]")).toHaveLength(2)
    expect(log.textContent).not.toContain("本地占位")
    expect(log.textContent).not.toContain("还没有接入模型服务")
  })

  it("runs each prompt exactly once even though the effect re-renders", () => {
    // StrictMode 的二次挂载、以及 store 更新引起的重渲染，都不能让同一轮跑两遍。
    let runs = 0
    const { rerender } = render(<AgentWorkspace onBackToWorkspace={() => {}} onRun={() => { runs += 1 }} />)

    fireEvent.change(screen.getByRole("textbox", { name: "对话输入" }), { target: { value: "建一个立方体" } })
    fireEvent.click(screen.getByRole("button", { name: "发送" }))
    rerender(<AgentWorkspace onBackToWorkspace={() => {}} onRun={() => { runs += 1 }} />)

    expect(runs).toBe(1)
  })

  it("works without a runner at all, so the shell cannot crash", () => {
    // 没有注入 runner 时界面仍然可用（只是不会跑）—— 不该抛错。
    render(<AgentWorkspace onBackToWorkspace={() => {}} />)

    fireEvent.change(screen.getByRole("textbox", { name: "对话输入" }), { target: { value: "建一个立方体" } })
    expect(() => fireEvent.click(screen.getByRole("button", { name: "发送" }))).not.toThrow()
    expect(screen.getByRole("log", { name: "对话记录" }).textContent).toContain("建一个立方体")
  })
})
