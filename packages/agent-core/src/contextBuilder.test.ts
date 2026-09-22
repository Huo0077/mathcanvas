import { describe, expect, it } from "vitest"

import { createBudget } from "./budget"
import {
  buildContext,
  buildConversationContext,
  DEFAULT_FACT_LIMIT,
  DEFAULT_REF_LIMIT,
  MAX_FACT_LIMIT,
  MAX_MESSAGE_LIMIT,
  type BuildContextInput,
  type ConversationContextInput,
  type Fact,
  type SelectedRef
} from "./contextBuilder"
import type { ConversationMessageView, DocumentHandle, RunContext } from "./contracts"
import { SKILL_CATALOGUE_REVISION } from "./skills/manifest"

/**
 * Task 2.2 Step 1 里针对上下文的两条：**stale facts**（其实是过期引用）与 **context budget**，
 * 加上 Step 4 点名的"包含什么 / 绝不包含什么"。
 *
 * 这个函数的输出会**原样进模型提示词**，所以它定义了"模型能看到什么"。
 */
function handle(id: string, hash: string, generation = 1): DocumentHandle {
  return { projectId: "p", documentId: id, workspace: "conics", epoch: `epoch:${id}`, generation, contentHash: hash }
}

function run(overrides: Partial<RunContext> = {}): RunContext {
  return {
    runId: "run-1",
    conversationId: "conv-1",
    promptMessageId: "msg-1",
    target: handle("doc-target", "hash-target"),
    sources: [],
    textProfileId: "profile-1",
    capabilityRevision: SKILL_CATALOGUE_REVISION,
    policyRevision: "policy-1",
    ...overrides
  }
}

/**
 * 一个选中引用。
 *
 * `handleHash` 是**采集之后**那份文档的哈希，`contentHash` 是**采集当时**的哈希 ——
 * 两者不同即为过期。第一版我把两个参数写成同一个值，结果引用永远不可能过期，
 * "过期引用"那条用例测的是空气。
 */
function ref(entityId: string, options: { contentHash?: string; handleHash?: string; documentId?: string } = {}): SelectedRef {
  const documentId = options.documentId ?? "doc-target"
  const contentHash = options.contentHash ?? "hash-target"
  const handleHash = options.handleHash ?? contentHash
  return { documentId, entityId, label: entityId.toUpperCase(), contentHash, handle: handle(documentId, handleHash) }
}

function fact(id: string, origin: Fact["origin"] = "user"): Fact {
  return { id, text: `事实 ${id}`, origin }
}

function input(overrides: Partial<BuildContextInput> = {}): BuildContextInput {
  return {
    run: run(),
    observation: { facts: [fact("f1"), fact("f2")], summary: "一个点和一个圆" },
    requestedSkillIds: ["planar-basics"],
    selectedRefs: [ref("point-1"), ref("circle-1")],
    availableActions: ["planar.create_point"],
    budget: createBudget(),
    ...overrides
  }
}

describe("context contents", () => {
  it("carries the live handles, the confirmed facts and the ordered selected refs", () => {
    const context = buildContext(input())

    expect(context.handles.target.documentId).toBe("doc-target")
    expect(context.facts.map((entry) => entry.id)).toEqual(["f1", "f2"])
    // 顺序有意义（"第一个点""第二个点"），所以必须原样保留。
    expect(context.selectedRefs.map((entry) => entry.entityId)).toEqual(["point-1", "circle-1"])
  })

  it("loads only the skills that were asked for and verified", () => {
    const context = buildContext(input({ requestedSkillIds: ["planar-basics", "functions"] }))

    expect(context.skills.map((skill) => skill.id)).toEqual(["planar-basics", "functions"])
    // 没请求的技能不该出现。
    expect(context.skills.map((skill) => skill.id)).not.toContain("spatial-modeling")
  })

  it("reports an unregistered skill as a warning instead of silently dropping it", () => {
    const context = buildContext(input({ requestedSkillIds: ["planar-basics", "planar.mind-control"] }))

    expect(context.skills.map((skill) => skill.id)).toEqual(["planar-basics"])
    const warning = context.warnings.find((entry) => entry.code === "skill_unknown_skill")
    expect(warning).toBeTruthy()
    expect(warning?.detail).toContain("planar.mind-control")
  })

  it("passes the workspace and the available actions through", () => {
    const context = buildContext(input())

    expect(context.workspace).toBe("conics")
    expect(context.availableActions).toEqual(["planar.create_point"])
  })
})

describe("context hygiene", () => {
  it("cannot carry credentials, tool implementations or chain-of-thought", () => {
    // 这三类东西**不在入参里**，所以结构上不可能漏进输出。
    // 这条用例把"入参形状"本身钉住：若以后有人往 `BuildContextInput` 里加
    // `apiKey` / `tools` / `reasoning`，它会失败。
    const keys = Object.keys(input())

    expect(keys).not.toContain("apiKey")
    expect(keys).not.toContain("credential")
    expect(keys).not.toContain("tools")
    expect(keys).not.toContain("reasoning")
    expect(keys).not.toContain("provider")
  })

  it("keeps the preamble free of hidden instructions", () => {
    const context = buildContext(input())

    // 序言只说明"你有什么、不能做什么"。它不该包含"不要告诉用户""内部规则"这类隐藏指令。
    expect(context.preamble).toContain("不能")
    expect(context.preamble).not.toContain("不要告诉用户")
    expect(context.preamble).not.toContain("内部规则")
  })

  it("estimates its own size so the caller can check the budget", () => {
    const context = buildContext(input())

    expect(context.estimatedCharacters).toBeGreaterThan(0)
    // 估算必须覆盖序言；否则"预算"会漏掉最大的一块固定开销。
    expect(context.estimatedCharacters).toBeGreaterThanOrEqual(context.preamble.length)
  })
})

describe("context bounding", () => {
  it("truncates facts and says so", () => {
    const many = Array.from({ length: DEFAULT_FACT_LIMIT + 5 }, (_, index) => fact(`f${index}`))
    const context = buildContext(input({ observation: { facts: many, summary: "" } }))

    expect(context.facts).toHaveLength(DEFAULT_FACT_LIMIT)
    expect(context.warnings.some((entry) => entry.code === "truncated_facts")).toBe(true)
  })

  it("refuses to widen the caps just because the caller asked", () => {
    const many = Array.from({ length: MAX_FACT_LIMIT + 10 }, (_, index) => fact(`f${index}`))
    const context = buildContext(input({ observation: { facts: many, summary: "" }, limits: { facts: 10_000 } }))

    // 上下文预算不是调用方能单方面加大的东西。
    expect(context.facts).toHaveLength(MAX_FACT_LIMIT)
  })

  it("truncates refs and says so", () => {
    const many = Array.from({ length: DEFAULT_REF_LIMIT + 4 }, (_, index) => ref(`point-${index}`))
    const context = buildContext(input({ selectedRefs: many }))

    expect(context.selectedRefs).toHaveLength(DEFAULT_REF_LIMIT)
    expect(context.warnings.some((entry) => entry.code === "truncated_refs")).toBe(true)
  })
})

describe("stale references", () => {
  it("keeps a stale ref out of the list but reports it as a warning", () => {
    // 文档在采集引用之后被改过：塞进上下文会让模型基于旧位置下判断；
    // 静默丢掉又会让模型以为用户没选中任何东西。两者都不做。
    const stale = ref("point-1", { contentHash: "hash-before-edit", handleHash: "hash-after-edit" })
    const context = buildContext(input({ selectedRefs: [stale, ref("circle-1")] }))

    expect(context.selectedRefs.map((entry) => entry.entityId)).toEqual(["circle-1"])
    const warning = context.warnings.find((entry) => entry.code === "stale_ref")
    expect(warning).toBeTruthy()
    expect(warning?.detail).toContain("point-1")
  })

  it("does not let a stale ref consume a slot in the truncated page", () => {
    const refs = [ref("point-1", { contentHash: "old-hash", handleHash: "new-hash" }), ...Array.from({ length: DEFAULT_REF_LIMIT }, (_, index) => ref(`point-ok-${index}`))]
    const context = buildContext(input({ selectedRefs: refs }))

    // 有效引用仍应占满一页：过期的那个不该挤掉一个名额。
    expect(context.selectedRefs).toHaveLength(DEFAULT_REF_LIMIT)
    expect(context.selectedRefs.map((entry) => entry.entityId)).not.toContain("point-1")
  })
})

/**
 * **会话上下文**（对话切片 Task 4；规格 §5.3）。
 *
 * 组装顺序是有语义的：**当前场景是权威，旧消息只是背景**（"当前文档事实优先于旧对话
 * 和模型旧输出"，规格 §1.2）。所以预算不够时先丢的是旧消息，不是场景事实；
 * 而未确认的草稿**永远不许**变成"已确认事实"（规格 §1.2 与 §10）。
 */
describe("conversation context", () => {
  function message(id: string, text: string, at: number, role: ConversationMessageView["role"] = "user"): ConversationMessageView {
    return { id, role, text, createdAt: at }
  }

  function conversation(overrides: Partial<ConversationContextInput> = {}): ConversationContextInput {
    return {
      binding: { conversationId: "conv-1", projectId: "p", documentId: "doc-target", workspace: "conics", generation: 3 },
      summary: "",
      facts: [],
      messages: [],
      observation: { facts: [fact("scene-1")], summary: "一个点和一个圆" },
      request: "再画一个圆",
      ...overrides
    }
  }

  it("carries the binding, the confirmed facts and the recent messages in a fixed order", () => {
    const context = buildConversationContext(conversation({
      facts: [
        { id: "cf-2", key: "b.key", text: "已确认：半径 3", status: "confirmed" },
        { id: "cf-1", key: "a.key", text: "已确认：圆心在原点", status: "confirmed" }
      ],
      messages: [message("m1", "画一个点", 10), message("m2", "好的。", 11, "assistant")]
    }))

    expect(context.binding).toEqual({ conversationId: "conv-1", projectId: "p", documentId: "doc-target", workspace: "conics", generation: 3 })
    // 事实按 key 排序：同一份输入必须给出同一份上下文（否则提示词会随机变化）。
    expect(context.facts.map((entry) => entry.key)).toEqual(["a.key", "b.key"])
    // 消息按时间序（旧 → 新）："最近说了什么"要能顺序读出来。
    expect(context.messages.map((entry) => entry.id)).toEqual(["m1", "m2"])
    expect(context.observation.facts.map((entry) => entry.id)).toEqual(["scene-1"])
    expect(context.estimatedCharacters).toBeGreaterThan(0)
  })

  it("keeps the current scene facts when the budget cannot fit the older messages", () => {
    const messages = [message("old-1", "很久以前说过的一句话", 1), message("old-2", "还有另一句", 2)]
    // 场景本身就是"当前事实"：这里的观察大到几乎吃掉整个预算。
    const sceneFacts = Array.from({ length: 6 }, (_, index) => ({ id: `scene-${index}`, text: "场景事实".repeat(8), origin: "user" as const }))
    const context = buildConversationContext(conversation({
      messages,
      observation: { facts: sceneFacts, summary: "场景" },
      limits: { characters: 120 }
    }))

    // 场景是**当前**事实：预算再紧也不许丢。
    expect(context.observation.facts.map((entry) => entry.id)).toEqual(sceneFacts.map((entry) => entry.id))
    // 旧消息先让路，并且**如实说**丢了几条（否则"模型为什么忘了"无从查起）。
    expect(context.messages).toEqual([])
    const warning = context.warnings.find((entry) => entry.code === "truncated_messages")
    expect(warning?.detail).toContain("2")
  })

  it("bounds the recent messages by the budget and keeps the newest ones", () => {
    const messages = Array.from({ length: 40 }, (_, index) => message(`m${index}`, "x".repeat(100), index))
    const context = buildConversationContext(conversation({ messages, limits: { characters: 1_000 } }))

    expect(context.messages.length).toBeGreaterThan(0)
    expect(context.messages.length).toBeLessThan(messages.length)
    // 留下的一定是**最新的那一批**：最早的被丢掉才是对的。
    expect(context.messages.at(-1)?.id).toBe("m39")
    expect(context.messages.map((entry) => entry.id)).not.toContain("m0")
    expect(context.warnings.some((entry) => entry.code === "truncated_messages")).toBe(true)
  })

  it("still bounds the message count when the caller asks for an absurd budget", () => {
    const messages = Array.from({ length: 200 }, (_, index) => message(`m${index}`, "hi", index))
    const context = buildConversationContext(conversation({ messages, limits: { characters: 10_000_000, messages: 10_000 } }))

    // 预算不是调用方能单方面加大的东西（与事实/引用同一条纪律）。
    expect(context.messages.length).toBeLessThanOrEqual(MAX_MESSAGE_LIMIT)
    expect(context.messages.at(-1)?.id).toBe("m199")
  })

  it("never turns an unconfirmed draft into a confirmed fact", () => {
    const context = buildConversationContext(conversation({
      facts: [
        { id: "cf-1", key: "a.key", text: "已确认：圆心在原点", status: "confirmed" },
        // 未确认的草稿被塞进事实表时**必须**被丢掉（它是"还没发生的事"）。
        { id: "cf-draft", key: "draft.key", text: "草稿：将新增一个立方体", status: "draft" },
        { id: "cf-stale", key: "old.key", text: "过期：半径 9", status: "stale" }
      ],
      draft: { draftId: "draft-1", draftVersion: 2, previewHash: "hash", stageCount: 3 }
    }))

    expect(context.facts.map((entry) => entry.id)).toEqual(["cf-1"])
    expect(JSON.stringify(context.facts)).not.toContain("草稿")
    // 草稿**视图**可以进上下文（模型要知道"有一份待确认的草稿"），但它不是事实。
    expect(context.draft?.draftId).toBe("draft-1")
    expect(JSON.stringify(context.facts)).not.toContain("draft-1")
  })

  it("keeps a summary that fits and truncates one that does not", () => {
    const fitted = buildConversationContext(conversation({ summary: "目标是建一个立方体" }))
    expect(fitted.summary).toBe("目标是建一个立方体")

    const huge = buildConversationContext(conversation({ summary: "y".repeat(10_000) }))
    expect(huge.summary.length).toBeLessThan(3_000)
    expect(huge.warnings.some((entry) => entry.code === "truncated_summary")).toBe(true)
  })
})
