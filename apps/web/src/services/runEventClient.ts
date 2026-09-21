/**
 * **运行账本客户端**（Task 2.6 的前端那一半）。
 *
 * Rust 侧的三条命令（`append_run_event` / `read_run_events` / `run_event_count`）在这一层
 * 被包成前端能用的形状。三条纪律，与前几个客户端一致：
 *
 * 1. **在浏览器里跑是正常状态**（`no_desktop_shell`），不是错误 —— 账本住在项目库里，
 *    而浏览器里没有项目库。所以这里**不抛异常**：抛出去会让"在浏览器里跑"看起来像故障。
 * 2. **"没有外壳"与"IPC 失败"分开报**：前者是预期，后者要么修要么让人知道。
 * 3. **事件形状由 Rust 侧定死**。这个文件只负责搬运 —— `RunEventInput` 带
 *    `deny_unknown_fields`，多一个字段会被**拒绝**（计划要求账本绝不存模型推理与图像字节），
 *    所以这里也**不组装**任何额外字段。
 */

import { invokeDesktop, NoDesktopShellError } from "./desktopRuntime"

export type LedgerResult<T> =
  | { ok: true; value: T }
  /** 预期状态：这是浏览器，没有项目库。 */
  | { ok: false; code: "no_desktop_shell"; detail: string }
  /** 真的出错了，要有人知道。 */
  | { ok: false; code: "ipc_failed"; detail: string }

/** 一条事件的**全部**字段。与 Rust 侧的 `RunEventInput` 一一对应。 */
export interface RunEventInput {
  eventId: string
  runId: string
  conversationId: string
  phase: string
  status: string
  /** 一句话说明。**Rust 侧会在落盘前脱敏**，所以这里不必（也不该）自己拼脱敏逻辑。 */
  detail: string
  at: number
  promptMessageId?: string
  requestId?: string
  attemptId?: string
  draftVersion?: number
  versions?: { capabilityRevision: string; policyRevision: string }
  usage?: { inputTokens?: number; outputTokens?: number }
}

export interface RunEventRecord {
  eventId: string
  runId: string
  payload: unknown
  createdAt: number
}

async function asResult<T>(run: () => Promise<T>): Promise<LedgerResult<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    if (error instanceof NoDesktopShellError) return { ok: false, code: "no_desktop_shell", detail: error.message }
    return { ok: false, code: "ipc_failed", detail: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * **追加一条事件**。
 *
 * 返回值里那个布尔是"这次真的写了一行吗"：同一个 `eventId` 第二次是 `false`
 *（幂等，**不是错误** —— 重试与重启后的补写都会走到这里）。
 */
export async function appendRunEvent(event: RunEventInput): Promise<LedgerResult<boolean>> {
  return asResult(async () => (await invokeDesktop<unknown>("append_run_event", { event })) === true)
}

/** 读一条运行的事件（有界、按写入顺序）。 */
export async function readRunEvents(runId: string): Promise<LedgerResult<RunEventRecord[]>> {
  return asResult(async () => {
    const raw = await invokeDesktop<unknown>("read_run_events", { runId })
    return Array.isArray(raw) ? (raw as RunEventRecord[]) : []
  })
}

/** 账本里一共多少条。 */
export async function runEventCount(): Promise<LedgerResult<number>> {
  return asResult(async () => {
    const raw = await invokeDesktop<unknown>("run_event_count")
    return typeof raw === "number" ? raw : 0
  })
}
