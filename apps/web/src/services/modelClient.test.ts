import type { ModelEvent } from "@draw/agent-core"
import { describe, expect, it, vi } from "vitest"

import { asFailure, cancelModelRun, readProxySession, startModelRun } from "./modelClient"

/**
 * 模型客户端（Task 1.5 Step 6 的前端一半）。
 *
 * 最要紧的两条性质：
 * 1. **网络失败映射到错误契约**（带 `retryable`），而不是抛一个裸 `Error` ——
 *    协调器的重试策略读的就是这个字段；
 * 2. **取消之后不再产出事件** —— 模型可能已经拿着半截结果去下判断。
 */
const ids = { requestId: "req-1", attemptId: "attempt-1" }

const events: ModelEvent[] = [
  { ...ids, kind: "started", model: "gpt-5" },
  { ...ids, kind: "delta", text: "a" },
  { ...ids, kind: "tool_call", toolCallId: "t1", toolId: "scene.inspect", input: {} },
  { ...ids, kind: "completed" }
]

/**
 * 一个记录调用的替身 invoke。
 *
 * **显式声明两个参数**：`vi.fn(async () => value)` 会被推断成零参数签名，
 * 于是 `mock.calls[0][1]` 在类型上不存在 —— 而这正是那条"请求里不许有密钥"
 * 的用例要读的东西。类型上读不到，就只能断言别的东西了。
 */
function invokeReturning(value: unknown) {
  return vi.fn(async (_command: string, _args?: Record<string, unknown>) => value)
}

describe("starting a model run", () => {
  it("returns the normalized events the proxy produced", async () => {
    const invoke = invokeReturning(events)

    const result = await startModelRun({ runId: "r1", profileId: "openai", profileRevision: 3, messages: [{ role: "user", content: "hi" }] }, { invoke })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.events.map((event) => event.kind)).toEqual(["started", "delta", "tool_call", "completed"])
    expect(invoke).toHaveBeenCalledWith("model_run", expect.objectContaining({ runId: "r1", profileId: "openai", profileRevision: 3 }))
  })

  it("never sends a secret — there is no parameter that could carry one", async () => {
    const invoke = invokeReturning([])

    await startModelRun({ runId: "r1", profileId: "openai", profileRevision: 1, messages: [] }, { invoke })

    const args = invoke.mock.calls[0][1] as Record<string, unknown>
    const serialized = JSON.stringify(args)
    // 请求里只有"用哪个 profile"，没有任何能装密钥的字段。
    for (const forbidden of ["apiKey", "secret", "token", "Authorization"]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it("stops producing events once the run is cancelled", async () => {
    const invoke = invokeReturning(events)
    /**
     * 这个判定**永远是 false** —— 取消发生在过滤器内部（模拟"用户在第一块内容之后按了停止"）。
     * 用一个只读的判定而不是可变量，是因为这条用例要证明的是"**客户端把取消判定交给了过滤器**"，
     * 而不是"判定本身会翻转"（后者是 `modelEvents.test.ts` 的事）。
     */
    const neverCancelled = (): boolean => false
    // 换个名字：原先这里解构出 `stopAfterCancel`，而注入的回调参数**也叫** `stopAfterCancel` ——
    // 闭包里那一行 `stopAfterCancel(incoming, …)` 调用的是**参数**（它自己），于是无限递归、
    // 用例偶发超时（实测 5013ms 撞上 5s 上限）。能跑的那几次是因为时序刚好。
    const { stopAfterCancel: filterCancelled } = await import("@draw/agent-core")
    /** 记下客户端到底把什么交给了过滤器 —— 这条接缝比"过滤函数本身对不对"更容易被漏掉。 */
    const handed: { events: number; hasCancellation: boolean } = { events: -1, hasCancellation: false }

    const result = await startModelRun(
      { runId: "r1", profileId: "openai", profileRevision: 1, messages: [] },
      {
        invoke,
        isCancelled: neverCancelled,
        // 与 Rust 侧同一套语义：取消之后一个工具事件都不许出去。
        stopAfterCancel: (incoming, cancelled) => {
          handed.events = incoming.length
          handed.hasCancellation = typeof cancelled === "function"
          // 让"取消"在第一个 delta 之后发生 —— 模拟用户按下停止的那一刻。
          let seen = 0
          return [...filterCancelled(incoming, () => seen++ > 1)]
        }
      }
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 后面那个 `tool_call` 与 `completed` 都不许出去：模型可能已经拿着半截结果去下判断。
    expect(result.events.map((event) => event.kind)).toEqual(["started", "delta"])
    expect(handed.events).toBe(4)
    expect(handed.hasCancellation).toBe(true)
    expect(neverCancelled()).toBe(false)
  })
})

describe("failures map to the error contract", () => {
  it("reports a browser as a non-retryable transport failure", async () => {
    // 没有桌面外壳**不是**可重试的失败：重试一百次也还是浏览器。
    const error = new Error("no desktop shell is available for model_run")
    error.name = "NoDesktopShellError"

    const failure = asFailure(error)

    expect(failure.ok).toBe(false)
    expect(failure.retryable).toBe(false)
    expect(failure.message).toContain("桌面版")
  })

  it("treats a proxy refusal as non-retryable", async () => {
    // 准入判据拒掉的请求，换个时机再试还是会被同样的规则拒掉。
    for (const code of ["missing_token", "wrong_origin", "wrong_host", "oversize_body", "stale_profile_revision"]) {
      const failure = asFailure(new Error(`the proxy refused the request: ${code}`))
      expect(failure.retryable, code).toBe(false)
      expect(failure.failure, code).toBe("permission")
    }
  })

  it("treats an unexplained transport error as retryable", async () => {
    const failure = asFailure(new Error("connect ECONNREFUSED 127.0.0.1:51234"))

    expect(failure.retryable).toBe(true)
    expect(failure.failure).toBe("transport")
  })

  it("returns the failure instead of throwing", async () => {
    const invoke = vi.fn(async () => { throw new Error("connection reset") })

    const result = await startModelRun({ runId: "r1", profileId: "p", profileRevision: 1, messages: [] }, { invoke })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain("connection reset")
  })
})

describe("cancelling and reading the proxy session", () => {
  it("cancels idempotently — pressing stop twice is not an error", async () => {
    const invoke = invokeReturning(null)

    expect(await cancelModelRun("r1", invoke)).toBe(true)
    expect(await cancelModelRun("r1", invoke)).toBe(true)
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it("reports a failed cancel instead of pretending it worked", async () => {
    const invoke = vi.fn(async () => { throw new Error("no such run") })

    expect(await cancelModelRun("r1", invoke)).toBe(false)
  })

  it("reads the loopback address and token fresh from the shell every time", async () => {
    // 不缓存：缓存会把"这个会话的令牌"变成一份长期凭据，而它本该随会话结束失效。
    const invoke = invokeReturning({ baseUrl: "http://127.0.0.1:51234", token: "ab".repeat(16) })

    const first = await readProxySession(invoke)
    const second = await readProxySession(invoke)

    expect(first).toEqual({ baseUrl: "http://127.0.0.1:51234", token: "ab".repeat(16) })
    expect(second).toEqual(first)
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it("returns null when the shell cannot provide a session", async () => {
    expect(await readProxySession(invokeReturning({ baseUrl: "", token: "" }))).toBeNull()
    expect(await readProxySession(vi.fn(async () => { throw new Error("ipc closed") }))).toBeNull()
  })
})
