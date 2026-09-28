import { describe, expect, it } from "vitest"

import { AGENT_WORKER_READY, handleAgentRequest } from "./agent.worker"
import { WORKER_SCHEMA_VERSION } from "./workerContracts"

/**
 * **Phase 5 / Task 5.1：Agent worker 入口被明确禁用**，而这一组用例是那个决定的守卫。
 *
 * ## 挡的是什么
 *
 * 这个文件里原本写着 `AGENT_WORKER_READY = true`，而同一个文件对任何消息都回
 * `agent.unavailable` —— **"我准备好了"与"我什么都干不了"同时成立**。
 * 更糟的是它当时没有任何测试，也没有任何消费者：那个 `true` 是一句没人核对、
 * 却随时可能被接进 UI 的空头声明。
 *
 * 所以这里钉的不是"函数返回了东西"，而是**声明与能力必须一致**：
 * 标志为 `false` ⟺ 只回不可用。谁要把标志翻成 `true`，这条用例就会红，
 * 逼他同时把真协调器做出来。
 *
 * 完整决策与判据见 `docs/decisions/2026-09-28-agent-worker-strategy.md`。
 */
describe("agent worker entry point", () => {
  it("reports itself as not ready, matching what it can actually do", () => {
    /**
     * 这一条是 Phase 5 决定的可执行形式。**不要为了让它变绿而改这个期望** ——
     * 正确的做法是先把真协调器搬进这个入口，那时再连同下面那条一起改成新契约。
     */
    expect(AGENT_WORKER_READY).toBe(false)
  })

  it("answers every message with agent.unavailable instead of guessing", () => {
    const response = handleAgentRequest({ requestId: "req-1", kind: "agent.run" })

    expect(response.kind).toBe("agent.unavailable")
    expect(response.schemaVersion).toBe(WORKER_SCHEMA_VERSION)
    expect(response.code).toBe("coordinator_not_implemented")
    // 原因必须是可执行的下一步，而不是一句"失败了"。
    expect(response.detail).toContain("disabled by decision")
    expect(response.detail).toContain("geometry.worker")
  })

  it("echoes the request id so the caller can match the answer to its request", () => {
    // 不回 requestId 的话，主线程分不清这是对哪一条消息的回答（迟到结果会串版）。
    expect(handleAgentRequest({ requestId: "req-42" }).requestId).toBe("req-42")
  })

  it("does not throw or silently drop a malformed message", () => {
    /**
     * 静默会让主线程分不清"worker 没起来"和"这条消息被丢了"；
     * 抛异常穿过 `postMessage` 会变成 `ErrorEvent`，调用方拿不到原因码。
     * 所以畸形输入也要得到一个**结构完整的**不可用回答。
     */
    for (const input of [null, undefined, "garbage", 42, {}, { requestId: 7 }]) {
      const response = handleAgentRequest(input)
      expect(response.kind).toBe("agent.unavailable")
      expect(response.requestId).toBe("")
      expect(response.code).toBe("coordinator_not_implemented")
    }
  })

  it("is not reachable from the production bundle, which is why disabling it is safe", () => {
    /**
     * 这条记录的是决定所依据的一个**可复核事实**：没有任何生产模块 import 这个 entry，
     * 所以 `AGENT_WORKER_READY` 今天没有任何消费者，翻成 `false` 不改变生产行为。
     * （构建产物里只有 `geometry.worker-*.js`，没有 agent worker 的 chunk。）
     *
     * 判据用源码扫描而不是"我记得没人引用" —— 哪天有人把它接进构建，
     * 这条会红，提醒他"禁用"那时就不再是无副作用的决定了。
     *
     * 用 `import.meta.glob` 而不是 `node:fs`：`apps/web` 刻意不装 `@types/node`
     * （见 `docs/current-status.md`「e2e 现在也过类型检查」一节：装了会全局引入并改变
     * 应用侧 `setTimeout` 的类型）。glob 是 Vite 自己在构建期展开的，不需要 node 类型。
     */
    const sources = import.meta.glob("./*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>
    const importers = Object.entries(sources)
      .filter(([path]) => !path.endsWith("/agent.worker.ts") && !path.endsWith("/agentWorker.test.ts"))
      .filter(([, text]) => /from\s+["'][^"']*agent\.worker["']/.test(text) || /import\s*\(\s*["'][^"']*agent\.worker["']/.test(text))
      .map(([path]) => path)

    expect(importers, `these modules import agent.worker: ${importers.join(", ")}`).toEqual([])
  })
})
