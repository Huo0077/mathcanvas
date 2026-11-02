/**
 * **明确给出的球 / 棱柱条件**：只读用户原话里写出来的字段。
 *
 * 这一层存在的原因是同一个读取规则必须被**规划器与编译器共用**：
 * 规划器不能把球心坐标里的数字当半径，编译器也不能在读取失败后悄悄退回默认值。
 * 规则只写一遍，两个调用点拿到的就是同一份“读到了什么 / 为什么没读到”。
 *
 * 支持的数值写法是**刻意收窄**的：十进制小数、`√3`、`2√3`、`π`、`2π`。
 * 科学计数法与分数本轮**明确拒绝**（而不是截成前一个数），因为“把 1e999 读成 1”
 * 比“说清不支持”更糟。
 */

export interface ExplicitVector3 {
  x: number
  y: number
  z: number
}

export type ExplicitValueStatus = "absent" | "parsed" | "invalid"

export interface ExplicitValue<T> {
  status: ExplicitValueStatus
  value?: T
  /** 题面里的原话片段（用于核对与面板文案）。 */
  sourceText?: string
  /** `invalid` 时说出具体原因；`absent` 与 `parsed` 不带。 */
  reason?: string
}

export type ExplicitSolidField = "sphere.center" | "sphere.radius" | "prism.baseEdge" | "prism.height" | "prism.shape"

export interface ExplicitSolidIssue {
  field: ExplicitSolidField
  reason: string
  sourceText: string
}

export interface ExplicitSphereConditions {
  requested: boolean
  center: ExplicitValue<ExplicitVector3>
  radius: ExplicitValue<number>
}

export interface ExplicitPrismShape {
  /** 底面的边数；`undefined` 表示题面没写。 */
  sides?: number
  /** 题面写了“正”：底面必须是正多边形。 */
  regular?: boolean
  /** `true` = 直棱柱；“false” = 斜棱柱；`undefined` = 题面没写。 */
  straight?: boolean
}

export interface ExplicitPrismConditions {
  requested: boolean
  baseEdge: ExplicitValue<number>
  height: ExplicitValue<number>
  shape: ExplicitPrismShape
}

export interface ExplicitSolidConditions {
  sphere: ExplicitSphereConditions
  prism: ExplicitPrismConditions
  issues: ExplicitSolidIssue[]
}

/** 尺寸 / 坐标的上限：超过它就不再假装能画出一个有意义的图。 */
const MAX_EXPLICIT_MAGNITUDE = 1_000_000

const ABSENT = <T>(): ExplicitValue<T> => ({ status: "absent" })
const INVALID = <T>(reason: string, sourceText = ""): ExplicitValue<T> => ({ status: "invalid", reason, sourceText })
const PARSED = <T>(value: T, sourceText: string): ExplicitValue<T> => ({ status: "parsed", value, sourceText })

function parseDecimal(text: string): number | null {
  const normalized = text.replace(/[\u3000\u00a0]/g, " ").trim().replace(/[−–]/g, "-")
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

function parseCartesianComponent(text: string): number | null {
  const value = parseDecimal(text)
  if (value === null) return null
  return Math.abs(value) <= MAX_EXPLICIT_MAGNITUDE ? value : null
}

interface NumericParse {
  ok: boolean
  value?: number
  reason?: string
}

/**
 * 把一个**完整**数值 token 求值。调用方负责先扫出一个尽量长的 token，
 * 所以 `1e999` / `1/2` 不会被截成 `1` 再往下走。
 */
function parseNumericToken(raw: string): NumericParse {
  const compact = raw.replace(/[\u3000\u00a0]/g, " ").trim().replace(/[−–]/g, "-")
  if (compact.length === 0) return { ok: false, reason: "后面没有数值。" }
  if (/\d\s*[eE]/.test(compact)) return { ok: false, reason: "不支持科学计数法；请写成普通小数。" }
  if (compact.includes("/")) return { ok: false, reason: "不支持分数；请写成小数。" }
  if (/[×*÷^²³⁰¹⁴⁵⁶⁷⁸⁹]/.test(compact)) return { ok: false, reason: "不支持乘法 / 幂运算表达式；请先算出数值。" }
  if (/[+-]/.test(compact.slice(1))) return { ok: false, reason: "不支持加减表达式；请先算出数值。" }
  if (/[a-zA-Z₀-₉%°±]/.test(compact)) return { ok: false, reason: "数值写法无法识别（不支持带字母、单位或符号后缀）。" }

  let value: number | null
  const pi = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))?\s*π$/.exec(compact)
  if (pi !== null) {
    const coefficient = pi[1] === undefined ? 1 : Number(pi[1])
    value = Number.isFinite(coefficient) ? coefficient * Math.PI : null
  } else {
    const radical = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))?\s*√\s*(\d+(?:\.\d*)?|\.\d+)$/.exec(compact)
    if (radical !== null) {
      const coefficient = radical[1] === undefined ? 1 : Number(radical[1])
      const radicand = Number(radical[2])
      value = Number.isFinite(coefficient) && Number.isFinite(radicand) && radicand > 0
        ? coefficient * Math.sqrt(radicand)
        : null
      if (value === null) return { ok: false, reason: "根式写法不完整或根号下不是正数。" }
    } else if (compact.includes("√") || compact.includes("π")) {
      return { ok: false, reason: "根式 / π 的写法无法识别（支持 √3、2√3、π、2π）。" }
    } else {
      value = parseDecimal(compact)
      if (value === null) return { ok: false, reason: "数值写法无法识别。" }
    }
  }

  if (value === null || !Number.isFinite(value)) return { ok: false, reason: "数值超出可表示范围。" }
  if (Math.abs(value) > MAX_EXPLICIT_MAGNITUDE) {
    return { ok: false, reason: `数值过大（上限 ${MAX_EXPLICIT_MAGNITUDE}）。` }
  }
  return { ok: true, value }
}

function parsePositiveDimension(raw: string): NumericParse {
  const parsed = parseNumericToken(raw)
  if (!parsed.ok) return parsed
  if (parsed.value === undefined || !(parsed.value > 0)) return { ok: false, reason: "尺寸必须是正数。" }
  return parsed
}

interface Occurrence {
  /** 标签起点（在整句里的下标）。 */
  start: number
  /** 标签终点。 */
  end: number
  sourceText: string
}

function occurrences(prompt: string, pattern: RegExp): Occurrence[] {
  const found: Occurrence[] = []
  for (const match of prompt.matchAll(pattern)) {
    found.push({ start: match.index, end: match.index + match[0].length, sourceText: match[0] })
  }
  return found
}

/** 跳过标签与数值之间的空白与“为 / 是 / = / ：”等连接词。 */
function skipValueSeparator(prompt: string, from: number): { at: number; separator: boolean } {
  const rest = prompt.slice(from)
  const match = /^\s*(?:为|是|等于|在|位于|=|：|:)\s*/.exec(rest)
  if (match !== null) return { at: from + match[0].length, separator: true }
  const spaces = /^\s*/.exec(rest)?.[0].length ?? 0
  return { at: from + spaces, separator: false }
}

interface ScannedToken {
  token: string
  end: number
}

/**
 * 从 `start` 起扫一个**尽量长**的数值 token，并返回去除尾部空白后的原文切片终点 `end`。
 *
 * “尽量长”是重点：`半径 1e999` 必须扫成 `1e999`，不能扫成 `1`；`半径 1/2`、`半径 2²`、`半径 5cm` 同理。
 */
function scanNumericToken(prompt: string, start: number): ScannedToken {
  let index = start
  let token = ""
  while (index < prompt.length) {
    const character = prompt[index]!
    /**
     * **完整词法边界**：数字、空白、空格变体、未支持运算符、上下标指数与紧随其后的 ASCII 字母/符号
     * 都先吃进来，交给 `parseNumericToken` 统一拒绝；遇到中文字段名 / 标点才结束。
     * 这样 `1 / 2` 不会在空格处被截成 `1`，`2 π` 不会被截成 `2`，`2²` / `5a` 也不会被截成 `2` 或 `5`。
     */
    if (/[0-9eE+\-./√π×*÷^\s\u3000\u00a0−–²³⁰¹⁴⁵⁶⁷⁸⁹₀-₉a-zA-Z%°±]/.test(character)) {
      token += character
      index += 1
      continue
    }
    break
  }
  let end = index
  while (end > start && /[\s\u3000\u00a0]/.test(prompt[end - 1]!)) end -= 1
  return { token: token.replace(/[−–]/g, "-").trim(), end }
}

interface ResolvedOccurrence<T> {
  value: T
  sourceText: string
}

/**
 * 合并同一字段的多次出现：没有出现 = `absent`；全部一致 = `parsed`；
 * 有无法读取 / 互相矛盾 = `invalid`。默认值只能落在 `absent` 上。
 */
function resolveOccurrences<T>(
  prompt: string,
  found: readonly Occurrence[],
  read: (token: string) => NumericParse | { ok: true; value: T; reason?: undefined }
): ExplicitValue<T> {
  if (found.length === 0) return ABSENT()
  const parsed: ResolvedOccurrence<T>[] = []
  for (const occurrence of found) {
    const { at } = skipValueSeparator(prompt, occurrence.end)
    const { token, end } = scanNumericToken(prompt, at)
    if (token.length === 0) {
      /**
       * **写了字段名却没有值不是“未提供”**（2026-11-01 泛化验收）。
       *
       * `画一个斜棱柱，高` 如果当成 absent，默认值就会接手 —— 用户明明已经开始指定高度，
       * 系统却画了一只高 3 的棱柱。这里必须落成 invalid，由规划器澄清。
       */
      return INVALID<T>("后面没有数值。", occurrence.sourceText)
    }
    const rawSlice = prompt.slice(occurrence.start, end).trim()
    const result = read(token)
    if (!result.ok) return INVALID<T>(result.reason ?? "数值无法读取。", rawSlice)
    parsed.push({ value: result.value as T, sourceText: rawSlice })
  }
  if (parsed.length === 0) return ABSENT()
  const first = parsed[0]!
  for (const entry of parsed.slice(1)) {
    if (!sameValue(first.value, entry.value)) {
      return INVALID<T>(
        `重复给出且数值互相矛盾：${formatValue(first.value)} 与 ${formatValue(entry.value)}。`,
        parsed.map((item) => item.sourceText).join("；")
      )
    }
  }
  return PARSED(first.value, first.sourceText)
}

function sameValue<T>(left: T, right: T): boolean {
  if (typeof left === "number" && typeof right === "number") return Math.abs(left - right) <= 1e-12 * Math.max(1, Math.abs(left), Math.abs(right))
  if (isVector(left) && isVector(right)) return (["x", "y", "z"] as const).every((axis) => Math.abs(left[axis] - right[axis]) <= 1e-12 * Math.max(1, Math.abs(left[axis]), Math.abs(right[axis])))
  return false
}

function isVector(value: unknown): value is ExplicitVector3 {
  if (value === null || typeof value !== "object") return false
  const vector = value as Partial<ExplicitVector3>
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z)
}

function formatValue(value: unknown): string {
  return isVector(value) ? `(${value.x}, ${value.y}, ${value.z})` : String(value)
}

function readCenter(prompt: string): ExplicitValue<ExplicitVector3> {
  const found = occurrences(prompt, /球心/g)
  if (found.length === 0) return ABSENT()
  const parsed: ResolvedOccurrence<ExplicitVector3>[] = []
  for (const occurrence of found) {
    const { at, separator } = skipValueSeparator(prompt, occurrence.end)
    const rest = prompt.slice(at)
    if (/^原点/.test(rest)) {
      parsed.push({ value: { x: 0, y: 0, z: 0 }, sourceText: prompt.slice(occurrence.start, at + 2).trim() })
      continue
    }
    const coordinate = /^[（(]\s*([^,，)）]+)\s*[,，]\s*([^,，)）]+)\s*[,，]\s*([^,，)）]+)\s*[)）]/.exec(rest)
    if (coordinate === null) {
      if (separator || rest.startsWith("(") || rest.startsWith("（")) {
        return INVALID<ExplicitVector3>("球心需要三个坐标，例如 (1,2,3) 或“原点”。", occurrence.sourceText)
      }
      return INVALID<ExplicitVector3>("球心后没有可读的坐标或“原点”。", occurrence.sourceText)
    }
    const rawSlice = prompt.slice(occurrence.start, at + coordinate[0].length).trim()
    const values = coordinate.slice(1, 4).map((part) => parseCartesianComponent(part))
    if (values.some((value) => value === null)) {
      return INVALID<ExplicitVector3>("球心坐标只能是十进制实数（可带负号）。", rawSlice)
    }
    parsed.push({ value: { x: values[0]!, y: values[1]!, z: values[2]! }, sourceText: rawSlice })
  }
  const first = parsed[0]!
  for (const entry of parsed.slice(1)) {
    if (!sameValue(first.value, entry.value)) {
      return INVALID<ExplicitVector3>(
        `球心重复给出且坐标互相矛盾：${formatValue(first.value)} 与 ${formatValue(entry.value)}。`,
        parsed.map((item) => item.sourceText).join("；")
      )
    }
  }
  return PARSED(first.value, first.sourceText)
}

function radiusOccurrences(prompt: string): Occurrence[] {
  return occurrences(prompt, /半径/g).filter((occurrence) => {
    const before = prompt.slice(Math.max(0, occurrence.start - 8), occurrence.start)
    // 外接球 / 内切球 / 展开图的半径属于另一个对象，不是这只球自己的半径。
    return !/外接球|内切球|展开图|底面/.test(before)
  })
}

function readSphere(prompt: string): ExplicitSphereConditions {
  const requested = /(?<!切)(?<!接)球/.test(prompt)
  if (!requested) return { requested: false, center: ABSENT(), radius: ABSENT() }
  return {
    requested: true,
    center: readCenter(prompt),
    radius: resolveOccurrences<number>(prompt, radiusOccurrences(prompt), parsePositiveDimension)
  }
}

const CHINESE_SIDES: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  十一: 11, 十二: 12
}

function parseSideCount(raw: string): number {
  if (CHINESE_SIDES[raw] !== undefined) return CHINESE_SIDES[raw]!
  if (/^十[一二三四五六七八九]$/.test(raw)) return 10 + (CHINESE_SIDES[raw[1]!] ?? 0)
  return Number(raw)
}

/**
 * **棱柱的形状语义**：直 / 斜 / 正、底面边数，以及多处/矛盾形状校验。
 *
 * 这些不是“画图风格”，而是可核验的几何条件：直棱柱的侧棱必须平行底面法向，
 * 正棱柱的底面必须是正多边形，三 / 六棱柱的底面边数必须分别等于 3 / 6。
 */
function readPrismShapeWithIssues(prompt: string): { shape: ExplicitPrismShape; issues: ExplicitSolidIssue[] } {
  const issues: ExplicitSolidIssue[] = []
  let sawOblique = false
  let sawUpright = false
  let sawRegular = false
  const obliqueTexts: string[] = []
  const uprightTexts: string[] = []
  const sideEntries: { count: number; sourceText: string }[] = []

  for (const match of prompt.matchAll(/((?:(?:正|直|斜)\s*)*)([一二两三四五六七八九十]+|\d+)?\s*棱柱/g)) {
    const modifiers = match[1] ?? ""
    const rawSides = match[2]
    const phrase = match[0].trim()
    if (modifiers.includes("斜")) {
      sawOblique = true
      obliqueTexts.push(phrase)
    }
    if (modifiers.includes("正")) {
      sawRegular = true
      sawUpright = true
      uprightTexts.push(phrase)
    }
    if (modifiers.includes("直")) {
      sawUpright = true
      uprightTexts.push(phrase)
    }
    if (rawSides !== undefined) {
      const count = parseSideCount(rawSides)
      if (!Number.isInteger(count) || count < 3) {
        issues.push({
          field: "prism.shape",
          reason: `棱柱底面至少需要 3 条边（当前为 ${rawSides}）。`,
          sourceText: phrase
        })
      } else {
        sideEntries.push({ count, sourceText: phrase })
      }
    }
  }

  if (sawOblique && sawUpright) {
    issues.push({
      field: "prism.shape",
      reason: "题面同时要求直/正棱柱与斜棱柱，形状互相矛盾。",
      sourceText: [...new Set([...obliqueTexts, ...uprightTexts])].join("；")
    })
  }

  if (sideEntries.length > 1) {
    const firstCount = sideEntries[0]!.count
    const conflict = sideEntries.find((entry) => entry.count !== firstCount)
    if (conflict !== undefined) {
      issues.push({
        field: "prism.shape",
        reason: `棱柱底面边数重复给出且互相矛盾：${firstCount} 与 ${conflict.count}。`,
        sourceText: sideEntries.map((item) => item.sourceText).join("；")
      })
    }
  }

  const hasSideConflict = sideEntries.length > 1 && sideEntries.some((entry) => entry.count !== sideEntries[0]!.count)
  const sides = !hasSideConflict && sideEntries.length > 0 ? sideEntries[0]!.count : undefined
  const regular = !sawOblique && sawRegular
  let straight: boolean | undefined
  if (sawOblique && sawUpright) straight = undefined
  else if (sawUpright) straight = true
  else if (sawOblique) straight = false

  return {
    shape: {
      ...(sides === undefined ? {} : { sides }),
      ...(regular ? { regular: true } : {}),
      ...(straight === undefined ? {} : { straight })
    },
    issues
  }
}

function readPrism(prompt: string): { prism: ExplicitPrismConditions; shapeIssues: ExplicitSolidIssue[] } {
  const requested = /棱柱|prism/i.test(prompt)
  if (!requested) return { prism: { requested: false, baseEdge: ABSENT(), height: ABSENT(), shape: {} }, shapeIssues: [] }
  const baseEdge = resolveOccurrences<number>(prompt, occurrences(prompt, /底面\s*(?:边长|边)|底边长|底边|边长/g), parsePositiveDimension)
  const heightOccurrences = occurrences(prompt, /高(?:度)?/g).filter((occurrence) => {
    const next = prompt.slice(occurrence.end).match(/^\s*(\S)/)?.[1]
    // “高线 / 高的中点”不是高度赋值；不要把几何名词当成数值条件。
    return next === undefined || !/[线中的]/.test(next)
  })
  const { shape, issues: shapeIssues } = readPrismShapeWithIssues(prompt)
  return {
    prism: {
      requested: true,
      baseEdge,
      height: resolveOccurrences<number>(prompt, heightOccurrences, parsePositiveDimension),
      shape
    },
    shapeIssues
  }
}

/**
 * **用户是不是在直接要一只球**。
 *
 * 不能拿“句子里出现球”当判据：`外接球 / 内切球` 是别的对象；而复杂题面里的球
 * 不应被这里接走。`球体` 这个具体写法已经把分析题排除在外。
 */
export function directlyRequestsSphere(prompt: string): boolean {
  return /(?:画|作|建|创建)?\s*(?:一个|个|一只)?\s*球体/.test(prompt)
}

/**
 * **用户是不是在直接要一只特定棱柱**。
 *
 * 不能拿“句子里出现棱柱”当判据：真题里到处都是 `在三棱柱ABC-A′B′C′中…`，
 * 那些题面的几何由点名/见证搜索负责，不能在这里被强制成 `solid.create_prism`。
 * 只要排除带顶点名、`在…棱柱…中` 与求证/提问句，含创建动词（或以棱柱打头）且带有
 * 形状修饰（`斜/直/正/数词`）或显式尺寸（`底面边长/高`）的请求都归入直接请求。
 * 没有尺寸且无修饰的裸 `画一个棱柱` 仍然保持旧行为（不强制动作类型）。
 */
export function directlyRequestsPrism(prompt: string): boolean {
  if (!/棱柱/.test(prompt)) return false
  if (/棱柱\s*[A-Za-z]/.test(prompt)) return false
  if (/在[^，,。；;\n]*棱柱[^，,。；;\n]*中/.test(prompt)) return false
  if (/[?？]|为什么|怎么|如何|多少|多大|多长|求证|证明/.test(prompt)) return false
  if (/[A-Z]|菱形|侧棱|所成角|二面角|外接球|内切球|截面/.test(prompt)) return false

  const hasVerb = /(?:画|作|建|创建|添加|放|来一个|来个)/.test(prompt)
  const hasModifier = /(?:(?:斜|直|正)\s*)+(?:[一二两三四五六七八九十]+|\d+)?\s*棱柱|(?:[一二两三四五六七八九十]+|\d+)\s*棱柱/.test(prompt)
  const hasDimension = /(?:底面\s*(?:边长|边)|底边长|底边|边长|高(?:度)?)/.test(prompt)

  if (hasVerb) return hasModifier || hasDimension
  const startsWithPrism = /^\s*(?:一个|个|一只)?\s*(?:(?:斜|直|正)\s*)*(?:[一二两三四五六七八九十]+|\d+)?\s*棱柱/.test(prompt)
  return startsWithPrism && (hasModifier || hasDimension)
}

export function readExplicitSolidConditions(prompt: string): ExplicitSolidConditions {
  const sphere = directlyRequestsSphere(prompt) ? readSphere(prompt) : { requested: false, center: ABSENT<ExplicitVector3>(), radius: ABSENT<number>() }
  const { prism, shapeIssues } = directlyRequestsPrism(prompt)
    ? readPrism(prompt)
    : { prism: { requested: false, baseEdge: ABSENT<number>(), height: ABSENT<number>(), shape: {} }, shapeIssues: [] as ExplicitSolidIssue[] }
  const issues: ExplicitSolidIssue[] = []
  const collect = (field: ExplicitSolidField, value: ExplicitValue<unknown>): void => {
    if (value.status === "invalid") issues.push({ field, reason: value.reason ?? "条件无法读取。", sourceText: value.sourceText ?? "" })
  }
  collect("sphere.center", sphere.center)
  collect("sphere.radius", sphere.radius)
  collect("prism.baseEdge", prism.baseEdge)
  collect("prism.height", prism.height)
  issues.push(...shapeIssues)
  return { sphere, prism, issues }
}

/** 题面里有没有**真正写出来**的球 / 棱柱条件（读不懂也算写了）。 */
export function hasExplicitSolidConditions(prompt: string): boolean {
  const conditions = readExplicitSolidConditions(prompt)
  return (conditions.sphere.requested && (conditions.sphere.center.status !== "absent" || conditions.sphere.radius.status !== "absent"))
    || (conditions.prism.requested && (conditions.prism.baseEdge.status !== "absent" || conditions.prism.height.status !== "absent"
      || conditions.prism.shape.sides !== undefined || conditions.prism.shape.regular !== undefined || conditions.prism.shape.straight !== undefined
      || conditions.issues.some((issue) => issue.field === "prism.shape")))
}
