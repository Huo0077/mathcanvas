import { afterEach, describe, expect, it } from "vitest"

import {
  appendConversationMessage,
  archiveConversation,
  createConversation,
  deleteConversation,
  listConversations,
  readConversation,
  setConversationFallbackAdapter,
  updateConversationFact,
  updateConversationSummary,
  type ConversationFallbackAdapter,
  type ConversationRecord
} from "./conversationClient"

/**
 * **多会话客户端**（Task 2 的前端那一半）。
 *
 * Rust 侧的判据（外键归属、序号唯一、幂等 id、有界读取、事实必须有证据）都在
 * `tests/conversations.rs` 里；这里要钉住的是**这一层**的四件事：
 *
 * 1. **发出去的形状对不对**（命令名、参数名与字段名各错一个，真机上就是"缺参数"失败）；
 * 2. **浏览器里是正常状态**（`no_desktop_shell`），而 IPC 真的失败要带原因 —— 两者混起来
 *    会让"这个功能要桌面版"看起来像故障；
 * 3. **本地兜底适配器**是**一个边界**：Task 3 会把 `localStorage` 那一份接在这里，
 *    而桌面外壳在的时候它**不许**被碰（否则两条路径会互相覆盖）；
 * 4. **形状不对的载荷不许伪装成一条会话**：编一个空会话比报错危险得多。
 */
const internalsKey = "__TAURI_INTERNALS__"

function installInvoke(invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>) {
  Object.defineProperty(globalThis, internalsKey, { configurable: true, writable: true, value: { invoke } })
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, internalsKey)
  setConversationFallbackAdapter(null)
})

const binding = { projectId: "local", documentId: "doc-1", workspace: "geometry3d" as const }

function record(overrides: Partial<ConversationRecord> = {}): ConversationRecord {
  return {
    id: "c1",
    projectId: "local",
    documentId: "doc-1",
    workspace: "geometry3d",
    title: "任意三角形",
    summary: "",
    summaryVersion: 1,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    archivedAt: null,
    ...overrides
  }
}

const message = {
  id: "m1",
  conversationId: "c1",
  role: "user",
  kind: "text",
  contentJson: { text: "画一个正方体" },
  runId: "run-1",
  documentGeneration: 3,
  tokenEstimate: 12,
  createdAt: 1_700_000_000_000
}

const fact = {
  id: "f1",
  conversationId: "c1",
  key: "triangle.vertices",
  valueJson: { a: [1, 3], b: [0, 0], c: [4, 0] },
  sourceMessageId: "m1",
  status: "confirmed" as const,
  createdAt: 1_700_000_000_000
}

describe("命令名与序列化后的载荷", () => {
  it("建会话：把整条新会话交给 `create_conversation`", async () => {
    const calls: { command: string; args?: Record<string, unknown> }[] = []
    installInvoke(async (command, args) => {
      calls.push({ command, args })
      return record({ id: (args as { conversation: { id: string } }).conversation.id })
    })

    const result = await createConversation({ id: "c1", ...binding, title: "任意三角形" })

    expect(calls).toHaveLength(1)
    expect(calls[0].command).toBe("create_conversation")
    // 字段名逐字对应 Rust 的 `NewConversation`（`deny_unknown_fields` 会让多出来的字段
    // 变成一次拒绝 —— 所以这一层**不许**自己加料）。
    expect(calls[0].args).toEqual({ conversation: { id: "c1", projectId: "local", documentId: "doc-1", workspace: "geometry3d", title: "任意三角形" } })
    expect(result.ok && result.value.id).toBe("c1")
  })

  it("列会话：整个绑定一起发（项目、文档、工作区）", async () => {
    const calls: { command: string; args?: Record<string, unknown> }[] = []
    installInvoke(async (command, args) => {
      calls.push({ command, args })
      return [record()]
    })

    const result = await listConversations(binding)

    expect(calls[0].command).toBe("list_conversations")
    expect(calls[0].args).toEqual({ binding: { projectId: "local", documentId: "doc-1", workspace: "geometry3d" } })
    expect(result.ok && result.value).toHaveLength(1)
  })

  it("读会话：只要一个会话 id", async () => {
    const calls: { command: string; args?: Record<string, unknown> }[] = []
    installInvoke(async (command, args) => {
      calls.push({ command, args })
      return { conversation: record(), messages: [{ ...message, sequence: 1 }], facts: [{ ...fact, updatedAt: fact.createdAt }] }
    })

    const result = await readConversation("c1")

    expect(calls[0].command).toBe("read_conversation")
    expect(calls[0].args).toEqual({ conversationId: "c1" })
    expect(result.ok && result.value.messages[0].sequence).toBe(1)
    expect(result.ok && result.value.facts[0].key).toBe("triangle.vertices")
  })

  it("追加消息：整条消息发出去，幂等结果如实回传", async () => {
    const calls: { command: string; args?: Record<string, unknown> }[] = []
    installInvoke(async (command, args) => {
      calls.push({ command, args })
      return false
    })

    const result = await appendConversationMessage(message)

    expect(calls[0].command).toBe("append_conversation_message")
    expect(calls[0].args).toEqual({ message })
    // 同一个 id 第二次写回 `false`：**幂等是结果，不是错误**（重放不该让界面报错）。
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe(false)
  })

  it("写摘要：带上期望版本号（没有就**不带这个键**）", async () => {
    const calls: { command: string; args?: Record<string, unknown> }[] = []
    installInvoke(async (command, args) => {
      calls.push({ command, args })
      return record({ summary: "目标是画一个正方体", summaryVersion: 2 })
    })

    await updateConversationSummary({ conversationId: "c1", summary: "目标是画一个正方体", expectedVersion: 1 })
    await updateConversationSummary({ conversationId: "c1", summary: "无条件的重写" })

    expect(calls[0].command).toBe("update_conversation_summary")
    expect(calls[0].args).toEqual({ conversationId: "c1", summary: "目标是画一个正方体", expectedVersion: 1 })
    // `undefined` 在 JSON 里会消失；显式写成 `null` 则会让 Rust 侧的 `Option<i64>`
    // 拿到 `Some`/`None` 之外的东西 —— 所以这里要求**有与没有**两种形状各是各的。
    expect(calls[1].args).toEqual({ conversationId: "c1", summary: "无条件的重写" })
    expect(Object.keys(calls[1].args as object)).not.toContain("expectedVersion")
  })

  it("写事实：整条事实发出去（含证据消息 id 与状态）", async () => {
    const calls: { command: string; args?: Record<string, unknown> }[] = []
    installInvoke(async (command, args) => {
      calls.push({ command, args })
      return { ...fact, updatedAt: fact.createdAt }
    })

    const result = await updateConversationFact(fact)

    expect(calls[0].command).toBe("update_conversation_fact")
    expect(calls[0].args).toEqual({ fact })
    expect(result.ok && result.value.status).toBe("confirmed")
  })

  it("归档与删除：都只要一个会话 id", async () => {
    const calls: { command: string; args?: Record<string, unknown> }[] = []
    installInvoke(async (command, args) => {
      calls.push({ command, args })
      return command === "delete_conversation" ? true : record({ archivedAt: 1 })
    })

    await archiveConversation("c1")
    await deleteConversation("c1")

    expect(calls.map((call) => call.command)).toEqual(["archive_conversation", "delete_conversation"])
    expect(calls[0].args).toEqual({ conversationId: "c1" })
    expect(calls[1].args).toEqual({ conversationId: "c1" })
  })
})

describe("两种失败分开说", () => {
  it("在浏览器里跑是**预期**状态，不是错误", async () => {
    // 没有注入 `__TAURI_INTERNALS__`：这就是浏览器。
    const created = await createConversation({ id: "c1", ...binding, title: "任意三角形" })
    const listed = await listConversations(binding)

    expect(created.ok).toBe(false)
    if (!created.ok) {
      expect(created.code).toBe("no_desktop_shell")
      expect(created.detail).toContain("browser")
    }
    expect(listed.ok).toBe(false)
    if (!listed.ok) expect(listed.code).toBe("no_desktop_shell")
  })

  it("IPC 真的失败时把原因带出来", async () => {
    installInvoke(async () => {
      throw new Error("the project repository is not initialised")
    })

    const result = await listConversations(binding)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("ipc_failed")
      expect(result.detail).toContain("repository")
    }
  })

  it("形状不对的载荷不许伪装成一条会话", async () => {
    installInvoke(async (command) => (command === "read_conversation" ? { nothing: true } : "not an array"))

    const read = await readConversation("c1")
    const listed = await listConversations(binding)

    expect(read.ok).toBe(false)
    if (!read.ok) {
      expect(read.code).toBe("ipc_failed")
      expect(read.detail).toContain("conversation")
    }
    // 列表里的坏条目被丢掉，而不是当成一条空会话。
    expect(listed.ok && listed.value).toEqual([])
  })
})

describe("本地兜底适配器是一个边界", () => {
  const fallbackCalls: string[] = []
  const fallback: ConversationFallbackAdapter = {
    create: async (conversation) => {
      fallbackCalls.push("create")
      return record({ id: conversation.id, title: conversation.title })
    },
    list: async () => {
      fallbackCalls.push("list")
      return [record()]
    },
    read: async () => {
      fallbackCalls.push("read")
      return { conversation: record(), messages: [], facts: [] }
    },
    append: async () => {
      fallbackCalls.push("append")
      return true
    },
    updateSummary: async () => {
      fallbackCalls.push("updateSummary")
      return record({ summary: "本地摘要", summaryVersion: 2 })
    },
    updateFact: async () => {
      fallbackCalls.push("updateFact")
      return { ...fact, updatedAt: fact.createdAt }
    },
    archive: async () => {
      fallbackCalls.push("archive")
      return record({ archivedAt: 1 })
    },
    remove: async () => {
      fallbackCalls.push("remove")
      return true
    }
  }

  afterEach(() => {
    fallbackCalls.length = 0
  })

  it("浏览器里交给兜底适配器（Task 3 会把 localStorage 那一份接在这里）", async () => {
    setConversationFallbackAdapter(fallback)

    const created = await createConversation({ id: "c1", ...binding, title: "任意三角形" })
    const listed = await listConversations(binding)
    const appended = await appendConversationMessage(message)
    const removed = await deleteConversation("c1")

    expect(created.ok && created.value.id).toBe("c1")
    expect(listed.ok && listed.value).toHaveLength(1)
    expect(appended.ok && appended.value).toBe(true)
    expect(removed.ok && removed.value).toBe(true)
    expect(fallbackCalls).toEqual(["create", "list", "append", "remove"])
  })

  it("桌面外壳在的时候兜底适配器**一次都不许被碰**", async () => {
    const calls: string[] = []
    installInvoke(async (command) => {
      calls.push(command)
      return [record()]
    })
    setConversationFallbackAdapter(fallback)

    const listed = await listConversations(binding)

    expect(listed.ok && listed.value).toHaveLength(1)
    expect(calls).toEqual(["list_conversations"])
    expect(fallbackCalls).toEqual([])
  })

  it("兜底适配器自己失败时如实报错，而不是当成'在浏览器里'", async () => {
    setConversationFallbackAdapter({ ...fallback, list: async () => { throw new Error("localStorage 满了") } })

    const listed = await listConversations(binding)

    expect(listed.ok).toBe(false)
    if (!listed.ok) {
      // 这一次**真的**出错了：报 `ipc_failed` 并带上原因，而不是回一句"没有桌面外壳"。
      expect(listed.code).toBe("ipc_failed")
      expect(listed.detail).toContain("localStorage")
    }
  })
})
