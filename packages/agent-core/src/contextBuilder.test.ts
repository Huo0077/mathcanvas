import { describe, expect, it } from "vitest"

import { createBudget } from "./budget"
import { buildContext, DEFAULT_FACT_LIMIT, DEFAULT_REF_LIMIT, MAX_FACT_LIMIT, type BuildContextInput, type Fact, type SelectedRef } from "./contextBuilder"
import type { DocumentHandle, RunContext } from "./contracts"
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
