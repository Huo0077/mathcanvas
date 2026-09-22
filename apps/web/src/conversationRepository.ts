import {
  appendConversationMessage,
  archiveConversation,
  createConversation as createConversationCommand,
  deleteConversation as deleteConversationCommand,
  listConversations,
  readConversation,
  setConversationFallbackAdapter,
  updateConversationFact,
  updateConversationSummary,
  type ConversationDetail,
  type ConversationFallbackAdapter,
  type ConversationFactInput,
  type ConversationFactRecord,
  type ConversationMessageInput,
  type ConversationMessageRecord,
  type ConversationRecord,
  type ConversationWorkspace,
  type FactStatus,
  type NewConversationInput
} from "./services/conversationClient"
import { isDesktopShell } from "./services/desktopRuntime"

import type { ConversationFactView } from "@draw/agent-core"
import type { AgentConversation, AgentMessage } from "./agentStore"

/**
 * **会话仓储**（Task 3）。
 *
 * 计划把这一层叫 `ConversationRepository`：`loadList(binding)`、`append(message)`、
 * `saveSummary(...)`、`saveFact(...)`。它替界面回答一个问题 ——
 * **这条会话现在到底存没存下来** —— 而答案只能来自真源：
 *
 * - **桌面外壳在的时候**：八条具名 Tauri 命令（Task 2 的 `conversationClient`）打到 SQLite。
 *   这里**不碰** localStorage：两条路径同时活着必然互相覆盖（客户端那份文档点名的纪律）。
 * - **浏览器里**：`conversationClient` 留的兜底边界（`setConversationFallbackAdapter`）
 *   接的就是下面这份 localStorage 序列化器 —— 也就是加这一层之前就在用的那一份。
 *   同一个序列化器也直接给 store 用，因为 localStorage **是同步的**：
 *   界面可以在同一次点击里就把投影落地。这不是"乐观更新"，写已经成功了。
 *
 * ## 绑定是硬约束（设计 5.1）
 *
 * 每条会话属于一个 `projectId` / `documentId` / `workspace`，列表**按整个绑定取**。
 * 只按项目过滤会把另一份文档的历史漏进这一份 —— 那正是"会话之间串消息"最容易被忽略的形态。
 *
 * ## 删掉的就是删掉了
 *
 * 这一层**从不整份回写**投影：`append` 追加一条消息、`remove` 删一条、`create` 加一条。
 * 整份回写才是"删掉的会话从旧缓存里回来"的成因：内存里那份列表只要比仓储旧一次，
 * 就会把已经删掉的记录写回去。每次读也都**重新读存储**，没有第二份缓存。
 */

/** 会话记录的存储键。**与加这一层之前同一个键**：旧数据不算"没有了"，只是不再是真相。 */
export const AGENT_STORAGE_KEY = "mathcanvas:agent-conversations"

/**
 * 旧格式（没有绑定信息的那些记录）的旁路键。
 *
 * 绑定之前的记录**没有** `projectId`/`documentId`/`workspace`，而猜一个绑定就是
 * 跨文档串历史 —— 那是这个切片要防的事。所以它们不进新的列表，但**也不静默删除**：
 * 原样保存在这里（与 `draftStorage` 把读不出来的草稿留在旁路键上同一个口径）。
 */
export const LEGACY_AGENT_STORAGE_KEY = `${AGENT_STORAGE_KEY}:legacy`

export const NEW_CONVERSATION_TITLE = "新对话"

/**
 * 界面在**还没有人告诉它绑在哪份文档上**时用的绑定。
 *
 * `projectId: "local"` 与 `agentRunner` / `documentService` 同一个约定。
 * Task 4/5 会用真实的 `documentId`/`workspace` 覆盖它（`setBinding`）。
 */
export const DEFAULT_CONVERSATION_BINDING: ConversationBinding = { projectId: "local", documentId: "local", workspace: "conics" }

/** 一条会话绑定（设计 5.1）：它属于哪份文档、在哪个工作区。 */
export interface ConversationBinding {
  projectId: string
  documentId: string
  workspace: ConversationWorkspace
}

/**
 * 仓储的一次操作。
 *
 * **浏览器兜底同步落定，桌面 IPC 只能等。** 两种返回都能 `await`；
 * 同步那一支是"写已经成功了"，所以界面不必先画一条还没落盘的会话。
 */
export type RepositoryStep<T> = T | Promise<T>

/** 仓储明确拒绝（而不是"浏览器里没有桌面版"）。消息里带原因，便于排查。 */
export class ConversationRepositoryError extends Error {
  constructor(message: string, readonly code: string = "refused") {
    super(message)
    this.name = "ConversationRepositoryError"
  }
}

/** 界面用的那一面。方法名对应计划里点名的四个，外加生命周期必需的四个。 */
export interface ConversationRepository {
  /** 这个绑定下**还没归档**的会话（最近改动的在前）。不带消息 —— 消息按需读。 */
  loadList(binding: ConversationBinding): RepositoryStep<AgentConversation[]>
  /**
   * 读一条会话（含消息与事实）；仓储里没有它时回 `null`（**不是**编一条空的）。
   *
   * **会话 id 是唯一的键，读不再比绑定**（Fix round 1 / Minor 9 的取舍）：列表与创建都按
   * 整个绑定（§5.1 的硬约束在那里落地），而读是给"界面已经拿着一条会话"的路径用的 ——
   * 再传一个绑定进去只会在两者不一致时把"这条会话没了"和"你读错了绑定"混成同一句话。
   * 同样的形状 Rust 侧也是（`read_conversation` 只收 id）。要跨绑定读，得先拿到 id。
   */
  read(conversationId: string): RepositoryStep<AgentConversation | null>
  /**
   * 读一条会话的**完整记录**：界面投影 + 结构化摘要 + 事实 + 落盘的消息。
   *
   * 与 `read` 分开是因为读者不同：`read` 服务界面（它只需要能画出来的那部分），
   * 这一条服务**规划上下文**（Task 4 的注入路径）与摘要压缩（Task 5）——
   * 它们要的是"这条会话存下来的摘要与事实"，而那些字段不属于界面投影。
   * 与 `read` 一样：**id 是唯一的键**（见上）。
   */
  readRecord(conversationId: string): RepositoryStep<ConversationRecordView | null>
  /** 建一条会话。 */
  create(conversation: AgentConversation, binding: ConversationBinding): RepositoryStep<void>
  /**
   * 追加一条消息。
   *
   * 带上会话本身，是因为**一条刚开的会话可能还没落盘**（会话先于文档的第一次提交存在）：
   * 仓储会把还没有的那条会话补上，再追加消息。同一条消息 id 重放是空操作（幂等键）。
   *
   * `documentGeneration` 是**追加那一刻**文档的版本（Fix round 2 / item 5）：消息只写一次
   * （幂等键），所以这就是唯一诚实的值。不传 = 这一层不知道（用户提问那条路径没有文档句柄）。
   */
  append(conversation: AgentConversation, binding: ConversationBinding, message: AgentMessage, documentGeneration?: number): RepositoryStep<void>
  /** 写一份新的结构化摘要（版本号 +1；`expectedVersion` 是条件更新）。 */
  saveSummary(input: { conversationId: string; summary: string; expectedVersion?: number }): RepositoryStep<void>
  /** 写一条事实（按 `(conversationId, key)` upsert；证据必须是同会话里的真实消息）。 */
  saveFact(fact: ConversationFactInput): RepositoryStep<void>
  /** 归档（从列表里消失，记录与历史都还在）。 */
  archive(conversationId: string): RepositoryStep<void>
  /** 删除（连同消息与事实）。 */
  remove(conversationId: string): RepositoryStep<void>
}

// ---------------------------------------------------------------- localStorage 那一份（浏览器）

/**
 * 一条会话的完整记录（规划上下文与摘要压缩读的那一份）。
 *
 * `facts[].text` 是**存下来的人话**（写在 `valueJson.text` 里）：事实的"文本"属于写入方
 * （它知道那条事实是什么意思），读的一方只负责把它取出来 —— 在读的时候现编一句，
 * 同一条事实就会有两份说法。
 */
export interface ConversationRecordView {
  conversation: AgentConversation
  summary: string
  summaryVersion: number
  facts: ConversationFactView[]
}

type LocalMessageRecord = ConversationMessageRecord
type LocalFactRecord = ConversationFactRecord

/** 存下来的一条会话：会话记录 + 它的消息与事实。 */
interface LocalConversationRecord {
  id: string
  projectId: string
  documentId: string
  workspace: ConversationWorkspace
  title: string
  summary: string
  summaryVersion: number
  createdAt: number
  updatedAt: number
  archivedAt: number | null
  messages: LocalMessageRecord[]
  facts: LocalFactRecord[]
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage
  } catch {
    return null
  }
}

function text(candidate: unknown): string | null {
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null
}

function asNumber(candidate: unknown): number | null {
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null
}

function asWorkspace(candidate: unknown): ConversationWorkspace | null {
  return candidate === "conics" || candidate === "geometry3d" || candidate === "cad" ? candidate : null
}

function asFactStatus(candidate: unknown): FactStatus | null {
  return candidate === "confirmed" || candidate === "stale" || candidate === "retracted" ? candidate : null
}

function asMessageRecord(value: unknown, conversationId: string, fallbackSequence: number): LocalMessageRecord | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  const id = text(record.id)
  const role = text(record.role)
  if (id === null || role === null) return null
  const contentJson = "contentJson" in record ? record.contentJson : typeof record.text === "string" ? { text: record.text } : { text: "" }
  return {
    id,
    conversationId,
    sequence: asNumber(record.sequence) ?? fallbackSequence,
    role,
    kind: text(record.kind) ?? "message",
    contentJson,
    runId: text(record.runId),
    documentGeneration: asNumber(record.documentGeneration),
    tokenEstimate: asNumber(record.tokenEstimate) ?? 0,
    createdAt: asNumber(record.createdAt) ?? Date.now()
  }
}

function asFactRecord(value: unknown, conversationId: string): LocalFactRecord | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  const id = text(record.id)
  const key = text(record.key)
  const sourceMessageId = text(record.sourceMessageId)
  const status = asFactStatus(record.status)
  if (id === null || key === null || sourceMessageId === null || status === null) return null
  const createdAt = asNumber(record.createdAt) ?? Date.now()
  return { id, conversationId, key, valueJson: record.valueJson, sourceMessageId, status, createdAt, updatedAt: asNumber(record.updatedAt) ?? createdAt }
}

/**
 * 一条存下来的记录收窄成完整形状。
 *
 * 缺 `id` 或者缺绑定的，**不是**这条会话（后者是被 `retireLegacy` 收走的旧格式）。
 * 与客户端同一个纪律：形状不对的载荷不许伪装成一条会话。
 */
function asLocalRecord(value: unknown): LocalConversationRecord | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  const id = text(record.id)
  const projectId = text(record.projectId)
  const documentId = text(record.documentId)
  const workspace = asWorkspace(record.workspace)
  if (id === null || projectId === null || documentId === null || workspace === null) return null
  const createdAt = asNumber(record.createdAt) ?? Date.now()
  return {
    id,
    projectId,
    documentId,
    workspace,
    title: text(record.title) ?? NEW_CONVERSATION_TITLE,
    summary: typeof record.summary === "string" ? record.summary : "",
    summaryVersion: asNumber(record.summaryVersion) ?? 1,
    createdAt,
    updatedAt: asNumber(record.updatedAt) ?? createdAt,
    archivedAt: record.archivedAt === null || record.archivedAt === undefined ? null : asNumber(record.archivedAt),
    messages: Array.isArray(record.messages)
      ? record.messages.flatMap((entry, index) => asMessageRecord(entry, id, index + 1) ?? [])
      : [],
    facts: Array.isArray(record.facts) ? record.facts.flatMap((entry) => asFactRecord(entry, id) ?? []) : []
  }
}

/** 旧格式原样留到旁路键上，然后把主键收成只剩能认出来的记录。 */
function retireLegacy(retired: unknown[], records: LocalConversationRecord[]): void {
  const store = storage()
  if (!store) return
  try {
    const existing = store.getItem(LEGACY_AGENT_STORAGE_KEY)
    const previous = existing ? (JSON.parse(existing) as unknown) : []
    store.setItem(LEGACY_AGENT_STORAGE_KEY, JSON.stringify(Array.isArray(previous) ? [...previous, ...retired] : retired))
    store.setItem(AGENT_STORAGE_KEY, JSON.stringify(records))
  } catch {
    // 存不下就只当这次没迁移：这些记录仍然不会出现在新的列表里。
  }
}

/** **每次都真的读存储**：没有第二份缓存，也就没有"旧快照把删掉的会话带回来"这回事。 */
function readLocalRecords(): LocalConversationRecord[] {
  const store = storage()
  if (!store) return []
  const serialized = store.getItem(AGENT_STORAGE_KEY)
  if (!serialized) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch {
    // 内容坏了就当作没有历史（手改过的 localStorage 不能让整块界面白屏）。
    return []
  }
  if (!Array.isArray(parsed)) return []
  const records: LocalConversationRecord[] = []
  const retired: unknown[] = []
  for (const entry of parsed) {
    const record = asLocalRecord(entry)
    if (record) records.push(record)
    else retired.push(entry)
  }
  if (retired.length > 0) retireLegacy(retired, records)
  return records
}

/**
 * 写回。
 *
 * 配额溢出 / 隐私模式下存不进去 —— 这一次持久化放弃，**不让点击崩掉**
 *（与加这一层之前 `persist` 的口径一致：浏览器序列化器是"尽力而为"的预览/测试兜底，
 * 它拒绝的是语义上不成立的写入，而不是"这台机器存不下"）。
 */
function writeLocalRecords(records: LocalConversationRecord[]): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(AGENT_STORAGE_KEY, JSON.stringify(records))
  } catch {
    // 这一次持久化放弃，会话内状态仍然生效。
  }
}

function matchesBinding(record: LocalConversationRecord, binding: ConversationBinding): boolean {
  return record.projectId === binding.projectId && record.documentId === binding.documentId && record.workspace === binding.workspace
}

function findLocal(records: LocalConversationRecord[], conversationId: string): LocalConversationRecord | null {
  return records.find((record) => record.id === conversationId) ?? null
}

function emptyLocalRecord(conversation: AgentConversation, binding: ConversationBinding): LocalConversationRecord {
  return {
    id: conversation.id,
    projectId: binding.projectId,
    documentId: binding.documentId,
    workspace: binding.workspace,
    title: conversation.title,
    summary: "",
    summaryVersion: 1,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    archivedAt: null,
    messages: [],
    facts: []
  }
}

function listLocal(binding: ConversationBinding): LocalConversationRecord[] {
  return readLocalRecords()
    .filter((record) => record.archivedAt === null && matchesBinding(record, binding))
    // 确定性顺序：最近改动的在前，id 升序兜底（与 Rust 侧一致）。
    .sort((left, right) => right.updatedAt - left.updatedAt || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
}

function readLocal(conversationId: string): LocalConversationRecord | null {
  return findLocal(readLocalRecords(), conversationId)
}

function createLocal(conversation: AgentConversation, binding: ConversationBinding): void {
  const records = readLocalRecords()
  if (findLocal(records, conversation.id)) {
    // 覆盖会吞掉那条会话的历史：id 已经存在就如实报冲突。
    throw new ConversationRepositoryError(`conversation ${conversation.id} already exists`, "conflict")
  }
  writeLocalRecords([...records, emptyLocalRecord(conversation, binding)])
}

/**
 * 追加一条消息（必要时把还没落盘的会话补上）。
 *
 * 同一条消息 id 重放是**空操作**：它是幂等键，重试不该变成第二行。
 */
function appendLocalConversation(conversation: AgentConversation, binding: ConversationBinding, message: AgentMessage, documentGeneration?: number): void {
  // 与客户端兜底那条路径**同一套判据**（密钥前缀 + 上限）。
  guardLocalMessage(messageInputOf(conversation.id, message))
  const records = readLocalRecords()
  const index = records.findIndex((record) => record.id === conversation.id)
  const existing = index >= 0 ? records[index] : null
  const base = existing ?? emptyLocalRecord(conversation, binding)
  const messages = existing && existing.messages.some((record) => record.id === message.id)
    ? existing.messages
    : [...base.messages, messageRecordOf(base.id, message, base.messages, documentGeneration)]
  const next: LocalConversationRecord = {
    ...base,
    // 标题在浏览器序列化器里跟得上（桌面侧没有改标题的命令 —— 见报告的"已知缺口"）。
    title: conversation.title || base.title,
    updatedAt: Math.max(base.updatedAt, conversation.updatedAt || base.updatedAt),
    messages
  }
  writeLocalRecords(index >= 0 ? records.map((record, at) => (at === index ? next : record)) : [...records, next])
}

/**
 * **浏览器兜底也要守的那条边界**（Fix round 1 / I2）。
 *
 * Rust 侧在 `repository/conversations.rs` 里逐条判：内容里有 `sk-`/`sk_` 前缀的**拒绝**，
 * 消息内容 32K、摘要 16K、事实值 8K 各有一个上限。原先这条路径**一条都没有** ——
 * 于是一句密钥样的用户指令只在桌面被拒，在浏览器里照存不误；而"扫描载荷"的用例写的是
 * 良性内容，永远抓不到这件事。上限与判据在这里与本仓库的那一份**逐字对齐**。
 */
export const MAX_MESSAGE_CHARS = 32_000
export const MAX_SUMMARY_CHARS = 16_000
export const MAX_FACT_VALUE_CHARS = 8_000

/** 令牌段里的字符（与 Rust 的 `is_token_character` 同一组）：字母数字加 `.` `-` `_`。 */
const TOKEN_SEPARATOR = /[^A-Za-z0-9._-]+/

/**
 * 一段文本里有没有**明确的凭据前缀**（`sk-` / `sk_`）—— 只看**令牌段**的开头。
 *
 * 与 Rust 的 `contains_credential_prefix`（`run_events.rs`）逐字一致：先把文本切成令牌字符的
 * 连续段，再看某一段是否**以**前缀开头。**不能**写成"任意位置匹配 `sk[-_]`"：
 * 那会把 `task-1`、`risk-free`、`disk-space` 这类普通词当成密钥拒绝 ——
 * 同一个句子在浏览器里存不下、在桌面端却存得下，而两个后端本该给同一个答案
 *（Fix round 2 / N1）。
 */
export function containsCredentialPrefix(text: string): boolean {
  return text.split(TOKEN_SEPARATOR).some((run) => {
    const lowered = run.toLowerCase()
    return lowered.startsWith("sk-") || lowered.startsWith("sk_")
  })
}

function serialize(value: unknown): string {
  if (typeof value === "string") return value
  return JSON.stringify(value) ?? ""
}

/** 密钥样的内容**拒绝**（不是截掉）：截掉会让"用户以为存下来了"变成一次静默的数据丢失。 */
function refuseCredential(value: unknown, what: string): void {
  if (containsCredentialPrefix(serialize(value))) {
    throw new ConversationRepositoryError(`${what} looks like a credential; refusing to persist it`, "invalid")
  }
}

function refuseOversize(serialized: string, limit: number, what: string): void {
  if (serialized.length > limit) throw new ConversationRepositoryError(`${what} is ${serialized.length} characters, over the ${limit} limit`, "invalid")
}

/**
 * 一条消息的边界判据。**两条浏览器写入路径共用它**（仓储直写 `appendLocalConversation`
 * 与客户端兜底 `appendLocal`）—— 只在一处判的话，另一条路径照样能把密钥写进去。
 */
function guardLocalMessage(message: ConversationMessageInput): void {
  refuseCredential(message.contentJson, "message content")
  refuseOversize(serialize(message.contentJson), MAX_MESSAGE_CHARS, "message content")
}

function appendLocal(message: ConversationMessageInput): boolean {
  guardLocalMessage(message)
  const records = readLocalRecords()
  const index = records.findIndex((record) => record.id === message.conversationId)
  if (index < 0) throw new ConversationRepositoryError(`no conversation ${message.conversationId}`, "not_found")
  const record = records[index]
  if (record.messages.some((candidate) => candidate.id === message.id)) return false
  const next: LocalConversationRecord = {
    ...record,
    updatedAt: Math.max(record.updatedAt, message.createdAt),
    messages: [...record.messages, { ...message, runId: message.runId ?? null, documentGeneration: message.documentGeneration ?? null, conversationId: record.id, sequence: nextSequence(record.messages) }]
  }
  writeLocalRecords(records.map((candidate, at) => (at === index ? next : candidate)))
  return true
}

function nextSequence(messages: readonly LocalMessageRecord[]): number {
  return messages.reduce((highest, message) => Math.max(highest, message.sequence), 0) + 1
}

function updateSummaryLocal(input: { conversationId: string; summary: string; expectedVersion?: number }): LocalConversationRecord {
  refuseOversize(input.summary, MAX_SUMMARY_CHARS, "summary")
  const records = readLocalRecords()
  const index = records.findIndex((record) => record.id === input.conversationId)
  if (index < 0) throw new ConversationRepositoryError(`no conversation ${input.conversationId}`, "not_found")
  const record = records[index]
  if (input.expectedVersion !== undefined && input.expectedVersion !== record.summaryVersion) {
    throw new ConversationRepositoryError(`summary version ${record.summaryVersion} is not ${input.expectedVersion}`, "conflict")
  }
  const next: LocalConversationRecord = { ...record, summary: input.summary, summaryVersion: record.summaryVersion + 1, updatedAt: Date.now() }
  writeLocalRecords(records.map((candidate, at) => (at === index ? next : candidate)))
  return next
}

/**
 * 写一条事实。
 *
 * 两条判据与 Rust 侧逐字一致：**证据必须是一条真实存在的同会话消息**，状态只能是那三个值。
 * 键相同就是同一条事实（upsert），第一条的 id 与创建时间保留。
 */
function updateFactLocal(fact: ConversationFactInput): LocalFactRecord {
  refuseOversize(serialize(fact.valueJson), MAX_FACT_VALUE_CHARS, "fact value")
  const records = readLocalRecords()
  const index = records.findIndex((record) => record.id === fact.conversationId)
  if (index < 0) throw new ConversationRepositoryError(`no conversation ${fact.conversationId}`, "not_found")
  if (asFactStatus(fact.status) === null) throw new ConversationRepositoryError(`unknown fact status ${String(fact.status)}`, "invalid")
  const record = records[index]
  if (!record.messages.some((message) => message.id === fact.sourceMessageId)) {
    throw new ConversationRepositoryError(`no evidence message ${fact.sourceMessageId} in conversation ${fact.conversationId}`, "not_found")
  }
  const existing = record.facts.find((candidate) => candidate.key === fact.key) ?? null
  const written: LocalFactRecord = existing
    ? { ...existing, valueJson: fact.valueJson, sourceMessageId: fact.sourceMessageId, status: fact.status, updatedAt: Date.now() }
    : { id: fact.id, conversationId: record.id, key: fact.key, valueJson: fact.valueJson, sourceMessageId: fact.sourceMessageId, status: fact.status, createdAt: fact.createdAt, updatedAt: fact.createdAt }
  const facts = existing ? record.facts.map((candidate) => (candidate.key === fact.key ? written : candidate)) : [...record.facts, written]
  writeLocalRecords(records.map((candidate, at) => (at === index ? { ...record, facts } : candidate)))
  return written
}

function archiveLocal(conversationId: string): LocalConversationRecord {
  const records = readLocalRecords()
  const index = records.findIndex((record) => record.id === conversationId)
  if (index < 0) throw new ConversationRepositoryError(`no conversation ${conversationId}`, "not_found")
  const record = records[index]
  // 重复归档不是错误：第一次归档的时间才是它归档的时间。
  const next: LocalConversationRecord = record.archivedAt === null ? { ...record, archivedAt: Date.now() } : record
  if (next !== record) writeLocalRecords(records.map((candidate, at) => (at === index ? next : candidate)))
  return next
}

function removeLocal(conversationId: string): boolean {
  const records = readLocalRecords()
  const remaining = records.filter((record) => record.id !== conversationId)
  if (remaining.length === records.length) return false
  writeLocalRecords(remaining)
  return true
}

// ---------------------------------------------------------------- 记录 ↔ 界面

/**
 * 一条消息**要写进去的形状**（与客户端发给 Rust 的那份逐字一致）。
 *
 * `contentJson` 就是**消息本身**：界面看到什么，存的就是什么。
 *
 * 这是刻意的：`recordDraft` 之后"存下来的是这条消息（含草稿**视图**，不含候选文档）"
 * 是加这一层之前的既有行为，有一条用例守着它（草稿 id 在，`primitives` 不在）。
 * 换成"只存一句话"会让那条用例变成假话，也会让界面与存储各说各话。
 */
function messageInputOf(conversationId: string, message: AgentMessage, documentGeneration?: number): ConversationMessageInput {
  return {
    id: message.id,
    conversationId,
    role: message.role,
    kind: kindOf(message),
    contentJson: message,
    runId: message.runId,
    /**
     * **这条消息追加时文档是第几版**（Fix round 2 / item 5）。
     *
     * 追加是"第一次有内容时写一次"（消息 id 是幂等键），所以这里的就是**唯一诚实的值**：
     * 消息写下的那一刻文档的版本。界面（`sendPrompt`）那条路径没有文档句柄，
     * 所以用户提问那条消息仍然是 `NULL` —— 见报告的说明。
     */
    documentGeneration,
    tokenEstimate: Math.ceil(message.text.length / 4),
    createdAt: message.createdAt
  }
}

/** 存下来的那一行：多一个序号，可空字段显式记成 `null`（不是"没有这个键"）。 */
function messageRecordOf(conversationId: string, message: AgentMessage, existing: readonly LocalMessageRecord[], documentGeneration?: number): LocalMessageRecord {
  const input = messageInputOf(conversationId, message, documentGeneration)
  return { ...input, runId: input.runId ?? null, documentGeneration: input.documentGeneration ?? null, sequence: nextSequence(existing) }
}

function kindOf(message: AgentMessage): string {
  if (message.role === "user") return "prompt"
  if (message.commit) return "receipt"
  if (message.failure) return "failure"
  if (message.draft) return "draft"
  return "reply"
}

/**
 * 从存下来的记录变回一条消息。
 *
 * **刻意保守**：只还原说完的那部分（id/角色/原文/时间），在途字段（`pending`）与
 * 运行期视图（轨迹、草稿、诊断）不还原 —— 一个跨重启还亮着的"确认草稿"按钮指向的
 * 是一份早就不存在的草稿。
 */
function agentMessageOfLocal(record: LocalMessageRecord): AgentMessage {
  const content = record.contentJson
  const value = content && typeof content === "object" ? (content as Record<string, unknown>) : null
  const raw = value && typeof value.text === "string" ? value.text : typeof content === "string" ? content : ""
  return {
    id: record.id,
    role: record.role === "assistant" ? "assistant" : "user",
    text: raw,
    createdAt: record.createdAt
  }
}

/**
 * 会话能带进界面的**最多这么多条消息**（保留最新的）。
 *
 * 与 Rust 侧的读上限逐字一致（`conversations.rs` 的 `MAX_MESSAGES = 512`，它同样保留最新的
 * 一批）：两个后端对"同一条会话"给出不同的历史长度，会让"桌面版少了几条"看起来像数据丢了
 * （Fix round 1 / Minor 10）。
 */
export const MAX_CONVERSATION_MESSAGES = 512

function agentConversationOfLocal(record: LocalConversationRecord): AgentConversation {
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    // 保留**最新**的那一批（升序返回），与 Rust 侧同一个口径。
    messages: [...record.messages]
      .sort((left, right) => left.sequence - right.sequence)
      .slice(-MAX_CONVERSATION_MESSAGES)
      .map(agentMessageOfLocal)
  }
}

function recordOf(record: LocalConversationRecord): ConversationRecord {
  return {
    id: record.id,
    projectId: record.projectId,
    documentId: record.documentId,
    workspace: record.workspace,
    title: record.title,
    summary: record.summary,
    summaryVersion: record.summaryVersion,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    archivedAt: record.archivedAt
  }
}

/**
 * 一条事实的**人话**。
 *
 * 写入方把它放在 `valueJson.text` 里（它知道那条事实是什么意思）；读的一方只负责取出来，
 * 取不到就退化成 `key: <有界的 JSON>` —— 在读的时候现编一句，同一条事实就会有两份说法。
 */
function describeFactValue(valueJson: unknown): string {
  if (valueJson && typeof valueJson === "object" && typeof (valueJson as { text?: unknown }).text === "string") {
    return (valueJson as { text: string }).text.slice(0, 2_048)
  }
  const serialized = JSON.stringify(valueJson)
  return serialized === undefined ? "" : serialized.slice(0, 512)
}

function factViewOf(record: LocalFactRecord): ConversationFactView {
  return { id: record.id, key: record.key, text: describeFactValue(record.valueJson), status: record.status, ...documentIdOf(record.valueJson) }
}

/**
 * 一条事实**属于哪份文档**写在 `value_json` 里（Rust 侧的事实列是固定 schema）：
 * 读回来必须能看见它 —— 注入上下文时按它筛（规格 §5.1，Fix round 1 / C1）。
 */
function documentIdOf(valueJson: unknown): { documentId?: string } {
  if (valueJson && typeof valueJson === "object") {
    const documentId = (valueJson as { documentId?: unknown }).documentId
    if (typeof documentId === "string" && documentId.length > 0) return { documentId }
  }
  return {}
}

function recordViewOf(record: LocalConversationRecord): ConversationRecordView {
  return { conversation: agentConversationOfLocal(record), summary: record.summary, summaryVersion: record.summaryVersion, facts: record.facts.map(factViewOf) }
}

function detailOf(record: LocalConversationRecord): ConversationDetail {
  return { conversation: recordOf(record), messages: record.messages, facts: record.facts }
}

/**
 * **浏览器兜底适配器**：客户端在浏览器里调那八条命令时落到这里。
 *
 * 与 `localConversationFallback()` 是同一份存储、同一套判据 —— 只是外面套了一层
 * `ConversationResult`（那是客户端的事）。
 */
export function createLocalConversationFallback(): ConversationFallbackAdapter {
  return {
    create: async (conversation: NewConversationInput) => {
      const binding: ConversationBinding = { projectId: conversation.projectId, documentId: conversation.documentId, workspace: conversation.workspace }
      const records = readLocalRecords()
      if (findLocal(records, conversation.id)) throw new ConversationRepositoryError(`conversation ${conversation.id} already exists`, "conflict")
      writeLocalRecords([...records, emptyLocalRecord({ id: conversation.id, title: conversation.title, createdAt: Date.now(), updatedAt: Date.now(), messages: [] }, binding)])
      return recordOf(readLocal(conversation.id)!)
    },
    list: async (query) => listLocal(query).map(recordOf),
    read: async (conversationId) => {
      const record = readLocal(conversationId)
      if (!record) throw new ConversationRepositoryError(`no conversation ${conversationId}`, "not_found")
      return detailOf(record)
    },
    append: async (message) => appendLocal(message),
    updateSummary: async (input) => recordOf(updateSummaryLocal(input)),
    updateFact: async (fact) => updateFactLocal(fact),
    archive: async (conversationId) => recordOf(archiveLocal(conversationId)),
    remove: async (conversationId) => removeLocal(conversationId)
  }
}

/** 把 localStorage 那一份装到客户端留的边界上（幂等）。 */
export function installLocalConversationFallback(): void {
  setConversationFallbackAdapter(createLocalConversationFallback())
}

// ---------------------------------------------------------------- SQLite 那一份（桌面外壳）

function refused(result: { ok: false; code: string; detail: string }): never {
  throw new ConversationRepositoryError(result.detail, result.code)
}

/** Rust 侧找不到一条会话时就是这么说的（`repository/conversations.rs`）。 */
const MISSING_CONVERSATION = /no conversation /i

function agentConversationOfRecord(record: ConversationRecord): AgentConversation {
  return { id: record.id, title: record.title, createdAt: record.createdAt, updatedAt: record.updatedAt, messages: [] }
}

async function desktopLoadList(binding: ConversationBinding): Promise<AgentConversation[]> {
  const result = await listConversations(binding)
  if (!result.ok) refused(result)
  return result.value.map(agentConversationOfRecord)
}

async function desktopRead(conversationId: string): Promise<AgentConversation | null> {
  const result = await readConversation(conversationId)
  if (!result.ok) {
    // "这条会话没了"与"IPC 坏了"是两件事：前者回 null（界面据此不把它变回当前会话），
    // 后者要如实报出来 —— 混成一句"加载失败"会让排查方向完全跑偏。
    if (MISSING_CONVERSATION.test(result.detail)) return null
    refused(result)
  }
  return { ...agentConversationOfRecord(result.value.conversation), messages: result.value.messages.map((message) => agentMessageOfLocal(message)) }
}

async function desktopReadRecord(conversationId: string): Promise<ConversationRecordView | null> {
  const result = await readConversation(conversationId)
  if (!result.ok) {
    if (MISSING_CONVERSATION.test(result.detail)) return null
    refused(result)
  }
  const record = result.value
  return {
    conversation: { ...agentConversationOfRecord(record.conversation), messages: record.messages.map((message) => agentMessageOfLocal(message)) },
    summary: record.conversation.summary,
    summaryVersion: record.conversation.summaryVersion,
    facts: record.facts.map(factViewOf)
  }
}

async function desktopCreate(conversation: AgentConversation, binding: ConversationBinding): Promise<void> {
  const result = await createConversationCommand({ id: conversation.id, projectId: binding.projectId, documentId: binding.documentId, workspace: binding.workspace, title: conversation.title })
  if (!result.ok) refused(result)
}

/**
 * 一条**还没落盘**的会话（会话先于文档的第一次提交存在）要先建出来，才谈得上追加消息。
 * 已经在了就当成功；真的坏了才报错。
 */
async function ensureDesktopConversation(conversation: AgentConversation, binding: ConversationBinding): Promise<void> {
  const existing = await readConversation(conversation.id)
  if (existing.ok) return
  if (!MISSING_CONVERSATION.test(existing.detail)) refused(existing)
  const created = await createConversationCommand({ id: conversation.id, projectId: binding.projectId, documentId: binding.documentId, workspace: binding.workspace, title: conversation.title })
  if (created.ok) return
  // 并发下别人刚建好同一条：再读一次，读得到就算成功。
  const retry = await readConversation(conversation.id)
  if (!retry.ok) refused(created)
}

async function desktopAppend(conversation: AgentConversation, binding: ConversationBinding, message: AgentMessage, documentGeneration?: number): Promise<void> {
  await ensureDesktopConversation(conversation, binding)
  const result = await appendConversationMessage(messageInputOf(conversation.id, message, documentGeneration))
  if (!result.ok) refused(result)
}

async function desktopSaveSummary(input: { conversationId: string; summary: string; expectedVersion?: number }): Promise<void> {
  const result = await updateConversationSummary(input)
  if (!result.ok) refused(result)
}

async function desktopSaveFact(fact: ConversationFactInput): Promise<void> {
  const result = await updateConversationFact(fact)
  if (!result.ok) refused(result)
}

async function desktopArchive(conversationId: string): Promise<void> {
  const result = await archiveConversation(conversationId)
  if (!result.ok) refused(result)
}

async function desktopRemove(conversationId: string): Promise<void> {
  const result = await deleteConversationCommand(conversationId)
  if (!result.ok) refused(result)
}

// ---------------------------------------------------------------- 装配

/**
 * 造一个仓储。**每次调用都按当前运行环境选路**（有桌面外壳就是 SQLite，没有就是
 * localStorage 那一份），所以测试里换掉 `__TAURI_INTERNALS__` 也换得动。
 */
export function createConversationRepository(): ConversationRepository {
  installLocalConversationFallback()
  return {
    loadList: (binding) => (isDesktopShell() ? desktopLoadList(binding) : listLocal(binding).map(agentConversationOfLocal)),
    read: (conversationId) => {
      if (isDesktopShell()) return desktopRead(conversationId)
      const record = readLocal(conversationId)
      return record ? agentConversationOfLocal(record) : null
    },
    readRecord: (conversationId) => {
      if (isDesktopShell()) return desktopReadRecord(conversationId)
      const record = readLocal(conversationId)
      return record ? recordViewOf(record) : null
    },
    create: (conversation, binding) => (isDesktopShell() ? desktopCreate(conversation, binding) : createLocal(conversation, binding)),
    append: (conversation, binding, message, documentGeneration) => (isDesktopShell() ? desktopAppend(conversation, binding, message, documentGeneration) : appendLocalConversation(conversation, binding, message, documentGeneration)),
    saveSummary: (input) => (isDesktopShell() ? desktopSaveSummary(input) : void updateSummaryLocal(input)),
    saveFact: (fact) => (isDesktopShell() ? desktopSaveFact(fact) : void updateFactLocal(fact)),
    archive: (conversationId) => (isDesktopShell() ? desktopArchive(conversationId) : void archiveLocal(conversationId)),
    remove: (conversationId) => (isDesktopShell() ? desktopRemove(conversationId) : void removeLocal(conversationId))
  }
}

let active = createConversationRepository()

/** 现在的仓储。 */
export function conversationRepository(): ConversationRepository {
  return active
}

/** 换一个仓储（测试注入用；传 `null` 恢复默认按环境选路的那个）。 */
export function setConversationRepository(repository: ConversationRepository | null): void {
  active = repository ?? createConversationRepository()
}
