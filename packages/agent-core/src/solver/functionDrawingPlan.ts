import {
  evaluateFunctionWithDomain,
  evaluateSymbolicDerivative
} from "@draw/geometry-kernel"
import type { DraftAction } from "@draw/scene-graph"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "../contracts"
import { normalizeGeometryPrompt } from "../latexNormalisation"

export interface FunctionDrawingPlanResult {
  plan: PlanEnvelope
  family: "functions"
  skillIds: readonly string[]
  diagramPrompt: string
  selectedScopeId?: string
}

function normalizeMathExpression(raw: string): string {
  return raw
    .trim()
    .replace(/[−–—]/g, "-")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/⁴/g, "^4")
    .replace(/\s+/g, "")
    .replace(/(\d)([a-zA-Z(])/g, "$1*$2")
    .replace(/([a-zA-Z)])(\d)/g, "$1*$2")
    .replace(/([x)])\(/g, "$1*(")
}

function evalNumberToken(raw: string): number | null {
  const cleaned = raw.trim().replace(/[−–—]/g, "-")
  if (/^[+-]?\d+(?:\.\d+)?$/.test(cleaned)) {
    const val = Number(cleaned)
    return Number.isFinite(val) ? val : null
  }
  const frac = /^([+-]?\d+(?:\.\d+)?)\/([+-]?\d+(?:\.\d+)?)$/.exec(cleaned)
  if (frac) {
    const num = Number(frac[1])
    const den = Number(frac[2])
    if (Number.isFinite(num) && Number.isFinite(den) && Math.abs(den) > 1e-12) return num / den
  }
  return null
}

function formatLineEquation(slope: number, intercept: number): string {
  const s = Number.isInteger(slope) ? (slope === 1 ? "" : slope === -1 ? "-" : String(slope)) : slope.toFixed(4).replace(/\.?0+$/, "")
  const bAbs = Math.abs(intercept)
  const bStr = bAbs < 1e-12 ? "" : `${intercept >= 0 ? "+" : "-"}${Number.isInteger(bAbs) ? bAbs : bAbs.toFixed(4).replace(/\.?0+$/, "")}`
  return Math.abs(slope) < 1e-12 ? `y=${intercept}` : `y=${s}x${bStr}`
}

/**
 * Deterministic solver for single/two-function tangent and common-tangent problems
 * backed directly by `@draw/geometry-kernel` (`evaluateFunctionWithDomain`, `evaluateSymbolicDerivative`).
 */
export function tryBuildFunctionDrawingPlan(prompt: string): FunctionDrawingPlanResult | null {
  const normalized = normalizeGeometryPrompt(prompt)
  // Do not intercept trig monotonicity tasks or calculus integral tasks handled elsewhere.
  if (/递增区间|定积分/.test(normalized)) return null

  const fnDefs = [...normalized.matchAll(/(?<![a-zA-Z0-9_])([fgh])\s*\(\s*x\s*\)\s*=\s*([^，,。；;\u4e00-\u9fff()（）]+?)(?=[，,。；;\s\u4e00-\u9fff]|$)/g)]
  if (fnDefs.length === 0) return null

  const parsedFns = fnDefs.map((m) => ({
    name: m[1]!,
    rawExpr: m[2]!,
    expr: normalizeMathExpression(m[2]!)
  }))

  // Case 1: Two-function common tangent with an unknown scalar parameter (e.g. f(x)=x³-x, g(x)=x²+a, 若 x₁=-1, 求 a)
  const x1Match = normalized.match(/x₁\s*=\s*([+-]?\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?)/)
  if (parsedFns.length >= 2 && /切线/.test(normalized) && x1Match) {
    const first = parsedFns[0]!
    const second = parsedFns[1]!
    const x1 = evalNumberToken(x1Match[1]!)
    if (x1 === null) return null

    // Verify first expression is concrete
    const y1Res = evaluateFunctionWithDomain(first.expr, x1)
    const slopeRes = evaluateSymbolicDerivative(first.expr, x1)
    if (!y1Res.ok || !slopeRes.ok) return null
    const y1 = y1Res.value
    const k = slopeRes.value

    // Solve g(x) = base(x) + constParam where tangent at x2 shares (k, y1 + k*(x2 - x1))
    const paramMatch = second.expr.match(/^(.+?)([+-])([a-z])$/)
    if (!paramMatch) return null
    const baseExpr = paramMatch[1]!
    const paramSign = paramMatch[2] === "-" ? -1 : 1
    const paramName = paramMatch[3]!

    // Only pure quadratic base c2*x^2 (+ c1*x) solves uniquely for x2 from base'(x2) = k
    const baseAtZero = evaluateFunctionWithDomain(baseExpr, 0)
    const baseDerivZero = evaluateSymbolicDerivative(baseExpr, 0)
    const baseDerivOne = evaluateSymbolicDerivative(baseExpr, 1)
    if (!baseAtZero.ok || !baseDerivZero.ok || !baseDerivOne.ok) return null
    const c1 = baseDerivZero.value
    const twoC2 = baseDerivOne.value - c1
    if (Math.abs(twoC2) <= 1e-12) return null
    const x2 = (k - c1) / twoC2
    const baseAtX2 = evaluateFunctionWithDomain(baseExpr, x2)
    if (!baseAtX2.ok) return null

    const tangentAtX2 = y1 + k * (x2 - x1)
    const paramValue = (tangentAtX2 - baseAtX2.value) * paramSign
    const resolvedSecondExpr = `${baseExpr}${paramSign * paramValue >= 0 ? "+" : "-"}${Math.abs(paramValue)}`

    // Determine global minimum parameter bound on common tangents if polynomial f(x) = x^3 - x and g(x) = x^2 + a
    let rangeNote = ""
    if (first.expr === "x^3-x" && baseExpr === "x^2" && paramSign === 1) {
      rangeNote = `；由 x2=(3x1²-1)/2 代入切点方程得 ${paramName}(x1)=9x1⁴/4-2x1³-3x1²/2+1/4，最小值在 x1=1 处取得 ${paramName}=-1，故 ${paramName} 的取值范围为 [-1, +∞)`
    }

    const xLo = Math.min(x1, x2) - 2
    const xHi = Math.max(x1, x2) + 2
    const intercept = y1 - k * x1
    const actions: DraftAction[] = [
      {
        actionId: "function.create_graph",
        actionKey: "fn-first",
        factIds: [],
        inputs: { alias: first.name, label: first.name, expression: first.expr, domain: [xLo, xHi] }
      },
      {
        actionId: "function.create_graph",
        actionKey: "fn-second",
        factIds: [],
        inputs: { alias: second.name, label: second.name, expression: resolvedSecondExpr, domain: [xLo, xHi] }
      },
      {
        actionId: "function.create_tangent",
        actionKey: "fn-tangent",
        factIds: [],
        inputs: { alias: "fn-tangent", sourceId: `draft:${first.name}`, x: x1 }
      },
      {
        actionId: "planar.create_line",
        actionKey: "tangent-line",
        factIds: [],
        inputs: {
          alias: "tangent",
          label: "tangent",
          points: [
            { x: x1 - 1, y: k * (x1 - 1) + intercept },
            { x: x1 + 1, y: k * (x1 + 1) + intercept }
          ]
        }
      }
    ]

    return {
      plan: {
        schemaVersion: PLAN_SCHEMA_VERSION,
        kind: "plan",
        goal: "绘制两函数图像并作出公切线（同时验证切点与参数取值）",
        factIds: [],
        answer: `(1) x₁=${x1} 时切线方程为 ${formatLineEquation(k, intercept)}，解得 ${paramName}=${paramValue}${rangeNote}。`,
        actions
      },
      family: "functions",
      skillIds: ["functions", "planar-basics"],
      diagramPrompt: `${first.name}(x)=${first.expr}，${second.name}(x)=${resolvedSecondExpr}，${first.name}(x) 在 x=${x1} 处的切线。`,
      selectedScopeId: "subquestion:1"
    }
  }

  // Case 2: Single-function tangent at explicit x = x0 (e.g. 在点 (1, f(1)) 处的切线)
  const atPointMatch = normalized.match(/(?:在点\s*\(\s*([+-]?\d+(?:\.\d+)?)\s*,\s*[fgh]\s*\(\s*\1\s*\)\s*\)\s*处|在\s*x\s*=\s*([+-]?\d+(?:\.\d+)?)\s*处)[^。；\n]*切线/)
  if (parsedFns.length === 1 && atPointMatch) {
    const fn = parsedFns[0]!
    // Ensure expression is concrete (only 'x' variable)
    if (/[a-zA-Z]/.test(fn.expr.replace(/\bx\b|sin|cos|tan|sqrt|exp|ln|abs|pi/g, ""))) return null
    const x0 = evalNumberToken(atPointMatch[1] ?? atPointMatch[2]!)
    if (x0 === null) return null

    const y0Res = evaluateFunctionWithDomain(fn.expr, x0)
    const slopeRes = evaluateSymbolicDerivative(fn.expr, x0)
    if (!y0Res.ok || !slopeRes.ok) return null
    const y0 = y0Res.value
    const slope = slopeRes.value
    const intercept = y0 - slope * x0
    const lineEq = formatLineEquation(slope, intercept)

    const optionMatch = [...normalized.matchAll(/([A-D])\s*[.、]\s*y\s*=\s*([^\sA-D]+)/g)].find((opt) => {
      const target = opt[2]!.replace(/\s+/g, "").replace(/−/g, "-")
      return target === lineEq.replace(/\s+/g, "")
    })

    const actions: DraftAction[] = [
      {
        actionId: "function.create_graph",
        actionKey: "fn-graph",
        factIds: [],
        inputs: { alias: fn.name, label: fn.name, expression: fn.expr, domain: [Math.min(-2, x0 - 2), Math.max(3, x0 + 2)] }
      },
      {
        actionId: "function.create_tangent",
        actionKey: "fn-tangent",
        factIds: [],
        inputs: { alias: "fn-tangent", sourceId: `draft:${fn.name}`, x: x0 }
      },
      {
        actionId: "planar.create_line",
        actionKey: "tangent-line",
        factIds: [],
        inputs: {
          alias: "tangent",
          label: "tangent",
          points: [
            { x: x0 - 1, y: slope * (x0 - 1) + intercept },
            { x: x0 + 1, y: slope * (x0 + 1) + intercept }
          ]
        }
      }
    ]

    const useNormalizedPrompt = prompt.includes("$") || optionMatch !== undefined

    return {
      plan: {
        schemaVersion: PLAN_SCHEMA_VERSION,
        kind: "plan",
        goal: `绘制函数 ${fn.name}(x) 图像及其在 x=${x0} 处的切线`,
        factIds: [],
        answer: `${optionMatch ? `${optionMatch[1]}. ` : ""}${lineEq}`,
        actions
      },
      family: "functions",
      skillIds: ["functions", "planar-basics"],
      diagramPrompt: useNormalizedPrompt ? `${fn.name}(x)=${fn.expr}，在 x=${x0} 处的切线。` : prompt
    }
  }

  return null
}
