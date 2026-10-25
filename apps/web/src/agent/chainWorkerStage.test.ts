import { createEmptyDocument } from "@draw/dsl"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createDraftStore } from "./draftStore"
import { createWorkerCompileStrategy, resetGeometryWorkerForTests } from "./geometryWorkerHost"
import { inlineWorker } from "./testing/inlineWorker"

/**
 * **生产 Worker 编译策略 + 草稿核验：连等题设也要一致**（2026-10-26）。
 *
 * `draftStore.test.ts` 走的是同进程编译策略；生产注入的是
 * `createWorkerCompileStrategy` + Worker 线程。本用例用**真的**生产策略与
 * `inlineWorker(handleGeometryRequest)`（与浏览器同一份 Worker 运行时），
 * 验证用户原题在"过线程边界"之后仍然读得全、核验得过。
 */
const PROMPT = "四棱锥 P-ABCD 中，平面 PAD ⊥ 平面 ABCD，AB∥CD，AB⊥AD，M 为 AD 中点，PA=PD=√5，AD=AB=2CD=2。 （1）求证：平面 PMB ⊥ 平面 PAC； （2）求二面角 A-PC-D 的余弦值。"

const plan = {
  schemaVersion: "mathcanvas.plan.v1",
  kind: "plan",
  goal: "画题设示意图",
  factIds: [],
  actions: [
    {
      actionId: "solid.create_polyhedron", actionKey: "solid", factIds: [],
      inputs: {
        alias: "solid",
        vertexNames: ["P", "A", "B", "C", "D"],
        vertices: [
          { x: 1, y: 0, z: 2 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }, { x: 2, y: 1, z: 0 }, { x: 2, y: 0, z: 0 }
        ],
        faces: [[1, 4, 3, 2], [0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1]]
      }
    },
    {
      actionId: "dynamic.create_bound_point", actionKey: "midpoint", factIds: [],
      inputs: { alias: "M", host: { scope: "draft", alias: "solid" }, hostSub: 0, parameter: 0.5, label: "M" }
    }
  ]
} as unknown as Parameters<ReturnType<typeof createDraftStore>["stage"]>[1]

beforeEach(() => {
  resetGeometryWorkerForTests()
})

afterEach(() => {
  resetGeometryWorkerForTests()
})

describe("chain equality survives the worker boundary", () => {
  it("stages the user's problem with every condition verified", async () => {
    const { handleGeometryRequest } = await import("./workerRuntime")
    const strategy = createWorkerCompileStrategy("run-worker", () => inlineWorker((request) => handleGeometryRequest(request as never)))
    const store = createDraftStore(undefined, strategy)
    const record = store.create(createEmptyDocument("geometry3d"))

    const staged = await store.stage(record.draftId, (plan as unknown as { actions: never }).actions, record.draftVersion, PROMPT)

    expect(staged.ok, staged.ok ? "" : JSON.stringify(staged)).toBe(true)
    if (!staged.ok) return
    expect(staged.preview.diagramVerification?.status).toBe("passed")
    expect(staged.preview.completionAssumptions).toBeDefined()
  })
})
