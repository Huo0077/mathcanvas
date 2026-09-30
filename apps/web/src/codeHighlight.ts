/**
 * **极轻量的代码分词器**（为 Agent 的代码块做语法高亮）。
 *
 * 为什么自己写而不是装 Prism / highlight.js：这里要上色的只有一类文本 ——
 * Agent 回复里 ``` 围栏包住的片段，篇幅通常在几十行内，语言也就 JSON / TS / shell 几种。
 * 为此引入一个几百 KB、还带 CSS 主题的库不划算，而且那类库默认按"整页 HTML"设计，
 * 会往我们的 `pre > code` 里塞自己的 DOM 结构与 class 命名，反而更难统一到现有配色令牌上。
 *
 * 设计要点：
 * 1. **纯函数、返回 token 数组**，不碰 DOM、不生成 HTML 字符串 ——
 *    渲染层用 React 文本节点输出，所以**不存在注入面**（这也是一开始就不做 `innerHTML` 的原因）。
 * 2. **不追求完整语法**。高亮是阅读辅助，分错一个标识符无伤大雅；
 *    但**拼接顺序必须无损**：所有 token 的 value 依次相连一定等于输入原文，
 *    这条由单测钉住，否则代码块会悄悄吞字符。
 * 3. 注释 / 字符串 / 模板串按"先长后短"匹配，避免 `//` 被吃进字符串、`/*` 被当成除号。
 */

export type CodeTokenKind = "comment" | "string" | "number" | "keyword" | "literal" | "punctuation" | "plain"

export interface CodeToken {
  kind: CodeTokenKind
  value: string
}

/** 语言标签归一化：围栏里可能是 `ts` / `typescript` / `TS`，也可能是空。 */
function normalizeLanguage(language: string): "ts" | "json" | "shell" | "plain" {
  const l = language.trim().toLowerCase()
  if (l === "json" || l === "jsonc") return "json"
  if (l === "sh" || l === "bash" || l === "shell" || l === "zsh" || l === "console") return "shell"
  if (l === "ts" || l === "tsx" || l === "js" || l === "jsx" || l === "javascript" || l === "typescript" || l === "mjs") return "ts"
  return "plain"
}

const COMMON_KEYWORDS = [
  "const", "let", "var", "function", "return", "if", "else", "for", "while", "do", "switch", "case", "break", "continue",
  "import", "from", "export", "default", "type", "interface", "class", "extends", "implements", "new", "this", "super",
  "await", "async", "as", "of", "in", "typeof", "instanceof", "try", "catch", "finally", "throw", "yield", "delete", "void"
]

const SHELL_KEYWORDS = ["npm", "npx", "node", "pnpm", "yarn", "cd", "ls", "echo", "export", "set", "git", "run", "install", "build", "test"]

const KEYWORDS: Record<ReturnType<typeof normalizeLanguage>, Set<string>> = {
  ts: new Set(COMMON_KEYWORDS),
  shell: new Set(SHELL_KEYWORDS),
  json: new Set(),
  plain: new Set(COMMON_KEYWORDS)
}

/** `true` / `false` / `null` / `undefined` 单独一档：它们常见、且值得与关键字区分开。 */
const LITERALS = new Set(["true", "false", "null", "undefined", "NaN", "Infinity"])

const IDENT_START = /[A-Za-z_$]/
const IDENT_PART = /[A-Za-z0-9_$]/
const DIGIT = /[0-9]/
const PUNCT = new Set(["{", "}", "(", ")", "[", "]", ".", ",", ";", ":", "+", "-", "*", "/", "%", "=", "<", ">", "!", "&", "|", "?", "~", "^"])

export function highlightCode(code: string, language = ""): CodeToken[] {
  const lang = normalizeLanguage(language)
  const keywords = KEYWORDS[lang]
  // JSON 里没有注释；`//` 只有在字符串外才是注释，这里靠扫描顺序保证。
  const allowComments = lang !== "json"

  const tokens: CodeToken[] = []
  const push = (kind: CodeTokenKind, value: string) => {
    if (!value) return
    const last = tokens[tokens.length - 1]
    // 相邻同类合并，避免一个长标识符被拆成十几个 span。
    if (last && last.kind === kind) last.value += value
    else tokens.push({ kind, value })
  }

  let i = 0
  while (i < code.length) {
    const ch = code[i]
    const next = code[i + 1]

    if (allowComments && ch === "/" && next === "/") {
      const end = code.indexOf("\n", i)
      const stop = end === -1 ? code.length : end
      push("comment", code.slice(i, stop))
      i = stop
      continue
    }
    if (allowComments && ch === "/" && next === "*") {
      const end = code.indexOf("*/", i + 2)
      const stop = end === -1 ? code.length : end + 2
      push("comment", code.slice(i, stop))
      i = stop
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch
      let j = i + 1
      while (j < code.length) {
        if (code[j] === "\\") { j += 2; continue }
        if (code[j] === quote) { j++; break }
        // 单/双引号字符串不跨行：遇到换行就当作未闭合，把这一段交还给普通文本。
        if (quote !== "`" && code[j] === "\n") break
        j++
      }
      push("string", code.slice(i, j))
      i = j
      continue
    }
    if (DIGIT.test(ch) || (ch === "." && next !== undefined && DIGIT.test(next))) {
      let j = i
      while (j < code.length && /[0-9a-fA-FxXoObBeE._+-]/.test(code[j])) {
        // 只在指数位置接受 + / -，否则 `1-2` 会被吃成一个数字。
        if ((code[j] === "+" || code[j] === "-") && !/[eE]/.test(code[j - 1] ?? "")) break
        j++
      }
      push("number", code.slice(i, j))
      i = j
      continue
    }
    if (IDENT_START.test(ch)) {
      let j = i
      while (j < code.length && IDENT_PART.test(code[j])) j++
      const word = code.slice(i, j)
      push(LITERALS.has(word) ? "literal" : keywords.has(word) ? "keyword" : "plain", word)
      i = j
      continue
    }
    if (PUNCT.has(ch)) {
      push("punctuation", ch)
      i++
      continue
    }
    push("plain", ch)
    i++
  }

  return tokens
}
