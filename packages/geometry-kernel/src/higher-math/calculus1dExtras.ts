import {
  differentiateExpressionAst,
  formatPrettyMath,
  parseExpression,
  simplifyExpressionAst
} from "../expression"
import {
  compileScalarField1D,
  normalizeHigherMathInput,
  type CompiledScalarField1D
} from "./bytecode"
import { brentOptimize1D } from "./extrema1d"

export interface DefiniteIntegral1DAnalysis {
  domain: [number, number]
  signedArea: number
  absoluteArea: number
  averageValue: number
  arcLength: number
  revolutionVolumeX: number
}

export interface Root1DPoint {
  x: number
  y: number
}

export interface Tangent1DAnalysis {
  x0: number
  y0: number
  slope: number
  secondDerivative: number
  curvature: number
  curvatureRadius: number
  tangentEquation: string
  normalEquation: string
  symbolicDerivativePretty: string | null
}

export type LimitTarget1D =
  | { kind: "point"; x0: number }
  | { kind: "pos_inf" }
  | { kind: "neg_inf" }

export type LimitSideValue =
  | { kind: "finite"; value: number }
  | { kind: "pos_inf" }
  | { kind: "neg_inf" }
  | { kind: "dne" }

export type ContinuityKind =
  | "continuous"
  | "removable"
  | "jump"
  | "infinite"
  | "oscillating"
  | "boundary"

export interface Limit1DAnalysis {
  target: LimitTarget1D
  leftLimit?: LimitSideValue
  rightLimit?: LimitSideValue
  overallLimit: LimitSideValue
  valueAtPoint?: number | null
  continuity?: ContinuityKind
  summary: string
}

export interface DualCurve1DAnalysis {
  gExpression: string
  gSegments: Array<Array<{ x: number; y: number }>>
  intersections: Array<{ x: number; y: number }>
  areaBetween: number
  signedDiffIntegral: number
}

// 8-point Gauss-Legendre nodes & weights on [-1, 1]
const GL8_NODES = [
  -0.9602898564975363,
  -0.7966664774136267,
  -0.525532409916329,
  -0.1834346424956498,
  0.1834346424956498,
  0.525532409916329,
  0.7966664774136267,
  0.9602898564975363
]
const GL8_WEIGHTS = [
  0.1012285362903763,
  0.2223810344533745,
  0.3137066458778873,
  0.362683783378362,
  0.362683783378362,
  0.3137066458778873,
  0.2223810344533745,
  0.1012285362903763
]

function integrateCompositeGL8(fn: (x: number) => number, a: number, b: number, panels = 48): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b - a) < 1e-12) return 0
  const sign = b >= a ? 1 : -1
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  const h = (hi - lo) / panels
  let total = 0
  let validPanels = 0
  for (let p = 0; p < panels; p += 1) {
    const x0 = lo + p * h
    const mid = x0 + 0.5 * h
    const half = 0.5 * h
    let panelSum = 0
    let ok = true
    for (let k = 0; k < 8; k += 1) {
      const val = fn(mid + half * GL8_NODES[k]!)
      if (!Number.isFinite(val) || Math.abs(val) > 1e7) {
        ok = false
        break
      }
      panelSum += GL8_WEIGHTS[k]! * val
    }
    if (ok) {
      total += half * panelSum
      validPanels += 1
    }
  }
  return validPanels === 0 ? Number.NaN : sign * total
}

export function analyzeDefiniteIntegral1D(
  field: CompiledScalarField1D,
  domain: [number, number]
): DefiniteIntegral1DAnalysis {
  const [a, b] = domain
  const signedArea = integrateCompositeGL8((x) => field.eval(x), a, b, 64)
  const absoluteArea = integrateCompositeGL8((x) => Math.abs(field.eval(x)), a, b, 64)
  const averageValue = Math.abs(b - a) > 1e-9 ? signedArea / (b - a) : Number.NaN
  const arcLength = integrateCompositeGL8((x) => {
    const d = field.derivative(x)
    return Number.isFinite(d) ? Math.hypot(1, d) : Number.NaN
  }, a, b, 64)
  const revolutionVolumeX = Math.PI * integrateCompositeGL8((x) => {
    const v = field.eval(x)
    return Number.isFinite(v) ? v * v : Number.NaN
  }, a, b, 64)

  return {
    domain,
    signedArea,
    absoluteArea,
    averageValue,
    arcLength,
    revolutionVolumeX
  }
}

function bisectZero(fn: (x: number) => number, a: number, b: number, maxIter = 52): number {
  let lo = a
  let hi = b
  let flo = fn(lo)
  for (let i = 0; i < maxIter; i += 1) {
    const mid = 0.5 * (lo + hi)
    const fmid = fn(mid)
    if (!Number.isFinite(fmid) || Math.abs(fmid) < 1e-12 || Math.abs(hi - lo) < 1e-11) return mid
    if ((flo > 0 && fmid > 0) || (flo < 0 && fmid < 0)) {
      lo = mid
      flo = fmid
    } else {
      hi = mid
    }
  }
  return 0.5 * (lo + hi)
}

export function findRootsInDomain(
  fn: (x: number) => number,
  domain: [number, number],
  samples = 360
): number[] {
  const [a, b] = domain
  const span = b - a
  if (!Number.isFinite(span) || span <= 1e-9) return []
  const h = span / samples
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i <= samples; i += 1) {
    const x = a + i * h
    xs.push(x)
    ys.push(fn(x))
  }

  const candidates: number[] = []
  const dedupeTol = Math.max(1e-4, span * 2e-4)

  const addCandidate = (x: number) => {
    if (!Number.isFinite(x) || x < a - 1e-7 || x > b + 1e-7) return
    const clamped = Math.max(a, Math.min(b, x))
    const val = fn(clamped)
    if (!Number.isFinite(val) || Math.abs(val) > 1e-3) return
    for (const prev of candidates) {
      if (Math.abs(prev - clamped) <= dedupeTol) return
    }
    candidates.push(clamped)
  }

  for (let i = 0; i < samples; i += 1) {
    const y0 = ys[i]!
    const y1 = ys[i + 1]!
    if (!Number.isFinite(y0) || !Number.isFinite(y1)) continue
    if (Math.abs(y0) < 1e-10) {
      addCandidate(xs[i]!)
      continue
    }
    if ((y0 < 0 && y1 > 0) || (y0 > 0 && y1 < 0)) {
      // Avoid false pole sign flips where jump is huge
      if (Math.abs(y1 - y0) < 1e4) {
        addCandidate(bisectZero(fn, xs[i]!, xs[i + 1]!))
      }
    } else if (i > 0 && i < samples - 1) {
      // Catch even-multiplicity tangent zeros like x^2 = 0
      const ym = Math.abs(y0)
      if (ym < Math.abs(ys[i - 1]!) && ym <= Math.abs(y1) && ym < 0.08) {
        const refined = brentOptimize1D((x) => Math.abs(fn(x)), xs[i - 1]!, xs[i + 1]!, false)
        if (Math.abs(fn(refined.x)) < 1e-5) addCandidate(refined.x)
      }
    }
  }
  if (Number.isFinite(ys[samples]!) && Math.abs(ys[samples]!) < 1e-9) {
    addCandidate(b)
  }

  return candidates.sort((u, v) => u - v)
}

export function findRoots1D(field: CompiledScalarField1D, domain: [number, number]): Root1DPoint[] {
  return findRootsInDomain((x) => field.eval(x), domain).map((x) => ({ x, y: field.eval(x) }))
}

function fmtEqNum(v: number, digits = 3): string {
  const clean = Math.abs(v) < 1e-7 ? 0 : v
  return Number(clean.toFixed(digits)).toString()
}

function formatLinearEquation(slope: number, x0: number, y0: number): string {
  if (!Number.isFinite(slope) || !Number.isFinite(y0)) return "—"
  if (Math.abs(slope) < 1e-6) return `y = ${fmtEqNum(y0)}`
  const intercept = y0 - slope * x0
  const kStr = Math.abs(slope - 1) < 1e-6 ? "" : Math.abs(slope + 1) < 1e-6 ? "−" : fmtEqNum(slope)
  if (Math.abs(intercept) < 1e-6) return `y = ${kStr}x`
  const sign = intercept >= 0 ? " + " : " − "
  return `y = ${kStr}x${sign}${fmtEqNum(Math.abs(intercept))}`
}

export function analyzeTangentAndDerivative1D(
  expression: string,
  field: CompiledScalarField1D,
  x0: number
): Tangent1DAnalysis {
  let symbolicDerivativePretty: string | null = null
  try {
    const normalized = normalizeHigherMathInput(expression, "expression")
    const ast = parseExpression(normalized)
    const dAst = differentiateExpressionAst(ast, "x")
    if (dAst) {
      symbolicDerivativePretty = formatPrettyMath(simplifyExpressionAst(dAst))
    }
  } catch {
    symbolicDerivativePretty = null
  }

  const y0 = field.eval(x0)
  const slope = field.derivative(x0)
  const h = 1e-4 * Math.max(1, Math.abs(x0))
  const dPlus = field.derivative(x0 + h)
  const dMinus = field.derivative(x0 - h)
  const secondDerivative = Number.isFinite(dPlus) && Number.isFinite(dMinus) ? (dPlus - dMinus) / (2 * h) : Number.NaN

  const curvature = Number.isFinite(slope) && Number.isFinite(secondDerivative)
    ? Math.abs(secondDerivative) / Math.pow(1 + slope * slope, 1.5)
    : Number.NaN
  const curvatureRadius = Number.isFinite(curvature) && curvature > 1e-9 ? 1 / curvature : Number.POSITIVE_INFINITY

  const tangentEquation = formatLinearEquation(slope, x0, y0)
  const normalEquation = !Number.isFinite(slope)
    ? `y = ${fmtEqNum(y0)}`
    : Math.abs(slope) < 1e-6
      ? `x = ${fmtEqNum(x0)}`
      : formatLinearEquation(-1 / slope, x0, y0)

  return {
    x0,
    y0,
    slope,
    secondDerivative,
    curvature,
    curvatureRadius,
    tangentEquation,
    normalEquation,
    symbolicDerivativePretty
  }
}

function probeSequenceLimit(samples: number[]): LimitSideValue {
  const finite = samples.filter((v) => Number.isFinite(v))
  if (finite.length < 3) return { kind: "dne" }

  const tail = finite.slice(-4)
  const last = tail[tail.length - 1]!
  const prev = tail[tail.length - 2]!
  const prev2 = tail[tail.length - 3]!

  // Check divergence to +∞ / -∞
  if (Math.abs(last) > 1e5 && Math.abs(last) > Math.abs(prev) * 2.5 && Math.sign(last) === Math.sign(prev)) {
    return last > 0 ? { kind: "pos_inf" } : { kind: "neg_inf" }
  }

  // Check finite convergence (shrinking differences)
  const d1 = Math.abs(last - prev)
  const d2 = Math.abs(prev - prev2)
  const scale = Math.max(1, Math.abs(last))
  if (d1 < 1e-4 * scale && d1 <= d2 * 1.5 + 1e-9) {
    const clean = Math.abs(last) < 1e-8 ? 0 : last
    return { kind: "finite", value: clean }
  }

  return { kind: "dne" }
}

export function formatLimitValue(v: LimitSideValue): string {
  if (v.kind === "finite") return Number(v.value.toFixed(6)).toString()
  if (v.kind === "pos_inf") return "+∞"
  if (v.kind === "neg_inf") return "−∞"
  return "不存在 / 震荡"
}

export function analyzeLimit1D(field: CompiledScalarField1D, target: LimitTarget1D): Limit1DAnalysis {
  if (target.kind === "pos_inf" || target.kind === "neg_inf") {
    const sign = target.kind === "pos_inf" ? 1 : -1
    const pts = [1e1, 5e1, 2e2, 1e3, 5e3, 2e4, 1e5, 5e5].map((m) => field.eval(sign * m))
    const overallLimit = probeSequenceLimit(pts)
    const dirLabel = target.kind === "pos_inf" ? "+∞" : "−∞"
    return {
      target,
      overallLimit,
      summary: `lim(x → ${dirLabel}) f(x) = ${formatLimitValue(overallLimit)}`
    }
  }

  const { x0 } = target
  const deltas = [1e-1, 3e-2, 1e-2, 3e-3, 1e-3, 3e-4, 1e-4, 3e-5, 1e-5]
  const leftLimit = probeSequenceLimit(deltas.map((d) => field.eval(x0 - d)))
  const rightLimit = probeSequenceLimit(deltas.map((d) => field.eval(x0 + d)))
  const rawAtPoint = field.eval(x0)
  const valueAtPoint = Number.isFinite(rawAtPoint) ? rawAtPoint : null

  let overallLimit: LimitSideValue = { kind: "dne" }
  let continuity: ContinuityKind = "oscillating"

  if (leftLimit.kind === "finite" && rightLimit.kind === "finite") {
    const diff = Math.abs(leftLimit.value - rightLimit.value)
    const tol = 1e-3 * Math.max(1, Math.abs(leftLimit.value), Math.abs(rightLimit.value))
    if (diff <= tol) {
      const avg = 0.5 * (leftLimit.value + rightLimit.value)
      overallLimit = { kind: "finite", value: Math.abs(avg) < 1e-8 ? 0 : avg }
      if (valueAtPoint !== null && Math.abs(valueAtPoint - overallLimit.value) <= tol * 5) {
        continuity = "continuous"
      } else {
        continuity = "removable"
      }
    } else {
      overallLimit = { kind: "dne" }
      continuity = "jump"
    }
  } else if (leftLimit.kind === "pos_inf" && rightLimit.kind === "pos_inf") {
    overallLimit = { kind: "pos_inf" }
    continuity = "infinite"
  } else if (leftLimit.kind === "neg_inf" && rightLimit.kind === "neg_inf") {
    overallLimit = { kind: "neg_inf" }
    continuity = "infinite"
  } else if (
    leftLimit.kind === "pos_inf" || leftLimit.kind === "neg_inf" ||
    rightLimit.kind === "pos_inf" || rightLimit.kind === "neg_inf"
  ) {
    overallLimit = { kind: "dne" }
    continuity = "infinite"
  } else if (leftLimit.kind === "finite" || rightLimit.kind === "finite") {
    overallLimit = { kind: "dne" }
    continuity = "boundary"
  }

  const contLabel: Record<ContinuityKind, string> = {
    continuous: "连续点",
    removable: "可去间断点（第一类）",
    jump: "跳跃间断点（第一类）",
    infinite: "无穷间断点（第二类）",
    oscillating: "震荡/无定义间断点（第二类）",
    boundary: "单侧定义域端点"
  }

  return {
    target,
    leftLimit,
    rightLimit,
    overallLimit,
    valueAtPoint,
    continuity,
    summary: `x₀ = ${fmtEqNum(x0, 4)}：极限 = ${formatLimitValue(overallLimit)}（${contLabel[continuity]}）`
  }
}

export function analyzeDualCurve1D(
  fField: CompiledScalarField1D,
  gExpression: string,
  domain: [number, number]
): DualCurve1DAnalysis {
  const gField = compileScalarField1D(gExpression)
  const [a, b] = domain
  const samples = 420
  const h = (b - a) / samples

  const gSegments: Array<Array<{ x: number; y: number }>> = []
  let current: Array<{ x: number; y: number }> = []
  for (let i = 0; i <= samples; i += 1) {
    const x = a + i * h
    const y = gField.eval(x)
    if (!Number.isFinite(y) || Math.abs(y) > 1e5) {
      if (current.length >= 2) gSegments.push(current)
      current = []
      continue
    }
    if (current.length > 0 && Math.abs(y - current[current.length - 1]!.y) > 80) {
      if (current.length >= 2) gSegments.push(current)
      current = []
    }
    current.push({ x, y })
  }
  if (current.length >= 2) gSegments.push(current)

  const rootXs = findRootsInDomain((x) => fField.eval(x) - gField.eval(x), domain, 400)
  const intersections = rootXs.map((x) => ({ x, y: fField.eval(x) }))
  const areaBetween = integrateCompositeGL8((x) => Math.abs(fField.eval(x) - gField.eval(x)), a, b, 64)
  const signedDiffIntegral = integrateCompositeGL8((x) => fField.eval(x) - gField.eval(x), a, b, 64)

  return {
    gExpression,
    gSegments,
    intersections,
    areaBetween,
    signedDiffIntegral
  }
}
