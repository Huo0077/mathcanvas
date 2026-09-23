import { beforeEach, describe, expect, it } from "vitest"

import { createAgentConversation, type AgentConversation, type AgentMessage } from "./agentStore"
import {
  AGENT_STORAGE_KEY,
  DEFAULT_CONVERSATION_BINDING,
  LEGACY_AGENT_STORAGE_KEY,
  MAX_CONVERSATION_MESSAGES,
  MAX_FACT_VALUE_CHARS,
  MAX_MESSAGE_CHARS,
  MAX_SUMMARY_CHARS,
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

  it("reads a whole conversation record (summary + facts + transcript) for the planning context", async () => {
    const repository = createConversationRepository()
    await repository.create(conversation("c1"), bindingA)
    await repository.append(conversation("c1"), bindingA, userMessage("m1", "c1", "画一个正方体"))
    await repository.saveFact({
      ...factFor("c1", "m1"),
      key: "commit:run-1",
      valueJson: { text: "已提交：文档第 2 版新增 1 个对象（solid-1）", generation: 2, createdObjects: ["solid-1"] }
    })
    await repository.saveSummary({ conversationId: "c1", summary: "目标是正方体" })

    // 界面的投影（`read`）里没有摘要与事实；规划上下文读的是**完整记录**这一条。
    const record = await repository.readRecord("c1")
    expect(record?.summary).toBe("目标是正方体")
    expect(record?.summaryVersion).toBe(2)
    expect(record?.conversation.messages.map((message) => message.text)).toEqual(["画一个正方体"])
    expect(record?.facts).toEqual([{ id: "f1", key: "commit:run-1", text: "已提交：文档第 2 版新增 1 个对象（solid-1）", status: "confirmed", documentId: undefined }])
    // 仓储里没有这条会话时如实回 null（不编一条空的）。
    expect(await repository.readRecord("missing")).toBeNull()
  })

  it("surfaces the document a fact was confirmed against", async () => {
    const repository = createConversationRepository()
    await repository.create(conversation("c1"), bindingA)
    await repository.append(conversation("c1"), bindingA, userMessage("m1", "c1", "画一个正方体"))
    await repository.saveFact({
      ...factFor("c1", "m1"),
      key: "commit:run-1",
      valueJson: { text: "已确认：文档第 2 版新增 1 个对象（solid-1）", generation: 2, createdObjects: ["solid-1"], documentId: "doc-a" }
    })

    // 事实"属于哪份文档"不写在列里（那是 Rust 侧的固定 schema），而是写在 `value_json` 里；
    // 读回来必须能看见它 —— 注入上下文时按它筛（规格 §5.1）。
    expect((await repository.readRecord("c1"))?.facts[0]?.documentId).toBe("doc-a")
  })

  /**
   * **两个后端给出一样长的历史**（Fix round 1 / Minor 10）。
   *
   * Rust 侧的读上限是 512（保留最新的一批），而 localStorage 这条路径原先一条不丢 ——
   * 同一份会话在桌面版"少了几条"、在网页版还在，看起来像数据丢了。
   */
  it("keeps the newest 512 messages in the browser backend too", async () => {
    const repository = createConversationRepository()
    await repository.create(conversation("c1"), bindingA)
    for (let at = 0; at < 600; at += 1) await repository.append(conversation("c1"), bindingA, userMessage(`m${at}`, "c1", `第 ${at} 条`))

    const record = await repository.readRecord("c1")
    expect(record?.conversation.messages).toHaveLength(MAX_CONVERSATION_MESSAGES)
    // 保留的是**最新**的那一批。
    expect(record?.conversation.messages.at(-1)?.text).toBe("第 599 条")
    expect(record?.conversation.messages[0]?.text).toBe("第 88 条")
  })

  /**
   * **桌面那一支的 `readRecord` 也真的被测过**（Fix round 1 / Minor 7）。
   *
   * 原先 `__TAURI_INTERNALS__` 那条用例只覆盖了 `create`/`append`，而 `readRecord` 的
   * 断言全在浏览器分支上 —— 于是"桌面读回来的形状对不对、找不到时是不是回 null"没人看着。
   */
  it("reads the full record over IPC too, and answers null when the conversation is gone", async () => {
    const invocations: string[] = []
    Object.defineProperty(globalThis, "__TAURI_INTERNALS__", {
      configurable: true,
      writable: true,
      value: {
        invoke: async (command: string, args?: Record<string, unknown>) => {
          invocations.push(command)
          if (command !== "read_conversation") return []
          if ((args as { conversationId?: string }).conversationId === "missing") throw new Error("no conversation missing")
          return {
            conversation: { id: "c1", ...bindingA, title: "任意三角形", summary: "目标是正方体", summaryVersion: 3, createdAt: 1, updatedAt: 2, archivedAt: null },
            messages: [{ id: "m1", conversationId: "c1", sequence: 1, role: "user", kind: "prompt", contentJson: { text: "画一个正方体" }, runId: "run-1", documentGeneration: null, tokenEstimate: 5, createdAt: 1 }],
            facts: [{ id: "f1", conversationId: "c1", key: "commit:run-1", valueJson: { text: "已确认：文档第 2 版新增 1 个对象（solid-1）", documentId: "doc-a" }, sourceMessageId: "m1", status: "confirmed", createdAt: 1, updatedAt: 1 }]
          }
        }
      }
    })

    try {
      const repository = createConversationRepository()
      const record = await repository.readRecord("c1")

      expect(invocations).toEqual(["read_conversation"])
      expect(record?.summary).toBe("目标是正方体")
      expect(record?.summaryVersion).toBe(3)
      expect(record?.conversation.messages.map((message) => message.text)).toEqual(["画一个正方体"])
      expect(record?.facts[0]?.text).toContain("新增 1 个对象")
      expect(record?.facts[0]?.documentId).toBe("doc-a")
      // 找不到 → null（不是编一条空的，也不是当成 IPC 故障）。
      expect(await repository.readRecord("missing")).toBeNull()
    } finally {
      Reflect.deleteProperty(globalThis, "__TAURI_INTERNALS__")
    }
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

  /**
   * **Task 6 的载荷扫描**：一次真实的会话写入里，**不许**出现三类东西
   * （规格 §1.2/§7）：密钥样串、候选文档内容、以及模型的隐藏推理。
   *
   * 这条用例不是一次性的 grep，而是一道会一直跑的闸：它把一个"什么都有"的消息
   * （含草稿视图、轨迹、开发者诊断）写进去，然后按**键的形状**检查存下来的载荷 ——
   * 所以将来谁给 `AgentMessage` 加一个 `reasoning` 字段，它会当场失败。
   * **每一条消息**都查（Fix round 1 / Minor 5）：只查第一条的话，别的路径加字段就漏了。
   */
  it("never persists a credential, a candidate document or hidden reasoning", async () => {
    const repository = createConversationRepository()
    await repository.create(conversation("c1"), bindingA)
    const message: AgentMessage = {
      ...userMessage("m1", "c1", "建一个棱角 3 的立方体"),
      trace: [{ phase: "planning", status: "ok", summary: "规划这一步要做什么", at: 1 }],
      draft: { draftId: "draft-1", draftVersion: 1, previewHash: "hash", stageCount: 2, undoesInOneStep: true, counts: { user: 2, hidden: 0, derived: 7, internal: 3, total: 9 } },
      diagnostics: ["1. preflight → observing: reading the scene"]
    }
    await repository.append(conversation("c1"), bindingA, message)
    // 第二条走另一条状态路径（回执 + 失败）：只查第一条会漏掉它。
    await repository.append(conversation("c1"), bindingA, {
      ...userMessage("m2", "c1", "再建一个"),
      commit: { status: "committed" },
      failure: { code: "x", message: "y", retryable: false }
    })
    await repository.saveFact({ ...factFor("c1", "m1"), valueJson: { text: "已确认：文档第 2 版新增 1 个对象（solid-1）", generation: 2, createdObjects: ["solid-1"] } })
    await repository.saveSummary({ conversationId: "c1", summary: '{"goal":"建一个立方体","confirmedFacts":[],"createdObjects":["solid-1"],"openQuestions":[],"preferences":[]}' })

    const stored = localStorage.getItem(AGENT_STORAGE_KEY) ?? ""
    // ① 密钥样串（前缀形态：`sk-` / `sk_`）。
    expect(stored).not.toMatch(/sk[-_][A-Za-z0-9]/)
    // ② 候选文档内容：文档字段名一个都不许出现（草稿只存**视图**）。
    for (const field of ["primitives", "candidate", "operations", "contentHash", "epoch"]) expect(stored, field).not.toContain(field)
    // ③ 隐藏推理：**每一条**消息的键只有界面真的拥有的那些。
    const records = JSON.parse(stored) as { messages: { contentJson: Record<string, unknown> }[] }[]
    const allowed = new Set(["id", "role", "text", "createdAt", "pending", "runId", "trace", "draft", "commit", "failure", "diagnostics"])
    for (const record of records) {
      for (const entry of record.messages) {
        for (const key of Object.keys(entry.contentJson)) {
          expect(allowed.has(key), `unexpected persisted field: ${key}`).toBe(true)
        }
      }
    }
    expect(stored).not.toMatch(/reasoning|chain.of.thought/i)
  })

  /**
   * **浏览器兜底也要守 Rust 那条边界**（Fix round 1 / I2）。
   *
   * 桌面路径的判据在 `conversations.rs`（`sk-`/`sk_` 前缀 + 32K 消息 / 16K 摘要 / 8K 事实值），
   * 而 localStorage 那条路径原先**一条都没有** —— 于是一条密钥样的消息只在桌面被拒，
   * 在浏览器里照存不误，而"扫描载荷"的用例（写的是良性消息）永远抓不到这件事。
   */
  it("refuses a credential-shaped message in the browser fallback too", async () => {
    const repository = createConversationRepository()
    await repository.create(conversation("c1"), bindingA)

    expect(() => repository.append(conversation("c1"), bindingA, userMessage("m1", "c1", "帮我看看这个密钥 sk-abcdef123456 怎么用"))).toThrow(/credential/i)
    // 被拒的消息**一行都没写**。
    expect((await repository.readRecord("c1"))?.conversation.messages).toEqual([])

    // 正常内容照旧写进去（判据只认前缀形态，不是"含 sk 就拒"）。
    await repository.append(conversation("c1"), bindingA, userMessage("m2", "c1", "画一个正方体"))
    expect((await repository.readRecord("c1"))?.conversation.messages.map((message) => message.text)).toEqual(["画一个正方体"])
  })

  it("refuses a message, summary or fact value over the Rust size limits", async () => {
    const repository = createConversationRepository()
    await repository.create(conversation("c1"), bindingA)
    await repository.append(conversation("c1"), bindingA, userMessage("m1", "c1", "画一个正方体"))

    // 边界与期望文案都由**导出常量**推导 —— 上一版把 32000/16000/8000 抄在这里，
    // 于是它比 Rust 的 32*1024 小 2.4% 也没人发现（外部审查 M7）。
    expect(() => repository.append(conversation("c1"), bindingA, userMessage("m2", "c1", "x".repeat(MAX_MESSAGE_CHARS + 1)))).toThrow(new RegExp(`over the ${MAX_MESSAGE_CHARS}`))
    expect(() => repository.saveSummary({ conversationId: "c1", summary: "y".repeat(MAX_SUMMARY_CHARS + 1) })).toThrow(new RegExp(`over the ${MAX_SUMMARY_CHARS}`))
    expect(() => repository.saveFact({ ...factFor("c1", "m1"), valueJson: { text: "z".repeat(MAX_FACT_VALUE_CHARS + 1) } })).toThrow(new RegExp(`over the ${MAX_FACT_VALUE_CHARS}`))
  })

  /**
   * **按码点数，而且数字与 Rust 同一份**（外部审查 M7）。
   *
   * 两个后端原先对**同一条内容**给出不同结论，原因有两个、都要钉住：
   * ①数字不同 —— 这里 `32_000`、Rust `32 * 1024`；
   * ②计数方式不同 —— TS 的 `String.length` 数 **UTF-16 码元**，Rust 的 `chars().count()` 数 **码点**。
   * 下面第一条断言就是冲 ② 去的：20 000 个 emoji 是 20 000 码点、却是 40 000 码元 ——
   * 旧实现会以"40000 characters, over the 32000 limit"拒绝一条 Rust 完全接受的正文。
   */
  it("counts code points rather than UTF-16 units, like Rust does", async () => {
    const repository = createConversationRepository()
    await repository.create(conversation("c1"), bindingA)

    // 20 000 码点（40 000 码元）：必须**接受** —— 这正是旧实现拒绝的那一条。
    const emoji = "🙂".repeat(20_000)
    expect(() => repository.append(conversation("c1"), bindingA, userMessage("m1", "c1", emoji))).not.toThrow()

    // 上限之内接受、之外拒绝；文案里报出的数也是**码点**数。
    expect(() => repository.append(conversation("c1"), bindingA, userMessage("m2", "c1", "x".repeat(MAX_MESSAGE_CHARS - 100)))).not.toThrow()
    expect(() => repository.append(conversation("c1"), bindingA, userMessage("m3", "c1", "x".repeat(MAX_MESSAGE_CHARS + 1)))).toThrow(new RegExp(`over the ${MAX_MESSAGE_CHARS}`))
  })

  /**
   * **判据与 Rust 逐字一致：只看"令牌段"的**开头**（Fix round 2 / N1）。
   *
   * Rust 的 `contains_credential_prefix` 先把文本切成"令牌字符"（`[A-Za-z0-9._-]`）的连续段，
   * 再看某一段**是否以** `sk-`/`sk_` 开头。而这一层原先用的是 `/sk[-_][A-Za-z0-9]/`
   * **匹配任意位置** —— 于是 `task-1`、`risk-free`、`disk-space` 这些普通词在浏览器里被当成
   * 密钥拒绝（消息存不下来、运行起不来），在桌面端却被接受：两个后端对同一句话给出不同的
   * 结论，而界面只会说"内容里像有密钥"。
   */
  it("accepts hyphenated words that merely contain the prefix, like the Rust token rule", async () => {
    const repository = createConversationRepository()
    await repository.create(conversation("c1"), bindingA)
    const benign = ["task-1", "risk-free", "disk-space", "desk-job", "risk_free", "sketch-1"]

    for (const [at, text] of benign.entries()) await repository.append(conversation("c1"), bindingA, userMessage(`m${at}`, "c1", text))

    expect((await repository.readRecord("c1"))?.conversation.messages.map((message) => message.text)).toEqual(benign)
    // 但**以**前缀开头的那一段仍然被拒（`sk-` 后面带东西才是密钥的形状）。
    expect(() => repository.append(conversation("c1"), bindingA, userMessage("m-key", "c1", "用 sk-abcdef123456 这个"))).toThrow(/credential/i)
    expect(() => repository.append(conversation("c1"), bindingA, userMessage("m-key2", "c1", "SK_live_abcdef"))).toThrow(/credential/i)
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
