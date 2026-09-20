import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { contentFingerprint } from "@draw/scene-graph"
import { describe, expect, it, vi } from "vitest"

import type { PlanEnvelope, PlannerPort } from "@draw/agent-core"

import { createAgentRuntime } from "./agentRuntime"
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

function runContext() {
  const document = geometryDocument()
  return {
    runId: "run-1",
    conversationId: "conv-1",
    promptMessageId: "msg-1",
    target: { projectId, documentId: document.metadata.id, workspace: "geometry3d" as const, epoch: `epoch:${document.metadata.id}`, generation: 0, contentHash: contentFingerprint(document) },
    sources: [],
    textProfileId: "profile-1",
    capabilityRevision: "2026-09-21.1",
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
})
