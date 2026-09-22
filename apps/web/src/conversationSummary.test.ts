import { describe, expect, it } from "vitest"

import type { ConversationFactView, ConversationMessageView } from "@draw/agent-core"

import {
  MAX_SUMMARY_ITEMS,
  SUMMARY_TRIGGER_CHARACTERS,
  compactConversationSummary,
  estimateConversationCharacters,
  parseConversationSummary,
  serializeConversationSummary,
  shouldCompactConversation,
  summaryOfDocument,
  withDocumentSummary
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
