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
  /** 精确形式的浮点值（与输入比较用）。 */
  value: number
  /** |输入 − 精确形式|；未识别时为 null。 */
  residual: number | null
}

const UNRECOGNISED_TEXT = "未识别为精确形式（数值近似）"
const DEFAULT_RELATIVE_TOLERANCE = 1e-9
const DEFAULT_ABSOLUTE_TOLERANCE = 1e-12
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

/** 未识别：文本如实说明，残差为 `null`（不是 0 —— 0 会被读成"完全命中"）。 */
export function unrecognisedForm(input: number): ExactFormReading {
  return { form: { kind: "unrecognised", text: UNRECOGNISED_TEXT }, value: input, residual: null }
}

/** 命中判据：`|input − value| ≤ 容差`，命中就返回带残差的读数。 */
export function hit(input: number, value: number, form: ExactForm, limit: number): ExactFormReading | null {
  const residual = Math.abs(input - value)
  return residual <= limit ? { form, value, residual } : null
}

export function exactFormOf(input: number, tolerance?: number): ExactFormReading {
  if (!Number.isFinite(input)) return unrecognisedForm(input)
  const limit = toleranceFor(input, tolerance)

  const rounded = Math.round(input)
  const integerHit = hit(input, rounded, { kind: "integer", text: String(rounded) }, limit)
  if (integerHit) return integerHit

  const fraction = bestRational(input, MAX_DENOMINATOR)
  if (fraction) {
    const value = Number(fraction.numerator) / Number(fraction.denominator)
    const rationalHit = hit(input, value, { kind: "rational", text: rationalToString(fraction) }, limit)
    if (rationalHit) return rationalHit
  }

  /**
   * π 的有理倍数。放在分数**之后**是安全的：π 的有理倍数是无理数，任何分母 ≤ 64 的分数
   * 与它的差都远大于 1e-9（例如 π/4 ≈ 0.785398 最近的是 11/14，差 1.4e-3），所以不会互相抢。
   */
  const piFraction = bestRational(input / Math.PI, MAX_PI_DENOMINATOR)
  if (piFraction && piFraction.numerator !== 0n) {
    const numerator = Number(piFraction.numerator)
    const denominator = Number(piFraction.denominator)
    const value = (numerator / denominator) * Math.PI
    const piHit = hit(input, value, { kind: "pi-multiple", text: formatPiMultiple(numerator, denominator) }, limit)
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
      const surdHit = hit(input, value, { kind: "surd", text: formatQuadraticSurd(0, coefficient, radicand, divisor) }, limit)
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
        const surdHit = hit(input, value, { kind: "surd", text: formatQuadraticSurd(wholePart, coefficient, radicand, divisor) }, limit)
        if (surdHit) return surdHit
      }
    }
  }

  return unrecognisedForm(input)
}
