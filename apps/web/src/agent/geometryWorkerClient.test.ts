import { createEmptyDocument } from "@draw/dsl"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createGeometryWorkerClient, type WorkerLike } from "./geometryWorkerClient"
import { WORKER_SCHEMA_VERSION } from "./workerContracts"

/**
 * **几何 worker 客户端的规则**（评审方案 3）。
 *
 * 这一层此前**不存在** —— `workerContracts.ts` / `workerRuntime.ts` 都有测试，
 * 但没有任何生产代码创建过 Worker，所以"消息边界"与"真能跑起来"之间缺的那一块从未被验证。
 *
 * 下面钉的四条都是**具体的坏结果**，不是形式要求：
 * 1. 响应按 `requestId` 配对（不配对 → 预览串版，最难复现的一类 bug）；
 * 2. 旧版本草稿的结果**不许**覆盖新预览（核对 `runId` / `draftId` / `draftVersion`）；
 * 3. 没有响应时必须**超时**（否则界面永久卡在"处理中"且用户看不出原因）；
 * 4. Worker 起不来 / 崩了要**如实失败**，不静默改走同步路径。
 */

/** 一个可控的假 Worker：测试自己决定什么时候、用什么内容回消息。 */
function fakeWorker() {
  const listeners = new Map<string, Set<(event: never) => void>>()
  const posted: unknown[] = []
  let terminated = false
  const worker: WorkerLike = {
    postMessage(message) { posted.push(message) },
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set()
      set.add(listener)
      listeners.set(type, set)
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener) },
    terminate() { terminated = true }
  }
  const emit = (type: "message" | "error", event: unknown) => {
    for (const listener of [...(listeners.get(type) ?? [])]) listener(event as never)
  }
  /** 取第 `index` 条已发出的请求（用来读出它的 requestId 与信封）。 */
  const requestAt = (index: number) => posted[index] as { requestId: string; runId: string; draftId: string; draftVersion: number; kind: string }
  return {
    worker,
    posted,
    emitMessage: (data: unknown) => emit("message", { data }),
    emitError: (error: unknown) => emit("error", error),
    isTerminated: () => terminated,
    requestAt
  }
}

const document = () => createEmptyDocument("conics")

/** 一条"成功"响应：字段齐全（`parseWorkerResponse` 要求 diff / changed / artifact 都在）。 */
function successResponse(requestId: string, artifact: { runId: string; draftId: string; draftVersion: number }, overrides: Record<string, unknown> = {}) {
  return {
    kind: "geometry.compile.result",
    schemaVersion: WORKER_SCHEMA_VERSION,
    requestId,
    operations: [] as never[],
    document: document(),
    changed: true,
    diff: { added: [], removed: [], updated: [] },
    checked: true,
    problems: [],
    beforeHash: "before",
    afterHash: "after",
    artifact,
    ...overrides
  }
}

const envelope = { runId: "run-1", draftId: "draft-1", draftVersion: 1 }

afterEach(() => {
  vi.useRealTimers()
})

describe("geometry worker client", () => {
  it("resolves the request whose id the response carries", async () => {
    const fake = fakeWorker()
    const client = createGeometryWorkerClient(fake.worker)

    const first = client.compile([], document(), envelope)
    const second = client.compile([], document(), { ...envelope, draftId: "draft-2" })
    expect(client.pendingCount()).toBe(2)

    // **乱序回来**：第二条先回。按 id 配对才不会把结果给错人。
    fake.emitMessage(successResponse(fake.requestAt(1).requestId, { runId: "run-1", draftId: "draft-2", draftVersion: 1 }))
    const secondOutcome = await second
    expect(secondOutcome.ok).toBe(true)
    if (secondOutcome.ok) expect(secondOutcome.result.artifact.draftId).toBe("draft-2")
    // 第一条还没回，仍在等 —— 这证明它不是"收到就算"。
    expect(client.pendingCount()).toBe(1)

    fake.emitMessage(successResponse(fake.requestAt(0).requestId, envelope))
    const firstOutcome = await first
    expect(firstOutcome.ok).toBe(true)
    expect(client.pendingCount()).toBe(0)
    client.dispose()
  })

  it("refuses a result that belongs to another draft version instead of overwriting the preview", async () => {
    const fake = fakeWorker()
    const client = createGeometryWorkerClient(fake.worker)

    // 用户已经继续编辑：现在等的是第 2 版。
    const outcome = client.compile([], document(), { ...envelope, draftVersion: 2 })
    // 回来的却是第 1 版的结果。
    fake.emitMessage(successResponse(fake.requestAt(0).requestId, { runId: "run-1", draftId: "draft-1", draftVersion: 1 }))

    const settled = await outcome
    expect(settled.ok).toBe(false)
    if (!settled.ok) {
      expect(settled.code).toBe("stale_artifact")
      expect(settled.detail).toContain("draftVersion")
    }
    client.dispose()
  })

  it("refuses a result from another run or draft", async () => {
    const fake = fakeWorker()
    const client = createGeometryWorkerClient(fake.worker)
    const wrongRun = client.compile([], document(), envelope)
    fake.emitMessage(successResponse(fake.requestAt(0).requestId, { runId: "run-OTHER", draftId: "draft-1", draftVersion: 1 }))
    const runOutcome = await wrongRun
    expect(runOutcome.ok).toBe(false)
    if (!runOutcome.ok) expect(runOutcome.detail).toContain("runId")

    const wrongDraft = client.compile([], document(), envelope)
    fake.emitMessage(successResponse(fake.requestAt(1).requestId, { runId: "run-1", draftId: "draft-OTHER", draftVersion: 1 }))
    const draftOutcome = await wrongDraft
    expect(draftOutcome.ok).toBe(false)
    if (!draftOutcome.ok) expect(draftOutcome.detail).toContain("draftId")
    client.dispose()
  })

  it("surfaces a worker-side error response as a stable code", async () => {
    const fake = fakeWorker()
    const client = createGeometryWorkerClient(fake.worker)
    const outcome = client.compile([], document(), envelope)
    fake.emitMessage({ kind: "geometry.error", schemaVersion: WORKER_SCHEMA_VERSION, requestId: fake.requestAt(0).requestId, code: "compile_failed", detail: "degenerate_prism@envelope" })

    const settled = await outcome
    expect(settled.ok).toBe(false)
    if (!settled.ok) {
      expect(settled.code).toBe("compile_failed")
      expect(settled.detail).toContain("degenerate_prism")
    }
    client.dispose()
  })

  it("fails all in-flight requests when the worker reports an error, without waiting for the timeout", async () => {
    const fake = fakeWorker()
    const client = createGeometryWorkerClient(fake.worker, { timeoutMs: 60_000 })
    const first = client.compile([], document(), envelope)
    const second = client.check([], document(), envelope)
    expect(client.pendingCount()).toBe(2)

    fake.emitError(new Error("worker blew up"))

    for (const outcome of await Promise.all([first, second])) {
      expect(outcome.ok).toBe(false)
      if (!outcome.ok) {
        expect(outcome.code).toBe("worker_error")
        expect(outcome.detail).toContain("blew up")
      }
    }
    expect(client.pendingCount()).toBe(0)
    client.dispose()
  })

  it("times out instead of leaving the caller waiting forever", async () => {
    vi.useFakeTimers()
    const fake = fakeWorker()
    const client = createGeometryWorkerClient(fake.worker, { timeoutMs: 1_000 })
    const outcome = client.compile([], document(), envelope)
    expect(client.pendingCount()).toBe(1)

    vi.advanceTimersByTime(1_001)
    const settled = await outcome
    expect(settled.ok).toBe(false)
    if (!settled.ok) {
      expect(settled.code).toBe("timeout")
      expect(settled.detail).toContain("1000")
    }
    expect(client.pendingCount()).toBe(0)

    // 迟到的那条响应回来时**不该**再影响任何东西（请求已经结算过了）。
    fake.emitMessage(successResponse(fake.requestAt(0).requestId, envelope))
    expect(client.pendingCount()).toBe(0)
    client.dispose()
  })

  it("ignores a response for an unknown request id", async () => {
    const fake = fakeWorker()
    const client = createGeometryWorkerClient(fake.worker)
    const outcome = client.compile([], document(), envelope)
    // 一条谁也没等过的响应：既不能抛、也不能把在途的那条结算掉。
    fake.emitMessage(successResponse("gw-does-not-exist", envelope))
    expect(client.pendingCount()).toBe(1)
    fake.emitMessage(successResponse(fake.requestAt(0).requestId, envelope))
    expect((await outcome).ok).toBe(true)
    client.dispose()
  })

  it("rejects everything after dispose and terminates the worker once", async () => {
    const fake = fakeWorker()
    const client = createGeometryWorkerClient(fake.worker)
    const inFlight = client.compile([], document(), envelope)
    client.dispose()
    client.dispose() // 幂等

    const settled = await inFlight
    expect(settled.ok).toBe(false)
    if (!settled.ok) expect(settled.code).toBe("disposed")

    const afterDispose = await client.compile([], document(), envelope)
    expect(afterDispose.ok).toBe(false)
    if (!afterDispose.ok) expect(afterDispose.code).toBe("disposed")

    expect(fake.isTerminated()).toBe(true)
  })

  /**
   * **失败响应的编译产物也要过客户端这一层**。
   *
   * 契约（`WorkerFailure`）已经带了 `repair` / `planDiagnostics` / `assumptions` / `questions`，
   * 但客户端此前只留 `code` + `detail` —— 于是"契约补上了"等于白补：数据到了主线程门口又被扔掉。
   * 这条用例就是钉住"门口不许扔"。
   */
  it("keeps the failure artifacts instead of reducing a refusal to one line", async () => {
    const fake = fakeWorker()
    const client = createGeometryWorkerClient(fake.worker)
    const outcome = client.compile([], document(), envelope)

    fake.emitMessage({
      kind: "geometry.error",
      schemaVersion: WORKER_SCHEMA_VERSION,
      requestId: fake.requestAt(0).requestId,
      code: "compile_failed",
      detail: "geometry_validation/degenerate_prism@envelope: zero vector",
      repair: { reason: "degenerate_prism", errors: [{ code: "degenerate_prism", path: "envelope.actions[1].inputs.vector", detail: "zero" }], allowedChanges: ["envelope.actions[1].inputs.vector"], attempt: 1 },
      planDiagnostics: [{ stage: "geometry_validation", code: "degenerate_prism", path: "envelope.actions[1].inputs.vector", detail: "zero", severity: "error" }],
      assumptions: [{ id: "a1", path: "envelope.actions[0].inputs.vector", value: { x: 0, y: 0, z: 3 }, reason: "拉伸向量未指定" }],
      questions: [{ id: "q1", text: "底面半径是多少？", reason: "半径不能替你定", path: "envelope.actions[0].inputs.radius" }]
    })

    const settled = await outcome
    expect(settled.ok).toBe(false)
    if (settled.ok) return
    expect(settled.code).toBe("compile_failed")
    // 四样都要在：少任何一样，协调器就没法把这次失败修回去、也没法改问用户。
    expect(settled.repair?.allowedChanges).toEqual(["envelope.actions[1].inputs.vector"])
    expect(settled.planDiagnostics?.[0].code).toBe("degenerate_prism")
    expect(settled.assumptions?.[0].id).toBe("a1")
    expect(settled.questions?.[0].text).toContain("半径")
    client.dispose()
  })

  it("fills the five envelope fields on every request", () => {
    const fake = fakeWorker()
    const client = createGeometryWorkerClient(fake.worker)
    void client.compile([], document(), { ...envelope, prompt: "画一个立方体" })
    void client.check([], document(), envelope)

    for (const [index, request] of fake.posted.entries()) {
      const message = request as Record<string, unknown>
      expect(message.schemaVersion).toBe(WORKER_SCHEMA_VERSION)
      expect(typeof message.requestId).toBe("string")
      expect(message.runId).toBe("run-1")
      expect(message.draftId).toBe("draft-1")
      expect(message.draftVersion).toBe(1)
      expect(message.kind).toBe(index === 0 ? "geometry.compile" : "geometry.check")
    }
    // 原话只在给了的时候才带上（编译要看它，`check` 没有这个字段）。
    expect((fake.posted[0] as { prompt?: string }).prompt).toBe("画一个立方体")
    expect(fake.posted[1]).not.toHaveProperty("prompt")
    client.dispose()
  })
})
