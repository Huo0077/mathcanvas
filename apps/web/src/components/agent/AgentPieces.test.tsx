import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { createAgentConversation, useAgentStore, type AgentMessage } from "../../agentStore"
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

  it("keeps the text and says why when the send was refused", async () => {
    /**
     * **被拒的指令不能凭空消失**（Fix round 1 / Minor 1）。
     *
     * `sendPrompt` 会拒绝"内容像密钥"这类消息（浏览器与桌面同一条边界），而输入框原先
     * 在按下发送那一刻就清空 —— 用户看到自己的指令没了，却没有任何说明。
     */
    render(<AgentComposer onSend={() => Promise.resolve(false)} />)

    const input = screen.getByRole("textbox", { name: "对话输入" }) as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: "sk-abcdef 帮我看看" } })
    fireEvent.click(screen.getByRole("button", { name: "发送" }))

    // 输入还在，并且有一句可照做的说明。
    expect(input.value).toBe("sk-abcdef 帮我看看")
    expect(await screen.findByRole("alert")).toBeTruthy()
    expect(screen.getByRole("alert").textContent).toContain("没有被接受")
  })

  it("clears the composer once the send was accepted", async () => {
    render(<AgentComposer onSend={() => Promise.resolve(true)} />)

    const input = screen.getByRole("textbox", { name: "对话输入" }) as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: "画一个圆" } })
    fireEvent.click(screen.getByRole("button", { name: "发送" }))

    await waitFor(() => expect(input.value).toBe(""))
    expect(screen.queryByRole("alert")).toBeNull()
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

  /**
   * **面板上的按钮说的是"这一轮"**（Fix round 1 / C2；规格 §5.4）。
   *
   * 面板按消息渲染，而运行状态原先只有模块级**单槽** —— 用户在有两条会话时点确认，
   * 会提交**最近那一轮**的草稿（可能是另一条会话的）。所以回调必须带上这条消息自己的 `runId`。
   */
  it("hands the message's own run id to confirm/discard/stop", () => {
    const conversation = createAgentConversation()
    const assistant: AgentMessage = {
      id: "message-a",
      role: "assistant",
      text: "",
      createdAt: 1,
      runId: "run-7",
      draft: { draftId: "draft-1", draftVersion: 1, previewHash: "h", stageCount: 1, undoesInOneStep: true }
    }
    const onConfirm = vi.fn()
    const onDiscard = vi.fn()
    const onStop = vi.fn()

    render(<AgentMessageList conversation={{ ...conversation, messages: [assistant] }} onConfirm={onConfirm} onDiscard={onDiscard} onStop={onStop} />)

    fireEvent.click(screen.getByRole("button", { name: "确认并提交" }))
    fireEvent.click(screen.getByRole("button", { name: "丢弃草稿" }))

    expect(onConfirm).toHaveBeenCalledWith("run-7")
    expect(onDiscard).toHaveBeenCalledWith("run-7")
  })
})
