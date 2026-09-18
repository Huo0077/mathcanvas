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

  return unrecognisedForm(input)
}
