import { fireEvent, render, screen } from "@testing-library/react"
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

  it("sends a multi-line prompt with the button and appends it to the transcript", () => {
    render(<AgentWorkspace onBackToWorkspace={() => {}} />)

    const input = screen.getByRole("textbox", { name: "对话输入" })
    fireEvent.change(input, { target: { value: "画一个正方体\n并求它的体积" } })
    fireEvent.click(screen.getByRole("button", { name: "发送" }))

    const log = screen.getByRole("log", { name: "对话记录" })
    expect(log.querySelectorAll("[data-message-role]")).toHaveLength(2)
    expect(log.textContent).toContain("画一个正方体")
    expect((input as HTMLTextAreaElement).value).toBe("")
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
