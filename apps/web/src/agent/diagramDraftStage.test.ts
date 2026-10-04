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
})
