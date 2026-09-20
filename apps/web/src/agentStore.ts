import { create } from "zustand"

import type { DraftObjectCounts } from "@draw/agent-core"

import { deriveConversationTitle } from "./agentTranscript"

/**
 * Agent 区的对话状态。
 *
 * 单独一个 store（而不是塞进 `store.ts`）：排版上看，这里存的是"聊天记录 + 草稿视图"，
 * 与 `useSceneStore` 里的几何文档是**互不相干**的两层状态；分开之后，Agent 区的重渲染
 * 不会牵动画布的订阅者，反之亦然。持久化也只写聊天记录，绝不碰 `.mgeo` 草稿。
 */

export type AgentMessageRole = "user" | "assistant"

/**
 * 运行轨迹里的一条（**给用户看的**简短摘要）。
 *
 * 刻意**不是** `RunEvent`：那个类型来自 `@draw/agent-core`，带九个标识与三方版本，是账本用的；
 * 界面只要"阶段 + 一句人话 + 状态"。两者分开，界面就不会因为账本加字段而跟着改。
 */
export interface AgentTraceEntry {
  phase: string
  status: "ok" | "warning" | "error"
  summary: string
  at: number
}

/**
 * 草稿在界面上的**视图**。
 *
 * 这里**只有**标识与计数 —— **没有候选文档、没有操作列表**。
 * 草稿的候选文档只存在于宿主侧的 `DraftStore` 里，界面拿到的是"将要发生什么"的说明。
 * 把候选文档放进 store 会有两个后果：① 它会被持久化进 localStorage（用户文档的副本出现在聊天记录里）；
 * ② 界面就成了第二份真相。有一条用例专门断言存下来的消息里**没有**文档字段。
 */
export interface AgentDraftView {
  draftId: string
  draftVersion: number
  previewHash: string
  stageCount: number
  /** 确认之后整批只占一步撤销（计划要求的"exact one-undo statement"）。 */
  undoesInOneStep: boolean
  /** 候选文档的对象计数（**由宿主侧从真实文档算出**，界面不自己估）。 */
  counts?: DraftObjectCounts
  /** 基础文档的对象计数，用来显示"这次会多出/少掉多少"。 */
  baseCounts?: DraftObjectCounts
  /**
   * **规划器替用户做的假设**（"我按直径 6 读作半径 3"）。
   *
   * 放在草稿视图上而不是另开一个字段，是因为它只有与这份草稿一起看才有意义：
   * 用户确认的是这份草稿，而假设正是"这份草稿为什么长这样"的说明。
   * 计划信封里可以声明它（`EnvelopeAssumptions`），界面只负责显示，不负责猜。
   */
  assumptions?: string[]
}

/** 提交回执：成功与否、有没有真的改动、失败原因。 */
export interface AgentCommitView {
  status: "committed" | "no_change" | "failed"
  detail?: string
}

export interface AgentMessage {
  id: string
  role: AgentMessageRole
  text: string
  createdAt: number
  /** 等待回复中的助手消息：界面据此显示"思考中"，而不是一条空气泡。 */
  pending?: boolean
  /** 这条消息对应的运行 id（用户消息与它的助手回复共用，便于按 runId 订阅）。 */
  runId?: string
  /** 运行轨迹：按到达顺序追加，界面据此显示阶段进度。 */
  trace?: AgentTraceEntry[]
  /** 已暂存的草稿（**只是视图**，见 `AgentDraftView`）。 */
  draft?: AgentDraftView
  /** 提交结果。 */
  commit?: AgentCommitView
  /** 失败原因（人话），供界面显示可执行的下一步。 */
  failure?: { code: string; message: string; retryable: boolean }
}

export interface AgentConversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: AgentMessage[]
}

export const AGENT_STORAGE_KEY = "mathcanvas:agent-conversations"

export const NEW_CONVERSATION_TITLE = "新对话"

let sequence = 0

/** 稳定的本地 id：不依赖 crypto（测试环境与旧浏览器都要能跑）。 */
function nextId(prefix: string): string {
  sequence += 1
  return `${prefix}-${Date.now().toString(36)}-${sequence}`
}

export function createAgentConversation(title = NEW_CONVERSATION_TITLE): AgentConversation {
  const now = Date.now()
  return { id: nextId("conversation"), title, createdAt: now, updatedAt: now, messages: [] }
}

/**
 * 对**在途助手消息**做一次不可变更新。
 *
 * 没有在途消息时**什么都不做**：迟到的运行事件不该凭空造出一条消息
 *（那正是"停了之后界面又冒出一段"这类 bug 的来源）。
 */
function updatePending(
  get: () => AgentState,
  set: (partial: Partial<AgentState>) => void,
  update: (message: AgentMessage) => AgentMessage
): void {
  const pendingId = get().pendingReplyId
  if (!pendingId) return
  const conversations = get().conversations.map((conversation) => conversation.messages.some((message) => message.id === pendingId)
    ? { ...conversation, updatedAt: Date.now(), messages: conversation.messages.map((message) => (message.id === pendingId ? update(message) : message)) }
    : conversation)
  persist(conversations)
  set({ conversations, activeConversation: resolveActive(conversations, get().activeConversationId) })
}

interface AgentState {
  conversations: AgentConversation[]
  /** `null` = 跟随最近一次改动的那条对话。 */
  activeConversationId: string | null
  /** 正在等待回复的那条助手消息 id；`null` 表示没有在途请求。 */
  pendingReplyId: string | null
  activeConversation: AgentConversation | undefined
  createConversation: () => void
  selectConversation: (id: string) => void
  deleteConversation: (id: string) => void
  sendPrompt: (prompt: string) => void
  resolvePendingReply: (text: string) => AgentMessage | undefined
  /** 记一条运行轨迹（追加，不替换）。 */
  recordRunEvent: (entry: AgentTraceEntry) => void
  /** 记下已暂存的草稿**视图**。 */
  recordDraft: (draft: AgentDraftView) => void
  /** 记下提交结果；`committed` / `no_change` 都算结束。 */
  recordReceipt: (receipt: AgentCommitView) => void
  /** 运行失败：保留原因与"能不能重试"，而不是给一条空回复。 */
  failPendingReply: (failure: { code: string; message: string; retryable: boolean }) => void
  clearAll: () => void
}

function persist(conversations: AgentConversation[]): void {  if (typeof localStorage === "undefined") return
  // 与 `draftStorage` 同一口径：配额溢出 / 隐私模式下存不进去，也不能让点击崩掉。
  try {
    localStorage.setItem(AGENT_STORAGE_KEY, JSON.stringify(conversations))
  } catch {
    // 这一次持久化放弃，会话内状态仍然生效。
  }
}

/** 只认回形状正确的消息：手改过的 localStorage 不能让整块界面白屏。 */
function restoreConversations(serialized: string): AgentConversation[] {
  const parsed = JSON.parse(serialized) as unknown
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((candidate): AgentConversation[] => {
    if (!candidate || typeof candidate !== "object") return []
    const record = candidate as Partial<AgentConversation>
    if (typeof record.id !== "string" || !Array.isArray(record.messages)) return []
    const messages = record.messages.flatMap((message): AgentMessage[] => {
      if (!message || typeof message !== "object") return []
      const item = message as Partial<AgentMessage>
      if (typeof item.id !== "string" || typeof item.text !== "string") return []
      return [{ id: item.id, role: item.role === "assistant" ? "assistant" : "user", text: item.text, createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now() }]
    })
    const createdAt = typeof record.createdAt === "number" ? record.createdAt : Date.now()
    return [{
      id: record.id,
      title: typeof record.title === "string" && record.title ? record.title : NEW_CONVERSATION_TITLE,
      createdAt,
      updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : createdAt,
      messages
    }]
  })
}

function loadConversations(): AgentConversation[] {
  if (typeof localStorage === "undefined") return [createAgentConversation()]
  const serialized = localStorage.getItem(AGENT_STORAGE_KEY)
  if (!serialized) return [createAgentConversation()]
  try {
    const restored = restoreConversations(serialized)
    return restored.length > 0 ? restored : [createAgentConversation()]
  } catch {
    // 内容坏了就当作没有历史，别把异常抛到渲染路径上。
    return [createAgentConversation()]
  }
}

function mostRecent(conversations: AgentConversation[]): AgentConversation | undefined {
  return [...conversations].sort((left, right) => right.updatedAt - left.updatedAt)[0]
}

function resolveActive(conversations: AgentConversation[], activeConversationId: string | null): AgentConversation | undefined {
  return conversations.find((conversation) => conversation.id === activeConversationId) ?? mostRecent(conversations)
}

const initialConversations = loadConversations()

export const useAgentStore = create<AgentState>((set, get) => ({
  conversations: initialConversations,
  activeConversationId: null,
  pendingReplyId: null,
  activeConversation: mostRecent(initialConversations),
  createConversation: () => {
    const conversation = createAgentConversation()
    set((state) => {
      const conversations = [conversation, ...state.conversations]
      persist(conversations)
      return { conversations, activeConversationId: conversation.id, pendingReplyId: null, activeConversation: conversation }
    })
  },
  selectConversation: (id) => {
    const conversation = get().conversations.find((candidate) => candidate.id === id)
    if (!conversation) return
    set({ activeConversationId: id, activeConversation: conversation, pendingReplyId: null })
  },
  deleteConversation: (id) => {
    set((state) => {
      const remaining = state.conversations.filter((conversation) => conversation.id !== id)
      // 永远留一条空对话：侧栏清空之后用户仍然应该有一个可以直接说话的地方。
      const conversations = remaining.length > 0 ? remaining : [createAgentConversation()]
      persist(conversations)
      const activeConversation = resolveActive(conversations, state.activeConversationId === id ? null : state.activeConversationId)
      return { conversations, activeConversation, activeConversationId: activeConversation?.id ?? null, pendingReplyId: null }
    })
  },
  sendPrompt: (prompt) => {
    const text = prompt.trim()
    if (!text) return
    const now = Date.now()
    const userMessage: AgentMessage = { id: nextId("message"), role: "user", text, createdAt: now }
    const pendingMessage: AgentMessage = { id: nextId("message"), role: "assistant", text: "", createdAt: now, pending: true }
    // 一条消息都没有的对话才改名：用户后续追问不应该把标题越改越偏。
    const target = resolveActive(get().conversations, get().activeConversationId)!
    const updated: AgentConversation = {
      ...target,
      title: target.messages.length === 0 ? deriveConversationTitle(text) || target.title : target.title,
      updatedAt: now,
      messages: [...target.messages, userMessage, pendingMessage]
    }
    const conversations = get().conversations.map((conversation) => (conversation.id === target.id ? updated : conversation))
    persist(conversations)
    set({ conversations, activeConversationId: updated.id, activeConversation: updated, pendingReplyId: pendingMessage.id })
  },
  resolvePendingReply: (text) => {
    const pendingId = get().pendingReplyId
    if (!pendingId) return undefined
    const resolved = get().conversations.flatMap((conversation) => conversation.messages).find((message) => message.id === pendingId)
    const reply: AgentMessage | undefined = resolved ? { ...resolved, text, pending: false } : undefined
    const conversations = get().conversations.map((conversation) => conversation.messages.some((message) => message.id === pendingId)
      ? { ...conversation, updatedAt: Date.now(), messages: conversation.messages.map((message) => (message.id === pendingId ? { ...message, text, pending: false } : message)) }
      : conversation)
    persist(conversations)
    set({ conversations, activeConversation: resolveActive(conversations, get().activeConversationId), pendingReplyId: null })
    return reply
  },
  /**
   * 轨迹 / 草稿 / 回执三类更新共用一个内部实现：它们都是"改**那条在途助手消息**"。
   *
   * 抽出来不是为了少写几行，而是为了让三条规则只有一处：
   * ① 没有在途消息时**什么都不做**（不要凭空造一条消息）；
   * ② 终态（收到回执 / 失败）之后 `pendingReplyId` 清空，因此**迟到的事件会被丢弃** ——
   *    这正是计划 Step 1 点名的 "late response" 场景；
   * ③ 每次都持久化。
   */
  recordRunEvent: (entry) => updatePending(get, set, (message) => message.pending
    ? { ...message, trace: [...(message.trace ?? []), entry] }
    : message),
  recordDraft: (draft) => updatePending(get, set, (message) => message.pending ? { ...message, draft, pending: false } : message),
  recordReceipt: (receipt) => {
    const pendingId = get().pendingReplyId
    if (!pendingId) return
    const conversations = get().conversations.map((conversation) => conversation.messages.some((message) => message.id === pendingId)
      ? { ...conversation, updatedAt: Date.now(), messages: conversation.messages.map((message) => (message.id === pendingId ? { ...message, pending: false, commit: receipt, text: receipt.status === "committed" ? "已按确认提交。" : receipt.status === "no_change" ? "这次没有需要改动的地方。" : "" } : message)) }
      : conversation)
    persist(conversations)
    set({ conversations, activeConversation: resolveActive(conversations, get().activeConversationId), pendingReplyId: null })
  },
  failPendingReply: (failure) => {
    const pendingId = get().pendingReplyId
    if (!pendingId) return
    const conversations = get().conversations.map((conversation) => conversation.messages.some((message) => message.id === pendingId)
      ? { ...conversation, updatedAt: Date.now(), messages: conversation.messages.map((message) => (message.id === pendingId ? { ...message, pending: false, failure, text: "" } : message)) }
      : conversation)
    persist(conversations)
    set({ conversations, activeConversation: resolveActive(conversations, get().activeConversationId), pendingReplyId: null })
  },
  clearAll: () => {
    const conversation = createAgentConversation()
    persist([conversation])
    set({ conversations: [conversation], activeConversationId: conversation.id, activeConversation: conversation, pendingReplyId: null })
  }
}))
