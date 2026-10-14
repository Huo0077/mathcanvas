import { describe, expect, it } from "vitest"

import { createBudget, DEFAULT_BUDGET_LIMITS } from "./budget"
import { MAX_PLAN_ATTEMPTS } from "./coordinator"

/**
 * Task 2.1 Step 2 要求逐条断言计划给出的数字：
 * "4 logical generations, 6 network attempts, 24 tool calls, 32 actions/stage, 128 actions/run,
 * context, time, and geometry budgets **stop the run without head mutation**"。
 *
 * 最后半句的落点在这里：预算**没有文档入参、也不返回文档**，所以它根本不可能改写文档。
 * 真正要守的是"被拒时一个单位都不扣" —— 若先扣再判，被拒的那次会白吃余量，
 * "还能重试几次"从此对不上，协调器会以为还有额度而继续跑。
 *
 * **2026-10-14：`generation` 一项**按现场读数由 4 修订为 6**（其余数字仍是计划原文）。
 * 修订的理由在下面那条不变量用例里 —— 它把预算与协调器的修复额度直接挂钩，
 * 而不是再写死一个数字。
 */
describe("run budget defaults match the plan", () => {
  it("uses the numbers the plan names", () => {
    expect(DEFAULT_BUDGET_LIMITS.generation, "2026-10-14 由 4 修订为 6：只读工具轮要多花一次生成").toBe(6)
    expect(DEFAULT_BUDGET_LIMITS.network).toBe(6)
    expect(DEFAULT_BUDGET_LIMITS.tool).toBe(24)
    expect(DEFAULT_BUDGET_LIMITS.actions_per_stage).toBe(32)
    expect(DEFAULT_BUDGET_LIMITS.actions_per_run).toBe(128)
    expect(DEFAULT_BUDGET_LIMITS.context).toBeGreaterThan(0)
    expect(DEFAULT_BUDGET_LIMITS.time).toBeGreaterThan(0)
    expect(DEFAULT_BUDGET_LIMITS.geometry).toBeGreaterThan(0)
  })

  /**
   * **代际预算必须装得下"前三次尝试都读一次场景"**（2026-10-14，用户现场）。
   *
   * 每一次尝试在正常情况下花**两次生成**：一次提问、一次带着工具结果再问。
   * 数字**算出来**而不是再抄一遍：谁把修复额度加一次，这条用例就会红，
   * 逼着同一个人回答"那代际给几代"。
   *
   * ## 为什么是"前三次"而不是"每一次"（这条残余缺口是**有意留的**）
   *
   * 协调器最多允许 `MAX_PLAN_ATTEMPTS` 次（首次 + 信封修复 + 编译修复 **两次** = 4）。
   * 若按"每一次都读场景"配，默认得抬到 **8**，而网络账本也要跟着抬到 8 ——
   * 那是把计划里的两个数字一起翻倍，比用户 2026-10-14 批准的那一档（4 → 6，
   * 与 `network` 对齐）大得多。所以这里取**恰好装得下前三次**：
   * 用户现场那条路（计划①→读场景→编译被拒→修复读场景→出计划）在第 4 代就齐了，
   * 真实的三维修复也基本落在三次以内。**第 4 次若还要读场景，就停在预算上** ——
   * 这是有意的：宁可停在一轮有界的地方，也不为最坏情况把默认抬上去。
   * 下面第二条断言把那 2 代的余量**明写出来**，免得日后有人以为它是笔误。
   */
  it("代际预算装得下“前三次尝试各读一次场景”（并与网络账本对齐）", () => {
    expect(
      DEFAULT_BUDGET_LIMITS.generation,
      `协调器最多 ${MAX_PLAN_ATTEMPTS} 次尝试，每次最多 2 次生成（提问 + 用工具结果）；默认按“前三次”配`
    ).toBeGreaterThanOrEqual((MAX_PLAN_ATTEMPTS - 1) * 2)
    expect(
      MAX_PLAN_ATTEMPTS * 2 - DEFAULT_BUDGET_LIMITS.generation,
      "最坏情况（四次尝试都读场景）需要这么多代，而现在**有意**不给：第 4 次会停在预算上"
    ).toBe(2)
    expect(DEFAULT_BUDGET_LIMITS.network, "每一次网络往返必然是一次生成，所以网络不该比代际更松").toBeGreaterThanOrEqual(DEFAULT_BUDGET_LIMITS.generation)
  })
})

describe("budget consumption", () => {
  it("stops at the limit and never lets one generation past it", () => {
    const budget = createBudget()

    // 用**上限本身**驱动，而不是再抄一个数：改默认值时这条用例跟着走，语义不变。
    const limit = DEFAULT_BUDGET_LIMITS.generation
    for (let index = 0; index < limit; index += 1) expect(budget.consume("generation").ok).toBe(true)

    const past = budget.consume("generation")
    expect(past.ok).toBe(false)
    if (!past.ok) {
      expect(past.reason).toBe("exceeds_limit")
      expect(past.remaining).toBe(0)
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
