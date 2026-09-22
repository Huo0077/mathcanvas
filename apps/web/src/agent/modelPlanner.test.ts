import { describe, expect, it, vi } from "vitest"
import { PLAN_SCHEMA_VERSION, createBudget, parsePlanEnvelope, type ModelContext, type PlanRequest, type ToolDescriptor } from "@draw/agent-core"

import type { ProviderHealth, ProviderProfile } from "../services/providerProfileClient"
import { createModelPlanner, toGateCapabilities, PLAN_TOOL_NAME, type ModelPlannerProvider } from "./modelPlanner"

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
    // 绑定（会话 / 文档 / 版本）是提示词里必须出现的那一块（Agent DSL 切片 Task 5）：
    // 少了它，模型没有依据判断"我现在在哪个会话、哪份文档的第几版"。
    binding: { conversationId: "conv-1", projectId: "local", documentId: "doc-1", generation: 4 },
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
    // 会话上下文（对话切片 Task 4）：规划器**总是**拿到它（缺省是最小的一份，见协调器）。
    conversation: {
      binding: { conversationId: "conv-1", projectId: "local", documentId: "doc-1", workspace: "geometry3d", generation: 4 },
      summary: "",
      facts: [],
      messages: [{ id: "msg-0", role: "user", text: "先建一个立方体", createdAt: 1 }],
      observation: { facts: [{ id: "cube-1", text: "立方体 cube-1", origin: "user" }], summary: "一个立方体" },
      warnings: [],
      estimatedCharacters: 64
    },
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
type SentRequest = { runId: string; profileId: string; profileRevision: number; messages: { role: string; content: string }[]; tools: unknown[] }

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

  it("把会话上下文（已确认事实 / 摘要 / 最近消息 / 草稿）渲染进系统提示词", async () => {
    const runModel = vi.fn(async (_request: SentRequest) => deltas(goodEnvelope))
    const planner = createModelPlanner({ resolveProvider: async () => ({ ok: true, provider }), runModel })
    const base = request()

    await planner.plan(request({
      conversation: {
        ...base.conversation,
        summary: "目标是建一个立方体",
        facts: [{ id: "fact-1", key: "commit:run-1", text: "已确认：文档第 3 版新增 1 个对象（cube-1）", status: "confirmed" }],
        draft: { draftId: "draft-9", draftVersion: 2, previewHash: "hash", stageCount: 1 }
      }
    }))

    const system = runModel.mock.calls[0]![0].messages[0]!.content
    // 长期记忆：已确认事实与摘要。
    expect(system).toContain("已确认：文档第 3 版新增 1 个对象（cube-1）")
    expect(system).toContain("目标是建一个立方体")
    // 最近消息（会话里说过的话）。
    expect(system).toContain("先建一个立方体")
    // 待确认的草稿是**视图**，不是事实。
    expect(system).toContain("draft-9")
    expect(system).toContain("recentMessages")
    expect(system).toContain("confirmedFacts")
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

  it("交给模型接口的东西只有那几样，而工具表按通道给", async () => {
    // 这一条同时钉住两件事：①`provider_run` 的入参就是这些 —— **没有任何能装密钥的位置**
    //（密钥在 Rust 侧由凭据库借出）；②工具表这个字段是**通道决定**的，未验证时是空数组。
    //
    // 2026-09-21 改写：这条用例原先断言"请求里没有 tools 这个字段"，理由是
    // "IPC 契约里没有放工具表的位置"。那个前提已经不成立了 —— `provider_run` 现在收 `tools`，
    // 而缺口补上之后真正要守的性质变成了"**只有按已验证证据放行时才给**"。
    const runModel = vi.fn(async (_request: SentRequest) => deltas(goodEnvelope))
    const planner = createModelPlanner({ resolveProvider: async () => ({ ok: true, provider }), runModel })

    await planner.plan(request())

    const sent = runModel.mock.calls[0]![0]
    expect(Object.keys(sent).sort()).toEqual(["messages", "profileId", "profileRevision", "runId", "tools"])
    expect(sent.tools).toEqual([])
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

  it("没有验证过工具能力时**不发**工具表，走文本通道", async () => {
    // 这一条是"不该发的 schema 发出去了"的反面：没验过的能力一个字都不发。
    const runModel = vi.fn(async (_request: SentRequest) => deltas(goodEnvelope))
    const planner = createModelPlanner({ resolveProvider: async () => ({ ok: true, provider }), runModel })

    await planner.plan(request())

    const sent = runModel.mock.calls[0]![0]
    expect(sent.tools).toEqual([])
    // 提示词里也没有工具那条路（它是给已验证证据准备的口子）。
    const prompt = sent.messages.map((message) => message.content).join("\n")
    expect(prompt).not.toContain(PLAN_TOOL_NAME)
  })

  it("工具能力已验证时走**原生工具通道**：发一个工具表，并把它当信封读回来", async () => {
    const withTools: ModelPlannerProvider = { ...provider, capabilities: { tools: "verified", json: "unknown", vision: "unknown" } }
    const runModel = vi.fn(async (sent: SentRequest) =>
      sent.tools.length > 0
        ? {
            ok: true as const,
            events: [{
              kind: "tool_call" as const,
              requestId: "req-tool",
              attemptId: "att-tool",
              toolCallId: "call-1",
              toolId: PLAN_TOOL_NAME,
              // 工具调用携带的 arguments **就是**计划信封。
              input: JSON.parse(goodEnvelope)
            }]
          }
        : deltas(goodEnvelope))
    const planner = createModelPlanner({ resolveProvider: async () => ({ ok: true, provider: withTools }), runModel })

    const outcome = await planner.plan(request())

    const sent = runModel.mock.calls[0]![0]
    expect(sent.tools).toHaveLength(1)
    expect((sent.tools[0] as { function: { name: string } }).function.name).toBe(PLAN_TOOL_NAME)
    // 提示词按通道给建议（说了用工具，而不是"只返回 JSON"）。
    expect(sent.messages.map((message) => message.content).join("\n")).toContain(PLAN_TOOL_NAME)
    // 信封从工具调用的参数里来，而且**这一层也会校验一次**（Fix round 1 / M12）：
    // 通过之后交出去的是**校验过的值**（字段归一化落实了）。
    const parsed = parsePlanEnvelope(outcome.plan)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value.kind).toBe("plan")
    expect(outcome.requestId).toBe("req-tool")
  })

  /**
   * **工具通道上的非信封载荷不会被当成合法计划混过去**（Fix round 1 / M12）。
   *
   * 以前这一层直接 `input as PlanEnvelope`；现在先过 `parsePlanEnvelope` ——
   * 通过则交校验过的值，不通过则原样交给协调器（由它报逐条字段错误、并决定修复）。
   */
  it("validates a native tool payload instead of casting it straight to an envelope", async () => {
    const withTools: ModelPlannerProvider = { ...provider, capabilities: { tools: "verified", json: "unknown", vision: "unknown" } }
    const notAnEnvelope = { kind: "not-a-plan", goal: "x" }
    const planner = createModelPlanner({
      resolveProvider: async () => ({ ok: true, provider: withTools }),
      runModel: async () => ({ ok: true, events: [{ kind: "tool_call", requestId: "r1", attemptId: "a1", toolCallId: "c1", toolId: PLAN_TOOL_NAME, input: notAnEnvelope }] })
    })

    const outcome = await planner.plan(request())

    // 交出去的是原值（让协调器按**它自己的路径**报错），而且它确实不是合法信封。
    expect(outcome.plan).toBe(notAnEnvelope)
    const parsed = parsePlanEnvelope(outcome.plan)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.errors[0].code).toBe("unknown_kind")

    // 反过来：合法载荷交出去的是**校验过的值**（`assumptions: []` 被归一成"没有声明假设"）。
    const withEmptyAssumptions = { ...(JSON.parse(goodEnvelope) as Record<string, unknown>), assumptions: [] }
    const normalizing = createModelPlanner({
      resolveProvider: async () => ({ ok: true, provider: withTools }),
      runModel: async () => ({ ok: true, events: [{ kind: "tool_call", requestId: "r1", attemptId: "a1", toolCallId: "c1", toolId: PLAN_TOOL_NAME, input: withEmptyAssumptions }] })
    })
    const normalized = await normalizing.plan(request())
    expect(normalized.plan).not.toBe(withEmptyAssumptions)
    if (normalized.plan.kind === "plan") expect(normalized.plan.assumptions).toBeUndefined()
  })

  it("原生通道上模型改用文本作答时，仍然按文本通道解析一次", async () => {
    // 有些服务在给了工具表的情况下照旧用文本回答，而那段文本还是同一个信封合同。
    const withTools: ModelPlannerProvider = { ...provider, capabilities: { tools: "verified", json: "unknown", vision: "unknown" } }
    const planner = createModelPlanner({ resolveProvider: async () => ({ ok: true, provider: withTools }), runModel: async () => deltas("```json\n" + goodEnvelope + "\n```") })

    const outcome = await planner.plan(request())

    expect(parsePlanEnvelope(outcome.plan).ok).toBe(true)
  })

  it("原生通道上出现**别的**工具调用仍然拒绝：我们只发过一个工具", async () => {
    const withTools: ModelPlannerProvider = { ...provider, capabilities: { tools: "verified", json: "unknown", vision: "unknown" } }
    const planner = createModelPlanner({
      resolveProvider: async () => ({ ok: true, provider: withTools }),
      runModel: async () => ({ ok: true, events: [{ kind: "tool_call", requestId: "r1", attemptId: "a1", toolCallId: "c1", toolId: "scene.inspect", input: {} }] })
    })

    await expect(planner.plan(request())).rejects.toThrow(/tool call/i)
  })

  /**
   * **只为"这次真的发过的工具"接受工具调用**（Agent DSL 切片 Task 5）。
   *
   * 协调器按阶段发布工具：观察阶段连计划工具都没有。所以"模型调用了我们这一轮
   * 没发的 `plan.set_plan`"两种情况都必须被如实拒绝 ——
   * 接受它等于让阶段边界失效（模型可以绕过"这一阶段不许出计划"），
   * 忽略它又会让用户以为模型做了些什么。
   */
  it("rejects a plan tool call when this run never offered the plan tool", async () => {
    const withTools: ModelPlannerProvider = { ...provider, capabilities: { tools: "verified", json: "unknown", vision: "unknown" } }
    const planner = createModelPlanner({
      resolveProvider: async () => ({ ok: true, provider: withTools }),
      runModel: async () => ({ ok: true, events: [{ kind: "tool_call", requestId: "r1", attemptId: "a1", toolCallId: "c1", toolId: PLAN_TOOL_NAME, input: JSON.parse(goodEnvelope) }] })
    })

    // 工具表是空的：这一轮**不允许**出计划。
    await expect(planner.plan(request({ model: { context: context(), tools: [] } }))).rejects.toThrow(/tool call/i)
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
