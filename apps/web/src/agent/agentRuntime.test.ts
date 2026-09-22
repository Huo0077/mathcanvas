import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { contentFingerprint } from "@draw/scene-graph"
import { describe, expect, it, vi } from "vitest"

import type { PlanEnvelope, PlannerPort, PlanRequest } from "@draw/agent-core"
import { SKILL_CATALOGUE_REVISION } from "@draw/agent-core"

import { createAgentRuntime } from "./agentRuntime"
import { CONIC_INVARIANT_PROMPT, OBLIQUE_PRISM_PROMPT, conicInvariantPlan, obliquePrismSectionPlan } from "./representativeFixtures"
import type { ExportPreflightPort } from "@draw/agent-core"

/**
 * **宿主接线的证明**（Task 2.4）。
 *
 * 这里的价值不在断言数量，而在**没有任何替身**：真实的 `DraftStore`、真实的 `HostBridge`、
 * 真实的 `createCommitterAdapter`、真实的协调器。此前每个部件各自有测试，
 * 但"它们能不能一起跑"从未被验证过 —— 这个文件就是那次验证。
 */
const projectId = "project-1"

function geometryDocument(): GeometryDocument {
  return createEmptyDocument("geometry3d")
}

function planEnvelope(): PlanEnvelope {
  return {
    schemaVersion: "mathcanvas.plan.v1",
    kind: "plan",
    goal: "建一个立方体",
    factIds: [],
    actions: [{ actionId: "solid.create_template", actionKey: "cube", factIds: [], inputs: { alias: "cube", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } } }]
  }
}

function answerEnvelope(): PlanEnvelope {
  return { schemaVersion: "mathcanvas.plan.v1", kind: "answer", goal: "数点", factIds: [], answer: "0", toolResultRefs: [] }
}

/** 一个脚本化的假 planner —— 这是唯一被替身化的东西（真实模型调用被 G1 的 Rust 缺失挡着）。 */
function plannerFor(envelope: PlanEnvelope): PlannerPort {
  return { plan: vi.fn(async () => ({ plan: envelope, requestId: "req-1", attemptId: "attempt-1" })) }
}

function exportPreflight(): ExportPreflightPort {
  return { preflight: vi.fn(() => ({ format: "svg", supported: true, requiresUserAcceptance: false, omitted: [], fontLoss: [], approximationNotes: [], blockedReasons: [], projectedEntityCount: 0 })) }
}

function makeRuntime(options: { envelope?: PlanEnvelope; document?: GeometryDocument | null } = {}) {
  let current = options.document === undefined ? geometryDocument() : options.document
  const written: GeometryDocument[] = []
  const runtime = createAgentRuntime({
    readDocument: () => current,
    writeDocument: (candidate) => {
      written.push(candidate)
      current = candidate
    },
    readSceneDocuments: () => (current ? [{ handle: { projectId, documentId: current.metadata.id, workspace: current.workspace as "geometry3d", epoch: `epoch:${current.metadata.id}`, generation: current.revision, contentHash: contentFingerprint(current) }, document: current }] : []),
    planner: plannerFor(options.envelope ?? planEnvelope()),
    exportPreflight: exportPreflight(),
    projectId,
    runId: "run-1",
    now: () => 1_000
  })
  return { runtime, written, current: () => current }
}

/**
 * 运行上下文。
 *
 * 可以给一份**具体文档**：句柄里的 `documentId` 必须与它一致，否则测的就不是这条链上的
 * "模型看到的手柄是不是我给它那份文档的手柄"（第一版这里自己新建一份空文档，
 * 于是断言拿到的是另一个 id —— 那正是这条用例想抓的东西）。
 */
function runContext(document: GeometryDocument = geometryDocument(), capabilityRevision = "2026-09-21.1") {
  return {
    runId: "run-1",
    conversationId: "conv-1",
    promptMessageId: "msg-1",
    // 工作区取自**这份文档**，而不是写死：句柄说的必须就是这份文档。
    target: { projectId, documentId: document.metadata.id, workspace: document.workspace as "conics" | "geometry3d", epoch: `epoch:${document.metadata.id}`, generation: document.revision, contentHash: contentFingerprint(document) },
    sources: [],
    textProfileId: "profile-1",
    capabilityRevision,
    policyRevision: "policy-1"
  }
}

async function drive(coordinator: ReturnType<typeof createAgentRuntime>["coordinator"], request: Parameters<typeof coordinator.start>[0]) {
  const events: string[] = []
  for await (const event of coordinator.start(request)) events.push(event.phase)
  return events
}

describe("the assembled runtime actually runs", () => {
  it("drafts a plan without touching the live document", async () => {
    // 这是整条链的关键性质：一次规划运行结束后，真文档必须**一个字节都没变**。
    const { runtime, written, current } = makeRuntime()

    const events = await drive(runtime.coordinator, { run: runContext(), userMessage: "建个立方体" })

    expect(events).toContain("compiling")
    expect(events.at(-1)).toBe("awaiting_confirmation")
    expect(written).toHaveLength(0)
    expect(current()?.primitives).toHaveLength(0)
  })

  /**
   * **接线级的真实故障回归**（2026-09-21）。画布上已经有一个对象时，同类的下一个动作
   * 曾经必然失败：分配器只会数数、不知道文档里已经有 `solid-1`（账本 `run-6-mubf109e`）。
   * 这条用例从组装好的运行时走一遍，断言**草稿真的成型**且新对象另起了 id。
   */
  it("drafts onto a document that already holds an object of the same kind", async () => {
    const document = geometryDocument()
    document.primitives.push({ id: "solid-1", type: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 }, label: "立方体" } as never)
    const { runtime, written } = makeRuntime({ document })

    const events = await drive(runtime.coordinator, { run: runContext(document), userMessage: "再建一个立方体" })

    expect(events.at(-1)).toBe("awaiting_confirmation")
    const draftId = runtime.committer.draftIdFor()
    expect(draftId).not.toBeNull()
    expect(runtime.drafts.getPreview(draftId!)?.candidate.primitives.map((primitive) => primitive.id)).toEqual(["solid-1", "solid-2"])
    // 草稿阶段真文档一个字节都没变。
    expect(written).toHaveLength(0)
  })

  it("completes a read-only run through the assembled observer", async () => {
    const { runtime, written } = makeRuntime({ envelope: answerEnvelope() })

    const events = await drive(runtime.coordinator, { run: runContext(), userMessage: "数一下有几个对象" })

    expect(events).toEqual(["preflight", "observing", "planning", "answering", "completed"])
    expect(written).toHaveLength(0)
  })

  it("refuses to commit without a host-minted consent token", async () => {
    // 同意凭据只能由宿主创建；`createAgentRuntime` 刻意不注入它，所以带 `confirmed` 也提交不了。
    const { runtime, written } = makeRuntime()

    const events = await drive(runtime.coordinator, { run: runContext(), userMessage: "建个立方体", confirmed: true })

    expect(events.at(-1)).toBe("awaiting_confirmation")
    expect(written).toHaveLength(0)
  })

  it("leaves the live document alone when the compiler refuses the plan", async () => {
    const badPlan: PlanEnvelope = { schemaVersion: "mathcanvas.plan.v1", kind: "plan", goal: "建一个不存在的动作", factIds: [], actions: [{ actionId: "planar.create_dragon" as never, actionKey: "d", factIds: [], inputs: {} as never }] }
    const { runtime, written } = makeRuntime({ envelope: badPlan })

    const events = await drive(runtime.coordinator, { run: runContext(), userMessage: "建个立方体" })

    expect(events.at(-1)).toBe("failed")
    expect(written).toHaveLength(0)
  })

  it("shares one draft store between the tools and the committer", async () => {
    // 若两处各建一个 `DraftStore`，模型看到的草稿与提交的不是一回事。
    const { runtime } = makeRuntime()

    const created = runtime.draftTools.create({
      projectId,
      documentId: "doc-1",
      workspace: "geometry3d",
      epoch: "epoch:doc-1",
      generation: 0,
      contentHash: ""
    })
    const staged = runtime.draftTools.stage(created.draftId, [{ actionId: "solid.create_template", actionKey: "cube", factIds: [], inputs: { alias: "cube", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } } } as never], created.draftVersion)

    expect(staged.ok).toBe(true)
    // 协调器那边的宿主桥读的是**同一个**存储：它能预览到这个草稿。
    expect(runtime.hostBridge().preview(created.draftId).ok).toBe(true)
  })

  it("reports a staging failure without mutating the draft version", async () => {
    const { runtime } = makeRuntime()
    const created = runtime.draftTools.create({ projectId, documentId: "doc-1", workspace: "geometry3d", epoch: "epoch:doc-1", generation: 0, contentHash: "" })

    // 未知动作名 → 编译器拒绝。
    const staged = runtime.draftTools.stage(created.draftId, [{ actionId: "planar.create_dragon" as never, actionKey: "d", factIds: [], inputs: {} as never }], created.draftVersion)

    expect(staged.ok).toBe(false)
    expect(staged.unchanged).toBe(true)
  })

  it("answers export preflight questions through the injected port", () => {
    const { runtime } = makeRuntime()

    expect(runtime.scene.inspect("doc-unknown").status).toBe("error")
  })

  /**
   * **只读工具的接线**（Task 2.4 真正缺的那一段）。
   *
   * 在 `callTool` 存在之前，"接上 `ToolPort`"是一句空话：端口不知道要执行哪个工具、
   * 也没有参数。这条用例走的是**真实**的路径：运行时 → 分发表 → `SceneTools` → 观察层，
   * 一个替身都没有（唯一的替身是那个脚本化 planner，而这里根本没用到它）。
   */
  it("runs a read-only tool through the dispatcher and reports what it found", () => {
    const document = geometryDocument()
    document.primitives.push({ id: "point-1", type: "point3", label: "A", position: { x: 0, y: 0, z: 0 } } as never)
    const { runtime } = makeRuntime({ document })

    const result = runtime.callTool("scene.inspect", { documentId: document.metadata.id })

    expect(result.status).toBe("success")
    expect(result.payload).toHaveLength(1)
  })

  it("refuses to run a tool that writes the document, and leaves the document alone", () => {
    const { runtime, written, current } = makeRuntime()

    const result = runtime.callTool("draft.confirm_commit", {})

    expect(result.status).toBe("error")
    expect(result.diagnostics.map((entry) => entry.code)).toContain("unknown_tool")
    expect(written).toHaveLength(0)
    expect(current()?.primitives).toHaveLength(0)
  })

  it("reads the scene fresh on every tool call instead of caching the first snapshot", () => {
    // 观察层的"过期"检测靠现取；缓存快照会让工具一直看到旧场景。
    const document = geometryDocument()
    const { runtime } = makeRuntime({ document })
    expect(runtime.callTool("scene.inspect", { documentId: document.metadata.id }).payload).toHaveLength(0)

    document.primitives.push({ id: "point-2", type: "point3", label: "B", position: { x: 1, y: 0, z: 0 } } as never)

    expect(runtime.callTool("scene.inspect", { documentId: document.metadata.id }).payload).toHaveLength(1)
  })

  /**
   * **组装好的运行时也把上下文交给规划器**（2026-09-21）。
   *
   * 协调器那一层的接线有自己的用例（`coordinatorContext.test.ts`），但"接线在**组装之后**
   * 是否仍然成立"是另一回事：真实运行时注入的是它自己的观察者与句柄。这条用例抓的是
   * `PlanRequest.model` 在整条链上**落地**，而不只是"组件本身能跑"。
   */
  it("hands the assembled planner a context carrying the live handle", async () => {
    const document = geometryDocument()
    const seen: PlanRequest[] = []
    const planner: PlannerPort = {
      plan: async (request) => {
        seen.push(request)
        return { plan: planEnvelope(), requestId: "req-1", attemptId: "attempt-1" }
      }
    }
    const runtime = createAgentRuntime({
      readDocument: () => document,
      writeDocument: () => {},
      readSceneDocuments: () => [{ handle: { projectId, documentId: document.metadata.id, workspace: "geometry3d", epoch: `epoch:${document.metadata.id}`, generation: document.revision, contentHash: contentFingerprint(document) }, document }],
      planner,
      exportPreflight: exportPreflight(),
      projectId,
      runId: "run-1",
      now: () => 1_000
    })

    await drive(runtime.coordinator, { run: runContext(document), userMessage: "建个立方体" })

    expect(seen).toHaveLength(1)
    expect(seen[0].model.context.handles.target.documentId).toBe(document.metadata.id)
    expect(seen[0].model.context.workspace).toBe("geometry3d")
    // 规划阶段的工具已按阶段发布（这条链上不能出现提交工具）。
    expect(seen[0].model.tools.every((tool) => tool.effect !== "commit")).toBe(true)
  })

  /**
   * **技能清单是可用动作的唯一来源**（Task 2.2 Step 2/4）。
   *
   * 在接线之前 `requestedSkillIds` 与 `availableActions` 都是空数组 —— 也就是说
   * 模型看到的上下文里**一个可用动作都没有**，九个签入的清单一次都没被用过。
   *
   * 关键设计：调用方说"请求哪些技能"，运行时去清单里取动作，**而不是让调用方直接给一串动作名**。
   * 后者等于绕开清单（调用方可以声明任何名字），而清单正是"这次允许用哪一小撮"那份声明。
   */
  it("carries the requested skill and the actions it declares into the context", async () => {
    const seen: PlanRequest[] = []
    const planner: PlannerPort = {
      plan: async (request) => {
        seen.push(request)
        return { plan: planEnvelope(), requestId: "req-1", attemptId: "attempt-1" }
      }
    }
    const document = geometryDocument()
    const runtime = createAgentRuntime({
      readDocument: () => document,
      writeDocument: () => {},
      readSceneDocuments: () => [{ handle: { projectId, documentId: document.metadata.id, workspace: "geometry3d", epoch: `epoch:${document.metadata.id}`, generation: document.revision, contentHash: contentFingerprint(document) }, document }],
      planner,
      exportPreflight: exportPreflight(),
      projectId,
      runId: "run-1",
      now: () => 1_000,
      requestedSkillIds: ["spatial-modeling"]
    })

    await drive(runtime.coordinator, { run: runContext(document, SKILL_CATALOGUE_REVISION), userMessage: "建个立方体" })

    const context = seen[0].model.context
    expect(context.skills.map((skill) => skill.id)).toEqual(["spatial-modeling"])
    // 清单声明的动作就是上下文里的可用动作（`spatial-modeling` 声明模板实体与拉伸式棱柱两种）。
    expect([...context.availableActions]).toEqual(["solid.create_template", "solid.create_prism"])
    // 没有请求的技能不该出现，而且**不该**变成一条"未登记"警告（那是给清单本身有问题用的）。
    expect(context.warnings).toEqual([])
  })

  /**
   * **观察者必须把事实的文本交出去**（2026-09-21）。
   *
   * 上一批给 `Observation` 补了 `facts?: { id; text; origin }[]`，理由是"只有 id 的话，
   * 模型看得到『有一个事实 point-1』，看不到『point-1 是点 A』"。
   * 但补了形状不等于补了数据：运行时的观察者从第一版起就在算那个数组，
   * **只是没有把它放进返回值** —— 于是上下文里的事实仍然是空/只有 id。
   *
   * 这条用例是**变异检验抓出来的**：把 `facts` 从返回值里去掉，全量用例仍然全绿
   *（因为既有用例的场景都是空文档，根本没有事实）。补上这条之后再去掉就会红。
   */
  it("hands the planner the fact text, not just entity ids", async () => {
    const document = geometryDocument()
    document.primitives.push({ id: "point-1", type: "point3", label: "点 A", position: { x: 0, y: 0, z: 0 } } as never)
    const seen: PlanRequest[] = []
    const planner: PlannerPort = {
      plan: async (request) => {
        seen.push(request)
        return { plan: planEnvelope(), requestId: "req-1", attemptId: "attempt-1" }
      }
    }
    const runtime = createAgentRuntime({
      readDocument: () => document,
      writeDocument: () => {},
      readSceneDocuments: () => [{ handle: { projectId, documentId: document.metadata.id, workspace: "geometry3d", epoch: `epoch:${document.metadata.id}`, generation: document.revision, contentHash: contentFingerprint(document) }, document }],
      planner,
      exportPreflight: exportPreflight(),
      projectId,
      runId: "run-1",
      now: () => 1_000
    })

    await drive(runtime.coordinator, { run: runContext(document), userMessage: "建个立方体" })

    const facts = seen[0].model.context.facts
    expect(facts).toHaveLength(1)
    expect(facts[0].id).toBe("point-1")
    // 文本是重点：只有 id 的话模型等于看不到这个对象是什么。
    expect(facts[0].text).toBe("点 A")
    expect(facts[0].origin).toBe("user")
  })

  it("drops a skill id that is not in the catalogue instead of warning about it", async () => {    const seen: PlanRequest[] = []
    const planner: PlannerPort = {
      plan: async (request) => {
        seen.push(request)
        return { plan: planEnvelope(), requestId: "req-1", attemptId: "attempt-1" }
      }
    }
    const document = geometryDocument()
    const runtime = createAgentRuntime({
      readDocument: () => document,
      writeDocument: () => {},
      readSceneDocuments: () => [{ handle: { projectId, documentId: document.metadata.id, workspace: "geometry3d", epoch: `epoch:${document.metadata.id}`, generation: document.revision, contentHash: contentFingerprint(document) }, document }],
      planner,
      exportPreflight: exportPreflight(),
      projectId,
      runId: "run-1",
      now: () => 1_000,
      requestedSkillIds: ["no-such-skill"]
    })

    await drive(runtime.coordinator, { run: runContext(document), userMessage: "建个立方体" })

    expect(seen[0].model.context.skills).toEqual([])
    expect(seen[0].model.context.warnings).toEqual([])
  })

  /**
   * **`prepare` 换掉目标文档这件事必须如实记录**（2026-09-21 审查发现，本批只写用例不改流程）。
   *
   * 真实场景：用户在平面几何里说"建一个立方体"，规划器给出空间动作，`prepare` 把工作区切到
   * 立体几何 —— 于是**目标文档换了一份**。而上下文是在**规划之前**组装好的，里面还写着旧的
   * `target` 手柄与旧的事实。也就是说：**模型看到的是文档 A 的场景，而动作会被编译到文档 B 上**。
   *
   * 为什么本批不改：能让模型看到正确目标的那次生成发生在【第 N+1 次往返】（例如 schema 修复），
   * 而一次成功的运行只有一次生成 —— 所以"在 prepare 之后重算上下文"在当前流程里**是没有读者的**。
   * 与其塞一段"看起来修好了"但没人读的代码，不如把现状钉成用例：它现在确实是错的，
   * 修它属于 Task 2.3 那条"修复往返"接上之后的独立切片。
   *
   * 这条用例的价值在于：**它记录的是事实，不是期望** —— 谁哪天把这个行为改对了，它会立刻红，
   * 从而逼出一次有意的决定（而不是悄悄变化）。
   */
  it("records that a workspace switch happens after the context was built (known gap)", async () => {
    const planar = createEmptyDocument("conics")
    const spatial = createEmptyDocument("geometry3d")
    let live = planar
    const seen: PlanRequest[] = []
    const planner: PlannerPort = {
      plan: async (request) => {
        seen.push(request)
        return { plan: planEnvelope(), requestId: "req-1", attemptId: "attempt-1" }
      }
    }
    const runtime = createAgentRuntime({
      readDocument: () => live,
      writeDocument: () => {},
      readSceneDocuments: () => [{ handle: { projectId, documentId: live.metadata.id, workspace: live.workspace as "conics" | "geometry3d", epoch: `epoch:${live.metadata.id}`, generation: live.revision, contentHash: contentFingerprint(live) }, document: live }],
      planner,
      exportPreflight: exportPreflight(),
      projectId,
      runId: "run-1",
      now: () => 1_000,
      // 模拟真实的 `prepareWorkspaceFor`：把工作区切到计划需要的那个。
      prepare: () => { live = spatial; return { ok: true } }
    })

    await drive(runtime.coordinator, { run: runContext(planar), userMessage: "建个立方体" })

    // 模型看到的是**切换之前**的那份文档 —— 这是已知缺口，不是期望行为。
    expect(seen[0].model.context.handles.target.documentId).toBe(planar.metadata.id)
    expect(seen[0].model.context.workspace).toBe("conics")
    // 而真正被编译的目标已经是切换之后的那份。
    expect(live.metadata.id).toBe(spatial.metadata.id)
  })
})

/**
 * **两道代表题**（Agent DSL 切片 Task 6；规格 §8.1/§8.2）。
 *
 * 走的是**装配好的真实运行时**：确定性规划器（代表题夹具）→ 传输校验 → 六层编译
 *（含依赖顺序与参数审计）→ 隔离草稿 → 停在确认。断言的重点是**计划真的长成规格要求的样子**，
 * 以及"确认之前真文档一个字节都不变"。
 */
describe("representative tasks from the design", () => {
  it("drafts the oblique-prism section with midpoints at 0.5 and a moving point at the audited 0.4", async () => {
    const { runtime, written, current } = makeRuntime({ envelope: obliquePrismSectionPlan(), document: createEmptyDocument("geometry3d") })

    const events = await drive(runtime.coordinator, { run: runContext(createEmptyDocument("geometry3d")), userMessage: OBLIQUE_PRISM_PROMPT })

    expect(events.at(-1)).toBe("awaiting_confirmation")
    // 确认之前草稿是隔离的：没有任何一次写入。
    expect(written).toHaveLength(0)
    expect(current()?.primitives).toHaveLength(0)

    const draftId = runtime.draftId()
    const preview = draftId === null ? null : runtime.drafts.getPreview(draftId)
    expect(preview).not.toBeNull()

    const plan = obliquePrismSectionPlan()
    if (plan.kind !== "plan") throw new Error("the prism fixture must be a plan")
    // 一笔 `solid.create_prism`（不是"把散面拼起来"）：六个面由内核生成。
    expect(plan.actions.filter((action) => action.actionId === "solid.create_prism")).toHaveLength(1)
    // 三个中点的参数是**题目的显式约束** 0.5。
    const midpoints = plan.actions.filter((action) => action.actionKey.startsWith("midpoint-"))
    expect(midpoints).toHaveLength(3)
    for (const midpoint of midpoints) expect(midpoint.inputs).toMatchObject({ parameter: 0.5 })
    // 一个截面节点。
    expect(plan.actions.some((action) => action.actionId === "section.create")).toBe(true)
    // 一个可动的边界点：位置未指定 → 审计回填 0.4，并作为**假设**交给界面。
    expect(plan.actions.find((action) => action.actionKey === "moving-point")?.inputs).not.toHaveProperty("parameter")
    expect(runtime.assumptions()?.some((text) => text.includes("0.4"))).toBe(true)

    const primitives = preview?.candidate.primitives ?? []
    expect(primitives.filter((primitive) => primitive.type === "polyhedron3")).toHaveLength(1)
    expect(primitives.some((primitive) => primitive.type === "section")).toBe(true)
    // E/M/N/P：三个中点 + 一个动点，都是宿主绑定的点（不是自由点）。
    const bound = primitives.filter((primitive) => primitive.type === "point3" && (primitive as { binding?: { kind?: string } }).binding?.kind === "onHost")
    expect(bound).toHaveLength(4)
    expect(bound.filter((primitive) => (primitive as { binding?: { parameter?: number } }).binding?.parameter === 0.5)).toHaveLength(3)
    expect(bound.filter((primitive) => (primitive as { binding?: { parameter?: number } }).binding?.parameter === 0.4)).toHaveLength(1)
  })

  it("keeps the conic parameter symbolic and labels the invariant as numeric sampling", async () => {
    const document = createEmptyDocument("conics")
    const { runtime, written, current } = makeRuntime({ envelope: conicInvariantPlan(), document })

    const events = await drive(runtime.coordinator, { run: runContext(document), userMessage: CONIC_INVARIANT_PROMPT })

    expect(events.at(-1)).toBe("awaiting_confirmation")
    expect(written).toHaveLength(0)
    expect(current()?.primitives).toHaveLength(0)

    const plan = conicInvariantPlan()
    if (plan.kind !== "plan") throw new Error("the conic fixture must be a plan")
    // 符号参数 θ 被**保留**：它被建成文档参数，而不是一组数字。
    const theta = plan.actions.find((action) => action.actionKey === "theta")
    expect(theta?.inputs).toMatchObject({ id: "theta" })
    // P 由 θ 驱动（`parameterId`），所以拖动 θ 就是"任意点"。
    expect(plan.actions.find((action) => action.actionKey === "P")?.inputs).toMatchObject({ parameterId: "theta" })
    // 切线跟随 P。
    expect(plan.actions.find((action) => action.actionKey === "tangent-P")?.inputs).toMatchObject({ sourceId: "draft:P" })

    const draftId = runtime.draftId()
    const preview = draftId === null ? null : runtime.drafts.getPreview(draftId)
    expect(preview?.candidate.parameters.theta).toMatchObject({ id: "theta", label: "θ" })
    expect(preview?.candidate.primitives.some((primitive) => primitive.type === "ellipse")).toBe(true)
    expect(preview?.candidate.primitives.some((primitive) => primitive.type === "tangent")).toBe(true)

    // **数值采样 ≠ 形式证明**：这句话必须出现在用户能看到的假设里。
    expect(runtime.assumptions()?.some((text) => text.includes("不是形式证明"))).toBe(true)
  })
})
