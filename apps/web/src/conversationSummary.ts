import type { ConversationFactView, ConversationMessageView } from "@draw/agent-core"

/**
 * **会话摘要的结构化压缩**（对话切片 Task 5；规格 §5.3）。
 *
 * 规格原文：长对话摘要用**结构化 JSON**，记录"目标、确认事实、已创建对象、未解决问题和用户偏好"，
 * 不保存 hidden chain-of-thought。所以这里**不是**"让模型写一段总结"：
 *
 * - 它是**纯函数**：同一份输入给出同一份摘要（可测、可复现、无网络）；
 * - 它只从**已经存在的东西**里取（用户说过的话、已确认事实、这一轮创建的对象）——
 *   编不出一条没有来源的结论，也就没有"摘要模型自己升级了事实"这条路（规格 §10）；
 * - 它**只换摘要，不动历史**：原始消息留在仓储里（规格 §5.3），压缩的是"进上下文的那一段"。
 *
 * 阈值按字符算（4 字符 ≈ 1 token 的粗估），因为真正被压缩的是进提示词的字符数。
 */

/** 触发压缩的阈值：约 1000 token。低于它时摘要保持原样（不写、不覆盖）。 */
export const SUMMARY_TRIGGER_CHARACTERS = 4_000
/** 摘要里每一项的上限（摘要本身也不许长到把最近消息挤没）。 */
export const MAX_SUMMARY_GOAL_CHARACTERS = 240
export const MAX_SUMMARY_ITEMS = 12
export const MAX_SUMMARY_ITEM_CHARACTERS = 200

/** 结构化摘要本体。字段名与规格 §5.3 那五样逐字对应。 */
export interface ConversationSummary {
  goal: string
  confirmedFacts: string[]
  createdObjects: string[]
  openQuestions: string[]
  preferences: string[]
  /** 压缩时这条会话有多少条消息（"这份摘要覆盖到哪儿"）。 */
  messageCount: number
  compactedAt: number
}

export interface CompactSummaryInput {
  /** 会话消息（时间序）。 */
  messages: readonly ConversationMessageView[]
  /** 已经存下来的事实。**只有 `confirmed` 会进摘要**。 */
  facts: readonly ConversationFactView[]
  /** 这一轮（以及之前几轮）创建的对象 id。 */
  createdObjects?: readonly string[]
  /** 上一次的摘要（用来承接已经记录下来的对象与偏好）。 */
  previous?: ConversationSummary | null
  now?: number
  /** 阈值覆盖（测试与将来的配置用；只能**收紧**，见 `clampTrigger`）。 */
  triggerCharacters?: number
}

function bounded(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))]
}

/** 会话到目前为止的字符量（**估算**：被压缩的是进提示词的字符数）。 */
export function estimateConversationCharacters(messages: readonly ConversationMessageView[]): number {
  return messages.reduce((total, message) => total + message.text.length, 0)
}

function clampTrigger(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return SUMMARY_TRIGGER_CHARACTERS
  // 调用方只能把阈值**调低**（更早压缩）：调高等于让摘要无限膨胀。
  return Math.min(Math.floor(value), SUMMARY_TRIGGER_CHARACTERS * 4)
}

/** 这条会话是不是已经长到该压缩了。 */
export function shouldCompactConversation(messages: readonly ConversationMessageView[], triggerCharacters?: number): boolean {
  return estimateConversationCharacters(messages) >= clampTrigger(triggerCharacters)
}

/**
 * 用户偏好：**显式句式**才算（"记住…""以后都…""不要…"）。
 *
 * 用句式而不是"让模型判断语义"：摘要必须可复现，而"这句话算不算偏好"只要交给模型，
 * 同一段对话就会有不同摘要 —— 那份摘要又会进下一次规划的提示词。
 */
const PREFERENCE_PATTERN = /记住|以后|每次|不要|请始终|偏好/

/** 只读提问（澄清）结束的助手消息：它们是"这一轮没解决的事"。 */
function looksLikeQuestion(text: string): boolean {
  return /[?？]\s*$/.test(text.trim())
}

export function compactConversationSummary(input: CompactSummaryInput): ConversationSummary {
  const confirmed = input.facts.filter((fact) => fact.status === "confirmed")
  const users = input.messages.filter((message) => message.role === "user")
  const assistants = input.messages.filter((message) => message.role === "assistant")

  const goal = bounded(users[0]?.text ?? input.previous?.goal ?? "", MAX_SUMMARY_GOAL_CHARACTERS)
  const confirmedFacts = unique([...(input.previous?.confirmedFacts ?? []), ...confirmed.map((fact) => fact.text)])
    .slice(-MAX_SUMMARY_ITEMS)
    .map((text) => bounded(text, MAX_SUMMARY_ITEM_CHARACTERS))
  const createdObjects = unique([...(input.previous?.createdObjects ?? []), ...(input.createdObjects ?? [])]).slice(-MAX_SUMMARY_ITEMS)
  const openQuestions = unique([...assistants.filter((message) => looksLikeQuestion(message.text)).map((message) => message.text)])
    .slice(-3)
    .map((text) => bounded(text, MAX_SUMMARY_ITEM_CHARACTERS))
  const preferences = unique([...(input.previous?.preferences ?? []), ...users.filter((message) => PREFERENCE_PATTERN.test(message.text)).map((message) => message.text)])
    .slice(-2)
    .map((text) => bounded(text, MAX_SUMMARY_ITEM_CHARACTERS))

  return {
    goal,
    confirmedFacts,
    createdObjects,
    openQuestions,
    preferences,
    messageCount: input.messages.length,
    compactedAt: input.now ?? Date.now()
  }
}

/** 摘要写进 `conversations.summary` 的形状：**结构化 JSON 一行**。 */
export function serializeConversationSummary(summary: ConversationSummary): string {
  return JSON.stringify(summary)
}

/** 读回一份摘要；不是我们写的那种形状（或没有）时回 `null`。 */
export function parseConversationSummary(serialized: string): ConversationSummary | null {
  if (serialized.trim().length === 0) return null
  try {
    const parsed = JSON.parse(serialized) as Partial<ConversationSummary>
    if (typeof parsed !== "object" || parsed === null || typeof parsed.goal !== "string") return null
    const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [])
    return {
      goal: parsed.goal,
      confirmedFacts: list(parsed.confirmedFacts),
      createdObjects: list(parsed.createdObjects),
      openQuestions: list(parsed.openQuestions),
      preferences: list(parsed.preferences),
      messageCount: typeof parsed.messageCount === "number" ? parsed.messageCount : 0,
      compactedAt: typeof parsed.compactedAt === "number" ? parsed.compactedAt : 0
    }
  } catch {
    return null
  }
}
