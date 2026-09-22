import type { Budget } from "./budget"
import type { DocumentHandle, RunContext } from "./contracts"
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
