import type { WorkerLike } from "../geometryWorkerClient"

/**
 * **一个"在同一个线程里假装是 Worker"的宿主**（仅供用例）。
 *
 * `new URL(..., import.meta.url)` 是 bundler 语法，在 node/vitest 里没有意义 —— 所以需要
 * Worker 的用例都注入这个假的。它把消息**真的**交给传进来的处理器（用例里就是
 * `workerRuntime.handleGeometryRequest`，也就是 `geometry.worker.ts` 接线的那一个纯函数），
 * 于是覆盖的是真链路（契约 → 运行时 → 结果），只把"线程"换成了函数调用。
 *
 * 为什么单独一个文件、而不是在两个用例文件里各抄一份：**"同一个东西写两遍"正是这个项目
 * 反复吃亏的地方** —— 副本一旦分叉，两边看起来还在被同一组证据覆盖，其实已经不是了。
 */
export function inlineWorker(handle: (request: unknown) => unknown): WorkerLike {
  const listeners = new Set<(event: never) => void>()
  return {
    postMessage(message) {
      // 同步把响应发回来（真实 Worker 是异步的，但客户端的配对逻辑与此无关）。
      const response = handle(message)
      queueMicrotask(() => { for (const listener of [...listeners]) listener({ data: response } as never) })
    },
    addEventListener(_type, listener) { listeners.add(listener as (event: never) => void) },
    removeEventListener(_type, listener) { listeners.delete(listener as (event: never) => void) },
    terminate() { listeners.clear() }
  }
}
