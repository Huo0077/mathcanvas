import { POINT_NAME_SOURCE, splitPointNames } from "@draw/geometry-kernel"

/**
 * **长度连等表达式的确定性解析**（2026-10-26）。
 *
 * `AD=AB=2CD=2` 这类写法在卷面上很常见，而旧解析器用多条互相重叠的正则去碰：
 * 普通连等只认纯线段，倍数句型从中间开始吃，边界守卫再把不完整的那一段丢掉 ——
 * 结果是 `AD=` 落进"未核验"、`AB` 拿到错误的长度。这一层因此改成**整条链**解析：
 *
 * ```text
 * CHAIN := TERM ('=' TERM)+ ['=' VALUE]
 * TERM  := COEF? SEGMENT      （COEF 为正整数/小数；SEGMENT 为两个点名）
 * VALUE := 正数 | √n | k√n | k\sqrt{n}
 * ```
 *
 * 语义：链上所有项相等。给了绝对数值 `V` 时，每段长度是 `V / COEF`；
 * 没有绝对锚点时只产出**等长/比例**关系，不猜绝对长度。
 *
 * ## 边界规则（为什么不能"尽量多读一点"）
 *
 * - 整条链要么完整消费，要么**整条报错**：`AD=AB=2CD=`、`AB=AC=0`、`AB=AC=-2`
 *   都不能降级成"只读到 AB=AC"，那会把一条矛盾/非法条件悄悄弱化成成立的条件。
 * - 单段长度（`AB=2`）与冒号比例（`AE:AD=2:5`）**不归这一层**：它们已有可靠读取器。
 * - 上限：链长 200 字符、最多 16 项 —— 防御超长输入，不做通用代数。
 */

export type LengthChainDraft =
  | { kind: "fixedLength"; targets: string[]; value: number }
  | { kind: "equalLength"; targets: string[] }
  | { kind: "segmentRatio"; targets: string[]; value: number }

export type LengthChain =
  | { ok: true; start: number; end: number; sourceText: string; drafts: LengthChainDraft[] }
  | { ok: false; start: number; end: number; sourceText: string; reason: string }

const SEGMENT = `${POINT_NAME_SOURCE}${POINT_NAME_SOURCE}`
const TERM_SOURCE = `(?:([0-9]+(?:\\.[0-9]+)?)\\s*)?(${SEGMENT})`
const TERM = new RegExp(`^${TERM_SOURCE}$`)
const MAX_CHAIN_LENGTH = 200
const MAX_TERMS = 16

/** 支持既有写法：`5`、`2.5`、`√5`、`2√5`、`2\sqrt{5}`、`\sqrt{5}`。 */
function parseValue(text: string): number | null {
  const trimmed = text.trim()
  const latex = /^([0-9]+(?:\.[0-9]+)?)?\s*\\sqrt\s*\{\s*([0-9]+(?:\.[0-9]+)?)\s*\}$/.exec(trimmed)
  if (latex) {
    const coefficient = latex[1] === undefined ? 1 : Number(latex[1])
    const radicand = Number(latex[2])
    return Number.isFinite(coefficient) && Number.isFinite(radicand) ? coefficient * Math.sqrt(radicand) : null
  }
  const radical = /^([0-9]+(?:\.[0-9]+)?)?\s*√\s*([0-9]+(?:\.[0-9]+)?)$/.exec(trimmed)
  if (radical) {
    const coefficient = radical[1] === undefined ? 1 : Number(radical[1])
    const radicand = Number(radical[2])
    return Number.isFinite(coefficient) && Number.isFinite(radicand) ? coefficient * Math.sqrt(radicand) : null
  }
  if (/^-?[0-9]+(?:\.[0-9]+)?$/.test(trimmed)) return Number(trimmed)
  return null
}

interface Term {
  segment: [string, string]
  coefficient: number
}

function parseTerm(text: string): Term | null {
  const match = TERM.exec(text.trim())
  if (match === null) return null
  const names = splitPointNames(match[2]!)
  if (names.length !== 2) return null
  const coefficient = match[1] === undefined ? 1 : Number(match[1])
  if (!Number.isFinite(coefficient) || !(coefficient > 0)) return null
  return { segment: [names[0]!, names[1]!], coefficient }
}

function relationsOf(terms: readonly Term[], value: number | null): LengthChainDraft[] {
  const drafts: LengthChainDraft[] = []
  for (const [index, term] of terms.entries()) {
    if (value !== null) drafts.push({ kind: "fixedLength", targets: [...term.segment], value: value / term.coefficient })
    const next = terms[index + 1]
    if (next === undefined) continue
    if (term.coefficient === next.coefficient) {
      drafts.push({ kind: "equalLength", targets: [...term.segment, ...next.segment] })
    } else {
      // c₁L₁ = c₂L₂ ⇒ L₁ / L₂ = c₂ / c₁
      drafts.push({ kind: "segmentRatio", targets: [...term.segment, ...next.segment], value: next.coefficient / term.coefficient })
    }
  }
  return drafts
}

/**
 * 找出题面里所有**长度连等链**。返回的顺序与出现顺序一致。
 *
 * 只处理以"线段项"开头的 `=` 链；单段长度、冒号比例、角度等式都不在这里。
 */
export function parseLengthChains(prompt: string): LengthChain[] {
  const out: LengthChain[] = []
  // 先按标点切成从句，再从每个从句里找 `=` 链：跨从句的链没有数学意义。
  for (const clause of prompt.matchAll(/[^，,。；;\n]+/g)) {
    const clauseStart = clause.index ?? 0
    const raw = clause[0].split(/[（(]/)[0] ?? ""
    for (const run of raw.matchAll(/[^=]+(?:=[^=]*)+/g)) {
      const runStart = clauseStart + (run.index ?? 0)
      // 从句切分不会吃掉右括号：`（即 AB=BC=1, AD=2）` 的 `AD=2）` 要把 `）` 去掉以后再判。
      const text = run[0].replace(/[）)\]】.。]+$/, "")
      if (text.length > MAX_CHAIN_LENGTH) continue
      // 从第一个"线段项"起步：前面的字（例如"设"）不属于等式。
      const startMatch = new RegExp(TERM_SOURCE).exec(text)
      if (startMatch === null) continue
      const localStart = startMatch.index
      const pieceText = text.slice(localStart).trim()
      const start = runStart + localStart
      const end = start + pieceText.length
      const sourceText = pieceText
      const pieces = pieceText.split("=").map((piece) => piece.trim())
      if (pieces.length < 2) continue
      if (pieces.length > MAX_TERMS + 1) {
        out.push({ ok: false, start, end, sourceText, reason: `连等项过多（>${MAX_TERMS}），本轮不解析。` })
        continue
      }

      const terms: Term[] = []
      let value: number | null = null
      let failure: string | null = null
      let notOurChain = false
      for (const [index, piece] of pieces.entries()) {
        const isLast = index === pieces.length - 1
        /**
         * **比例写法不归这一层**：`AE=2/5 AD`、`AF=1/2 AB` 是"线段的比例"，已有读取器负责。
         * 这里若按"未知项"报错，会把它从既有规则手里抢走，让本来能核验的条件变成未核验
         *（2026-10-26 全量回归暴露的 24 条失败正是这一类）。
         */
        if (/[/⁄]/.test(piece) && /[A-Z]/.test(piece)) {
          notOurChain = true
          break
        }
        if (piece.length === 0) {
          // 断尾：`AD=AB=2CD=` 整条报错；但 `则SA=.`（只有一段）不是链，跳过。
          if (terms.length >= 2) failure = "连等表达式在等号处断尾。"
          else notOurChain = true
          break
        }
        const term = parseTerm(piece)
        if (term !== null) {
          terms.push(term)
          continue
        }
        const number = isLast ? parseValue(piece) : null
        if (number === null) {
          if (terms.length > 0) failure = `无法识别连等中的「${piece}」。`
          else notOurChain = true
          break
        }
        if (!(number > 0) || !Number.isFinite(number)) {
          failure = `长度必须是有限正数，收到「${piece}」。`
          break
        }
        value = number
      }
      if (notOurChain) continue

      if (failure !== null) {
        out.push({ ok: false, start, end, sourceText, reason: failure })
        continue
      }
      // 只有一段线段 + 一个数值：那是单段长度，交给既有读取器。
      if (terms.length < 2) continue
      if (terms.length === pieces.length) value = null
      out.push({ ok: true, start, end, sourceText, drafts: relationsOf(terms, value) })
    }
  }
  return out
}
