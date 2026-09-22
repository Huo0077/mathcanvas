import { beforeEach, describe, expect, it } from "vitest"

import { createAgentConversation, type AgentConversation, type AgentMessage } from "./agentStore"
import {
  AGENT_STORAGE_KEY,
  DEFAULT_CONVERSATION_BINDING,
  LEGACY_AGENT_STORAGE_KEY,
  createConversationRepository,
  setConversationRepository,
  type ConversationBinding
} from "./conversationRepository"
import { conversationFallbackAdapter, createConversation, listConversations, readConversation } from "./services/conversationClient"

/**
 * **会话仓储**（Task 3 的持久化那一半）。
 *
 * 计划点名的四条接口 —— `loadList(binding)` / `append(message)` / `saveSummary(...)` /
 * `saveFact(...)` —— 都在这里钉住；另外三条是**绑定**带来的性质：
 * 一个会话只属于一个 project/document/workspace、两个绑定各读各的列表、
 * 删掉的会话不能从任何旧缓存里回来。
 *
 * 桌面那一半（SQLite IPC）与浏览器那一半（localStorage 序列化器）各有一个用例证明
 * 自己那条路真的被走了 —— 因为"两条路径同时活着"正是它们互相覆盖的方式。
 */

const bindingA: ConversationBinding = { projectId: "local", documentId: "doc-a", workspace: "conics" }
const bindingB: ConversationBinding = { projectId: "local", documentId: "doc-b", workspace: "geometry3d" }

function conversation(id: string, title = "任意三角形"): AgentConversation {
  return { id, title, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, messages: [] }
}

function userMessage(id: string, conversationId: string, text: string): AgentMessage {
  return { id, role: "user", text, createdAt: 1_700_000_000_000, runId: `${conversationId}-run` }
}

function factFor(conversationId: string, sourceMessageId: string) {
  return {
    id: "f1",
    conversationId,
    key: "triangle.vertices",
    valueJson: { a: [1, 3], b: [0, 0], c: [4, 0] },
    sourceMessageId,
    status: "confirmed" as const,
    createdAt: 1_700_000_000_000
  }
}

describe("conversation repository", () => {
  beforeEach(() => {
    localStorage.clear()
    setConversationRepository(null)
  })

  it("keeps two bindings' conversation lists apart", async () => {
    const repository = createConversationRepository()

    await repository.create(conversation("c-a", "A 的对话"), bindingA)
    await repository.create(conversation("c-b", "B 的对话"), bindingB)

    // 列表**永远按整个绑定取**：只按项目过滤会把另一份文档的历史漏进这一份。
    expect((await repository.loadList(bindingA)).map((candidate) => candidate.id)).toEqual(["c-a"])
    expect((await repository.loadList(bindingB)).map((candidate) => candidate.id)).toEqual(["c-b"])
    expect(await repository.loadList({ projectId: "local", documentId: "doc-a", workspace: "geometry3d" })).toEqual([])
  })

  it("does not resurrect a deleted conversation from a list that was read before the delete", async () => {
    const repository = createConversationRepository()
    await repository.create(conversation("c1"), bindingA)
    const before = await repository.loadList(bindingA)
    expect(before.map((candidate) => candidate.id)).toEqual(["c1"])

    await repository.remove("c1")

    // 删掉之后：新的读里没有它，单读也没有它 —— 旧的那次读不会被写回去。
    expect((await repository.loadList(bindingA)).map((candidate) => candidate.id)).toEqual([])
    expect(await repository.read("c1")).toBeNull()
    expect(localStorage.getItem(AGENT_STORAGE_KEY) ?? "").not.toContain("\"c1\"")
  })

  it("appends a message once per id and reads the transcript back in order", async () => {
    const repository = createConversationRepository()
    await repository.create(conversation("c1"), bindingA)

    await repository.append(conversation("c1"), bindingA, userMessage("m1", "c1", "画一个正方体"))
    // 同一个 id 重放是**空操作**（幂等键），不是第二行。
    await repository.append(conversation("c1"), bindingA, userMessage("m1", "c1", "画一个正方体"))
    await repository.append(conversation("c1"), bindingA, userMessage("m2", "c1", "再画一条对角线"))

    const loaded = await repository.read("c1")
    expect(loaded?.messages.map((message) => [message.id, message.text])).toEqual([
      ["m1", "画一个正方体"],
      ["m2", "再画一条对角线"]
    ])
  })

  it("keeps the transcript in the browser serializer, not in SQLite", async () => {
    const repository = createConversationRepository()
    await repository.create(conversation("c1"), bindingA)
    await repository.append(conversation("c1"), bindingA, userMessage("m1", "c1", "画一个正方体"))

    const stored = localStorage.getItem(AGENT_STORAGE_KEY) ?? ""
    expect(stored).toContain("画一个正方体")
    expect(stored).toContain("doc-a")
  })

  it("refuses a fact whose evidence message is not in that same conversation", async () => {
    const repository = createConversationRepository()
    await repository.create(conversation("c1"), bindingA)

    // 证据必须是一条**真实存在**的同会话消息（Rust 侧的判据，这里必须有同样的判断）。
    expect(() => repository.saveFact(factFor("c1", "m-missing"))).toThrow(/evidence/i)
  })

  it("writes a fact whose evidence exists and bumps the summary version", async () => {
    const repository = createConversationRepository()
    await repository.create(conversation("c1"), bindingA)
    await repository.append(conversation("c1"), bindingA, userMessage("m1", "c1", "画一个正方体"))

    await repository.saveFact(factFor("c1", "m1"))
    // 同一个 key 再写一次是**同一条事实**（upsert），不是第二条。
    await repository.saveFact({ ...factFor("c1", "m1"), valueJson: { a: [2, 6], b: [0, 0], c: [8, 0] } })
    await repository.saveSummary({ conversationId: "c1", summary: "目标是正方体" })

    // 摘要与事实**不进界面的投影**（`AgentConversation` 里没有它们的位置）：
    // 它们是规划上下文，读回来走客户端那一条（Task 4 的注入路径）。
    const loaded = await readConversation("c1")
    expect(loaded.ok && loaded.value.facts).toHaveLength(1)
    expect(loaded.ok && loaded.value.facts[0].status).toBe("confirmed")
    expect(loaded.ok && loaded.value.facts[0].sourceMessageId).toBe("m1")
    expect(loaded.ok && loaded.value.conversation.summary).toBe("目标是正方体")
    expect(loaded.ok && loaded.value.conversation.summaryVersion).toBe(2)
  })

  it("hides an archived conversation from the list without deleting it", async () => {
    const repository = createConversationRepository()
    await repository.create(conversation("c1"), bindingA)

    await repository.archive("c1")

    expect(await repository.loadList(bindingA)).toEqual([])
    expect((await repository.read("c1"))?.id).toBe("c1")
  })

  it("keeps a pre-binding transcript under a side key instead of silently deleting it", async () => {
    const legacy = [{ id: "old-1", title: "旧对话", createdAt: 1, updatedAt: 2, messages: [{ id: "m-old", role: "user", text: "老消息", createdAt: 1 }] }]
    localStorage.setItem(AGENT_STORAGE_KEY, JSON.stringify(legacy))

    const repository = createConversationRepository()

    // 绑定之前的记录**没有**绑定信息：不猜它属于哪份文档（猜就是跨文档串历史）。
    expect(await repository.loadList(DEFAULT_CONVERSATION_BINDING)).toEqual([])
    // 但也绝不静默删除：旧的一份原样留在旁路键上。
    expect(localStorage.getItem(LEGACY_AGENT_STORAGE_KEY)).toContain("老消息")
    expect(localStorage.getItem(AGENT_STORAGE_KEY) ?? "").not.toContain("老消息")
  })

  it("hands the browser fallback to the client, so the client's own calls reach localStorage", async () => {
    // Task 2 留的边界：`setConversationFallbackAdapter` 是浏览器里唯一的落点。
    expect(conversationFallbackAdapter()).not.toBeNull()

    await createConversation({ id: "c-fallback", ...bindingA, title: "兜底" })
    const listed = await listConversations(bindingA)

    expect(listed.ok && listed.value.map((record) => record.id)).toEqual(["c-fallback"])
    expect(localStorage.getItem(AGENT_STORAGE_KEY) ?? "").toContain("c-fallback")
  })

  it("uses the named SQLite commands (and never the local cache) while the desktop shell is present", async () => {
    const calls: string[] = []
    Object.defineProperty(globalThis, "__TAURI_INTERNALS__", {
      configurable: true,
      writable: true,
      value: {
        invoke: async (command: string) => {
          calls.push(command)
          if (command === "create_conversation") return { id: "c1", ...bindingA, title: "任意三角形", summary: "", summaryVersion: 1, createdAt: 1, updatedAt: 1, archivedAt: null }
          if (command === "read_conversation") return { conversation: { id: "c1", ...bindingA, title: "任意三角形", summary: "", summaryVersion: 1, createdAt: 1, updatedAt: 1, archivedAt: null }, messages: [], facts: [] }
          if (command === "append_conversation_message") return true
          return []
        }
      }
    })

    try {
      const repository = createConversationRepository()
      await repository.create(conversation("c1"), bindingA)
      await repository.append(conversation("c1"), bindingA, userMessage("m1", "c1", "画一个正方体"))

      expect(calls).toContain("create_conversation")
      expect(calls).toContain("append_conversation_message")
      // 桌面外壳在的时候，localStorage 那份兜底**一次都不许被碰**。
      expect(localStorage.getItem(AGENT_STORAGE_KEY)).toBeNull()
    } finally {
      Reflect.deleteProperty(globalThis, "__TAURI_INTERNALS__")
    }
  })

  it("exposes the store-facing default so the first paint does not wait for anything", () => {
    // 没有绑定信息时，界面用的是一个**本地默认绑定**（Task 4/5 会用真实文档覆盖它）。
    expect(DEFAULT_CONVERSATION_BINDING.projectId).toBe("local")
    expect(createAgentConversation().messages).toEqual([])
  })
})
