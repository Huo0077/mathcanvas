import type { GeometryDocument } from "@draw/dsl"
import type { DomainOperation, DraftAction } from "@draw/scene-graph"

import { createWorkerRequest, parseWorkerResponse, type GeometryWorkerResponse, type WorkerFailure, type WorkerSuccess } from "./workerContracts"

/**
 * **几何 worker 的宿主侧客户端**（评审方案 3 缺的那一块）。
 *
 * `workerContracts.ts`（消息边界）与 `workerRuntime.ts`（纯处理逻辑）早就完整且有测试，
 * 唯独**没有任何生产代码创建过 Worker** —— 所以整条通道此前是"能测但不能跑"。
 * 这个文件补的就是那一层：建 Worker、发请求、按 `requestId` 配对、超时、丢弃过期响应、卸载。
 *
 * ## 纪律（每条都有具体的坏结果）
 *
 * 1. **响应必须按 `requestId` 配对，不能"收到就算"**。并发的编译请求会乱序回来；
 *    "收到就算"会让 A 的响应被当成 B 的结果 —— 用户看到的是"预览偶尔串版"，最难复现的一类。
 * 2. **`requestId + runId + draftId + draftVersion` 四个都要核对**。只对 `requestId` 不够：
 *    同一份草稿在用户继续编辑之后会有新版本，旧版本的编译结果**绝不能**覆盖新预览。
 * 3. **超时不是可选的**。Worker 挂了（或那条消息永远回不来）时，没有超时就是界面永久卡在"处理中"，
 *    而用户没有任何办法看出来发生了什么。
 * 4. **不做静默降级**。Worker 起不来就如实回一个失败 —— 悄悄改走同步路径会让"这条通道通没通"
 *    永远说不清（这正是这个功能此前一直没接线却没人发现的原因）。
 *
 * ## 为什么 Worker 是**注入**的
 *
 * 生产里由 `spawnGeometryWorker()` 建真 Worker；测试注入一个假的。
 * 这样规则（配对 / 超时 / 过期）能在 jsdom 里直接测，而不是只能靠"在浏览器里跑一遍看看"。
 * 与 `workerRuntime.ts` 把规则与接线分开是同一条理由。
 */

/** 客户端只需要 Worker 的这几项能力 —— 收窄接口让测试不必伪造整个 `Worker`。 */
export interface WorkerLike {
  postMessage(message: unknown): void
  addEventListener(type: "message" | "error", listener: (event: never) => void): void
  removeEventListener(type: "message" | "error", listener: (event: never) => void): void
  terminate(): void
}

export interface GeometryWorkerClientOptions {
  /** 每次请求的超时（毫秒）。默认 15 s：比任何一条真实编译都宽，但远小于"用户以为卡死"的阈值。 */
  timeoutMs?: number
}

export interface GeometryWorkerRequestEnvelope {
  runId: string
  draftId: string
  draftVersion: number
  prompt?: string
}

export type GeometryWorkerOutcome =
  | { ok: true; result: WorkerSuccess }
  /**
   * `code` 是**稳定**的原因码（`timeout` / `worker_error` / `worker_exit` / 或传输层给的码）。
   *
   * **失败时也要把编译产物带过来**（`repair` / `planDiagnostics` / `assumptions` / `questions`）。
   * 为什么这一层不能把它们丢掉：它们是协调器"把失败发回模型再修一次"的全部依据，
   * 也是"本该问用户"与"真的编不过"的分流依据。契约（`WorkerFailure`）已经带了，
   * 如果客户端在这一层只留 `code` + `detail`，那么"契约补上了"就是白补 ——
   * 数据到了主线程门口又被扔掉，**表现与没补一模一样**。
   */
  | { ok: false; code: string; detail: string; repair?: WorkerFailure["repair"]; planDiagnostics?: WorkerFailure["planDiagnostics"]; assumptions?: WorkerFailure["assumptions"]; questions?: WorkerFailure["questions"] }

export interface GeometryWorkerClient {
  compile(actions: readonly DraftAction[], base: GeometryDocument, envelope: GeometryWorkerRequestEnvelope): Promise<GeometryWorkerOutcome>
  check(operations: readonly DomainOperation[], base: GeometryDocument, envelope: GeometryWorkerRequestEnvelope): Promise<GeometryWorkerOutcome>
  /** 还在等响应的请求数（测试与诊断用）。 */
  pendingCount(): number
  /** 卸载：拒绝所有在途请求并终止 Worker。重复调用是幂等的。 */
  dispose(): void
}

const DEFAULT_TIMEOUT_MS = 15_000

export function createGeometryWorkerClient(worker: WorkerLike, options: GeometryWorkerClientOptions = {}): GeometryWorkerClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  let disposed = false
  let sequence = 0
  /**
   * 在途请求。键是 `requestId`；值里记着**这一条请求期望的信封** ——
   * 响应回来时要逐项核对，而不是只看 requestId 对上就把结果收下。
   */
  const pending = new Map<string, {
    expected: GeometryWorkerRequestEnvelope
    resolve: (outcome: GeometryWorkerOutcome) => void
    timer: ReturnType<typeof setTimeout>
  }>()

  const settle = (requestId: string, outcome: GeometryWorkerOutcome) => {
    const entry = pending.get(requestId)
    if (!entry) return
    pending.delete(requestId)
    clearTimeout(entry.timer)
    entry.resolve(outcome)
  }

  const onMessage = (event: { data?: unknown }) => {
    const raw = event?.data
    /**
     * 先用**未知的 requestId** 解析一次，只为把 `requestId` 取出来 ——
     * 之后再用那个 id 作为 `expectedRequestId` 正式解析。
     *
     * 为什么分两步：`parseWorkerResponse` 的 `expectedRequestId` 是"这条响应是不是我要的那条"的
     * 唯一强制点。若先按"任意 id"接受，就绕过了那道检查。
     */
    const probe = parseWorkerResponse(raw)
    if (!probe.ok) return
    const requestId = probe.message.requestId
    const entry = pending.get(requestId)
    // 不认识的 requestId：可能是已超时/已取消的请求回来了。**丢弃**，不影响其它在途请求。
    if (!entry) return

    const parsed = parseWorkerResponse(raw, requestId)
    if (!parsed.ok) {
      settle(requestId, { ok: false, code: parsed.diagnostic.code, detail: parsed.diagnostic.detail })
      return
    }
    const response: GeometryWorkerResponse = parsed.message
    if (response.kind === "geometry.error") {
      // 失败也要把产物带出来（见 `GeometryWorkerOutcome` 的注释）：只留 code + detail 等于把契约白补的那几项又扔掉。
      settle(requestId, {
        ok: false,
        code: response.code,
        detail: response.detail,
        ...(response.repair === undefined ? {} : { repair: response.repair }),
        ...(response.planDiagnostics === undefined ? {} : { planDiagnostics: response.planDiagnostics }),
        ...(response.assumptions === undefined ? {} : { assumptions: response.assumptions }),
        ...(response.questions === undefined ? {} : { questions: response.questions })
      })
      return
    }
    /**
     * **信封核对**：产物自己声明它属于哪一轮、哪一份草稿的哪一版。
     * 与本次请求对不上就**丢弃并如实报错** —— 收下它就等于让旧版本的结果覆盖新预览。
     */
    const artifact = response.artifact
    const mismatch = artifact.runId !== entry.expected.runId
      ? "runId"
      : artifact.draftId !== entry.expected.draftId
        ? "draftId"
        : artifact.draftVersion !== entry.expected.draftVersion
          ? "draftVersion"
          : null
    if (mismatch) {
      settle(requestId, { ok: false, code: "stale_artifact", detail: `result belongs to a different ${mismatch}` })
      return
    }
    settle(requestId, { ok: true, result: response })
  }

  const onError = (event: unknown) => {
    const detail = event instanceof Error ? event.message : String((event as { message?: unknown })?.message ?? "worker error")
    failAll("worker_error", detail)
  }

  /** Worker 起不来 / 崩了：所有在途请求一起失败，而不是留它们等到超时。 */
  function failAll(code: string, detail: string) {
    for (const [requestId] of [...pending]) settle(requestId, { ok: false, code, detail })
  }

  worker.addEventListener("message", onMessage as never)
  worker.addEventListener("error", onError as never)

  const send = (
    kind: "geometry.compile" | "geometry.check",
    payload: Record<string, unknown>,
    envelope: GeometryWorkerRequestEnvelope
  ): Promise<GeometryWorkerOutcome> => {
    if (disposed) return Promise.resolve({ ok: false, code: "disposed", detail: "the geometry worker client was disposed" })
    sequence += 1
    const requestId = `gw-${sequence}`
    return new Promise<GeometryWorkerOutcome>((resolve) => {
      const timer = setTimeout(() => {
        settle(requestId, { ok: false, code: "timeout", detail: `no response within ${timeoutMs} ms` })
      }, timeoutMs)
      pending.set(requestId, { expected: envelope, resolve, timer })
      try {
        worker.postMessage(createWorkerRequest(kind, { runId: envelope.runId, requestId, draftId: envelope.draftId, draftVersion: envelope.draftVersion }, payload as never))
      } catch (error) {
        settle(requestId, { ok: false, code: "worker_error", detail: error instanceof Error ? error.message : "failed to post to the worker" })
      }
    })
  }

  return {
    compile: (actions, base, envelope) => send("geometry.compile", { actions: [...actions], base, ...(envelope.prompt === undefined ? {} : { prompt: envelope.prompt }) }, envelope),
    check: (operations, base, envelope) => send("geometry.check", { operations: [...operations], base }, envelope),
    pendingCount: () => pending.size,
    dispose: () => {
      if (disposed) return
      disposed = true
      failAll("disposed", "the geometry worker client was disposed")
      worker.removeEventListener("message", onMessage as never)
      worker.removeEventListener("error", onError as never)
      worker.terminate()
    }
  }
}

/**
 * 生产里的 Worker 工厂（评审原文给的就是这个写法）。
 *
 * **不与客户端放在同一个文件里测试**：`new URL(..., import.meta.url)` 是 bundler 语法，
 * 在 node/vitest 里没有意义。所以它单独一个函数，测试用注入的假 Worker 走规则那一半。
 */
export function spawnGeometryWorker(): WorkerLike {
  return new Worker(new URL("./geometry.worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike
}
