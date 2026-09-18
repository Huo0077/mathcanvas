import { describe, expect, it } from "vitest"

import { deriveConversationTitle, splitTranscript } from "./agentTranscript"

describe("agent transcript", () => {
  it("keeps plain prose as a single text section", () => {
    expect(splitTranscript("先做一条平行线，再从交点处作切线。")).toEqual([
      { kind: "text", text: "先做一条平行线，再从交点处作切线。" }
    ])
  })

  it("splits fenced code out of the surrounding prose and keeps the language", () => {
    const sections = splitTranscript("结果如下：\n```mgeo\n{ \"workspace\": \"conics\" }\n```\n以上就是全部改动。")

    expect(sections).toEqual([
      { kind: "text", text: "结果如下：" },
      { kind: "code", language: "mgeo", code: "{ \"workspace\": \"conics\" }" },
      { kind: "text", text: "以上就是全部改动。" }
    ])
  })

  it("treats a bare fence as code with no language label", () => {
    expect(splitTranscript("```\n1 + 1\n```")).toEqual([{ kind: "code", language: "", code: "1 + 1" }])
  })

  it("keeps an unterminated fence as code so a streaming reply never renders a stray backtick line", () => {
    expect(splitTranscript("正在生成：\n```ts\nconst a = 1")).toEqual([
      { kind: "text", text: "正在生成：" },
      { kind: "code", language: "ts", code: "const a = 1" }
    ])
  })

  it("drops empty sections instead of rendering blank paragraphs", () => {
    expect(splitTranscript("\n\n```js\nlet a = 1\n```\n\n")).toEqual([{ kind: "code", language: "js", code: "let a = 1" }])
  })

  it("derives a compact title from the first user line", () => {
    expect(deriveConversationTitle("  画一个正方体\n并求体积  ")).toBe("画一个正方体")
    expect(deriveConversationTitle("")).toBe("")
    expect(deriveConversationTitle("a".repeat(40))).toBe(`${"a".repeat(18)}…`)
  })
})
