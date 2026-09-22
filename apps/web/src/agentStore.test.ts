import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { AGENT_STORAGE_KEY, createAgentConversation, useAgentStore } from "./agentStore"
import {
  DEFAULT_CONVERSATION_BINDING,
  createConversationRepository,
  setConversationRepository,
  type ConversationBinding,
  type ConversationRepository
} from "./conversationRepository"

/**
 * Agent 区的对话投影（Task 3 之后它**不再**是真相）。
 *
 * 这个 store 仍然是界面读的那一份状态，但每一条写都必须先过仓储：
 * 仓储拒绝时投影一动不动 —— 界面不该显示一件没写进去的事。
 * 浏览器兜底（localStorage）是同步的，所以那些同步用例的时序**没有变**。
 */

const bindingA: ConversationBinding = { projectId: "local", documentId: "doc-a", workspace: "conics" }
const bindingB: ConversationBinding = { projectId: "local", documentId: "doc-b", workspace: "geometry3d" }

/** 把 store 恢复成一个干净的、带默认绑定的空会话。 */
function resetStore(): void {
  const conversation = createAgentConversation()
  useAgentStore.setState({
    conversations: [conversation],
    activeConversation: conversation,
    activeConversationId: null,
    pendingReplyId: null,
    binding: DEFAULT_CONVERSATION_BINDING
  })
}

/** 一个**拒绝一切写**的仓储（模拟 SQLite 那一侧明确说不）。 */
function refusingRepository(): ConversationRepository {
  const refuse = () => Promise.reject(new Error("the repository refused this write"))
  return {
    loadList: () => Promise.reject(new Error("the repository refused this read")),
    read: refuse,
    readRecord: refuse,
    create: refuse,
    append: refuse,
    saveSummary: refuse,
    saveFact: refuse,
    archive: refuse,
    remove: refuse
  }
}

describe("agent conversation store", () => {
  beforeEach(() => {
    localStorage.clear()
    setConversationRepository(null)
    // `setState` 是浅合并：`activeConversation` 必须与 `conversations[0]` 指向同一个对象，
    // 否则上一个用例留下的引用会让两者不一致（这正是本地跑出来的两条假失败）。
    resetStore()
  })

  afterEach(() => {
    setConversationRepository(null)
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

  it("persists the transcript and restores it on the next load", async () => {
    useAgentStore.getState().sendPrompt("保留这段对话")
    useAgentStore.getState().resolvePendingReply("好的。")
    expect(localStorage.getItem(AGENT_STORAGE_KEY)).toContain("保留这段对话")

    // **真的重新加载一次**（不是从内存里再读一遍）：换到另一个绑定再换回来，
    // 列表与消息都只能来自仓储。
    await useAgentStore.getState().setBinding(bindingB)
    await useAgentStore.getState().setBinding(DEFAULT_CONVERSATION_BINDING)

    const restored = useAgentStore.getState().conversations[0]
    expect(restored?.messages.map((message) => message.text)).toEqual(["保留这段对话", "好的。"])
    // 标题也活下来了（浏览器兜底里会话记录带着它）。
    expect(restored?.title).toBe("保留这段对话")
  })

  it("keeps each conversation's transcript separate and switches between them", async () => {
    useAgentStore.getState().sendPrompt("第一条")
    const firstId = useAgentStore.getState().activeConversation!.id
    useAgentStore.getState().resolvePendingReply("回复一")

    useAgentStore.getState().createConversation()
    useAgentStore.getState().sendPrompt("第二条")

    const state = useAgentStore.getState()
    expect(state.conversations).toHaveLength(2)
    expect(state.activeConversation?.messages[0]?.text).toBe("第二条")

    await state.selectConversation(firstId)
    expect(useAgentStore.getState().activeConversation?.messages[0]?.text).toBe("第一条")
  })

  it("keeps one empty conversation alive when the last one is deleted", async () => {
    const id = useAgentStore.getState().activeConversation!.id
    await useAgentStore.getState().deleteConversation(id)

    const state = useAgentStore.getState()
    expect(state.conversations).toHaveLength(1)
    expect(state.activeConversation?.messages).toEqual([])
    expect(state.activeConversation?.id).not.toBe(id)
  })

  it("loads a separate list for each binding", async () => {
    await useAgentStore.getState().setBinding(bindingA)
    useAgentStore.getState().sendPrompt("A 的问题")
    const inA = useAgentStore.getState().activeConversation!.id

    await useAgentStore.getState().setBinding(bindingB)
    // 另一个文档还没有任何对话：不是"看到上一条"，而是**一条都没有**。
    expect(useAgentStore.getState().conversations.map((conversation) => conversation.messages)).toEqual([[]])

    useAgentStore.getState().sendPrompt("B 的问题")
    const inB = useAgentStore.getState().activeConversation!.id
    expect(inB).not.toBe(inA)

    await useAgentStore.getState().setBinding(bindingA)
    const back = useAgentStore.getState()
    expect(back.conversations.map((conversation) => conversation.id)).toEqual([inA])
    expect(back.activeConversation?.messages[0]?.text).toBe("A 的问题")
  })

  it("does not bring a deleted conversation back when the binding is reloaded", async () => {
    await useAgentStore.getState().setBinding(bindingA)
    useAgentStore.getState().sendPrompt("要删掉的那条")
    const doomed = useAgentStore.getState().activeConversation!.id
    useAgentStore.getState().createConversation()
    useAgentStore.getState().sendPrompt("留下的一条")
    const kept = useAgentStore.getState().activeConversation!.id

    await useAgentStore.getState().deleteConversation(doomed)
    expect(useAgentStore.getState().conversations.map((conversation) => conversation.id)).toEqual([kept])

    // 重新读一次这个绑定：删掉的那条必须**不在**其中（旧的内存列表不算数）。
    await useAgentStore.getState().setBinding(bindingA)

    expect(useAgentStore.getState().conversations.map((conversation) => conversation.id)).toEqual([kept])
  })

  it("refuses to select a conversation the repository no longer has", async () => {
    await useAgentStore.getState().setBinding(bindingA)
    useAgentStore.getState().sendPrompt("第一句")
    const gone = useAgentStore.getState().activeConversation!.id
    useAgentStore.getState().createConversation()
    useAgentStore.getState().sendPrompt("第二句")
    const kept = useAgentStore.getState().activeConversation!.id
    const repository = createConversationRepository()
    await repository.remove(gone)

    // 内存里还留着它（投影是上一次读的快照），但仓储已经没有了 —— 不许把它变回当前会话。
    expect(useAgentStore.getState().conversations.map((conversation) => conversation.id)).toContain(gone)
    expect(await useAgentStore.getState().selectConversation(gone)).toBe(false)

    expect(useAgentStore.getState().activeConversation?.id).toBe(kept)
  })

  it("does not project anything the repository refused (async refusal)", async () => {
    setConversationRepository(refusingRepository())
    const before = useAgentStore.getState().conversations.map((conversation) => conversation.id)

    expect(await useAgentStore.getState().createConversation()).toBe(false)
    expect(useAgentStore.getState().conversations.map((conversation) => conversation.id)).toEqual(before)

    const active = useAgentStore.getState().activeConversation!.id
    expect(await useAgentStore.getState().deleteConversation(active)).toBe(false)
    expect(useAgentStore.getState().conversations.map((conversation) => conversation.id)).toEqual(before)

    expect(await useAgentStore.getState().sendPrompt("这句话不该出现在界面上")).toBe(false)
    expect(useAgentStore.getState().conversations[0].messages).toEqual([])
    expect(useAgentStore.getState().pendingReplyId).toBeNull()
  })

  it("does not project a reply the repository refused", async () => {
    useAgentStore.getState().sendPrompt("先有一条在途消息")
    setConversationRepository(refusingRepository())

    const refused = useAgentStore.getState().resolvePendingReply("这条回复写不进去")
    await Promise.resolve()

    // 桌面那一支**异步**才知道被拒：返回值这一拍还答不了，所以以投影为准。
    expect(useAgentStore.getState().pendingReplyId).not.toBeNull()
    expect(useAgentStore.getState().activeConversation?.messages.at(-1)?.text).toBe("")
    expect(refused).toBeDefined()
  })

  it("returns no reply when the browser serializer refuses it outright", async () => {
    useAgentStore.getState().sendPrompt("先有一条在途消息")
    const refusing: ConversationRepository = {
      ...createConversationRepository(),
      append: () => { throw new Error("localStorage refused") }
    }
    setConversationRepository(refusing)

    // 同步落定的那一支能如实回答："这条回复没有被接受"。
    expect(useAgentStore.getState().resolvePendingReply("这条回复写不进去")).toBeUndefined()
    expect(useAgentStore.getState().pendingReplyId).not.toBeNull()
    expect(useAgentStore.getState().activeConversation?.messages.at(-1)?.text).toBe("")
  })

  it("does not project anything when the browser serializer itself throws", async () => {
    const refusing: ConversationRepository = {
      ...createConversationRepository(),
      create: () => { throw new Error("localStorage refused") },
      append: () => { throw new Error("localStorage refused") }
    }
    setConversationRepository(refusing)

    expect(await useAgentStore.getState().createConversation()).toBe(false)
    expect(await useAgentStore.getState().sendPrompt("写不进去的话")).toBe(false)

    expect(useAgentStore.getState().conversations[0].messages).toEqual([])
    expect(useAgentStore.getState().pendingReplyId).toBeNull()
  })

  it("leaves the projection alone when the repository refuses the read", async () => {
    setConversationRepository(refusingRepository())
    const conversation = createAgentConversation()
    useAgentStore.setState({ conversations: [conversation], activeConversation: conversation, activeConversationId: conversation.id, pendingReplyId: null })

    expect(await useAgentStore.getState().setBinding(bindingA)).toBe(false)
    // 读不回来时既不换绑定，也不清空界面。
    expect(useAgentStore.getState().binding).toEqual(DEFAULT_CONVERSATION_BINDING)
    expect(useAgentStore.getState().conversations.map((candidate) => candidate.id)).toEqual([conversation.id])
  })
})
