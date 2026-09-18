/**
 * 把测量出来的浮点数还原成**精确形式**：整数 / 分数 / π 的有理倍数 / 二次无理数。
 *
 * 用户口径："旁边增加一个数据转换功能，能够识别到图中的小数，并且在功能内输出分数形式，
 * 无理数也能输出"。
 *
 * 两条纪律：
 * 1. **误报比漏报更糟**：容差取紧（相对 1e-9 + 绝对 1e-12），认不出就返回 `unrecognised`，
 *    绝不把 0.33333 硬说成 π/9 之类。识别结果一律带**残差**，让调用方与用户自己判断像不像；
 * 2. **纯函数**：不读文档、不碰状态，因此画布、属性栏、导出、单测可以共用同一份判据。
 *
 * 分数的约分与格式化复用 `polynomial.ts` 的 `rational` / `rationalToString`，不另写一套。
 */
import { rational, rationalToString } from "./polynomial"

export type ExactForm =
  | { kind: "integer"; text: string }
  | { kind: "rational"; text: string }
  | { kind: "pi-multiple"; text: string }
  | { kind: "surd"; text: string }
  | { kind: "unrecognised"; text: string }

export interface ExactFormReading {
  form: ExactForm
  /** 精确形式的浮点值；落回两位小数时 = 四舍五入后的值。 */
  value: number
  /** |输入 − 显示值|；输入非有限时为 null。 */
  residual: number | null
  /**
   * `exact` = 按**紧容差**命中（这个值确实等于那个精确形式）；
   * `approximate` = 按**松容差**命中（是它的四舍五入写法，文本带 `≈`）或落回两位小数。
   *
   * 分开标注是刻意的：面板据此告诉用户"这是认出来的近似"，而不是让 `2/3` 与 `≈ 2/3`
   * 看起来一样可信。
   */
  certainty: "exact" | "approximate"
}

/**
 * 紧容差：这个值**确实**等于那个精确形式。
 *
 * 用户反馈（2026-09-18）："为什么会显示未识别为精确形式" —— 实测根因是量出来的值常常是
 * **简单分数的六位小数写法**（点的坐标是 `0.333333` ⇒ 长度 `0.666667`），而 1e-9 会把
 * `2/3` 判成"不是 2/3"。所以紧容差之外还有一层松容差（见下），两层都不中才落回两位小数。
 */
const DEFAULT_RELATIVE_TOLERANCE = 1e-9
const DEFAULT_ABSOLUTE_TOLERANCE = 1e-12
/**
 * 松容差：**输入自身十进制的最后一位的半个单位** —— 也就是"这个差值能不能用
 * 『它只是那个精确形式的四舍五入写法』解释"。
 *
 * 为什么不是固定值（第一版用了 1e-4，实测**太松**）：`e = 2.718281828459045` 带 15 位小数，
 * 固定 1e-4 会把 `106/39`（差 3.3e-4）也放进来，`π/100` 会被认成 `1/32`（差 1.7e-4）——
 * 那正是"硬凑"，比不认更糟。按输入自己的精度算：
 * - `0.666667`（6 位小数）⇒ 容差 5e-7，足以容纳 `2/3` 的 3.3e-7 ✓（用户反馈的那一类）
 * - `e`（15 位小数）⇒ 容差 5e-16，`106/39` 立刻被拒 ✓
 * - `0.1234567`（7 位）⇒ 5e-8，`1/8` 被拒 ✓
 */
function decimalWritingTolerance(input: number): number {
  const text = Math.abs(input).toString()
  const exponentMatch = /e([+-]\d+)$/i.exec(text)
  const mantissa = exponentMatch ? text.slice(0, exponentMatch.index) : text
  const decimals = mantissa.includes(".") ? mantissa.length - mantissa.indexOf(".") - 1 : 0
  const exponent = exponentMatch ? Number(exponentMatch[1]) : 0
  return Math.max(Math.pow(10, exponent - decimals) / 2, 1e-12)
}
/** 教学场景里够用的分母上限；再大就该认为它本来不是分数。 */
const MAX_DENOMINATOR = 64
/** π 的有理倍数的分母上限：覆盖 π/12 的整数倍（15°、30°、45°、60°、90°…）。 */
const MAX_PI_DENOMINATOR = 12

/** π 的有理倍数文本：`π`、`-π`、`2π`、`π/4`、`-3π/2`。 */
export function formatPiMultiple(numerator: number, denominator: number): string {
  const sign = numerator < 0 ? "-" : ""
  const magnitude = Math.abs(numerator)
  const coefficient = magnitude === 1 ? "π" : `${magnitude}π`
  return denominator === 1 ? `${sign}${coefficient}` : `${sign}${coefficient}/${denominator}`
}

/**
 * 二次无理数 `(a + b√n)/c` 的搜索边界。
 *
 * 这些数字不是随便取的：n 取到 99 覆盖课堂会遇到的 √2…√99；c ≤ 12 覆盖 /2、/3、/4 这类分母；
 * a、b 取小整数。
 *
 * **不枚举 n，而是解出 n**：由 `(a + b√n)/c = input` 得 `√n = (c·input − a)/b`，
 * 于是 `n = ((c·input − a)/b)²` —— 只需检查它是不是 [2, 99] 内的平方自由整数。
 * 第一版是按 n 枚举的（约 70 万个候选），**实测最坏情况 114.9 ms**，对一个渲染时调用的面板
 * 完全不可接受（见进度文档的耗时读数）；改成解 n 之后候选量降到约 1.4 万个，且与 n 的范围无关。
 */
const MAX_SURD_RADICAND = 99
const MAX_SURD_DENOMINATOR = 12
const MAX_SURD_COEFFICIENT = 12
const MAX_SURD_INTEGER = 24

function isSquareFree(value: number): boolean {
  for (let factor = 2; factor * factor <= value; factor += 1) {
    if (value % (factor * factor) === 0) return false
  }
  return true
}

/** 候选表在模块加载时算一次：放进循环里会让每次枚举重新分配数组（耗时读数会骗人）。 */
const SURD_INTEGERS = Array.from({ length: MAX_SURD_INTEGER * 2 + 1 }, (_, index) => index - MAX_SURD_INTEGER)

/** `(a + b√n)/c` 的文本：`√2`、`3√2`、`√2/2`、`-√3/2`、`2+√3`、`(1+√5)/2`。 */
export function formatQuadraticSurd(a: number, b: number, radicand: number, divisor: number): string {
  const root = `√${radicand}`
  const radicalPart = Math.abs(b) === 1 ? root : `${Math.abs(b)}${root}`
  if (a === 0) {
    const signed = b < 0 ? `-${radicalPart}` : radicalPart
    return divisor === 1 ? signed : `${signed}/${divisor}`
  }
  const body = b === 0 ? `${a}` : `${a}${b > 0 ? "+" : "-"}${radicalPart}`
  return divisor === 1 ? body : `(${body})/${divisor}`
}

/**
 * 由 `(a + b√n)/c = input` 反解出 `n`，返回 `[n]`（是 [2, 99] 内的平方自由整数时）或 `null`。
 *
 * 整数判定用了一点相对容差（1e-6）：输入本身是浮点，反解出的 n 会有末位误差；
 * 但**最终是否命中仍由 `hit()` 用紧容差把关**，所以放宽这一步不会造成误报。
 */
function radicandFrom(input: number, whole: number, coefficient: number, divisor: number): number | null {
  const rootCandidate = (divisor * input - whole) / coefficient
  if (!(rootCandidate > 0)) return null
  const radicand = rootCandidate * rootCandidate
  if (radicand < 2 || radicand > MAX_SURD_RADICAND) return null
  const rounded = Math.round(radicand)
  if (Math.abs(radicand - rounded) > Math.max(1e-9, rounded * 1e-6)) return null
  return isSquareFree(rounded) ? rounded : null
}

function toleranceFor(input: number, tolerance?: number): number {
  if (tolerance !== undefined) return tolerance
  return Math.max(DEFAULT_ABSOLUTE_TOLERANCE, Math.abs(input) * DEFAULT_RELATIVE_TOLERANCE)
}

/**
 * 连分数展开求**最佳有理逼近**：返回分母不超过 `maxDenominator` 的渐近分数。
 *
 * 负数取绝对值算、最后补符号 —— `Math.floor` 对负数的行为与连分数约定不一致，分开处理最不容易错。
 */
export function bestRational(input: number, maxDenominator: number): { numerator: bigint; denominator: bigint } | null {
  let value = Math.abs(input)
  if (!Number.isFinite(value)) return null
  let previousNumerator = 0n
  let numerator = 1n
  let previousDenominator = 1n
  let denominator = 0n
  for (let step = 0; step < 64; step += 1) {
    const whole = Math.floor(value)
    const nextNumerator = BigInt(whole) * numerator + previousNumerator
    const nextDenominator = BigInt(whole) * denominator + previousDenominator
    if (nextDenominator > BigInt(maxDenominator)) break
    previousNumerator = numerator
    numerator = nextNumerator
    previousDenominator = denominator
    denominator = nextDenominator
    const fraction = value - whole
    if (fraction < 1e-15) break
    value = 1 / fraction
  }
  if (denominator === 0n) return null
  return rational(input < 0 ? -numerator : numerator, denominator)
}

/** 非有限数：没有两位小数可显示，只能如实说"不是有限数"。 */
export function nonFiniteForm(input: number): ExactFormReading {
  return { form: { kind: "unrecognised", text: "未识别（不是有限数）" }, value: input, residual: null, certainty: "approximate" }
}

/**
 * 两位小数兜底（用户口径："如果不能转换为分数就保留两位小数"）。
 *
 * 认不出精确形式时**不再显示"未识别"**，而是给一个四位有效信息的近似值，并如实给出差值。
 * 负零归一成 `0.00`（`-0.001.toFixed(2)` 是 `"-0.00"`，那会被读成负号）。
 */
export function decimalFallback(input: number): ExactFormReading {
  const rounded = Number(input.toFixed(2))
  const value = Object.is(rounded, -0) ? 0 : rounded
  return { form: { kind: "unrecognised", text: `≈ ${value.toFixed(2)}` }, value, residual: Math.abs(input - value), certainty: "approximate" }
}

/** 命中判据：`|input − value| ≤ 容差`，命中就返回带残差与确信度的读数。 */
export function hit(input: number, value: number, form: ExactForm, limit: number, certainty: "exact" | "approximate" = "exact"): ExactFormReading | null {
  const residual = Math.abs(input - value)
  return residual <= limit ? { form, value, residual, certainty } : null
}

/**
 * 按给定容差在四族里找精确形式；找不到返回 `null`（由调用方决定降级策略）。
 *
 * `approximate` = 这一轮用的是松容差，文本统一加 `≈`：读者必须能一眼看出
 * "`2/3`" 与 "`≈ 2/3`" 的可信度不同。
 */
function recognise(input: number, limit: number, approximate: boolean): ExactFormReading | null {
  const label = (text: string) => (approximate ? `≈ ${text}` : text)
  const certainty = approximate ? "approximate" as const : "exact" as const

  const rounded = Math.round(input)
  const integerHit = hit(input, rounded, { kind: "integer", text: label(String(rounded)) }, limit, certainty)
  if (integerHit) return integerHit

  const fraction = bestRational(input, MAX_DENOMINATOR)
  if (fraction) {
    const value = Number(fraction.numerator) / Number(fraction.denominator)
    const rationalHit = hit(input, value, { kind: "rational", text: label(rationalToString(fraction)) }, limit, certainty)
    if (rationalHit) return rationalHit
  }

  /**
   * π 的有理倍数。放在分数**之后**是安全的：π 的有理倍数是无理数，任何分母 ≤ 64 的分数
   * 与它的差都远大于紧容差（例如 π/4 ≈ 0.785398 最近的是 11/14，差 1.4e-3），所以不会互相抢。
   */
  const piFraction = bestRational(input / Math.PI, MAX_PI_DENOMINATOR)
  if (piFraction && piFraction.numerator !== 0n) {
    const numerator = Number(piFraction.numerator)
    const denominator = Number(piFraction.denominator)
    const value = (numerator / denominator) * Math.PI
    const piHit = hit(input, value, { kind: "pi-multiple", text: label(formatPiMultiple(numerator, denominator)) }, limit, certainty)
    if (piHit) return piHit
  }

  /**
   * 二次无理数 `(a + b√n)/c`：课堂上的 √2、√2/2、(1+√5)/2、2+√3 都在这一族里。
   *
   * 先扫 `a = 0` 的**纯根式**（最常见），再扫带整数部分的一般情形；
   * 两者都按"分母小 → 系数小 → 整数部分小"的顺序扫，于是命中的是**最简**的那个形式。
   */
  for (let divisor = 1; divisor <= MAX_SURD_DENOMINATOR; divisor += 1) {
    for (let coefficient = -MAX_SURD_COEFFICIENT; coefficient <= MAX_SURD_COEFFICIENT; coefficient += 1) {
      if (coefficient === 0) continue
      const radicand = radicandFrom(input, 0, coefficient, divisor)
      if (radicand === null) continue
      const value = (coefficient * Math.sqrt(radicand)) / divisor
      const surdHit = hit(input, value, { kind: "surd", text: label(formatQuadraticSurd(0, coefficient, radicand, divisor)) }, limit, certainty)
      if (surdHit) return surdHit
    }
  }
  for (let divisor = 1; divisor <= MAX_SURD_DENOMINATOR; divisor += 1) {
    for (let coefficient = -MAX_SURD_COEFFICIENT; coefficient <= MAX_SURD_COEFFICIENT; coefficient += 1) {
      if (coefficient === 0) continue
      for (const wholePart of SURD_INTEGERS) {
        if (wholePart === 0) continue
        const radicand = radicandFrom(input, wholePart, coefficient, divisor)
        if (radicand === null) continue
        const value = (wholePart + coefficient * Math.sqrt(radicand)) / divisor
        const surdHit = hit(input, value, { kind: "surd", text: label(formatQuadraticSurd(wholePart, coefficient, radicand, divisor)) }, limit, certainty)
        if (surdHit) return surdHit
      }
    }
  }

  return null
}

/**
 * 两级容差 + 两位小数兜底。
 *
 * 1. 紧容差（相对 1e-9）：这个值**确实**等于那个精确形式 ⇒ 不带 `≈`、确信度 `exact`；
 * 2. 松容差（相对 1e-4）：是它的四舍五入写法 ⇒ 文本带 `≈`、确信度 `approximate`；
 * 3. 都不中 ⇒ 两位小数（`≈ 0.64`），**不再出现"未识别为精确形式"**。
 *
 * 显式传了 `tolerance` 时只走那一层（调用方要的是指定精度，不该被自动放宽）。
 */
export function exactFormOf(input: number, tolerance?: number): ExactFormReading {
  if (!Number.isFinite(input)) return nonFiniteForm(input)
  const tight = toleranceFor(input, tolerance)
  const exact = recognise(input, tight, false)
  if (exact) return exact
  if (tolerance !== undefined) return decimalFallback(input)
  return recognise(input, decimalWritingTolerance(input), true) ?? decimalFallback(input)
}
