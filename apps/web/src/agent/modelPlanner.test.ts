import { describe, expect, it, vi } from "vitest"
import { PLAN_SCHEMA_VERSION, createBudget, parsePlanEnvelope, type ModelContext, type PlanRequest, type ToolDescriptor } from "@draw/agent-core"

import type { ProviderHealth, ProviderProfile } from "../services/providerProfileClient"
import { createModelPlanner, toGateCapabilities, type ModelPlannerProvider } from "./modelPlanner"

/**
 * **模型规划器的判据**（G2 接线）。
 *
 * 这一组用例刻意**一个 IPC 都不用**：`resolveProvider` 与 `runModel` 都是注入的，
 * 所以"用哪一份配置""发什么形状的请求""模型说的话怎么被解释"都能确定性跑。
 * 真实的 IPC 只在 `resolveActiveProvider` 那一个函数里，而它是薄薄一层转发。
 */

const goodEnvelope = JSON.stringify({
  schemaVersion: PLAN_SCHEMA_VERSION,
  kind: "plan",
  goal: "建一个棱长 3 的立方体",
  factIds: [],
  actions: [{ actionId: "solid.create_template", actionKey: "cube", factIds: [], inputs: { alias: "cube", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 3, y: 3, z: 3 } } }]
})

const planTool: ToolDescriptor = { id: "plan.set_plan", kind: "control", effect: "propose_plan", description: "提交本轮的构图计划（动作序列），只产生隔离草稿", phases: ["planning"], workspaces: [] }

function context(overrides: Partial<ModelContext> = {}): ModelContext {
  return {
    preamble: "你是 MathCanvas 的构图助手。",
    handles: { target: { projectId: "local", documentId: "doc-1", workspace: "geometry3d", epoch: "epoch:doc-1", generation: 4, contentHash: "hash" }, sources: [] },
    workspace: "geometry3d",
    facts: [{ id: "cube-1", text: "立方体 cube-1", origin: "user" }],
    selectedRefs: [],
    skills: [],
    availableActions: ["solid.create_template", "planar.create_point"],
    warnings: [],
    estimatedCharacters: 128,
    ...overrides
  }
}

function request(overrides: Partial<PlanRequest> = {}): PlanRequest {
  return {
    run: {
      runId: "run-1",
      conversationId: "conv-1",
      promptMessageId: "msg-1",
      target: { projectId: "local", documentId: "doc-1", workspace: "geometry3d", epoch: "epoch:doc-1", generation: 4, contentHash: "hash" },
      sources: [],
      textProfileId: "openai-1",
      capabilityRevision: "2026-09-19.1",
      policyRevision: "local"
    },
    userMessage: "建一个棱长 3 的立方体",
    budget: createBudget(),
    signal: new AbortController().signal,
    model: { context: context(), tools: [planTool] },
    ...overrides
  }
}

const provider: ModelPlannerProvider = { id: "openai-1", modelId: "gpt-x", dialect: "openai_native", revision: 3, capabilities: { tools: "unknown", json: "unknown", vision: "unknown" } }

/**
 * `provider_run` 收到的那一份请求（形状就是 Rust 命令的入参）。
 *
 * 显式写出来是**为了断言**：`vi.fn(async () => …)` 不带参数时 `mock.calls[0][0]`
 * 推不出类型（元组长度是 0），所以替身必须声明它收什么。
 */
type SentRequest = { runId: string; profileId: string; profileRevision: number; messages: { role: string; content: string }[] }

/** 一串归一化事件（`provider_run` 回来的就是它）。 */
function deltas(...texts: string[]) {
  return { ok: true as const, events: texts.map((text, index) => ({ kind: "delta" as const, requestId: "r1", attemptId: `a${index}`, text })) }
}

// ---------------------------------------------------------------- 能力证据 → 通道

const profile = (capabilities: ProviderProfile["capabilities"]): ProviderProfile => ({
  id: "openai-1", name: "OpenAI", protocol: "openai_compatible", dialect: "openai_native", baseUrl: "https://api.example.com/v1", modelId: "gpt-x", secretRef: "secret:openai-1", capabilities, networkPolicy: "cloud", revision: 3
})

const health = (status: "verified" | "declared" | "failed" | "unknown", revision = 3): ProviderHealth => ({
  status: "ok", capabilityEvidence: [{ feature: "json", status }], checkedAt: 1, profileRevision: revision
})

describe("能力证据到网关口径的映射", () => {
  it("只有当前修订号上的 verified 才算 verified", () => {
    const result = toGateCapabilities(profile([{ feature: "json", status: "verified" }]), health("verified"))
    expect(result.json).toBe("verified")
  })

  it("配置自己写着 verified、但健康记录是**上一版**的，降级成 declared", () => {
    // 这一条是"证据挂在修订号上"那条规则的落点：配置改过之后，旧证据不该继续被采信。
    // 降级而不是 unknown：它仍然是一条**声明**，只是我们不认。
    const result = toGateCapabilities(profile([{ feature: "json", status: "verified" }]), health("verified", 2))
    expect(result.json).toBe("declared")
  })

  it("没有证据就是 unknown，failed 如实保留", () => {
    expect(toGateCapabilities(profile([]), null).tools).toBe("unknown")
    expect(toGateCapabilities(profile([{ feature: "tools", status: "failed" }]), null).tools).toBe("failed")
  })
})

describe("模型规划器", () => {
  it("用的是**「使用中」的那一份**，调用方不需要给 profileId", async () => {
    const runModel = vi.fn(async (_request: SentRequest) => deltas(goodEnvelope))
    const planner = createModelPlanner({ resolveProvider: async () => ({ ok: true, provider }), runModel })

    const outcome = await planner.plan(request())

    expect(runModel).toHaveBeenCalledTimes(1)
    expect(runModel.mock.calls[0]![0].profileId).toBe("openai-1")
    expect(runModel.mock.calls[0]![0].profileRevision).toBe(3)
    expect(parsePlanEnvelope(outcome.plan).ok).toBe(true)
  })

  it("把多个 delta 拼成一份信封，而不是只看第一块", async () => {
    // TCP 会把 JSON 切在任意位置，所以"一块一个 JSON"是必然错的那种解析。
    const half = Math.floor(goodEnvelope.length / 2)
    const planner = createModelPlanner({ resolveProvider: async () => ({ ok: true, provider }), runModel: async () => deltas(goodEnvelope.slice(0, half), goodEnvelope.slice(half)) })

    const outcome = await planner.plan(request())

    const parsed = parsePlanEnvelope(outcome.plan)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value.kind).toBe("plan")
  })

  it("能力证据决定通道：json 已验证时**不接受**代码围栏", async () => {
    // 严格 JSON 通道上出现围栏 = 模型没按要求的形状说话。这里如实把它交出去（协调器会拒，
    // 并带着修复提示再问一次），而不是替它剥掉围栏。
    const verified: ModelPlannerProvider = { ...provider, capabilities: { tools: "unknown", json: "verified", vision: "unknown" } }
    const planner = createModelPlanner({ resolveProvider: async () => ({ ok: true, provider: verified }), runModel: async () => deltas("```json\n" + goodEnvelope + "\n```") })

    const outcome = await planner.plan(request())

    expect(parsePlanEnvelope(outcome.plan).ok).toBe(false)
  })

  it("json 没有验证时走文本通道，一层围栏是**允许**的", async () => {
    const planner = createModelPlanner({ resolveProvider: async () => ({ ok: true, provider }), runModel: async () => deltas("```json\n" + goodEnvelope + "\n```") })

    const outcome = await planner.plan(request())

    expect(parsePlanEnvelope(outcome.plan).ok).toBe(true)
  })

  it("第二次尝试带上修复提示，且**不回显**模型上一轮的原话", async () => {
    const runModel = vi.fn(async (_request: SentRequest) => deltas("我建议你这样做：先画一个点。"))
    const planner = createModelPlanner({ resolveProvider: async () => ({ ok: true, provider }), runModel })

    await planner.plan(request())
    await planner.plan(request({ repair: { reason: "unexpected_prose", errors: [{ code: "unexpected_prose", path: "envelope", detail: "expected a JSON object" }], hint: "上一轮的输出没有被接受，原因如下（字段路径 + 原因）：\nenvelope: expected a JSON object" } }))

    const second = runModel.mock.calls[1]![0]
    const all = second.messages.map((message) => message.content).join("\n")
    expect(all).toContain("expected a JSON object")
    expect(all).not.toContain("我建议你这样做")
  })

  it("provider 报错时**抛**而不是编一份计划（协调器据此落到 failed）", async () => {
    const planner = createModelPlanner({
      resolveProvider: async () => ({ ok: true, provider }),
      runModel: async () => ({ ok: false, failure: "auth", message: "the provider rejected the credential (401)", retryable: false })
    })

    await expect(planner.plan(request())).rejects.toThrow(/401/)
  })

  it("收到工具调用就拒绝：这一轮根本没有发过工具表", async () => {
    // 静默忽略它等于把"模型以为它调用了什么"变成什么都没发生 —— 那正是最该说出来的失败。
    const planner = createModelPlanner({
      resolveProvider: async () => ({ ok: true, provider }),
      runModel: async () => ({ ok: true, events: [{ kind: "tool_call", requestId: "r1", attemptId: "a1", toolCallId: "c1", toolId: "plan.set_plan", input: {} }] })
    })

    await expect(planner.plan(request())).rejects.toThrow(/tool call/i)
  })

  it("没有选中任何服务时如实说清，而不是回一份空计划", async () => {
    const planner = createModelPlanner({ resolveProvider: async () => ({ ok: false, code: "no_active_profile", detail: "还没有选择「使用中」的模型服务。" }), runModel: async () => deltas(goodEnvelope) })

    await expect(planner.plan(request())).rejects.toThrow(/使用中/)
  })

  it("没有密钥的那一份不会被拿去发请求", async () => {
    const planner = createModelPlanner({ resolveProvider: async () => ({ ok: false, code: "no_secret", detail: "配置 openai-1 还没有保存密钥。" }), runModel: async () => deltas(goodEnvelope) })

    await expect(planner.plan(request())).rejects.toThrow(/密钥/)
  })

  it("请求里**没有**工具表这个字段：当前 IPC 契约没有放它的位置", async () => {
    // 发一个 provider 侧的工具 schema 需要 `provider_run` 收 `tools`，而它没有。
    // 所以这一轮走的是"提示词里给动作菜单 + 解析 JSON 信封"，而不是原生工具调用。
    const runModel = vi.fn(async (_request: SentRequest) => deltas(goodEnvelope))
    const planner = createModelPlanner({ resolveProvider: async () => ({ ok: true, provider }), runModel })

    await planner.plan(request())

    const sent = runModel.mock.calls[0]![0]
    expect(Object.keys(sent).sort()).toEqual(["messages", "profileId", "profileRevision", "runId"])
  })

  it("动作菜单进提示词，而且**只**给这一轮允许的动作", async () => {
    const runModel = vi.fn(async (_request: SentRequest) => deltas(goodEnvelope))
    const planner = createModelPlanner({ resolveProvider: async () => ({ ok: true, provider }), runModel })

    await planner.plan(request({ model: { context: context({ availableActions: ["solid.create_template"] }), tools: [planTool] } }))

    const all = runModel.mock.calls[0]![0].messages.map((message) => message.content).join("\n")
    expect(all).toContain("solid.create_template")
    expect(all).not.toContain("planar.create_point")
  })

  it("本阶段没有发布计划工具时，提示词里不出现计划通道", async () => {
    // `PlanRequest.model.tools` 一直在入参里，而这一条是它**真正的用处**：
    // 模型只能做这一阶段允许它做的事，而"允不允许提计划"就写在工具表里。
    const runModel = vi.fn(async (_request: SentRequest) => deltas(goodEnvelope))
    const planner = createModelPlanner({ resolveProvider: async () => ({ ok: true, provider }), runModel })

    await planner.plan(request({ model: { context: context(), tools: [] } }))

    const all = runModel.mock.calls[0]![0].messages.map((message) => message.content).join("\n")
    expect(all).not.toContain('"kind":"plan"')
    expect(all).toContain('"kind":"clarification"')
  })

  it("requestId / attemptId 取自模型事件，取不到才自己编", async () => {
    const planner = createModelPlanner({ resolveProvider: async () => ({ ok: true, provider }), runModel: async () => ({ ok: true, events: [{ kind: "delta", requestId: "req-9", attemptId: "att-9", text: goodEnvelope }] }) })
    const withIds = await planner.plan(request())
    expect(withIds.requestId).toBe("req-9")
    expect(withIds.attemptId).toBe("att-9")

    const bare = createModelPlanner({ resolveProvider: async () => ({ ok: true, provider }), runModel: async () => deltas(goodEnvelope) })
    const withoutIds = await bare.plan(request())
    expect(withoutIds.requestId.length).toBeGreaterThan(0)
    expect(withoutIds.attemptId.length).toBeGreaterThan(0)
  })

  it("取消之后抛 cancelled，并且**真的**去让 Rust 侧停下来", async () => {
    const cancelRun = vi.fn(async () => true)
    const controller = new AbortController()
    const planner = createModelPlanner({
      resolveProvider: async () => ({ ok: true, provider }),
      cancelRun,
      runModel: async () => {
        controller.abort()
        return deltas(goodEnvelope)
      }
    })

    await expect(planner.plan(request({ signal: controller.signal }))).rejects.toThrow(/取消/)
    expect(cancelRun).toHaveBeenCalledWith("run-1")
  })
})

/**
 * **有界恢复**（Task 2.3 Step 4：`RecoveryController.decide`）。
 *
 * 这一组钉住那条策略表的两个方向：**该重试的真的重试了**，
 * 而且**不该重试的一次都不多发** —— 每次往返都要用户付钱与等待。
 */
describe("传输失败的重试策略", () => {
  const rateLimited = { ok: false as const, failure: "rate_limited", message: "the provider is rate limiting (429)", retryable: true }
  const unauthorised = { ok: false as const, failure: "auth", message: "the provider rejected the credential (401)", retryable: false }

  it("429 之后再试一次就可能成功，而且最终交回的是那份计划", async () => {
    let calls = 0
    const runModel = vi.fn(async (_request: SentRequest) => {
      calls += 1
      return calls < 3 ? rateLimited : deltas(goodEnvelope)
    })
    const planner = createModelPlanner({ resolveProvider: async () => ({ ok: true, provider }), runModel })

    const outcome = await planner.plan(request())

    expect(calls).toBe(3)
    expect(parsePlanEnvelope(outcome.plan).ok).toBe(true)
  })

  it("认证失败**一次就停**：重试不会让它变成成功", async () => {
    const runModel = vi.fn(async (_request: SentRequest) => unauthorised)
    const planner = createModelPlanner({ resolveProvider: async () => ({ ok: true, provider }), runModel })

    await expect(planner.plan(request())).rejects.toThrow(/认证失败/)
    expect(runModel).toHaveBeenCalledTimes(1)
  })

  it("重试**真的花掉共享预算**：预算越少，发出去的往返越少", async () => {
    // 计划原文那句 "retry/fallback/repair share one budget" 的判据就是这一条：
    // 重试不是免费的，它从**同一份**预算里扣。所以"预算少 → 少发一次"必须成立。
    const generous = vi.fn(async (_request: SentRequest) => rateLimited)
    await expect(createModelPlanner({ resolveProvider: async () => ({ ok: true, provider }), runModel: generous }).plan(request())).rejects.toThrow()
    expect(generous).toHaveBeenCalledTimes(3) // 默认预算够，撞到的是恢复策略的上限

    const tight = vi.fn(async (_request: SentRequest) => rateLimited)
    await expect(createModelPlanner({ resolveProvider: async () => ({ ok: true, provider }), runModel: tight }).plan(request({ budget: createBudget({ network: 1, generation: 1 }) }))).rejects.toThrow(/预算/)
    expect(tight).toHaveBeenCalledTimes(2) // 只够重试一次，然后就该停
  })

  it("预算一开始就不够时，**不加尝试地停**", async () => {
    const runModel = vi.fn(async (_request: SentRequest) => rateLimited)
    const planner = createModelPlanner({ resolveProvider: async () => ({ ok: true, provider }), runModel })

    await expect(planner.plan(request({ budget: createBudget({ network: 0, generation: 0 }) }))).rejects.toThrow(/预算不足以再做一次修复尝试|预算已不足以再试一次传输/)
    expect(runModel).toHaveBeenCalledTimes(1)
  })

  it("流损坏**不自己重发**：那需要一份新上下文，而上下文不是这一层建的", async () => {
    const runModel = vi.fn(async (_request: SentRequest) => ({ ok: false as const, failure: "malformed_output", message: "the stream ended in the middle of a JSON value", retryable: false }))
    const planner = createModelPlanner({ resolveProvider: async () => ({ ok: true, provider }), runModel })

    await expect(planner.plan(request())).rejects.toThrow(/刷新场景上下文/)
    expect(runModel).toHaveBeenCalledTimes(1)
  })

  it("事件流里的 failed 与命令的 Err 走同一条恢复路径", async () => {
    // 两种到达方式对调用方是同一件事；给它们两套处置必然分叉。
    let calls = 0
    const runModel = vi.fn(async (_request: SentRequest) => {
      calls += 1
      return calls < 2
        ? { ok: true as const, events: [{ kind: "failed" as const, requestId: "r1", attemptId: "a1", failure: "server_error" as const, message: "the provider failed (503)", retryable: true }] }
        : deltas(goodEnvelope)
    })
    const planner = createModelPlanner({ resolveProvider: async () => ({ ok: true, provider }), runModel })

    const outcome = await planner.plan(request())

    expect(calls).toBe(2)
    expect(parsePlanEnvelope(outcome.plan).ok).toBe(true)
  })
})
