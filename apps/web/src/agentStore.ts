import { create } from "zustand"

import { deriveConversationTitle } from "./agentTranscript"

/**
 * Agent 区的对话状态。
 *
 * 单独一个 store（而不是塞进 `store.ts`）：排版上看，这里存的是"聊天记录 + 草稿视图"，
 * 与 `useSceneStore` 里的几何文档是**互不相干**的两层状态；分开之后，Agent 区的重渲染
 * 不会牵动画布的订阅者，反之亦然。持久化也只写聊天记录，绝不碰 `.mgeo` 草稿。
 */

export type AgentMessageRole = "user" | "assistant"

export interface AgentMessage {
  id: string
  role: AgentMessageRole
  text: string
  createdAt: number
  /** 等待回复中的助手消息：界面据此显示"思考中"，而不是一条空气泡。 */
  pending?: boolean
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
  clearAll: () => void
}

function persist(conversations: AgentConversation[]): void {
  if (typeof localStorage === "undefined") return
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
  clearAll: () => {
    const conversation = createAgentConversation()
    persist([conversation])
    set({ conversations: [conversation], activeConversationId: conversation.id, activeConversation: conversation, pendingReplyId: null })
  }
}))
