import { describe, expect, it } from "vitest"

import { advanceToolLoop, decideToolLoop, DEFAULT_TOOL_LOOP_POLICY, INITIAL_TOOL_LOOP_PROGRESS, type ToolLoopPolicy } from "./toolLoop"

/**
 * **有限轮次的"观察—行动"策略**（Phase 2 / Task 2.2）。
 *
 * 这一组用例的判据是**循环不会失控**，而且失控的每一种方式都要有名字：
 * 没有工具调用 / 全是重复 / 额度用尽（并说清是哪一格）。
 */

const policy: ToolLoopPolicy = { maxRounds: 3, maxToolCalls: 5, maxCallsPerRound: 2 }

describe("the tool loop is bounded", () => {
  it("stops when the model asked for no tools, because that round is the endpoint", () => {
    // 一轮没有工具调用的往返就是终点：它要么给了计划，要么给了澄清/只读回答。
    // 继续问下去只是在烧预算。
    expect(decideToolLoop(policy, INITIAL_TOOL_LOOP_PROGRESS, [])).toEqual({ action: "stop", reason: "no_tool_calls" })
  })

  it("executes a fresh batch and returns to the model", () => {
    expect(decideToolLoop(policy, INITIAL_TOOL_LOOP_PROGRESS, ["call-1", "call-2"])).toEqual({ action: "call", callIds: ["call-1", "call-2"] })
  })

  it("stops idempotently when every requested call was already executed", () => {
    /**
     * 模型重发同一批 `toolCallId` 时**不能**再执行一次 ——
     * 那会让同一笔动作落两遍。这与 `draftStore` 的"同一个 alias 永远同一个 id"
     * 是同一条纪律的另一面。
     */
    const after = advanceToolLoop(INITIAL_TOOL_LOOP_PROGRESS, ["call-1"])
    expect(decideToolLoop(policy, after, ["call-1"])).toEqual({ action: "stop", reason: "all_calls_duplicate" })
  })

  it("executes only the new calls when a retry mixes old and new ids", () => {
    // 只要还有新的就继续，但**只执行新的那些**（老的再执行一次就是重复落盘）。
    const after = advanceToolLoop(INITIAL_TOOL_LOOP_PROGRESS, ["call-1"])
    expect(decideToolLoop(policy, after, ["call-1", "call-2"])).toEqual({ action: "call", callIds: ["call-2"] })
  })

  it("stops when the round budget is spent, and names that limit", () => {
    const spent = advanceToolLoop(advanceToolLoop(advanceToolLoop(INITIAL_TOOL_LOOP_PROGRESS, ["a"]), ["b"]), ["c"])
    expect(spent.roundsUsed).toBe(3)
    expect(decideToolLoop(policy, spent, ["d"])).toEqual({ action: "stop", reason: "budget_exhausted", limit: "rounds" })
  })

  it("stops when a single batch is larger than one round allows", () => {
    // 一批过大不是"分几次执行"，而是**这一轮不合理**：如实停下并说清是哪一格。
    expect(decideToolLoop(policy, INITIAL_TOOL_LOOP_PROGRESS, ["a", "b", "c"])).toEqual({ action: "stop", reason: "budget_exhausted", limit: "calls_per_round" })
  })

  it("stops when the total tool-call budget would be exceeded", () => {
    const nearly = advanceToolLoop(INITIAL_TOOL_LOOP_PROGRESS, ["a", "b"])
    const more = advanceToolLoop(nearly, ["c", "d"])
    expect(more.toolCallsUsed).toBe(4)
    // 再来两个刚好到 6 > 上限 5。
    expect(decideToolLoop(policy, more, ["e", "f"])).toEqual({ action: "stop", reason: "budget_exhausted", limit: "tool_calls" })
    // 而只来一个就还在额度内。
    expect(decideToolLoop(policy, more, ["e"])).toEqual({ action: "call", callIds: ["e"] })
  })

  it("counts only newly executed calls, so duplicates never inflate the budget", () => {
    // 重复调用若也进账，"额度"就会被重发耗光，而真正的动作一次都没多做。
    const once = advanceToolLoop(INITIAL_TOOL_LOOP_PROGRESS, ["call-1"])
    const twice = advanceToolLoop(once, [])
    expect(twice.toolCallsUsed).toBe(1)
    expect(twice.roundsUsed).toBe(2)
  })

  it("keeps rounds and calls as separate counters", () => {
    // 一轮可以带多个调用：轮数只涨 1，调用数涨这一批的数量。
    const progress = advanceToolLoop(INITIAL_TOOL_LOOP_PROGRESS, ["a", "b"])
    expect(progress.roundsUsed).toBe(1)
    expect(progress.toolCallsUsed).toBe(2)
    expect(progress.executedCallIds).toEqual(["a", "b"])
  })

  it("ships defaults in the same order of magnitude as the run budget", () => {
    // 默认值不读 `DEFAULT_BUDGET_LIMITS`（调用方负责对齐，见模块头注释），
    // 但它必须与那份预算同量级 —— 差一个数量级会让默认值变成事实上的唯一闸。
    expect(DEFAULT_TOOL_LOOP_POLICY.maxToolCalls).toBeLessThanOrEqual(24)
    expect(DEFAULT_TOOL_LOOP_POLICY.maxRounds).toBeLessThanOrEqual(4)
    expect(DEFAULT_TOOL_LOOP_POLICY.maxRounds).toBeGreaterThan(0)
  })
})
