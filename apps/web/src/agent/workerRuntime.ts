import { commitTransaction, compileActions, createIdAllocator, validatePatch } from "@draw/scene-graph"

import { WORKER_SCHEMA_VERSION, type GeometryWorkerRequest, type GeometryWorkerResponse } from "./workerContracts"

/**
 * **几何 worker 的处理逻辑**（Task 0.8）。
 *
 * 刻意做成纯函数并与 `geometry.worker.ts` 分开：worker 文件本身只是"接线"
 *（`self.onmessage` → 这里 → `postMessage`），而**规则**必须能单测。
 * 在 worker 全局里写业务逻辑的代价是它在 jsdom 里跑不起来，于是那段判断永远没有测试。
 *
 * 两条纪律：
 * 1. **不抛异常跨边界** —— 任何失败都收敛成 `geometry.error` 响应。异常穿过 `postMessage`
 *    会变成 `ErrorEvent`，调用方拿不到原因码，用户只看到"没反应"。
 * 2. **id 分配器按请求新建** —— 分配器按 alias 幂等（重试同一笔不产生两个对象），
 *    跨请求复用会让"上一轮用过的 alias"在本轮指向一个已经不存在的对象。
 */
export function handleGeometryRequest(request: GeometryWorkerRequest): GeometryWorkerResponse {
  const base = { kind: "geometry.error" as const, schemaVersion: WORKER_SCHEMA_VERSION, requestId: request.requestId, code: "unknown", detail: "" }

  if (request.kind === "geometry.compile") {
    try {
      const compiled = compileActions(request.base, request.actions, {
        targetDocument: request.base,
        targetWorkspace: request.base.workspace,
        orderedSelection: [],
        capabilityRevision: "worker",
        idAllocator: createIdAllocator()
      })
      if (compiled.diagnostics.length > 0) {
        return { ...base, code: "compile_failed", detail: compiled.diagnostics.map((entry) => `${entry.code}: ${entry.message}`).join("; ").slice(0, 512) }
      }
      // 走 `commitTransaction` 而不是自己循环 `applyOperation`：校验、重算与语义比较只有这一条路径。
      const result = commitTransaction({ base: request.base, operations: compiled.operations })
      if (result.errors.length > 0) return { ...base, code: "commit_rejected", detail: result.errors.join("; ").slice(0, 512) }
      return { kind: "geometry.compile.result", schemaVersion: WORKER_SCHEMA_VERSION, requestId: request.requestId, operations: compiled.operations, document: result.document }
    } catch (error) {
      return { ...base, code: "worker_threw", detail: describe(error) }
    }
  }

  try {
    // 只校验不执行：调用方想先知道"这批操作能不能落在当前文档上"。
    // `validatePatch` 返回的是判别联合（`{valid:true}` | `{valid:false; errors}`），不是带 `errors` 的对象。
    const problems = request.operations.flatMap((operation) => {
      const validation = validatePatch(request.base, operation)
      return validation.valid ? [] : validation.errors
    })
    if (problems.length > 0) return { ...base, code: "patch_invalid", detail: problems.join("; ").slice(0, 512) }
    const result = commitTransaction({ base: request.base, operations: request.operations })
    if (result.errors.length > 0) return { ...base, code: "commit_rejected", detail: result.errors.join("; ").slice(0, 512) }
    return { kind: "geometry.compile.result", schemaVersion: WORKER_SCHEMA_VERSION, requestId: request.requestId, operations: request.operations, document: result.document }
  } catch (error) {
    return { ...base, code: "worker_threw", detail: describe(error) }
  }
}

function describe(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return text.slice(0, 512)
}
