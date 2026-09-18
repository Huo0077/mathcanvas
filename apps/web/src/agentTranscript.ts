/**
 * Agent 回复的**纯函数**切分：把一段回答拆成「散文」与「代码块」两种片段。
 *
 * 为什么值得单独一个模块：展示区要把代码块交给等宽字体、单独一栏、单独的复制按钮，
 * 而这件事与 React 无关（未闭合的围栏、语言标签缺失、空片段都要有确定行为），
 * 所以它是可单测的纯函数，组件只负责把它画出来。
 */

export interface TranscriptTextSection {
  kind: "text"
  text: string
}

export interface TranscriptCodeSection {
  kind: "code"
  /** 围栏后的语言标签（```ts 里的 `ts`）。没有标签时是空字符串。 */
  language: string
  code: string
}

export type TranscriptSection = TranscriptTextSection | TranscriptCodeSection

const FENCE = /^```\s*([^\s`]*)\s*$/

/**
 * 按 ``` 围栏切分。**未闭合的围栏也算代码块**：流式输出到一半时不能把最后一行渲染成
 * 正文里的裸反引号；空片段直接丢掉，避免出现空段落。
 */
export function splitTranscript(text: string): TranscriptSection[] {
  const sections: TranscriptSection[] = []
  let buffer: string[] = []
  let code: { language: string; lines: string[] } | null = null

  const flushText = () => {
    const joined = buffer.join("\n").trim()
    if (joined) sections.push({ kind: "text", text: joined })
    buffer = []
  }
  const flushCode = () => {
    if (!code) return
    const joined = code.lines.join("\n").trim()
    if (joined) sections.push({ kind: "code", language: code.language, code: joined })
    code = null
  }

  for (const line of text.split("\n")) {
    const fence = FENCE.exec(line.trim())
    if (fence) {
      if (code) flushCode()
      else {
        flushText()
        code = { language: fence[1], lines: [] }
      }
      continue
    }
    if (code) code.lines.push(line)
    else buffer.push(line)
  }

  flushCode()
  flushText()
  return sections
}

/** 侧栏标题取用户第一行指令的前 18 个字：够认出是哪次对话，又不会把侧栏撑开。 */
export function deriveConversationTitle(prompt: string): string {
  const firstLine = prompt.split("\n").find((line) => line.trim().length > 0)?.trim() ?? ""
  return firstLine.length > 18 ? `${firstLine.slice(0, 18)}…` : firstLine
}

const CLOCK = (timestamp: number, now: number): string => {
  const date = new Date(timestamp)
  const sameDay = new Date(now).toDateString() === date.toDateString()
  return sameDay
    ? `${date.getHours()}`.padStart(2, "0") + ":" + `${date.getMinutes()}`.padStart(2, "0")
    : `${date.getMonth() + 1}/${date.getDate()}`
}

/**
 * 侧栏时间：当天只给时分，更早给日期。**不用 `Intl.RelativeTimeFormat`** —— 那会引入
 * "昨天 / 3 天前"这种随环境变化的文案，测试与截图都不可复现。
 */
export function formatConversationTime(timestamp: number, now: number = Date.now()): string {
  return CLOCK(timestamp, now)
}

/** 消息气泡上的时间戳（含日期），与侧栏共用一套格式化思路。 */
export function formatMessageTime(timestamp: number): string {
  const date = new Date(timestamp)
  return `${`${date.getHours()}`.padStart(2, "0")}:${`${date.getMinutes()}`.padStart(2, "0")}`
}
