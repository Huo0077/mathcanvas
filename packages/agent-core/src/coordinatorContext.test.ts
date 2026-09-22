import { describe, expect, it, vi } from "vitest"

import { createBudget } from "./budget"
import { createCoordinator } from "./coordinator"
import type { CommitterPort, Observation, ObserverPort, PlanRequest, PlannerPort } from "./coordinatorPorts"
import type { DocumentHandle, PlanEnvelope, RunContext } from "./contracts"

/**
 * **上下文与工具真的被组装并交给规划器**（Task 2.2 Step 4 / Task 2.3 的接线）。
 *
 * 在接线之前，`PlanRequest` 只有 `run` / `userMessage` / `budget` / `signal` ——
 * 一个 provider 适配器**拿不到任何场景信息**，只能自己再造一份。这就是
 * `buildContext` 与 `createToolRegistry` 一直是"有实现、有测试、没有生产调用方"的根因。
 *
 * 这个文件钉住三件事：
 * 1. 规划器拿到的 `model.context` 确实是 `buildContext` 的产物（事实来自观察，不是空的）；
 * 2. 规划阶段发布的工具里**没有任何写文档的工具**（安全边界，靠注册表而不是靠自觉）；
 * 3. 两次尝试（含那次 schema 修复）看到的是**同一份**上下文与工具 —— 否则"第二次机会"
 *    其实换了题目，事后无法判断是模型改好了还是条件变了。
 */
const handle: DocumentHandle = { projectId: "p", documentId: "doc-1", workspace: "conics", epoch: "epoch:doc-1", generation: 1, contentHash: "hash-1" }
const run: RunContext = {
  runId: "run-1",
  conversationId: "conv-1",
  promptMessageId: "msg-1",
  target: handle,
  sources: [],
  textProfileId: "profile-1",
  capabilityRevision: "rev",
  policyRevision: "policy"
}

const observation: Observation = {
  factIds: ["point-1"],
  summary: "one point at the origin",
  facts: [{ id: "point-1", text: "点 A 在原点", origin: "user" }]
}

function planEnvelope(): PlanEnvelope {
  return { schemaVersion: "mathcanvas.plan.v1", kind: "answer", goal: "数点", factIds: ["point-1"], answer: "1", toolResultRefs: [] }
}

function harness(plans: (() => PlanEnvelope)[]) {
  const seen: PlanRequest[] = []
  let index = 0
  const planner: PlannerPort = {
    plan: vi.fn(async (request: PlanRequest) => {
      seen.push(request)
      const next = plans[Math.min(index, plans.length - 1)]
      index += 1
      return { plan: next(), requestId: `req-${index}`, attemptId: `attempt-${index}` }
    })
  }
  const observer: ObserverPort = { observe: vi.fn(async () => observation) }
  const committer: CommitterPort = {
    stage: vi.fn(async () => ({ ok: true as const, draftVersion: 1, previewHash: "preview-1" })),
    commit: vi.fn(async () => ({ status: "committed" as const, handle }))
  }
  const coordinator = createCoordinator({ planner, observer, committer, budget: createBudget() })
  return { coordinator, seen }
}

async function drive(coordinator: ReturnType<typeof createCoordinator>) {
  const phases: string[] = []
  for await (const event of coordinator.start({ run, userMessage: "数一下有几个点" })) phases.push(event.phase)
  return phases
}

describe("the coordinator assembles what the model may see", () => {
  it("hands the planner a context built from the observation, not a bare prompt", async () => {
    const { coordinator, seen } = harness([planEnvelope])

    await drive(coordinator)

    expect(seen).toHaveLength(1)
    const context = seen[0].model.context
    // 事实来自观察端口，而且带**文本**（只有 id 的话模型等于没看到）。
    expect(context.facts.map((fact) => fact.text)).toEqual(["点 A 在原点"])
    expect(context.facts[0].origin).toBe("user")
    expect(context.handles.target.documentId).toBe("doc-1")
    expect(context.workspace).toBe("conics")
    // 上下文会原样进提示词，所以它必须能自报"有多大"。
    expect(context.estimatedCharacters).toBeGreaterThan(0)
  })

  it("publishes no document-writing tool during planning", async () => {
    const { coordinator, seen } = harness([planEnvelope])

    await drive(coordinator)

    const tools = seen[0].model.tools
    expect(tools.length).toBeGreaterThan(0)
    // 计划 Task 0.8 Step 3："do not expose `commit` as a model-facing tool"。
    expect(tools.some((tool) => tool.id === "draft.confirm_commit")).toBe(false)
    expect(tools.every((tool) => tool.effect !== "commit")).toBe(true)
  })

  it("gives both plan attempts the same context and the same tools", async () => {
    // 第一次给一个 schema 不合法的信封，第二次才合法 → 协调器会再问一次（可见的一次性修复）。
    const { coordinator, seen } = harness([
      () => ({ kind: "not-a-plan" } as unknown as PlanEnvelope),
      planEnvelope
    ])

    const phases = await drive(coordinator)

    expect(phases.at(-1)).toBe("completed")
    expect(seen.length).toBeGreaterThanOrEqual(2)
    // 同一份上下文（按值比较）：换题目式的"重试"没有意义。
    expect(seen[1].model.context).toEqual(seen[0].model.context)
    expect(seen[1].model.tools.map((tool) => tool.id)).toEqual(seen[0].model.tools.map((tool) => tool.id))
  })

  /**
   * **一次性修复必须告诉规划器上一次错在哪**（Task 2.3 Step 5 / Task 2.1 Step 1 的 "invalid output"）。
   *
   * 在接线之前，协调器**确实**会再问一次（`MAX_PLAN_ATTEMPTS = 2`），但**不告诉规划器上一次错在哪** ——
   * 于是第二次尝试只会把同一份请求原样再发一遍，模型没有任何理由换个答案，
   * "一次性修复"实际上退化成"重试一次"。
   *
   * 修复提示的构造函数（`outputParser.describeRepairPrompt`）早就写好并有测试，只是没人调它 ——
   * 又一处"有实现、没接上"。
   */
  it("tells the second attempt exactly what was wrong with the first", async () => {
    const { coordinator, seen } = harness([
      // 缺 `actions` 的计划：解析器会给 `empty_actions` + 具体路径。
      () => ({ schemaVersion: "mathcanvas.plan.v1", kind: "plan", goal: "空计划", factIds: [], actions: [] } as unknown as PlanEnvelope),
      planEnvelope
    ])

    await drive(coordinator)

    // 第一次尝试没有"上一次"可讲。
    expect(seen[0].repair).toBeUndefined()
    // 第二次带上原因、逐条错误与可执行的修复提示。
    const repair = seen[1].repair
    expect(repair).toBeDefined()
    expect(repair!.reason).toBe("schema_invalid")
    expect(repair!.errors.map((error) => error.code)).toContain("empty_actions")
    // 计划原文要求 "include exact JSON path errors" —— 路径必须具体到字段。
    expect(repair!.hint).toContain("envelope.actions")
    expect(repair!.errors.some((error) => error.path === "envelope.actions")).toBe(true)
  })

  it("keeps the context bounded and says so when facts are dropped", async () => {    const many: Observation = {
      factIds: Array.from({ length: 20 }, (_, index) => `f-${index}`),
      summary: "twenty points",
      facts: Array.from({ length: 20 }, (_, index) => ({ id: `f-${index}`, text: `点 ${index}`, origin: "user" as const }))
    }
    const planner: PlannerPort = { plan: vi.fn(async (request: PlanRequest) => {
      captured = request
      return { plan: planEnvelope(), requestId: "req-1", attemptId: "attempt-1" }
    }) }
    let captured: PlanRequest | null = null
    const coordinator = createCoordinator({
      planner,
      observer: { observe: vi.fn(async () => many) },
      committer: { stage: vi.fn(async () => ({ ok: true as const, draftVersion: 1, previewHash: "p" })), commit: vi.fn(async () => ({ status: "committed" as const, handle })) },
      budget: createBudget(),
      contextLimits: { facts: 12 }
    })

    await drive(coordinator)

    expect(captured!.model.context.facts).toHaveLength(12)
    // 截断要**留痕**：否则"为什么模型没看到我刚说的那条"无从查起。
    expect(captured!.model.context.warnings.map((warning) => warning.code)).toContain("truncated_facts")
  })

  /**
   * **派生读数一路走到规划器手里**（规格 §3.4 / §6.2）。
   *
   * 观察端口产出读数、`buildContext` 会搬运它们，但**组装这一步在协调器**：
   * 少了这一行，读数就停在观察对象里，模型看到的场景仍然只有"有几只多面体"，
   * 而"它到底有没有外接球"只能靠猜 —— 这正是本切片要消灭的那种猜测。
   * 会话上下文那一份也要带（那是提示词渲染 `scene` 的另一条来源）。
   */
  it("hands the planner the derived readings that the observation produced", async () => {
    const reading = { entityId: "solid-1", code: "derived.circumsphere", status: "undefined" as const, message: "外接球：该多面体没有外接球：找不到到所有顶点等距的点。" }
    let captured: PlanRequest | null = null
    const planner: PlannerPort = { plan: vi.fn(async (request: PlanRequest) => {
      captured = request
      return { plan: planEnvelope(), requestId: "req-1", attemptId: "attempt-1" }
    }) }
    const coordinator = createCoordinator({
      planner,
      observer: { observe: vi.fn(async () => ({ ...observation, derived: [reading] })) },
      committer: { stage: vi.fn(async () => ({ ok: true as const, draftVersion: 1, previewHash: "p" })), commit: vi.fn(async () => ({ status: "committed" as const, handle })) },
      budget: createBudget()
    })

    await drive(coordinator)

    // 四态里的 `undefined` 与它的**原因**都要在：只给状态码，模型还是会编一个球出来。
    expect(captured!.model.context.derived).toEqual([reading])
    expect(captured!.conversation?.observation.derived).toEqual([reading])
  })
})
