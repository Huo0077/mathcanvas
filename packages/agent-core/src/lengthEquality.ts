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
 * TERM  := COEF? SEGMENT      （COEF 为正整数/小数，或 a/b 形式的正分数）
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
 * - **表达式起点必须是我们认得出的起点**：`-AB=CD=2` 的前缀是 `-`，说明这段数学比
 *   "一条长度连等"更大（负号、加法、乘除整式都算），这时**整条**落未核验 ——
 *   从 `AB` 开始读就等于把负号扔了。
 * - `AB+CD=5`、`AB/CD=2` 这类**本层不支持的整式**同样整条落未核验，绝不只读后半截。
 * - **括号不是噪声**：`（即 AB=BC=1, AD=2）` 里的等式照旧是条件，窗口切分让括号内外
 *   都能被读到（括号只切边界，不丢内容）。
 * - 单段长度（`AB=2`）与冒号比例（`AE:AD=2:5`）**不归这一层**：它们已有可靠读取器。
 * - 分数系数（`2/3 AB`）按**有理数**算（`V·分母/分子`），不是先化成浮点再除 ——
 *   `2 / (2/3)` 在浮点下是 `3.0000000000000004`，会让"AB=3"永远差一点点。
 * - 角度写法（`∠ABC=60°`）不在这里读：那是角，不是长度。
 * - 上限：链长 200 字符、最多 16 项 —— 防御超长输入，不做通用代数。
 */

export type LengthChainDraft =
  | { kind: "fixedLength"; targets: string[]; value: number }
  | { kind: "equalLength"; targets: string[] }
  /**
   * **两段之比**。`splitPoint` 是**来源**，不是从形状猜的（2026-10-27，§4.7）：
   * `AB=2BC=4` 与 `DE=2EA` 的 targets 形状一模一样（`[A,B,B,C]` / `[D,E,E,A]`，中间点名重复），
   * 但卷面上是两件事 —— 前者是"两条边的长度比"，**不**蕴含 `B` 在 `AC` 上；后者是定比分点。
   * 判据见 `diagramVerification` 的 `segmentRatio` 支：只有 `true` 才要求那个点在两外点之间。
   */
  | { kind: "segmentRatio"; targets: string[]; value: number; splitPoint: boolean }

export type LengthChain =
  | { ok: true; start: number; end: number; sourceText: string; drafts: LengthChainDraft[] }
  | { ok: false; start: number; end: number; sourceText: string; reason: string }

const SEGMENT = `${POINT_NAME_SOURCE}${POINT_NAME_SOURCE}`
/** 系数：`2`、`2.5`、`2/3`（分数按有理数处理，见文件头）。 */
const COEFFICIENT_SOURCE = "([0-9]+(?:\\.[0-9]+)?)(?:\\s*[/⁄]\\s*([0-9]+(?:\\.[0-9]+)?))?"
const TERM_SOURCE = `(?:${COEFFICIENT_SOURCE}\\s*)?(${SEGMENT})`
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

interface Coefficient {
  numerator: number
  denominator: number
}

interface Term {
  segment: [string, string]
  coefficient: Coefficient
}

function parseTerm(text: string): Term | null {
  // `|AB|` 这种绝对值记法在卷面上等同于线段长度；两侧的竖线不是判据的一部分。
  const match = TERM.exec(text.trim().replace(/^\|+|\|+$/g, ""))
  if (match === null) return null
  const names = splitPointNames(match[3]!)
  if (names.length !== 2) return null
  const numerator = match[1] === undefined ? 1 : Number(match[1])
  const denominator = match[2] === undefined ? 1 : Number(match[2])
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null
  if (!(numerator > 0) || !(denominator > 0)) return null
  return { segment: [names[0]!, names[1]!], coefficient: { numerator, denominator } }
}

/** `c₁·L₁ = c₂·L₂` 用有理数比较，避免 `2/3` 与 `0.666…` 的浮点抖动。 */
function sameCoefficient(left: Coefficient, right: Coefficient): boolean {
  return left.numerator * right.denominator === right.numerator * left.denominator
}

/** `L₁ / L₂`（有理数交叉相乘，先乘后除）。 */
function lengthRatio(left: Term, right: Term): number {
  return (right.coefficient.numerator * left.coefficient.denominator) / (right.coefficient.denominator * left.coefficient.numerator)
}

/** `L = V / c`（同样先乘后除）。 */
function resolvedLength(term: Term, value: number): number {
  return (value * term.coefficient.denominator) / term.coefficient.numerator
}

function relationsOf(terms: readonly Term[], value: number | null): LengthChainDraft[] {
  const drafts: LengthChainDraft[] = []
  for (const [index, term] of terms.entries()) {
    if (value !== null) {
      const resolved = resolvedLength(term, value)
      if (!Number.isFinite(resolved) || !(resolved > 0)) continue
      drafts.push({ kind: "fixedLength", targets: [...term.segment], value: resolved })
    }
    const next = terms[index + 1]
    if (next === undefined) continue
    if (sameCoefficient(term.coefficient, next.coefficient)) {
      drafts.push({ kind: "equalLength", targets: [...term.segment, ...next.segment] })
    } else {
      // c₁L₁ = c₂L₂ ⇒ L₁ / L₂ = c₂ / c₁
      /**
       * **链上有绝对长度锚点 ⇒ 这是尺寸陈述，不是定比分点**（2026-10-27，§4.7）：
       * `AB=2BC=4` 说的是"两条边分别 4 与 2"，`B` 在不在 `AC` 上题面没说；
       * 而**没有锚点**的 `DE=2EA` 正是卷面上的定比分点写法（`E` 被这个比定位在 `DA` 上）。
       * 这个标志只影响判据要不要"同时要求共线"，不影响比值。
       */
      drafts.push({ kind: "segmentRatio", targets: [...term.segment, ...next.segment], value: lengthRatio(term, next), splitPoint: value === null })
    }
  }
  return drafts
}

/**
 * 把一句从句按括号切成窗口，**括号内外都留下**（`（即 AB=BC=1）` 里的等式是真条件）。
 * `offset` 是窗口在从句里的起点，用来把链的区间映射回原文。
 */
function bracketWindows(clause: string): { text: string; offset: number }[] {
  const windows: { text: string; offset: number }[] = []
  let start = 0
  for (let index = 0; index < clause.length; index += 1) {
    if (!/[（）()]/.test(clause[index]!)) continue
    if (index > start) windows.push({ text: clause.slice(start, index), offset: start })
    start = index + 1
  }
  if (start < clause.length) windows.push({ text: clause.slice(start), offset: start })
  return windows
}

/**
 * **表达式段的边界**：中文与标点是"另一个条件开始了"的信号。
 *
 * 为什么不能只按 `[^=]+` 切：`∠A=60°且AB=AC=2` 里两条条件写在同一从句，
 * 按 `=` 贪心切会把它当成一条怪等式；按中文切则各自成段。
 */
const SEGMENT_BOUNDARY = /[\u4e00-\u9fff，。；;、：:,（）()【】[\]]/

/** 起点左边**紧挨着**这些字符 ⇒ 这段数学比"一条长度连等"更大（负号、乘除整式、系数残留）。 */
const LEFT_OPERATOR = /[A-Za-z0-9+\-−×·*/=^().]/

/**
 * **这个名字/记号还没念完**：`△ABC`、`∠ABC`、`P-ABCD`、`AA₁` 里的 `AB` 不是一条线段的起点。
 *
 * 判据只看紧挨着的那个字符：字母、数字、撇号、下标、`∠`、`△` 都说明前面还有东西；
 * `P-ABCD` 这种**顶点区间**再看一格（`-` 前是点名）。
 *
 * 为什么必须挡：漏挡会让 `P-ABCD` 被当成一条"读不懂的连等"记进未核验，
 * 真正的未核验从句（`二面角E-BC-D=45`）反而被切碎。`-AB=…` 不在此列 ——
 * 它前面没有点名，那个 `-` 是真负号（见 `LEFT_OPERATOR`）。
 */
function insideNameToken(text: string, at: number): boolean {
  if (at === 0) return false
  const previous = text[at - 1]!
  if (/[A-Za-z0-9′'₀-₉∠△▲◺°]/.test(previous)) return true
  if (previous === "-" && at >= 2 && /[A-Za-z′'₀-₉]/.test(text[at - 2]!)) return true
  return false
}

/** 幂 / 平方这类写法不是长度连等：`AB²=4`、`AB^2=4` 交给残留扫描如实报"未核验"。 */
const NOT_A_LENGTH_CHAIN = /[²³¹⁰⁴-⁹^]/

/**
 * 找出题面里所有**长度连等链**。返回的顺序与出现顺序一致。
 *
 * 只处理以"线段项"开头的 `=` 链；单段长度、冒号比例、角度等式都不在这里。
 * 扫描方式是"从每个线段项起，往右看到表达式边界"：这样得到的区间**正好是表达式本身**，
 * 才能判断"它前面是否还有符号"和"它后面是否还接着算符"。
 */
export function parseLengthChains(prompt: string): LengthChain[] {
  const out: LengthChain[] = []
  // 先按标点切成从句，再从句里找 `=` 链：跨从句的链没有数学意义。
  for (const clause of prompt.matchAll(/[^，,。；;\n]+/g)) {
    const clauseStart = clause.index ?? 0
    for (const window of bracketWindows(clause[0])) {
      const windowText = window.text
      const windowStart = clauseStart + window.offset
      let consumedUpTo = 0
      const startScan = new RegExp(TERM_SOURCE, "g")
      for (const candidate of windowText.matchAll(startScan)) {
        const segmentStart = candidate.index
        if (segmentStart < consumedUpTo) continue
        // 名字没念完（`P-ABCD` / `∠ABC` / `AA₁`）：这一处不是线段表达式的起点。
        if (insideNameToken(windowText, segmentStart)) {
          consumedUpTo = segmentStart + candidate[0].length
          continue
        }
        // 往左吃掉紧贴着的算符/字母/数字：`-AB=…` 的起点是 `-`，不是 `AB`。
        // `|` 是**定界符**不是算子（`|AB|=3`）：吃进来但不算"前面有算符"。
        let expressionStart = segmentStart
        let crossedOperator = false
        while (expressionStart > 0) {
          const previous = windowText[expressionStart - 1]!
          if (LEFT_OPERATOR.test(previous)) {
            expressionStart -= 1
            crossedOperator = true
            continue
          }
          if (previous === "|") {
            expressionStart -= 1
            continue
          }
          break
        }
        // 往右看到中文/标点为止：这一段就是"一个表达式"。
        let expressionEnd = segmentStart + candidate[0].length
        while (expressionEnd < windowText.length && !SEGMENT_BOUNDARY.test(windowText[expressionEnd]!)) expressionEnd += 1
        // 句末标点不属于表达式：`则SA=.` 是留空的问句，不是一条读不懂的连等。
        const rawSegment = windowText.slice(expressionStart, expressionEnd).trim().replace(/[.。、；;]+$/, "")
        if (rawSegment.length === 0 || rawSegment.length > MAX_CHAIN_LENGTH) continue
        const record = (reason: string, text: string): void => {
          out.push({
            ok: false,
            start: windowStart + expressionStart,
            end: windowStart + expressionStart + text.length,
            sourceText: text,
            reason
          })
        }

        // 角度写法不是长度连等：`∠ABC=60°`、`∠ABC=∠DEF` 留给角度读取器与残留扫描。
        if (/[∠°]/.test(rawSegment) || NOT_A_LENGTH_CHAIN.test(rawSegment)) {
          consumedUpTo = expressionEnd
          continue
        }

        // 起点前面还接着算符（`-AB=…` / `2=AB=…`）：整条落未核验，绝不舍掉符号从中间读。
        // 只是 `|` 定界符（`|AB|=3`）不算 —— 那是绝对值记法，交给既有读取器。
        if (crossedOperator && rawSegment.includes("=")) {
          record(`等式前面还有算符或系数，本层不解析这类整式，也不取其中一段（「${rawSegment}」）。`, rawSegment)
          consumedUpTo = expressionEnd
          continue
        }

        const pieces = rawSegment.split("=").map((piece) => piece.trim())
        if (pieces.length < 2) {
          consumedUpTo = expressionEnd
          continue
        }
        if (pieces.length > MAX_TERMS + 1) {
          record(`连等项过多（>${MAX_TERMS}），本轮不解析。`, rawSegment)
          consumedUpTo = expressionEnd
          continue
        }

        const terms: Term[] = []
        let value: number | null = null
        let failure: string | null = null
        let notOurChain = false
        for (const [index, piece] of pieces.entries()) {
          const isLast = index === pieces.length - 1
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
            /**
             * 这一段里有字母（点名）⇒ 它确实是一条长度表达式，只是**本层不支持这种整式**：
             * 整条报未核验。没有字母（`x`、`π`）⇒ 不是长度连等，交回既有读取器与残留扫描。
             */
            if (terms.length > 0 || /[A-Za-z]/.test(piece)) failure = `无法识别连等中的「${piece}」：本层只解析线段与数值的连等，这类整式保留为未核验。`
            else notOurChain = true
            break
          }
          if (!(number > 0) || !Number.isFinite(number)) {
            failure = `长度必须是有限正数，收到「${piece}」。`
            break
          }
          value = number
        }
        consumedUpTo = expressionEnd
        if (notOurChain) continue
        if (failure !== null) {
          record(failure, rawSegment)
          continue
        }
        // 只有一段线段 + 一个数值：那是单段长度，交给既有读取器。
        if (terms.length < 2) continue
        if (terms.length === pieces.length) value = null
        out.push({
          ok: true,
          start: windowStart + expressionStart,
          end: windowStart + expressionStart + rawSegment.length,
          sourceText: rawSegment,
          drafts: relationsOf(terms, value)
        })
      }
    }
  }
  return out
}
