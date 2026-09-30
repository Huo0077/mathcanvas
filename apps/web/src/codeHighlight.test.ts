import { describe, expect, it } from "vitest"

import { highlightCode } from "./codeHighlight"

/** 高亮最容易出的错不是"颜色不对"，而是**悄悄吞掉或重复字符**。这条断言是底线。 */
function expectLossless(code: string, language = "") {
  const tokens = highlightCode(code, language)
  expect(tokens.map((t) => t.value).join("")).toBe(code)
  return tokens
}

describe("code highlighting", () => {
  it("never loses or duplicates a character", () => {
    const samples = [
      "",
      "plain text",
      "const a = 1",
      "```not a fence```",
      "// comment\nconst x = 'a' // trailing",
      "/* block\n comment */ let y = 2",
      "{\"a\": [1, 2.5e-3], \"b\": true, \"c\": null}",
      "const s = `template ${x} end`",
      "if (a && b || !c) { run() }",
      "中文注释混在代码里 const 名 = 1",
      "unterminated 'string",
      "unterminated /* block",
      "1-2",
      "x?.y ?? z"
    ]
    for (const sample of samples) {
      for (const lang of ["ts", "json", "bash", ""]) expectLossless(sample, lang)
    }
  })

  it("classifies keywords, literals, numbers and strings", () => {
    const tokens = highlightCode("const n = 42\nconst ok = true\nconst s = \"hi\"", "ts")
    const byKind = (kind: string) => tokens.filter((t) => t.kind === kind).map((t) => t.value)
    expect(byKind("keyword")).toEqual(["const", "const", "const"])
    expect(byKind("number")).toEqual(["42"])
    expect(byKind("literal")).toEqual(["true"])
    expect(byKind("string")).toEqual(["\"hi\""])
  })

  it("treats // inside a string as string content, not a comment", () => {
    const tokens = highlightCode("const url = \"https://example.com\"", "ts")
    expect(tokens.filter((t) => t.kind === "comment")).toHaveLength(0)
    expect(tokens.find((t) => t.kind === "string")?.value).toBe("\"https://example.com\"")
  })

  it("does not treat // as a comment in JSON", () => {
    const tokens = highlightCode("{ \"path\": \"a//b\" }", "json")
    expect(tokens.filter((t) => t.kind === "comment")).toHaveLength(0)
    expect(tokens.filter((t) => t.kind === "literal")).toHaveLength(0)
  })

  it("keeps `1-2` as three tokens instead of swallowing the minus sign", () => {
    const tokens = highlightCode("1-2", "ts")
    expect(tokens.map((t) => [t.kind, t.value])).toEqual([["number", "1"], ["punctuation", "-"], ["number", "2"]])
  })

  it("does not swallow the line after an unterminated single-quoted string", () => {
    // 单引号字符串不跨行：未闭合时这一段必须还给后面的行，否则整块代码都会变成一个字符串。
    const tokens = highlightCode("const a = 'oops\nconst b = 2", "ts")
    expect(tokens.filter((t) => t.kind === "keyword")).toHaveLength(2)
    expect(tokens.filter((t) => t.kind === "number").map((t) => t.value)).toEqual(["2"])
  })

  it("normalises language aliases and falls back to plain", () => {
    const tsLike = highlightCode("import x from 'y'", "TypeScript")
    expect(tsLike.some((t) => t.kind === "keyword" && t.value === "import")).toBe(true)
    const shell = highlightCode("npm run build", "bash")
    expect(shell.filter((t) => t.kind === "keyword").map((t) => t.value)).toEqual(["npm", "run", "build"])
    const unknown = highlightCode("const a = 1", "brainfuck")
    expect(unknown.some((t) => t.kind === "keyword")).toBe(true)
  })

  it("merges adjacent tokens of the same kind", () => {
    const tokens = highlightCode("aVeryLongIdentifierName", "ts")
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toEqual({ kind: "plain", value: "aVeryLongIdentifierName" })
  })
})
