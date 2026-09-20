/**
 * **运行预算**（Task 2.1，设计规格 §9 的"预算"一节）。
 *
 * 计划原文："`Budget.consume(kind, amount)` rejects before the limit; retry/fallback/repair share one budget."
 *
 * 三条纪律，逐条都有测试：
 * 1. **先判后扣**：`consume` 在**超过**限制时拒绝，并且**一个单位都不扣**。若先扣再判，
 *    被拒的那一次会白白吃掉余量，"还能重试几次"从此对不上。
 * 2. **重试/降级/修复共用同一份预算**：它们都是 `network` 或 `generation` 的消耗。
 *    给它们各开一个计数器，等于把"总共只能花 6 次网络"变成"每类各 6 次"，
 *    这正是计划要防的失控方式。
 * 3. **不修改文档**：预算只管计数。它**没有**文档入参、也不返回文档 ——
 *    "预算耗尽时头没被动过"这条要靠调用方在拒绝后什么都不做来保证，
 *    所以预算层能做的就是**绝不代替调用方做任何写入**。
 */

export type BudgetKind =
  /** 逻辑生成次数（一次模型往返算一次；修复用掉的是同一次往返的名额）。 */
  | "generation"
  /** 网络尝试（含重试与降级）。 */
  | "network"
  /** 工具调用。 */
  | "tool"
  /** 单次暂存里的动作数（**每次暂存重置**，见 `beginStage`）。 */
  | "actions_per_stage"
  /** 整次运行的动作总数（不重置）。 */
  | "actions_per_run"
  /** 上下文 token 估算。 */
  | "context"
  /** 墙上时间（毫秒）。 */
  | "time"
  /** 几何工作量（内核给出的代价单位，例如采样点数）。 */
  | "geometry"

export interface BudgetLimits {
  generation: number
  network: number
  tool: number
  actions_per_stage: number
  actions_per_run: number
  context: number
  time: number
  geometry: number
}

/**
 * 计划 Step 2 逐字给出的默认值：4 次逻辑生成、6 次网络尝试、24 次工具调用、
 * 每次暂存 32 个动作、整次运行 128 个动作。另有上下文 / 时间 / 几何三项。
 */
export const DEFAULT_BUDGET_LIMITS: BudgetLimits = {
  generation: 4,
  network: 6,
  tool: 24,
  actions_per_stage: 32,
  actions_per_run: 128,
  context: 32_000,
  time: 180_000,
  geometry: 250_000
}

export interface BudgetSnapshot {
  limits: BudgetLimits
  used: BudgetLimits
  remaining: BudgetLimits
}

export type BudgetRejection = {
  ok: false
  kind: BudgetKind
  /** 这次请求的额度。 */
  requested: number
  /** 拒绝时的剩余量（**未被扣减**）。 */
  remaining: number
  reason: "exceeds_limit" | "invalid_amount"
}

export type BudgetDecision = { ok: true; snapshot: BudgetSnapshot } | BudgetRejection

export interface Budget {
  /** 先判后扣：不够就拒绝，且拒绝时不扣任何额度。 */
  consume(kind: BudgetKind, amount?: number): BudgetDecision
  /** 进入下一次暂存：重置 `actions_per_stage`（整次运行的名额不重置）。 */
  beginStage(): void
  remaining(kind: BudgetKind): number
  snapshot(): BudgetSnapshot
  /** 预算是否已经耗尽（供协调器在每一步之前做一次总检查）。 */
  exhausted(): boolean
}

function zeroLimits(): BudgetLimits {
  return { generation: 0, network: 0, tool: 0, actions_per_stage: 0, actions_per_run: 0, context: 0, time: 0, geometry: 0 }
}

export function createBudget(overrides: Partial<BudgetLimits> = {}): Budget {
  const limits: BudgetLimits = { ...DEFAULT_BUDGET_LIMITS, ...overrides }
  const used = zeroLimits()

  const snapshot = (): BudgetSnapshot => {
    const remaining = zeroLimits()
    for (const kind of Object.keys(limits) as BudgetKind[]) remaining[kind] = limits[kind] - used[kind]
    return { limits: { ...limits }, used: { ...used }, remaining }
  }

  return {
    consume(kind, amount = 1) {
      if (!Number.isInteger(amount) || amount <= 0) {
        return { ok: false, kind, requested: amount, remaining: limits[kind] - used[kind], reason: "invalid_amount" }
      }
      const left = limits[kind] - used[kind]
      // 先判后扣：`amount > left` 时直接拒绝，`used` 一个单位都不动。
      if (amount > left) return { ok: false, kind, requested: amount, remaining: left, reason: "exceeds_limit" }
      used[kind] += amount
      return { ok: true, snapshot: snapshot() }
    },

    beginStage() {
      used.actions_per_stage = 0
    },

    remaining(kind) {
      return limits[kind] - used[kind]
    },

    snapshot,

    exhausted() {
      // `actions_per_stage` 每次暂存都会重置，所以它不参与"整次运行是否耗尽"的判断。
      return (["generation", "network", "tool", "actions_per_run", "context", "time", "geometry"] as BudgetKind[]).some((kind) => limits[kind] - used[kind] <= 0)
    }
  }
}
