import { createBudget, createCoordinator, type Observation, type ObservedDerivedStatus, type PlannerPort, type PlanRequest } from "@draw/agent-core"
import { describe, expect, it, vi } from "vitest"

import { buildSystemPrompt } from "./systemPrompt"

/**
 * **上下文的派生读数上限必须能从协调器收紧**（修复轮 1 / M10）。
 *
 * 三个组装器各有一份"派生读数上限"的目的地：
 * 1. `buildContext` 用 `limits.derived`（模型上下文那一份，也是**计费与警告**的那一份）；
 * 2. `buildConversationContext` 用 `limits.derived`（会话那一份）；
 * 3. 提示词渲染的是**会话那一份**（`conversation.observation.derived ?? context.derived`）。
 *
 * 协调器的 `contextLimits` 此前只有 `facts` / `refs`，于是运行级的"这一轮少给几条读数"
 * 只落在第 1 条上，第 3 条照旧渲染未收紧的那一份 —— 上限看着生效了，模型看到的没变。
 * 这条用例从**真实协调器**出发，一路断言到提示词里真正渲染出来的条数。
 */
const READINGS: ObservedDerivedStatus[] = [
  { entityId: "solid-1", code: "derived.circumsphere", status: "exact", message: "外接球：半径 1.732。" },
  { entityId: "solid-1", code: "derived.insphere", status: "undefined", message: "内切球：该多面体没有内切球。" },
  { entityId: "solid-2", code: "derived.circumsphere", status: "degenerate", message: "外接球：输入退化。" }
]

function answerEnvelope() {
  return { schemaVersion: "mathcanvas.plan.v1", kind: "answer" as const, goal: "数一下", factIds: [], answer: "3", toolResultRefs: [] }
}

/** 跑一次协调器，把规划器收到的那一份请求交出来（观察里带三条读数）。 */
async function captureRequest(contextLimits?: { facts?: number; refs?: number; derived?: number }) {
  const requests: PlanRequest[] = []
  const planner: PlannerPort = {
    plan: vi.fn(async (request: PlanRequest) => {
      requests.push(request)
      return { plan: answerEnvelope(), requestId: "req-1", attemptId: "attempt-1" }
    })
  }
  const observation: Observation = { factIds: [], summary: "scene", derived: READINGS }
  const coordinator = createCoordinator({
    planner,
    observer: { observe: vi.fn(async () => observation) },
    committer: { stage: vi.fn(async () => ({ ok: true as const, draftVersion: 1, previewHash: "p" })), commit: vi.fn(async () => ({ status: "committed" as const })) },
    budget: createBudget(),
    ...(contextLimits === undefined ? {} : { contextLimits })
  })
  for await (const _event of coordinator.start({ run: runContext(), userMessage: "数一下" })) void _event

  expect(requests).toHaveLength(1)
  return requests[0]!
}

function runContext() {
  return {
    runId: "run-1",
    conversationId: "conv-1",
    promptMessageId: "msg-1",
    target: { projectId: "project-1", documentId: "document-1", workspace: "geometry3d" as const, epoch: "epoch:document-1", generation: 1, contentHash: "hash-1" },
    sources: [],
    textProfileId: "profile-1",
    capabilityRevision: "rev",
    policyRevision: "policy"
  }
}

describe("coordinator context limits", () => {
  it("threads the tightened derived limit into the copy the prompt renders", async () => {
    const request = await captureRequest({ derived: 1 })

    // 1) 模型上下文那一份被收紧（并且留了痕）。
    expect(request.model.context.derived).toHaveLength(1)
    expect(request.model.context.warnings.map((warning) => warning.code)).toContain("truncated_derived")
    // 2) **会话那一份**同样被收紧 —— 提示词渲染的正是它。
    expect(request.conversation.observation.derived).toHaveLength(1)

    // 3) 真正渲染出来的条数就是收紧后的那一条（不是"看着生效了、模型看到的没变"）。
    const prompt = buildSystemPrompt({ context: request.model.context, conversation: request.conversation, channel: "strict_json", canPlan: true })
    const scene = JSON.parse(prompt.contextJson).scene as { derived: { code: string }[] }
    expect(scene.derived).toHaveLength(1)
    expect(scene.derived[0]?.code).toBe("derived.circumsphere")
    expect(prompt.contextJson).toContain("truncated_derived")
  })

  it("leaves the readings alone when no limit is asked for", async () => {
    const request = await captureRequest()

    // 三条都留着（默认上限 12）：这条是上一条的对照，免得"收紧"其实来自别处。
    expect(request.conversation.observation.derived).toHaveLength(READINGS.length)
    const prompt = buildSystemPrompt({ context: request.model.context, conversation: request.conversation, channel: "strict_json", canPlan: true })
    expect((JSON.parse(prompt.contextJson).scene as { derived: unknown[] }).derived).toHaveLength(READINGS.length)
  })
})
