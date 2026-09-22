import { describe, expect, it } from "vitest"

import { factInvalidationOf, withFactInvalidation, type LiveDocumentEvidence } from "./conversationFacts"

/**
 * **一条事实还算不算数**（Follow-up：`stale` 与 `retract`）。
 *
 * 在此之前事实只有 `confirmed` 一种归宿：文档撤销回它写下之前那一版、或者它引用的对象
 * 已经被删掉，那条事实照样以"已确认"的身份进下一轮的提示词 —— 模型于是拿着一个
 * 文档里根本不存在的东西继续规划。这里钉住的是**判据保守**这一条：
 * 只有**文档本身**能证明它不再成立时才降级，而且要把"是哪条证据"记下来。
 */
function live(overrides: Partial<LiveDocumentEvidence> = {}): LiveDocumentEvidence {
  return { documentId: "doc-1", revision: 7, objectIds: ["solid-1"], ...overrides }
}

function committed(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { text: "已确认：文档第 7 版新增 1 个对象（solid-1）", generation: 7, createdObjects: ["solid-1"], documentId: "doc-1", ...overrides }
}

describe("fact invalidation", () => {
  it("keeps a fact confirmed while the objects it cites are still in the document", () => {
    expect(factInvalidationOf(committed(), live())).toBeNull()
    // 后来的版本不算证据：事实说的是"那一版新增了什么"，之后又改了几版它照样成立。
    expect(factInvalidationOf(committed(), live({ revision: 12 }))).toBeNull()
    // 引用的对象里**还有一个在**，就不许判它失效（宁可留着，也不猜）。
    expect(factInvalidationOf(committed({ createdObjects: ["solid-1", "solid-2"] }), live({ objectIds: ["solid-1"] }))).toBeNull()
  })

  it("calls a fact stale when the document no longer contains what it cites", () => {
    const invalidation = factInvalidationOf(committed(), live({ objectIds: [] }))

    expect(invalidation?.status).toBe("stale")
    // 证据要能读懂：是哪份文档、哪些对象、判在哪一版上。
    expect(invalidation?.reason).toContain("solid-1")
    expect(invalidation?.evidence).toBe("document:doc-1@7")
  })

  it("calls a fact stale when the document went back before the version it recorded", () => {
    // 撤销：文档退回到写下这条事实**之前**的那一版，它说的那一版已经不在画布上了。
    expect(factInvalidationOf(committed(), live({ revision: 6 }))?.status).toBe("stale")
  })

  it("never guesses: an unreadable value or another document's fact is left alone", () => {
    // 说不清是哪份文档的旧数据：不动它（与 `factBelongsToDocument` 同一个口径）。
    expect(factInvalidationOf(committed({ documentId: undefined }), live())).toBeNull()
    expect(factInvalidationOf(committed({ documentId: "doc-2" }), live({ objectIds: [] }))).toBeNull()
    // 形状不是我们写的那种：不猜。
    expect(factInvalidationOf("之前我们把立方体建好了", live({ objectIds: [] }))).toBeNull()
    expect(factInvalidationOf(null, live({ objectIds: [] }))).toBeNull()
    // 没有记过引用对象的事实：只能看版本，别的一概不猜。
    expect(factInvalidationOf(committed({ createdObjects: undefined }), live())).toBeNull()
  })

  it("records which evidence invalidated a fact, without touching the rest of the value", () => {
    const invalidated = withFactInvalidation(committed(), { status: "retracted", reason: "用户说这条不算数了", evidence: "user:message-1", at: 99 })

    expect(invalidated).toMatchObject({
      text: "已确认：文档第 7 版新增 1 个对象（solid-1）",
      createdObjects: ["solid-1"],
      invalidation: { status: "retracted", reason: "用户说这条不算数了", evidence: "user:message-1", at: 99 }
    })
    // 读不懂的值（不是对象）一律拒绝改写 —— 改写会把它的原文换掉。
    expect(withFactInvalidation("一段散文", { status: "retracted", reason: "x", evidence: "y", at: 1 })).toBeNull()
    expect(withFactInvalidation(null, { status: "retracted", reason: "x", evidence: "y", at: 1 })).toBeNull()
  })
})
