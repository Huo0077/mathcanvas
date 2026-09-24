import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "@draw/agent-core"
import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { createIdAllocator } from "@draw/scene-graph"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { compileInProcess, type StagedPlanEnvelope } from "./geometryCompileStrategy"
import type { WorkerLike } from "./geometryWorkerClient"
import { createWorkerCompileStrategy, geometryWorkerForPage, resetGeometryWorkerForTests } from "./geometryWorkerHost"
import { obliquePrismSectionPlan } from "./representativeFixtures"
import { inlineWorker } from "./testing/inlineWorker"

/**
 * **几何 Worker 的宿主**（方案 3 收口时补上的那一层）到底能不能用、以及**起不来时会不会骗人**。
 *
 * 三件事必须有用例钉住，缺一条这个接线就只算"写完了"：
 *
 * 1. **每个页面一份**：`createAgentRuntime` 是每轮运行建一次的，Worker 只能在别处建 ——
 *    所以"同一个页面里调两次拿到的必须是同一只"这条性质是那个决定的全部依据。
 * 2. **随页面卸载终止**：不终止就是泄漏线程。
 * 3. **起不来时如实降级，且降级走的必须是同一个 `compileInProcess`**：
 *    这条是**回归用例** —— 这里曾经有一份抄来的"就地编译"，它漏传了 `prompt`（用户原话），
 *    于是"这台机器没有 Worker"会让同一份计划编出**不同结果**（`agentRuntime.test.ts` 与
 *    `compilerRepair.test.ts` 各有一条用例抓到了它）。所以下面用**同一份计划、两句原话**
 *    来断言：差别只可能来自"原话有没有传下去"。
 */

/** `PlanEnvelope.actions` 的元素类型（用例里造的是"传输形状"，可缺省字段交给审计）。 */
type PlanAction = PlanEnvelope extends { actions: (infer T)[] } ? T : never

/**
 * 底面与向量**都缺**的棱柱计划。
 *
 * 它在两句话下的结局必须不同（复用 `agentRuntime.test.ts` 里那条既有的代表题）：
 * - "画一个任意棱柱" → 题目要求任意，**不许**特值化 → 审计拒绝，编不过；
 * - "画一个棱柱" → 缺省有安全默认 → 回填并编过。
 */
const dimensionLessPrismPlan = (): StagedPlanEnvelope => ({
  schemaVersion: PLAN_SCHEMA_VERSION,
  kind: "plan",
  goal: "画一个棱柱",
  factIds: [],
  actions: [{ actionId: "solid.create_prism", actionKey: "prism", factIds: [], inputs: { alias: "prism" } } as unknown as PlanAction]
})

/** `CompileStrategy` 的入参（分配器按基准文档现建，与 `stage` 一样）。 */
function compileInput(plan: StagedPlanEnvelope, userMessage?: string) {
  const document: GeometryDocument = createEmptyDocument("geometry3d")
  /**
   * 把文档 id 钉死：`createEmptyDocument` 每次生成一个随机的，而**操作里的 host 引用会带上它**
   *（`inputs.host.documentId`）。不钉死的话，"两条路编出了同样的东西"这条断言会被
   * "两次跑的不是同一份文档"掩盖 —— 那是**夹具**的噪声，不是被测行为的差别。
   */
  document.metadata.id = "doc-fixture"
  return {
    plan,
    document,
    capabilityRevision: "draft",
    conversationId: "draft-host",
    draftVersion: 1,
    allocator: createIdAllocator(document.primitives.map((primitive) => primitive.id)),
    ...(userMessage === undefined ? {} : { userMessage })
  }
}

/**
 * 把"这是**哪一次**编译"的信息剔掉，只留"编出了**什么**"。
 *
 * `createdAt` / `updatedAt` 每次编译都不同（那是时刻，不是产物），留着它们会让下面那条
 * 等价断言永远失败 —— 而失败原因是夹具，不是两条路有差别。
 */
function product(result: { operations: readonly unknown[]; draftDocument: GeometryDocument | null }) {
  return {
    operations: JSON.parse(JSON.stringify(result.operations)),
    primitives: result.draftDocument === null ? null : JSON.parse(JSON.stringify(result.draftDocument.primitives))
  }
}

/** 一只"能看出自己被终止过"的假 Worker。 */
function trackedWorker(): { worker: WorkerLike; terminated: () => number } {
  const inner = inlineWorker(() => null)
  let count = 0
  return {
    worker: { ...inner, terminate() { count += 1; inner.terminate() } },
    terminated: () => count
  }
}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  resetGeometryWorkerForTests()
  // 没有 `Worker` 的环境里降级必然发生，控制台提示本身另有断言 —— 这里不让它刷屏。
  warn = vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  resetGeometryWorkerForTests()
  warn.mockRestore()
})

describe("the geometry worker's page lifetime", () => {
  it("builds one worker per page and hands the same client to every caller", () => {
    let spawned = 0
    const factory = () => {
      spawned += 1
      return inlineWorker(() => ({ ok: false }))
    }

    const first = geometryWorkerForPage(factory)
    expect(geometryWorkerForPage(factory)).toBe(first)
    // 建两只就等于"每轮运行泄漏一只"（那正是它不建在 createAgentRuntime 里的原因）。
    expect(spawned).toBe(1)
  })

  it("terminates the page's worker when the singleton is dropped", () => {
    const { worker, terminated } = trackedWorker()
    const first = geometryWorkerForPage(() => worker)
    expect(terminated()).toBe(0)

    resetGeometryWorkerForTests()
    expect(terminated()).toBe(1)

    // 丢掉之后必须能重新建（否则测试之间会互相污染，生产里也是一次性的）。
    const second = geometryWorkerForPage(() => trackedWorker().worker)
    expect(second).not.toBe(first)
  })

  it("disposes on pagehide so the thread does not outlive the page", () => {
    const { worker, terminated } = trackedWorker()
    geometryWorkerForPage(() => worker)
    expect(terminated()).toBe(0)

    globalThis.dispatchEvent(new Event("pagehide"))
    expect(terminated()).toBe(1)
  })
})

describe("picking the compile path", () => {
  it("actually goes through the worker when one can be built", async () => {
    let spawned = 0
    const { handleGeometryRequest } = await import("./workerRuntime")
    const strategy = createWorkerCompileStrategy("run-worker", () => {
      spawned += 1
      // 假 Worker 把消息**真的**交给运行时纯函数：覆盖真链路，只把"线程"换成函数调用。
      return inlineWorker((request) => handleGeometryRequest(request as never))
    })

    const result = await strategy(compileInput(obliquePrismSectionPlan() as StagedPlanEnvelope))
    expect(spawned).toBe(1)
    expect(result.ok).toBe(true)
    // 走通 Worker 就没有降级提示。
    expect(warn).not.toHaveBeenCalled()
  })

  it("keeps the user's words when no worker can be built at all", async () => {
    // 这台环境压根没有 Worker（node / vitest / 某些 WebView）：工厂**抛**。
    const strategy = createWorkerCompileStrategy("run-fallback", () => { throw new Error("Worker is not defined") })

    const invariant = await strategy(compileInput(dimensionLessPrismPlan(), "画一个任意棱柱"))
    expect(invariant.ok).toBe(false)
    expect(invariant.draftDocument).toBeNull()

    // 对照组：同一份计划、一句没有"任意"的话 → 缺省被回填，编得过。
    // 这一对断言就是"原话真的传下去了"的判据 —— 少了 prompt，两句会给出同一个结局。
    const ordinary = await strategy(compileInput(dimensionLessPrismPlan(), "画一个棱柱"))
    expect(ordinary.ok).toBe(true)
    expect(ordinary.draftDocument).not.toBeNull()
  })

  it("falls back to exactly the in-process result, not a lookalike", async () => {
    const plan = obliquePrismSectionPlan() as StagedPlanEnvelope
    const strategy = createWorkerCompileStrategy("run-fallback", () => { throw new Error("Worker is not defined") })

    // 两份输入各自造（分配器有状态，共用一只会让第二次发号不同）。
    const viaFallback = await strategy(compileInput(plan, "画一个棱柱"))
    const inProcess = compileInProcess(compileInput(plan, "画一个棱柱"))
    expect(product(viaFallback)).toEqual(product(inProcess))
  })

  it("says out loud that it degraded, once per page, with the reason", async () => {
    const strategy = createWorkerCompileStrategy("run-fallback", () => { throw new Error("Worker is not defined") })
    await strategy(compileInput(dimensionLessPrismPlan(), "画一个棱柱"))
    await strategy(compileInput(dimensionLessPrismPlan(), "画一个棱柱"))

    // **如实**：不是"静默降级"（评审点名的那条）。原因要能读出来。
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain("Worker is not defined")
  })
})
