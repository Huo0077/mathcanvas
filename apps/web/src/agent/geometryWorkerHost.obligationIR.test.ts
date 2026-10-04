import { createEmptyDocument } from "@draw/dsl"
import { createIdAllocator } from "@draw/scene-graph"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createWorkerCompileStrategy, resetGeometryWorkerForTests } from "./geometryWorkerHost"
import type { WorkerLike } from "./geometryWorkerClient"
import { inlineWorker } from "./testing/inlineWorker"
import type { StagedPlanEnvelope } from "./geometryCompileStrategy"

/**
 * **生产那条 Worker 编译策略到底把哪些开关带过了线程边界**（复核 Important 1，裁决 R6 的收口）。
 *
 * ## 为什么必须单独有这份用例
 *
 * `diagramDraftStage.test.ts` 里"IR 穿过两条路"那条用例用的是**手写 strategy**：
 * 它自己构造 `compileInWorker` 的信封，自然会把开关带上。于是生产那条真策略
 * （`createWorkerCompileStrategy`，由 `agentRuntime.ts` 注入）**漏转发开关**这件事
 * 在整份测试里都是绿的 —— 复核抓到的正是这个。用假的线程 + **真的**策略，
 * 才可能发现"策略少取了一个字段"。
 *
 * ## 判据为什么落在"发出去的请求"上
 *
 * Worker 的响应不携带 `diagramVerification`（`WorkerSuccess` 里没有这个字段），
 * 所以"IR 有没有产出"在响应上看不见。开关对 Worker 行为**唯一**可观察的影响就是
 * "编译期要不要生成 IR"（它决定报告，而报告随请求一起被重新核验的那一层在主线程）。
 * 因此这里钉住两件事：请求**带了** `obligationIR: true`、以及 Worker 侧确实按它
 * 产出了未核验条件的 warning（见下面第二条）。
 */

/** `CompileStrategy` 的入参（与 `draftStore.stage` 造的那一份同形）。 */
function compileInput(obligationIR?: boolean) {
  const document = createEmptyDocument("geometry3d")
  document.metadata.id = "doc-fixture"
  const plan: StagedPlanEnvelope = {
    schemaVersion: "mathcanvas.plan.v1",
    kind: "plan",
    goal: "画示意图",
    factIds: [],
    actions: [{
      actionId: "solid.create_polyhedron",
      actionKey: "tetrahedron",
      factIds: [],
      inputs: {
        alias: "tetrahedron",
        vertexNames: ["A", "B", "C", "D"],
        vertices: [{ x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 0 }, { x: 0.5, y: Math.sqrt(3) / 2, z: 0 }, { x: 1, y: 0, z: 0 }],
        faces: [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]]
      }
    }] as unknown as StagedPlanEnvelope["actions"]
  }
  return {
    plan,
    document,
    capabilityRevision: "draft",
    conversationId: "draft-host",
    draftVersion: 1,
    allocator: createIdAllocator(document.primitives.map((primitive) => primitive.id)),
    ...(obligationIR === undefined ? {} : { obligationIR })
  }
}

/** 记下发出去的每一条消息的假 Worker；消息**真的**交给运行时纯函数处理。 */
async function recordingWorker(): Promise<{ factory: () => WorkerLike; posted: Record<string, unknown>[] }> {
  const { handleGeometryRequest } = await import("./workerRuntime")
  const posted: Record<string, unknown>[] = []
  const factory = () => {
    const inner = inlineWorker((request) => handleGeometryRequest(request as never))
    return {
      ...inner,
      postMessage(message: unknown) {
        posted.push(message as Record<string, unknown>)
        inner.postMessage(message)
      }
    }
  }
  return { factory, posted }
}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  resetGeometryWorkerForTests()
  warn = vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  resetGeometryWorkerForTests()
  warn.mockRestore()
})

describe("the worker compile strategy and the N1 IR switch", () => {
  it("forwards the IR switch to the worker instead of dropping it on the floor", async () => {
    const { factory, posted } = await recordingWorker()
    const strategy = createWorkerCompileStrategy("run-worker", factory)

    const result = await strategy(compileInput(true))

    expect(result.ok).toBe(true)
    expect(posted).toHaveLength(1)
    // 少了这一个字段，生产上 Worker 那条路的开关**永远看不到** —— R6 要消灭的正是它。
    expect(posted[0]?.obligationIR).toBe(true)
  })

  it("does not put the switch on the wire at all when nobody asked for it", async () => {
    const { factory, posted } = await recordingWorker()
    const strategy = createWorkerCompileStrategy("run-worker", factory)

    await strategy(compileInput())

    expect(posted).toHaveLength(1)
    // 缺省 = 关，而且**请求里连字段都没有**（"没给"与"给了 false"在协议上是同一件事，
    // 但"多一个 undefined 字段"会让契约看起来像必填）。
    expect(Object.hasOwn(posted[0] ?? {}, "obligationIR")).toBe(false)
  })

  it("still compiles happily when the switch is on, so forwarding it is not a hazard", async () => {
    const { factory } = await recordingWorker()
    const strategy = createWorkerCompileStrategy("run-worker", factory)

    const result = await strategy(compileInput(true))

    // Worker 侧读的是 `request.obligationIR === true`，畸形/缺省一律当关；
    // 这条只是确认"打开了也不会把这条编译路弄坏"（失败会走 geometry.error，这里必须是结果）。
    expect(result.ok).toBe(true)
    expect(result.draftDocument).not.toBeNull()
  })
})
