import { beforeEach, describe, expect, it } from "vitest"

import { AGENT_STORAGE_KEY, createAgentConversation, useAgentStore } from "./agentStore"

describe("agent conversation store", () => {
  beforeEach(() => {
    localStorage.clear()
    // `setState` 是浅合并：`activeConversation` 必须与 `conversations[0]` 指向同一个对象，
    // 否则上一个用例留下的引用会让两者不一致（这正是本地跑出来的两条假失败）。
    const conversation = createAgentConversation()
    useAgentStore.setState({ conversations: [conversation], activeConversation: conversation, activeConversationId: null, pendingReplyId: null })
  })

  it("starts on one empty conversation the user can talk into", () => {
    const state = useAgentStore.getState()
    const active = state.conversations[0]

    expect(state.conversations).toHaveLength(1)
    expect(state.activeConversation).toBe(active)
    expect(active.messages).toEqual([])
    expect(active.title).toBe("新对话")
  })

  it("records the prompt, marks a pending reply and titles the conversation from the first prompt", () => {
    useAgentStore.getState().sendPrompt("画一个正方体")

    const conversation = useAgentStore.getState().activeConversation
    expect(conversation?.title).toBe("画一个正方体")
    expect(conversation?.messages.map((message) => message.role)).toEqual(["user", "assistant"])
    const pending = useAgentStore.getState().resolvePendingReply("已收到。")
    expect(pending?.role).toBe("assistant")
    expect(pending?.text).toBe("已收到。")
    expect(useAgentStore.getState().pendingReplyId).toBeNull()
    expect(useAgentStore.getState().activeConversation?.messages).toHaveLength(2)
  })

  it("ignores blank prompts so an empty composer cannot create a turn", () => {
    useAgentStore.getState().sendPrompt("   \n ")

    expect(useAgentStore.getState().activeConversation?.messages).toEqual([])
  })

  it("persists the transcript and restores it on the next load", () => {
    useAgentStore.getState().sendPrompt("保留这段对话")
    useAgentStore.getState().resolvePendingReply("好的。")
    expect(localStorage.getItem(AGENT_STORAGE_KEY)).toContain("保留这段对话")

    const restored = useAgentStore.getState().conversations
    useAgentStore.setState({ conversations: [], activeConversationId: null, pendingReplyId: null })
    expect(restored[0]?.messages).toHaveLength(2)
  })

  it("keeps each conversation's transcript separate and switches between them", () => {
    useAgentStore.getState().sendPrompt("第一条")
    const firstId = useAgentStore.getState().activeConversation!.id
    useAgentStore.getState().resolvePendingReply("回复一")

    useAgentStore.getState().createConversation()
    useAgentStore.getState().sendPrompt("第二条")

    const state = useAgentStore.getState()
    expect(state.conversations).toHaveLength(2)
    expect(state.activeConversation?.messages[0]?.text).toBe("第二条")

    state.selectConversation(firstId)
    expect(useAgentStore.getState().activeConversation?.messages[0]?.text).toBe("第一条")
  })

  it("keeps one empty conversation alive when the last one is deleted", () => {
    const id = useAgentStore.getState().activeConversation!.id
    useAgentStore.getState().deleteConversation(id)

    const state = useAgentStore.getState()
    expect(state.conversations).toHaveLength(1)
    expect(state.activeConversation?.messages).toEqual([])
    expect(state.activeConversation?.id).not.toBe(id)
  })
})
