import { commitTransaction, compileActions, createIdAllocator, validatePatch } from "@draw/scene-graph"

import { WORKER_SCHEMA_VERSION, type GeometryWorkerRequest, type GeometryWorkerResponse, type WorkerSuccess } from "./workerContracts"

/**
 * **几何 worker 的处理逻辑**（Task 0.8；产物信封见 Task 2.4 Step 4）。
 *
 * 刻意做成纯函数并与 `geometry.worker.ts` 分开：worker 文件本身只是"接线"
 * （`self.onmessage` → 这里 → `postMessage`），而**规则**必须能单测。
 * 在 worker 全局里写业务逻辑的代价是它在 jsdom 里跑不起来，于是那段判断永远没有测试。
 *
 * 三条纪律：
 * 1. **不抛异常跨边界** —— 任何失败都收敛成 `geometry.error` 响应。异常穿过 `postMessage`
 *    会变成 `ErrorEvent`，调用方拿不到原因码，用户只看到"没反应"。
 * 2. **id 分配器按请求新建** —— 分配器按 alias 幂等（重试同一笔不产生两个对象），
 *    跨请求复用会让"上一轮用过的 alias"在本轮指向一个已经不存在的对象。
 * 3. **成功的响应必须带齐 diff / check / artifact** —— 见 `workerContracts.ts` 的
 *    `WorkerSuccess`。缺了它们，调用方就没法回答"改了什么 / 查过了吗 / 这是哪一版草稿"，
 *    而这三问正是"用户确认的是不是他看过的那一份"。
 */
export function handleGeometryRequest(request: GeometryWorkerRequest): GeometryWorkerResponse {
  const base = { kind: "geometry.error" as const, schemaVersion: WORKER_SCHEMA_VERSION, requestId: request.requestId, code: "unknown", detail: "" }

  /** 成功响应的**唯一**构造点：三个信封字段只有一处填法，免得哪天漏掉一个。 */
  const succeed = (operations: WorkerSuccess["operations"], result: ReturnType<typeof commitTransaction>, problems: string[]): WorkerSuccess => ({
    kind: "geometry.compile.result",
    schemaVersion: WORKER_SCHEMA_VERSION,
    requestId: request.requestId,
    operations,
    document: result.document,
    changed: result.changed,
    diff: result.diff,
    checked: true,
    problems,
    beforeHash: result.beforeHash,
    afterHash: result.afterHash,
    artifact: { runId: request.runId, draftId: request.draftId, draftVersion: request.draftVersion, requestId: request.requestId }
  })

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
      return succeed(compiled.operations, result, [])
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
    /**
     * `check` 路径也回带 operations 与结果文档：调用方问的是"这批操作会得到什么"，
     * 只说"没问题"它还得再问一次。`problems` 在这里必然是空的（非空已经在上面返回错误了），
     * 但仍然逐字回带 —— 让"校验过了、而且一条问题都没有"成为**响应里的话**，
     * 而不是调用方从"没有报错"推断出来的结论。
     */
    return succeed(request.operations, result, problems)
  } catch (error) {
    return { ...base, code: "worker_threw", detail: describe(error) }
  }
}

function describe(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return text.slice(0, 512)
}
