import type { EvidenceRecord, GoalAnswer } from "../answerResult"
import { checkEllipseVertexBound, checkHyperbolaFoot, type Point2 } from "./conicChecks"
import { checkDrawProbability, exactProbability, type DrawCondition, type ExactFraction } from "./discreteProbabilityChecks"
import { checkFunctionClaim, type FunctionUnits } from "./functionChecks"
import { parseScalar } from "./mathAnswerVerification"
import { checkRightTriangle, type Point2 as PlanePoint } from "./planeGeometryChecks"
import { judgeMonotonicity } from "./sequenceChecks"

/**
 * **W6：第二批题族的宿主判据（2026-11-09）**。
 *
 * 与 W5（旧编号 T5）的 `mathAnswerVerification` 同一出口：事实只由题族适配器给出，
 * 判据用坐标/区间/有理数自己算，再与候选答案比。三条边界照旧：
 *
 * 1. **采样通过只能 `sampled`**，不能升级成"已核验"；
 * 2. **域外/退化/无法解析一律 `unknown`**，不猜；
 * 3. **否证必须落成 `failed` 证据**，不能只写日志。
 */

/** 双曲线：焦点到渐近线的垂足（候选是一个点）。 */
export interface HyperbolaAsymptoteFootFact {
  kind: "hyperbola-asymptote-foot"
  goalId: string
  a: number
  b: number
}

/** 椭圆离心率（候选是数值）。 */
export interface EllipseEccentricityFact {
  kind: "ellipse-eccentricity"
  goalId: string
  a: number
  b: number
}

/** 函数等价性：有限定义域内的采样反例（候选是表达式文本）。 */
export interface FunctionEquivalenceFact {
  kind: "function-equivalence"
  goalId: string
  reference: string
  domain: readonly [number, number]
  units?: FunctionUnits
  samples?: readonly number[]
}

/** 无放回/有放回取球的精确概率（候选是有理数）。 */
export interface DrawProbabilityFact {
  kind: "draw-probability"
  goalId: string
  condition: DrawCondition
  /** 题面条件真的绑定过（没有绑定就只能 unknown，不能用"3/10 计算器"冒充解析）。 */
  boundToProblem: boolean
}

/** 有限直角三角形的面积（候选是数值）。 */
export interface RightTriangleAreaFact {
  kind: "right-triangle-area"
  goalId: string
  points: readonly [PlanePoint, PlanePoint, PlanePoint]
}

/** 连分数序列的单调性（候选是结论文本；只能被否证，不能被采样证明）。 */
export interface ContinuedFractionMonotonicityFact {
  kind: "continued-fraction-monotonicity"
  goalId: string
  coefficients: readonly bigint[]
  claim: "increasing" | "decreasing"
}

export type DomainMathFact =
  | HyperbolaAsymptoteFootFact
  | EllipseEccentricityFact
  | FunctionEquivalenceFact
  | DrawProbabilityFact
  | RightTriangleAreaFact
  | ContinuedFractionMonotonicityFact

export interface DomainVerificationResult {
  decision: "supported" | "refuted" | "unknown"
  method: string
  domain: string
  reasonCodes: string[]
  evidenceStatus?: "verified_instance" | "sampled"
  counterexample?: Record<string, number>
  /** 判据自己算出来的量（供证据与诊断使用）。 */
  residuals?: Record<string, number | null>
  evidence?: EvidenceRecord
}

function closeTo(left: number, right: number, tolerance = 1e-6): boolean {
  return Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right))
}

function finite(value: number): boolean {
  return Number.isFinite(value)
}

/** 只解析 `(x, y)` / `x,y` 这类点；读不出就返回 `undefined`（随之 `unknown`）。 */
export function parsePoint(input: string): Point2 | undefined {
  const text = input.replace(/[（]/g, "(").replace(/[）]/g, ")").replace(/\s|\\left|\\right|[{}]/g, "")
  const match = /^\(?(-?\d+(?:\.\d+)?|√\d+(?:\.\d+)?)\/?(\d+(?:\.\d+)?)?,(-?\d+(?:\.\d+)?|√\d+(?:\.\d+)?)\/?(\d+(?:\.\d+)?)?\)?$/.exec(text)
  if (match === null) return undefined
  const component = (signValue: string | undefined, denominator: string | undefined): number | undefined => {
    if (signValue === undefined) return undefined
    const value = signValue.startsWith("√") ? Math.sqrt(Number(signValue.slice(1))) : Number(signValue)
    const divisor = denominator === undefined ? 1 : Number(denominator)
    if (!finite(value) || !finite(divisor) || divisor === 0) return undefined
    return value / divisor
  }
  const x = component(match[1], match[2])
  const y = component(match[3], match[4])
  return x === undefined || y === undefined ? undefined : { x, y }
}

function evidenceOf(input: {
  problemRevision: string
  goalId: string
  method: string
  decision: "supported" | "refuted"
  status: "verified_instance" | "sampled"
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
      status: input.decision === "supported" ? input.status : "failed",
      solver: "model",
      residuals: input.residuals,
      degreesOfFreedom: null,
      nextActions: input.nextActions ?? []
    }
  }
}

function hyperbolaAsymptoteFoot(fact: HyperbolaAsymptoteFootFact, candidate: GoalAnswer, problemRevision: string): DomainVerificationResult {
  const method = "hyperbola-asymptote-foot"
  const domain = "hyperbola:a>0,b>0"
  const point = parsePoint(candidate.value?.kind === "numeric" ? candidate.value.expression : candidate.displayText)
  if (point === undefined) return { decision: "unknown", method, domain, reasonCodes: ["candidate_not_point"] }
  const checked = checkHyperbolaFoot({ a: fact.a, b: fact.b, point })
  if (checked.decision === "unknown") return { decision: "unknown", method, domain, reasonCodes: checked.reasonCodes }
  const residuals = { ...checked.residuals }
  if (checked.decision === "refuted") {
    return { decision: "refuted", method, domain, reasonCodes: checked.reasonCodes,
      counterexample: { x: point.x, y: point.y, onLine: checked.residuals.onLine ?? 0, perpendicular: checked.residuals.perpendicular ?? 0 },
      evidence: evidenceOf({ problemRevision, goalId: fact.goalId, method, decision: "refuted", status: "verified_instance", residuals, nextActions: ["重算垂足：必须同时落在渐近线上并与焦点连线垂直"] }) }
  }
  return { decision: "supported", method, domain, reasonCodes: checked.reasonCodes, evidenceStatus: "verified_instance",
    residuals: checked.residuals,
    evidence: evidenceOf({ problemRevision, goalId: fact.goalId, method, decision: "supported", status: "verified_instance", residuals }) }
}

function ellipseEccentricity(fact: EllipseEccentricityFact, candidate: GoalAnswer, problemRevision: string): DomainVerificationResult {
  const method = "ellipse-eccentricity"
  const domain = "ellipse:0<b<a"
  if (!(fact.a > 0) || !(fact.b > 0) || !(fact.b < fact.a)) return { decision: "unknown", method, domain, reasonCodes: ["outside_supported_domain"] }
  const claimed = numericOf(candidate)
  if (!finite(claimed ?? Number.NaN)) return { decision: "unknown", method, domain, reasonCodes: ["candidate_not_numeric"] }
  const expected = Math.sqrt(1 - (fact.b * fact.b) / (fact.a * fact.a))
  const residuals = { claimed: claimed!, expected }
  if (closeTo(claimed!, expected)) {
    return { decision: "supported", method, domain, reasonCodes: ["limited_domain"], residuals,
      evidenceStatus: "verified_instance",
      evidence: evidenceOf({ problemRevision, goalId: fact.goalId, method, decision: "supported", status: "verified_instance", residuals }) }
  }
  return { decision: "refuted", method, domain, reasonCodes: ["counterexample_found"], counterexample: residuals, residuals,
    evidence: evidenceOf({ problemRevision, goalId: fact.goalId, method, decision: "refuted", status: "verified_instance", residuals }) }
}

function functionEquivalence(fact: FunctionEquivalenceFact, candidate: GoalAnswer, problemRevision: string): DomainVerificationResult {
  const method = "function-sampling"
  const domain = `function:${fact.domain[0]}..${fact.domain[1]}`
  const text = candidate.value?.kind === "numeric" || candidate.value?.kind === "interval" ? candidate.value.expression
    : candidate.value?.kind === "proof" ? candidate.value.conclusion : candidate.displayText
  const checked = checkFunctionClaim({ reference: fact.reference, candidate: text,
    domain: fact.domain, ...(fact.units === undefined ? {} : { units: fact.units }), ...(fact.samples === undefined ? {} : { samples: fact.samples }) })
  if (checked.decision === "unknown") return { decision: "unknown", method, domain, reasonCodes: checked.reasonCodes }
  if (checked.decision === "refuted") {
    return { decision: "refuted", method, domain, reasonCodes: checked.reasonCodes,
      ...(checked.counterexample === undefined ? {} : { counterexample: checked.counterexample }),
      evidence: evidenceOf({ problemRevision, goalId: fact.goalId, method, decision: "refuted", status: "verified_instance",
        residuals: checked.counterexample ?? {} }) }
  }
  // 采样通过只是 `sampled`：**不**升级成 verified_instance，更不可能是形式证明。
  return { decision: "supported", method, domain, reasonCodes: checked.reasonCodes, evidenceStatus: "sampled",
    residuals: { samplesChecked: checked.samplesChecked }, 
    evidence: evidenceOf({ problemRevision, goalId: fact.goalId, method, decision: "supported", status: "sampled", residuals: { samplesChecked: checked.samplesChecked } }) }
}

function drawProbability(fact: DrawProbabilityFact, candidate: GoalAnswer, problemRevision: string): DomainVerificationResult {
  const method = "exact-draw-probability"
  const domain = "finite:equal-likelihood"
  const claimed = fractionOf(candidate)
  if (claimed === null) return { decision: "unknown", method, domain, reasonCodes: ["candidate_not_fraction"] }
  const checked = checkDrawProbability({ condition: fact.condition, candidate: claimed, boundToProblem: fact.boundToProblem })
  if (checked.decision === "unknown") return { decision: "unknown", method, domain, reasonCodes: checked.reasonCodes }
  const residuals = { numerator: Number(checked.candidate.numerator), denominator: Number(checked.candidate.denominator),
    expectedNumerator: Number(checked.expected.numerator), expectedDenominator: Number(checked.expected.denominator) }
  if (checked.decision === "refuted") {
    return { decision: "refuted", method, domain, reasonCodes: ["counterexample_found"], counterexample: residuals,
      evidence: evidenceOf({ problemRevision, goalId: fact.goalId, method, decision: "refuted", status: "verified_instance", residuals }) }
  }
  return { decision: "supported", method, domain, reasonCodes: ["limited_domain"], residuals, evidenceStatus: "verified_instance",
    evidence: evidenceOf({ problemRevision, goalId: fact.goalId, method, decision: "supported", status: "verified_instance", residuals }) }
}

function rightTriangleArea(fact: RightTriangleAreaFact, candidate: GoalAnswer, problemRevision: string): DomainVerificationResult {
  const method = "right-triangle-area"
  const domain = "plane:nondegenerate-right-triangle"
  const claimed = numericOf(candidate)
  if (!finite(claimed ?? Number.NaN)) return { decision: "unknown", method, domain, reasonCodes: ["candidate_not_numeric"] }
  const checked = checkRightTriangle(fact.points, claimed!)
  if (checked.decision === "unknown") return { decision: "unknown", method, domain, reasonCodes: checked.reasonCodes }
  const residuals = { area: checked.area ?? 0, claimed: claimed! }
  if (checked.decision === "refuted") {
    return { decision: "refuted", method, domain, reasonCodes: ["counterexample_found"], counterexample: residuals,
      evidence: evidenceOf({ problemRevision, goalId: fact.goalId, method, decision: "refuted", status: "verified_instance", residuals }) }
  }
  return { decision: "supported", method, domain, reasonCodes: ["limited_domain"], residuals, evidenceStatus: "verified_instance",
    evidence: evidenceOf({ problemRevision, goalId: fact.goalId, method, decision: "supported", status: "verified_instance", residuals }) }
}

const MONOTONE_CLAIM = /单调(?:递减|减少|下降)|递减|单调减/

function continuedFractionMonotonicity(fact: ContinuedFractionMonotonicityFact, candidate: GoalAnswer, problemRevision: string): DomainVerificationResult {
  const method = "continued-fraction-monotonicity"
  const domain = "continued-fraction:positive-integers"
  const text = candidate.value?.kind === "proof" ? candidate.value.conclusion : candidate.displayText
  // 只认"断言单调递减"这一种结论；其余文本一律 unknown（不能被当成立）。
  if (!(fact.claim === "decreasing" && MONOTONE_CLAIM.test(text))) return { decision: "unknown", method, domain, reasonCodes: ["claim_not_checkable"] }
  const checked = judgeMonotonicity({ coefficients: fact.coefficients, claim: fact.claim })
  if (checked.decision === "unknown") return { decision: "unknown", method, domain, reasonCodes: checked.reasonCodes }
  const counterexample = checked.counterexample
  return { decision: "refuted", method, domain, reasonCodes: checked.reasonCodes,
    ...(counterexample === undefined ? {} : { counterexample: { at: counterexample.at, previous: counterexample.previous, next: counterexample.next } }),
    evidence: evidenceOf({ problemRevision, goalId: fact.goalId, method, decision: "refuted", status: "verified_instance",
      residuals: counterexample === undefined ? {} : { previous: counterexample.previous, next: counterexample.next } }) }
}

/** 数值：结构值优先，其次显示文本；只认 `parseScalar` 的形状。 */
function numericOf(candidate: GoalAnswer): number | undefined {
  const value = candidate.value
  if (value?.kind === "numeric") {
    if (Number.isFinite(value.approximation)) return value.approximation
    const parsed = parseScalar(value.expression)
    if (parsed !== undefined) return parsed
  }
  return parseScalar(candidate.displayText)
}

/** 有理数：`a/b` / 整数；读不出或为负返回 `null`（不静默改符号）。 */
function fractionOf(candidate: GoalAnswer): ExactFraction | null {
  const text = (candidate.value?.kind === "numeric" ? candidate.value.expression : candidate.displayText).replace(/\s/g, "")
  const fraction = /^(\d+)\/(\d+)$/.exec(text)
  if (fraction !== null) {
    const denominator = BigInt(fraction[2]!)
    if (denominator === 0n) return null
    return exactProbability(denominator, BigInt(fraction[1]!))
  }
  const integer = /^(\d+)$/.exec(text)
  return integer === null ? null : exactProbability(1n, BigInt(integer[1]!))
}

export function verifyDomainAnswer(fact: DomainMathFact, candidate: GoalAnswer, problemRevision: string): DomainVerificationResult {
  switch (fact.kind) {
    case "hyperbola-asymptote-foot": return hyperbolaAsymptoteFoot(fact, candidate, problemRevision)
    case "ellipse-eccentricity": return ellipseEccentricity(fact, candidate, problemRevision)
    case "function-equivalence": return functionEquivalence(fact, candidate, problemRevision)
    case "draw-probability": return drawProbability(fact, candidate, problemRevision)
    case "right-triangle-area": return rightTriangleArea(fact, candidate, problemRevision)
    case "continued-fraction-monotonicity": return continuedFractionMonotonicity(fact, candidate, problemRevision)
  }
}

export { checkEllipseVertexBound, checkHyperbolaFoot, checkRightTriangle, checkDrawProbability, checkFunctionClaim, judgeMonotonicity, exactProbability }
export type { DrawCondition, ExactFraction, FunctionUnits }
