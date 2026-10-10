import { parseDiagramObligations } from "./diagramObligations"

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

const pointNamesOf = (text: string): Set<string> => new Set(text.match(/[A-Z]/g) ?? [])

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
    const givens = parseDiagramObligations(normalized).givens.length
    if (givens === 0) {
      reject("改写之后我们仍然读不出条件。")
      continue
    }
    accepted.push({ original, normalized, givens })
  }
  return { accepted, rejected }
}

/**
 * 用被接受的改写**替换原文里那几段**（其余一个字不动）。
 *
 * 只替换命中的片段，不做任何整体重写 —— 题面被"改得面目全非"是这条通道最危险的失效方式之一。
 */
export function applyNormalisation(prompt: string, accepted: readonly NormalisationCandidate[]): string {
  let result = prompt
  for (const entry of accepted) result = result.replace(entry.original, entry.normalized)
  return result
}
