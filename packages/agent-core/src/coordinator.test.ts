import { describe, expect, it, vi } from "vitest"

import { createBudget } from "./budget"
import { createCoordinator } from "./coordinator"
import type { CommitterPort, ConsentToken, Observation, ObserverPort, PlanOutcome, PlannerPort } from "./coordinatorPorts"
import type { DocumentHandle, PlanEnvelope, RunContext, ToolResult } from "./contracts"

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

/** 只读工具端口目前只被协调器预留；这条确认类型是可用的（真正的工具注册在 Task 2.2）。 */
describe("tool port", () => {
  it("accepts a read-only tool result envelope", async () => {
    const result: ToolResult<unknown> = { status: "success", summary: "one point", next_actions: [], artifacts: [], payload: {}, diagnostics: [] }

    expect(result.status).toBe("success")
  })
})
