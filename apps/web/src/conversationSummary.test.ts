import { describe, expect, it } from "vitest"

import type { ConversationFactView, ConversationMessageView } from "@draw/agent-core"

import {
  MAX_SUMMARY_BOOK_CHARS,
  MAX_SUMMARY_ITEMS,
  SUMMARY_TRIGGER_CHARACTERS,
  compactConversationSummary,
  estimateConversationCharacters,
  fitSummaryBook,
  parseConversationSummary,
  parseConversationSummaryBook,
  serializeConversationSummaryBook,
  serializeConversationSummary,
  shouldCompactConversation,
  summaryOfDocument,
  withDocumentSummary,
  type ConversationSummary
} from "./conversationSummary"

/**
 * **摘要压缩**（对话切片 Task 5；规格 §5.3/§10）。
 *
 * 这一节钉住三件事：阈值（什么时候压）、结构（压出哪五样）、以及**边界**
 * （只有 confirmed 事实进摘要；摘要不是模型写的散文）。
 */
function message(id: string, role: "user" | "assistant", text: string, createdAt: number): ConversationMessageView {
  return { id, role, text, createdAt }
}

function fact(id: string, key: string, text: string, status: ConversationFactView["status"] = "confirmed"): ConversationFactView {
  return { id, key, text, status }
}

describe("conversation summary compaction", () => {
  it("triggers on the configured character threshold", () => {
    const short = [message("m1", "user", "画一个圆", 1)]
    const long = [message("m2", "user", "x".repeat(SUMMARY_TRIGGER_CHARACTERS + 1), 1)]

    expect(estimateConversationCharacters(short)).toBeLessThan(SUMMARY_TRIGGER_CHARACTERS)
    expect(shouldCompactConversation(short)).toBe(false)
    expect(shouldCompactConversation(long)).toBe(true)
    // 调用方可以把阈值调低（更早压缩），但调高会被夹住 —— 摘要不许无限膨胀。
    expect(shouldCompactConversation(short, 1)).toBe(true)
    expect(shouldCompactConversation(long, 1)).toBe(true)
  })

  it("compacts into the five structural fields the spec names", () => {
    const messages = [
      message("m1", "user", "建一个棱长 3 的立方体", 1),
      message("m2", "assistant", "已按确认提交。", 2),
      message("m3", "user", "记住：以后都用红色", 3),
      message("m4", "assistant", "这个圆的半径是多少？", 4)
    ]
    const summary = compactConversationSummary({
      messages,
      facts: [fact("f1", "commit:run-1", "已提交：文档第 3 版新增 1 个对象（solid-1）")],
      createdObjects: ["solid-1"],
      now: 99
    })

    expect(summary.goal).toBe("建一个棱长 3 的立方体")
    expect(summary.confirmedFacts).toEqual(["已提交：文档第 3 版新增 1 个对象（solid-1）"])
    expect(summary.createdObjects).toEqual(["solid-1"])
    expect(summary.openQuestions).toEqual(["这个圆的半径是多少？"])
    expect(summary.preferences).toEqual(["记住：以后都用红色"])
    expect(summary.messageCount).toBe(4)
    expect(summary.compactedAt).toBe(99)
  })

  it("never lets an unconfirmed fact into the summary", () => {
    const summary = compactConversationSummary({
      messages: [message("m1", "user", "建一个立方体", 1)],
      facts: [
        fact("f1", "commit:run-1", "已确认：文档第 2 版新增 1 个对象", "confirmed"),
        fact("f2", "draft:run-2", "草稿：将新增一个球", "draft"),
        fact("f3", "old:run-0", "过期：半径 9", "stale")
      ],
      now: 1
    })

    expect(summary.confirmedFacts).toEqual(["已确认：文档第 2 版新增 1 个对象"])
    expect(JSON.stringify(summary)).not.toContain("球")
    expect(JSON.stringify(summary)).not.toContain("半径 9")
  })

  it("is deterministic: the same input gives the same summary", () => {
    const input = {
      messages: [message("m1", "user", "画一个圆", 1), message("m2", "assistant", "半径是多少？", 2)],
      facts: [fact("f1", "k", "已确认：圆心在原点")],
      now: 7
    }

    expect(compactConversationSummary(input)).toEqual(compactConversationSummary(input))
  })

  it("carries the previous summary's objects and preferences forward", () => {
    const previous = compactConversationSummary({
      messages: [message("m1", "user", "记住：坐标轴要带刻度", 1)],
      facts: [],
      createdObjects: ["solid-1"],
      now: 1
    })

    const next = compactConversationSummary({
      messages: [message("m2", "user", "再建一个", 2)],
      facts: [fact("f2", "commit:run-2", "已确认：文档第 4 版新增 1 个对象（solid-2）")],
      createdObjects: ["solid-2"],
      previous,
      now: 2
    })

    expect(next.createdObjects).toEqual(["solid-1", "solid-2"])
    expect(next.preferences).toEqual(["记住：坐标轴要带刻度"])
  })

  it("bounds every list so a summary cannot grow without limit", () => {
    const messages = Array.from({ length: 40 }, (_, index) => message(`m${index}`, "user", "记住：这一条偏好".repeat(3), index))
    const facts = Array.from({ length: 40 }, (_, index) => fact(`f${index}`, `k${index}`, `已确认事实 ${index}`))
    const summary = compactConversationSummary({ messages, facts, now: 1 })

    expect(summary.confirmedFacts.length).toBeLessThanOrEqual(MAX_SUMMARY_ITEMS)
    expect(summary.goal.length).toBeLessThanOrEqual(241)
    expect(summary.openQuestions.length).toBeLessThanOrEqual(3)
    expect(summary.preferences.length).toBeLessThanOrEqual(2)
  })

  it("round-trips through the stored JSON, and reads nothing else", () => {
    const summary = compactConversationSummary({ messages: [message("m1", "user", "画一个圆", 1)], facts: [], now: 5 })

    expect(parseConversationSummary(serializeConversationSummary(summary))).toEqual(summary)
    // 空的 / 别的形状（例如早期版本写过的散文摘要）一律当作"没有摘要"，**不编**一份出来。
    expect(parseConversationSummary("")).toBeNull()
    expect(parseConversationSummary("之前我们把立方体建好了")).toBeNull()
    expect(parseConversationSummary('{"somethingElse":1}')).toBeNull()
  })

  /**
   * **摘要按文档分开存**（Fix round 2 / C1 残余；规格 §5.1 + §9）。
   *
   * 事实列表已经按文档筛了，但摘要曾经是**另一条**载体：它把该会话**全部**已确认事实的原文
   * 与创建出来的对象 id 压进一段文字，注入时又不过滤 —— 于是"在立体几何里确认的事实"
   * 会以 `summary` 的形式出现在平面几何那一轮里。改成按文档存之后，注入方只能取到
   * **本次运行那份文档**的那一份。
   */
  it("keeps one summary per document and only hands over the one asked for", () => {
    const inGeometry = compactConversationSummary({ messages: [message("m1", "user", "建一个立方体", 1)], facts: [], createdObjects: ["solid-1"], now: 1 })
    const stored = withDocumentSummary("", "doc-geometry", inGeometry)
    const inPlanar = compactConversationSummary({ messages: [message("m2", "user", "画一个圆", 2)], facts: [], createdObjects: ["circle-1"], now: 2 })
    const both = withDocumentSummary(stored, "doc-planar", inPlanar)

    expect(summaryOfDocument(both, "doc-geometry")?.createdObjects).toEqual(["solid-1"])
    expect(summaryOfDocument(both, "doc-planar")?.createdObjects).toEqual(["circle-1"])
    expect(summaryOfDocument(both, "doc-geometry")?.documentId).toBe("doc-geometry")
    // 没见过的文档：没有摘要（**不**把别的文档那一份端出来）。
    expect(summaryOfDocument(both, "doc-never-seen")).toBeNull()
    // 旧形状（平铺的一份摘要，没有说属于哪份文档）→ 不猜，回 null。
    expect(summaryOfDocument(serializeConversationSummary(inGeometry), "doc-geometry")).toBeNull()
    // 坏文本同样如此。
    expect(summaryOfDocument("之前我们把立方体建好了", "doc-geometry")).toBeNull()

    // 再写一次同一份文档：**只换那一份**，别的文档那一份原样保留。
    const rewritten = withDocumentSummary(both, "doc-geometry", compactConversationSummary({ messages: [message("m3", "user", "再建一个", 3)], facts: [], createdObjects: ["solid-2"], now: 3 }))
    expect(summaryOfDocument(rewritten, "doc-geometry")?.createdObjects).toEqual(["solid-2"])
    expect(summaryOfDocument(rewritten, "doc-planar")?.createdObjects).toEqual(["circle-1"])
  })
})

/**
 * **摘要本也要装得下**（Follow-up / 摘要 16K 边界）。
 *
 * 仓储（Rust 与浏览器兜底**两边**）对 `conversations.summary` 有 16000 字符的硬上限，
 * 而"按文档分开"之后一本书可以有**很多份**摘要 —— 一条会话被用在十几份文档上时，
 * 合并后的那本书会越过上限：`saveSummary` 抛错，调用方的 `try/catch` 又把它咽掉，
 * 表现就是**摘要从此再也不更新**，而没有任何人知道。所以这里钉住两件事：
 * ① 写进去的书**一定**在上限之内（丢最旧的几份、必要时削一份）；② 丢了什么要能报出来。
 */
function bookSummary(marker: string, items: number, compactedAt: number): ConversationSummary {
  return {
    goal: `${marker} 的目标 ${"目".repeat(180)}`,
    confirmedFacts: Array.from({ length: items }, (_, index) => `${marker} 事实 ${index} ${"f".repeat(170)}`),
    createdObjects: Array.from({ length: items }, (_, index) => `${marker}-对象-${index}-${"o".repeat(40)}`),
    openQuestions: [`${marker} 待答 ${"q".repeat(170)}`],
    preferences: [`${marker} 偏好 ${"p".repeat(170)}`],
    messageCount: 12,
    compactedAt
  }
}

function bookOf(entries: readonly { documentId: string; summary: ConversationSummary }[]): string {
  return entries.reduce((serialized, entry) => withDocumentSummary(serialized, entry.documentId, entry.summary), "")
}

describe("fitting the summary book into the stored limit", () => {
  it("leaves a book that already fits exactly as it was", () => {
    const stored = bookOf([
      { documentId: "doc-1", summary: bookSummary("甲", 2, 100) },
      { documentId: "doc-2", summary: bookSummary("乙", 2, 200) }
    ])
    const fitted = fitSummaryBook(parseConversationSummaryBook(stored), "doc-2")

    expect(fitted.dropped).toEqual([])
    expect(fitted.shrunk).toEqual([])
    expect(serializeConversationSummaryBook(fitted.book)).toBe(stored)
    expect(fitted.book.byDocument["doc-1"]).toBeDefined()
  })

  it("drops the oldest documents until the book fits, keeping the one being written", () => {
    const stored = bookOf([1, 2, 3, 4, 5, 6].map((index) => ({ documentId: `doc-${index}`, summary: bookSummary(`第${index}份`, 12, index * 1_000) })))
    expect(stored.length).toBeGreaterThan(MAX_SUMMARY_BOOK_CHARS)

    const fitted = fitSummaryBook(parseConversationSummaryBook(stored), "doc-6")
    const written = serializeConversationSummaryBook(fitted.book)

    expect(written.length).toBeLessThanOrEqual(MAX_SUMMARY_BOOK_CHARS)
    // 最旧的先丢，写入的那一份留到最后。
    expect(fitted.dropped.length).toBeGreaterThan(0)
    expect(fitted.dropped[0]).toBe("doc-1")
    expect(fitted.dropped).not.toContain("doc-6")
    expect(fitted.shrunk).toEqual([])
    expect(fitted.book.byDocument["doc-6"]).toBeDefined()
    expect(fitted.book.byDocument["doc-1"]).toBeUndefined()
  })

  it("shrinks a single entry that is on its own over the limit", () => {
    const oversized = bookSummary("超大", 200, 1)
    const stored = withDocumentSummary("", "doc-only", oversized)
    expect(stored.length).toBeGreaterThan(MAX_SUMMARY_BOOK_CHARS)

    const fitted = fitSummaryBook(parseConversationSummaryBook(stored), "doc-only")
    const written = serializeConversationSummaryBook(fitted.book)

    expect(written.length).toBeLessThanOrEqual(MAX_SUMMARY_BOOK_CHARS)
    expect(fitted.shrunk).toEqual(["doc-only"])
    // 削的是**最旧的那些条目**，不是编一份新的：留下的仍然来自原来那份摘要。
    expect(fitted.book.byDocument["doc-only"]!.confirmedFacts.length).toBeLessThan(200)
    expect(fitted.book.byDocument["doc-only"]!.confirmedFacts.length).toBeGreaterThan(0)
  })
})
