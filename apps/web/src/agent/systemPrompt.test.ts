import type { ModelContext } from "@draw/agent-core"
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
  })

  it("keeps the policy text identical across contexts, and injects the scene separately", () => {
    const first = buildSystemPrompt({ context: context(), channel: "strict_json", canPlan: true })
    const second = buildSystemPrompt({ context: context({ facts: [{ id: "circle-1", text: "圆", origin: "user" }] }), channel: "strict_json", canPlan: true })

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
})
