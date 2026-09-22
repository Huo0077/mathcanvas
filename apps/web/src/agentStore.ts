import { create } from "zustand"

import type { DraftObjectCounts } from "@draw/agent-core"

import { deriveConversationTitle } from "./agentTranscript"
import {
  DEFAULT_CONVERSATION_BINDING,
  NEW_CONVERSATION_TITLE,
  conversationRepository,
  type ConversationBinding,
  type RepositoryStep
} from "./conversationRepository"

/**
 * Agent 区的对话状态。
 *
 * 单独一个 store（而不是塞进 `store.ts`）：排版上看，这里存的是"聊天记录 + 草稿视图"，
 * 与 `useSceneStore` 里的几何文档是**互不相干**的两层状态；分开之后，Agent 区的重渲染
 * 不会牵动画布的订阅者，反之亦然。
 *
 * ## Task 3 之后：这里是**投影**，不是真相
 *
 * 真相在仓储里（桌面端 SQLite，浏览器里是 localStorage 序列化器，见
 * `conversationRepository.ts`）。每一条写都**先过仓储**，成功了才动这份内存状态：
 * 仓储拒绝时界面一动不动 —— 显示一件没写进去的事，比慢一拍糟得多。
 *
 * 时序没有变：浏览器兜底是同步的，所以 `sendPrompt` / `createConversation` 这些
 * 在浏览器里仍然**当场**更新投影（写已经成功了，这不是乐观更新）。桌面 IPC 只能等，
 * 那一条路径上投影晚一拍。
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
  /**
   * 阶段来自哪里（`from`）与耗时。**可选**：它们是给"开发者详细视图"用的，
   * 而不是给用户读的第一信息 —— 所以缺了也不影响主视图。
   */
  from?: string
  durationMs?: number
  /** 这一步用到的工具名（有工具调用时才有）。 */
  toolId?: string
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
  /**
   * **开发者详细视图**用的账本导出（Task 2.6 Step 4）。
   *
   * 计划原文把遥测分成两层："Render a user-facing trace with short summaries;
   * keep detailed diagnostics behind an **opt-in** developer view."
   * 所以这里存的是与 `trace` **不同的东西**：`trace` 是"给用户的一句话"，
   * 这里是"排障要看的原始行"。两层都在消息上，但界面**默认只显示前者**。
   *
   * 同样的纪律：里面**只有文本**，不许出现候选文档、密钥、模型推理或图像字节
   * （入口在 `agentRunner`，它只从账本取 `phase` / `from` / `detail` / 时间）。
   */
  diagnostics?: string[]
}

export interface AgentConversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: AgentMessage[]
}

/** 存储键仍在 `agentStore` 上导出（既有的引用点不动）：定义在仓储那一层。 */
export { AGENT_STORAGE_KEY, NEW_CONVERSATION_TITLE } from "./conversationRepository"

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

function isThenable<T>(value: RepositoryStep<T>): value is Promise<T> {
  return typeof (value as { then?: unknown } | null | undefined)?.then === "function"
}

/**
 * **仓储成功之后才动投影。**
 *
 * 三条纪律：
 * ① 仓储**当场拒绝**（浏览器兜底会抛）或**异步拒绝**（SQLite 说不）时，投影一动不动；
 * ② 浏览器兜底是同步落定的，所以同步那一支**当场**投影 —— 写已经成功了，
 *    这不是"先画出来再说"；
 * ③ 延迟事件（IPC 回来时用户已经切走了）也要落到它该落的地方：`apply` 里一律
 *    基于**当时**的状态重算，而不是闭包里那份快照。
 */
function commitAfter<T>(operation: () => RepositoryStep<T>, apply: (value: T) => void, onRefusal?: () => void): Promise<boolean> {
  let step: RepositoryStep<T>
  try {
    step = operation()
  } catch {
    onRefusal?.()
    return Promise.resolve(false)
  }
  if (isThenable(step)) {
    return step.then(
      (value) => { apply(value); return true },
      () => { onRefusal?.(); return false }
    )
  }
  apply(step)
  return Promise.resolve(true)
}

interface PendingTarget {
  conversation: AgentConversation
  message: AgentMessage
}

/** 在途助手消息所在的那条会话与它本身。没有在途消息时回 `null`。 */
function pendingTarget(get: () => AgentState): PendingTarget | null {
  const pendingId = get().pendingReplyId
  if (!pendingId) return null
  for (const conversation of get().conversations) {
    const message = conversation.messages.find((candidate) => candidate.id === pendingId)
    if (message) return { conversation, message }
  }
  return null
}

/**
 * 对**在途助手消息**做一次不可变更新（**不写仓储**）。
 *
 * 没有在途消息时**什么都不做**：迟到的运行事件不该凭空造出一条消息
 *（那正是"停了之后界面又冒出一段"这类 bug 的来源）。
 *
 * 轨迹与开发者诊断走这一条：它们是**运行期**状态，不是"这条消息说了什么"。
 * 说过的内容由 `commitPending` 写进仓储；运行期状态不进长期记忆。
 */
function updatePending(
  get: () => AgentState,
  set: (partial: Partial<AgentState>) => void,
  update: (message: AgentMessage) => AgentMessage
): void {
  const target = pendingTarget(get)
  if (!target) return
  const conversations = get().conversations.map((conversation) => conversation.id === target.conversation.id
    ? { ...conversation, updatedAt: Date.now(), messages: conversation.messages.map((message) => (message.id === target.message.id ? update(message) : message)) }
    : conversation)
  set({ conversations, activeConversation: resolveActive(conversations, get().activeConversationId) })
}

/**
 * 一条**内容型**消息改动：先把这条消息写进仓储，成功了才动投影。
 *
 * 消息 id 是幂等键，所以同一条消息的第二次写是空操作 —— **先到的那一次**
 *（草稿落定 / 文字回复 / 提交回执 / 失败）就是存下来的那份。
 */
function commitPending(
  get: () => AgentState,
  set: (partial: Partial<AgentState>) => void,
  update: (message: AgentMessage) => AgentMessage,
  options: { finish?: boolean; onRefusal?: () => void } = {}
): Promise<boolean> {
  const target = pendingTarget(get)
  if (!target) return Promise.resolve(false)
  const message = update(target.message)
  const owner: AgentConversation = {
    ...target.conversation,
    updatedAt: Date.now(),
    messages: target.conversation.messages.map((candidate) => (candidate.id === message.id ? message : candidate))
  }
  return commitAfter(
    () => conversationRepository().append(owner, get().binding, message),
    () => {
      const conversations = get().conversations.map((conversation) => (conversation.id === owner.id ? owner : conversation))
      const projected = { conversations, activeConversation: resolveActive(conversations, get().activeConversationId) }
      set(options.finish ? { ...projected, pendingReplyId: null } : projected)
    },
    options.onRefusal
  )
}

/** 逐条删（删过的再删不是错误）。混着同步与异步两支时，等最慢的那一支。 */
function removeAll(conversationIds: readonly string[]): RepositoryStep<void> {
  const steps = conversationIds.map((id) => conversationRepository().remove(id))
  return steps.some((step) => isThenable(step)) ? Promise.all(steps).then(() => undefined) : undefined
}

/**
 * 第一帧的投影。
 *
 * 浏览器里仓储那一份（localStorage）**同步**就能读出来，所以首屏不必等任何东西。
 * 桌面外壳里读要过 IPC，这一刻先给一条空会话，等 `setBinding` 把真实列表换上来 ——
 * **不拿本地缓存顶替**：那份缓存属于别的绑定，甚至可能还含着已经被删掉的会话。
 */
function initialProjection(): AgentConversation[] {
  const step = conversationRepository().loadList(DEFAULT_CONVERSATION_BINDING)
  const restored = Array.isArray(step) ? step : []
  return restored.length > 0 ? restored : [createAgentConversation()]
}

interface AgentState {
  conversations: AgentConversation[]
  /** `null` = 跟随最近一次改动的那条对话。 */
  activeConversationId: string | null
  /** 正在等待回复的那条助手消息 id；`null` 表示没有在途请求。 */
  pendingReplyId: string | null
  activeConversation: AgentConversation | undefined
  /**
   * 这批会话绑在哪份文档上（设计 5.1：一个会话绑定一个 project/document/workspace）。
   *
   * 默认值是界面自己的本地绑定；Task 4/5 会用真实文档把它钉住（`setBinding`）。
   * 列表**永远按整个绑定取**，所以两份额外文档不会互相看到对方的对话。
   */
  binding: ConversationBinding
  createConversation: () => Promise<boolean>
  selectConversation: (id: string) => Promise<boolean>
  deleteConversation: (id: string) => Promise<boolean>
  /** 换一个绑定并**从仓储重新加载**它的列表（切回来时不会用上一次的内存快照）。 */
  setBinding: (binding: ConversationBinding) => Promise<boolean>
  sendPrompt: (prompt: string) => Promise<boolean>
  resolvePendingReply: (text: string) => AgentMessage | undefined
  /** 记一条运行轨迹（追加，不替换；运行期状态，不进仓储）。 */
  recordRunEvent: (entry: AgentTraceEntry) => void
  /**
   * 记**一行开发者诊断**（追加）。与 `recordRunEvent` 分开，是因为它服务的是另一层读者：
   * 计划要求详细诊断**默认关着**，所以它不能混进用户可见的轨迹里。
   *
   * 传进来的内容必须**已经脱敏**（`agentRunner` 只取账本的 `phase`/`from`/`detail`/时间，
   * 不含候选文档、密钥、模型推理或图像字节）。这里不再二次处理，也不落任何结构化对象。
   */
  recordDiagnostic: (line: string) => void
  /** 记下已暂存的草稿**视图**。 */
  recordDraft: (draft: AgentDraftView) => Promise<boolean>
  /** 记下提交结果；`committed` / `no_change` 都算结束。 */
  recordReceipt: (receipt: AgentCommitView) => Promise<boolean>
  /** 运行失败：保留原因与"能不能重试"，而不是给一条空回复。 */
  failPendingReply: (failure: { code: string; message: string; retryable: boolean }) => Promise<boolean>
  clearAll: () => Promise<boolean>
}

function mostRecent(conversations: AgentConversation[]): AgentConversation | undefined {
  return [...conversations].sort((left, right) => right.updatedAt - left.updatedAt)[0]
}

function resolveActive(conversations: AgentConversation[], activeConversationId: string | null): AgentConversation | undefined {
  return conversations.find((conversation) => conversation.id === activeConversationId) ?? mostRecent(conversations)
}

const initialConversations = initialProjection()

export const useAgentStore = create<AgentState>((set, get) => ({
  conversations: initialConversations,
  activeConversationId: null,
  pendingReplyId: null,
  activeConversation: mostRecent(initialConversations),
  binding: DEFAULT_CONVERSATION_BINDING,
  createConversation: () => {
    const conversation = createAgentConversation()
    return commitAfter(
      () => conversationRepository().create(conversation, get().binding),
      () => set((state) => {
        const conversations = [conversation, ...state.conversations]
        return { conversations, activeConversationId: conversation.id, pendingReplyId: null, activeConversation: conversation }
      })
    )
  },
  selectConversation: (id) => {
    let switched = false
    const outcome = commitAfter(
      () => conversationRepository().read(id),
      (loaded) => {
        /**
         * 仓储里已经没有这条会话（被删了，或者它属于另一个绑定）：**不许**把它变回当前会话。
         * 内存是投影，投影不该比真源活得更久 —— 这就是"删掉的会话从旧缓存里回来"的那条路。
         */
        if (!loaded) return
        const conversation = get().conversations.find((candidate) => candidate.id === id) ?? loaded
        set({ activeConversationId: id, activeConversation: conversation, pendingReplyId: null })
        switched = true
      }
    )
    // 返回值说的是"这一次到底切没切"：读到了、但那条会话已经不在仓储里，就是没切。
    return outcome.then((read) => read && switched)
  },
  deleteConversation: (id) => commitAfter(
    // 仓储说删不掉（不是"没有这条"）时，界面留着它 —— 一条删不掉的会话比一条假装删掉的诚实。
    () => conversationRepository().remove(id),
    () => set((state) => {
      const remaining = state.conversations.filter((conversation) => conversation.id !== id)
      // 永远留一条空对话：侧栏清空之后用户仍然应该有一个可以直接说话的地方。
      const conversations = remaining.length > 0 ? remaining : [createAgentConversation()]
      const activeConversation = resolveActive(conversations, state.activeConversationId === id ? null : state.activeConversationId)
      return { conversations, activeConversation, activeConversationId: activeConversation?.id ?? null, pendingReplyId: null }
    })
  ),
  setBinding: async (binding) => {
    let loaded: AgentConversation[]
    try {
      loaded = await conversationRepository().loadList(binding)
    } catch {
      // 读不回来就**不换绑定**：界面留着上一次读到的内容，而不是装作"这个绑定是空的"。
      return false
    }
    // **整体替换**，绝不与旧列表合并：合并就是"删掉的会话从旧缓存里回来"的另一半。
    const conversations = loaded.length > 0 ? loaded : [createAgentConversation()]
    const activeConversation = resolveActive(conversations, null)
    set({ binding, conversations, activeConversationId: activeConversation?.id ?? null, activeConversation, pendingReplyId: null })
    if (activeConversation && activeConversation.messages.length === 0) {
      // 桌面仓储的列表**不带消息**（消息按需读）：把当前这条补上，首屏才不是一段空白。
      try {
        const detail = await conversationRepository().read(activeConversation.id)
        if (detail && detail.messages.length > 0) {
          const merged = conversations.map((conversation) => (conversation.id === detail.id ? { ...conversation, messages: detail.messages } : conversation))
          set({ conversations: merged, activeConversation: merged.find((conversation) => conversation.id === detail.id) })
        }
      } catch {
        // 读不到消息就保持这条（消息为空），**不编内容**。
      }
    }
    return true
  },
  sendPrompt: (prompt) => {
    const text = prompt.trim()
    if (!text) return Promise.resolve(false)
    const now = Date.now()
    const userMessage: AgentMessage = { id: nextId("message"), role: "user", text, createdAt: now }
    const pendingMessage: AgentMessage = { id: nextId("message"), role: "assistant", text: "", createdAt: now, pending: true }
    // 一条消息都没有的对话才改名：用户后续追问不应该把标题越改越偏。
    const target = resolveActive(get().conversations, get().activeConversationId)
    if (!target) return Promise.resolve(false)
    const updated: AgentConversation = {
      ...target,
      title: target.messages.length === 0 ? deriveConversationTitle(text) || target.title : target.title,
      updatedAt: now,
      messages: [...target.messages, userMessage, pendingMessage]
    }
    return commitAfter(
      /**
       * 先把用户这一句写进仓储：写不进去就**不起这一轮**。
       * 在途助手消息是界面对"正在跑"的承诺，而一句没存下来的话不该拿到那个承诺。
       */
      () => conversationRepository().append(updated, get().binding, userMessage),
      () => {
        const conversations = get().conversations.map((conversation) => (conversation.id === updated.id ? updated : conversation))
        set({ conversations, activeConversationId: updated.id, activeConversation: updated, pendingReplyId: pendingMessage.id })
      }
    )
  },
  resolvePendingReply: (text) => {
    const target = pendingTarget(get)
    if (!target) return undefined
    const reply: AgentMessage = { ...target.message, text, pending: false }
    let refused = false
    void commitPending(get, set, () => reply, { finish: true, onRefusal: () => { refused = true } })
    /**
     * 浏览器兜底同步落定：上面那次写**此刻**已经有结果了，所以拒绝时能如实回 `undefined`。
     * 桌面那一支要过 IPC，这里只能把消息形状交出去（调用方以 store 状态为准）。
     */
    return refused ? undefined : reply
  },
  /**
   * 轨迹 / 草稿 / 回执三类更新共用一个内部实现：它们都是"改**那条在途助手消息**"。
   *
   * 抽出来不是为了少写几行，而是为了让三条规则只有一处：
   * ① 没有在途消息时**什么都不做**（不要凭空造一条消息）；
   * ② 终态（收到回执 / 失败）之后 `pendingReplyId` 清空，因此**迟到的事件会被丢弃** ——
   *    这正是计划 Step 1 点名的 "late response" 场景；
   * ③ 说过的内容先写仓储（草稿 / 回执 / 失败走 `commitPending`），运行期状态只留在内存。
   */
  recordRunEvent: (entry) => updatePending(get, set, (message) => message.pending
    ? { ...message, trace: [...(message.trace ?? []), entry] }
    : message),
  recordDiagnostic: (line) => updatePending(get, set, (message) => message.pending
    ? { ...message, diagnostics: [...(message.diagnostics ?? []), line] }
    : message),
  recordDraft: (draft) => commitPending(get, set, (message) => message.pending ? { ...message, draft, pending: false } : message),
  recordReceipt: (receipt) => commitPending(get, set, (message) => ({
    ...message,
    pending: false,
    commit: receipt,
    text: receipt.status === "committed" ? "已按确认提交。" : receipt.status === "no_change" ? "这次没有需要改动的地方。" : ""
  }), { finish: true }),
  failPendingReply: (failure) => commitPending(get, set, (message) => ({ ...message, pending: false, failure, text: "" }), { finish: true }),
  clearAll: () => {
    const previous = get().conversations.map((conversation) => conversation.id)
    const conversation = createAgentConversation()
    return commitAfter(
      () => removeAll(previous),
      () => set({ conversations: [conversation], activeConversationId: conversation.id, activeConversation: conversation, pendingReplyId: null })
    )
  }
}))
