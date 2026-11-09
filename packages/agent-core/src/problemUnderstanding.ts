import type { AnswerKind } from "./answerResult"
import type { GeometryObligation } from "./claimEvidence"
import { parseDiagramObligations, type DiagramObligation, type DiagramObligationSet } from "./diagramObligations"
import { splitNumberedProblem } from "./numberedProblem"
import { buildObligationIR, recognizeObligationText, type ConditionUsage, type GoalContext, type ObligationIR } from "./obligationIR"

/**
 * **题意层（W3 / T3，2026-11-08）**。
 *
 * 它只回答两件事：**原题给了什么、问了什么**。不求值、不写文档、也不把模型候选当题设。
 *
 * ## 为什么另建一层而不是再写一个 parser
 *
 * 条件仍然由 `parseDiagramObligations` 读（同一张句型表、同一套 span），这一层只在它周围补三样
 * 它目前不提供的东西：
 * 1. **逐问目标**（合并问句拆开、①②/(1)(2) 分作用域、状态与依赖）；
 * 2. **辅助点定义**（`E是C在AB上的垂足` 这类 parser 还没读的构造句）归到 `construction`；
 * 3. **条件消费清单**：每条条件被哪个求解器、为哪几问消费；没被消费的显式标出来。
 *
 * ## span 的纪律
 *
 * 所有 `start/end` 都是**用户原文**的 UTF-16 下标，且 `prompt.slice(start,end) === sourceText`。
 * 这里刻意**不先规范化**再解析：规范化会改变下标，而"可追溯"一旦混用两套下标就是假的。
 * 规范化文本与原文的映射留给需要它的调用方；这一层只对原文负责。
 *
 * ## 不做的事
 *
 * - 不把 `B'` 里的撇号当成"折后状态"的证据（状态只从 `折前/折后/折起后` 这类明文读）；
 * - 不从选项或"常见版本"补条件（那是 T6/T7 的受控重读与澄清，不是题意层）；
 * - 不把模型自选的坐标写成题设（`free_choice` 与 `given` 的角色由 parser 给，这里不改）。
 */

export interface ProblemConsumption {
  obligationId: string
  /** 报告消费这条条件的求解器（例如 `rectangleFold` / `mathAnswerVerification`）。 */
  solver: string
  /** 这条条件被用来支撑哪几问（可选；求解器知道才写）。 */
  goalIds?: readonly string[]
}

export interface ProblemUnderstandingInput {
  prompt: string
  /** 题面修订标识；goalId 与证据引用都以它为作用域。 */
  problemRevision: string
  /** 求解器已经消费过的条件（可选）；没有报告的条件一律 `unprocessed`。 */
  consumed?: readonly ProblemConsumption[]
}

export interface ProblemUnderstanding {
  ir: ObligationIR
  goals: GoalContext[]
  usage: ConditionUsage[]
  /** span 的单位声明：JavaScript 字符串下标（UTF-16 code units）。 */
  sourceUnit: "utf16"
}

interface Scope {
  partId: string
  start: number
  end: number
  text: string
}

interface GoalFragment {
  /** 原文里**连续**的那一段（span 与 sourceText 以它为准）。 */
  base: string
  /** 语义上的完整问法（合并问句时共享的单位会补回来）。 */
  display: string
  start: number
  end: number
  /** 由 `求证` / `画出` 这类标记给定的答案类型（优先于文本推断）。 */
  forcedKind?: AnswerKind
}

/** 合并问句共享的单位后缀：`求 a 与 b 的长度` 里 `的长度` 同时属于两边。 */
const UNIT_SUFFIX = /(的长度|的长|的距离|的周长|的面积|的体积|的度数|的正弦值|的余弦值|的大小)$/

/** 目标标记：按长到短排列，`求出` 不能被 `求` 抢先匹配。 */
const GOAL_MARKER = /(求证|试证|证明|求出|求得|判断|计算|画出|作出|作图|绘制|创建|建立|建一个|建造|求)/g

/** 句子边界（不消费分隔符本身）。 */
const SENTENCE_END = /[。；;！!？?\n]/g

/** 辅助点定义：`E 是/为 C 在 AB 上的垂足`。 */
const FOOT_DEFINITION = /(?:设\s*)?([A-Z])\s*(?:是|为)\s*([A-Z])\s*在\s*([A-Z])\s*([A-Z])\s*上的垂足/g

function sentenceRanges(text: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = []
  let cursor = 0
  for (const match of text.matchAll(SENTENCE_END)) {
    ranges.push({ start: cursor, end: match.index })
    cursor = match.index + match[0].length
  }
  if (cursor <= text.length) ranges.push({ start: cursor, end: text.length })
  return ranges.filter((range) => range.end > range.start)
}

function trimmedFragment(text: string, start: number): { text: string; start: number; end: number } {
  const leading = /^\s*/.exec(text)?.[0].length ?? 0
  const trimmed = text.trim()
  const clean = trimmed.replace(/[\s，,；;：:。.、]*并?[\s，,；;：:。.、]*$/u, "")
  return { text: clean, start: start + leading, end: start + leading + clean.length }
}

/**
 * 合并问句拆分：`AB 的长与 CD 的长` → 两问；共享单位（`的长度`）补到前面那几问的**语义文本**里。
 * 只有每一段都像"在问一个对象"时才拆，否则原样保留（宁可不拆，也不要把一句话切成半句）。
 */
function splitMergedClause(text: string, baseStart: number): GoalFragment[] {
  if (!/[与和、]/.test(text)) return [{ base: text, display: text, start: baseStart, end: baseStart + text.length }]

  const pieces: { text: string; start: number }[] = []
  let cursor = 0
  for (const match of text.matchAll(/[与和、]/gu)) {
    pieces.push({ text: text.slice(cursor, match.index), start: cursor })
    cursor = match.index + match[0].length
  }
  pieces.push({ text: text.slice(cursor), start: cursor })

  const trimmed = pieces.map((piece) => {
    const leading = /^\s*/.exec(piece.text)?.[0].length ?? 0
    const value = piece.text.trim()
    return { text: value, start: baseStart + piece.start + leading }
  }).filter((piece) => piece.text.length > 0)

  if (trimmed.length < 2) return [{ base: text, display: text, start: baseStart, end: baseStart + text.length }]
  // 每一段都要像在问一个对象（有点名或单位）。否则 `求 f(x) 的长和面积` 会被切成"面积"单独一问。
  const looksLikeQuestion = (value: string) => /[A-Za-z0-9]/.test(value) || UNIT_SUFFIX.test(value)
  if (!trimmed.every((piece) => looksLikeQuestion(piece.text))) return [{ base: text, display: text, start: baseStart, end: baseStart + text.length }]

  const unit = UNIT_SUFFIX.exec(trimmed[trimmed.length - 1]!.text)
  return trimmed.map((piece, index) => {
    const display = unit !== null && index < trimmed.length - 1 && !UNIT_SUFFIX.test(piece.text) ? `${piece.text}${unit[1]}` : piece.text
    return { base: piece.text, display, start: piece.start, end: piece.start + piece.text.length }
  })
}

/** 从一段作用域文本里找出目标片段（相对下标）。 */
function goalFragments(text: string): GoalFragment[] {
  const fragments: GoalFragment[] = []
  for (const sentence of sentenceRanges(text)) {
    const markers = [...text.slice(sentence.start, sentence.end).matchAll(GOAL_MARKER)].map((match) => ({
      index: match.index + sentence.start,
      length: match[0].length,
      marker: match[1]!
    }))
    for (const [index, marker] of markers.entries()) {
      const clauseStart = marker.index + marker.length
      const clauseEnd = markers[index + 1]?.index ?? sentence.end
      const clause = trimmedFragment(text.slice(clauseStart, clauseEnd), clauseStart)
      if (clause.text.length === 0) continue
      const forcedKind: AnswerKind | undefined = marker.marker === "求证" || marker.marker === "证明" || marker.marker === "试证"
        ? "proof"
        : marker.marker === "画出" || marker.marker === "作出" || marker.marker === "作图" || marker.marker === "绘制" || marker.marker === "创建" || marker.marker === "建立" || marker.marker === "建一个" || marker.marker === "建造"
          ? "drawing"
          : undefined
      for (const fragment of splitMergedClause(clause.text, clause.start)) {
        fragments.push({ ...fragment, ...(forcedKind === undefined ? {} : { forcedKind }) })
      }
    }
  }
  return fragments
}

/** 目标问的是什么东西 → 期望的答案类型（宿主据此选验收方式，不据此判断对错）。 */
function answerKindOf(text: string, forced?: AnswerKind): AnswerKind {
  if (forced !== undefined) return forced
  if (/证明|求证|恒成立|恒为|恒有|对任意|任意.*都/.test(text)) return "proof"
  if (/画出|作图|作出|画图/.test(text)) return "drawing"
  if (/取值范围|范围/.test(text)) return "interval"
  if (/选(?:出|择)?|选项|[ABCD]\s*[.．、]/.test(text)) return "single_choice"
  if (/长度|距离|面积|体积|周长|角度|度数|多少|值为|值$|长$/.test(text)) return "numeric"
  return "unknown"
}

/** 只从明文读折前/折后；撇号只是点名，不作为状态证据。 */
function foldStateOf(text: string): string {
  if (/折前|折叠前|翻转前/.test(text)) return "s0"
  if (/折后|折起后|翻折后|折叠后|翻转后|旋转后/.test(text)) return "s1"
  return "s0"
}

function pointNamesOf(text: string): string[] {
  const names: string[] = []
  for (const match of text.matchAll(/[A-Z](?:[′']|₁|₂|₃)?/gu)) {
    if (!names.includes(match[0])) names.push(match[0])
  }
  return names
}

function scopesOf(prompt: string): Scope[] {
  const numbered = splitNumberedProblem(prompt)
  if (numbered === null) return [{ partId: "stem", start: 0, end: prompt.length, text: prompt }]
  return [
    { partId: "stem", start: 0, end: numbered.parts[0]!.start, text: numbered.stem },
    ...numbered.parts.map((part) => ({ partId: `part-${part.number}`, start: part.start, end: part.end, text: part.text }))
  ]
}

function partIdAt(scopes: readonly Scope[], start: number, end: number): string {
  for (const scope of scopes) {
    if (start >= scope.start && end <= scope.end) return scope.partId
    // 跨作用域的条件（极少见）归到它起点所在的那一段，而不是猜一个"公共"。
    if (start >= scope.start && start < scope.end) return scope.partId
  }
  return "stem"
}

function dedupeObligations(obligations: readonly DiagramObligation[]): DiagramObligation[] {
  const seen = new Set<string>()
  const result: DiagramObligation[] = []
  for (const obligation of obligations) {
    const key = `${obligation.kind}|${obligation.start}|${obligation.end}|${obligation.targets.join(",")}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(obligation)
  }
  return result
}

/** `由(1)知` / `根据第2问` → 依赖第 n 问的全部目标。 */
function earlierPartReferences(text: string): number[] {
  const parts: number[] = []
  for (const match of text.matchAll(/(?:由|根据|利用|在)\s*(?:第)?\s*[（(]?\s*(\d)\s*[）)]?\s*(?:问|小问|的条件)?/gu)) {
    const number = Number(match[1])
    if (Number.isInteger(number) && number > 0 && !parts.includes(number)) parts.push(number)
  }
  return parts
}

export function understandProblem(input: ProblemUnderstandingInput): ProblemUnderstanding {
  const prompt = input.prompt
  const whole = parseDiagramObligations(prompt)
  const scopes = scopesOf(prompt)

  /**
   * **逐作用域读条件**：①②/(1)(2) 的小问条件不能都算公共题设。
   *
   * 用**空格补齐前缀**而不是直接拼原文：补齐后长度与原文一致，于是 spans 不需要平移；
   * 同时 `parseDiagramObligations` 看不到小问标记，不会再次走"各小问条件"的分支。
   */
  const scopedGivens: DiagramObligation[] = [...whole.givens]
  const scopedUnverified: DiagramObligationSet["unverified"] = [...whole.unverified]
  if (scopes.length > 1) {
    for (const scope of scopes.slice(1)) {
      const scoped = parseDiagramObligations(" ".repeat(scope.start) + scope.text)
      scopedGivens.push(...scoped.givens.filter((item) => item.start >= scope.start && item.end <= scope.end))
      scopedUnverified.push(...scoped.unverified.map((entry) => ({ ...entry })))
    }
  }

  const goals: GoalContext[] = []
  const goalObligations: GeometryObligation[] = []
  const goalsByPart = new Map<string, string[]>()
  for (const scope of scopes) {
    for (const fragment of goalFragments(scope.text)) {
      const start = scope.start + fragment.start
      const end = scope.start + fragment.end
      if (start === end) continue
      const sourceText = prompt.slice(start, end)
      if (sourceText !== fragment.base) {
        // 合并问句里补出来的单位不在原文里：span 仍指向原文那段，文本必须逐字相等。
        continue
      }
      const recognized = recognizeObligationText(sourceText)
      const targets = recognized === null ? pointNamesOf(fragment.base) : [...new Set([...recognized.targets, ...pointNamesOf(fragment.base)])]
      const goalId = `${input.problemRevision}:goal:${start}-${end}:${goals.length}`
      goalObligations.push({
        id: goalId,
        role: "goal",
        kind: recognized?.kind ?? "proposition",
        sourceText,
        start,
        end,
        targets,
        judgeability: "unsupported"
      })
      goals.push({
        goalId,
        partId: scope.partId,
        source: { sourceId: input.problemRevision, start, end },
        stateId: foldStateOf(fragment.display),
        dependsOnGoalIds: [],
        expectedKind: answerKindOf(fragment.display, fragment.forcedKind)
      })
      const existing = goalsByPart.get(scope.partId) ?? []
      existing.push(goalId)
      goalsByPart.set(scope.partId, existing)
    }
  }

  // 显式引用更早小问才建立依赖（不是"按顺序全都依赖"）。
  for (const goal of goals) {
    const obligation = goalObligations.find((item) => item.id === goal.goalId)!
    goal.dependsOnGoalIds = earlierPartReferences(obligation.sourceText)
      .flatMap((number) => goalsByPart.get(`part-${number}`) ?? [])
      .filter((goalId) => goalId !== goal.goalId)
  }

  /**
   * **辅助点定义**：parser 目前不读 `垂足` 这类构造句，所以这里补一个保守的识别器。
   * 它只做一件事：把这句标成 `construction`，并保留原文跨度 —— 不替它断言垂直关系。
   */
  const constructions: GeometryObligation[] = []
  const occupied = [...scopedGivens, ...goalObligations]
  for (const match of prompt.matchAll(FOOT_DEFINITION)) {
    const start = match.index
    const end = start + match[0].length
    if (occupied.some((item) => item.start < end && start < item.end)) continue
    const [point, from, a, b] = [match[1]!, match[2]!, match[3]!, match[4]!]
    constructions.push({
      id: `construction-${constructions.length}`,
      role: "construction",
      kind: "foot",
      sourceText: match[0],
      start,
      end,
      targets: [point, from, a, b],
      judgeability: "unsupported"
    })
  }

  const legacy: DiagramObligationSet = {
    givens: dedupeObligations(scopedGivens),
    goals: [],
    freeChoices: [...whole.freeChoices],
    ...(whole.freeChoiceSources === undefined ? {} : { freeChoiceSources: whole.freeChoiceSources }),
    unverified: scopedUnverified
  }
  const base = buildObligationIR(legacy)
  const obligations = [...base.obligations, ...constructions, ...goalObligations]

  const usage = conditionUsage({ obligations, scopes, consumed: input.consumed ?? [], unverified: base.unverified, goals, prompt })
  return {
    ir: { obligations, unverified: base.unverified, goals, usage },
    goals,
    usage,
    sourceUnit: "utf16"
  }
}

/**
 * **条件消费清单**：每条题设条件一条记录。
 *
 * 判据刻意保守：**没有报告就是没消费**（`unprocessed`），而不是默认"应该用过了"。
 * 未知条件与歧义条件各有各的状态，避免界面把"没读懂"显示成"验过了"。
 */
function conditionUsage(input: {
  obligations: readonly GeometryObligation[]
  scopes: readonly Scope[]
  consumed: readonly ProblemConsumption[]
  unverified: readonly { sourceText: string; reason: string }[]
  goals: readonly GoalContext[]
  prompt: string
}): ConditionUsage[] {
  const consumers = new Map<string, ProblemConsumption[]>()
  for (const record of input.consumed) {
    const list = consumers.get(record.obligationId) ?? []
    list.push(record)
    consumers.set(record.obligationId, list)
  }

  const usage: ConditionUsage[] = []
  for (const obligation of input.obligations) {
    if (obligation.role === "goal") continue
    const reports = consumers.get(obligation.id) ?? []
    consumers.delete(obligation.id)
    const consumedBy = [...new Set(reports.map((record) => record.solver))]
    const requiredForGoalIds = [...new Set(reports.flatMap((record) => record.goalIds ?? []))]
    const partId = partIdAt(input.scopes, obligation.start, obligation.end)
    const disposition = consumedBy.length > 0
      ? "used"
      : obligation.role === "free_choice" || obligation.judgeability === "unsupported"
        ? "unsupported"
        : obligation.judgeability === "ambiguous"
          ? "ambiguous"
          : "unprocessed"
    const explanation = consumedBy.length > 0
      ? `由 ${consumedBy.join("、")} 消费。`
      : obligation.role === "free_choice"
        ? "这是模型自选的取值/坐标，不是题设条件；没有求解器把它当作题设使用。"
        : obligation.judgeability === "unsupported"
          ? "没有任何可用的判据能核验这条条件。"
          : obligation.judgeability === "ambiguous"
            ? "解析存在歧义，不同核验器可能给出不同结论。"
            : "没有求解器报告消费这条条件。"
    usage.push({
      obligationId: obligation.id,
      requiredForGoalIds,
      consumedBy,
      disposition,
      explanation,
      partId,
      conditionSourceText: obligation.sourceText
    })
  }

  // 求解器报告了一个题意层不存在的 id：不静默丢掉，留一条显式失败。
  for (const [obligationId, reports] of consumers) {
    usage.push({
      obligationId,
      requiredForGoalIds: [...new Set(reports.flatMap((record) => record.goalIds ?? []))],
      consumedBy: [...new Set(reports.map((record) => record.solver))],
      disposition: "unsupported",
      explanation: "求解器报告消费了题意层不存在的条件 id：这属于消费记录与题意层不一致。"
    })
  }

  for (const [index, entry] of input.unverified.entries()) {
    const at = input.prompt.indexOf(entry.sourceText)
    usage.push({
      obligationId: `unverified-${index}`,
      requiredForGoalIds: [],
      consumedBy: [],
      disposition: "unsupported",
      explanation: `未读懂的条件「${entry.sourceText}」：${entry.reason}`,
      ...(at < 0 ? {} : { partId: partIdAt(input.scopes, at, at + entry.sourceText.length), conditionSourceText: entry.sourceText })
    })
  }

  return usage
}
