import { WORKER_SCHEMA_VERSION, parseWorkerRequest } from "./workerContracts"
import { handleGeometryRequest } from "./workerRuntime"

/**
 * **几何 worker**（Task 0.8）。
 *
 * 这个文件刻意只做接线：解析入站消息（`parseWorkerRequest` 会丢弃未知 kind 并给出诊断，
 * 而不是抛异常）、交给纯函数处理、把结果发回去。**规则不写在这里** ——
 * 在 worker 全局里写业务逻辑，那段判断就永远进不了测试。
 *
 * 两条接线纪律：
 * 1. **解析失败也必须回一条响应**。否则主线程在等一个永远不会来的答复，界面表现为卡在"处理中"。
 * 2. **响应一律用我们自己的 `schemaVersion`**。若把对方的版本号原样回过去，
 *    主线程的 `parseWorkerResponse` 会先把响应本身判为版本不符，真正的原因
 *    （"对方发的是别的版本"）就被掩盖了 —— 那个信息放在 `detail` 里。
 */
function requestIdOf(input: unknown): string {
  const value = (input as { requestId?: unknown } | null)?.requestId
  return typeof value === "string" && value.length > 0 ? value : ""
}

self.onmessage = (event: MessageEvent<unknown>) => {
  const parsed = parseWorkerRequest(event.data)
  if (!parsed.ok) {
    self.postMessage({ kind: "geometry.error", schemaVersion: WORKER_SCHEMA_VERSION, requestId: requestIdOf(event.data), code: parsed.diagnostic.code, detail: parsed.diagnostic.detail })
    return
  }
  self.postMessage(handleGeometryRequest(parsed.message))
}
