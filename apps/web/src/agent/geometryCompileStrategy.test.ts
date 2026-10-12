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
 * **Task 8（2026-10-12）：Worker 回了一份"不属于这一版"的结果时，理由不许被吞掉。**
 *
 * `geometryWorkerClient` 会逐项核对 `requestId + runId + draftId + draftVersion`，
 * 不属于当前这一版的回包一律拒（`stale_artifact`）—— **那条闸已经在**，且有用例钉住
 *（`geometryWorkerClient.test.ts`：另一版 / 另一个 run / 另一份草稿各一条）。
 *
 * 但拒完之后：`compileInWorker` 的失败分支只映射了
 * `planDiagnostics` / `questions` / `assumptions` / `repair` —— **`code` 与 `detail` 一个都没搬**。
 * 于是"回包属于另一版"这件事到草稿层就变成了**诊断为空**，`stage` 只能说
 * "the plan produced no compilable action"。那是一句**误诊**：计划本身没问题，
 * 是回包过期了 —— 而这两件事的处置完全不同（重试 / 改计划）。
 */
describe("Task 8 — a stale worker artifact keeps its reason", () => {
  /** 只回一份过期结果的假 Worker 客户端（这一条测的是**映射**，不是线程）。 */
  const staleClient = {
    compile: async () => ({ ok: false as const, code: "stale_artifact" as const, detail: "result belongs to a different draftVersion" }),
    dispose: () => {},
    pendingCount: () => 0
  }

  it("carries the stale reason into the strategy's diagnostics instead of an empty compile failure", async () => {
    const document = document3d()
    const envelope: StagedPlanEnvelope = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "画一个点",
      factIds: [],
      actions: [{ actionId: "planar.create_point", actionKey: "p", factIds: [], inputs: { alias: "p", points: [{ x: 0, y: 0 }] } }] as never
    }

    const result = await compileInWorker(staleClient as never, { plan: envelope, document }, { runId: "run-1", draftId: "draft-1", draftVersion: 1 })

    expect(result.ok).toBe(false)
    // `stage` 靠 `diagnostics` 里**有没有 error** 决定说不说得清 —— 空数组等于把理由丢了。
    const text = (result.diagnostics ?? []).map((item) => `${item.code} ${item.detail}`).join(" ")
    expect(text, `诊断里必须说清是回包过期，而不是"编不出动作"：${text}`).toContain("stale_artifact")
  })
})

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
