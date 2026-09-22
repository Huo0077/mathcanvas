import type { Budget } from "./budget"
import type { ConversationBinding, ConversationFactView, ConversationMessageView, DocumentHandle, RunContext } from "./contracts"
import { createSkillCatalog, type SkillBundle } from "./skills/catalog"

/**
 * **上下文组装**（Task 2.2 Step 4）。
 *
 * 计划原文：include "live handles, confirmed facts, selected ordered refs, warnings, and only
 * requested details; never include credentials, hidden tool instructions, or chain-of-thought".
 *
 * ## 为什么"绝不包含"这几条要靠结构而不是靠自觉
 *
 * 这个函数的输出会**原样进模型提示词**。所以它不是"整理数据"，而是**模型能看到什么**的定义：
 * - 函数的入参里**根本没有**凭据、provider 配置、工具实现或模型的自述文本 ——
 *   没有入参就不可能被漏进输出，这比"记得过滤"可靠。
 * - 每一条进入输出的东西都必须**追到来源**：事实要能在观察结果里找到，
 *   引用要带 documentId 与已验证的内容哈希。追不到的一律丢弃并记一条警告 ——
 *   **丢弃要留痕**，否则"为什么模型没看到我刚说的话"无从查起。
 * - 有界：条数与字节数都设上限，超了就截断并如实说明（模型据此决定要不要再问一次）。
 *
 * ## 一处刻意的取舍：过期引用**不进上下文**，但进警告
 *
 * 哈希对不上的引用说明"文档在拿到手柄之后被改过"。把它塞进上下文会让模型基于旧位置下判断；
 * 直接静默丢掉又会让模型以为"用户没选中任何东西"。所以两者都不做：**不进引用列表，进警告**。
 */

export interface Fact {
  id: string
  /** 用户可读的一句话；会原样进提示词，所以不能夹带指令。 */
  text: string
  /** 这条事实是从哪来的（用户明说 / 视觉推断 / 系统假设）。 */
  origin: "user" | "inferred" | "assumed"
}

export interface SelectedRef {
  documentId: string
  entityId: string
  label: string
  /** 采集这个引用时的内容哈希；与手柄不一致即为过期。 */
  contentHash: string
  handle: DocumentHandle
}

export interface ObservationSummary {
  /** 已确认的事实（权威来源；上下文里的事实必须在这里找得到）。 */
  facts: readonly Fact[]
  /** 场景摘要（有界的一段话）。 */
  summary: string
}

export type ContextWarning = { code: string; detail: string }

export interface ModelContext {
  /** 一份给模型的说明，只描述"你现在有什么、不能做什么"，不含任何隐藏指令。 */
  preamble: string
  /** 目标文档手柄 + 来源手柄：每次调用都带，模型据此说清"改的是哪一份"。 */
  handles: { target: DocumentHandle; sources: DocumentHandle[] }
  /**
   * **这一轮绑定的会话与文档**（Agent DSL 切片 Task 5；规格 §5.1/§5.4）。
   *
   * 为什么要单独一块：提示词里必须能写出"你现在在哪个会话、哪份文档的第几版"，
   * 否则模型会**跨会话引用对象**（规格 §7 明令禁止），而那种错误的症状是
   * "它引用了一个用户根本看不见的对象"。`generation` 也在这里：确认提交时要拿它做
   * Compare-and-Swap，"模型看到的是哪一版"必须与"用户确认的是哪一版"对得上。
   */
  binding: { conversationId: string; projectId: string; documentId: string; generation: number }
  /** 工作区边界。 */
  workspace: string
  /** 已确认事实（只含观察结果里有、且被请求的那几条）。 */
  facts: readonly Fact[]
  /** 有序的选中引用 —— 顺序有意义（"第一个点""第二个点"）。 */
  selectedRefs: readonly SelectedRef[]
  /** 本次运行允许的技能（已经过目录校验）。 */
  skills: readonly { id: string; title: string; summary: string; limits: SkillBundle["manifest"]["limits"] }[]
  /** 只读出：可用动作名。 */
  availableActions: readonly string[]
  /** 截断、过期、未知技能等如实记录。 */
  warnings: readonly ContextWarning[]
  /** 估算的字符数，供调用方核对预算。 */
  estimatedCharacters: number
}

export interface BuildContextInput {
  run: RunContext
  observation: ObservationSummary
  requestedSkillIds: readonly string[]
  selectedRefs: readonly SelectedRef[]
  /** 只读阶段可用的动作名（来自技能清单与能力注册表）。 */
  availableActions: readonly string[]
  budget: Budget
  /** 单次上下文最多几条事实 / 几条引用。 */
  limits?: { facts?: number; refs?: number }
}

/** 上限：条数与字节都要有界，否则"预算"只是说说。 */
export const DEFAULT_FACT_LIMIT = 12
export const DEFAULT_REF_LIMIT = 16
export const MAX_FACT_LIMIT = 32
export const MAX_REF_LIMIT = 32

const PREAMBLE = [
  "你是 MathCanvas 的构图助手。你只能通过工具观察场景与提交动作计划。",
  "你**不能**直接修改文档：提交必须由用户在看到预览并确认之后触发。",
  "对象引用必须带 documentId；不要凭标签猜对象，标签可能重复。",
  "没看到的事实不要假设：缺信息时问，而不是编一个数值。"
].join("\n")

/** 调用方给的上限只能**收紧**，不能放宽：上下文预算不是调用方可以单方面加大的东西。 */
function clamp(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback
  return Math.min(Math.floor(value), maximum)
}

export function buildContext(input: BuildContextInput): ModelContext {
  const warnings: ContextWarning[] = []
  const factLimit = clamp(input.limits?.facts, DEFAULT_FACT_LIMIT, MAX_FACT_LIMIT)
  const refLimit = clamp(input.limits?.refs, DEFAULT_REF_LIMIT, MAX_REF_LIMIT)
  const knownFacts = new Map(input.observation.facts.map((fact) => [fact.id, fact]))

  // ---- 技能：只加载经过目录校验的（未注册 / 哈希不符 / 修订号不符都会在这里被拒） ----
  const catalog = createSkillCatalog()
  const skills: { id: string; title: string; summary: string; limits: SkillBundle["manifest"]["limits"] }[] = []
  for (const skillId of input.requestedSkillIds) {
    const loaded = catalog.load(skillId, input.run.capabilityRevision)
    if (!loaded.ok) {
      warnings.push({ code: `skill_${loaded.reason}`, detail: `skill ${skillId} was not loaded: ${loaded.detail}` })
      continue
    }
    skills.push({ id: loaded.bundle.manifest.id, title: loaded.bundle.manifest.title, summary: loaded.bundle.manifest.summary, limits: loaded.bundle.manifest.limits })
  }

  // ---- 事实：**只从观察结果里取**。上下文里不可能出现一条没被观察到的事实，
  //      因为这里根本没有第二个来源 —— 这是"缺事实不许猜"在结构上的落点。 ----
  const facts: Fact[] = [...knownFacts.values()]
  if (facts.length > factLimit) {
    warnings.push({ code: "truncated_facts", detail: `showing ${factLimit} of ${facts.length} confirmed facts` })
    facts.length = factLimit
  }

  // ---- 选中引用：按序保留，过期的进警告而不是进引用 ----
  const selectedRefs: SelectedRef[] = []
  for (const ref of input.selectedRefs) {
    if (ref.handle.contentHash !== ref.contentHash) {
      // 引用过期：**不进引用列表，进警告** —— 静默丢弃会让模型以为用户没选中任何东西。
      warnings.push({ code: "stale_ref", detail: `${ref.entityId} in ${ref.documentId} changed since it was selected` })
      continue
    }
    if (selectedRefs.length >= refLimit) {
      warnings.push({ code: "truncated_refs", detail: `showing ${refLimit} of ${input.selectedRefs.length} selected objects` })
      break
    }
    selectedRefs.push(ref)
  }

  const context: ModelContext = {
    preamble: PREAMBLE,
    handles: { target: input.run.target, sources: input.run.sources.map((source) => source.layout) },
    binding: { conversationId: input.run.conversationId, projectId: input.run.target.projectId, documentId: input.run.target.documentId, generation: input.run.target.generation },
    workspace: input.run.target.workspace,
    facts,
    selectedRefs,
    skills,
    availableActions: [...input.availableActions],
    warnings,
    estimatedCharacters: 0
  }
  context.estimatedCharacters = estimate(context)
  return context
}

/** 字符数估算：只统计会进提示词的部分。 */
function estimate(context: ModelContext): number {
  const parts: string[] = [context.preamble, context.workspace]
  parts.push(JSON.stringify(context.handles))
  parts.push(JSON.stringify(context.binding))
  parts.push(...context.facts.map((fact) => fact.text))
  parts.push(...context.selectedRefs.map((ref) => `${ref.documentId}:${ref.entityId}:${ref.label}`))
  parts.push(...context.skills.map((skill) => `${skill.id} ${skill.title} ${skill.summary}`))
  parts.push(...context.availableActions)
  parts.push(...context.warnings.map((warning) => `${warning.code} ${warning.detail}`))
  return parts.join("\n").length
}

// ---------------------------------------------------------------- 会话上下文（规格 §5.3）

/**
 * **会话上下文**（对话切片 Task 4；规格 §5.3）。
 *
 * 它回答的是"这条会话到这一轮为止，模型应该知道什么"：绑定、结构化摘要、**已确认**事实、
 * 最近消息、当前场景观察、以及那份**还没确认**的草稿视图。
 *
 * ## 顺序即优先级
 *
 * 规格 §5.3 给的组装顺序是"已确认事实 → 摘要 → 最近消息 → 当前场景观察"，
 * 而 §1.2 给的是**当前文档事实优先于旧对话**。两条一起读，规则是：
 * **场景是当前事实，先占预算且永不因消息被丢**；旧消息只是背景，预算不够时从最旧的开始丢。
 * 所以 `observation` 与 `facts` 是"固定开销"，`summary` 与 `messages` 争剩下的那部分。
 *
 * ## 未确认的草稿不是事实
 *
 * `facts` 里只有 `confirmed` 会活下来（`draft` / `stale` / `retracted` 一律丢掉）。
 * 草稿**视图**可以进上下文（模型得知道"有一份待确认的草稿"），但它进的是 `draft` 字段，
 * 不是事实列表 —— 否则摘要一压缩，"还没发生的事"就变成了"已经发生的事"。
 */
export interface ConversationDraftView {
  draftId: string
  draftVersion: number
  previewHash: string
  stageCount: number
  /** 规划器/编译器替用户做的假设（人话，一条一句）。 */
  assumptions?: readonly string[]
}

export interface ConversationContextInput {
  binding: ConversationBinding
  /** 结构化摘要（目标 / 确认事实 / 已创建对象 / 未解决问题 / 用户偏好）。 */
  summary: string
  /** 会话里存下来的事实。只有 `confirmed` 会进上下文。 */
  facts: readonly ConversationFactView[]
  /** 会话消息（最新的在后）。顺序由组装方按时间给出，组装时再兜一次底。 */
  messages: readonly ConversationMessageView[]
  /** 当前场景观察（**权威来源**：这一份是"文档现在是什么样"）。 */
  observation: ObservationSummary
  /** 未确认草稿的视图（可选）。 */
  draft?: ConversationDraftView
  /**
   * 这一轮的当前请求。
   *
   * 给了它就把末尾那条**同一句**的用户消息从 `messages` 里去掉：当前请求在提示词里有
   * 自己的位置（`PlanRequest.userMessage`），重复一遍既占预算又让模型以为用户说了两次。
   */
  request?: string
  limits?: { messages?: number; characters?: number }
}

/** 会话那一半的入参（观察与当前请求由协调器在运行中补上）。 */
export type ConversationContextSource = Omit<ConversationContextInput, "observation" | "request">

export interface ConversationContext {
  binding: ConversationBinding
  summary: string
  /** **已确认**事实，按 `key`（再 `id`）排序：同一份输入必须给出同一份上下文。 */
  facts: readonly ConversationFactView[]
  /** 最近消息，时间序（旧 → 新），已按预算截断。 */
  messages: readonly ConversationMessageView[]
  /** 当前场景观察。**不进预算裁剪**：它是当前事实。 */
  observation: ObservationSummary
  draft?: ConversationDraftView
  warnings: readonly ContextWarning[]
  estimatedCharacters: number
}

/** 最近消息的条数上限（缺省 / 硬上限）。 */
export const DEFAULT_MESSAGE_LIMIT = 12
export const MAX_MESSAGE_LIMIT = 24
/** 会话那一段的字符预算（摘要 + 最近消息）。超出的部分不是被截断就是被丢掉。 */
export const DEFAULT_CONVERSATION_CHARACTER_BUDGET = 6_000
export const MAX_CONVERSATION_CHARACTER_BUDGET = 24_000
/** 摘要单独的字符上限：摘要是"压缩过的历史"，它自己不该长到把消息挤没。 */
export const DEFAULT_SUMMARY_CHARACTER_BUDGET = 2_000
/**
 * **已确认事实的条数上限**。
 *
 * 与提示词渲染的上限**必须是同一个数**（`systemPrompt.ts` 从这里取）：两处各写一个 16
 * 就意味着"预算按 40 条扣费、模型只看到 16 条"，长会话里摘要与最近消息会被那些
 * 模型根本看不到的事实挤空。
 */
export const MAX_CONVERSATION_FACTS = 16

/**
 * **§5.3 的分段预算**（Fix round 1 / I3）：
 * 场景 20% / 已确认事实 15% / 摘要 20% / 最近消息 35% / 当前请求与安全余量 10%。
 *
 * 每一段**各有各的额度**，所以谁也不能把别人挤没。唯一的例外是场景：它是**当前事实**，
 * 额度是软的（超出的部分从安全余量里扣，不够也不动别人的额度）——
 * 这正是"当前场景优先于旧消息"（§1.2）与"最近消息 35%"两条同时成立的方式。
 */
export const CONVERSATION_BANDS = { scene: 0.20, facts: 0.15, summary: 0.20, messages: 0.35, reserve: 0.10 } as const

/**
 * **这条事实属不属于这份文档**（规格 §5.1；§9 门的"会话之间不串事实"）。
 *
 * 没有 `documentId` 的按"未知"处理 —— 保留（旧数据不该被静默丢掉），
 * 但**能证明是别的文档的**一律不进上下文。
 */
export function factBelongsToDocument(fact: ConversationFactView, documentId: string): boolean {
  return fact.documentId === undefined || fact.documentId === documentId
}

/**
 * 顺序**只看 `createdAt`**（稳定排序，保持调用方给的先后）。
 *
 * 不能再拿 id 兜底：id 形如 `message-…-10`，字符串序会把 `…-10` 排在 `…-9` 前面，
 * 而同一次 `sendPrompt` 的用户消息与在途助手消息时间戳相同 —— 于是"用户说完助手接话"
 * 会变成"助手先说"，当前请求的去重也会跟着错（规格 §5.3 的"最近消息"是有序的）。
 */
function byTime(left: ConversationMessageView, right: ConversationMessageView): number {
  return left.createdAt - right.createdAt
}

function estimateConversation(context: ConversationContext): number {
  const parts: string[] = [JSON.stringify(context.binding), context.summary, context.observation.summary]
  parts.push(...context.observation.facts.map((fact) => fact.text))
  parts.push(...context.facts.map((fact) => `${fact.key} ${fact.text}`))
  parts.push(...context.messages.map((message) => message.text))
  if (context.draft) parts.push(`${context.draft.draftId} ${context.draft.stageCount}`)
  parts.push(...context.warnings.map((warning) => `${warning.code} ${warning.detail}`))
  return parts.join("\n").length
}

export function buildConversationContext(input: ConversationContextInput): ConversationContext {
  const warnings: ContextWarning[] = []

  // ---- 已确认事实：只留 `confirmed`、只留**本文档**的，并按 key/id 排序（确定性） ----
  const confirmed = input.facts.filter((fact) => fact.status === "confirmed")
  const facts = confirmed
    .filter((fact) => {
      if (factBelongsToDocument(fact, input.binding.documentId)) return true
      // 别的文档确认的事实：**不进上下文**（它说的对象在本文档里根本不存在）。
      warnings.push({ code: "foreign_fact", detail: `fact ${fact.key} was confirmed against document ${fact.documentId ?? "unknown"}, not ${input.binding.documentId}` })
      return false
    })
    .map((fact): ConversationFactView => ({ id: fact.id, key: fact.key, text: fact.text, status: "confirmed", ...(fact.documentId === undefined ? {} : { documentId: fact.documentId }) }))
    .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : left.id < right.id ? -1 : left.id > right.id ? 1 : 0))

  // ---- 历史消息：时间序；空白内容不占预算（在途占位消息没有可读的话） ----
  const history = [...input.messages].filter((message) => message.text.trim().length > 0).sort(byTime)
  if (input.request !== undefined && history.length > 0) {
    const last = history[history.length - 1]
    if (last.role === "user" && last.text === input.request) history.pop()
  }

  const messageLimit = clamp(input.limits?.messages, DEFAULT_MESSAGE_LIMIT, MAX_MESSAGE_LIMIT)
  const totalBudget = clamp(input.limits?.characters, DEFAULT_CONVERSATION_CHARACTER_BUDGET, MAX_CONVERSATION_CHARACTER_BUDGET)
  // ---- §5.3 的分段：每段各有各的额度，谁也挤不掉谁 ----
  const factBand = Math.floor(totalBudget * CONVERSATION_BANDS.facts)
  const summaryBand = Math.min(DEFAULT_SUMMARY_CHARACTER_BUDGET, Math.floor(totalBudget * CONVERSATION_BANDS.summary))
  const messageBand = Math.floor(totalBudget * CONVERSATION_BANDS.messages)

  // ---- 已确认事实：**条数与字符都设上限**，超出的既不进上下文也不 charge ----
  const admitted: ConversationFactView[] = []
  let factCharacters = 0
  for (const fact of facts) {
    if (admitted.length >= MAX_CONVERSATION_FACTS) break
    const cost = fact.text.length + fact.key.length
    if (factCharacters + cost > factBand) break
    admitted.push(fact)
    factCharacters += cost
  }
  if (admitted.length < facts.length) {
    warnings.push({ code: "truncated_facts", detail: `showing ${admitted.length} of ${facts.length} confirmed facts` })
  }

  // ---- 摘要：压进自己的额度，**始终是合法 JSON**（切一半会给模型一段坏 JSON） ----
  const fitted = fitSummary(input.summary, summaryBand)
  if (fitted.reduced) {
    warnings.push({ code: "truncated_summary", detail: `the summary was reduced from ${input.summary.length} to ${fitted.text.length} characters` })
  }

  // ---- 最近消息：从**最新**往回收，收不下就停（旧消息先让路） ----
  const kept: ConversationMessageView[] = []
  let messageCharacters = 0
  for (let at = history.length - 1; at >= 0 && kept.length < messageLimit; at -= 1) {
    const message = history[at]
    if (messageCharacters + message.text.length > messageBand) break
    kept.unshift(message)
    messageCharacters += message.text.length
  }
  if (kept.length < history.length) {
    warnings.push({ code: "truncated_messages", detail: `showing the newest ${kept.length} of ${history.length} recent messages` })
  }

  const context: ConversationContext = {
    binding: input.binding,
    summary: fitted.text,
    facts: admitted,
    messages: kept,
    // 场景（当前事实）**不进这套裁剪**：它有自己的软额度（见 CONVERSATION_BANDS 的说明）。
    observation: input.observation,
    ...(input.draft === undefined ? {} : { draft: input.draft }),
    warnings,
    estimatedCharacters: 0
  }
  context.estimatedCharacters = estimateConversation(context)
  return context
}

/**
 * 把摘要压进它的额度里 —— **结果始终是合法 JSON**（Fix round 1 / I4）。
 *
 * 一份满尺寸的结构化摘要（`conversationSummary.ts` 的构造上限约 3.7K 字符）比摘要的额度大，
 * 而原先的实现是 `summary.slice(0, budget)`：模型拿到的 `summary` 是一段**坏 JSON**
 *（截在半个 token 上）。这里改成"解析 → 少留几项 / 截短字符串 → 重新序列化"，
 * 一路缩到装得下为止；最坏情况只剩 `{ goal }`，那也还是合法 JSON。
 * 不是我们写的那种形状（旧数据里的散文）时同样折成 `{ goal }`，绝不原样切一半。
 */
function fitSummary(summary: string, limit: number): { text: string; reduced: boolean } {
  if (summary.length <= limit) return { text: summary, reduced: false }

  let parsed: Record<string, unknown> | null = null
  try {
    const value = JSON.parse(summary) as unknown
    if (value && typeof value === "object" && !Array.isArray(value)) parsed = { ...(value as Record<string, unknown>) }
  } catch {
    parsed = null
  }
  const goal = parsed !== null && typeof parsed.goal === "string" ? parsed.goal : summary
  /**
   * 退化成"只剩 goal"时也要**装得下**（Fix round 2 / 残余 5）。
   *
   * `{"goal":""}` 本身占 11 个字符，所以额度小于它时给不出合法 JSON ——
   * 与其超出去 13 个字符（评审指出的上界漏洞），不如回**空**：
   * "没有摘要"是诚实的状态，而超预算的坏 JSON 不是。
   */
  const fallback = (): string => {
    const candidate = JSON.stringify({ goal: truncateText(goal, Math.max(0, limit - 12)) })
    return candidate.length <= limit ? candidate : ""
  }
  if (parsed === null) return { text: fallback(), reduced: true }

  for (let keep = 0.5; keep >= 0.02; keep /= 2) {
    const candidate = JSON.stringify(Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, shrinkSummaryValue(value, keep)])))
    if (candidate.length <= limit) return { text: candidate, reduced: true }
  }
  return { text: fallback(), reduced: true }
}

/** 数组只留**最近的那几条**（事实/对象都是越新越相关），长字符串截短。 */
function shrinkSummaryValue(value: unknown, keep: number): unknown {
  if (Array.isArray(value)) return value.slice(-Math.max(1, Math.ceil(value.length * keep))).map((entry) => shrinkSummaryValue(entry, keep))
  if (typeof value === "string") return truncateText(value, 120)
  return value
}

function truncateText(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`
}
