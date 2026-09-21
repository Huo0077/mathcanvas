import { afterEach, describe, expect, it } from "vitest"

import { appendRunEvent, readRunEvents, runEventCount, type RunEventInput } from "./runEventClient"

/**
 * **运行账本客户端**（Task 2.6 的前端那一半）。
 *
 * 三条要钉住的性质：
 * 1. **形状一一对应**：这个文件只搬运，不组装额外字段 —— Rust 侧的 `RunEventInput`
 *    带 `deny_unknown_fields`，多一个字段会被**拒绝**（账本绝不存模型推理与图像字节）。
 * 2. **幂等是结果不是错误**：同一个 `eventId` 第二次回 `false`，调用方据此知道"这次没写"。
 * 3. **"没有桌面外壳"与"IPC 失败"分开**：前者是预期（浏览器里没有项目库），后者要有人知道。
 */
const internalsKey = "__TAURI_INTERNALS__"

function installInvoke(invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>) {
  Object.defineProperty(globalThis, internalsKey, { configurable: true, writable: true, value: { invoke } })
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, internalsKey)
})

function event(overrides: Partial<RunEventInput> = {}): RunEventInput {
  return {
    eventId: "run-1:3",
    runId: "run-1",
    conversationId: "conv-1",
    phase: "planning",
    status: "ok",
    detail: "asking for a plan",
    at: 1_700_000_000_000,
    promptMessageId: "msg-1",
    versions: { capabilityRevision: "2026-09-19.1", policyRevision: "local" },
    ...overrides
  }
}

describe("运行账本客户端", () => {
  it("把事件**原样**交给具名命令，不多一个字段", async () => {
    const calls: { command: string; args?: Record<string, unknown> }[] = []
    installInvoke(async (command, args) => {
      calls.push({ command, args })
      return true
    })

    const result = await appendRunEvent(event())

    expect(calls).toHaveLength(1)
    expect(calls[0].command).toBe("append_run_event")
    // `deny_unknown_fields` 在 Rust 侧；这一条保证我们**不会**触发它。
    expect(Object.keys(calls[0].args as object)).toEqual(["event"])
    expect(Object.keys((calls[0].args as { event: object }).event).sort()).toEqual([
      "at", "conversationId", "detail", "eventId", "phase", "promptMessageId", "runId", "status", "versions"
    ])
    expect(result.ok && result.value).toBe(true)
  })

  it("同一个事件第二次写回 false —— 幂等是结果，不是错误", async () => {
    installInvoke(async () => false)

    const result = await appendRunEvent(event())

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe(false)
  })

  it("在浏览器里跑是**预期**状态，不是错误", async () => {
    const appended = await appendRunEvent(event())
    const read = await readRunEvents("run-1")
    const counted = await runEventCount()

    expect(appended.ok).toBe(false)
    if (!appended.ok) expect(appended.code).toBe("no_desktop_shell")
    expect(read.ok).toBe(false)
    expect(counted.ok).toBe(false)
  })

  it("IPC 真的失败时把原因带出来", async () => {
    installInvoke(async () => {
      throw new Error("the project repository is not initialised")
    })

    const result = await appendRunEvent(event())

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("ipc_failed")
      expect(result.detail).toContain("repository")
    }
  })

  it("读回来的形状不对时回空数组，而不是把垃圾当账本", async () => {
    installInvoke(async (command) => (command === "read_run_events" ? "not an array" : "not a number"))

    const read = await readRunEvents("run-1")
    const counted = await runEventCount()

    expect(read.ok && read.value).toEqual([])
    expect(counted.ok && counted.value).toBe(0)
  })
})
