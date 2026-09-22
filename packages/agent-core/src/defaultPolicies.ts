import { auditEntryFor, type ActionAuditDescription } from "./schemas"
import type { PlanDefaultPolicy, WorkspaceId } from "./contracts"

/**
 * **默认策略的读取口**（Agent DSL 切片 Task 2；规格 §6.3）。
 *
 * 策略本身**只有一份**：传输层的动作登记表（`schemas.ts` 的 `ACTIONS`）。
 * 这个文件不做第二份策略表，它只做三件登记表自己做不了的事：
 *
 * 1. **把"缺了怎么办"读成结构化结果**（登记表里的字段是给人看的字面量）；
 * 2. **从用户原话里读数字**（`infer_from_facts` 的落点）—— 判据刻意窄：
 *    数字必须**紧挨着关键词**（"高 5"、"棱长 3"）。不做自然语言理解，
 *    因为"从一句话里猜尺寸"猜错的代价是替用户改了一道题，而猜对的收益只是少问一句；
 * 3. **审计上下文**（文档、工作区、已知参数、用户原话）的形状定义。
 */

export interface AuditContext {
  documentId: string
  workspace: WorkspaceId
  /** 用户的原话（`infer_from_facts` 与"任意/恒定/定值"这类要求都要看它）。 */
  prompt?: string
  /** 已确认事实（模型上下文里的那几条）；只读文本，不当作几何真源。 */
  facts?: readonly { id: string; text: string }[]
  /** 文档里已经存在的参数 id（`parameterId` 的悬空引用在编译期还要再查一次）。 */
  parameters?: readonly string[]
  /** 文档里已经存在的图元 id（引用解析用）。 */
  existingIds?: readonly string[]
}

/** 一个字段**最终会被怎么处理**（给定的、回填的、要问的、被拒的）。 */
export interface FieldPolicyReading {
  field: string
  policy: PlanDefaultPolicy
  value?: unknown
  reason?: string
  question?: string
  infer?: "size" | "height" | "label" | "position"
  /** 变体条件（`appliesWhen`）：只看同动作里另一个已给的字段取值。 */
  appliesWhen?: { field: string; in: readonly string[] }
}

/** 这个动作的必填字段（没有它动作不成立）。未登记的动作返回空数组（审计另外报 unknown）。 */
export function requiredFieldsFor(actionId: string): readonly string[] {
  return auditEntryFor(actionId)?.required ?? []
}

/** 这个动作的字段策略（只含"缺了会怎么办"的字段，不给就是普通可选字段）。 */
export function fieldPoliciesFor(actionId: string): readonly FieldPolicyReading[] {
  const entry: ActionAuditDescription | null = auditEntryFor(actionId)
  return entry === null ? [] : entry.defaults.map((policy) => ({ ...policy }))
}

export function auditDescriptionFor(actionId: string): ActionAuditDescription | null {
  return auditEntryFor(actionId)
}

/** 关键词 → 要读的字段类别。**窄判据**：只认这几种说法，别的都走回退值。 */
const INFER_KEYWORDS: Record<NonNullable<FieldPolicyReading["infer"]>, readonly string[]> = {
  size: ["棱长", "边长", "size", "edge"],
  height: ["高", "height"],
  label: [],
  position: []
}

const NUMBER_PATTERN = /\d+(?:\.\d+)?/g

/**
 * 从一句话里读出**紧挨着关键词**的那个正数。
 *
 * 返回 `null` 表示"这句话里没说"，调用方据此走回退值或提问。
 * 刻意不做"取第一个数字"：`画一个半径 2、高 5 的圆柱` 里第一个数字是 2，
 * 而它属于半径 —— 那正是"猜错一个字段就改掉一道题"的典型。
 */
export function inferNumberFromText(text: string, infer: NonNullable<FieldPolicyReading["infer"]>): number | null {
  const keywords = INFER_KEYWORDS[infer]
  if (!text || keywords.length === 0) return null
  const lowered = text.toLowerCase()

  for (const keyword of keywords) {
    let from = 0
    for (;;) {
      const at = lowered.indexOf(keyword.toLowerCase(), from)
      if (at === -1) break
      // 关键词之后紧跟的数字优先（"高 5"、"棱长 3"）。
      const after = text.slice(at + keyword.length, at + keyword.length + 12).match(NUMBER_PATTERN)
      if (after) {
        const value = Number(after[0])
        if (Number.isFinite(value) && value > 0) return value
      }
      // 其次看关键词**之前**那一个（"5 高的圆柱"）。
      const before = text.slice(Math.max(0, at - 12), at).match(NUMBER_PATTERN)
      if (before) {
        const value = Number(before[before.length - 1])
        if (Number.isFinite(value) && value > 0) return value
      }
      from = at + keyword.length
    }
  }
  return null
}
