import { canonicalPointName } from "@draw/geometry-kernel"

import { parseDiagramObligations } from "./diagramObligations"
import { parseLengthChains } from "./lengthEquality"

/**
 * **题面规范化通道**（设计 `docs/superpowers/specs/2026-10-10-prompt-normalisation-design.md`）。
 *
 * ## 它解决什么
 *
 * 用户写的是课本中文：`PA⊥底面 ABCD`、`AD=2AB=2`、`设 …（即 …）`。解析器认不出时，**原来是把活
 * 推给用户**（"请改用受支持的条件表达"）—— 而换说法本来就是语言模型该干的活。
 *
 * ## 它**不许**做什么（这是整个模块存在的理由）
 *
 * **模型只换说法，不许改条件。** 让模型自由改写，它就有动机把 `AB⊥AD` 改写成自己能画的样子，
 * 于是图还是错的、门禁却全绿 —— 本仓吃过最大的亏正是"一张错图静默通过全部门禁"。
 * 所以每一条改写都要过三道阀门，任何一道不过就**丢掉那一条**（连带原因一起如实摆出来）：
 *
 * 1. `original` 必须是用户**原文**里逐字出现的一个片段，而且必须命中一条"我们记过未核验"的从句
 *    —— 不许凭空挑一句来改；
 * 2. `normalized` 里**不许出现原文没有的点名** —— 不许编造新对象；
 * 3. **关系词不许换族**（`⊥` 只能是 `⊥`/垂直，`∥` 只能是 `∥`/平行，`=` 只能是等号那一族，
 *    中点只能是中点）—— 把"垂直"改成"不平行"这类弱化一律拒；
 * 4. 改写之后**必须能被同一个解析器读成至少一条条件** —— 读不出就不算数。
 *
 * 过了阀门的改写只做一件事：**替换题面里那一段**，然后照旧走同一条解析与核验路径
 *（判据永远在内核，不在模型嘴里）。
 */

export interface UnreadClause {
  /** 我们没读懂的那段原文。 */
  sourceText: string
  /** 我们给出的原因（原样给模型看，免得它猜我们缺什么）。 */
  reason: string
}

export interface NormalisationCandidate {
  /** 原文里逐字出现的一段话。 */
  original: string
  /** 同一件事的标准写法。 */
  normalized: string
}

export interface NormalisationReport {
  /** 被接受的改写（`givens` 是改写后被读到几条条件）。 */
  accepted: (NormalisationCandidate & { givens: number })[]
  /** 被拒的改写与原因 —— 如实摆出来，不静默丢。 */
  rejected: (NormalisationCandidate & { reason: string })[]
}

/** 一次最多收几条改写：题面里的"读不懂"通常两三条，多了就是模型在乱写。 */
const MAX_CLAUSES = 8

/**
 * 关系词族：**改写不许换族**。写成表而不是写成一串 if，是为了让"哪些算同一个族"只有一处定义。
 */
const RELATION_FAMILIES: readonly { name: string; pattern: RegExp }[] = [
  { name: "perpendicular", pattern: /⊥|垂直/ },
  { name: "parallel", pattern: /∥|平行/ },
  { name: "equality", pattern: /=|等于|等长|长度相等|相等/ },
  { name: "midpoint", pattern: /中点/ }
]

/**
 * **点名语法只有一条来源**（A2.6，2026-10-26）：原来这里写 `[A-Z]`，于是
 * `AB` 被看成两个名字（巧合上没错），而 `A′` / `A₁` 会被看成 `A` ——
 * 模型把 `B` 改写成 `B′` 时，"原文没有这个点名"这条阀门**看不见**。
 * 现在按项目既有的撇号/下标词法取词，并用 `canonicalPointName` 归一（`'` 与 `′` 同一个名字）。
 */
const POINT_NAME_RUN = /[A-Z](?:[′'’´ʹʼ`]|[₁₂₃₄₅₆]){0,2}/g

const pointNamesOf = (text: string): Set<string> =>
  new Set([...text.matchAll(POINT_NAME_RUN)].map((match) => canonicalPointName(match[0])))

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parsedReply(reply: unknown): unknown {
  if (typeof reply !== "string") return reply
  try {
    return JSON.parse(reply)
  } catch {
    return null
  }
}

/** 交给模型的那两段话。**把原文与"我们读不懂的片段"一起给它**，并要求逐条指回原文。 */
export function buildNormalisationPrompt(prompt: string, unread: readonly UnreadClause[]): { system: string; user: string } {
  return {
    system: [
      "有一道中文数学题，我们的解析器有几处读不懂。请你把这些片段改写成我们能读的标准写法。",
      "**不许改条件**：不许新增、删除或弱化任何条件，只换说法。",
      "每一条给两个字段：`original` 必须是用户**原文**里逐字出现的一个片段，`normalized` 是同一件事的标准写法。",
      "标准写法的例子：`PA⊥底面 ABCD` → `PA⊥平面 ABCD`；`AD=2AB=2` 里后置的长度单写成 `AD=2`；",
      "`（即 …）` 这类重述从句照抄即可（里面的等式我们照旧会读）。",
      "只回一个 JSON：{\"clauses\":[{\"original\":\"…\",\"normalized\":\"…\"}]}。",
      "读不懂的片段**不要写这一条**，也不要编一个条件出来 —— 我们宁可继续问你。"
    ].join("\n"),
    user: ["用户原文：", prompt, "", "我们读不懂的片段：", ...unread.map((entry) => `- ${entry.sourceText}（${entry.reason}）`)].join("\n")
  }
}

/** 逐条过阀门；不过的就进 `rejected`（带原因）。**任何一条不过都不影响别的条目**。 */
/**
 * **长度语义的规范形**（A2，2026-10-26）：只在能证明等价时才允许改写。
 *
 * 三种结果，缺一不可：
 * - `notLength`：这段不是长度条件（垂直、中点、角度…），或混着别族/别处读不懂的片段
 *   —— 交给下面那道"关系词族"阀门，不在这里冒充"等价已证明"；
 * - `unreadable`：**它确实是长度表达式，但我们读不完整**（连等整条被拒、固定值自相矛盾、
 *   比例闭环矛盾）⇒ **不许**比较，更不许跳过检查直接采纳；
 * - `ok`：给出与写法无关的规范形。
 *
 * 规范形不是"原文的字符串"，而是**约束本身**：
 * - 有绝对长度的连通分量：列出分量里每段的长度（等长/比例由定长蕴含，不必重复列）；
 * - 没有绝对长度的分量：列出**所有无序点对的比值**（`eq:` / `ratio:`），于是
 *   `AB=BC=CD` 与 `BC=CD，AB=BC` 得到同一个规范形；
 * - 比例方向归一到 `比值 ≥ 1`，数值按 9 位小数比较；
 * - 点名**成对**参与（`AB=CD` 与 `AD=BC` 不是一回事），不做"四个字母排序"那种会撞车的键。
 */
type LengthReading =
  | { status: "notLength" }
  | { status: "unreadable"; reason: string }
  | { status: "ok"; signature: string[] }

const LENGTH_KINDS = new Set(["fixedLength", "equalLength", "segmentRatio"])

function round9(value: number): number {
  return Number(value.toFixed(9))
}

/** `targets` 是"线段对"的平铺（`A,B` ⇒ `AB`；四条点名 ⇒ 两条线段）。 */
function segmentPairs(targets: readonly string[]): string[] {
  const segments: string[] = []
  for (let index = 0; index + 1 < targets.length; index += 2) segments.push(`${targets[index]}${targets[index + 1]}`)
  return segments
}

function readLengthSemantics(text: string): LengthReading {
  // 连等层"整条拒绝"是最强的信号：它说明这段确实是长度表达式，只是读不出。
  const rejected = parseLengthChains(text).find((chain) => !chain.ok)
  if (rejected !== undefined && !rejected.ok) return { status: "unreadable", reason: rejected.reason }

  const parsed = parseDiagramObligations(text)
  const lengths = parsed.givens.filter((given) => LENGTH_KINDS.has(given.kind))
  if (lengths.length === 0) return { status: "notLength" }
  // 同一句里混着别族条件（`AB=2，∠A=60°`）：差异可能不在长度上，不做长度等价声明。
  if (lengths.length !== parsed.givens.length) return { status: "notLength" }
  // 还有读不懂的片段（例如 `AD:AB=1` 这种今天的读取器不覆盖的比例写法）：
  // 既不能声明等价，也不该把"别的写法读不出"当成"长度改坏了" —— 交给旧阀门。
  if (parsed.unverified.length > 0) return { status: "notLength" }

  const links: { a: string; b: string; factor: number }[] = []
  const fixed: { segment: string; value: number }[] = []
  for (const given of lengths) {
    if (given.kind === "fixedLength" && given.value !== undefined) {
      const segment = segmentPairs(given.targets)[0]
      if (segment === undefined) return { status: "unreadable", reason: "固定长度缺少端点" }
      const value = Number(given.value)
      if (!Number.isFinite(value) || !(value > 0)) return { status: "unreadable", reason: `固定长度 ${segment} 不是有限正数` }
      fixed.push({ segment, value })
      continue
    }
    if (given.kind === "equalLength") {
      const [first, second] = segmentPairs(given.targets)
      if (first === undefined || second === undefined) return { status: "unreadable", reason: "等长条件缺少端点" }
      if (first === second) continue
      links.push({ a: first, b: second, factor: 1 })
      continue
    }
    if (given.kind === "segmentRatio" && given.value !== undefined) {
      const [first, second] = segmentPairs(given.targets)
      if (first === undefined || second === undefined) return { status: "unreadable", reason: "比例条件缺少端点" }
      const factor = Number(given.value)
      if (!Number.isFinite(factor) || !(factor > 0)) return { status: "unreadable", reason: "比例值不是有限正数" }
      links.push({ a: first, b: second, factor })
    }
  }

  // 连通分量里"长度按什么比例连着"：BFS 给每个点一个相对参考值（L = scale · L_root）。
  const adjacency = new Map<string, { to: string; factor: number }[]>()
  const ensure = (name: string): { to: string; factor: number }[] => {
    const existing = adjacency.get(name)
    if (existing !== undefined) return existing
    const fresh: { to: string; factor: number }[] = []
    adjacency.set(name, fresh)
    return fresh
  }
  for (const { segment } of fixed) ensure(segment)
  for (const link of links) {
    ensure(link.a).push({ to: link.b, factor: link.factor })
    ensure(link.b).push({ to: link.a, factor: 1 / link.factor })
  }

  const placement = new Map<string, { root: string; scale: number }>()
  for (const start of adjacency.keys()) {
    if (placement.has(start)) continue
    placement.set(start, { root: start, scale: 1 })
    const queue = [start]
    while (queue.length > 0) {
      const current = queue.shift()!
      const currentPlacement = placement.get(current)!
      for (const edge of adjacency.get(current) ?? []) {
        // `L_current = factor · L_to` ⇒ 相对参考值反着走要除。
        const expected = currentPlacement.scale / edge.factor
        const seen = placement.get(edge.to)
        if (seen === undefined) {
          placement.set(edge.to, { root: start, scale: expected })
          queue.push(edge.to)
          continue
        }
        if (Math.abs(seen.scale - expected) > 1e-9 * Math.max(1, Math.abs(expected))) {
          return { status: "unreadable", reason: `比例闭环矛盾（${current} 与 ${edge.to}）` }
        }
      }
    }
  }

  // 绝对长度钉到分量上；同一个分量被钉了两个不同值 ⇒ 原文自相矛盾。
  const rootValue = new Map<string, number>()
  for (const { segment, value } of fixed) {
    const at = placement.get(segment)
    if (at === undefined) return { status: "unreadable", reason: `固定长度 ${segment} 没有进入比例图` }
    const rootLength = value / at.scale
    const existing = rootValue.get(at.root)
    if (existing !== undefined && Math.abs(existing - rootLength) > 1e-9 * Math.max(1, Math.abs(rootLength))) {
      return { status: "unreadable", reason: `固定长度自相矛盾（${segment}）` }
    }
    rootValue.set(at.root, rootLength)
  }

  const components = new Map<string, string[]>()
  for (const name of adjacency.keys()) {
    const at = placement.get(name)!
    const members = components.get(at.root) ?? []
    members.push(name)
    components.set(at.root, members)
  }

  const signature: string[] = []
  for (const members of components.values()) {
    members.sort()
    const root = placement.get(members[0]!)!.root
    const pinned = rootValue.get(root)
    if (pinned !== undefined) {
      for (const member of members) {
        const value = pinned * placement.get(member)!.scale
        if (!Number.isFinite(value) || !(value > 0)) return { status: "unreadable", reason: `长度 ${member} 不是有限正数` }
        signature.push(`len:${member}=${round9(value)}`)
      }
      continue
    }
    for (let left = 0; left < members.length; left += 1) {
      for (let right = left + 1; right < members.length; right += 1) {
        const first = members[left]!
        const second = members[right]!
        const ratio = placement.get(first)!.scale / placement.get(second)!.scale
        if (Math.abs(ratio - 1) <= 1e-9) {
          signature.push(`eq:${first}|${second}`)
        } else if (ratio > 1) {
          signature.push(`ratio:${first}/${second}=${round9(ratio)}`)
        } else {
          signature.push(`ratio:${second}/${first}=${round9(1 / ratio)}`)
        }
      }
    }
  }
  return { status: "ok", signature: signature.sort() }
}

function sameSemantics(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index])
}

export function parseNormalisationReply(reply: unknown, prompt: string, unread: readonly UnreadClause[]): NormalisationReport {
  const parsed = parsedReply(reply)
  const clauses = isRecord(parsed) && Array.isArray(parsed.clauses) ? parsed.clauses : null
  if (clauses === null) return { accepted: [], rejected: [] }

  const accepted: NormalisationReport["accepted"] = []
  const rejected: NormalisationReport["rejected"] = []
  const promptNames = pointNamesOf(prompt)

  for (const entry of clauses.slice(0, MAX_CLAUSES)) {
    if (!isRecord(entry) || typeof entry.original !== "string" || typeof entry.normalized !== "string") continue
    const original = entry.original.trim()
    const normalized = entry.normalized.trim()
    const reject = (reason: string): void => {
      rejected.push({ original, normalized, reason })
    }
    if (original.length === 0 || normalized.length === 0) {
      reject("空的 original / normalized 不算改写。")
      continue
    }
    if (!prompt.includes(original)) {
      reject("original 不是原文里逐字出现的片段，无法确认它在说哪一句。")
      continue
    }
    if (!unread.some((clause) => clause.sourceText.includes(original) || original.includes(clause.sourceText))) {
      reject("这一句并没有被记为未核验，不需要改写。")
      continue
    }
    const invented = [...pointNamesOf(normalized)].filter((name) => !promptNames.has(name))
    if (invented.length > 0) {
      reject(`改写引入了原文没有的点名：${invented.join("、")}。`)
      continue
    }
    const weakened = RELATION_FAMILIES.filter((family) => family.pattern.test(original) && !family.pattern.test(normalized))
    if (weakened.length > 0) {
      reject(`改写把关系换弱了（${weakened.map((family) => family.name).join("、")}）：条件不许改。`)
      continue
    }
    /**
     * **原文读不完整 ⇒ 不许声称等价**（A2.1）。
     *
     * 旧写法只在"原文能读出语义"时才比较，于是 `AB=AC=0`（连等被整条拒绝）这一侧
     * 返回 `null`，检查被**跳过**，模型改写出的 `AB=AC` 被当成合法 —— 那正好把
     * "0 长度"这条矛盾条件洗成了"两边相等"。现在这一侧直接拒绝。
     */
    const originalReading = readLengthSemantics(original)
    if (originalReading.status === "unreadable") {
      reject(`原文的长度条件无法完整读取（${originalReading.reason}），不能证明改写等价 —— 保留原题。`)
      continue
    }
    if (originalReading.status === "ok") {
      const normalizedReading = readLengthSemantics(normalized)
      if (normalizedReading.status !== "ok" || !sameSemantics(originalReading.signature, normalizedReading.signature)) {
        const after = normalizedReading.status === "ok"
          ? normalizedReading.signature.join("、")
          : normalizedReading.status === "unreadable"
            ? `读不完整：${normalizedReading.reason}`
            : "没有可比较的长度语义"
        reject(`改写改变了长度/比例条件（原文 ${originalReading.signature.join("、")}；改写后 ${after}）。条件不许改值或删减。`)
        continue
      }
    }
    const givens = parseDiagramObligations(normalized).givens.length
    if (givens === 0) {
      reject("改写之后我们仍然读不出条件。")
      continue
    }
    accepted.push({ original, normalized, givens })
  }
  return { accepted, rejected }
}

export interface AppliedNormalisation {
  candidate: NormalisationCandidate
  start: number
  end: number
}

export interface SkippedNormalisation {
  candidate: NormalisationCandidate
  reason: string
}

export interface NormalisationApplication {
  text: string
  applied: AppliedNormalisation[]
  /** 没被采用的条目与原因 —— 重叠、重复原文、定位不到，都如实摆出来。 */
  skipped: SkippedNormalisation[]
}

/**
 * 用被接受的改写**替换原文里那几段**（其余一个字不动）。
 *
 * **绑定原文区间**（A2.7 / A2.8）：旧实现按顺序 `result.replace(original, normalized)`，
 * 于是 ① 每次都只换**第一次**出现的位置、② 前一次替换会改变后一次的位置。
 * 现在分三步：
 * 1. 先在**原文**里枚举每个候选的**所有**出现位置；
 * 2. 逐个认领**互不重叠**的区间（重复原文各认领一次；认领不到如实进 `skipped`）；
 * 3. 最后**从右往左**按原区间替换 —— 左边的偏移不受右边替换影响。
 */
export function applyNormalisationWithReport(prompt: string, accepted: readonly NormalisationCandidate[]): NormalisationApplication {
  const chosen: AppliedNormalisation[] = []
  const skipped: SkippedNormalisation[] = []
  const occurrencesOf = (text: string): number[] => {
    const out: number[] = []
    let from = 0
    while (from <= prompt.length) {
      const at = prompt.indexOf(text, from)
      if (at < 0) break
      out.push(at)
      from = at + 1
    }
    return out
  }
  const overlaps = (start: number, end: number, span: AppliedNormalisation): boolean => start < span.end && span.start < end

  for (const entry of accepted) {
    const occurrences = occurrencesOf(entry.original)
    if (occurrences.length === 0) {
      skipped.push({ candidate: entry, reason: "原文里找不到这一段（可能在解析之后被别的改写覆盖了）。" })
      continue
    }
    const free = occurrences.find((start) => !chosen.some((span) => overlaps(start, start + entry.original.length, span)))
    if (free !== undefined) {
      chosen.push({ candidate: entry, start: free, end: free + entry.original.length })
      continue
    }
    /**
     * **所有出现位置都被占了**：这通常意味着它与另一条改写**重叠**
     *（`AB=AC` vs `AB=AC=2`）。此时两条都不采用 —— 只应用其中一条会把另一条改成
     * "半截文本"（`AB=AC（等长）=2`），那正是"串改位置"。
     */
    const conflicting = chosen.filter((span) =>
      occurrences.some((start) => overlaps(start, start + entry.original.length, span))
      && span.candidate.original !== entry.original
    )
    if (conflicting.length > 0) {
      const reason = "与另一条改写重叠，两条都不采用（保留原文，避免串改位置）。"
      for (const span of conflicting) {
        chosen.splice(chosen.indexOf(span), 1)
        skipped.push({ candidate: span.candidate, reason })
      }
      skipped.push({ candidate: entry, reason })
      continue
    }
    skipped.push({ candidate: entry, reason: "原文里这一段的出现次数不够，重复的改写不采用。" })
  }

  let result = prompt
  for (const span of [...chosen].sort((left, right) => right.start - left.start)) {
    result = result.slice(0, span.start) + span.candidate.normalized + result.slice(span.end)
  }
  return { text: result, applied: chosen, skipped }
}

export function applyNormalisation(prompt: string, accepted: readonly NormalisationCandidate[]): string {
  return applyNormalisationWithReport(prompt, accepted).text
}
