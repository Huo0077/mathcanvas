import { describe, expect, it, vi } from "vitest"

import { createBudget, type BudgetLimits } from "./budget"
import { createCoordinator } from "./coordinator"
import type { CommitterPort, ConsentToken, Observation, ObserverPort, PlanOutcome, PlannerPort, PlanRequest } from "./coordinatorPorts"
import type { DocumentHandle, PlanEnvelope, RepairRequest, RunContext, ToolResult } from "./contracts"

/**
 * Task 2.1 Step 1 点名的九个场景，一个不少：
 * 成功只读、成功草稿、缺事实、输出非法、草稿过期、提交前取消、提交中取消、provider 失败、应用中断。
 *
 * 全部用**脚本化端口**驱动，不需要任何模型、网络或 worker —— 这也是把四组端口做成注入的理由。
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
const consent: ConsentToken = { kind: "user_consent", nonce: "nonce-1", previewHash: "preview-1" }
const facts: Observation = { factIds: ["fact-1"], summary: "one point at the origin" }

/**
 * 一条合法动作。
 *
 * 注意 `packages/agent-core/src/schemas.ts` 的 `ACTIONS` 只登记了**四个**动作
 *（`solid.create_template` / `section.create` / `object.delete` / `object.update`），
 * 所以这里必须用其中之一；给一个没登记的名字会被 `parseDraftAction` 判 `unknown_action`。
 */
function action(alias: string) {
  return { actionId: "solid.create_template" as const, actionKey: alias, factIds: ["fact-1"], inputs: { alias, template: "cube" as const, origin: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 } } }
}

function planEnvelope(actionCount = 1): PlanEnvelope {
  // 计划信封的顶层字段是白名单：多一个都会被 `parsePlanEnvelope` 拒。
  return { schemaVersion: "mathcanvas.plan.v1", kind: "plan", goal: "draw a point", factIds: ["fact-1"], actions: Array.from({ length: actionCount }, (_, index) => action(`p${index + 1}`)) }
}

function answerEnvelope(): PlanEnvelope {
  return { schemaVersion: "mathcanvas.plan.v1", kind: "answer", goal: "count", factIds: ["fact-1"], answer: "1", toolResultRefs: [] }
}

function makeHarness(options: { plan?: () => Promise<PlanOutcome> | PlanOutcome; stage?: CommitterPort["stage"]; commit?: CommitterPort["commit"]; observation?: Observation; limits?: Parameters<typeof createBudget>[0] } = {}) {
  const calls: string[] = []
  const planner: PlannerPort = {
    plan: vi.fn(async () => {
      calls.push("plan")
      return options.plan ? await options.plan() : { plan: planEnvelope(), requestId: "req-1", attemptId: "attempt-1" }
    })
  }
  const observer: ObserverPort = {
    observe: vi.fn(async () => {
      calls.push("observe")
      return options.observation ?? facts
    })
  }
  const committer: CommitterPort = {
    stage: vi.fn(options.stage ?? (async () => {
      calls.push("stage")
      return { ok: true as const, draftVersion: 2, previewHash: "preview-1" }
    })),
    commit: vi.fn(options.commit ?? (async () => {
      calls.push("commit")
      return { status: "committed" as const, handle: { ...handle, generation: 2 } }
    }))
  }
  const budget = createBudget(options.limits)
  const coordinator = createCoordinator({ planner, observer, committer, consent, budget })
  return { coordinator, planner, observer, committer, calls, budget }
}

async function drive(coordinator: ReturnType<typeof createCoordinator>, request: Parameters<ReturnType<typeof createCoordinator>["start"]>[0]) {
  const events = []
  for await (const event of coordinator.start(request)) events.push(event)
  return events
}

describe("coordinator success paths", () => {
  it("walks a read-only run to completion and never touches the document", async () => {
    const harness = makeHarness({ plan: () => ({ plan: answerEnvelope(), requestId: "req-1", attemptId: "attempt-1" }) })

    const events = await drive(harness.coordinator, { run, userMessage: "how many points?" })

    expect(harness.coordinator.phase()).toBe("completed")
    // 只读运行一次都没有进入草稿与提交阶段。
    expect(events.map((event) => event.phase)).toEqual(["preflight", "observing", "planning", "answering", "completed"])
    expect(harness.calls).not.toContain("stage")
    expect(harness.calls).not.toContain("commit")
  })

  it("stages, waits for confirmation, then commits a concrete plan", async () => {
    const harness = makeHarness()

    const events = await drive(harness.coordinator, { run, userMessage: "draw a point", confirmed: true })

    expect(harness.coordinator.phase()).toBe("completed")
    // 确认状态**始终**出现在提交之前 —— 它不是可选的 UI 细节，而是账本要留下的记录。
    expect(events.map((event) => event.phase)).toEqual(["preflight", "observing", "planning", "compiling", "validating", "awaiting_confirmation", "committing", "completed"])
    expect(harness.committer.commit).toHaveBeenCalledTimes(1)
  })

  it("parks at awaiting_confirmation when the user has not confirmed yet", async () => {
    const harness = makeHarness()

    await drive(harness.coordinator, { run, userMessage: "draw a point" })

    expect(harness.coordinator.phase()).toBe("awaiting_confirmation")
    // 草稿已暂存，但**一个字节都没写进文档**。
    expect(harness.committer.stage).toHaveBeenCalledTimes(1)
    expect(harness.committer.commit).not.toHaveBeenCalled()
  })

  it("refuses to commit when the host never minted a consent token", async () => {
    // 同意凭据只能由宿主创建；协调器不构造它。没有凭据就只能停在确认阶段。
    const harness = makeHarness()
    const noConsent = createCoordinator({ planner: harness.planner, observer: harness.observer, committer: harness.committer, budget: harness.budget })

    await drive(noConsent, { run, userMessage: "draw a point", confirmed: true })

    expect(noConsent.phase()).toBe("awaiting_confirmation")
    expect(harness.committer.commit).not.toHaveBeenCalled()
  })
})

describe("coordinator refusal paths", () => {
  it("parks in waiting when the plan cites a fact the scene never confirmed", async () => {
    const harness = makeHarness({ observation: { factIds: ["fact-other"], summary: "nothing useful" } })

    const events = await drive(harness.coordinator, { run, userMessage: "draw a point" })

    // 缺事实**不是失败**：问用户比编一个数字好。
    expect(harness.coordinator.phase()).toBe("waiting")
    expect(events.at(-1)?.detail).toContain("fact-1")
    /**
     * **而且要说清是"缺对象"这件事**（外部审查 Agent-M4）。
     *
     * 原先这句文案是 `waiting for the user to confirm: fact-1` —— "等你确认"是**另一个**
     * 来源（规划器给的澄清问题）的说法，与这条路径无关；宿主那条 `waiting` 消息又只看
     * `questions()`（这里它是空的），于是连这个 id 都到不了用户眼前。
     */
    expect(events.at(-1)?.detail).toContain("did not observe")
    expect(events.at(-1)?.detail).not.toContain("to confirm")
    expect(harness.committer.stage).not.toHaveBeenCalled()
  })

  it("gives one visible repair attempt, then fails on a second invalid plan", async () => {
    const harness = makeHarness({ plan: () => ({ plan: { kind: "not-a-plan" } as unknown as PlanEnvelope, requestId: "req-1", attemptId: "attempt-1" }) })

    const events = await drive(harness.coordinator, { run, userMessage: "draw a point" })

    expect(harness.coordinator.phase()).toBe("failed")
    // 恰好两次：一次原始 + 一次可见修复（计划 Task 2.3 的一次性修复）。
    expect(harness.planner.plan).toHaveBeenCalledTimes(2)
    expect(events.at(-1)?.detail).toContain("never matched the schema")
  })

  it("accepts a repaired plan on the second attempt", async () => {
    let attempt = 0
    const harness = makeHarness({
      plan: () => {
        attempt += 1
        return attempt === 1
          ? { plan: { kind: "not-a-plan" } as unknown as PlanEnvelope, requestId: "req-1", attemptId: "attempt-1" }
          : { plan: planEnvelope(), requestId: "req-2", attemptId: "attempt-2" }
      }
    })

    await drive(harness.coordinator, { run, userMessage: "draw a point" })

    expect(harness.planner.plan).toHaveBeenCalledTimes(2)
    expect(harness.coordinator.phase()).toBe("awaiting_confirmation")
  })

  it("fails honestly when the draft goes stale instead of silently retrying", async () => {
    const harness = makeHarness({ stage: async () => ({ ok: false as const, reason: "stale_draft" as const, detail: "a manual edit moved the head" }) })

    const events = await drive(harness.coordinator, { run, userMessage: "draw a point", confirmed: true })

    expect(harness.coordinator.phase()).toBe("failed")
    expect(events.at(-1)?.detail).toContain("stale_draft")
    expect(harness.committer.commit).not.toHaveBeenCalled()
  })

  it("fails when the provider throws, and records the real error", async () => {
    const harness = makeHarness({ plan: () => { throw new Error("provider returned 401") } })

    const events = await drive(harness.coordinator, { run, userMessage: "draw a point" })

    expect(harness.coordinator.phase()).toBe("failed")
    expect(events.at(-1)?.detail).toContain("401")
  })

  it("never claims success when the commit itself was refused", async () => {
    // 计划 G2 Gate 点名的一条："model claims success without receipt" 不允许。
    const harness = makeHarness({ commit: async () => ({ status: "stale_source" as const, detail: "the head moved" }) })

    const events = await drive(harness.coordinator, { run, userMessage: "draw a point", confirmed: true })

    expect(harness.coordinator.phase()).toBe("failed")
    expect(events.at(-1)?.detail).toContain("stale_source")
    expect(events.map((event) => event.phase)).not.toContain("completed")
  })
})

describe("coordinator cancellation", () => {
  it("stops before commit and emits nothing afterwards", async () => {
    const harness = makeHarness()
    const events: string[] = []

    // 在暂存完成之后、提交之前取消。
    const original = harness.committer.stage
    harness.committer.stage = vi.fn(async (request: Parameters<CommitterPort["stage"]>[0]): ReturnType<CommitterPort["stage"]> => {
      const result = await original(request)
      harness.coordinator.cancel("user")
      return result
    })

    for await (const event of harness.coordinator.start({ run, userMessage: "draw a point", confirmed: true })) events.push(event.phase)

    expect(harness.coordinator.phase()).toBe("cancelled")
    expect(events).not.toContain("committing")
    expect(events).not.toContain("completed")
    expect(harness.committer.commit).not.toHaveBeenCalled()
  })

  it("marks an interruption distinctly so recovery can query the commit by idempotency key", async () => {
    const harness = makeHarness()
    harness.committer.stage = vi.fn(async () => {
      harness.coordinator.cancel("interrupted")
      return { ok: true as const, draftVersion: 2, previewHash: "preview-1" }
    })

    await drive(harness.coordinator, { run, userMessage: "draw a point", confirmed: true })

    expect(harness.coordinator.phase()).toBe("interrupted")
    // 账本仍然可查（取消不是把记录丢掉）。
    expect(harness.coordinator.ledger().length).toBeGreaterThan(0)
  })

  it("reports a no-op cancel once the run already finished", async () => {
    const harness = makeHarness()
    await drive(harness.coordinator, { run, userMessage: "draw a point", confirmed: true })

    const result = harness.coordinator.cancel("user")

    expect(result.cancelled).toBe(false)
    expect(harness.coordinator.phase()).toBe("completed")
  })

  it("propagates an abort signal to every port", async () => {
    const harness = makeHarness()
    let seenSignal: AbortSignal | null = null
    harness.observer.observe = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
      seenSignal = signal
      return facts
    })

    await drive(harness.coordinator, { run, userMessage: "draw a point" })

    expect(seenSignal).not.toBeNull()
    expect((seenSignal as unknown as AbortSignal).aborted).toBe(false)
  })
})

describe("coordinator budget enforcement", () => {
  it("stops before the model call when the network budget is already spent", async () => {
    const harness = makeHarness({ limits: { network: 0 } })

    const events = await drive(harness.coordinator, { run, userMessage: "draw a point" })

    expect(harness.coordinator.phase()).toBe("failed")
    expect(events.at(-1)?.detail).toContain("budget")
    // 预算被拒时连模型都没问，更没有写文档。
    expect(harness.planner.plan).not.toHaveBeenCalled()
    expect(harness.committer.commit).not.toHaveBeenCalled()
  })

  it("refuses a stage whose action count exceeds the per-stage allowance", async () => {
    const harness = makeHarness({ limits: { actions_per_stage: 1 }, plan: () => ({ plan: planEnvelope(2), requestId: "req-1", attemptId: "attempt-1" }) })

    const events = await drive(harness.coordinator, { run, userMessage: "draw two points" })

    expect(harness.coordinator.phase()).toBe("failed")
    expect(events.at(-1)?.detail).toContain("actions_per_stage")
    expect(harness.committer.stage).not.toHaveBeenCalled()
  })

  /**
   * **"单次暂存的动作数"每次暂存都要重置**（外部审查 M1）。
   *
   * `Budget.beginStage()` 的文档写着"进入下一次暂存：重置 `actions_per_stage`"，
   * 而它原先在整个仓库里**没有任何调用方** —— 于是这个名额退化成了第二个整次运行计数器，
   * 修复那一次也来分它。实测（审计探针）：20 个动作的计划、committer 第一次拒绝并给出
   * 修复请求之后，这一轮以 `budget exhausted: budget_actions_per_stage` 结束，
   * 而 `actions_per_run` 还剩 108、每次暂存也都没超过默认的 32 ——
   * 它报了一次**没有发生**的预算耗尽，还丢掉了那唯一一次修复机会。
   */
  it("gives the repaired stage its own per-stage allowance instead of sharing one", async () => {
    let stageCalls = 0
    const harness = makeHarness({
      // 20 个动作：比默认的 32 小，但两次加起来会超过它 —— 只有"每次暂存重置"才对。
      plan: () => ({ plan: planEnvelope(20), requestId: "req-1", attemptId: "attempt-1" }),
      stage: async () => {
        stageCalls += 1
        return stageCalls === 1
          ? { ok: false as const, reason: "compile_failed" as const, detail: "the first pass did not compile", repair: { reason: "compile_failed", errors: [{ code: "bad_field", path: "envelope.actions[0].inputs", detail: "x" }], allowedChanges: [], attempt: 1 } }
          : { ok: true as const, draftVersion: 2, previewHash: "preview-1" }
      }
    })

    const events = await drive(harness.coordinator, { run, userMessage: "建一条 20 步的计划" })

    // 从头到尾没有"预算耗尽"：两次暂存都真的发出去了，最后停在等确认。
    expect(events.some((event) => event.detail.includes("budget"))).toBe(false)
    expect(stageCalls).toBe(2)
    expect(harness.coordinator.phase()).toBe("awaiting_confirmation")
  })

  /**
   * **上下文预算真的会被扣**（外部审查 M2）。
   *
   * `buildContext` 收着 `budget` 却从不使用它、`estimatedCharacters` 也从没人核对，
   * 于是 `context` 这一类永远扣不了费（`exhausted()` 的那一段永远为假）。
   * 把额度压到 1 个 token 就能看出来：任何一次真实上下文都远超它，
   * 这一轮必须**在计费那一步**停下，并说清是哪一项用尽。
   */
  it("charges the context budget and stops when the band is exhausted", async () => {
    const harness = makeHarness({ limits: { context: 1 } })

    const events = await drive(harness.coordinator, { run, userMessage: "draw a point" })

    expect(harness.coordinator.phase()).toBe("failed")
    expect(events.at(-1)?.detail).toContain("budget_context")
    // 计费在"组装上下文之后、问模型之前"：模型一次都没被问到，文档也没被碰。
    expect(harness.planner.plan).not.toHaveBeenCalled()
    expect(harness.committer.commit).not.toHaveBeenCalled()
  })

  it("counts the repair attempt against the same budget", async () => {
    // 修复不该有独立配额：给了就等于把"4 次生成"变成"4 次 + 修复"。
    const harness = makeHarness({ limits: { generation: 1 }, plan: () => ({ plan: { kind: "not-a-plan" } as unknown as PlanEnvelope, requestId: "req-1", attemptId: "attempt-1" }) })

    await drive(harness.coordinator, { run, userMessage: "draw a point" })

    // 第一次生成用掉了唯一名额，修复请求直接因预算被拒。
    expect(harness.planner.plan).toHaveBeenCalledTimes(1)
    expect(harness.coordinator.phase()).toBe("failed")
  })
})

describe("prepare runs before compiling", () => {
  it("calls prepare with the validated plan before staging anything", async () => {
    // 用途：把工作区切到这条计划需要的那个。编译器会拒"工作区不匹配"的动作，
    // 所以准备**必须**发生在编译之前。
    const order: string[] = []
    const harness = makeHarness()
    const coordinator = createCoordinator({
      planner: harness.planner,
      observer: harness.observer,
      committer: {
        stage: async () => { order.push("stage"); return { ok: true, draftVersion: 1, previewHash: "h" } },
        commit: async () => { order.push("commit"); return { status: "committed" } }
      },
      budget: harness.budget,
      prepare: (plan) => { order.push(`prepare:${plan.kind}`); return { ok: true } }
    })

    await drive(coordinator, { run, userMessage: "建个立方体", confirmed: true })

    // 顺序是关键：先准备，再编译。
    expect(order[0]).toBe("prepare:plan")
    expect(order.indexOf("stage")).toBeGreaterThan(0)
  })

  it("fails the run when preparation is refused, without staging anything", async () => {
    const harness = makeHarness()
    const coordinator = createCoordinator({
      planner: harness.planner,
      observer: harness.observer,
      committer: harness.committer,
      budget: harness.budget,
      prepare: () => ({ ok: false, detail: "this command cannot run in the engineering drawing workspace" })
    })

    const events = await drive(coordinator, { run, userMessage: "建个立方体", confirmed: true })

    expect(coordinator.phase()).toBe("failed")
    expect(events.at(-1)?.detail).toContain("engineering drawing")
    expect(harness.committer.stage).not.toHaveBeenCalled()
    expect(harness.committer.commit).not.toHaveBeenCalled()
  })

  it("never calls prepare for a read-only answer", async () => {
    // 只读回答没有动作要编译，也就不需要准备目标工作区。
    const prepare = vi.fn(() => ({ ok: true as const }))
    const harness = makeHarness({ plan: () => ({ plan: answerEnvelope(), requestId: "req-1", attemptId: "attempt-1" }) })
    const coordinator = createCoordinator({ planner: harness.planner, observer: harness.observer, committer: harness.committer, budget: harness.budget, prepare })

    await drive(coordinator, { run, userMessage: "数一下" })

    expect(prepare).not.toHaveBeenCalled()
  })
})

describe("coordinator event identity", () => {  it("carries request, attempt and draft identifiers as they become known", async () => {
    const harness = makeHarness()

    await drive(harness.coordinator, { run, userMessage: "draw a point", confirmed: true })

    const events = harness.coordinator.ledger()
    const planning = events.find((event) => event.phase === "planning")!
    const compiling = events.find((event) => event.phase === "compiling")!
    const committing = events.find((event) => event.phase === "committing")!

    // `requestId` / `attemptId` 在第一次往返之后才知道，所以它们出现在"计划已到手"那条事件上；
    // 这条事件位于 compiling 之前，因此编译阶段之后的事件都带着它们。
    const planArrived = events.find((event) => event.detail.startsWith("plan attempt 1 returned"))!
    expect(planArrived.requestId).toBe("req-1")
    expect(planArrived.attemptId).toBe("attempt-1")
    // 草稿版本要等暂存之后才有。
    expect(planning.draftVersion).toBeNull()
    expect(compiling.draftVersion).toBeNull()
    // 暂存之后的事件带上草稿版本，提交阶段带上当前句柄。
    expect(events.some((event) => event.draftVersion === 2)).toBe(true)
    expect(committing.handle?.documentId).toBe("doc-1")
    // 每一次事件都带全七个标识。
    for (const event of events) expect(event.runId).toBe("run-1")
  })
})

/**
 * **编译阶段的那一次修复**（Agent DSL 切片 Task 4 的接线缺口）。
 *
 * `compilePlan` 会返回一份结构化修复请求，但协调器此前只在自己的
 * `parsePlanEnvelope` 失败时造一份 —— 编译阶段的失败直接 `failed`，
 * 编译器的那一份、以及"修复只给一次且共用运行预算"这条全局约束都没在生产路径上。
 *
 * 这一组把**协调器的消费契约**钉住：它交给规划器的必须是暂存失败带回来的那一份
 *（逐字段），修恰好一次，绝不无请求地重试，也绝不另开一份预算。
 * "编译器确实产出这一份"由 `apps/web/src/agent/compilerRepair.test.ts` 从真实管线证明。
 */
describe("the compile stage's one-shot repair", () => {
  const repair: RepairRequest = {
    reason: "schema_invalid",
    errors: [{ code: "degenerate_prism", path: "envelope.actions[0].inputs.basePolygon", detail: "the extrusion vector is zero" }],
    allowedChanges: ["envelope.actions[0].inputs.basePolygon"],
    attempt: 1
  }
  const planDiagnostics = [{ stage: "geometry_validation" as const, code: "degenerate_prism", path: "envelope.actions[0].inputs.basePolygon", detail: "the extrusion vector is zero", severity: "error" as const }]
  const assumptions = [{ id: "prism:vector", text: "拉伸向量未指定，取高 3 的直棱柱", kind: "safe_default" as const, value: { x: 0, y: 0, z: 3 }, overridable: true, path: "envelope.actions[0].inputs.vector" }]
  const compileFailure = { ok: false as const, reason: "compile_failed" as const, detail: "compile_failed: degenerate_prism", repair, planDiagnostics, assumptions }

  function compileHarness(options: { stage: CommitterPort["stage"]; plans?: PlanEnvelope[]; limits?: Partial<BudgetLimits> }) {
    const seen: PlanRequest[] = []
    let index = 0
    const planner: PlannerPort = {
      plan: vi.fn(async (request: PlanRequest) => {
        seen.push(request)
        const plan = options.plans?.[Math.min(index, (options.plans?.length ?? 1) - 1)] ?? planEnvelope()
        index += 1
        return { plan, requestId: `req-${index}`, attemptId: `attempt-${index}` }
      })
    }
    const observer: ObserverPort = { observe: vi.fn(async () => facts) }
    const commitRequests: Parameters<CommitterPort["commit"]>[0][] = []
    const committer: CommitterPort = {
      stage: vi.fn(options.stage),
      commit: vi.fn(async (request: Parameters<CommitterPort["commit"]>[0]) => {
        commitRequests.push(request)
        return { status: "committed" as const }
      })
    }
    const budget = createBudget(options.limits)
    const coordinator = createCoordinator({ planner, observer, committer, consent, budget })
    return { coordinator, seen, committer, commitRequests, budget }
  }

  /** 第一次编译失败、第二次成功：这是"修好了一次"的形状。 */
  function failThenSucceed() {
    let attempts = 0
    return async () => {
      attempts += 1
      return attempts === 1 ? compileFailure : { ok: true as const, draftVersion: 2, previewHash: "preview-1" }
    }
  }

  it("hands the planner the compile stage's repair request field for field", async () => {
    const harness = compileHarness({ stage: failThenSucceed() })

    const events = await drive(harness.coordinator, { run, userMessage: "draw a point" })

    expect(harness.coordinator.phase()).toBe("awaiting_confirmation")
    // 账本要看得见"这不是第一次问"：修复是一次**重新规划**。
    expect(events.map((event) => event.phase).filter((phase) => phase === "planning")).toHaveLength(2)
    expect(harness.seen).toHaveLength(2)
    expect(harness.seen[0].repair).toBeUndefined()

    const handed = harness.seen[1].repair
    expect(handed, "the repair attempt must carry the compiler's request").toBeDefined()
    // 逐字段：协调器**没有**自己造一份（否则 `allowedChanges` / `attempt` 会是它猜的）。
    expect(handed!.reason).toBe(repair.reason)
    expect(handed!.errors).toEqual(repair.errors)
    expect(handed!.allowedChanges).toEqual(repair.allowedChanges)
    expect(handed!.attempt).toBe(repair.attempt)
    // 编译器的逐层诊断与它失败前补出来的假设一起交出去（规格 §6.3/§7）。
    expect(handed!.diagnostics).toEqual(planDiagnostics)
    expect(handed!.assumptions).toEqual(assumptions)
    // 提示仍按既有通道给出可执行的修复建议，并指出卡在哪一层、哪个字段。
    expect(handed!.hint).toContain("geometry_validation")
    expect(handed!.hint).toContain("envelope.actions[0].inputs.basePolygon")
  })

  it("attempts exactly one repair, then fails instead of repairing again", async () => {
    let attempts = 0
    const harness = compileHarness({
      stage: async () => {
        attempts += 1
        return { ...compileFailure, repair: { ...repair, attempt: attempts } }
      }
    })

    const events = await drive(harness.coordinator, { run, userMessage: "draw a point" })

    expect(harness.coordinator.phase()).toBe("failed")
    expect(harness.seen).toHaveLength(2)
    expect(harness.committer.stage).toHaveBeenCalledTimes(2)
    // 第二次尝试**必须**带着请求（"可见的修复"），而不是把同一份请求再发一遍。
    expect(harness.seen[1].repair).toBeDefined()
    expect(events.at(-1)?.detail).toContain("degenerate_prism")
  })

  it("does not re-ask the model when the failure carries no repair request", async () => {
    // 用户能回答的问题（或任何不该让模型重发的失败）不会带修复请求。
    const harness = compileHarness({ stage: async () => ({ ok: false as const, reason: "compile_failed" as const, detail: "needs more information" }) })

    const events = await drive(harness.coordinator, { run, userMessage: "draw a point" })

    expect(harness.coordinator.phase()).toBe("failed")
    expect(harness.seen).toHaveLength(1)
    expect(events.at(-1)?.detail).toContain("needs more information")
  })

  it("does not repair a failure that is not a compile failure, even if a request is attached", async () => {
    const harness = compileHarness({ stage: async () => ({ ok: false as const, reason: "stale_draft_version" as const, detail: "the draft moved", repair }) })

    await drive(harness.coordinator, { run, userMessage: "draw a point" })

    expect(harness.coordinator.phase()).toBe("failed")
    expect(harness.seen).toHaveLength(1)
  })

  it("counts the repair against the same generation and network budget", async () => {
    const harness = compileHarness({ stage: failThenSucceed() })

    await drive(harness.coordinator, { run, userMessage: "draw a point" })

    // 修复花的是同一份预算的另一个名额，不是另一本账。
    expect(harness.budget.snapshot().used.generation).toBe(2)
    expect(harness.budget.snapshot().used.network).toBe(2)

    // 额度只够一次生成时：修复请求因预算被拒，模型不会被多问一次。
    const tight = compileHarness({ stage: failThenSucceed(), limits: { generation: 1 } })
    const tightEvents = await drive(tight.coordinator, { run, userMessage: "draw a point" })

    expect(tight.seen).toHaveLength(1)
    expect(tight.coordinator.phase()).toBe("failed")
    expect(tightEvents.at(-1)?.detail).toContain("budget")
  })

  /**
   * **提交的是通过编译的那一份计划**（修复轮 1 / M4）。
   *
   * `stagedPlan.actions` 之前只有结构性保证（没有任何一条用例走到提交）。这条把
   * **端口上收到的那批动作**钉住：修复之后提交的必须是第二份计划的动作，
   * 而不是第一份（它在编译阶段就被拒了）。
   */
  it("commits the repaired plan's actions, not the ones that failed to compile", async () => {
    const repairedPlan = { ...planEnvelope(1), goal: "repaired", actions: [{ ...action("p1"), actionKey: "repaired-action" }] }
    const harness = compileHarness({ stage: failThenSucceed(), plans: [planEnvelope(1), repairedPlan] })

    const events: string[] = []
    for await (const event of harness.coordinator.start({ run, userMessage: "draw a point", confirmed: true })) events.push(event.phase)

    expect(harness.coordinator.phase()).toBe("completed")
    expect(harness.commitRequests).toHaveLength(1)
    const committed = harness.commitRequests[0]
    // 第一份计划的动作（`p1`）一个都不在提交里；提交的是修复后那一份。
    expect(committed.actions.map((entry) => entry.actionKey)).toEqual(["repaired-action"])
    expect(committed.actionCount).toBe(repairedPlan.actions.length)
  })
})

/** 只读工具端口目前只被协调器预留；这条确认类型是可用的（真正的工具注册在 Task 2.2）。 */
describe("tool port", () => {
  it("accepts a read-only tool result envelope", async () => {
    const result: ToolResult<unknown> = { status: "success", summary: "one point", next_actions: [], artifacts: [], payload: {}, diagnostics: [] }

    expect(result.status).toBe("success")
  })
})
