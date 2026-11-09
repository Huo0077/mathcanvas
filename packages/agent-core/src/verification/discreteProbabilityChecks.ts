/**
 * **有限等可能样本的精确概率（W6-D，2026-11-09）**。
 *
 * 只支持"有限个等可能结果 + 无放回/有放回的取球"这一类：
 * `exactProbability` 用 `bigint` 精确约分，**不用浮点**；
 * 有放回与无放回是**两种不同模型**（`3红2蓝取2全红`：无放回 `C(3,2)/C(5,2)=3/10`，
 * 有放回 `(3/5)²=9/25`），所以候选答案必须先绑定题面条件才可能被支持/否证。
 */

export interface ExactFraction {
  numerator: bigint
  denominator: bigint
}

export interface DrawCondition {
  red: number
  blue: number
  draws: number
  replacement: "with" | "without"
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left
  let b = right < 0n ? -right : right
  while (b !== 0n) { const next = a % b; a = b; b = next }
  return a
}

export function reduceFraction(fraction: ExactFraction): ExactFraction {
  if (fraction.denominator === 0n) throw new RangeError("denominator must not be zero")
  const sign = fraction.denominator < 0n ? -1n : 1n
  const numerator = fraction.numerator * sign
  const denominator = fraction.denominator * sign
  const divisor = gcd(numerator, denominator)
  return divisor === 0n ? { numerator, denominator } : { numerator: numerator / divisor, denominator: denominator / divisor }
}

export function compareFractions(left: ExactFraction, right: ExactFraction): -1 | 0 | 1 {
  const a = left.numerator * right.denominator
  const b = right.numerator * left.denominator
  return a === b ? 0 : a < b ? -1 : 1
}

/** `favorable/outcome` 约分；总数必须 >0，有利数必须在 `[0, outcome]`。 */
export function exactProbability(outcomeCount: bigint, favorableCount: bigint): ExactFraction {
  if (outcomeCount <= 0n) throw new RangeError("outcome count must be positive")
  if (favorableCount < 0n || favorableCount > outcomeCount) throw new RangeError("favorable count is outside the sample space")
  return reduceFraction({ numerator: favorableCount, denominator: outcomeCount })
}

/** `C(n,k)`（`k<0` / `k>n` 返回 `0n`；`n` 只接受非负）。 */
export function combinations(n: bigint, k: bigint): bigint {
  if (n < 0n || k < 0n || k > n) return 0n
  const smaller = k > n - k ? n - k : k
  let result = 1n
  for (let index = 0n; index < smaller; index += 1n) result = (result * (n - index)) / (index + 1n)
  return result
}

export interface DrawProbabilityInput {
  condition: DrawCondition
  candidate: ExactFraction
  /** 题面条件真的绑定过；`false` 时一律 `unknown`（不能用"3/10 计算器"冒充解析）。 */
  boundToProblem: boolean
}

export interface DrawProbabilityResult {
  decision: "supported" | "refuted" | "unknown"
  reasonCodes: string[]
  expected: ExactFraction
  candidate: ExactFraction
}

export function checkDrawProbability(input: DrawProbabilityInput): DrawProbabilityResult {
  const { red, blue, draws, replacement } = input.condition
  const candidate = { numerator: input.candidate.numerator, denominator: input.candidate.denominator }
  const unknown = (reasonCodes: string[], expected = candidate): DrawProbabilityResult =>
    ({ decision: "unknown", reasonCodes, expected, candidate })
  if (!input.boundToProblem) return unknown(["conditions_not_bound"])
  if (![red, blue, draws].every((value) => Number.isSafeInteger(value) && value >= 0)) return unknown(["invalid_condition"])
  if (draws <= 0) return unknown(["invalid_condition"])
  if (replacement === "without" && draws > red + blue) return unknown(["invalid_condition"])
  if (red + blue === 0) return unknown(["invalid_condition"])
  if (candidate.denominator === 0n) return unknown(["candidate_not_fraction"])

  const expected = replacement === "without"
    ? reduceFraction({ numerator: combinations(BigInt(red), BigInt(draws)), denominator: combinations(BigInt(red + blue), BigInt(draws)) })
    : reduceFraction({ numerator: BigInt(red) ** BigInt(draws), denominator: BigInt(red + blue) ** BigInt(draws) })
  const reduced = reduceFraction(candidate)
  if (compareFractions(reduced, expected) === 0) {
    return { decision: "supported", reasonCodes: ["limited_domain", replacement === "without" ? "without_replacement" : "with_replacement"], expected, candidate: reduced }
  }
  return { decision: "refuted", reasonCodes: ["counterexample_found"], expected, candidate: reduced }
}
