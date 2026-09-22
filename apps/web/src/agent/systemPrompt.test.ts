import { MAX_MESSAGE_LIMIT, type ModelContext } from "@draw/agent-core"
import { describe, expect, it } from "vitest"

import { SYSTEM_PROMPT_VERSION, buildPolicyText, buildSystemPrompt } from "./systemPrompt"

/**
 * **生产系统提示词**（Agent DSL 切片 Task 5；规格 §6/§7）。
 *
 * 规格 §7 给 Agent 定了一串"必须/不许"，而其中只有一部分能靠代码强制：
 * 「只输出 PlanEnvelope JSON」「不输出 hidden chain-of-thought」「不跨 conversation/document
 * 引用对象」这三条**只能靠提示词**（它们是模型的输出纪律），所以它们必须在提示词里
 * 逐字出现，而且必须能被一条用例盯住 —— 否则下一次改文案时会静默丢掉。
 *
 * 另一半要求是**结构**上的：策略文本与场景数据必须分开注入。
 * 合在一起写会让"同一份策略、不同的场景"无法对比（缓存、快照测试与审计都做不了），
 * 而混进去的场景数据一旦被误当成策略，就会变成"模型以为规则会随场景变"。
 */

function context(overrides: Partial<ModelContext> = {}): ModelContext {
  return {
    preamble: "你是 MathCanvas 的构图助手。",
    handles: {
      target: { projectId: "project-1", documentId: "document-1", workspace: "geometry3d", epoch: "epoch:document-1", generation: 7, contentHash: "hash-1" },
      sources: []
    },
    workspace: "geometry3d",
    binding: { conversationId: "conversation-42", projectId: "project-1", documentId: "document-1", generation: 7 },
    facts: [{ id: "solid-1", text: "立方体", origin: "user" }],
    selectedRefs: [],
    skills: [],
    availableActions: ["solid.create_prism", "dynamic.create_bound_point", "section.create"],
    warnings: [],
    estimatedCharacters: 0,
    ...overrides
  }
}

describe("production system prompt", () => {
  it("states the current conversation/document binding so the model cannot drift across them", () => {
    const prompt = buildSystemPrompt({ context: context(), channel: "strict_json", canPlan: true })

    expect(prompt.content).toContain("conversation-42")
    expect(prompt.content).toContain("document-1")
    expect(prompt.content).toContain("generation")
    // 跨会话/跨文档引用是被点名的禁止项（规格 §7）。
    expect(prompt.content).toContain("不要引用别的会话或别的文档里的对象")
  })

  it("carries the action registry and the default rules the audit enforces", () => {
    const prompt = buildSystemPrompt({ context: context(), channel: "strict_json", canPlan: true })

    for (const actionId of ["solid.create_prism", "dynamic.create_bound_point", "section.create"]) {
      expect(prompt.content, actionId).toContain(actionId)
    }
    // 动作的 inputs 白名单来自登记表（不是手抄的）。
    expect(prompt.content).toContain("hostSub")
    // 默认规则：普通动点取 0.4；没有安全默认的会变成澄清问题。
    expect(prompt.content).toContain("0.4")
    expect(prompt.content).toContain("澄清")
    // 版本号要能被找到：改了提示词而不改版本号，事后没法判断"模型看到的是哪一版"。
    expect(prompt.content).toContain(SYSTEM_PROMPT_VERSION)
    expect(SYSTEM_PROMPT_VERSION).toMatch(/^mathcanvas\.agent\.prompt\./)
  })

  it("forbids hidden reasoning and invented fields", () => {
    const prompt = buildSystemPrompt({ context: context(), channel: "strict_json", canPlan: true })

    expect(prompt.content).toContain("不要输出推理过程")
    expect(prompt.content).toContain("白名单")
    /**
     * **两条只能靠提示词守住的规则必须有用例**（Fix round 1 / I9）。
     *
     * 用例文件自己的注释声称"prompt-only 规则都已被钉住"，而这两句此前 grep 不到 ——
     * 于是下一次改文案时它们可以静默消失，而规格 §6.3/§10 正是靠它们成立的。
     */
    expect(prompt.content).toContain("符号参数")
    expect(prompt.content).toContain("数值采样")
    expect(prompt.content).toContain("形式证明")
    // 它们**不只在"能出计划"的那一支**里（Fix round 1 / M9）：只读/澄清阶段同样要遵守。
    const readOnly = buildPolicyText({ channel: "strict_json", canPlan: false, actionIds: [] })
    expect(readOnly).toContain("符号参数")
    expect(readOnly).toContain("不是形式证明")
  })

  /**
   * **字段白名单不能被静默截断**（Fix round 1 / I8）。
   *
   * 第一版 `.slice(0, 12)` 只列前 12 个动作的字段契约，而菜单那一段列出**全部**动作，
   * 紧接着还写着"白名单之外的字段一律被拒" —— 被截掉的那些动作，模型只能靠猜。
   * 请求三个技能（`planar-basics` + `conics-tangents` + `dynamic-bindings`）去重就超过 12 个动作。
   */
  it("documents every allowed action's fields instead of truncating the list", () => {
    const actions = ["planar.create_point", "planar.create_line", "planar.create_segment", "planar.create_ray", "planar.create_polyline", "planar.create_circle", "planar.create_arc", "planar.create_conic", "function.create_tangent", "parameter.create", "dynamic.create_bound_point", "dynamic.bind_point", "dynamic.bind_curve", "dynamic.create_locus", "dynamic.set_radius_rule"]
    const policy = buildPolicyText({ channel: "strict_json", canPlan: true, actionIds: actions })

    /**
     * 断言的是**字段白名单那一行**（`- <id>：<inputs>`），而不是"这个名字出现过" ——
     * 菜单与默认规则表里也会出现动作名，所以只查名字的话，被截断的动作照样"出现"。
     */
    expect(policy).toContain("- dynamic.set_radius_rule：circleId, pointId, factor")
    expect(policy).toContain("- parameter.create：id, value, min, max, step, label")
    expect(policy).toContain("- function.create_tangent：alias, sourceId, x, anchor")
  })

  it("keeps the policy text identical across contexts, and injects the scene separately", () => {
    const first = buildSystemPrompt({ context: context(), channel: "strict_json", canPlan: true })
    /**
     * 第二个上下文**同时改掉 binding / workspace / generation**（Fix round 1 / M11）：
     * 只改 `facts` 的话，"把这几个绑定字段漏进策略文本"这种回归不会被发现。
     */
    const second = buildSystemPrompt({
      context: context({
        facts: [{ id: "circle-1", text: "圆", origin: "user" }],
        binding: { conversationId: "conversation-99", projectId: "project-9", documentId: "document-9", generation: 12 },
        workspace: "conics"
      }),
      channel: "strict_json",
      canPlan: true
    })

    // 策略文本与场景无关（同一批可用动作 + 同一通道 → 逐字相同）。
    expect(second.policy).toBe(first.policy)
    // 场景数据在另一个字段里，而且两处场景确实不同。
    expect(second.contextJson).not.toBe(first.contextJson)
    expect(first.contextJson).toContain("solid-1")
    expect(second.contextJson).toContain("circle-1")
    // 拼起来的内容里两段都在。
    expect(first.content).toContain(first.policy)
    expect(first.content).toContain(first.contextJson)
  })

  it("tailors the policy text to the channel and to what this run may do", () => {
    const strict = buildPolicyText({ channel: "strict_json", canPlan: true, actionIds: ["solid.create_prism"] })
    const fenced = buildPolicyText({ channel: "fenced_text", canPlan: true, actionIds: ["solid.create_prism"] })
    expect(strict).not.toBe(fenced)
    // 严格 JSON 通道上不该建议用围栏（那正是它要避免的形状）。
    expect(strict).toContain("不要用代码围栏")
    expect(fenced).toContain("```json")

    // 这一轮不允许出计划时，策略里没有"动作菜单"那一节。
    const readOnly = buildPolicyText({ channel: "fenced_text", canPlan: false, actionIds: [] })
    expect(readOnly).toContain("不允许返回计划")
    expect(readOnly).not.toContain("## 本轮允许的动作")
  })

  it("carries a repair hint verbatim in the policy text when there is one", () => {
    const prompt = buildSystemPrompt({
      context: context(),
      channel: "strict_json",
      canPlan: true,
      repair: { reason: "schema_invalid", errors: [{ code: "unknown_field", path: "envelope.actions[0].inputs.faces", detail: "unexpected field 'faces'" }], hint: "上一轮的输出没有被接受：envelope.actions[0].inputs.faces 不认识。" }
    })

    expect(prompt.policy).toContain("上一轮的输出没有被接受")
    expect(prompt.policy).toContain("envelope.actions[0].inputs.faces")
  })

  /**
   * **提示词不许再截一次消息**（Fix round 2 / item 4）。
   *
   * 条数与字符的预算都由 `buildConversationContext` 定（§5.3 的 35% 段 + `MAX_MESSAGE_LIMIT`），
   * 而这里原先又写了一个 `MAX_PROMPT_MESSAGES = 12` —— 与事实那一处同一种漂移：
   * 预算按 24 条算，模型只看得到 12 条。同一个数写在两个文件里迟早会不一致，
   * 所以渲染**不再截**：上下文里有多少条就渲染多少条。
   */
  it("renders every recent message the context builder kept", () => {
    const messages = Array.from({ length: MAX_MESSAGE_LIMIT }, (_, index) => ({ id: `m${index}`, role: "user" as const, text: `第 ${index} 条`, createdAt: index }))
    const prompt = buildSystemPrompt({
      context: context(),
      conversation: {
        binding: { conversationId: "conv-1", projectId: "local", documentId: "doc-1", workspace: "geometry3d", generation: 4 },
        summary: "",
        facts: [],
        messages,
        observation: { facts: [], summary: "" },
        warnings: [],
        estimatedCharacters: 1
      },
      channel: "strict_json",
      canPlan: true
    })

    const parsed = JSON.parse(prompt.contextJson) as { recentMessages: { text: string }[] }
    expect(parsed.recentMessages).toHaveLength(messages.length)
    expect(parsed.recentMessages.at(-1)?.text).toBe(`第 ${messages.length - 1} 条`)
  })
})
