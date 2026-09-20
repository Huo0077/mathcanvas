import { WORKER_SCHEMA_VERSION } from "./workerContracts"

/**
 * **Agent worker**（Task 0.8）。
 *
 * 它将来跑的是协调器（Task 2.1 的状态机与运行账本），**现在只接线**。
 *
 * 为什么先只接线、而不是先写一个假的协调器：这个边界存在的意义是"模型侧与文档侧被一条
 * 消息边界隔开"，而边界的形状（五个信封字段、未知 kind 丢弃并诊断、失败一律回响应）
 * 已经在 `workerContracts.ts` 里定好并有测试。真正的状态机属于 G2；在这里先塞一个
 * "看起来能跑"的循环，会让后面替换它时不得不先拆掉一套假的运行语义。
 *
 * **它现在对任何消息都回 `agent.unavailable`**，而不是沉默：静默会让主线程分不清
 * "worker 没起来"和"这条消息被丢了"。
 */
export const AGENT_WORKER_READY = true

function requestIdOf(input: unknown): string {
  const value = (input as { requestId?: unknown } | null)?.requestId
  return typeof value === "string" && value.length > 0 ? value : ""
}

self.onmessage = (event: MessageEvent<unknown>) => {
  self.postMessage({
    kind: "agent.unavailable",
    schemaVersion: WORKER_SCHEMA_VERSION,
    requestId: requestIdOf(event.data),
    code: "coordinator_not_implemented",
    detail: "the run coordinator (Task 2.1) is not implemented yet; only the message boundary exists"
  })
}
