import { beforeEach, describe, expect, it } from "vitest"

import { AGENT_STORAGE_KEY, useAgentStore } from "./agentStore"

/**
 * Task 2.5 Step 1 里属于 store 的部分：**迟到事件**、运行状态、以及"消息里不许出现候选文档"。
 *
 * 这些性质决定了界面会不会出现"停了之后又冒出一段"或"用户文档的副本进了聊天记录"。
 */
function reset(): void {
  localStorage.clear()
  useAgentStore.getState().clearAll()
}

function pendingMessage() {
  const conversation = useAgentStore.getState().activeConversation!
  return conversation.messages.find((message) => message.id === useAgentStore.getState().pendingReplyId)
}

describe("run status on the pending message", () => {
  beforeEach(reset)

  it("appends trace entries in order", () => {
    useAgentStore.getState().sendPrompt("建个立方体")
    useAgentStore.getState().recordRunEvent({ phase: "preflight", status: "ok", summary: "检查通过", at: 1 })
    useAgentStore.getState().recordRunEvent({ phase: "observing", status: "ok", summary: "读了 3 个对象", at: 2 })

    expect(pendingMessage()?.trace?.map((entry) => entry.phase)).toEqual(["preflight", "observing"])
  })

  it("keeps the draft as a view with no document in it", () => {
    // 候选文档只存在于宿主侧的 `DraftStore`。放进这条消息会有两个后果：
    // ① 用户文档的副本被持久化进 localStorage；② 界面成了第二份真相。
    useAgentStore.getState().sendPrompt("建个立方体")
    useAgentStore.getState().recordDraft({ draftId: "draft_1", draftVersion: 2, previewHash: "h", stageCount: 3, undoesInOneStep: true })

    const stored = localStorage.getItem(AGENT_STORAGE_KEY) ?? ""

    expect(stored).toContain("draft_1")
    expect(stored).not.toContain("primitives")
    expect(stored).not.toContain("candidate")
    expect(JSON.stringify(pendingMessage())).not.toContain("primitives")
  })

  it("stops showing progress once a draft is waiting for confirmation", () => {
    /**
     * **这条是本轮修掉的真实缺陷**：`recordDraft` 原先保留了 `pending: true`，
     * 于是运行明明已经停下来等用户确认，界面却一直显示"进行中" ——
     * 用户在浏览器里看到的就是"转不完的加载"，而草稿预览就在下面摆着。
     */
    useAgentStore.getState().sendPrompt("建个立方体")
    useAgentStore.getState().recordDraft({ draftId: "draft_1", draftVersion: 1, previewHash: "h", stageCount: 1, undoesInOneStep: true })

    const assistant = useAgentStore.getState().activeConversation!.messages.at(-1)!
    expect(assistant.draft?.draftId).toBe("draft_1")
    // 等待确认**不是**"还在跑"。
    expect(assistant.pending).toBe(false)
  })

  it("finishes the run when a receipt arrives", () => {    useAgentStore.getState().sendPrompt("建个立方体")
    useAgentStore.getState().recordReceipt({ status: "committed" })

    expect(useAgentStore.getState().pendingReplyId).toBeNull()
    const assistant = useAgentStore.getState().activeConversation!.messages.at(-1)!
    expect(assistant.pending).toBe(false)
    expect(assistant.commit?.status).toBe("committed")
  })

  it("records a failure with its retryability instead of an empty reply", () => {
    useAgentStore.getState().sendPrompt("建个立方体")
    useAgentStore.getState().failPendingReply({ code: "auth_cannot_retry", message: "密钥无效", retryable: false })

    const assistant = useAgentStore.getState().activeConversation!.messages.at(-1)!
    expect(assistant.pending).toBe(false)
    expect(assistant.failure).toMatchObject({ code: "auth_cannot_retry", retryable: false })
  })
})

describe("late events are dropped", () => {
  beforeEach(reset)

  it("ignores a trace entry that arrives after the run finished", () => {
    // 计划 Step 1 点名的 "late response"：结束之后到达的事件不许再改界面。
    useAgentStore.getState().sendPrompt("建个立方体")
    useAgentStore.getState().recordRunEvent({ phase: "preflight", status: "ok", summary: "检查通过", at: 1 })
    useAgentStore.getState().recordReceipt({ status: "committed" })

    useAgentStore.getState().recordRunEvent({ phase: "committing", status: "ok", summary: "迟到的提交事件", at: 2 })

    const assistant = useAgentStore.getState().activeConversation!.messages.at(-1)!
    expect(assistant.trace).toHaveLength(1)
    expect(assistant.trace?.[0].summary).toBe("检查通过")
  })

  it("ignores a receipt that arrives with no run in flight", () => {
    useAgentStore.getState().sendPrompt("建个立方体")
    useAgentStore.getState().recordReceipt({ status: "committed" })
    const before = useAgentStore.getState().activeConversation!.messages.length

    useAgentStore.getState().recordReceipt({ status: "failed", detail: "迟到" })

    expect(useAgentStore.getState().activeConversation!.messages).toHaveLength(before)
  })

  it("does nothing at all when there is no pending message", () => {
    // 没有在途消息时不该**凭空造出**一条消息 —— 那正是"停了之后界面又冒出一段"的来源。
    useAgentStore.getState().sendPrompt("第一句")
    useAgentStore.getState().recordReceipt({ status: "committed" })
    const count = useAgentStore.getState().activeConversation!.messages.length

    useAgentStore.getState().recordRunEvent({ phase: "observing", status: "ok", summary: "无人认领", at: 1 })
    useAgentStore.getState().recordDraft({ draftId: "d", draftVersion: 1, previewHash: "h", stageCount: 1, undoesInOneStep: true })

    expect(useAgentStore.getState().activeConversation!.messages).toHaveLength(count)
  })
})

describe("conversation switching during a run", () => {
  beforeEach(reset)

  it("keeps a run's trace on its own conversation when the user switches away", () => {
    useAgentStore.getState().sendPrompt("第一句")
    const firstId = useAgentStore.getState().activeConversation!.id
    useAgentStore.getState().recordRunEvent({ phase: "observing", status: "ok", summary: "A", at: 1 })

    useAgentStore.getState().createConversation()
    useAgentStore.getState().selectConversation(firstId)

    const first = useAgentStore.getState().conversations.find((conversation) => conversation.id === firstId)!
    expect(first.messages.at(-1)?.trace?.[0].summary).toBe("A")
  })
})
