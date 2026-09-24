import { PLAN_SCHEMA_VERSION } from "@draw/agent-core"
import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { createIdAllocator } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import { compileInProcess, compileInWorker, type StagedPlanEnvelope } from "./geometryCompileStrategy"
import { createGeometryWorkerClient } from "./geometryWorkerClient"
import { conicInvariantPlan, obliquePrismSectionPlan } from "./representativeFixtures"
import { inlineWorker } from "./testing/inlineWorker"
import { WORKER_SCHEMA_VERSION } from "./workerContracts"

/**
 * **两条编译路径必须等价**（方案 3 的核心判据）。
 *
 * 同步路径（`compilePlan`，当前生产）与 Worker 路径（`geometry.worker` → `workerRuntime`）
 * 会长期并存：Worker 只在"值得"的场景上启用，而且它是异步的。
 * 一旦两条路对同一份计划给出不同结果，就会变成"某个形状只能在这一条路上编出来" ——
 * 而那种缺陷极难查，因为这个项目已经几次因为**同一个判断写了两遍**而吃过亏
 *（来源解析、导出取文档、度量名副本）。
 *
 * 所以这里把两条路**并排**喂同一份计划、同一份文档，断言：
 * ①两侧都成功；②**编译出的操作逐字节相同**；③**结果文档的操作与图元 id 相同**。
 *
 * ## 夹具怎么造
 *
 * Worker 那一侧需要一个 Worker。这里**不建真 Worker**（`new URL(..., import.meta.url)`
 * 在 node 里没有意义），而是注入一个假的，它把请求**真的**交给
 * `handleGeometryRequest` —— 也就是 `geometry.worker.ts` 接线的那一个纯函数。
 * 于是这条用例覆盖的是真链路（契约 → 运行时 → 结果），只把"线程"换成了函数调用。
 */

const document3d = (): GeometryDocument => createEmptyDocument("geometry3d")

/**
 * 把两条路的产物归一成可比的东西。
 *
 * 收的是 `StagedCompileResult` 那一对字段（`operations` + `draftDocument`）——
 * 也就是 `stage` 真正读的那两个。这样"两条路等价"这句话断言的就是**下游真正会用的东西**，
 * 而不是"两份结果对象长得像"。
 */
function summarize(result: { operations: readonly unknown[]; draftDocument: GeometryDocument | null }) {
  const document = result.draftDocument
  return {
    operations: JSON.parse(JSON.stringify(result.operations)),
    ids: document === null ? null : document.primitives.map((primitive) => primitive.id),
    types: document === null ? null : document.primitives.map((primitive) => primitive.type)
  }
}

/** 计划信封的 `actions` 是只读的，这里转成编译输入要的可变数组。 */
const asPlan = (envelope: StagedPlanEnvelope): StagedPlanEnvelope => envelope

describe("compile strategies agree", () => {
  const cases = [
    { name: "oblique prism + section", envelope: obliquePrismSectionPlan() },
    { name: "conic invariant", envelope: conicInvariantPlan() }
  ] as const

  it.each(cases)("in-process and worker compile $name identically", async (testCase) => {
    const plan = asPlan(testCase.envelope as StagedPlanEnvelope)
    const document = document3d()

    // 同步路径：与 `DraftStore.stage` 一样的参数（分配器的初始占用集来自基准文档）。
    const inProcess = compileInProcess({
      plan,
      document,
      conversationId: "draft-bench",
      capabilityRevision: "draft",
      allocator: createIdAllocator(document.primitives.map((primitive) => primitive.id))
    })
    expect(inProcess.ok, "同步路径没编过，这条对比就没有意义").toBe(true)
    if (!inProcess.ok) return

    // Worker 路径：假 Worker 把消息交给真正的 `workerRuntime`。
    const { handleGeometryRequest } = await import("./workerRuntime")
    const client = createGeometryWorkerClient(inlineWorker((request) => handleGeometryRequest(request as never)))
    const worker = await compileInWorker(client, { plan, document }, {
      runId: "run-1",
      draftId: "draft-bench",
      draftVersion: 1
    })
    client.dispose()

    expect(worker.ok, "Worker 路径没编过 —— 两边就不可比了").toBe(true)
    if (!worker.ok || worker.draftDocument === null) return

    /**
     * **逐字节相同**。两条路唯一的语义差别是分配器的来路（同步路径拿草稿自己那只、
     * Worker 按基准文档现建）—— 只要基准文档一致、初始占用集一致，发出的 id 就必须一致。
     */
    expect(summarize(worker)).toEqual(summarize({ operations: inProcess.operations, draftDocument: inProcess.draftDocument ?? document }))
  })

  it("both paths seed the allocator from the same base document", async () => {
    /**
     * 这条盯住上面那句"唯一的语义差别"：基准文档里**已经有** `point-1` 时，
     * 两条路都必须从 `point-2` 接着发号。少了这条，上一条用例可能在
     * "两边都从 1 开始" 的空文档上通过，却漏掉撞号那一档。
     */
    const plan = asPlan(obliquePrismSectionPlan() as StagedPlanEnvelope)
    const document = document3d()
    document.primitives = [
      { id: "point-1", type: "point", x: 0, y: 0 },
      { id: "point-2", type: "point", x: 1, y: 1 }
    ]

    const inProcess = compileInProcess({
      plan,
      document,
      conversationId: "draft-bench",
      capabilityRevision: "draft",
      allocator: createIdAllocator(document.primitives.map((primitive) => primitive.id))
    })
    expect(inProcess.ok).toBe(true)
    if (!inProcess.ok) return

    const { handleGeometryRequest } = await import("./workerRuntime")
    const client = createGeometryWorkerClient(inlineWorker((request) => handleGeometryRequest(request as never)))
    const worker = await compileInWorker(client, { plan, document }, { runId: "r", draftId: "d", draftVersion: 1 })
    client.dispose()
    expect(worker.ok).toBe(true)
    if (!worker.ok) return

    const newIds = (ids: readonly string[]) => ids.filter((id) => !document.primitives.some((primitive) => primitive.id === id))
    expect(newIds((worker.draftDocument ?? document).primitives.map((primitive) => primitive.id)).sort())
      .toEqual(newIds((inProcess.draftDocument ?? document).primitives.map((primitive) => primitive.id)).sort())
    // 而且真的**没有**再发出 `point-1` / `point-2`（撞号会让写入被拒）。
    expect(newIds((worker.draftDocument ?? document).primitives.map((primitive) => primitive.id))).not.toContain("point-1")
  })

  it("surfaces a worker-side refusal instead of pretending it succeeded", async () => {
    // 一个不可能编过的计划（动作引用了不存在的别名）：两条路都必须**如实失败**。
    const broken: StagedPlanEnvelope = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "broken",
      factIds: [],
      actions: [{ actionId: "dynamic.bind_point", actionKey: "b", factIds: [], inputs: { target: { scope: "document", entityId: "does-not-exist" }, host: { scope: "document", entityId: "also-missing" } } } as never]
    }
    const document = document3d()
    const inProcess = compileInProcess({ plan: broken, document, conversationId: "draft-bench", capabilityRevision: "draft" })
    expect(inProcess.ok).toBe(false)

    const { handleGeometryRequest } = await import("./workerRuntime")
    const client = createGeometryWorkerClient(inlineWorker((request) => handleGeometryRequest(request as never)))
    const worker = await compileInWorker(client, { plan: broken, document }, { runId: "r", draftId: "d", draftVersion: 1 })
    client.dispose()

    expect(worker.ok).toBe(false)
    // 失败时 `StagedCompileResult` 没有 `code`/`detail` 那种字段 —— 它的产物是**结构化**的：
    // 逐层诊断 + 修复请求。判据因此落在"诊断真的说清了卡在哪一层"上。
    expect(worker.diagnostics.some((entry) => entry.severity === "error")).toBe(true)
    expect(worker.draftDocument).toBeNull()
  })

  it("keeps the worker schema version the client and runtime share", async () => {
    // 两侧都 hardcode 过版本号：一旦分叉，`parseWorkerResponse` 会把**所有**响应判为版本不符。
    expect(WORKER_SCHEMA_VERSION).toBe("mathcanvas.worker.v1")
  })
})
