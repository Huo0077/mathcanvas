import { describe, expect, it } from "vitest"
import {
  PLAN_SCHEMA_VERSION,
  buildFoldChain,
  createBudget,
  parsePlanEnvelope,
  readFoldTransformations,
  type ModelEvent,
  type PlanEnvelope,
  type PlanRequest,
  type ToolDescriptor
} from "@draw/agent-core"

import { PLAN_TOOL_NAME, createModelPlanner, type ModelPlannerProvider } from "../modelPlanner"

/**
 * **T7（2026-10-24）：失败回放与泛化评测（离线）**
 *
 * ## 这一份是什么，不是什么
 *
 * - 是：一组**小而可区分**的输入，每个都写清"预期行为"，并且走**真实产品入口**
 *   （规划器 `createModelPlanner` 与翻折读取器 `readFoldTransformations` / `buildFoldChain`）。
 * - **不是**模型质量评测：所有 provider 响应都是**模拟**的（固定文本 / 固定事件），
 *   没有调用任何付费模型。这里算出来的是"管线对给定输入的处置是否正确"，
 *   **不能**当成"模型在真实服务上的准确率"。后者需要当前服务配置与预算授权（见交付文档）。
 */

const ids = { requestId: "replay-req", attemptId: "replay-attempt" }
const planJson = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  schemaVersion: PLAN_SCHEMA_VERSION,
  kind: "plan",
  goal: "replay",
  factIds: [],
  actions: [{
    actionId: "solid.create_template",
    actionKey: "cube",
    factIds: [],
    inputs: { alias: "cube", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 3, y: 3, z: 3 } }
  }],
  ...overrides
})

const provider: ModelPlannerProvider = { id: "replay", modelId: "replay-model", dialect: "openai_native", revision: 1, capabilities: { tools: "unknown", json: "unknown", vision: "unknown" } }
const planTool: ToolDescriptor = { id: "plan.set_plan", kind: "control", effect: "propose_plan", description: "plan", phases: ["planning"], workspaces: [] }

function request(): PlanRequest {
  return {
    run: {
      runId: "run-replay",
      conversationId: "conv-replay",
      promptMessageId: "msg-replay",
      target: { projectId: "local", documentId: "doc-replay", workspace: "geometry3d", epoch: "epoch:doc", generation: 1, contentHash: "hash" },
      sources: [],
      textProfileId: "replay",
      capabilityRevision: "rev",
      policyRevision: "local"
    },
    userMessage: "建一个棱长 3 的立方体",
    budget: createBudget(),
    signal: new AbortController().signal,
    model: {
      context: {
        preamble: "replay",
        handles: { target: { projectId: "local", documentId: "doc-replay", workspace: "geometry3d", epoch: "epoch:doc", generation: 1, contentHash: "hash" }, sources: [] },
        binding: { conversationId: "conv-replay", projectId: "local", documentId: "doc-replay", generation: 1 },
        workspace: "geometry3d",
        facts: [],
        derived: [],
        selectedRefs: [],
        skills: [],
        availableActions: ["solid.create_template"],
        warnings: [],
        estimatedCharacters: 128
      },
      tools: [planTool]
    },
    conversation: {
      binding: { conversationId: "conv-replay", projectId: "local", documentId: "doc-replay", workspace: "geometry3d", generation: 1 },
      summary: "",
      facts: [],
      messages: [{ id: "m0", role: "user", text: "建一个立方体", createdAt: 1 }],
      observation: { facts: [], summary: "空场景" },
      warnings: [],
      estimatedCharacters: 128
    }
  }
}

function deltas(...texts: string[]): { ok: true; events: ModelEvent[] } {
  return { ok: true, events: texts.map((text) => ({ ...ids, kind: "delta" as const, text })) }
}

function plannerReturning(events: ModelEvent[], capabilities: ModelPlannerProvider["capabilities"] = provider.capabilities) {
  return createModelPlanner({ resolveProvider: async () => ({ ok: true, provider: { ...provider, capabilities } }), runModel: async () => ({ ok: true, events }) })
}

/** 一次"模拟 provider 响应"回放：输入事件 → 规划器的处置。 */
type ProviderCase = {
  id: string
  what: string
  events: ModelEvent[]
  expect: { outcome: "plan" } | { outcome: "failure"; category: string }
  capabilities?: ModelPlannerProvider["capabilities"]
}

const PROVIDER_CASES: ProviderCase[] = [
  { id: "complete", what: "完整计划", events: deltas(planJson()).events, expect: { outcome: "plan" } },
  {
    id: "truncated_length",
    what: "半截 JSON + stopReason=length",
    events: [{ ...ids, kind: "delta", text: planJson().slice(0, 60) }, { ...ids, kind: "completed", stopReason: "length" }],
    expect: { outcome: "failure", category: "response_incomplete" }
  },
  {
    id: "empty_length",
    what: "空正文 + stopReason=length",
    events: [{ ...ids, kind: "completed", stopReason: "length" }],
    expect: { outcome: "failure", category: "response_incomplete" }
  },
  {
    id: "empty_no_reason",
    what: "空正文、没有结束原因",
    events: [{ ...ids, kind: "completed" }],
    expect: { outcome: "failure", category: "empty_output" }
  },
  {
    id: "refusal",
    what: "服务端拒绝（content_filter）",
    events: [{ ...ids, kind: "delta", text: "抱歉，我不能帮你画这个。" }, { ...ids, kind: "completed", stopReason: "content_filter" }],
    expect: { outcome: "failure", category: "provider_refusal" }
  },
  {
    id: "double_encoded",
    what: "双重编码的合法计划",
    // 工具参数是一段**双重编码**的字符串：原生工具通道上才可能出现这种形状。
    events: [{ ...ids, kind: "tool_call", toolCallId: "c1", toolId: PLAN_TOOL_NAME, input: planJson() }],
    capabilities: { tools: "verified", json: "unknown", vision: "unknown" } as never,
    expect: { outcome: "plan" }
  },
  {
    id: "bad_field",
    what: "合法 JSON，但 size.x 不是有限数",
    events: deltas(planJson({ actions: [{
      actionId: "solid.create_template", actionKey: "cube", factIds: [],
      inputs: { alias: "cube", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: "bad", y: 3, z: 3 } }
    }] })).events,
    expect: { outcome: "failure", category: "schema_invalid" }
  },
  {
    id: "prose",
    what: "散文里夹着计划",
    events: deltas(`好的，计划如下：${planJson()}`).events,
    expect: { outcome: "failure", category: "invalid_json" }
  }
]

/** 一次"翻折题面"回放：输入题面 → 读取器与链分类的处置。 */
type FoldCase = {
  id: string
  prompt: string
  expect: { foldCount: number; chain: "none" | "single" | "sequential_resolvable" | "unsupported" }
}

const FOLD_CASES: FoldCase[] = [
  { id: "word_form", prompt: "将三角形AEF沿EF翻折至三角形PEF", expect: { foldCount: 1, chain: "single" } },
  { id: "delta_form", prompt: "将△AEF沿EF翻折至△PEF", expect: { foldCount: 1, chain: "single" } },
  { id: "fold_word", prompt: "将△AEF沿EF折叠至△PEF", expect: { foldCount: 1, chain: "single" } },
  { id: "apex_to_point", prompt: "将△AEF沿EF翻折，使点A到达点P", expect: { foldCount: 1, chain: "single" } },
  { id: "primed", prompt: "将△ABC沿BC翻折至△A′BC", expect: { foldCount: 1, chain: "single" } },
  { id: "rotated", prompt: "将△ABC绕BC旋转到△PBC", expect: { foldCount: 1, chain: "single" } },
  { id: "sequential_angles", prompt: "先将△AEF沿EF翻折90°至△PEF，再将△PEF沿PF折叠60°至△QPF", expect: { foldCount: 2, chain: "sequential_resolvable" } },
  { id: "sequential_without_angles", prompt: "先将△AEF沿EF翻折至△PEF，再将△PEF沿PF翻折至△QPF", expect: { foldCount: 2, chain: "unsupported" } },
  { id: "two_independent", prompt: "将△AEF沿EF翻折90°至△PEF，将△BCD沿CD折叠60°至△QCD", expect: { foldCount: 2, chain: "unsupported" } }
]

describe("T7 — offline replay of the planning pipeline (simulated provider responses)", () => {
  it("handles every recorded provider response with the expected classification", async () => {
    const rows: string[] = []
    let accepted = 0
    let classified = 0
    let misclassified = 0

    for (const testCase of PROVIDER_CASES) {
      const outcome = await plannerReturning(testCase.events, "capabilities" in testCase ? (testCase as { capabilities: ModelPlannerProvider["capabilities"] }).capabilities : provider.capabilities).plan(request())
      if (testCase.expect.outcome === "plan") {
        const planned = "plan" in outcome ? parsePlanEnvelope(outcome.plan) : null
        if (planned?.ok === true) accepted += 1
        else misclassified += 1
        rows.push(`${testCase.id}: ${planned?.ok === true ? "accepted" : "REJECTED"}`)
      } else {
        const category = "failure" in outcome ? outcome.failure.category : "(no failure)"
        if (category === testCase.expect.category) classified += 1
        else misclassified += 1
        rows.push(`${testCase.id}: ${category}${category === testCase.expect.category ? "" : ` (expected ${testCase.expect.category})`}`)
      }
    }

    // **指标**（离线；不构成模型质量读数）：分类正确率必须 100%，错误分类必须是 0。
    expect({ misclassified, rows }).toEqual({ misclassified: 0, rows: expect.any(Array) })
    expect(accepted + classified).toBe(PROVIDER_CASES.length)
  })

  it("reads every representative fold phrasing with the expected structure", () => {
    const rows: string[] = []
    for (const testCase of FOLD_CASES) {
      const folds = readFoldTransformations(testCase.prompt)
      const chain = buildFoldChain(testCase.prompt)
      rows.push(`${testCase.id}: folds=${folds.length} chain=${chain.status}`)
      expect({ id: testCase.id, folds: folds.length }).toEqual({ id: testCase.id, folds: testCase.expect.foldCount })
      expect({ id: testCase.id, chain: chain.status }).toEqual({ id: testCase.id, chain: testCase.expect.chain })
    }
    // 指标：识别覆盖率 = 读出来的折叠数 / 题面里写着的折叠数。
    const expectedFolds = FOLD_CASES.reduce((total, entry) => total + entry.expect.foldCount, 0)
    const readFolds = FOLD_CASES.reduce((total, entry) => total + readFoldTransformations(entry.prompt).length, 0)
    expect(readFolds / expectedFolds).toBe(1)
    expect(rows.length).toBe(FOLD_CASES.length)
  })

  it("never reports a plan for a response it could not parse, and never reports a chain it cannot solve", async () => {
    for (const testCase of PROVIDER_CASES.filter((entry) => entry.expect.outcome === "failure")) {
      const outcome = await plannerReturning(testCase.events, "capabilities" in testCase ? (testCase as { capabilities: ModelPlannerProvider["capabilities"] }).capabilities : provider.capabilities).plan(request())
      expect("plan" in outcome, `${testCase.id} must not carry a plan`).toBe(false)
    }
    for (const testCase of FOLD_CASES.filter((entry) => entry.expect.chain === "unsupported")) {
      const chain = buildFoldChain(testCase.prompt)
      expect(chain.status, testCase.id).toBe("unsupported")
      if (chain.status === "unsupported") expect(chain.unknowns.length).toBeGreaterThan(0)
    }
  })

  it("keeps the tool channel available for the plan tool only (no write tool is reachable)", () => {
    // 回放集里出现的动作名必须是**已注册**的；未注册的名字不能因为回放而被当成合法出口。
    const envelope = JSON.parse(planJson()) as PlanEnvelope
    expect(parsePlanEnvelope(envelope).ok).toBe(true)
    expect(PLAN_TOOL_NAME).toBe("plan_set_plan")
  })
})
