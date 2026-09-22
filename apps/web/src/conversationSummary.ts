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
  /**
   * **这份摘要是哪份文档的**（规格 §5.1；Fix round 2 / C1 残余）。
   *
   * 摘要是长期记忆的载体之一：没有这一项，注入方只能把"这份会话的摘要"整段端给任何一轮，
   * 而在立体几何里确认的事实（原文与创建出来的对象 id）就会以 `summary` 的形式
   * 出现在平面几何那一轮里 —— 事实列表筛了，载体没筛等于没筛。
   */
  documentId?: string
}

/**
 * **按文档分开的摘要**（存进 `conversations.summary` 的那份 JSON）。
 *
 * 一条会话可以被用在两份文档上（这个应用里 Agent 自己会为执行计划切工作区），
 * 而它的事实/摘要是**文档级**的：所以存储形状是"一份文档一份摘要"，
 * 注入时只取本次运行那份文档的那一份。
 */
export const SUMMARY_BOOK_VERSION = 2

export interface ConversationSummaryBook {
  version: number
  byDocument: Record<string, ConversationSummary>
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
    return asConversationSummary(JSON.parse(serialized))
  } catch {
    return null
  }
}

/** 形状收窄：只认我们写过的那些字段（多一个少一个都不猜）。 */
function asConversationSummary(value: unknown): ConversationSummary | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const parsed = value as Partial<ConversationSummary>
  if (typeof parsed.goal !== "string") return null
  const list = (candidate: unknown): string[] => (Array.isArray(candidate) ? candidate.filter((entry): entry is string => typeof entry === "string") : [])
  return {
    goal: parsed.goal,
    confirmedFacts: list(parsed.confirmedFacts),
    createdObjects: list(parsed.createdObjects),
    openQuestions: list(parsed.openQuestions),
    preferences: list(parsed.preferences),
    messageCount: typeof parsed.messageCount === "number" ? parsed.messageCount : 0,
    compactedAt: typeof parsed.compactedAt === "number" ? parsed.compactedAt : 0,
    ...(typeof parsed.documentId === "string" && parsed.documentId.length > 0 ? { documentId: parsed.documentId } : {})
  }
}

/**
 * 读回**按文档分开的那本摘要**。
 *
 * 读不出这本形状时回一本**空的**：旧形状（平铺的一份摘要）没有说它属于哪份文档，
 * 而"猜一个"就是把别份文档的记忆端给这一轮 —— 宁可当作还没有摘要。
 */
export function parseConversationSummaryBook(serialized: string): ConversationSummaryBook {
  const empty: ConversationSummaryBook = { version: SUMMARY_BOOK_VERSION, byDocument: {} }
  if (serialized.trim().length === 0) return empty
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch {
    return empty
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return empty
  const book = parsed as Partial<ConversationSummaryBook>
  if (book.version !== SUMMARY_BOOK_VERSION || typeof book.byDocument !== "object" || book.byDocument === null) return empty

  const byDocument: Record<string, ConversationSummary> = {}
  for (const [documentId, value] of Object.entries(book.byDocument)) {
    const summary = asConversationSummary(value)
    if (summary) byDocument[documentId] = { ...summary, documentId }
  }
  return { version: SUMMARY_BOOK_VERSION, byDocument }
}

export function serializeConversationSummaryBook(book: ConversationSummaryBook): string {
  return JSON.stringify(book)
}

/** 这一轮该看哪份摘要：**只有本文档那一份**（别的文档回 `null`，不是"端上另一份"）。 */
export function summaryOfDocument(serialized: string, documentId: string): ConversationSummary | null {
  return parseConversationSummaryBook(serialized).byDocument[documentId] ?? null
}

/** 写回本文档那一份，**别的文档那几份原样保留**。 */
export function withDocumentSummary(serialized: string, documentId: string, summary: ConversationSummary): string {
  const book = parseConversationSummaryBook(serialized)
  return serializeConversationSummaryBook({ version: SUMMARY_BOOK_VERSION, byDocument: { ...book.byDocument, [documentId]: { ...summary, documentId } } })
}

/**
 * **一本书的上限**（Follow-up / 摘要 16K 边界）。
 *
 * 与仓储两侧的那条守卫**逐字一致**：`conversationRepository.MAX_SUMMARY_CHARS` 与
 * Rust 的 `MAX_SUMMARY_CHARS` 都是 16000。按文档分开之后，一本书可以有**很多份**摘要，
 * 合并后越界就不再是"不可能"：`saveSummary` 抛错，调用方的 `try/catch` 一咽，
 * 表现是**摘要从此再也不更新**。所以写入前先把它削到装得下。
 */
export const MAX_SUMMARY_BOOK_CHARS = 16_000

export interface FittedSummaryBook {
  /** 装得下的一本（内容都来自原来那一本：丢或削，**不编**）。 */
  book: ConversationSummaryBook
  /** 因为装不下而**整份丢掉**的文档（最旧的先丢）。 */
  dropped: string[]
  /** 被**削掉最旧条目**的文档（一份自己就超了上限时）。 */
  shrunk: string[]
}

function bookSize(book: ConversationSummaryBook): number {
  return serializeConversationSummaryBook(book).length
}

/**
 * 削一步：**最旧的条目先削**，最后才动 `goal`。
 *
 * 顺序是有理由的：偏好与未解决问题在别处没有副本（丢了就真丢了），
 * 而事实原文在事实表里、`goal` 在原始消息里都还有一份（规格 §5.3：压缩的是进上下文的那一段，
 * 不动历史）。削不动了（只剩一个很短的 `goal`、四个列表都空）回 `null`。
 */
function shrinkSummaryOnce(summary: ConversationSummary): ConversationSummary | null {
  if (summary.preferences.length > 0) return { ...summary, preferences: summary.preferences.slice(1) }
  if (summary.openQuestions.length > 0) return { ...summary, openQuestions: summary.openQuestions.slice(1) }
  if (summary.confirmedFacts.length > 0) return { ...summary, confirmedFacts: summary.confirmedFacts.slice(1) }
  if (summary.createdObjects.length > 0) return { ...summary, createdObjects: summary.createdObjects.slice(1) }
  if (summary.goal.length > 32) return { ...summary, goal: bounded(summary.goal, Math.max(32, Math.floor(summary.goal.length / 2))) }
  return null
}

/**
 * 把一本书削到 `limit` 字符之内。
 *
 * `keepDocumentId` 是**这次正在写的那一份**：先丢别的文档（最旧的先丢），它留到最后——
 * 正要记住的东西不该为了腾地方被丢掉。只剩它一份还是装不下时，才削它自己的条目；
 * 连条目都削不动了才整份丢掉（`dropped` 里如实记一笔，调用方把它报成诊断，
 * 而不是无声无息地什么都不写）。
 */
export function fitSummaryBook(book: ConversationSummaryBook, keepDocumentId?: string, limit: number = MAX_SUMMARY_BOOK_CHARS): FittedSummaryBook {
  const fitted: ConversationSummaryBook = { version: SUMMARY_BOOK_VERSION, byDocument: { ...book.byDocument } }
  const dropped: string[] = []
  const shrunk: string[] = []
  if (bookSize(fitted) <= limit) return { book: fitted, dropped, shrunk }

  const oldestFirst = Object.keys(fitted.byDocument).sort((left, right) => (fitted.byDocument[left].compactedAt ?? 0) - (fitted.byDocument[right].compactedAt ?? 0))

  for (const documentId of oldestFirst) {
    if (documentId === keepDocumentId) continue
    delete fitted.byDocument[documentId]
    dropped.push(documentId)
    if (bookSize(fitted) <= limit) return { book: fitted, dropped, shrunk }
  }

  for (const documentId of oldestFirst) {
    let summary = fitted.byDocument[documentId]
    if (!summary) continue
    while (bookSize(fitted) > limit) {
      const next = shrinkSummaryOnce(summary)
      if (next === null) {
        delete fitted.byDocument[documentId]
        dropped.push(documentId)
        break
      }
      summary = next
      fitted.byDocument[documentId] = { ...summary, documentId }
    }
    if (bookSize(fitted) <= limit) {
      if (fitted.byDocument[documentId]) shrunk.push(documentId)
      return { book: fitted, dropped, shrunk }
    }
  }

  return { book: fitted, dropped, shrunk }
}
