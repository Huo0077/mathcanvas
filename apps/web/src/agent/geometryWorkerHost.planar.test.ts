import { createEmptyDocument } from "@draw/dsl"
import { createIdAllocator } from "@draw/scene-graph"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createWorkerCompileStrategy, resetGeometryWorkerForTests } from "./geometryWorkerHost"
import type { WorkerLike } from "./geometryWorkerClient"
import { inlineWorker } from "./testing/inlineWorker"
import type { StagedPlanEnvelope } from "./geometryCompileStrategy"

/**
 * **V0b 的 Worker 那一侧**：平面作图题的原文核验，在生产那条真策略上走不走得通。
 *
 * ## 为什么必须用「假线程 + 真策略」而不是就地编译
 *
 * 已有一条用例证明 `draftStore` 在**就地**那条路上会核验平面题设。但生产装配
 * （`agentRuntime.ts` 注入 `createWorkerCompileStrategy`）走的是**另一条路**：
 * 计划与原话要先装进一份**请求信封**、跨过线程边界，Worker 侧再调 `compilePlan`。
 *
 * 核验在 Worker 里能不能跑，取决于两件容易漏掉的事：① 信封里到底有没有带上 **`prompt`**
 *（`compilePlan` 的核验触发条件是「有原话 + 有点名动作」，没有原话就根本不会去解析题设）；
 * ② Worker 侧有没有把它读进去用。只断言其中一条都不够：只测信封会漏"读了没用"，
 * 只测结果会漏"字段根本没装进去"（假线程在同一进程里、不经过序列化，光看结果看不出字段丢没丢）。
 *
 * ## 为什么不在这里断言 `diagramVerification`
 *
 * **那条通道按设计不走回程**：`compileInWorker` 的成功分支只映射文档 / 操作 / 假设 /
 * 被物化动作，核验报告由 `draftStore` 拿候选文档**重新算一遍**再落进预览
 *（面板上那份报告来自草稿层）。在这里断言它，等于要求一条**故意不存在**的传输。
 * 真正能证明"Worker 里也验了"的读数是：**同一份计划、只把坐标改坏，Worker 就会拒绝** ——
 * 因为拒绝正是 `compilePlan` 拿到原话、逐条量过之后才可能发生的。
 */
const PLANAR_PROMPT = "在三角形ABC中，AB⊥AC，画示意图"

/** `c` 是唯一的变量：满足题设与违反题设之间只差它一个。 */
function planarInput(c: { x: number; y: number }) {
  const document = createEmptyDocument("conics")
  document.metadata.id = "doc-planar-fixture"
  const plan: StagedPlanEnvelope = {
    schemaVersion: "mathcanvas.plan.v1",
    kind: "plan",
    goal: "作三角形 ABC，满足 AB ⊥ AC",
    factIds: [],
    actions: [
      { actionId: "planar.create_point", actionKey: "A", factIds: [], inputs: { alias: "A", points: [{ x: 0, y: 0 }], label: "A" } },
      { actionId: "planar.create_point", actionKey: "B", factIds: [], inputs: { alias: "B", points: [{ x: 2, y: 0 }], label: "B" } },
      { actionId: "planar.create_point", actionKey: "C", factIds: [], inputs: { alias: "C", points: [{ ...c }], label: "C" } }
    ] as unknown as StagedPlanEnvelope["actions"]
  }
  return {
    plan,
    document,
    capabilityRevision: "draft",
    conversationId: "draft-host-planar",
    draftVersion: 1,
    userMessage: PLANAR_PROMPT,
    allocator: createIdAllocator(document.primitives.map((primitive) => primitive.id))
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

describe("V0b: the worker compile strategy verifies planar premises too", () => {
  it("carries the prompt across the thread, so the worker has premises to check at all", async () => {
    const { factory, posted } = await recordingWorker()
    const strategy = createWorkerCompileStrategy("run-worker-planar", factory)

    const result = await strategy(planarInput({ x: 0, y: 3 }))

    expect(result.ok, result.diagnostics.map((item) => item.detail).join("; ")).toBe(true)
    expect(result.draftDocument).not.toBeNull()
    // 少了这一个字段，Worker 侧的核验触发条件根本不成立 —— 这与 V0a 那条"开关漏转发"是同一种漏。
    expect(posted).toHaveLength(1)
    expect(posted[0]?.prompt).toBe(PLANAR_PROMPT)
  })

  it("refuses the same plan in the worker once the coordinates contradict the premise", async () => {
    const { factory } = await recordingWorker()
    const strategy = createWorkerCompileStrategy("run-worker-planar", factory)

    // 同一份计划、只把 C 挪到 AB 上。跨线程之后**照样**不许落草稿 ——
    // 这条正是"Worker 里真的逐条量过"的读数：拒绝只可能来自拿到原话之后的核验。
    const result = await strategy(planarInput({ x: 3, y: 0 }))

    expect(result.ok).toBe(false)
    expect(result.draftDocument).toBeNull()
    expect(result.diagnostics.map((item) => item.detail).join(" ")).toContain("AB⊥AC")
  })
})

/**
 * **Task 7（2026-10-12）：宿主缺席时补出来的那一笔，在 Worker 里同样发生。**
 *
 * 计划 Task 7 的退出条件里有一条是"**Worker 和主线程不得不同判**"。两条编译路调的是
 * 同一个 `compilePlan`，所以按构造同判 —— 但"按构造"是推理，不是读数。
 * 这条用例把读数补上：同一份**没有宿主**的计划，跨过线程边界之后，
 * 图上照样出现系统补出来的 `A`/`B`/`C`/`D`。
 *
 * 为什么它比主线程那条更能说明问题：Worker 侧要能补，得先有**两样东西过边界** ——
 * 原话（`prompt`）与构造函数构造坐标的开关（`witnessSearch`）。少了任何一样，
 * Worker 里都只会有模型那一笔孤零零的点。
 */
describe("Task 7: the worker synthesises the missing host too", () => {
  const QUAD_PROMPT = "平面四边形ABCD中，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3"

  /** 计划里**只有一笔点**：它可核验、却不产出面 ⇒ 正好是"缺宿主"那个形状。 */
  function noHostInput() {
    const document = createEmptyDocument("geometry3d")
    document.metadata.id = "doc-worker-synthesis"
    const plan: StagedPlanEnvelope = {
      schemaVersion: "mathcanvas.plan.v1",
      kind: "plan",
      goal: "作平面四边形 ABCD",
      factIds: [],
      actions: [
        { actionId: "planar.create_point", actionKey: "p", factIds: [], inputs: { alias: "p", points: [{ x: 0, y: 0 }], label: "p" } }
      ] as unknown as StagedPlanEnvelope["actions"]
    }
    return {
      plan,
      document,
      capabilityRevision: "draft",
      conversationId: "draft-host-synthesis",
      draftVersion: 1,
      userMessage: QUAD_PROMPT,
      witnessSearch: true,
      allocator: createIdAllocator(document.primitives.map((primitive) => primitive.id))
    }
  }

  it("synthesises the missing host inside the worker, exactly as it does on the main thread", async () => {
    const { factory, posted } = await recordingWorker()
    const strategy = createWorkerCompileStrategy("run-worker-synthesis", factory)

    const result = await strategy(noHostInput())

    expect(result.ok, result.diagnostics.map((item) => item.detail).join("; ")).toBe(true)
    // 模型那版里**没有面**；图上出现 A/B/C/D ⇒ 那一笔只可能是在 Worker 里补出来的。
    const labels = (result.draftDocument?.primitives ?? [])
      .filter((primitive) => primitive.type === "point3")
      .map((primitive) => String((primitive as { label?: string }).label))
    for (const name of ["A", "B", "C", "D"]) {
      expect(labels, `${name} 没有在 Worker 里被补出来`).toContain(name)
    }
    // 开关本身也必须过边界 —— 少了它，Worker 侧根本不会去构造坐标。
    expect(posted[0]?.witnessSearch).toBe(true)
  })
})
