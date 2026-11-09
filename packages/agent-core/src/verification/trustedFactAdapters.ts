import type { MathFact } from "./mathAnswerVerification"

/**
 * **题族事实适配器（W6，2026-11-09）**。
 *
 * 输入**只有**题面条件（原文 + 它绑定的目标 id），输出既有 `MathFact[]`。
 * 三条硬边界：
 *
 * 1. **不读模型给的坐标**：适配器只从原文里读方程/区间/系数；候选点只能作为待验 c(answer)
 *    进核验器，永远进不了 facts；
 * 2. **目标不唯一就不猜**：一条条件绑定多个目标时直接跳过（宁可 `unknown`）；
 * 3. **读不全就不生成**：缺一个系数、分母为 0、退化参数都返回空，而不是补一个常见值。
 */

export interface FactCondition {
  id: string
  sourceText: string
  /** 这条条件绑定的目标 id（来自题意层 IR，不是模型自报）。 */
  goalIds: readonly string[]
}

export interface TrustedFactInput {
  problemRevision: string
  conditions: readonly FactCondition[]
}

const NUMBER = String.raw`\d+(?:\.\d+)?`

function normalize(text: string): string {
  return text
    .replace(/[（]/g, "(").replace(/[）]/g, ")")
    .replace(/\\left|\\right/g, "")
    .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, "($1)/($2)")
    .replace(/\s+/g, "")
}

function finite(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function hyperbolaFact(source: string, goalId: string): MathFact | undefined {
  // `x²/9 − y²/16 = 1`（也接受 `x^2/9-y^2/16=1` 与 LaTeX 分式）。
  const match = new RegExp(`x(?:\\^2|²)?/(${NUMBER})[-−]y(?:\\^2|²)?/(${NUMBER})=1`).exec(source)
  if (match === null) return undefined
  const semiMajorSquared = Number(match[1])
  const semiMinorSquared = Number(match[2])
  if (!finite(semiMajorSquared) || !finite(semiMinorSquared)) return undefined
  return { kind: "hyperbola-asymptote-foot", goalId, a: Math.sqrt(semiMajorSquared), b: Math.sqrt(semiMinorSquared) }
}

function ellipseFact(source: string, goalId: string): MathFact | undefined {
  // `x²/4 + y²/1 = 1`；`y²` 不带分母时按 1 处理。
  const match = new RegExp(`x(?:\\^2|²)?/(${NUMBER})\\+y(?:\\^2|²)?(?:/(${NUMBER}))?=1`).exec(source)
  if (match === null) return undefined
  const majorSquared = Number(match[1])
  const minorSquared = match[2] === undefined ? 1 : Number(match[2])
  if (!finite(majorSquared) || !finite(minorSquared) || !(majorSquared > minorSquared)) return undefined
  return { kind: "ellipse-eccentricity", goalId, a: Math.sqrt(majorSquared), b: Math.sqrt(minorSquared) }
}

function drawFact(source: string, goalId: string): MathFact | undefined {
  // `袋中有 3 个红球、2 个蓝球，不放回取 2 个`。
  const counts = /(\d+)\s*个红球/.exec(source)
  const blues = /(\d+)\s*个蓝球/.exec(source)
  const draws = /(?:取|摸)\s*(\d+)\s*个/.exec(source)
  if (counts === null || blues === null || draws === null) return undefined
  const red = Number(counts[1])
  const blue = Number(blues[1])
  const take = Number(draws[1])
  if (!Number.isSafeInteger(red) || !Number.isSafeInteger(blue) || !Number.isSafeInteger(take) || red <= 0 || take <= 0) return undefined
  const replacement = /不放回|无放回/.test(source) ? "without" : /放回/.test(source) ? "with" : undefined
  if (replacement === undefined) return undefined
  return { kind: "draw-probability", goalId, condition: { red, blue, draws: take, replacement }, boundToProblem: true }
}

function rightTriangleFact(source: string, goalId: string): MathFact | undefined {
  // `A(0,0)、B(3,0)、C(0,4)`（点名与坐标都来自原文）。
  const point = /([A-Z])\s*\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/g
  const points: { name: string; x: number; y: number }[] = []
  for (const match of source.matchAll(point)) {
    const x = Number(match[2])
    const y = Number(match[3])
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined
    points.push({ name: match[1]!, x, y })
  }
  if (points.length !== 3 || new Set(points.map((entry) => entry.name)).size !== 3) return undefined
  const [first, second, third] = points
  if (first === undefined || second === undefined || third === undefined) return undefined
  return { kind: "right-triangle-area", goalId, points: [
    { x: first.x, y: first.y }, { x: second.x, y: second.y }, { x: third.x, y: third.y }
  ] }
}

/** 从题面条件生成宿主事实。同一条件只生成**一条**事实；目标不唯一则不生成。 */
export function conditionMathFacts(input: TrustedFactInput): MathFact[] {
  if (!input.problemRevision) return []
  const facts: MathFact[] = []
  const seen = new Set<string>()
  for (const condition of input.conditions) {
    const goalIds = [...new Set(condition.goalIds.filter((id) => id.length > 0))]
    if (goalIds.length !== 1) continue
    const goalId = goalIds[0]!
    if (seen.has(goalId)) continue
    const source = normalize(condition.sourceText)
    const fact = hyperbolaFact(source, goalId) ?? ellipseFact(source, goalId) ?? drawFact(source, goalId) ?? rightTriangleFact(source, goalId)
    if (fact === undefined) continue
    seen.add(goalId)
    facts.push(fact)
  }
  return facts
}
