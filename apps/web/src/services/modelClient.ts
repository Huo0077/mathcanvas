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
  /**
   * **这次要发出去的工具表**（provider 侧的工具 schema）。
   *
   * 只有按**已验证**证据放行时才给（`planModelRequest({ needsTools: true })` 走的就是这条路）。
   * Rust 侧还会**再判一次存下来的证据**（`providers::capability::tools_verified`）：调用方说
   * "这家支持工具"不算数，跑过一次能力验证才算数 —— 只在调用方守着的边界，多一个调用方就没了。
   * 证据没验过时 Rust 会**拒绝**这次请求（`ToolsNotVerified`），而不是静默把工具表丢掉。
   */
  tools?: unknown[]
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
 * 四种来源：没有桌面外壳（网页版）、IPC 失败、代理明确拒绝、**Rust 侧给回的
 * 带分类的失败**（`{ kind: "failed", failure, retryable }`）。四者对调用方来说
 * 都是"这次跑不成"，但只有 transport / rate_limited / server_error 才值得重试 ——
 * 所以 `retryable` 必须由**分类**决定，而不是由"是不是抛了异常"决定。
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
 * **把 Rust 侧那条带分类的失败读回来**。
 *
 * Tauri 会把命令的 `Err` 值原样交给前端。Rust 侧刻意把它做成 `ModelEvent` 的
 * `failed` 形状，而不是一句话 —— 因为**重试策略只认 `retryable`**，
 * 而"从一句话里认分类"是一次必然会漏的判断。
 */
export function failureFromErrorValue(value: unknown): ModelClientFailure | null {
  if (typeof value !== "object" || value === null) return null
  const candidate = value as { kind?: unknown; failure?: unknown; message?: unknown; retryable?: unknown }
  if (candidate.kind !== "failed" || typeof candidate.message !== "string") return null
  return {
    ok: false,
    failure: typeof candidate.failure === "string" ? candidate.failure : "unknown",
    message: candidate.message,
    retryable: candidate.retryable === true
  }
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
    const raw = await dependencies.invoke("provider_run", {
      runId: request.runId,
      profileId: request.profileId,
      profileRevision: request.profileRevision,
      messages: request.messages,
      stream: request.stream ?? true,
      // 空数组与"不发工具表"是同一件事（Rust 侧也是这么判的），所以缺省就不带这个字段。
      ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {})
    })
    // Rust 侧把"失败"做成一条带分类的事件（见 `provider_run`）：那条**不是**事件，
    // 是错误契约 —— 混进事件列表会让协调器把它当成模型说的话。
    const failure = failureFromErrorValue(raw)
    if (failure) return failure
    const events = Array.isArray(raw) ? (raw as ModelEvent[]) : []
    // 取消之后不再产出事件：模型可能已经拿着半截结果去下判断。
    const isCancelled = dependencies.isCancelled ?? (() => false)
    const filtered = dependencies.stopAfterCancel ? dependencies.stopAfterCancel(events, isCancelled) : events
    return { ok: true, events: filtered }
  } catch (error) {
    // 命令的 `Err` 会以异常形式到达；先看它是不是那条带分类的失败。
    return failureFromErrorValue(error) ?? asFailure(error)
  }
}

/** 取消一次运行。**幂等**：重复取消不是错误（用户可能点了两次）。 */
export async function cancelModelRun(runId: string, invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>): Promise<boolean> {
  try {
    await invoke("provider_cancel", { runId })
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
