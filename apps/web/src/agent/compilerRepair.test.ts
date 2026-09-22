import {
  compilePlan,
  createBudget,
  createCommitterAdapter,
  createCoordinator,
  type Budget,
  type BudgetLimits,
  type ExportPreflightPort,
  type Observation,
  type PlannerPort,
  type PlanEnvelope,
  type PlanRequest
} from "@draw/agent-core"
import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { createDocumentHandle } from "@draw/scene-graph"
import { describe, expect, it, vi } from "vitest"

import { createAgentRuntime } from "./agentRuntime"
import { createDraftStore } from "./draftStore"
import { createHostBridge } from "./hostBridge"

/**
 * **编译阶段的修复请求必须真的驱动那一次修复**（Agent DSL 切片 Task 4 的接线缺口）。
 *
 * `compilePlan` 早就返回了一份结构化修复请求（只带 `code` / `path` / `allowedChanges`，
 * 加上逐层诊断与失败前补出来的假设），但协调器此前**从不消费它**：它在
 * `parsePlanEnvelope` 失败时自己造一份修复请求，而编译阶段的失败（跑到了后面五层）
 * 只会让整次运行 `failed` —— 编译器的那一份、以及"修复只给一次且共用运行预算"
 * 这条全局约束，都停在纸面上。
 *
 * 这个文件从**真实管线**走一遍，没有任何手写的修复对象：
 *
 * ```text
 * createAgentRuntime / 真实装配 → 协调器 → CommitterAdapter → DraftStore.stage → compilePlan
 * ```
 *
 * 修复请求的期望值由**当场再调一次 `compilePlan`** 得出（同一份计划），所以"交给模型的
 * 就是编译器那一份"是逐字段比出来的，而不是照着实现抄的。
 */
const projectId = "project-1"
const PROMPT = "画一个棱柱"
const emptyObservation: Observation = { factIds: [], summary: "empty scene" }

/** 一个共面、不自交的四边形底面（棱柱动作要的是一串空间点）。 */
const BASE = [
  { x: 0, y: 0, z: 0 },
  { x: 2, y: 0, z: 0 },
  { x: 3, y: 2, z: 0 },
  { x: 1, y: 2, z: 0 }
]

function baseDocument(): GeometryDocument {
  return createEmptyDocument("geometry3d")
}

/**
 * 一份**能过传输解析**、却在编译阶段被拒的计划。
 *
 * - 动作 0 的 `vector` 整字段缺失 → 字段审计回填安全默认（进 `assumptions`）；
 * - 动作 1 是零拉伸向量 → **几何语义校验**这一层报 `degenerate_prism`（不是传输层）。
 *
 * 于是编译器的修复请求必然带 `allowedChanges`、逐层诊断，以及失败前补出来的那条假设。
 */
function repairablePlan(): unknown {
  return {
    schemaVersion: "mathcanvas.plan.v1",
    kind: "plan",
    goal: "两个棱柱",
    factIds: [],
    actions: [
      { actionId: "solid.create_prism", actionKey: "prism", factIds: [], inputs: { alias: "prism", basePolygon: BASE } },
      { actionId: "solid.create_prism", actionKey: "degenerate", factIds: [], inputs: { alias: "degenerate", basePolygon: BASE, vector: { x: 0, y: 0, z: 0 } } }
    ]
  }
}

/** 修复之后模型"改好了"的那一份计划。 */
function cubePlan(): unknown {
  return {
    schemaVersion: "mathcanvas.plan.v1",
    kind: "plan",
    goal: "一个立方体",
    factIds: [],
    actions: [{ actionId: "solid.create_template", actionKey: "cube", factIds: [], inputs: { alias: "cube", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } } }]
  }
}

/**
 * 编译器**不会**给修复请求的那一种失败：底面与向量都缺，而用户说的是"任意"。
 * 规格 §6.3 要求保留符号参数、§7 要求无安全默认时问用户 —— 这不是"让模型重发一遍"。
 */
function needsTheUserPlan(): unknown {
  return {
    schemaVersion: "mathcanvas.plan.v1",
    kind: "plan",
    goal: "画一个棱柱",
    factIds: [],
    actions: [{ actionId: "solid.create_prism", actionKey: "prism", factIds: [], inputs: { alias: "prism" } }]
  }
}

/** **这一份计划在编译器眼里的结论**（修复请求的期望值来源）。 */
function compilerVerdict() {
  return compilePlan(repairablePlan(), { document: baseDocument(), workspace: "geometry3d", prompt: PROMPT })
}

function exportPreflight(): ExportPreflightPort {
  return {
    preflight: vi.fn(() => ({ format: "svg", supported: true, requiresUserAcceptance: false, omitted: [], fontLoss: [], approximationNotes: [], blockedReasons: [], projectedEntityCount: 0 }))
  }
}

function runContext(document: GeometryDocument) {
  return {
    runId: "run-1",
    conversationId: "conv-1",
    promptMessageId: "msg-1",
    target: { projectId, documentId: document.metadata.id, workspace: document.workspace as "geometry3d", epoch: `epoch:${document.metadata.id}`, generation: document.revision, contentHash: "hash-1" },
    sources: [],
    textProfileId: "profile-1",
    capabilityRevision: "rev",
    policyRevision: "policy"
  }
}

/** 脚本化规划器：唯一被替身化的东西是"模型说了什么"。 */
function scriptedPlanner(plans: unknown[]) {
  const requests: PlanRequest[] = []
  let index = 0
  const planner: PlannerPort = {
    plan: vi.fn(async (request: PlanRequest) => {
      requests.push(request)
      const next = plans[Math.min(index, plans.length - 1)]
      index += 1
      return { plan: next as PlanEnvelope, requestId: `req-${index}`, attemptId: `attempt-${index}` }
    })
  }
  return { planner, requests }
}

/** 走**应用真实装配**的运行时（`createAgentRuntime`）。 */
function makeRuntime(plans: unknown[]) {
  const document = baseDocument()
  let current = document
  /** 落盘的候选文档（`confirmDraft()` 之后才有）。 */
  const written: GeometryDocument[] = []
  const { planner, requests } = scriptedPlanner(plans)
  const runtime = createAgentRuntime({
    readDocument: () => current,
    writeDocument: (candidate) => { written.push(candidate); current = candidate },
    readSceneDocuments: () => [],
    planner,
    observer: { observe: vi.fn(async () => emptyObservation) },
    exportPreflight: exportPreflight(),
    projectId,
    runId: "run-1"
  })
  return { runtime, requests, written, document, current: () => current }
}

/**
 * 与 `agentRuntime.ts` 同一批部件的手工装配，只为一件事：**注入预算**。
 * `createAgentRuntime` 不转发 `budget`（预算由协调器按 `limits` 新建），
 * 而"修复共用运行预算"这条约束只能从预算快照上读出来。
 */
function makePipeline(plans: unknown[], limits?: Partial<BudgetLimits>) {
  const document = baseDocument()
  let current = document
  const drafts = createDraftStore()
  const live = () => ({ handle: createDocumentHandle(current, projectId), document: current })
  const host = createHostBridge({ drafts, live, replace: (candidate) => { current = candidate }, runId: "run-1" })
  const committer = createCommitterAdapter({ drafts, host, live })
  const { planner, requests } = scriptedPlanner(plans)
  const budget: Budget = createBudget(limits)
  const coordinator = createCoordinator({ planner, observer: { observe: vi.fn(async () => emptyObservation) }, committer, budget })
  return { coordinator, budget, requests }
}

async function drive(coordinator: ReturnType<typeof createAgentRuntime>["coordinator"] | ReturnType<typeof createCoordinator>, request: Parameters<ReturnType<typeof createCoordinator>["start"]>[0]) {
  const phases: string[] = []
  for await (const event of coordinator.start(request)) phases.push(event.phase)
  return phases
}

describe("the compile stage's repair request drives the one repair attempt", () => {
  it("hands the planner exactly the compiler's code/path/allowedChanges, then accepts the repaired plan", async () => {
    const expected = compilerVerdict()
    // 前提先钉住：这份计划**确实**卡在编译阶段（不是传输解析），而且编译器给了修复请求。
    expect(expected.ok).toBe(false)
    expect(expected.repair).toBeDefined()
    expect(expected.diagnostics.some((entry) => entry.severity === "error" && entry.stage === "geometry_validation" && entry.code === "degenerate_prism")).toBe(true)
    expect(expected.assumptions.length).toBeGreaterThan(0)

    const harness = makeRuntime([repairablePlan(), cubePlan()])
    const events = await drive(harness.runtime.coordinator, { run: runContext(harness.document), userMessage: PROMPT })

    // 修复之后这份计划被接受：草稿成型，停在确认（真文档没被动过）。
    expect(events.at(-1)).toBe("awaiting_confirmation")
    expect(harness.current().primitives).toHaveLength(0)

    // 恰好两次往返：一次原始 + 一次修复。
    expect(harness.requests).toHaveLength(2)
    expect(harness.requests[0].repair).toBeUndefined()

    const repair = harness.requests[1].repair
    expect(repair, "the repair attempt must carry a request — never a silent retry").toBeDefined()
    // **逐字段**：交给模型的就是编译器那一份（协调器没有自己造一个）。
    expect(repair!.reason).toBe(expected.repair!.reason)
    expect(repair!.errors).toEqual(expected.repair!.errors)
    expect(repair!.allowedChanges).toEqual(expected.repair!.allowedChanges)
    expect(repair!.attempt).toBe(expected.repair!.attempt)
    // 编译器的逐层诊断与失败前补出来的假设一起交出去（规格 §6.3/§7：假设必须看得见）。
    expect(repair!.diagnostics).toEqual(expected.diagnostics)
    expect(repair!.assumptions).toEqual(expected.assumptions)
    // 修复提示要说出**卡在哪一层、哪个字段**，而不是笼统的"格式不对"。
    expect(repair!.hint).toContain("geometry_validation")
    expect(repair!.hint).toContain("degenerate_prism")
    expect(repair!.hint).toContain("envelope.actions[1].inputs.basePolygon")
  })

  it("ends the run as failed when the repaired plan fails the compile stage again, without a second repair", async () => {
    const harness = makeRuntime([repairablePlan(), repairablePlan()])
    const events = await drive(harness.runtime.coordinator, { run: runContext(harness.document), userMessage: PROMPT })

    expect(events.at(-1)).toBe("failed")
    // 两次往返之后**没有**第三次：修复只有一次（全局约束）。
    expect(harness.requests).toHaveLength(2)
    expect(harness.requests[1].repair).toBeDefined()
    // 第二次失败如实落账，并指出卡在哪一层。
    expect(harness.runtime.coordinator.ledger().at(-1)?.detail).toContain("degenerate_prism")
    expect(harness.current().primitives).toHaveLength(0)
  })

  it("shares the run's budget with the repair attempt instead of opening a second allowance", async () => {
    const generous = makePipeline([repairablePlan(), cubePlan()])
    const events = await drive(generous.coordinator, { run: runContext(baseDocument()), userMessage: PROMPT })

    expect(events.at(-1)).toBe("awaiting_confirmation")
    // 修复花掉的是**同一份**预算的另一个名额：两次生成、两次网络。
    expect(generous.budget.snapshot().used.generation).toBe(2)
    expect(generous.budget.snapshot().used.network).toBe(2)

    // 只剩一次生成时，修复请求直接因预算被拒 —— 绝不绕开预算再问一次。
    const tight = makePipeline([repairablePlan(), cubePlan()], { generation: 1 })
    const tightEvents = await drive(tight.coordinator, { run: runContext(baseDocument()), userMessage: PROMPT })

    expect(tight.requests).toHaveLength(1)
    expect(tightEvents.at(-1)).toBe("failed")
    expect(tight.coordinator.ledger().at(-1)?.detail).toContain("budget")
  })

  it("does not re-ask the model when the compiler wanted the user instead", async () => {
    // 编译器的修复请求**缺省**（用户能回答的问题不该变成"让模型重发一遍"，规格 §7）。
    const plan = needsTheUserPlan()
    const verdict = compilePlan(plan, { document: baseDocument(), workspace: "geometry3d", prompt: "画一个任意棱柱" })
    expect(verdict.ok).toBe(false)
    expect(verdict.questions.length).toBeGreaterThan(0)
    expect(verdict.repair).toBeUndefined()

    const harness = makeRuntime([plan, cubePlan()])
    const events = await drive(harness.runtime.coordinator, { run: runContext(harness.document), userMessage: "画一个任意棱柱" })

    expect(events.at(-1)).toBe("failed")
    expect(harness.requests).toHaveLength(1)
    expect(harness.requests[0].repair).toBeUndefined()
  })

  /**
   * **修复之后落盘的是修复好的那一份计划**（修复轮 1 / M4）。
   *
   * `coordinator.ts` 里"提交用 `stagedPlan.actions`"此前只有结构性保证：两组用例都停在
   * `awaiting_confirmation`，没有任何一条走到确认与提交。这条用例从装配好的运行时
   * 一直走到**真文档**：第一份计划编译不过（零向量棱柱），第二份是立方体 ——
   * 落盘的必须是立方体，一个字都不能来自第一份。
   */
  it("commits the plan that passed compilation, not the envelope that failed it", async () => {
    const harness = makeRuntime([repairablePlan(), cubePlan()])
    const events = await drive(harness.runtime.coordinator, { run: runContext(harness.document), userMessage: PROMPT })

    expect(events.at(-1)).toBe("awaiting_confirmation")
    // 确认之前真文档一个字节都没动。
    expect(harness.written).toHaveLength(0)
    expect(harness.current().primitives).toHaveLength(0)

    // 用户点了确认：提交走的是 HostBridge 的一次性同意（真实装配里由 `confirmDraft` 铸造）。
    const receipt = harness.runtime.confirmDraft()
    expect(receipt.status).toBe("committed")

    const committed = harness.written.at(-1)?.primitives ?? []
    // 修复后那一份（`solid.create_template` 立方体）落盘了。
    expect(committed.some((primitive) => primitive.type === "cube")).toBe(true)
    // 而第一份计划里的棱柱（`polyhedron3`）一个都没有 —— 它连编译都没过。
    expect(committed.some((primitive) => primitive.type === "polyhedron3")).toBe(false)
    // 真文档确实被换成了那一份。
    expect(harness.current().primitives.some((primitive) => primitive.type === "cube")).toBe(true)
  })
})
