import type { SolveResult, SolveStatus } from "@draw/agent-core"

/**
 * **交付徽标（W9，2026-11-09）**。
 *
 * 只认宿主侧的两样东西：`SolveResult.status` 与 `SolveResult.evidence`。
 * **绝不**从正文里找"已验证 / 成立 / 答案"这类词 —— 那句话模型可以随便写。
 *
 * 四档语义（与产品的四句话一一对应）：
 * - `verified`：必答目标**全部**有 `verified_instance` 证据，且交付状态是 answered；
 * - `partial`：有证据但没盖满必答目标（两问只核验一问 → 只能是 partial）；
 * - `unverified`：没有可用证据（旧消息、`sampled` 采样、只有正文）；
 * - `failed`：有目标被**否证**，或交付状态本身是失败/不一致。
 *
 * `sampled` **不算** verified：采样通过不是核验，界面上必须继续显示未核验。
 */

export type DeliveryBadge = "verified" | "partial" | "unverified" | "failed"

export interface DeliveryBadgeInput {
  status: SolveStatus
  requiredGoals: number
  verifiedGoals: number
  refutedGoals: number
}

export function deliveryBadge(input: DeliveryBadgeInput): DeliveryBadge {
  if (input.refutedGoals > 0) return "failed"
  if (input.status === "failed" || input.status === "inconsistent") return "failed"
  if (input.status === "needs_clarification" || input.status === "unsupported") return "unverified"
  if (input.requiredGoals <= 0) return "unverified"
  if (input.verifiedGoals <= 0) return "unverified"
  if (input.verifiedGoals < input.requiredGoals) return "partial"
  return input.status === "answered" ? "verified" : "partial"
}

export interface DeliverySummary {
  badge: DeliveryBadge
  requiredGoals: number
  verifiedGoalIds: string[]
  sampledGoalIds: string[]
  refutedGoalIds: string[]
  unverifiedGoalIds: string[]
  missingGoalIds: string[]
}

/** 只保留 `verified_instance` 作为"已核验"；`sampled` 与其余状态都算未核验。 */
export function deliverySummary(result: SolveResult): DeliverySummary {
  const requiredGoalIds = [...new Set([...result.answers.map((answer) => answer.goalId), ...result.unansweredGoalIds])]
  const verified = new Set<string>()
  const sampled = new Set<string>()
  const refuted = new Set<string>()
  for (const record of result.evidence) {
    if (!requiredGoalIds.includes(record.goalId)) continue
    if (record.evidence.status === "verified_instance") verified.add(record.goalId)
    else if (record.evidence.status === "sampled") sampled.add(record.goalId)
    else if (record.evidence.status === "failed") refuted.add(record.goalId)
  }
  const answered = new Set(result.answers.map((answer) => answer.goalId))
  const missing = requiredGoalIds.filter((goalId) => !answered.has(goalId))
  const unverified = requiredGoalIds.filter((goalId) => !verified.has(goalId) && !sampled.has(goalId) && !refuted.has(goalId))
  return {
    badge: deliveryBadge({ status: result.status, requiredGoals: requiredGoalIds.length,
      verifiedGoals: verified.size, refutedGoals: refuted.size }),
    requiredGoals: requiredGoalIds.length,
    verifiedGoalIds: [...verified],
    sampledGoalIds: [...sampled],
    refutedGoalIds: [...refuted],
    unverifiedGoalIds: unverified,
    missingGoalIds: missing
  }
}

export const DELIVERY_BADGE_LABEL: Record<DeliveryBadge, string> = {
  verified: "已核验（逐问）",
  partial: "部分核验",
  unverified: "未核验",
  failed: "核验未通过"
}
