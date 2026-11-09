import { MAX_REFERENCE_REPAIRS, MAX_REPAIR_ATTEMPTS } from "./contracts"

/**
 * **计划协议的定向恢复（W5，2026-11-09）**。
 *
 * 这一层只回答一个问题：**这一次失败还值不值得再问模型一次？**
 *
 * 三条判据，各自都有现场来源：
 * 1. **形状错误只修一次**（`MAX_REPAIR_ATTEMPTS`）—— 再问一次它只会把同一句话重说一遍；
 * 2. **引用错误只修一次，并且只准引用这次真实产生的 ID** —— mm-029/mm-055/mm-066/text-190
 *    的共同形态是"引用了一个不存在的工具结果"，而它们要的只是**可引用清单**；
 * 3. **auth / 取消 / 预算用尽永不重问** —— 这几类再发一次请求只会重复收费或重复失败。
 *
 * 决定权放在这里而不是散在协调器里：协调器知道"用了几次""还剩多少钱"，
 * 但"还剩几次"的口径必须只有一份，否则两个分支各自记得别多问一次，总有漏的那次。
 */

export type PlanRecoveryFailure = "schema" | "tool_reference" | "auth" | "cancelled"

export interface PlanRecoveryInput {
  failure: PlanRecoveryFailure
  /** 已用掉的信封修复次数（与引用修复分开计数）。 */
  schemaRepairsUsed: number
  /** 已用掉的引用修复次数。 */
  referenceRepairsUsed: number
  /** 这次运行还能发几次生成请求（来自预算账本，不是猜的）。 */
  callsRemaining: number
  /** 这次运行**真的产生过**的工具结果 ID；引用修复只准从这里选。 */
  availableResultIds: readonly string[]
}

export type PlanRecoveryDecision =
  | { action: "repair"; allowedResultIds: readonly string[]; hint: string }
  | { action: "stop"; reason: string }

const MAX_HINT = 4096

function clamp(text: string): string {
  return text.length <= MAX_HINT ? text : `${text.slice(0, MAX_HINT - 1)}…`
}

/** 供引用修复使用的"可复制 ID 表"：只列真实存在的，并说清顺序与用法。 */
export function describeReferenceRepair(availableResultIds: readonly string[]): string {
  const unique = [...new Set(availableResultIds.filter((id) => typeof id === "string" && id.length > 0))]
  const list = unique.length <= 40 ? unique : unique.slice(0, 40)
  return clamp([
    "这次回答引用了本次运行没有产生的工具结果 ID。",
    `本次运行真实产生的工具结果 ID 只有：${list.length === 0 ? "（没有）" : list.join("、")}${unique.length > list.length ? "（已截断）" : ""}。`,
    "toolResultRefs 里的每一项都必须是上面某一个 ID，不要自己编，也不要用上一次运行或别的话题的 ID。",
    "如果要引用尚未执行的工具结果：先调用那个工具，拿到本次结果后再回答。"
  ].join("\n"))
}

export function decidePlanRecovery(input: PlanRecoveryInput): PlanRecoveryDecision {
  if (input.failure === "auth") return { action: "stop", reason: "auth" }
  if (input.failure === "cancelled") return { action: "stop", reason: "cancelled" }
  if (!Number.isFinite(input.callsRemaining) || input.callsRemaining <= 0) {
    return { action: "stop", reason: "budget_exhausted" }
  }
  if (input.failure === "schema") {
    if (input.schemaRepairsUsed >= MAX_REPAIR_ATTEMPTS) return { action: "stop", reason: "schema_repair_limit" }
    return { action: "repair", allowedResultIds: [], hint: clamp("请只改被拒的字段并按合法形式重发；不要重写整份计划。") }
  }
  if (input.referenceRepairsUsed >= MAX_REFERENCE_REPAIRS) return { action: "stop", reason: "reference_repair_limit" }
  const allowed = [...new Set(input.availableResultIds.filter((id) => typeof id === "string" && id.length > 0))]
  if (allowed.length === 0) return { action: "stop", reason: "no_referenceable_result" }
  return { action: "repair", allowedResultIds: allowed, hint: describeReferenceRepair(allowed) }
}
