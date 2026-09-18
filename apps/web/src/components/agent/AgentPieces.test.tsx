import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { createAgentConversation, useAgentStore } from "../../agentStore"
import { AgentComposer } from "./AgentComposer"
import { AgentConversationSidebar } from "./AgentConversationSidebar"
import { AgentMessageList } from "./AgentMessageList"

describe("agent pieces", () => {
  beforeEach(() => {
    localStorage.clear()
    const conversation = createAgentConversation()
    useAgentStore.setState({ conversations: [conversation], activeConversation: conversation, activeConversationId: null, pendingReplyId: null })
  })

  it("keeps the send button disabled until there is a prompt", () => {
    const onSend = vi.fn()
    render(<AgentComposer onSend={onSend} />)

    const send = screen.getByRole("button", { name: "发送" })
    expect(send.hasAttribute("disabled")).toBe(true)

    fireEvent.change(screen.getByRole("textbox", { name: "对话输入" }), { target: { value: "作一条切线" } })
    expect(send.hasAttribute("disabled")).toBe(false)
    fireEvent.click(send)
    expect(onSend).toHaveBeenCalledWith("作一条切线")
  })

  it("shows a busy composer while a reply is pending so a second send cannot race it", () => {
    render(<AgentComposer onSend={() => {}} busy />)

    fireEvent.change(screen.getByRole("textbox", { name: "对话输入" }), { target: { value: "再来一条" } })
    expect(screen.getByRole("button", { name: "回复中" }).hasAttribute("disabled")).toBe(true)
    expect(screen.getByRole("status").textContent).toContain("正在生成")
  })

  it("marks pending assistant messages instead of rendering an empty bubble", () => {
    useAgentStore.getState().sendPrompt("画一个圆")
    const conversation = useAgentStore.getState().activeConversation!

    render(<AgentMessageList conversation={conversation} />)

    expect(screen.getByRole("status").textContent).toContain("正在生成")
    expect(screen.getByRole("log", { name: "对话记录" }).querySelectorAll("[data-message-role]")).toHaveLength(2)
  })

  it("lists conversations with their titles and selects one on click", () => {
    useAgentStore.getState().sendPrompt("第一个任务")
    useAgentStore.getState().resolvePendingReply("好")
    const first = useAgentStore.getState().activeConversation!
    useAgentStore.getState().createConversation()

    const onSelect = vi.fn()
    render(<AgentConversationSidebar conversations={useAgentStore.getState().conversations} activeId={useAgentStore.getState().activeConversation!.id} onSelect={onSelect} onCreate={() => {}} onDelete={() => {}} />)

    // 打开对话的按钮名字是"标题 + 轮数·时间"，删除按钮是"删除对话：标题"；
    // 用 ^ 锚定标题开头，只命中前者。
    fireEvent.click(screen.getByRole("button", { name: /^第一个任务/ }))
    expect(onSelect).toHaveBeenCalledWith(first.id)
  })
})
