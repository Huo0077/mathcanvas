import { invokeDesktop, isDesktopShell, NoDesktopShellError } from "./desktopRuntime"

/**
 * **多会话客户端**（Task 2 的前端那一半）。
 *
 * Rust 侧的八条命令（`create_conversation` / `list_conversations` / `read_conversation` /
 * `append_conversation_message` / `update_conversation_summary` / `update_conversation_fact` /
 * `archive_conversation` / `delete_conversation`）与它们的判据都已经在了，缺的是
 * "界面能不能用它们"。这一层是那座桥。
 *
 * ## 四条纪律
 *
 * 1. **这一层只搬运**。字段名逐字对应 Rust 侧的结构体（那些结构体带
 *    `deny_unknown_fields`：多一个字段是一次**拒绝**，不是静默削掉）。所以这里
 *    **不组装**任何 Rust 侧没有的字段 —— 尤其是推理、候选文档与图像字节，
 *    它们连位置都没有。
 * 2. **"在浏览器里"与"IPC 失败"分开报**。前者是**正常状态**（同一个 web 产物既要能当
 *    网页打开、也要能在 Tauri 里跑），后者才要给原因。混成一句"会话加载失败"会让
 *    没有桌面版这件事看起来像故障。
 * 3. **本地兜底是一个显式的边界**（`ConversationFallbackAdapter`）。浏览器里没有 SQLite，
 *    但界面仍然要能用 —— Task 3 会把 `localStorage` 那一份接在这里。桌面外壳在的时候
 *    它**一次都不许被碰**：两条路径同时活着必然互相覆盖。
 * 4. **形状不对的载荷不许伪装成一条会话**。编一个空会话比报错危险得多：
 *    界面会显示"这条会话是空的"，而用户以为他的历史丢了。
 */

/** Agent 工作区。与 Rust 侧的 `Workspace` 和 `@draw/agent-core` 的 `WorkspaceId` 同一组值。 */
export type ConversationWorkspace = "conics" | "geometry3d" | "cad"

/** 事实的三态（设计 5.2）。**没有第四种**：非法值在 Rust 侧的反序列化就被拒。 */
export type FactStatus = "confirmed" | "stale" | "retracted"

export type ConversationFailureCode = "no_desktop_shell" | "ipc_failed"

export type ConversationResult<T> =
  | { ok: true; value: T }
  /** 预期状态：这是浏览器，没有项目库。 */
  | { ok: false; code: "no_desktop_shell"; detail: string }
  /** 真的出错了，要有人知道。 */
  | { ok: false; code: "ipc_failed"; detail: string }

export interface NewConversationInput {
  id: string
  projectId: string
  documentId: string
  workspace: ConversationWorkspace
  title: string
}

/**
 * **一条会话绑定的三件事**（设计 5.1）。
 *
 * 列表**永远按整个绑定取**，而不是只按项目：只按项目过滤会把另一份文档的历史
 * 漏进这一份，而那正是"会话之间串消息"最容易被忽略的一种形态。
 */
export interface ConversationListQuery {
  projectId: string
  documentId: string
  workspace: ConversationWorkspace
}

export interface ConversationRecord {
  id: string
  projectId: string
  documentId: string
  workspace: ConversationWorkspace
  title: string
  /** 结构化摘要（目标 / 确认事实 / 已创建对象 / 未解决问题 / 用户偏好），不是聊天记录本身。 */
  summary: string
  summaryVersion: number
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}

export interface ConversationMessageInput {
  /** 消息自己的 id，也是**幂等键**：同一个 id 重放是空操作（命令回 `false`）。 */
  id: string
  conversationId: string
  role: string
  kind: string
  contentJson: unknown
  runId?: string
  documentGeneration?: number
  tokenEstimate: number
  createdAt: number
}

export interface ConversationMessageRecord {
  id: string
  conversationId: string
  /** 这条会话里的第几条（从 1 开始，由 Rust 侧分配）。 */
  sequence: number
  role: string
  kind: string
  contentJson: unknown
  runId: string | null
  documentGeneration: number | null
  tokenEstimate: number
  createdAt: number
}

export interface ConversationFactInput {
  id: string
  conversationId: string
  /** 事实的键：键相同就是**同一条事实**（Rust 侧 `UNIQUE(conversation_id, key)`）。 */
  key: string
  valueJson: unknown
  /** 证据：这条会话里的一条真实消息。跨会话的引用会被拒。 */
  sourceMessageId: string
  status: FactStatus
  createdAt: number
}

export interface ConversationFactRecord {
  id: string
  conversationId: string
  key: string
  valueJson: unknown
  sourceMessageId: string
  status: FactStatus
  createdAt: number
  updatedAt: number
}

/** 一条会话的全部内容（记录 + 有界的一批消息与事实）。 */
export interface ConversationDetail {
  conversation: ConversationRecord
  messages: ConversationMessageRecord[]
  facts: ConversationFactRecord[]
}

/**
 * **浏览器里的本地兜底**。
 *
 * 每个方法对应一条命令的语义，返回**解包后**的值（不是 `ConversationResult`）：
 * 包一层结果类型是这一层的事，兜底实现只管把事做完。Task 3 的
 * `conversationRepository` 会把 `localStorage` 那一份接在这里。
 */
export interface ConversationFallbackAdapter {
  create(conversation: NewConversationInput): Promise<ConversationRecord>
  list(query: ConversationListQuery): Promise<ConversationRecord[]>
  read(conversationId: string): Promise<ConversationDetail>
  append(message: ConversationMessageInput): Promise<boolean>
  updateSummary(input: { conversationId: string; summary: string; expectedVersion?: number }): Promise<ConversationRecord>
  updateFact(fact: ConversationFactInput): Promise<ConversationFactRecord>
  archive(conversationId: string): Promise<ConversationRecord>
  remove(conversationId: string): Promise<boolean>
}

let fallbackAdapter: ConversationFallbackAdapter | null = null

/** 装上（或卸下）本地兜底适配器。传 `null` 表示"浏览器里就是没有会话持久化"。 */
export function setConversationFallbackAdapter(adapter: ConversationFallbackAdapter | null): void {
  fallbackAdapter = adapter
}

/** 现在装着哪一个兜底适配器（供界面说明"这些会话存在浏览器里"）。 */
export function conversationFallbackAdapter(): ConversationFallbackAdapter | null {
  return fallbackAdapter
}

function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function asFailure(error: unknown): { ok: false; code: ConversationFailureCode; detail: string } {
  if (error instanceof NoDesktopShellError) return { ok: false, code: "no_desktop_shell", detail: error.message }
  return { ok: false, code: "ipc_failed", detail: detailOf(error) }
}

/**
 * 一次调用的**两条路径**：桌面外壳走 IPC，浏览器走兜底适配器，两者都没有时
 * 如实回 `no_desktop_shell`（那是正常状态，不是错误）。
 */
async function call<T>(
  command: string,
  args: Record<string, unknown>,
  viaFallback: (adapter: ConversationFallbackAdapter) => Promise<T>,
  normalize: (raw: unknown) => T
): Promise<ConversationResult<T>> {
  if (!isDesktopShell()) {
    if (!fallbackAdapter) return asFailure(new NoDesktopShellError(command))
    try {
      return { ok: true, value: await viaFallback(fallbackAdapter) }
    } catch (error) {
      // 兜底自己失败时**不是**"没有桌面外壳"：那是一次真的错误，要带原因。
      return { ok: false, code: "ipc_failed", detail: detailOf(error) }
    }
  }
  try {
    return { ok: true, value: normalize(await invokeDesktop<unknown>(command, args)) }
  } catch (error) {
    return asFailure(error)
  }
}

// ---------------------------------------------------------------- 形状收窄
//
// IPC 回来的是 `unknown`。这些函数只认**完整**的那份形状，缺字段就返回 `null`
// （而不是填默认值）：一条缺了 id 的"会话"不是会话。

function asText(candidate: unknown): string | null {
  return typeof candidate === "string" ? candidate : null
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

function asConversationRecord(raw: unknown): ConversationRecord | null {
  if (!raw || typeof raw !== "object") return null
  const value = raw as Record<string, unknown>
  const id = asText(value.id)
  const projectId = asText(value.projectId)
  const documentId = asText(value.documentId)
  const workspace = asWorkspace(value.workspace)
  const title = asText(value.title)
  const summary = typeof value.summary === "string" ? value.summary : null
  const summaryVersion = asNumber(value.summaryVersion)
  const createdAt = asNumber(value.createdAt)
  const updatedAt = asNumber(value.updatedAt)
  if (id === null || projectId === null || documentId === null || workspace === null) return null
  if (title === null || summary === null || summaryVersion === null || createdAt === null || updatedAt === null) return null
  const archivedAt = value.archivedAt === null || value.archivedAt === undefined ? null : asNumber(value.archivedAt)
  return { id, projectId, documentId, workspace, title, summary, summaryVersion, createdAt, updatedAt, archivedAt }
}

function asMessageRecord(raw: unknown): ConversationMessageRecord | null {
  if (!raw || typeof raw !== "object") return null
  const value = raw as Record<string, unknown>
  const id = asText(value.id)
  const conversationId = asText(value.conversationId)
  const sequence = asNumber(value.sequence)
  const role = asText(value.role)
  const kind = asText(value.kind)
  const tokenEstimate = asNumber(value.tokenEstimate)
  const createdAt = asNumber(value.createdAt)
  if (id === null || conversationId === null || sequence === null || role === null || kind === null) return null
  if (tokenEstimate === null || createdAt === null) return null
  return {
    id,
    conversationId,
    sequence,
    role,
    kind,
    contentJson: value.contentJson,
    runId: asText(value.runId),
    documentGeneration: value.documentGeneration === null || value.documentGeneration === undefined ? null : asNumber(value.documentGeneration),
    tokenEstimate,
    createdAt
  }
}

function asFactRecord(raw: unknown): ConversationFactRecord | null {
  if (!raw || typeof raw !== "object") return null
  const value = raw as Record<string, unknown>
  const id = asText(value.id)
  const conversationId = asText(value.conversationId)
  const key = asText(value.key)
  const sourceMessageId = asText(value.sourceMessageId)
  const status = asFactStatus(value.status)
  const createdAt = asNumber(value.createdAt)
  const updatedAt = asNumber(value.updatedAt)
  if (id === null || conversationId === null || key === null || sourceMessageId === null) return null
  if (status === null || createdAt === null || updatedAt === null) return null
  return { id, conversationId, key, valueJson: value.valueJson, sourceMessageId, status, createdAt, updatedAt }
}

// ---------------------------------------------------------------- 八条方法

/** **建一条会话**。id 已经存在时 Rust 侧如实报冲突（覆盖会吞掉那条会话的历史）。 */
export async function createConversation(conversation: NewConversationInput): Promise<ConversationResult<ConversationRecord>> {
  return call(
    "create_conversation",
    { conversation },
    (adapter) => adapter.create(conversation),
    (raw) => {
      const record = asConversationRecord(raw)
      // 建会话拿不回一条**能认出来的**会话，就是一次失败：回一条编出来的记录会让界面
      // 拿着一个假 id 继续走，而后面每一步都会失败在别的地方。
      if (!record) throw new Error("create_conversation did not return a conversation record")
      return record
    }
  )
}

/** **列出这个绑定下还没归档的会话**（最近改动的在前，Rust 侧有上限）。 */
export async function listConversations(query: ConversationListQuery): Promise<ConversationResult<ConversationRecord[]>> {
  return call(
    "list_conversations",
    { binding: query },
    (adapter) => adapter.list(query),
    (raw) => (Array.isArray(raw) ? raw.flatMap((entry) => asConversationRecord(entry) ?? []) : [])
  )
}

/** **读一条会话的全部内容**（记录 + 有界的一批消息与事实）。 */
export async function readConversation(conversationId: string): Promise<ConversationResult<ConversationDetail>> {
  return call(
    "read_conversation",
    { conversationId },
    (adapter) => adapter.read(conversationId),
    (raw) => {
      const value = (raw ?? {}) as Record<string, unknown>
      const conversation = asConversationRecord(value.conversation)
      // 读不出那条会话就是失败 —— 编一个空会话会让"我这条对话的历史呢"变成一个
      // 只能靠猜的问题。
      if (!conversation) throw new Error("read_conversation did not return a conversation")
      return {
        conversation,
        messages: Array.isArray(value.messages) ? value.messages.flatMap((entry) => asMessageRecord(entry) ?? []) : [],
        facts: Array.isArray(value.facts) ? value.facts.flatMap((entry) => asFactRecord(entry) ?? []) : []
      }
    }
  )
}

/** **追加一条消息**。同一个 id 第二次回 `false`（幂等，**不是错误**）。 */
export async function appendConversationMessage(message: ConversationMessageInput): Promise<ConversationResult<boolean>> {
  return call(
    "append_conversation_message",
    { message },
    (adapter) => adapter.append(message),
    (raw) => raw === true
  )
}

/**
 * **写一份新的摘要**（Rust 侧把版本号 +1）。
 *
 * `expectedVersion` 是条件更新，而它**要么带上、要么不带**：显式发一个 `undefined`
 * 会在 JSON 里消失，发一个 `null` 则不是 `Option<i64>` 认的形状。所以这里按
 * "有没有"组装参数，而不是让序列化去猜。
 */
export async function updateConversationSummary(input: { conversationId: string; summary: string; expectedVersion?: number }): Promise<ConversationResult<ConversationRecord>> {
  const args = input.expectedVersion === undefined
    ? { conversationId: input.conversationId, summary: input.summary }
    : { conversationId: input.conversationId, summary: input.summary, expectedVersion: input.expectedVersion }
  return call(
    "update_conversation_summary",
    args,
    (adapter) => adapter.updateSummary(input),
    (raw) => {
      const record = asConversationRecord(raw)
      if (!record) throw new Error("update_conversation_summary did not return a conversation record")
      return record
    }
  )
}

/** **写一条事实**（按 `(conversationId, key)` upsert，必须带同会话的证据）。 */
export async function updateConversationFact(fact: ConversationFactInput): Promise<ConversationResult<ConversationFactRecord>> {
  return call(
    "update_conversation_fact",
    { fact },
    (adapter) => adapter.updateFact(fact),
    (raw) => {
      const record = asFactRecord(raw)
      if (!record) throw new Error("update_conversation_fact did not return a fact record")
      return record
    }
  )
}

/** **归档一条会话**（从列表里消失，记录与历史都还在；重复归档不是错误）。 */
export async function archiveConversation(conversationId: string): Promise<ConversationResult<ConversationRecord>> {
  return call(
    "archive_conversation",
    { conversationId },
    (adapter) => adapter.archive(conversationId),
    (raw) => {
      const record = asConversationRecord(raw)
      if (!record) throw new Error("archive_conversation did not return a conversation record")
      return record
    }
  )
}

/** **删掉一条会话**（连同它的消息与事实）。重复删回 `false`，不是错误。 */
export async function deleteConversation(conversationId: string): Promise<ConversationResult<boolean>> {
  return call(
    "delete_conversation",
    { conversationId },
    (adapter) => adapter.remove(conversationId),
    (raw) => raw === true
  )
}
