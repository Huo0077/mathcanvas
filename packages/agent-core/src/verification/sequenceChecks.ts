/**
 * **连分数与有限数列判据（W6-C，2026-11-09）**。
 *
 * 只做两件事：
 * 1. **精确求值**：`1 + 1/(a₁ + 1/(a₂ + … + 1/a_k))`，用 `bigint` 表示分子分母，
 *    全程无浮点（"巨整数"只受内存限制）；
 * 2. **否证单调性**：相邻两项违反声明即给出反例。
 *
 * 明确**不做**的事：不因为前若干项相符就宣布一般结论成立。
 * 全 1 连分数（`b_n` 的相邻比值）不是单调递减：`b₂ = 3/2 < b₃ = 5/3`。
 * 一般序列的正确结论需要递推/归纳检查，本模块只返回 `unknown`。
 */

export interface ExactFraction {
  numerator: bigint
  denominator: bigint
}

const MAX_TERMS = 512

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left
  let b = right < 0n ? -right : right
  while (b !== 0n) { const next = a % b; a = b; b = next }
  return a
}

function normalise(value: ExactFraction): ExactFraction {
  if (value.denominator === 0n) throw new RangeError("denominator must not be zero")
  const sign = value.denominator < 0n ? -1n : 1n
  const numerator = value.numerator * sign
  const denominator = value.denominator * sign
  const divisor = gcd(numerator, denominator)
  return { numerator: numerator / divisor, denominator: denominator / divisor }
}

/** 有限连分数 `[a₁; a₂; …; a_k]` 的精确值（低阶收敛子）。 */
function convergent(coefficients: readonly bigint[]): ExactFraction {
  let numerator = coefficients[coefficients.length - 1]!
  let denominator = 1n
  for (let index = coefficients.length - 2; index >= 0; index -= 1) {
    const a = coefficients[index]!
    const nextNumerator = a * numerator + denominator
    denominator = numerator
    numerator = nextNumerator
  }
  return normalise({ numerator, denominator })
}

/**
 * `1 + 1/(a₁ + 1/(a₂ + … + 1/a_k))`。
 *
 * 系数必须是**正整数**（零/负系数会让连分数退化或改变符号，本规则不受理）。
 * 空数组、非整数、越界长度都抛 `RangeError` —— 静默返回一个数比报错更危险。
 */
export function evaluateContinuedFraction(coefficients: readonly bigint[]): ExactFraction {
  if (coefficients.length === 0 || coefficients.length > MAX_TERMS) throw new RangeError("coefficient count must be 1.." + MAX_TERMS)
  for (const coefficient of coefficients) {
    if (typeof coefficient !== "bigint") throw new RangeError("coefficients must be bigints")
    if (coefficient < 1n) throw new RangeError("coefficients must be positive integers")
  }
  const inner = convergent(coefficients)
  // 1 + 1/inner = (inner + 1)/1 → (numerator + denominator)/numerator
  return normalise({ numerator: inner.numerator + inner.denominator, denominator: inner.numerator })
}

export interface MonotonicityInput {
  coefficients: readonly bigint[]
  claim: "increasing" | "decreasing"
}

export interface MonotonicityResult {
  decision: "refuted" | "unknown"
  reasonCodes: string[]
  /** 术语下标（1 起始）：`b_{at-1}` 与 `b_at` 构成反例。 */
  counterexample?: { at: number; previous: number; next: number }
}

/** 逐项比较相邻两项；违反声明即否证。没有反例只说明**有限项**相符，仍是 `unknown`。 */
export function judgeMonotonicity(input: MonotonicityInput): MonotonicityResult {
  if (input.coefficients.length < 2) return { decision: "unknown", reasonCodes: ["insufficient_terms"] }
  let previous: ExactFraction | null = null
  for (let length = 1; length <= input.coefficients.length; length += 1) {
    const current = evaluateContinuedFraction(input.coefficients.slice(0, length))
    if (previous !== null) {
      const left = previous.numerator * current.denominator
      const right = current.numerator * previous.denominator
      const violated = input.claim === "decreasing" ? right > left : right < left
      if (violated) {
        return {
          decision: "refuted",
          reasonCodes: ["counterexample_found"],
          counterexample: {
            at: length,
            previous: Number(previous.numerator) / Number(previous.denominator),
            next: Number(current.numerator) / Number(current.denominator)
          }
        }
      }
    }
    previous = current
  }
  // 有限项相符 ≠ 一般结论成立（需要递推/归纳证明）。
  return { decision: "unknown", reasonCodes: ["finite_terms_only"] }
}

/** 供测试/诊断使用：第 `length` 个收敛子（不做浮点近似）。 */
export function continuedFractionTerm(coefficients: readonly bigint[], length: number): ExactFraction {
  if (length < 1 || length > coefficients.length) throw new RangeError("length is outside the coefficient list")
  return evaluateContinuedFraction(coefficients.slice(0, length))
}
