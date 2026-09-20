import { describe, expect, it } from "vitest"

import { createBudget, DEFAULT_BUDGET_LIMITS } from "./budget"

/**
 * Task 2.1 Step 2 要求逐条断言计划给出的数字：
 * "4 logical generations, 6 network attempts, 24 tool calls, 32 actions/stage, 128 actions/run,
 * context, time, and geometry budgets **stop the run without head mutation**"。
 *
 * 最后半句的落点在这里：预算**没有文档入参、也不返回文档**，所以它根本不可能改写文档。
 * 真正要守的是"被拒时一个单位都不扣" —— 若先扣再判，被拒的那次会白吃余量，
 * "还能重试几次"从此对不上，协调器会以为还有额度而继续跑。
 */
describe("run budget defaults match the plan", () => {
  it("uses the numbers the plan names", () => {
    expect(DEFAULT_BUDGET_LIMITS.generation).toBe(4)
    expect(DEFAULT_BUDGET_LIMITS.network).toBe(6)
    expect(DEFAULT_BUDGET_LIMITS.tool).toBe(24)
    expect(DEFAULT_BUDGET_LIMITS.actions_per_stage).toBe(32)
    expect(DEFAULT_BUDGET_LIMITS.actions_per_run).toBe(128)
    expect(DEFAULT_BUDGET_LIMITS.context).toBeGreaterThan(0)
    expect(DEFAULT_BUDGET_LIMITS.time).toBeGreaterThan(0)
    expect(DEFAULT_BUDGET_LIMITS.geometry).toBeGreaterThan(0)
  })
})

describe("budget consumption", () => {
  it("stops at the limit and never lets the fifth generation through", () => {
    const budget = createBudget()

    for (let index = 0; index < 4; index += 1) expect(budget.consume("generation").ok).toBe(true)

    const fifth = budget.consume("generation")
    expect(fifth.ok).toBe(false)
    if (!fifth.ok) {
      expect(fifth.reason).toBe("exceeds_limit")
      expect(fifth.remaining).toBe(0)
    }
    expect(budget.remaining("generation")).toBe(0)
  })

  it("does not spend anything on the attempt it refuses", () => {
    // 这条是"先判后扣"的核心：被拒的那次不能白吃余量。
    const budget = createBudget({ network: 3 })
    budget.consume("network", 2)

    const refused = budget.consume("network", 2)

    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.remaining).toBe(1)
    // 仍然是 1，而不是被扣成负数或 0。
    expect(budget.remaining("network")).toBe(1)
  })

  it("lets a request that exactly fits through", () => {
    const budget = createBudget({ tool: 5 })

    expect(budget.consume("tool", 5).ok).toBe(true)
    expect(budget.remaining("tool")).toBe(0)
    expect(budget.consume("tool").ok).toBe(false)
  })

  it("refuses a non-positive or fractional amount instead of silently accepting it", () => {
    // 小数额度会让余量变成非整数，之后"还能跑几步"的判断全部失真。
    const budget = createBudget()

    for (const bad of [0, -1, 1.5, Number.NaN] as const) {
      const decision = budget.consume("tool", bad)
      expect(decision.ok).toBe(false)
      if (!decision.ok) expect(decision.reason).toBe("invalid_amount")
    }
    expect(budget.remaining("tool")).toBe(24)
  })

  it("shares one budget between retry, fallback and repair", () => {
    // 计划原文："retry/fallback/repair share one budget"。
    // 三者都走 `network` / `generation`，不存在各自的计数器。
    const budget = createBudget({ network: 3, generation: 2 })

    expect(budget.consume("network").ok).toBe(true) // 首次请求
    expect(budget.consume("network").ok).toBe(true) // 传输失败后重试
    expect(budget.consume("generation").ok).toBe(true) // 修复用的那次生成
    expect(budget.consume("network").ok).toBe(true) // 降级到别的通道
    expect(budget.consume("network").ok).toBe(false) // 第 4 次网络：超了
    expect(budget.consume("generation").ok).toBe(true) // 生成额度里还剩 1
    expect(budget.consume("generation").ok).toBe(false)
  })
})

describe("per-stage budget", () => {
  it("resets the per-stage action allowance but not the per-run one", () => {
    const budget = createBudget()
    budget.consume("actions_per_stage", 32)
    budget.consume("actions_per_run", 32)
    expect(budget.consume("actions_per_stage").ok).toBe(false)

    budget.beginStage()

    // 新的一次暂存重新拿到 32 个名额……
    expect(budget.remaining("actions_per_stage")).toBe(32)
    // ……但整次运行的名额照旧只减不增。
    expect(budget.remaining("actions_per_run")).toBe(96)
  })

  it("keeps a 128-action run from growing without bound across four stages of 32", () => {
    const budget = createBudget()

    for (let stage = 0; stage < 4; stage += 1) {
      budget.beginStage()
      expect(budget.consume("actions_per_stage", 32).ok).toBe(true)
      expect(budget.consume("actions_per_run", 32).ok).toBe(true)
    }
    // 4 × 32 = 128：正好用尽，第 129 个动作进不来。
    expect(budget.remaining("actions_per_run")).toBe(0)
    expect(budget.consume("actions_per_run").ok).toBe(false)
  })
})

describe("budget snapshot and exhaustion", () => {
  it("reports limits, used and remaining together", () => {
    const budget = createBudget({ tool: 10 })
    budget.consume("tool", 4)

    const snapshot = budget.snapshot()

    expect(snapshot.limits.tool).toBe(10)
    expect(snapshot.used.tool).toBe(4)
    expect(snapshot.remaining.tool).toBe(6)
  })

  it("ignores the per-stage allowance when deciding the run is exhausted", () => {
    // 每次暂存都会重置 per-stage，所以它若参与判断，第一次暂存用满就会误报"运行已耗尽"。
    const budget = createBudget()
    budget.consume("actions_per_stage", 32)

    expect(budget.exhausted()).toBe(false)

    budget.consume("tool", 24)
    expect(budget.exhausted()).toBe(true)
  })
})
