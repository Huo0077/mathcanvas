import { WORKER_SCHEMA_VERSION } from "./workerContracts"

/**
 * **Agent worker 入口：按决定禁用**（Phase 5 / Task 5.1）。
 *
 * Task 5.1 要求在这两条之间做一个**明确**决定：实现真实的 Worker 协调器，
 * 或者明确禁用这个入口。这里选后者，完整判据见
 * `docs/decisions/2026-09-28-agent-worker-strategy.md`，摘要三条：
 *
 * 1. **重的那一半已经搬出去了。** 真正会卡主线程的是几何编译 —— 实测在约 2800 图元的
 *    真实文档上要 **73 ms**，而它已经在 `geometry.worker.ts` 里跑（产物 298.8 kB，
 *    见 `build-check/`）。协调器本身是状态机 + 账本，没有同等量级的计算。
 * 2. **搬协调器的代价是第二份真源。** 运行账本 / 撤销 / 预算 / 一次性同意目前都在主线程的
 *    `agentRunner` 里；搬进 Worker 要么把这些状态也搬过去（两份状态机），
 *    要么把每次工具调用都过一遍消息边界 —— 而后者的收益没有任何读数支持。
 * 3. **这个文件从来没有进过构建产物。** 没有任何模块 import 它，`build-check/` 里只有
 *    `geometry.worker-*.js`。也就是说它今天既不是生产路径，也没有被构建。
 *
 * ## 为什么保留代码而不是删掉
 *
 * 消息边界（五个信封字段、未知 kind 丢弃并诊断、失败一律回响应）是**已经定好并有测试**的
 * 契约，而它是"模型侧与文档侧被一条消息边界隔开"这条安全性质的落点。
 * 删掉等于删掉那份契约；保留它、并把"不可用"如实说出来，是更小也更安全的一步。
 *
 * ## 判据（由 `agentWorker.test.ts` 钉住）
 *
 * 真协调器落地之前：`AGENT_WORKER_READY` 必须是 `false`，且 `handleAgentRequest` 只能回
 * `agent.unavailable`。谁把标志翻成 `true`，谁就必须同时让这个函数真的干活 ——
 * 否则 UI 会去广告一个**每次都失败**的能力，而"声明了却没接上"比没有这个声明更危险。
 */

export const AGENT_WORKER_READY = false

export interface AgentUnavailableResponse {
  kind: "agent.unavailable"
  schemaVersion: string
  requestId: string
  code: string
  detail: string
}

/**
 * 对任何消息的唯一回答。**不抛异常、不沉默**：
 * 沉默会让主线程分不清"worker 没起来"和"这条消息被丢了"；
 * 抛异常穿过 `postMessage` 会变成 `ErrorEvent`，调用方拿不到原因码。
 *
 * 处理逻辑刻意与 `self.onmessage` 分开（与 `workerRuntime.ts` 同一条理由）：
 * 在 worker 全局里写业务逻辑的代价是它在 jsdom 里跑不起来，那段判断就永远没有测试。
 */
export function handleAgentRequest(input: unknown): AgentUnavailableResponse {
  const value = (input as { requestId?: unknown } | null)?.requestId
  return {
    kind: "agent.unavailable",
    schemaVersion: WORKER_SCHEMA_VERSION,
    requestId: typeof value === "string" ? value : "",
    code: "coordinator_not_implemented",
    detail: "the Agent worker entry point is disabled by decision (docs/decisions/2026-09-28-agent-worker-strategy.md); the run coordinator executes on the main thread and geometry compilation runs in geometry.worker"
  }
}

/**
 * worker 接线。**只在真的作为 worker 被加载时执行** —— 判据是 `self` 存在。
 *
 * 这一句不是防御性编程的洁癖：`agentWorker.test.ts` 要 import 上面那个纯函数，
 * 而在 jsdom 里**没有全局 `self`**，无保护的顶层赋值会让那份测试根本跑不起来。
 * 结果是这个文件又会回到"没有任何测试"的状态 —— 那正是这次决定要修掉的问题。
 */
if (typeof self !== "undefined") {
  self.onmessage = (event: MessageEvent<unknown>) => {
    self.postMessage(handleAgentRequest(event.data))
  }
}
