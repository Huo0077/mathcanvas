/**
 * **模型客户端**（Task 1.5，前端那一半）。
 *
 * 计划原文：`ModelClient.start/stream/cancel` returns **normalized events** and maps network
 * failures to the **error contract**。
 *
 * ## 三条纪律
 *
 * 1. **密钥永远不到前端来**。这个模块**只发**一次"用哪个 profile 跑"，从不接触密钥 ——
 *    真正的请求由 Rust 侧的代理发出（密钥在那里从凭据库借出）。
 *    这一条在类型上就成立：这个文件里没有任何能装密钥的参数。
 * 2. **网络失败映射到错误契约**，而不是抛一个裸 `Error`。调用方（协调器）要按
 *    `retryable` 决定重试与否 —— 那是 `modelEvents.ts` 里唯一的判据。
 * 3. **取消之后不再产出事件**（计划 Step 5 的安全性质）。用 `stopAfterCancel` 过滤，
 *    与 Rust 侧同一套语义。
 */

import type { ModelEvent } from "@draw/agent-core"

export interface ModelRunRequest {
  runId: string
  profileId: string
  messages: { role: string; content: string }[]
  /** 这次请求是为哪一版 profile 构建的（代理会拒绝过期的那一版）。 */
  profileRevision: number
  stream?: boolean
}

export type ModelClientFailure = {
  ok: false
  /** 与 `modelEvents.FailureKind` 同一套词汇。 */
  failure: string
  message: string
  retryable: boolean
}

export type ModelClientStart = { ok: true; events: ModelEvent[] } | ModelClientFailure

/**
 * 把**任何**失败映射到错误契约。
 *
 * 三种来源：没有桌面外壳（网页版）、IPC 失败、代理明确拒绝。三者对调用方来说
 * 都是"这次跑不成"，但只有 IPC 失败与 429/5xx 才值得重试 —— 所以 `retryable` 必须由
 * **分类**决定，而不是由"是不是抛了异常"决定。
 */
export function asFailure(error: unknown): ModelClientFailure {
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof Error && error.name === "NoDesktopShellError") {
    // 没有桌面外壳**不是**可重试的失败：重试一百次也还是浏览器。
    return { ok: false, failure: "transport", message: "模型请求需要桌面版（Windows 应用）；当前在浏览器里运行。", retryable: false }
  }
  // 代理拒绝时消息里带原因码（`missing_token` / `wrong_origin` …）—— 那些**都不该重试**：
  // 换个时机再试还是会被同样的规则拒掉。
  if (/missing_token|wrong_token|wrong_origin|wrong_host|oversize_body|stale_profile_revision|missing_host|missing_origin/.test(message)) {
    return { ok: false, failure: "permission", message, retryable: false }
  }
  return { ok: false, failure: "transport", message, retryable: true }
}

/**
 * 发一次模型请求并取回归一化事件。
 *
 * `invoke` 可注入（测试用）：真实实现走 Tauri IPC，**不经过 HTTP 的浏览器栈** ——
 * 前端连不上 provider，也拿不到密钥。
 */
export async function startModelRun(
  request: ModelRunRequest,
  dependencies: {
    invoke(command: string, args?: Record<string, unknown>): Promise<unknown>
    isCancelled?: () => boolean
    stopAfterCancel?: (events: ModelEvent[], isCancelled: () => boolean) => ModelEvent[]
  }
): Promise<ModelClientStart> {
  try {
    const raw = await dependencies.invoke("model_run", {
      runId: request.runId,
      profileId: request.profileId,
      profileRevision: request.profileRevision,
      messages: request.messages,
      stream: request.stream ?? true
    })
    const events = Array.isArray(raw) ? (raw as ModelEvent[]) : []
    // 取消之后不再产出事件：模型可能已经拿着半截结果去下判断。
    const isCancelled = dependencies.isCancelled ?? (() => false)
    const filtered = dependencies.stopAfterCancel ? dependencies.stopAfterCancel(events, isCancelled) : events
    return { ok: true, events: filtered }
  } catch (error) {
    return asFailure(error)
  }
}

/** 取消一次运行。**幂等**：重复取消不是错误（用户可能点了两次）。 */
export async function cancelModelRun(runId: string, invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>): Promise<boolean> {
  try {
    await invoke("model_cancel", { runId })
    return true
  } catch {
    return false
  }
}

/**
 * **回环代理的地址与令牌从哪里来**。
 *
 * 计划 Step 3："pass it over trusted IPC, and never put it in a URL or persistent storage."
 * 所以这两样都只能**现取**，而且**不缓存** —— 缓存会把"这个会话的令牌"变成
 * 一份躺在内存里的长期凭据，而它本该随会话结束而失效。
 */
export interface ProxySession {
  baseUrl: string
  token: string
}

export async function readProxySession(invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>): Promise<ProxySession | null> {
  try {
    const raw = (await invoke("proxy_session")) as { baseUrl?: unknown; token?: unknown } | null
    const baseUrl = typeof raw?.baseUrl === "string" ? raw.baseUrl : ""
    const token = typeof raw?.token === "string" ? raw.token : ""
    if (baseUrl.length === 0 || token.length === 0) return null
    return { baseUrl, token }
  } catch {
    return null
  }
}
