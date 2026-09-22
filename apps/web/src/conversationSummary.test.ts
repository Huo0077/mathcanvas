import { describe, expect, it } from "vitest"

import type { ConversationFactView, ConversationMessageView } from "@draw/agent-core"

import {
  MAX_SUMMARY_ITEMS,
  SUMMARY_TRIGGER_CHARACTERS,
  compactConversationSummary,
  estimateConversationCharacters,
  parseConversationSummary,
  serializeConversationSummary,
  shouldCompactConversation
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
})
