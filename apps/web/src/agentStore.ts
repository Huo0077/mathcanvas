import { create } from "zustand"

import type { DraftObjectCounts } from "@draw/agent-core"

import { deriveConversationTitle } from "./agentTranscript"
import { compactConversationSummary, shouldCompactConversation, summaryOfDocument, withDocumentSummary } from "./conversationSummary"
import { factBelongsToDocument } from "@draw/agent-core"
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

/** 一轮运行钉住的落点（运行一开始就定，之后切会话也不改）。 */
export interface RunTarget {
  conversationId: string
  /** 收到运行事件与终态的那条**助手**消息。 */
  messageId: string
  /**
   * 这一轮的**用户消息** id。
   *
   * 与 `messageId` 分开：写事实时"证据"必须是**已经存下来的那条用户消息**
   *（Rust 侧的同会话判据），而在途的助手消息在它有内容之前根本不在仓储里。
   */
  promptMessageId: string
}

/**
 * 事件该落到哪条消息上。
 *
 * 给了 `runId` 就按**那一轮开始时钉住的落点**找（规格 §5.4：切会话不改落点，
 * 旧事件也**不许**写进新会话）；没给就退回"当前在途的那条"（老调用方与界面自身）。
 */
function targetFor(get: () => AgentState, runId?: string): PendingTarget | null {
  if (runId === undefined) return pendingTarget(get)
  const pinned = get().runTargets[runId]
  if (!pinned) return null
  const conversation = get().conversations.find((candidate) => candidate.id === pinned.conversationId)
  const message = conversation?.messages.find((candidate) => candidate.id === pinned.messageId)
  return conversation && message ? { conversation, message } : null
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

/** 清掉一轮运行的落点（终态之后再来事件一律丢弃）。 */
function withoutRun(runTargets: Record<string, RunTarget>, runId: string): Record<string, RunTarget> {
  const { [runId]: _dropped, ...rest } = runTargets
  return rest
}

/**
 * 一条**提交事实**的人话。
 *
 * 它是写进提示词的那句话（"已提交：文档第 4 版新增 1 个对象（solid-1）"），
 * 所以它只说**已经发生的事**：代数与创建出来的对象 id —— **没有候选文档、没有推理**。
 */
function describeCommittedRun(generation: number, createdObjects: readonly string[]): string {
  const listed = createdObjects.slice(0, 6).join("、")
  return createdObjects.length === 0
    ? `已确认：文档已经提交到第 ${generation} 版（这次没有新增对象）`
    : `已确认：文档第 ${generation} 版新增 ${createdObjects.length} 个对象（${listed}）`
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
  update: (message: AgentMessage) => AgentMessage,
  runId?: string
): void {
  const target = targetFor(get, runId)
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
  options: { finish?: boolean; onRefusal?: () => void; runId?: string; documentGeneration?: number } = {}
): Promise<boolean> {
  const target = targetFor(get, options.runId)
  if (!target) return Promise.resolve(false)
  const message = update(target.message)
  const owner: AgentConversation = {
    ...target.conversation,
    updatedAt: Date.now(),
    messages: target.conversation.messages.map((candidate) => (candidate.id === message.id ? message : candidate))
  }
  return commitAfter(
    // `documentGeneration` 落到 `conversation_messages.document_generation`（Fix round 2 / item 5）。
    () => conversationRepository().append(owner, get().binding, message, options.documentGeneration),
    () => {
      const conversations = get().conversations.map((conversation) => (conversation.id === owner.id ? owner : conversation))
      const projected: Partial<AgentState> = { conversations, activeConversation: resolveActive(conversations, get().activeConversationId) }
      if (options.finish) {
        // 终态：清掉**当前**在途指针（界面据此停止"思考中"）与这一轮的落点。
        projected.pendingReplyId = get().pendingReplyId === message.id ? null : get().pendingReplyId
        if (options.runId !== undefined) projected.runTargets = withoutRun(get().runTargets, options.runId)
      }
      set(projected)
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
  /**
   * **一轮运行钉住的落点**：`runId` → 它属于哪条会话、哪条在途助手消息。
   *
   * 为什么不能只用 `pendingReplyId`：那个字段是**界面**的"当前在途"，用户一切走
   * 就会被清掉（设计如此）。而规格 §5.4 要求"切换会话不取消旧运行；旧事件仍写回原会话" ——
   * 所以运行自己带一份落点，切会话不动它，回执/失败这类终态才清。
   */
  runTargets: Record<string, RunTarget>
  /**
   * 钉住一轮运行的落点：按用户消息 id 找到它在哪条会话、随后的哪条助手消息上。
   * 找不到（例如那条消息已经不在了）时回 `null`，**不编**一个落点出来。
   */
  pinRun: (input: { runId: string; promptMessageId: string }) => RunTarget | null
  /** 一轮结束：清掉落点（之后再来的事件一律丢弃）。 */
  endRun: (runId: string) => void
  createConversation: () => Promise<boolean>
  selectConversation: (id: string) => Promise<boolean>
  deleteConversation: (id: string) => Promise<boolean>
  /** 换一个绑定并**从仓储重新加载**它的列表（切回来时不会用上一次的内存快照）。 */
  setBinding: (binding: ConversationBinding) => Promise<boolean>
  sendPrompt: (prompt: string) => Promise<boolean>
  resolvePendingReply: (text: string) => AgentMessage | undefined
  /**
   * 记一条运行轨迹（追加，不替换；运行期状态，不进仓储）。
   *
   * `runId` 给了就写回**那一轮自己的**会话（切走了也不会写错地方）。
   */
  recordRunEvent: (entry: AgentTraceEntry, runId?: string) => void
  /**
   * 记**一行开发者诊断**（追加）。与 `recordRunEvent` 分开，是因为它服务的是另一层读者：
   * 计划要求详细诊断**默认关着**，所以它不能混进用户可见的轨迹里。
   *
   * 传进来的内容必须**已经脱敏**（`agentRunner` 只取账本的 `phase`/`from`/`detail`/时间，
   * 不含候选文档、密钥、模型推理或图像字节）。这里不再二次处理，也不落任何结构化对象。
   */
  recordDiagnostic: (line: string, runId?: string) => void
  /** 记下已暂存的草稿**视图**。 */
  recordDraft: (draft: AgentDraftView, runId?: string, documentGeneration?: number) => Promise<boolean>
  /** 记下提交结果；`committed` / `no_change` 都算结束。 */
  recordReceipt: (receipt: AgentCommitView, runId?: string, documentGeneration?: number) => Promise<boolean>
  /** 运行失败：保留原因与"能不能重试"，而不是给一条空回复。 */
  failPendingReply: (failure: { code: string; message: string; retryable: boolean }, runId?: string, documentGeneration?: number) => Promise<boolean>
  /**
   * **一轮已提交运行的结论写进长期记忆**（Task 5）。
   *
   * 两件事，各自只在**它该发生的时候**发生：
   * ① 事实：这次提交落在文档第几版、创建了哪些对象。证据是**这条会话里的**那条用户消息
   *   （Rust 侧同一个判据：跨会话的证据一律拒）。**丢弃草稿与编译失败永远不会走到这里** ——
   *   调用方只有"提交成功"那一条路会调它。
   * ② 摘要：这条会话长过阈值时压缩成结构化摘要（原始消息留在仓储里）。
   *
   * 落点优先用显式给的 `conversationId`/`promptMessageId`（提交发生在运行结束之后，
   * 那时这一轮的落点可能已经被终态回执清掉了），其次是 `runId` 钉住的那一份。
   */
  recordCommittedRun: (input: {
    runId: string
    generation: number
    createdObjects: readonly string[]
    /** 这次提交落在**哪份文档**上（事实按它筛；同一次会话可能被用在两份文档上）。 */
    documentId: string
    conversationId?: string
    promptMessageId?: string
  }) => Promise<boolean>
  clearAll: () => Promise<boolean>
}

function mostRecent(conversations: AgentConversation[]): AgentConversation | undefined {
  return [...conversations].sort((left, right) => right.updatedAt - left.updatedAt)[0]
}

function resolveActive(conversations: AgentConversation[], activeConversationId: string | null): AgentConversation | undefined {
  return conversations.find((conversation) => conversation.id === activeConversationId) ?? mostRecent(conversations)
}

const initialConversations = initialProjection()

/**
 * 绑定请求的序号：**只有最后那一次算数**（见 `setBinding`）。
 *
 * 读列表是异步的，而用户可以在两次读之间换文档 —— 没有这个序号，先发后到的那一次
 * 会把绑定与列表按旧文档写下去（e2e 当场抓到过）。
 */
let bindingRequest = 0

export const useAgentStore = create<AgentState>((set, get) => ({
  conversations: initialConversations,
  activeConversationId: null,
  pendingReplyId: null,
  activeConversation: mostRecent(initialConversations),
  binding: DEFAULT_CONVERSATION_BINDING,
  runTargets: {},
  pinRun: ({ runId, promptMessageId }) => {
    for (const conversation of get().conversations) {
      const index = conversation.messages.findIndex((message) => message.id === promptMessageId)
      if (index < 0) continue
      // 这一轮的助手消息就是紧随其后的那条；它不是助手消息时退回"这条会话里最后一条在途消息"。
      const after = conversation.messages[index + 1]
      const message = after && after.role === "assistant"
        ? after
        : [...conversation.messages].reverse().find((candidate) => candidate.role === "assistant" && candidate.pending)
      if (!message) return null
      const target: RunTarget = { conversationId: conversation.id, messageId: message.id, promptMessageId }
      /**
       * **把 `runId` 盖在这一轮的两条消息上**（Fix round 1 / C2 + Minor 2）。
       *
       * 界面上那块"确认改动"面板是按消息渲染的，点确认时必须能说出"这是哪一轮" ——
       * 否则它会指回最近的那一轮（可能是**另一条会话**的草稿）。它同时是
       * `conversation_messages.run_id` 那一列唯一的写点（原先永远是空的）。
       */
      const conversations = get().conversations.map((candidate) => candidate.id === conversation.id
        ? { ...candidate, messages: candidate.messages.map((entry) => (entry.id === promptMessageId || entry.id === message.id ? { ...entry, runId } : entry)) }
        : candidate)
      set({
        conversations,
        activeConversation: resolveActive(conversations, get().activeConversationId),
        runTargets: { ...get().runTargets, [runId]: target }
      })
      return target
    }
    return null
  },
  endRun: (runId) => set({ runTargets: withoutRun(get().runTargets, runId) }),
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
    /**
     * **只有最后一次绑定请求算数**（Fix round 1：e2e 当场抓到的竞态）。
     *
     * 读列表是异步的（桌面端要过 IPC）。应用启动时那一次绑定要读一份文档，而用户可能立刻
     * 切了工作区（= 换文档）—— 两次读的**回来顺序不保证**。慢的那一次后到，就会把绑定
     * 与列表按**旧文档**写下去：界面在立体几何里，而会话全写在平面几何那份绑定上。
     * 这正是 C1 要修的那类问题，只是换了一条路进来。
     */
    bindingRequest += 1
    const request = bindingRequest
    let loaded: AgentConversation[]
    try {
      loaded = await conversationRepository().loadList(binding)
    } catch {
      // 读不回来就**不换绑定**：界面留着上一次读到的内容，而不是装作"这个绑定是空的"。
      return false
    }
    // 期间又有人要求换绑定：这一次的结果已经过期，**不应用**（免得把新列表盖回旧的）。
    if (request !== bindingRequest) return false
    // **整体替换**，绝不与旧列表合并：合并就是"删掉的会话从旧缓存里回来"的另一半。
    const conversations = loaded.length > 0 ? loaded : [createAgentConversation()]
    const activeConversation = resolveActive(conversations, null)
    set({ binding, conversations, activeConversationId: activeConversation?.id ?? null, activeConversation, pendingReplyId: null })
    if (activeConversation && activeConversation.messages.length === 0) {
      // 桌面仓储的列表**不带消息**（消息按需读）：把当前这条补上，首屏才不是一段空白。
      try {
        const detail = await conversationRepository().read(activeConversation.id)
        if (request !== bindingRequest) return true
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
   * ② 终态（收到回执 / 失败）之后落点清空，因此**迟到的事件会被丢弃** ——
   *    这正是计划 Step 1 点名的 "late response" 场景；
   * ③ 说过的内容先写仓储（草稿 / 回执 / 失败走 `commitPending`），运行期状态只留在内存。
   *
   * 每个方法都可以带 `runId`：带上就写回**那一轮自己的**会话与消息（规格 §5.4）。
   */
  recordRunEvent: (entry, runId) => updatePending(get, set, (message) => message.pending
    ? { ...message, trace: [...(message.trace ?? []), entry] }
    : message, runId),
  recordDiagnostic: (line, runId) => updatePending(get, set, (message) => message.pending
    ? { ...message, diagnostics: [...(message.diagnostics ?? []), line] }
    : message, runId),
  recordDraft: (draft, runId, documentGeneration) => commitPending(get, set, (message) => message.pending ? { ...message, draft, pending: false } : message, { runId, documentGeneration }),
  recordReceipt: (receipt, runId, documentGeneration) => commitPending(get, set, (message) => ({
    ...message,
    pending: false,
    commit: receipt,
    text: receipt.status === "committed" ? "已按确认提交。" : receipt.status === "no_change" ? "这次没有需要改动的地方。" : ""
  }), { finish: true, runId, documentGeneration }),
  failPendingReply: (failure, runId, documentGeneration) => commitPending(get, set, (message) => ({ ...message, pending: false, failure, text: "" }), { finish: true, runId, documentGeneration }),
  recordCommittedRun: async (input) => {
    const pinned = get().runTargets[input.runId]
    const conversationId = input.conversationId ?? pinned?.conversationId
    const promptMessageId = input.promptMessageId ?? pinned?.promptMessageId
    if (!conversationId || !promptMessageId) return false
    const createdAt = Date.now()

    // ① 事实：**代数 + 这次创建的对象 + 它属于哪份文档**。
    //    证据是这条会话里的那条用户消息（Rust 侧同一个判据）；
    //    `documentId` 是注入时筛选用它（规格 §5.1：一条会话的事实只属于它自己那份文档）。
    try {
      await conversationRepository().saveFact({
        id: `fact-${input.runId}`,
        conversationId,
        key: `commit:${input.runId}`,
        valueJson: {
          text: describeCommittedRun(input.generation, input.createdObjects),
          generation: input.generation,
          createdObjects: [...input.createdObjects],
          documentId: input.documentId
        },
        sourceMessageId: promptMessageId,
        status: "confirmed",
        createdAt
      })
    } catch {
      // 事实写不进去（例如证据消息不在那条会话里、或 IPC 失败）：如实回 false，**不**假装写下过。
      return false
    }

    // ② 摘要：长过阈值才压缩。**只换摘要**，原始消息留在仓储里（规格 §5.3）。
    try {
      const record = await conversationRepository().readRecord(conversationId)
      if (!record) return true
      const messages = record.conversation.messages.map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        createdAt: message.createdAt
      }))
      if (!shouldCompactConversation(messages)) return true
      /**
       * **只喂本文档的事实，也只写回本文档那一份**（Fix round 2 / C1 残余；规格 §5.1 + §9）。
       *
       * 摘要是事实原文与"创建出来的对象 id"的**另一条载体**：只筛事实列表、不筛摘要，
       * 等于换了条路把同一段文字送进另一份文档的提示词。一条会话可以被用在两份文档上
       * （Agent 自己会为执行计划切工作区），所以这里按 `input.documentId` 取旧摘要、
       * 按它筛事实、再按它写回 —— 别的文档那一份原样保留。
       */
      const scopedFacts = record.facts.filter((fact) => factBelongsToDocument(fact, input.documentId))
      const previous = summaryOfDocument(record.summary, input.documentId)
      const summary = compactConversationSummary({
        messages,
        facts: scopedFacts,
        createdObjects: input.createdObjects,
        previous,
        now: createdAt
      })
      await conversationRepository().saveSummary({ conversationId, summary: withDocumentSummary(record.summary, input.documentId, summary), expectedVersion: record.summaryVersion })
    } catch {
      // 摘要失败不影响事实（它已经落下了）：下一次提交再试，不在这里编一份摘要。
    }
    return true
  },
  clearAll: () => {
    const previous = get().conversations.map((conversation) => conversation.id)
    const conversation = createAgentConversation()
    return commitAfter(
      () => removeAll(previous),
      () => set({ conversations: [conversation], activeConversationId: conversation.id, activeConversation: conversation, pendingReplyId: null })
    )
  }
}))
