import { createEmptyDocument } from "@draw/dsl"
import { createIdAllocator } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import { createDraftStore } from "./draftStore"
import { compileInWorker } from "./geometryCompileStrategy"
import { createGeometryWorkerClient } from "./geometryWorkerClient"
import { handleGeometryRequest } from "./workerRuntime"
import { inlineWorker } from "./testing/inlineWorker"

const action = { actionId: "solid.create_polyhedron", actionKey: "tetrahedron", factIds: [], inputs: {
  alias: "tetrahedron", vertexNames: ["A", "B", "C", "D"],
  vertices: [{ x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 0 }, { x: 0.5, y: Math.sqrt(3) / 2, z: 0 }, { x: 1, y: 0, z: 0 }],
  faces: [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]]
} } as const

function setup() {
  const store = createDraftStore()
  const draft = store.create(createEmptyDocument("geometry3d"))
  return { store, draft }
}

describe("diagram checks on the real draft staging path", () => {
  it("stores a complete verification report next to the exact candidate being previewed", async () => {
    const { store, draft } = setup()
    const result = await store.stage(draft.draftId, [action] as never, draft.draftVersion, "在三棱锥A-BCD中，BD=2，AB=AD，画示意图")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preview.diagramVerification?.status).toBe("passed")
    expect(result.preview.diagramVerification?.checks).toHaveLength(2)
    expect(store.getPreview(draft.draftId)?.diagramVerification).toEqual(result.preview.diagramVerification)
  })

  it("retains the original document when a numeric given fails", async () => {
    const { store, draft } = setup()
    const result = await store.stage(draft.draftId, [action] as never, draft.draftVersion, "在三棱锥A-BCD中，BD=3，画示意图")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.diagnostics?.some((item) => item.code === "diagram_condition_failed")).toBe(true)
    expect(store.getPreview(draft.draftId)?.candidate.primitives).toEqual([])
  })

  it("does not drop a passed diagram report when a later stage changes the candidate", async () => {
    const { store, draft } = setup()
    const first = await store.stage(draft.draftId, [action] as never, draft.draftVersion, "在三棱锥A-BCD中，BD=2，画示意图")
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = await store.stage(draft.draftId, [{ actionId: "solid.create_template", actionKey: "cube", factIds: [], inputs: {
      alias: "cube", template: "cube", origin: { x: 5, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 }
    } }], first.preview.draftVersion, "再加一个立方体")
    expect(second.ok).toBe(true)
    if (second.ok) expect(second.preview.diagramVerification?.status).toBe("unverified")
  })
  it("produces the same diagram report through a Worker and the in-process fallback", async () => {
    const userMessage = "在三棱锥A-BCD中，BD=2，AB=AD，画示意图"
    const direct = setup()
    const directResult = await direct.store.stage(direct.draft.draftId, [action] as never, direct.draft.draftVersion, userMessage)
    expect(directResult.ok).toBe(true)
    if (!directResult.ok) return

    const client = createGeometryWorkerClient(inlineWorker((request) => handleGeometryRequest(request as never)))
    const workerStore = createDraftStore(createIdAllocator, async ({ plan, document, conversationId, draftVersion, userMessage: prompt }) =>
      compileInWorker(client, { plan, document }, { runId: "worker-run", draftId: conversationId, draftVersion, prompt }))
    const workerDraft = workerStore.create(createEmptyDocument("geometry3d"))
    try {
      const workerResult = await workerStore.stage(workerDraft.draftId, [action] as never, workerDraft.draftVersion, userMessage)
      expect(workerResult.ok).toBe(true)
      if (workerResult.ok) expect(workerResult.preview.diagramVerification).toEqual(directResult.preview.diagramVerification)
    } finally { client.dispose() }
  })
  it("keeps unsupported conditions visible, never labeling them passed", async () => {
    const { store, draft } = setup()
    const result = await store.stage(draft.draftId, [action] as never, draft.draftVersion, "在三棱锥A-BCD中，∠ABC=60°，画示意图")
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.preview.diagramVerification?.status).toBe("unverified")
  })

  /**
   * Phase N1：统一 IR 必须**一路不丢**地穿过 `PlanCompiler → DraftStore → Worker`。
   *
   * `diagramDraftStage.test.ts` 已经是两条路并存、且被证明等价的那个文件，所以
   * "IR 在两条路上同形"这条判据放在这里 —— 在第一层（`compilePlan`）断言只能证明
   * 单条路正确，"Worker 那条路丢字段"照样能全绿（这个项目在 `prompt` / 假设 / 关系表上
   * 已经各踩过一次）。
   *
   * **显式打开开关**（控制器裁决 R6）：IR 是"默认关闭的新能力"，所以这里必须由调用方
   * 把 `obligationIR` 传进来，而不是靠缺省值。缺省那条路由下面一条用例守。
   */
  it("carries the unified obligation IR through PlanCompiler, DraftStore and the Worker path once it is switched on", async () => {
    const userMessage = "在三棱锥A-BCD中，BD=2，AB=AD，画示意图"
    const direct = setup()
    const directResult = await direct.store.stage(direct.draft.draftId, [action] as never, direct.draft.draftVersion, userMessage, undefined, true)
    expect(directResult.ok).toBe(true)
    if (!directResult.ok) return
    const ir = directResult.preview.diagramVerification?.obligationIR
    expect(ir?.obligations.map((item) => [item.role, item.kind, item.sourceText])).toEqual([
      ["given", "fixedLength", "BD=2"],
      ["given", "equalLength", "AB=AD"]
    ])
    expect(ir?.obligations.every((item) => item.judgeability === "supported")).toBe(true)
    // 来源区间必须能在原话上原样切回来：IR 出了编译层之后仍然可追溯。
    for (const item of ir?.obligations ?? []) expect(userMessage.slice(item.start, item.end)).toBe(item.sourceText)
    expect(direct.store.getPreview(direct.draft.draftId)?.diagramVerification?.obligationIR).toEqual(ir)

    const client = createGeometryWorkerClient(inlineWorker((request) => handleGeometryRequest(request as never)))
    const workerStore = createDraftStore(createIdAllocator, async ({ plan, document, conversationId, draftVersion, userMessage: prompt, obligationIR }) =>
      compileInWorker(client, { plan, document }, { runId: "worker-run", draftId: conversationId, draftVersion, prompt, obligationIR }))
    const workerDraft = workerStore.create(createEmptyDocument("geometry3d"))
    try {
      const workerResult = await workerStore.stage(workerDraft.draftId, [action] as never, workerDraft.draftVersion, userMessage, undefined, true)
      expect(workerResult.ok).toBe(true)
      if (workerResult.ok) expect(workerResult.preview.diagramVerification).toEqual(directResult.preview.diagramVerification)
    } finally { client.dispose() }
  })

  /**
   * **R6 的核心判据**：不传开关 = 关 = 与改动之前的报告逐字相同。
   *
   * 这条盯的是"新能力默认不生效"，而不是"IR 能不能算出来"。少了它，
   * "缺省 true + 生产调用方不传"这种**事实上的常开**会一路绿灯（正是 R6 要改掉的）。
   */
  it("leaves the diagram report exactly as before when nobody switches the IR on", async () => {
    const { store, draft } = setup()
    const result = await store.stage(draft.draftId, [action] as never, draft.draftVersion, "在三棱锥A-BCD中，BD=2，AB=AD，画示意图")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const report = result.preview.diagramVerification
    expect(report?.checks.map((item) => [item.kind, item.status, item.sourceText])).toEqual([
      ["fixedLength", "passed", "BD=2"],
      ["equalLength", "passed", "AB=AD"]
    ])
    expect(report?.sampleValues).toEqual([])
    expect(report?.status).toBe("passed")
    // 字段本身**不在**：不是"值是 undefined"，而是这份旧形状里没有它。
    expect(Object.keys(report ?? {}).sort()).toEqual(["checks", "sampleValues", "status"])
  })
})
