/**
 * **有限轮次的"观察—行动"策略**（Phase 2 / Task 2.2）。
 *
 * ## 为什么它是一个纯决策、而不是循环本身
 *
 * 计划要求把运行改成"每轮最多执行一个有限工具调用批次，工具结果返回给模型继续决策"。
 * 但"什么时候还能再来一轮"**不是一个编排问题，而是一组判据**：
 * 预算还剩多少、这一轮模型有没有真的要求调工具、上一次是不是同一个调用重复了。
 *
 * 把这组判据抽出来单独测，就能回答"循环会不会失控"这个问题 ——
 * 而把它写进协调器里，只能靠跑完一整个运行才知道。
 *
 * ## 三条判据（逐条有测试）
 *
 * 1. **模型没有要求调工具 → 停**。一轮没有工具调用的往返就是终点：
 *    它要么给出了计划，要么给了澄清或只读回答。继续问下去只是在烧预算。
 * 2. **同一批次重复出现 → 停**。模型重发同一个 `toolCallId` 时必须**幂等**，
 *    而不是再执行一次（那会让同一笔动作落两次）。这条与 `draftStore` 的
 *    "同一个 alias 永远同一个 id" 是同一条纪律的另一面。
 * 3. **预算用尽 → 停，并说清是哪一格**。判据用的是已经存在的那份预算
 *    （`generation` / `network` / `tool`），**不新开计数器** ——
 *    给工具循环单独开一份额度，等于把"整次运行只能花 6 次网络"变成"每类各 6 次"，
 *    那正是计划要防的失控方式（`budget.ts` 的头注释写着这条）。
 *
 * ## 为什么上限是**调用方给的**
 *
 * `maxToolCalls` / `maxRounds` 由调用方传进来，而不是在这里写死：
 * 门禁（`verificationGate`）与预算是两个独立的闸，硬编码第二份限额会让
 * "为什么这次只跑了两轮"变成一个没有依据的数字。
 */

/** 工具循环的额度。由调用方从**同一份预算**里推导，而不是另开一份。 */
export interface ToolLoopPolicy {
  /** 整轮允许的往返次数（每次往返 = 一次生成）。 */
  maxRounds: number
  /** 整轮允许的工具调用总数。 */
  maxToolCalls: number
  /** 单次往返里允许的工具调用数（一批）。 */
  maxCallsPerRound: number
}

/** 默认额度：与 `DEFAULT_BUDGET_LIMITS` 同量级，但**不读它** —— 由调用方对齐（见文件头）。 */
export const DEFAULT_TOOL_LOOP_POLICY: ToolLoopPolicy = { maxRounds: 4, maxToolCalls: 24, maxCallsPerRound: 8 }

/** 一轮往返之后，循环的进展。 */
export interface ToolLoopProgress {
  roundsUsed: number
  toolCallsUsed: number
  /** 已经执行过的 `toolCallId`（用于幂等：重发不再执行）。 */
  executedCallIds: readonly string[]
}

export const INITIAL_TOOL_LOOP_PROGRESS: ToolLoopProgress = { roundsUsed: 0, toolCallsUsed: 0, executedCallIds: [] }

export type ToolLoopDecision =
  /** 这一轮可以执行这些调用，然后回到模型。 */
  | { action: "call"; callIds: readonly string[] }
  /** 模型没有要求调工具 —— 这一轮的产物就是终点。 */
  | { action: "stop"; reason: "no_tool_calls" }
  /** 这一轮的调用全是重复的（都已执行过）—— 幂等地停下，而不是再执行一次。 */
  | { action: "stop"; reason: "all_calls_duplicate" }
  /** 额度用尽。`limit` 说清是哪一格，供协调器落到 `failed`/`waiting` 时说真话。 */
  | { action: "stop"; reason: "budget_exhausted"; limit: "rounds" | "tool_calls" | "calls_per_round" }

/**
 * **一次往返之后的决定**。参数刻意是"这一轮模型要求调哪些" + "此前进展到哪"，
 * 而不是整个运行状态 —— 这样每一条判据都能用一行输入钉住。
 */
export function decideToolLoop(
  policy: ToolLoopPolicy,
  progress: ToolLoopProgress,
  requestedCallIds: readonly string[]
): ToolLoopDecision {
  if (requestedCallIds.length === 0) return { action: "stop", reason: "no_tool_calls" }

  /**
   * 重复先判：模型重发同一个 `toolCallId` 时，**全部**都已执行过才停。
   * 只要还有新的，就继续（新调用仍然要执行），但只执行**新的**那些 ——
   * 再执行一次老的会让同一笔动作落两遍。
   */
  const fresh = requestedCallIds.filter((id) => !progress.executedCallIds.includes(id))
  if (fresh.length === 0) return { action: "stop", reason: "all_calls_duplicate" }

  if (progress.roundsUsed >= policy.maxRounds) return { action: "stop", reason: "budget_exhausted", limit: "rounds" }
  if (fresh.length > policy.maxCallsPerRound) return { action: "stop", reason: "budget_exhausted", limit: "calls_per_round" }
  if (progress.toolCallsUsed + fresh.length > policy.maxToolCalls) return { action: "stop", reason: "budget_exhausted", limit: "tool_calls" }

  return { action: "call", callIds: fresh }
}

/** 执行完之后推进进展。**只记新执行的那些**（重复的不进账）。 */
export function advanceToolLoop(progress: ToolLoopProgress, executedCallIds: readonly string[]): ToolLoopProgress {
  return {
    roundsUsed: progress.roundsUsed + 1,
    toolCallsUsed: progress.toolCallsUsed + executedCallIds.length,
    executedCallIds: [...progress.executedCallIds, ...executedCallIds]
  }
}
