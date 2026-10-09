import { canonicalPointName, isPointName, splitPointNames } from "@draw/geometry-kernel"

/**
 * **入口语法**（S6；设计 §3.2 的第一层）：自然语言 → 形状描述。
 *
 * 这一层的职责窄且硬：**只认形状说法本身**（哪一族、底面环是谁、顶点 / 顶环是谁），
 * 认不出就返回 `null`，由规划器问路 —— 设计 §6 的纪律是"**认不出就问路**"优先于"多认一句"。
 *
 * ## 认什么
 *
 * `在[正|斜|直]?[三四五六]?（棱锥|棱柱|棱台）<点名表>中`，点名表按 `-` 分成两段：
 * - **棱锥**：前半是顶点（`P-ABCD`），后半是底面环；
 * - **棱柱 / 棱台**：前半是底面环，后半是顶面环（`ABCD-A′B′C′D′`）。
 *
 * 逐条核，任何一条不成立都返回 `null`：
 * - 每个名字都必须是本仓的**点名**（用 `pointNames` 的同一份定义，含 `A′` / `A₁` / `A′′`）；
 * - 底面环 3–6 个点名（内核 `deriveBasePolygon` 的上界）；
 * - 中文数词若写了（`四棱锥`）必须**等于**环长 —— 写"四棱锥"却给 5 个点名是题面自相矛盾；
 * - 棱柱 / 棱台的顶环必须与底环**逐一对应**（`A′` 对应 `A`，与内核 `withPrimes` 和 S4.2 是**同一条规则**）。
 *
 * ## 不认什么（两条都是**有意**的）
 *
 * - **球与多面体的关系**（`在球O中…`）：S5 还没落地。认一个现在**造不出来**的形状，
 *   只会把"做不到"推后到更深的层，那时错误信息离用户更远。
 * - **没有 `在…中` 从句的说法**（`底面边长 2 的棱柱，AB垂直AD`）：没有点名表就产不出 spec，
 *   而"替用户编一套点名"正是本仓最忌讳的悄悄改题。这类说法继续走既有夹具。
 *
 * ## 为什么放在 agent-core，而不是 apps/web
 *
 * 离线本地规划器（`apps/web`）与离线 benchmark 的见证层必须共用**同一份**解析，
 * 否则两个读数不可比 —— 设计 §3.2 的账。
 */

export type RecognisedFamily = "pyramid" | "prism" | "frustum"

/**
 * **立体图形的修饰词**（S3 斜棱柱那一刀）：`正`（正棱柱 / 正棱锥）、`斜`（斜棱柱）、`直`（直棱柱）。
 *
 * 它必须**读得出来**而不是被正则吃掉：`斜三棱柱 + AA′⊥平面ABC` 是自相矛盾的题面，
 * 而"下游看不见修饰词"会让这种句子被**静默画成直棱柱**（题面说斜、系统画直）——
 * 那正是本仓最忌的"悄悄换一个题面没说的形状"。
 */
export type ShapeModifier = "正" | "斜" | "直"

export interface RecognisedShape {
  family: RecognisedFamily
  /** 题面里那段"在…中"的**原文**（给面板与日志用，不改写题面）。 */
  phrase: string
  /** 底面环，按题面点名顺序。 */
  base: string[]
  /** 棱锥：锥顶（`P-ABCD` 的 `P`）。 */
  apex?: string
  /** 棱柱 / 棱台：顶面环（`ABCD-A′B′C′D′` 的后半）。 */
  top?: string[]
  /** 题面写的修饰词；**没写就是 `undefined`**（不许默认成"直"）。 */
  modifier?: ShapeModifier
}

/** 中文数词 → 边数。只收首批范围内的 3–6。 */
const NUMERALS: Record<string, number> = { 三: 3, 四: 4, 五: 5, 六: 6 }

/**
 * `在…中` 从句。点名表里**允许**撇 / 下标 / `-` 这些字符，但不允许空白与标点 ——
 * 遇到空白或逗号就说明点名表在那里结束了。
 */
const SHAPE_CLAUSE = /在\s*(正|斜|直)?\s*([三四五六])?\s*(棱锥|棱柱|棱台)\s*([A-Z][^\s，,。；;、]*?)\s*中/

const DASH = /[-−—–]/

/** 内核底面环的上界（`deriveBasePolygon`）：超出就不是我们做得出的形状。 */
const MIN_RING = 3
const MAX_RING = 6

function ringOf(segment: string): string[] | null {
  const names = splitPointNames(segment)
  if (names.length < MIN_RING || names.length > MAX_RING) return null
  return names.every((name) => isPointName(name)) ? names : null
}

/**
 * 认形状说法。**认不出返回 `null`**（= 问路），不抛异常、不改写题面。
 */
export function parseShapeClause(prompt: string): RecognisedShape | null {
  if (typeof prompt !== "string") return null
  const match = SHAPE_CLAUSE.exec(prompt)
  if (match === null) return null
  const [, modifier, numeral, keyword, nameList] = match
  if (keyword === undefined || nameList === undefined) return null
  const stated = modifier === undefined ? {} : { modifier: modifier as ShapeModifier }

  const parts = nameList.split(DASH).map((part) => part.trim())
  if (parts.length !== 2) return null
  const [head, tail] = parts as [string, string]

  if (keyword === "棱锥") {
    const apexNames = splitPointNames(head)
    if (apexNames.length !== 1) return null
    const apex = apexNames[0]!
    if (!isPointName(apex)) return null
    const base = ringOf(tail)
    if (base === null) return null
    // 锥顶不能同时是底面顶点：`A-ABCD` 这种写法自相矛盾。
    if (base.includes(apex)) return null
    if (numeral !== undefined && NUMERALS[numeral] !== base.length) return null
    return { family: "pyramid", phrase: match[0], base, apex, ...stated }
  }

  const base = ringOf(head)
  const top = ringOf(tail)
  if (base === null || top === null) return null
  if (numeral !== undefined && NUMERALS[numeral] !== base.length) return null
  /**
   * **顶环与底环逐一对应**：`A′` 对应 `A`。这里用 `canonicalPointName` 归一，
   * 所以 `A'`（ASCII 撇）与 `A′` 是同一个名字的两种字形，都能认。
   * 对应不上就**不认**（`ABCD-A′C′B′D′` 这类）：内核在构造前还会再核一次（S4.2），
   * 但"认不出"要在这里就说清楚，别让用户等到构造期。
   */
  if (top.length !== base.length) return null
  for (const [index, name] of top.entries()) {
    const foot = base[index]
    if (foot === undefined || canonicalPointName(name) !== `${canonicalPointName(foot)}′`) return null
  }
  return { family: keyword === "棱柱" ? "prism" : "frustum", phrase: match[0], base, top, ...stated }
}
