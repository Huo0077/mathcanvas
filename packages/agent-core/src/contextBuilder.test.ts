import { describe, expect, it } from "vitest"

import { createBudget } from "./budget"
import {
  buildContext,
  buildConversationContext,
  DEFAULT_FACT_LIMIT,
  DEFAULT_REF_LIMIT,
  DEFAULT_SUMMARY_CHARACTER_BUDGET,
  MAX_CONVERSATION_FACTS,
  MAX_FACT_LIMIT,
  MAX_MESSAGE_LIMIT,
  type BuildContextInput,
  type ConversationContextInput,
  type Fact,
  type SelectedRef
} from "./contextBuilder"
import { DEFAULT_DERIVED_STATUS_LIMIT, MAX_DERIVED_STATUS_LIMIT, type ObservedDerivedStatus } from "./sceneObservation"
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

/**
 * **派生立体读数进上下文**（规格 §3.4 / §6.2）。
 *
 * 观察层把内核的四态读数搬出来之后，必须在**模型真正看到的那一份**里出现 ——
 * 只活在观察对象里而没进上下文，与"没做"是同一件事。同时它必须**有界**：
 * 一份几十只立体的图纸不能把提示词塞满，而截断要如实留痕（与事实 / 引用同一条纪律）。
 */
describe("derived solid readings", () => {
  function reading(entityId: string, code: string, status: ObservedDerivedStatus["status"], message: string): ObservedDerivedStatus {
    return { entityId, code, status, message }
  }

  const circumsphere = reading("solid-1", "derived.circumsphere", "undefined", "外接球：该多面体没有外接球：找不到到所有顶点等距的点。")

  it("carries the kernel's status and reason into the model context", () => {
    const context = buildContext(input({ observation: { facts: [], summary: "", derived: [circumsphere] } }))

    // **四个状态里的 `undefined` 而不是一个假的球**：状态与原因原样进上下文。
    expect(context.derived).toEqual([circumsphere])
  })

  it("bounds the readings by the shared limit and says so", () => {
    const many = Array.from({ length: DEFAULT_DERIVED_STATUS_LIMIT + 3 }, (_, index) => reading(`solid-${index}`, "derived.circumsphere", "exact", `外接球：半径 ${index}`))
    const context = buildContext(input({ observation: { facts: [], summary: "", derived: many } }))

    expect(context.derived).toHaveLength(DEFAULT_DERIVED_STATUS_LIMIT)
    expect(context.warnings.some((entry) => entry.code === "truncated_derived")).toBe(true)
  })

  it("refuses to widen the derived cap just because the caller asked", () => {
    const many = Array.from({ length: MAX_DERIVED_STATUS_LIMIT + 5 }, (_, index) => reading(`solid-${index}`, "derived.circumsphere", "exact", `外接球：半径 ${index}`))
    const context = buildContext(input({ observation: { facts: [], summary: "", derived: many }, limits: { derived: 10_000 } }))

    expect(context.derived).toHaveLength(MAX_DERIVED_STATUS_LIMIT)
  })

  it("charges the estimate for the readings", () => {
    // 估算只统计会进提示词的文本；漏掉读数就等于"预算按一份扣、提示词里还有一份"。
    const without = buildContext(input({ observation: { facts: [], summary: "" } }))
    const withReadings = buildContext(input({ observation: { facts: [], summary: "", derived: [circumsphere] } }))

    expect(withReadings.estimatedCharacters).toBeGreaterThan(without.estimatedCharacters)
  })

  it("keeps the readings in the conversation context, where the scene is authoritative", () => {
    const context = buildConversationContext({
      binding: { conversationId: "conv-1", projectId: "p", documentId: "doc-target", workspace: "geometry3d", generation: 3 },
      summary: "",
      facts: [],
      messages: [],
      observation: { facts: [], summary: "", derived: [circumsphere] },
      request: "切一刀"
    })

    expect(context.observation.derived).toEqual([circumsphere])
  })

  /**
   * **会话这一份读数也要有界、而且截断要留痕**（Fix round 1 / I3）。
   *
   * 提示词渲染的是 `conversation.observation.derived`（它比 `context.derived` 优先），
   * 而 `buildConversationContext` 此前把 `observation` **原样**放行：于是"预算按 12 条扣、
   * 提示词里却是 24 条"——正是两处各写一个上限那一类漂移，只不过这次是"一处根本没设上限"。
   * 有界 + 警告必须落在**同一个地方**，否则模型会拿到一份它不知道自己拿少了的清单。
   */
  it("bounds the readings the conversation keeps and says what it dropped", () => {
    const many = Array.from({ length: DEFAULT_DERIVED_STATUS_LIMIT + 2 }, (_, index) => reading(`solid-${index}`, "derived.circumsphere", "exact", `外接球：半径 ${index}`))
    const context = buildConversationContext({
      binding: { conversationId: "conv-1", projectId: "p", documentId: "doc-target", workspace: "geometry3d", generation: 3 },
      summary: "",
      facts: [],
      messages: [],
      observation: { facts: [], summary: "", derived: many },
      request: "切一刀"
    })

    expect(context.observation.derived).toHaveLength(DEFAULT_DERIVED_STATUS_LIMIT)
    const warning = context.warnings.find((entry) => entry.code === "truncated_derived")
    expect(warning).toBeTruthy()
    // 警告里的数字必须与**模型真正看到的那一份**一致（否则它连"少了多少"都读错）。
    expect(warning?.detail).toContain(`${DEFAULT_DERIVED_STATUS_LIMIT} of ${many.length}`)
  })

  it("lets the caller tighten — never widen — the readings the conversation keeps", () => {
    const conversation = (limit: number) => buildConversationContext({
      binding: { conversationId: "conv-1", projectId: "p", documentId: "doc-target", workspace: "geometry3d", generation: 3 },
      summary: "",
      facts: [],
      messages: [],
      observation: { facts: [], summary: "", derived: Array.from({ length: MAX_DERIVED_STATUS_LIMIT + 5 }, (_, index) => reading(`solid-${index}`, "derived.circumsphere", "exact", `外接球：半径 ${index}`)) },
      limits: { derived: limit },
      request: "切一刀"
    })

    expect(conversation(2).observation.derived).toHaveLength(2)
    // 上限不是调用方能单方面加大的东西（与事实 / 引用 / 消息同一条纪律）。
    expect(conversation(10_000).observation.derived).toHaveLength(MAX_DERIVED_STATUS_LIMIT)
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

  /**
   * **这条用例的期望在 Fix round 1 / I3 里被改过**（原样记下来，免得看起来像"顺手改绿"）：
   *
   * - 旧实现：场景 + 全部事实先扣预算 → 场景一大，摘要被切空、消息**一条不剩**（`[]`）。
   * - 新实现（§5.3 的分段）：场景保留自己的软额度（当前事实一条不少），
   *   而摘要与消息各有各的保留额度 —— 场景再大也不把历史挤没。
   *   所以现在的期望是：**场景完整，同时消息还在自己的额度里**。
   */
  it("keeps the current scene whole without starving the history bands", () => {
    const messages = [message("old-1", "很久以前说过的一句话", 1), message("old-2", "还有另一句", 2)]
    // 场景大到超过它自己的份额（20%）。
    const sceneFacts = Array.from({ length: 6 }, (_, index) => ({ id: `scene-${index}`, text: "场景事实".repeat(8), origin: "user" as const }))
    const context = buildConversationContext(conversation({
      messages,
      observation: { facts: sceneFacts, summary: "场景" },
      limits: { characters: 120 }
    }))

    // 场景是**当前**事实：预算再紧也不许丢。
    expect(context.observation.facts.map((entry) => entry.id)).toEqual(sceneFacts.map((entry) => entry.id))
    // 但它**不吃掉**历史那两段：两条小消息在自己的 35% 额度里放得下。
    expect(context.messages.map((entry) => entry.id)).toEqual(["old-1", "old-2"])
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

  /**
   * **一条会话的事实只属于它自己那份文档**（规格 §5.1 + §9 的"会话之间不串事实"）。
   *
   * 这条会话可能被用在两份文档上（这个应用里换工作区就是换文档），而事实表是**会话级**的 ——
   * 所以"这条事实是在哪份文档上确认的"必须一起存下来，注入时按**这一次运行的文档**筛。
   * 少了这一步，在立体几何里确认的"第 3 版新增 solid-1"会出现在平面几何那一轮的提示词里，
   * 而那份文档里根本没有这个对象。
   */
  it("refuses a fact that was confirmed against another document", () => {
    const context = buildConversationContext(conversation({
      binding: { conversationId: "conv-1", projectId: "p", documentId: "doc-a", workspace: "conics", generation: 1 },
      facts: [
        { id: "cf-1", key: "a.key", text: "这份文档的事实", status: "confirmed", documentId: "doc-a" },
        { id: "cf-2", key: "b.key", text: "另一份文档的事实", status: "confirmed", documentId: "doc-b" },
        // 没写属于哪份文档的（旧数据）：按"未知"处理，保留并留一条警告，而不是静默丢掉。
        { id: "cf-3", key: "c.key", text: "没说属于哪份文档", status: "confirmed" }
      ]
    }))

    expect(context.facts.map((entry) => entry.id)).toEqual(["cf-1", "cf-3"])
    expect(JSON.stringify(context.facts)).not.toContain("另一份文档")
    expect(context.warnings.some((entry) => entry.code === "foreign_fact")).toBe(true)
  })

  it("keeps the caller's order when two messages share a timestamp", () => {
    /**
     * **同一次 `sendPrompt` 的用户消息与在途助手消息 `createdAt` 相同**，而 id 的字符串序
     * 会把它们倒过来（`…-10` 排在 `…-9` 前面）。顺序必须按调用方给的来 ——
     * 否则 `recentMessages` 里"用户说完助手接话"会变成"助手先说"，而当前请求的去重
     *（看最后一个是不是当前请求）也会跟着错。
     */
    const context = buildConversationContext(conversation({
      messages: [message("message-x-9", "先说的", 5), message("message-x-10", "后说的", 5, "assistant")]
    }))

    expect(context.messages.map((entry) => entry.id)).toEqual(["message-x-9", "message-x-10"])
  })

  /**
   * **§5.3 的分段预算**（Fix round 1 / I3）：场景 20% / 已确认事实 15% / 摘要 20% /
   * 最近消息 35% / 当前请求与安全余量 10%。
   *
   * 原先的实现是"场景 + **全部**已确认事实先扣，剩下的给摘要与消息"，而事实既没有条数上限、
   * 又只按字符扣费 —— 于是长命会话里（几百条 `commit:` 事实）摘要被切空、最近消息一条不剩，
   * 而那些事实里的大多数**根本不会进提示词**（提示词只渲染 16 条）。
   */
  it("reserves a band each for the facts, the summary and the messages", () => {
    const manyFacts = Array.from({ length: 150 }, (_, index) => ({
      id: `cf-${index}`,
      key: `commit:run-${String(index).padStart(3, "0")}`,
      text: `已确认：文档第 ${index} 版新增 1 个对象（${"solid-".repeat(6)}${index}）`,
      status: "confirmed" as const
    }))
    const context = buildConversationContext(conversation({
      facts: manyFacts,
      summary: "目标是建一个立方体",
      messages: [message("m1", "画一个圆", 1), message("m2", "好的。", 2, "assistant")]
    }))

    // 事实这一段的条数上限与提示词渲染的上限是**同一个数**，并且如实说了截断。
    // 下界也要断言（Fix round 2 / 残余 6）：只写 `<=` 的话"一条都不留"同样会通过，
    // 而这一段的算术明明放得下十来条。
    expect(context.facts.length).toBeGreaterThan(0)
    expect(context.facts.length).toBeLessThanOrEqual(MAX_CONVERSATION_FACTS)
    expect(context.warnings.some((entry) => entry.code === "truncated_facts")).toBe(true)
    // 摘要与最近消息**不会被事实挤没**（各有各的额度）。
    expect(context.summary).toBe("目标是建一个立方体")
    expect(context.messages.map((entry) => entry.id)).toEqual(["m1", "m2"])
  })

  it("keeps the whole current scene while the older messages are bounded", () => {
    const sceneFacts = Array.from({ length: 6 }, (_, index) => ({ id: `scene-${index}`, text: "场景事实".repeat(8), origin: "user" as const }))
    const messages = Array.from({ length: 40 }, (_, index) => message(`m${index}`, "x".repeat(100), index))
    const context = buildConversationContext(conversation({
      observation: { facts: sceneFacts, summary: "场景" },
      messages,
      limits: { characters: 600 }
    }))

    // 当前场景是权威：一条都不少（它有自己的软额度，不因消息被裁）。
    expect(context.observation.facts.map((entry) => entry.id)).toEqual(sceneFacts.map((entry) => entry.id))
    // 旧消息只在自己的额度里放得下多少算多少，并如实留痕。
    expect(context.messages.length).toBeLessThan(messages.length)
    expect(context.warnings.some((entry) => entry.code === "truncated_messages")).toBe(true)
  })

  it("never hands the model half a JSON summary", () => {
    // 一份**满尺寸**的结构化摘要（构造上就超过摘要的额度）。
    const full = JSON.stringify({
      goal: `目标是建一个立方体并继续作图。${"补充说明。".repeat(40)}`,
      confirmedFacts: Array.from({ length: 12 }, (_, index) => `已确认：文档第 ${index} 版新增 1 个对象（solid-${index}）${"说明".repeat(60)}`),
      createdObjects: Array.from({ length: 12 }, (_, index) => `solid-${index}`),
      openQuestions: ["这个圆的半径是多少？"],
      preferences: ["记住：以后都用红色"],
      messageCount: 40,
      compactedAt: 1
    })
    expect(full.length).toBeGreaterThan(DEFAULT_SUMMARY_CHARACTER_BUDGET)

    const context = buildConversationContext(conversation({ summary: full }))

    // 切一半会给出**坏 JSON**（模型拿到的 `summary` 解析不了）；必须压成一个更小的合法对象。
    const parsed = JSON.parse(context.summary) as { goal?: string }
    expect(parsed.goal).toContain("目标是建一个立方体")
    expect(context.summary.length).toBeLessThanOrEqual(DEFAULT_SUMMARY_CHARACTER_BUDGET)
    expect(context.warnings.some((entry) => entry.code === "truncated_summary")).toBe(true)
  })

  it("keeps a prose summary parseable as JSON too", () => {
    // 旧数据里可能是一段散文（不是我们写的结构化 JSON）：也不能切一半给模型。
    const context = buildConversationContext(conversation({ summary: "之前我们把立方体建好了。".repeat(400) }))

    const parsed = JSON.parse(context.summary) as { goal?: string }
    expect(parsed.goal).toContain("之前我们把立方体建好了")
  })

  /**
   * **连"只剩 goal"都装不下时回空**（Fix round 2 / 残余 5）。
   *
   * `{"goal":""}` 自己占 11 个字符，所以额度比它还小时给不出合法 JSON。评审指出原先那条
   * 退路会超出去 ≤13 个字符（上界漏洞）；现在的规则是：装不下就回**空**——
   * "没有摘要"是诚实状态，超预算的坏 JSON 不是。生产预算（6000 × 20%）永远够，这条守边界。
   */
  it("returns no summary at all when even the fallback cannot fit", () => {
    const context = buildConversationContext(conversation({ summary: "x".repeat(500), limits: { characters: 12 } }))

    expect(context.summary).toBe("")
    expect(context.warnings.some((entry) => entry.code === "truncated_summary")).toBe(true)
  })
})
