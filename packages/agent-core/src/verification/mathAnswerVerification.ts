import type { EvidenceRecord, GoalAnswer } from "../answerResult"
import type { Budget } from "../budget"
import type { ObligationIR } from "../obligationIR"
import { verifyDomainAnswer, type DomainMathFact } from "./domainChecks"
import { parseScalar } from "./scalarParsing"

export { parseScalar } from "./scalarParsing"

/**
 * **独立数学答案核验（W5 / T5，2026-11-08）**。
 *
 * ## 它做什么
 *
 * 只处理**有限、可声明定义域**的判据：
 * 1. 坐标距离关系（`|AB|² = k·|CD|²`）；
 * 2. 坐标垂直（归一化点积）；
 * 3. 限定区间的二次函数最值；
 * 4. 两类圆锥曲线结论：双曲线垂足的离心率代入、椭圆离心率范围。
 *
 * 每条判据都**独立于模型的推导**：用坐标/区间自己算，再与候选答案比。
 * 找到反例即 `refuted`；域外、退化、取消、预算不足一律 `unknown`，**不猜**。
 *
 * ## 它不做什么
 *
 * - 不做通用 CAS、不做任意命题的形式证明；
 * - 不因为"随机采样没找到反例"就说成立：一个点通过只标 `verified_instance`；
 * - 不标 `formally_proved` —— 没有可独立校验的证明产物时，那三个字是假话。
 *
 * ## 与 §8.5 签名的关系
 *
 * 请求保留 `ir`（题面修订、目标与条件的同一处真源），另加可选的 `facts`：
 * 这些是**结构化数学事实**（坐标、二次式、区间），由题族适配器给出，**不来自模型**。
 * 没有注册判据的目标返回 `unknown`，而不是"看起来对"。
 */

export type Scalar = number

export interface QuadraticIntervalFact {
  kind: "quadratic-interval"
  goalId: string
  /** `[a, b, c]` 表示 `a·t² + b·t + c`。 */
  quadratic: readonly [Scalar, Scalar, Scalar]
  interval: { lower: Scalar; upper: Scalar; lowerClosed: boolean; upperClosed: boolean }
  claim: "max" | "min"
}

export interface DistanceEqualityFact {
  kind: "distance-equality"
  goalId: string
  left: readonly [readonly number[], readonly number[]]
  right: readonly [readonly number[], readonly number[]]
  /** 判据：`|left|² = ratio · |right|²`。 */
  ratio: Scalar
  tolerance?: Scalar
}

export interface PerpendicularFact {
  kind: "perpendicular"
  goalId: string
  first: readonly [readonly number[], readonly number[]]
  second: readonly [readonly number[], readonly number[]]
  tolerance?: Scalar
}

export interface HyperbolaFootFact {
  kind: "hyperbola-foot-eccentricity"
  goalId: string
  /** 归一化半实轴；默认 1（离心率与尺度无关）。 */
  semiMajor?: Scalar
  /** 题设里的倍数：默认 6（`PF₁² = 6·OP²`）。 */
  multiplier?: Scalar
}

export interface EllipseRangeFact {
  kind: "ellipse-eccentricity-range"
  goalId: string
  /** 全称命题的允许倍数：默认 `PB ≤ 2b`。 */
  boundMultiplier?: Scalar
}

export type MathFact = QuadraticIntervalFact | DistanceEqualityFact | PerpendicularFact | HyperbolaFootFact | EllipseRangeFact | DomainMathFact

export interface MathVerificationRequest {
  problemRevision: string
  goalId: string
  /** 题意层的同一份真源（当前用于身份与修订；事实由 `facts` 显式给出）。 */
  ir: ObligationIR
  candidate: GoalAnswer
  /** 结构化事实，必须由题族适配器/宿主给出，不来自模型。 */
  facts?: readonly MathFact[]
}

export interface MathVerificationResult {
  decision: "supported" | "refuted" | "unknown"
  method: string
  domain: string
  reasonCodes: string[]
  counterexample?: Record<string, number>
  evidence?: EvidenceRecord
}

/** 相对容差：与仓库其余几何判据同一量级。 */
const RELATIVE_TOLERANCE = 1e-9

function closeTo(left: number, right: number, tolerance = RELATIVE_TOLERANCE): boolean {
  return Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right))
}

function finite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value)
}

/**
 * **只解析、绝不 eval**：数字、`√n`、`√n/m`、`a√n/m`、`a/b`。
 *
 * 超过这个形状就返回 `undefined`（随之落到 `unknown`）—— 把一个解析不了的表达式
 * "想办法算出来"是本仓最忌讳的静默改题。
 */
export interface ParsedRange {
  lower: number
  upper: number
  lowerInclusive: boolean
  upperInclusive: boolean
}

/** 只认 `A<e<B` / `A≤e≤B` 这类两侧都写明的区间；单侧或无界返回 `undefined`。 */
export function parseEccentricityRange(input: string): ParsedRange | undefined {
  const text = input.replace(/\\left|\\right/g, "").replace(/\s/g, "").replace(/\\leqslant|\\leq/g, "≤").replace(/\\geqslant|\\geq/g, "≥").replace(/\\lt/g, "<").replace(/\\gt/g, ">")
  const both = /^(.+?)(<|≤)e(<|≤)(.+)$/.exec(text)
  if (both === null) return undefined
  const lower = parseScalar(both[1]!)
  const upper = parseScalar(both[4]!)
  if (!finite(lower) || !finite(upper) || lower >= upper) return undefined
  return { lower, upper, lowerInclusive: both[2] === "≤", upperInclusive: both[3] === "≤" }
}

function numericOf(candidate: GoalAnswer): number | undefined {
  const value = candidate.value
  if (value?.kind === "numeric") {
    if (finite(value.approximation)) return value.approximation
    const parsed = parseScalar(value.expression)
    if (parsed !== undefined) return parsed
  }
  return parseScalar(candidate.displayText)
}

function rangeOf(candidate: GoalAnswer): ParsedRange | undefined {
  const value = candidate.value
  if (value?.kind === "interval") {
    const parsed = parseEccentricityRange(value.expression)
    if (parsed !== undefined) return parsed
  }
  return parseEccentricityRange(candidate.displayText)
}

function vectorBetween(first: readonly number[], second: readonly number[]): number[] | null {
  if (first.length !== second.length || first.length === 0) return null
  return second.map((coordinate, index) => coordinate - first[index]!)
}

function squaredNorm(vector: readonly number[]): number {
  return vector.reduce((total, coordinate) => total + coordinate * coordinate, 0)
}

/** 二次式在区间上的精确最值（顶点 + 端点；开闭端点只影响"是否取到"）。 */
function intervalExtremum(fact: QuadraticIntervalFact): { value: number; at: number; attained: boolean } | { unknown: string } {
  const [a, b, c] = fact.quadratic
  const { lower, upper, lowerClosed, upperClosed } = fact.interval
  if (![a, b, c, lower, upper].every((value) => Number.isFinite(value))) return { unknown: "non_finite_interval" }
  if (lower > upper) return { unknown: "degenerate_interval" }
  const evaluate = (t: number): number => a * t * t + b * t + c
  const points: { value: number; at: number; attained: boolean }[] = []
  points.push({ value: evaluate(lower), at: lower, attained: lowerClosed })
  points.push({ value: evaluate(upper), at: upper, attained: upperClosed })
  if (Math.abs(a) > 1e-12) {
    const vertex = -b / (2 * a)
    if (vertex >= lower && vertex <= upper) {
      points.push({ value: evaluate(vertex), at: vertex, attained: (vertex > lower || lowerClosed) && (vertex < upper || upperClosed) })
    }
  }
  const compare = fact.claim === "max" ? (left: number, right: number) => left > right : (left: number, right: number) => left < right
  let best = points[0]!
  for (const point of points.slice(1)) if (compare(point.value, best.value)) best = point
  return best
}

function evidenceOf(input: {
  problemRevision: string
  goalId: string
  method: string
  decision: "supported" | "refuted"
  residuals: Record<string, number | null>
  nextActions?: string[]
}): EvidenceRecord {
  return {
    id: `verification:${input.goalId}:${input.method}`,
    goalId: input.goalId,
    problemRevision: input.problemRevision,
    producer: "host_verifier",
    method: input.method,
    evidence: {
      // **支持也只是"在声明域内验过"**，不是形式证明；否证则是明确的反例。
      status: input.decision === "supported" ? "verified_instance" : "failed",
      solver: "model",
      residuals: input.residuals,
      degreesOfFreedom: null,
      nextActions: input.nextActions ?? []
    }
  }
}

function hyperbolaFoot(input: {
  fact: HyperbolaFootFact
  candidate: GoalAnswer
  problemRevision: string
}): MathVerificationResult {
  const e = numericOf(input.candidate)
  const method = "hyperbola-foot-substitution"
  const domain = "hyperbola:e>1"
  if (!finite(e)) return { decision: "unknown", method, domain, reasonCodes: ["candidate_not_numeric"] }
  if (!(e > 1)) return { decision: "unknown", method, domain, reasonCodes: ["outside_supported_domain"] }

  const a = input.fact.semiMajor ?? 1
  const multiplier = input.fact.multiplier ?? 6
  if (!(a > 0) || !(multiplier > 0)) return { decision: "unknown", method, domain, reasonCodes: ["invalid_fact_parameters"] }

  const c = a * e
  const b = Math.sqrt(c * c - a * a)
  const pointX = (a * a) / c
  const pointY = (a * b) / c
  const opSquared = pointX * pointX + pointY * pointY
  const pf1Squared = (pointX + c) * (pointX + c) + pointY * pointY
  const required = multiplier * opSquared
  const residual = pf1Squared - required
  const residuals = { pf1Squared, required, residual }

  if (closeTo(pf1Squared, required)) {
    return { decision: "supported", method, domain, reasonCodes: ["limited_domain"], counterexample: { e, pf1Squared, required }, evidence: evidenceOf({ problemRevision: input.problemRevision, goalId: input.fact.goalId, method, decision: "supported", residuals }) }
  }
  return {
    decision: "refuted",
    method,
    domain,
    reasonCodes: ["counterexample_found"],
    counterexample: { e, pf1Squared, required, residual },
    evidence: evidenceOf({ problemRevision: input.problemRevision, goalId: input.fact.goalId, method, decision: "refuted", residuals, nextActions: ["修正离心率或重新核对题设关系"] })
  }
}

function ellipseRange(input: {
  fact: EllipseRangeFact
  candidate: GoalAnswer
  problemRevision: string
}): MathVerificationResult {
  const method = "ellipse-eccentricity-range"
  const domain = "ellipse:0<e<1"
  const candidate = rangeOf(input.candidate)
  if (candidate === undefined) return { decision: "unknown", method, domain, reasonCodes: ["candidate_not_interval"] }
  if (!(candidate.lower >= 0) || !(candidate.upper <= 1)) {
    // 范围本身越界：这是明确错误，不是"域外"。
    return {
      decision: "refuted",
      method,
      domain,
      reasonCodes: ["outside_eccentricity_domain"],
      counterexample: { lower: candidate.lower, upper: candidate.upper },
      evidence: evidenceOf({ problemRevision: input.problemRevision, goalId: input.fact.goalId, method, decision: "refuted", residuals: { lower: candidate.lower, upper: candidate.upper } })
    }
  }

  const correctUpper = Math.SQRT1_2
  const correctLower = 0
  const exact = closeTo(candidate.lower, correctLower) && candidate.lowerInclusive === false
    && closeTo(candidate.upper, correctUpper) && candidate.upperInclusive === true
  const residuals = { lower: candidate.lower, upper: candidate.upper, correctUpper }

  if (exact) {
    return { decision: "supported", method, domain, reasonCodes: ["limited_domain", "interval_branch_analysis"], evidence: evidenceOf({ problemRevision: input.problemRevision, goalId: input.fact.goalId, method, decision: "supported", residuals }) }
  }

  /**
   * 只有在候选范围**包含** `e>√2/2` 时才是"不成立"（不是"不完整"）。
   * 反例用一个具体椭圆与一个具体参数点：`b=1`、`a=1/√(1−e²)`，扫描 `t∈[−1,1]`。
   */
  if (candidate.upper > correctUpper + 1e-12) {
    const e = Math.min(1 - 1e-6, Math.max(correctUpper + 1e-6, (Math.max(candidate.lower, correctUpper) + Math.min(candidate.upper, 1)) / 2))
    const b = 1
    const a = b / Math.sqrt(1 - e * e)
    const bound = (input.fact.boundMultiplier ?? 2) * b
    let best = { pbSquared: Number.NEGATIVE_INFINITY, at: 0 }
    for (let index = 0; index <= 4000; index += 1) {
      const t = -1 + (2 * index) / 4000
      const q = (b * b - a * a) * t * t - 2 * b * b * t + a * a + b * b
      if (q > best.pbSquared) best = { pbSquared: q, at: t }
    }
    const allowed = bound * bound
    if (best.pbSquared > allowed + 1e-9) {
      return {
        decision: "refuted",
        method,
        domain,
        reasonCodes: ["counterexample_found"],
        counterexample: { e, a, b, at: best.at, pbSquared: best.pbSquared, allowed },
        evidence: evidenceOf({ problemRevision: input.problemRevision, goalId: input.fact.goalId, method, decision: "refuted", residuals: { ...residuals, pbSquared: best.pbSquared, allowed } })
      }
    }
  }

  return { decision: "unknown", method, domain, reasonCodes: ["candidate_range_incomplete"], counterexample: { lower: candidate.lower, upper: candidate.upper, correctUpper } }
}

function distanceEquality(input: { fact: DistanceEqualityFact; candidate: GoalAnswer; problemRevision: string }): MathVerificationResult {
  const method = "coordinate-distance"
  const domain = "coordinates:nondegenerate"
  const left = vectorBetween(input.fact.left[0], input.fact.left[1])
  const right = vectorBetween(input.fact.right[0], input.fact.right[1])
  if (left === null || right === null) return { decision: "unknown", method, domain, reasonCodes: ["dimension_mismatch"] }
  const leftSquared = squaredNorm(left)
  const rightSquared = squaredNorm(right)
  if (rightSquared <= RELATIVE_TOLERANCE) return { decision: "unknown", method, domain, reasonCodes: ["degenerate_reference_segment"] }
  const expected = input.fact.ratio * rightSquared
  const counterexample = { leftSquared, rightSquared, expected }
  if (closeTo(leftSquared, expected)) {
    return { decision: "supported", method, domain, reasonCodes: ["limited_domain"], evidence: evidenceOf({ problemRevision: input.problemRevision, goalId: input.fact.goalId, method, decision: "supported", residuals: counterexample }) }
  }
  return { decision: "refuted", method, domain, reasonCodes: ["counterexample_found"], counterexample, evidence: evidenceOf({ problemRevision: input.problemRevision, goalId: input.fact.goalId, method, decision: "refuted", residuals: counterexample }) }
}

function perpendicular(input: { fact: PerpendicularFact; candidate: GoalAnswer; problemRevision: string }): MathVerificationResult {
  const method = "coordinate-perpendicular"
  const domain = "coordinates:nondegenerate"
  const first = vectorBetween(input.fact.first[0], input.fact.first[1])
  const second = vectorBetween(input.fact.second[0], input.fact.second[1])
  if (first === null || second === null) return { decision: "unknown", method, domain, reasonCodes: ["dimension_mismatch"] }
  const firstLength = Math.sqrt(squaredNorm(first))
  const secondLength = Math.sqrt(squaredNorm(second))
  if (firstLength <= RELATIVE_TOLERANCE || secondLength <= RELATIVE_TOLERANCE) return { decision: "unknown", method, domain, reasonCodes: ["degenerate_segment"] }
  const dot = first.reduce((total, coordinate, index) => total + coordinate * second[index]!, 0)
  const normalised = Math.abs(dot) / (firstLength * secondLength)
  const residuals = { dot, normalised }
  const tolerance = input.fact.tolerance ?? 1e-6
  if (normalised <= tolerance) {
    return { decision: "supported", method, domain, reasonCodes: ["limited_domain"], evidence: evidenceOf({ problemRevision: input.problemRevision, goalId: input.fact.goalId, method, decision: "supported", residuals }) }
  }
  return { decision: "refuted", method, domain, reasonCodes: ["counterexample_found"], counterexample: residuals, evidence: evidenceOf({ problemRevision: input.problemRevision, goalId: input.fact.goalId, method, decision: "refuted", residuals }) }
}

function quadraticInterval(input: { fact: QuadraticIntervalFact; candidate: GoalAnswer; problemRevision: string }): MathVerificationResult {
  const method = "quadratic-interval"
  const domain = "bounded_interval:quadratic"
  const claimed = numericOf(input.candidate)
  if (!finite(claimed)) return { decision: "unknown", method, domain, reasonCodes: ["candidate_not_numeric"] }
  const extremum = intervalExtremum(input.fact)
  if ("unknown" in extremum) return { decision: "unknown", method, domain, reasonCodes: [extremum.unknown] }
  const residuals = { value: extremum.value, claimed, at: extremum.at }
  if (closeTo(extremum.value, claimed)) {
    return { decision: "supported", method, domain, reasonCodes: ["limited_domain", extremum.attained ? "extremum_attained" : "supremum"], evidence: evidenceOf({ problemRevision: input.problemRevision, goalId: input.fact.goalId, method, decision: "supported", residuals }) }
  }
  return { decision: "refuted", method, domain, reasonCodes: ["counterexample_found"], counterexample: { ...residuals, claimed }, evidence: evidenceOf({ problemRevision: input.problemRevision, goalId: input.fact.goalId, method, decision: "refuted", residuals }) }
}

/**
 * 对一条候选答案跑**本题注册的数学判据**。
 *
 * 判据来自 `request.facts`（题族适配器给出）；模型无法声明事实，也无法声明"已核验"。
 * 任何一条判据否证即 `refuted`；全部支持才 `supported`；其余 `unknown`。
 */
export function verifyMathAnswer(request: MathVerificationRequest, budget: Budget, signal: AbortSignal): MathVerificationResult {
  const facts = (request.facts ?? []).filter((fact) => fact.goalId === request.goalId)
  if (facts.length === 0) return { decision: "unknown", method: "none", domain: "unregistered", reasonCodes: ["no_registered_criterion"] }
  if (signal.aborted) return { decision: "unknown", method: "none", domain: "cancelled", reasonCodes: ["cancelled"] }

  let lastUnknown: MathVerificationResult | undefined
  let lastSupported: MathVerificationResult | undefined
  for (const fact of facts) {
    if (signal.aborted) return { decision: "unknown", method: "none", domain: "cancelled", reasonCodes: ["cancelled"] }
    if (!budget.consume("geometry").ok) return { decision: "unknown", method: "none", domain: "budget", reasonCodes: ["budget_exhausted"] }
    const result = fact.kind === "hyperbola-foot-eccentricity"
      ? hyperbolaFoot({ fact, candidate: request.candidate, problemRevision: request.problemRevision })
      : fact.kind === "ellipse-eccentricity-range"
        ? ellipseRange({ fact, candidate: request.candidate, problemRevision: request.problemRevision })
        : fact.kind === "quadratic-interval"
          ? quadraticInterval({ fact, candidate: request.candidate, problemRevision: request.problemRevision })
          : fact.kind === "distance-equality"
            ? distanceEquality({ fact, candidate: request.candidate, problemRevision: request.problemRevision })
            : fact.kind === "perpendicular"
              ? perpendicular({ fact, candidate: request.candidate, problemRevision: request.problemRevision })
              // W6：第二批题族（圆锥曲线垂足/离心率、函数采样、精确概率、直角三角形、连分数）。
              : verifyDomainAnswer(fact, request.candidate, request.problemRevision)
    if (result.decision === "refuted") return result
    if (result.decision === "unknown") lastUnknown = result
    else lastSupported = result
  }
  // 一条域外就整题 `unknown`：部分判据通过不等于候选答案被支持。
  return lastUnknown ?? lastSupported ?? { decision: "unknown", method: "none", domain: "unregistered", reasonCodes: ["no_registered_criterion"] }
}
