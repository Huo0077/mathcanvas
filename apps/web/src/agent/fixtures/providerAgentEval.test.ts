import { describe, expect, it } from "vitest"

import { createLocalPlanner } from "../localPlanner"
import type { ProviderResolution } from "../modelPlanner"
import { AGENT_TASK_FIXTURES } from "./agentTaskFixtures"
import { runProviderAgentEval } from "./providerAgentEval"

/**
 * **真实 provider 的评测 harness**（用户 2026-10-05 裁决的方案 C：把 harness 搬进应用内跑）。
 *
 * 它解决的是发布门禁第 2 条：`real_provider` 那一栏今天整批 `not measured`。
 * 走的是**用户那条路**（`createModelPlanner` → 回环代理 → provider，密钥从凭据库借出），
 * 所以**密钥不进环境变量、不落文件** —— 这正是它比"脚本自己发请求"更对的地方。
 *
 * 这一组用例守三件事，**每一件都是"不许把没测的东西说成测过了"的同一族**：
 *
 * 1. **取不到 provider 时：如实报 `not measured` + 原因码，而且一次请求都不发** ——
 *    没配 provider 就发请求，既浪费钱又会让"没测"变成"测了但没数"；
 * 2. **解析成功时把同一套 fixture 跑满轮数**，分数由既有的 `scoreAgentAttempts` 算
 *（planner 是注入的，所以用例确定，不打网络）；
 * 3. **成本不许编**：这条通道里有 `usage`（token 数），但**仓里没有价目表** ——
 *    所以 `costUsd` 一律缺省，报告里显示 `not measured`，而不是拿一个猜出来的钱数充数。
 */
describe("真实 provider 评测 harness（C）", () => {
  const resolved = {
    ok: true,
    provider: { id: "p-eval", modelId: "m-eval", dialect: "openai", revision: 1, capabilities: {} as never }
  } as ProviderResolution

  it("取不到 provider ⇒ 如实报 not measured + 原因码，且**一次请求都不发**", async () => {
    let planned = 0
    const result = await runProviderAgentEval(1, {
      resolveProvider: async () => ({ ok: false, code: "no_active_profile", detail: "还没有选择「使用中」的模型服务" }),
      createPlanner: () => ({ plan: async () => { planned += 1; throw new Error("没配 provider 就不该发请求") } })
    })

    expect(result.scorecard).toBeNull()
    expect(result.provider).toBeNull()
    expect(result.unavailable?.code).toBe("no_active_profile")
    expect(planned).toBe(0)
  })

  it("解析成功 ⇒ 把同一套 fixture 跑满轮数并算出分数", async () => {
    const result = await runProviderAgentEval(1, { resolveProvider: async () => resolved, createPlanner: () => createLocalPlanner() })

    expect(result.attempts).toHaveLength(AGENT_TASK_FIXTURES.length)
    expect(result.scorecard?.passAt1?.total).toBe(AGENT_TASK_FIXTURES.length)
    expect(result.provider?.modelId).toBe("m-eval")
    expect(result.unavailable).toBeNull()
  })

  it("**成本不许编**：没有价目表 ⇒ 每次尝试都不带 costUsd（报告会写 not measured）", async () => {
    const result = await runProviderAgentEval(1, { resolveProvider: async () => resolved, createPlanner: () => createLocalPlanner() })

    expect(result.attempts.every((attempt) => attempt.costUsd === undefined)).toBe(true)
    expect(result.scorecard?.averageCostUsd).toBeNull()
  })

  it("延迟有数（真实 provider 这一栏今天真能给的两个数之一）", async () => {
    const result = await runProviderAgentEval(1, { resolveProvider: async () => resolved, createPlanner: () => createLocalPlanner() })

    expect(result.scorecard?.averageLatencyMs).toBeGreaterThanOrEqual(0)
  })
})
