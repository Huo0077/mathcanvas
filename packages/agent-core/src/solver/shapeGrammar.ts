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

export type RecognisedFamily = "pyramid" | "prism" | "frustum" | "planar-figure"

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

/** 下标字形（`A₁` 那一笔）。`pointNames` 的同一套后缀，只收 1–6。 */
const SUBSCRIPT_DIGITS: Record<string, string> = { 1: "₁", 2: "₂", 3: "₃", 4: "₄", 5: "₅", 6: "₆" }

/**
 * **有边界的下标归一**（T2）：`A_1` / `A_{1}` → `A₁`。
 *
 * 只做**排版字形**这一件事，不碰 ASCII `A1`：`A1` 在 `pointNames` 里**不是点名**
 * （2026-10-07 的裁决），它必须留在"读不出"那一侧，不能被这里顺手凑成 `A₁`。
 *
 * 两处边界：
 * - `A_10` 不归一（`_1` 后面还跟着数字 —— 那不是一个合法的 1–6 下标）；
 * - 只认 `_` 引导的下标写法，不碰别的字符。
 */
function normalizeSubscriptTypography(text: string): string {
  return text
    .replace(/_\{([1-6])\}/g, (_match, digit: string) => SUBSCRIPT_DIGITS[digit] ?? digit)
    .replace(/_([1-6])(?![0-9])/g, (_match, digit: string) => SUBSCRIPT_DIGITS[digit] ?? digit)
}

/**
 * `在…中` 从句。点名表里**允许**撇 / 下标 / `-` 这些字符，但不允许空白与标点 ——
 * 遇到空白或逗号就说明点名表在那里结束了。
 *
 * **T2 补的三种写法**（设计 §4.2 第 1 步"入口只归一排版，不改题意"）：
 * - **「在」可省**：`四棱锥P-ABCD中` 是联考题里最常见的写法；
 * - **可插入底面描述**：`以直角梯形ABCD为底面的四棱锥P-ABCD中`（限 24 字，不吞后续题设）；
 * - **下标/撇号归一**由 `normalizeSubscriptTypography` 先做，正则只认字形结果。
 */
const SHAPE_CLAUSE =
  /(?:在\s*)?(?:以[^\s，,。；;]{1,24}?为底面(?:的)?\s*)?(正|斜|直)?\s*([三四五六])?\s*(棱锥|棱柱|棱台)\s*([A-Z][^\s，,。；;、]*?)\s*中/


/**
 * **裸的平面图形**（2026-10-11 用户现场；乙案 Task 1）：`平面四边形ABCD中` / `三角形ABC中`。
 *
 * 为什么单独一条：`SHAPE_CLAUSE` 要求 `棱锥 | 棱柱 | 棱台`，所以"平面四边形 ABCD"这类
 * **只有点名、没有立体家族**的题面在词表里**没有分支接它** ⇒ `specForPrompt` 返回
 * `unrecognised` ⇒ 构造从未发生（探针实测：那句题面八个从句全读得懂，图上却只有 A、E、F、P）。
 *
 * **`平面` 二字可省**，多边形名必须与环长对得上（与立体那一支同一条纪律：
 * 数词与环长不符就问路，不替用户编一套）。
 *
 * ## `Rt` / `直角` 与 `△`（2026-10-15 用户现场）
 *
 * 现场那句 `Rt△ABC 中，∠C=90°，AC=3，BC=4。` **一条都没认出来**（`Rt` 是修饰词、`△` 是
 * 三角形的符号，而这里只收"三角形"三个字）⇒ 环不存在 ⇒ `∠C=90°` 落成
 * "题面里没有可识别的形状从句（点名环）…不知道是哪两条边"。
 *
 * **只认环**：`Rt△ABC` 这种写法本身**不说**直角在哪个顶点（题面下一句才说 `∠C=90°`），
 * 凭 `Rt` 猜一个顶点就是替题面编条件 —— 所以这一层**不产出任何角度**，直角照旧由题面那句读。
 */
const PLANAR_CLAUSE = /(?:Rt|直角)?\s*(?:平面)?\s*(四边形|三角形|△|五边形|六边形)\s*([A-Z][^\s，,。；;、]*?)\s*中/

const DASH = /[-−—–]/

/** 内核底面环的上界（`deriveBasePolygon`）：超出就不是我们做得出的形状。 */
const MIN_RING = 3
const MAX_RING = 6

function ringOf(segment: string): string[] | null {
  const names = splitPointNames(segment)
  if (names.length < MIN_RING || names.length > MAX_RING) return null
  if (!names.every((name) => isPointName(name))) return null
  /** 同一个点在一个环里出现两次：这是自相矛盾的题面（`P-ABCA`），不猜它想说什么。 */
  if (new Set(names.map((name) => canonicalPointName(name))).size !== names.length) return null
  return names
}

/**
 * **顶环与底环的对应后缀**（T2）：一致则返回那个后缀，说不清返回 `null`。
 *
 * 此前这里只认 `A′` 一种字形，于是题面写 `ABC-A₁B₁C₁`（联考卷排版里极常见）时整句返回 `null`。
 * 现在的判据是**"底环点名 + 同一个后缀"**，后缀可以是撇或下标 1–6：
 *
 * - 后缀必须**逐一相同**：`A₁B′C₁` 这类混写说不清是哪一套对应关系，问路；
 * - 后缀**原样保留**：`A₁B₁C₁` 就是 `A₁B₁C₁`，内核不许用默认 `A′` 覆盖题面已给的名字
 *   （设计 §4.3"不让默认 `A′` 覆盖已给 `A₁`"）。
 */
function topRingSuffix(base: readonly string[], top: readonly string[]): string | null {
  if (top.length !== base.length) return null
  const allowed = ["′", "₁", "₂", "₃", "₄", "₅", "₆"]
  let suffix: string | null = null
  for (const [index, name] of top.entries()) {
    const foot = base[index]
    if (foot === undefined) return null
    const seen = canonicalPointName(name)
    const root = canonicalPointName(foot)
    if (!seen.startsWith(root)) return null
    const tail = seen.slice(root.length)
    if (!allowed.includes(tail)) return null
    if (suffix === null) suffix = tail
    else if (suffix !== tail) return null
  }
  return suffix
}

/**
 * 识别「平面四边形ABCD」这类**裸的平面图形**从句（乙案 Task 1）。
 *
 * 与立体那一支**同一条纪律**：多边形名必须与环长对得上（`四边形` 却给 5 个点名 ⇒ 问路），
 * 认不出返回 `null`，不抛异常、不改写题面。
 *
 * 返回的形状只有 `base`（环）是必填的：平面图形没有锥顶、没有顶环、没有立体修饰词，
 * 那三个字段留 `undefined` —— **不编一个**。
 */
function parsePlanarClause(prompt: string): RecognisedShape | null {
  const match = PLANAR_CLAUSE.exec(prompt)
  if (match === null) return null
  const [, keyword, nameList] = match
  if (keyword === undefined || nameList === undefined) return null
  // `△` 是三角形的符号（2026-10-15）：它没有数词可读，环长按 3 判 —— 与"三角形"同一个数。
  const expected = keyword === "△" ? 3 : NUMERALS[keyword[0]!]
  if (expected === undefined) return null
  const base = ringOf(nameList)
  if (base === null || base.length !== expected) return null
  return { family: "planar-figure", phrase: match[0], base }
}

/**
 * 认形状说法。**认不出返回 `null`**（= 问路），不抛异常、不改写题面。
 */
export function parseShapeClause(prompt: string): RecognisedShape | null {
  if (typeof prompt !== "string") return null
  const match = SHAPE_CLAUSE.exec(normalizeSubscriptTypography(prompt))
  /**
   * **立体那一支找不到时，才试平面图形那一支。**
   *
   * 顺序是刻意的：立体家族的识别**逐字不变**（既有的 17 条用例是护栏），
   * 新分支只在"原来看不见的那种题面"上生效。
   */
  if (match === null) return parsePlanarClause(prompt)
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
  if (topRingSuffix(base, top) === null) return null
  return { family: keyword === "棱柱" ? "prism" : "frustum", phrase: match[0], base, top, ...stated }
}
