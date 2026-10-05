import { createEmptyDocument } from "@draw/dsl"
import { createIdAllocator } from "@draw/scene-graph"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createWorkerCompileStrategy, resetGeometryWorkerForTests } from "./geometryWorkerHost"
import type { WorkerLike } from "./geometryWorkerClient"
import { inlineWorker } from "./testing/inlineWorker"
import type { StagedPlanEnvelope } from "./geometryCompileStrategy"

/**
 * **生产那条 Worker 编译策略到底把 `witnessSearch` 带过了线程边界没有**（裁决 R11 / R37）。
 *
 * ## 为什么必须单独有这份用例
 *
 * `diagramDraftStage.test.ts` 里"开关穿过两条路"那条用的是**手写 strategy**：它自己构造
 * `compileInWorker` 的信封，自然会把开关带上。于是生产那条真策略
 * （`createWorkerCompileStrategy`，由 `agentRuntime.ts` 注入）**漏转发开关**这件事
 * 在整份测试里都是绿的 —— N1 的 `obligationIR` 复核抓到的正是这个。
 * 用假的线程 + **真的**策略，才可能发现"策略少取了一个字段"。
 *
 * ## 判据为什么落在"请求"与"救回来的文档"两处
 *
 * ① 开关为 `true` 时请求里必须**带了** `witnessSearch: true`；
 * ② Worker 侧真的按它救回了一次：响应里的候选文档已经不是模型那组歪坐标。
 * 只断言 ① 会漏掉"Worker 读了字段却没用"，只断言 ② 则漏掉"信封上根本没这个字段"
 * （假的线程在同一进程里，不经过序列化，光看结果看不出字段丢没丢）。
 *
 * ## 缺省那两条的**措辞纪律**（复核 R43 / M2）
 *
 * 生产装配（`agentRuntime.ts:241,271`）**永远**会传那个五键 flag 对象，所以线上真正出现的是
 * `witnessSearch: false`（不是"没有这个字段"）。"没给 ⇒ 线上没有这一项"只是**策略这一层**的
 * 契约，拿它当"生产上的缺省形状"就是在声称一件不会发生的事。所以这里分成两条分别钉：
 * - 没给（`undefined`）：线上没有这一项 —— 策略的既有语义；
 * - 给了 `false`（**真实装配的形状**）：线上是 `false`，而且**打不开任何东西** ——
 *   `parseWorkerRequest` 会把它剥掉、`workerRuntime.ts:87` 只认 `=== true`。
 */

/** 用户报障那道四棱锥：P 偏出垂足，模型给的坐标不满足题设。 */
function compileInput(witnessSearch?: boolean) {
  const document = createEmptyDocument("geometry3d")
  document.metadata.id = "doc-fixture"
  const plan: StagedPlanEnvelope = {
    schemaVersion: "mathcanvas.plan.v1",
    kind: "plan",
    goal: "画四棱锥",
    factIds: [],
    actions: [{
      actionId: "solid.create_polyhedron",
      actionKey: "pyramid",
      factIds: [],
      inputs: {
        alias: "pyramid",
        vertexNames: ["P", "A", "B", "C", "D"],
        vertices: [{ x: 1, y: 0, z: 4 }, { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 3, z: 0 }, { x: 0, y: 3, z: 0 }],
        faces: [[1, 2, 3, 4], [0, 2, 1], [0, 3, 2], [0, 4, 3], [0, 1, 4]]
      }
    }] as unknown as StagedPlanEnvelope["actions"]
  }
  return {
    plan,
    document,
    capabilityRevision: "draft",
    conversationId: "draft-host",
    draftVersion: 1,
    userMessage: "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，BC ∥ AD，AB ⊥ AD，画出这个四棱锥",
    allocator: createIdAllocator(document.primitives.map((primitive) => primitive.id)),
    ...(witnessSearch === undefined ? {} : { witnessSearch })
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

/** 候选文档里那只多面体的顶点坐标（顺序与物化动作的 `vertices` 一致）。 */
function verticesOf(document: { primitives: readonly { id: string; type: string }[] }): { x: number; y: number; z: number }[] {
  const solid = document.primitives.find((primitive) => primitive.type === "polyhedron3") as { vertexIds: string[] } | undefined
  if (!solid) throw new Error("候选文档里没有多面体")
  return solid.vertexIds.map((id) => {
    const vertex = document.primitives.find((primitive) => primitive.id === id) as { type: string; position: { x: number; y: number; z: number } } | undefined
    if (vertex?.type !== "point3") throw new Error(`顶点 ${id} 不在候选文档里`)
    return vertex.position
  })
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

describe("the worker compile strategy and the N2 witness-search switch", () => {
  it("forwards the witness-search switch to the worker instead of dropping it on the floor", async () => {
    const { factory, posted } = await recordingWorker()
    const strategy = createWorkerCompileStrategy("run-worker", factory)

    const result = await strategy(compileInput(true))

    expect(result.ok).toBe(true)
    expect(posted).toHaveLength(1)
    // 少了这一个字段，生产上 Worker 那条路的开关**永远看不到** —— R11 要消灭的正是它。
    expect(posted[0]?.witnessSearch).toBe(true)
    // 救回是真发生的：模型那组歪坐标（P 偏在 x = 1）不许留在候选里。
    expect(result.draftDocument).not.toBeNull()
    const vertices = verticesOf(result.draftDocument as never)
    // 顺序是**模型声明的点名顺序**（`P,A,B,C,D`）：救回只换坐标，不重排下标。
    expect(vertices[0]?.z).toBeGreaterThan(0)
    for (const base of vertices.slice(1)) expect(base?.z).toBeCloseTo(0, 9)
    expect(Math.abs((vertices[0]?.x ?? Number.NaN) - (vertices[1]?.x ?? Number.NaN))).toBeLessThan(1e-9)
    // 没有候选就不产生草稿是另一件事；这里确认"救回来了"的同时，系统选的值也带回来了。
    expect(result.assumptions.map((assumption) => assumption.text).join(" ")).toContain("系统自选")
  })

  it("leaves the switch off the wire when the strategy input does not carry it at all", async () => {
    const { factory, posted } = await recordingWorker()
    const strategy = createWorkerCompileStrategy("run-worker", factory)

    const result = await strategy(compileInput())

    expect(posted).toHaveLength(1)
    // 策略这一层的既有语义：没给 = 线上没有这一项（"多一个 undefined 字段"会让契约看起来像必填）。
    expect(Object.hasOwn(posted[0] ?? {}, "witnessSearch")).toBe(false)
    // 关着的时候与改动之前逐字相同：失败、没有草稿。
    expect(result.ok).toBe(false)
    expect(result.draftDocument).toBeNull()
  })

  it("never opens anything when the application passes the switch as false", async () => {
    const { factory, posted } = await recordingWorker()
    const strategy = createWorkerCompileStrategy("run-worker", factory)

    // **这条才是生产装配的形状**（`agentRuntime.ts:271` 传的是那个五键 flag 对象，
    // 关掉时值就是 `false`，不是"没有这个字段"）。
    const result = await strategy(compileInput(false))

    expect(posted).toHaveLength(1)
    expect(posted[0]?.witnessSearch).toBe(false)
    // `false` 打不开任何东西：Worker 侧按 `=== true` 读，于是救回不发生、结果与关着时相同。
    expect(result.ok).toBe(false)
    expect(result.draftDocument).toBeNull()
  })
})
