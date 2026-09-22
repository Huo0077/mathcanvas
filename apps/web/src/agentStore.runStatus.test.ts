import { beforeEach, describe, expect, it } from "vitest"

import { AGENT_STORAGE_KEY, useAgentStore, type AgentMessage } from "./agentStore"
import { conversationRepository } from "./conversationRepository"
import { readConversation } from "./services/conversationClient"

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

/** 某条用户消息的 id（运行器钉住一轮运行时要用的就是它）。 */
function userMessageIdOf(text: string): string {
  const conversation = useAgentStore.getState().activeConversation!
  return conversation.messages.find((message) => message.role === "user" && message.text === text)!.id
}

function messageById(conversationId: string, messageId: string): AgentMessage | undefined {
  return useAgentStore.getState().conversations.find((conversation) => conversation.id === conversationId)?.messages.find((message) => message.id === messageId)
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

/**
 * **旧事件写回原会话**（对话切片 Task 5；规格 §5.4）。
 *
 * "切换会话不取消旧运行；旧事件仍写回原会话，不能写入新会话。"
 * 上面那条守的是"切走再切回来还看得到"；这一节守的是**这一轮一开始绑的是哪条会话**：
 * 用户切到 B、甚至在 B 里发了新的一句之后，A 那一轮的事件仍然落回 A 的那条消息上，
 * 而且**永远不许**落到 B 上（那正是最隐蔽的一种串会话）。
 */
describe("a run writes back to the conversation it started in", () => {
  beforeEach(reset)

  it("routes a late event to the original conversation instead of the one on screen", () => {
    useAgentStore.getState().sendPrompt("A 的问题")
    const first = useAgentStore.getState().activeConversation!
    const pinned = useAgentStore.getState().pinRun({ runId: "run-a", promptMessageId: userMessageIdOf("A 的问题") })

    expect(pinned?.conversationId).toBe(first.id)

    // 用户切到另一条会话，并在那里也发了话。
    useAgentStore.getState().createConversation()
    useAgentStore.getState().sendPrompt("B 的问题")
    const second = useAgentStore.getState().activeConversation!

    // 迟到的事件与回执属于 A 那一轮。
    useAgentStore.getState().recordRunEvent({ phase: "observing", status: "ok", summary: "迟到的事件", at: 1 }, "run-a")
    void useAgentStore.getState().recordReceipt({ status: "committed" }, "run-a")

    const landed = messageById(first.id, pinned!.messageId)
    expect(landed?.trace?.[0]?.summary).toBe("迟到的事件")
    expect(landed?.commit?.status).toBe("committed")
    // B 那条在途消息一点都不该沾上 A 的事件。
    expect(second.messages.some((message) => message.trace !== undefined || message.commit !== undefined)).toBe(false)
  })

  it("drops events that arrive after the run ended", () => {
    useAgentStore.getState().sendPrompt("A 的问题")
    const conversationId = useAgentStore.getState().activeConversation!.id
    const pinned = useAgentStore.getState().pinRun({ runId: "run-a", promptMessageId: userMessageIdOf("A 的问题") })!

    useAgentStore.getState().recordReceipt({ status: "committed" }, "run-a")
    useAgentStore.getState().endRun("run-a")
    useAgentStore.getState().recordRunEvent({ phase: "completed", status: "ok", summary: "结束之后才到", at: 9 }, "run-a")

    // 运行已经结束：这一轮不再接受任何事件（"停了之后界面又冒出一段"那条纪律）。
    expect(messageById(conversationId, pinned.messageId)?.trace).toBeUndefined()
  })

  it("records a committed run's document generation and created objects as a confirmed fact", async () => {
    useAgentStore.getState().sendPrompt("建一个立方体")
    const conversationId = useAgentStore.getState().activeConversation!.id
    const promptMessageId = userMessageIdOf("建一个立方体")
    useAgentStore.getState().pinRun({ runId: "run-commit", promptMessageId })

    expect(await useAgentStore.getState().recordCommittedRun({ runId: "run-commit", generation: 4, createdObjects: ["solid-1", "solid-2"] })).toBe(true)

    const record = await conversationRepository().readRecord(conversationId)
    expect(record?.facts).toHaveLength(1)
    expect(record?.facts[0].status).toBe("confirmed")
    expect(record?.facts[0].text).toContain("第 4 版")
    expect(record?.facts[0].text).toContain("solid-1")
    // 证据必须是**这条会话里真实存在**的消息（Rust 侧同一个判据）：从原始记录里看那一列。
    const stored = await readConversation(conversationId)
    expect(stored.ok && stored.value.facts[0].sourceMessageId).toBe(promptMessageId)
  })

  it("leaves no facts behind when the run never committed", async () => {
    useAgentStore.getState().sendPrompt("建一个立方体")
    const conversationId = useAgentStore.getState().activeConversation!.id
    const promptMessageId = userMessageIdOf("建一个立方体")
    useAgentStore.getState().pinRun({ runId: "run-discarded", promptMessageId })
    // 用户丢弃草稿：这一轮**没有**提交，所以什么都不该写进长期记忆。
    void useAgentStore.getState().recordDraft({ draftId: "draft-1", draftVersion: 1, previewHash: "h", stageCount: 2, undoesInOneStep: true }, "run-discarded")
    useAgentStore.getState().endRun("run-discarded")

    const record = await conversationRepository().readRecord(conversationId)
    expect(record?.facts).toEqual([])
    expect(record?.summary).toBe("")
  })

  it("compacts a long transcript into a structural summary and keeps the raw messages", async () => {
    useAgentStore.getState().sendPrompt("建一个立方体")
    const conversationId = useAgentStore.getState().activeConversation!.id
    for (let turn = 0; turn < 40; turn += 1) {
      useAgentStore.getState().sendPrompt(`第 ${turn} 轮：请继续在这个文档上作图（${"很长的上下文".repeat(20)}）`)
      useAgentStore.getState().resolvePendingReply(`收到 ${turn}`)
    }
    const promptMessageId = userMessageIdOf("建一个立方体")
    useAgentStore.getState().pinRun({ runId: "run-long", promptMessageId })

    await useAgentStore.getState().recordCommittedRun({ runId: "run-long", generation: 7, createdObjects: ["solid-1"] })

    const record = await conversationRepository().readRecord(conversationId)
    const summary = JSON.parse(record!.summary) as { goal: string; confirmedFacts: string[]; createdObjects: string[]; openQuestions: string[]; preferences: string[] }
    expect(summary.goal).toContain("建一个立方体")
    expect(summary.createdObjects).toEqual(["solid-1"])
    expect(summary.confirmedFacts.length).toBeGreaterThan(0)
    // 摘要**压缩的是摘要，不是历史**：原始消息一条都不许删（规格 §5.3）。
    expect(record!.conversation.messages.length).toBeGreaterThan(40)
  })

  it("keeps a short transcript out of the summary path", async () => {
    useAgentStore.getState().sendPrompt("建一个立方体")
    const conversationId = useAgentStore.getState().activeConversation!.id
    useAgentStore.getState().pinRun({ runId: "run-short", promptMessageId: userMessageIdOf("建一个立方体") })

    await useAgentStore.getState().recordCommittedRun({ runId: "run-short", generation: 2, createdObjects: ["solid-1"] })

    // 还没到阈值：摘要保持原样（""），事实照写。
    const record = await conversationRepository().readRecord(conversationId)
    expect(record?.summary).toBe("")
    expect(record?.facts).toHaveLength(1)
  })
})
