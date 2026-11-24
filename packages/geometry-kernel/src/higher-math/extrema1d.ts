import { compileScalarField1D, type CompiledScalarField1D } from "./bytecode"

export type Extremum1DKind =
  | "local_max"
  | "local_min"
  | "cusp_max"
  | "cusp_min"
  | "endpoint"

export interface Extremum1DPoint {
  x: number
  y: number
  kind: Extremum1DKind
  derivative: number
  leftDerivative?: number
  rightDerivative?: number
  isGlobalMax: boolean
  isGlobalMin: boolean
  label: string
}

export interface Inflection1DPoint {
  x: number
  y: number
  slope: number
  concavityChange: "up_to_down" | "down_to_up"
}

export interface Asymptote1D {
  kind: "vertical" | "horizontal" | "oblique"
  /** For vertical: `x = c`. */
  x?: number
  /** For horizontal (`slope = 0`) or oblique: `y = slope * x + intercept`. */
  slope?: number
  intercept?: number
  label: string
}

export interface Extrema1DAnalysis {
  expression: string
  normalizedExpression: string
  domain: [number, number]
  segments: Array<Array<{ x: number; y: number }>>
  derivativeSegments: Array<Array<{ x: number; y: number }>>
  extrema: Extremum1DPoint[]
  inflections: Inflection1DPoint[]
  asymptotes: Asymptote1D[]
  globalMax: Extremum1DPoint | null
  globalMin: Extremum1DPoint | null
  unboundedAbove: boolean
  unboundedBelow: boolean
  suggestedYRange: [number, number]
}

export interface AnalyzeExtrema1DOptions {
  samples?: number
  tolerance?: number
  includeDerivativeCurve?: boolean
}

const GOLDEN_RATIO = 0.3819660112501051

/**
 * Brent's 1D minimization on `[a, b]` (parabolic interpolation + golden section fallback).
 * Works cleanly on both smooth curves and non-differentiable cusps (like `|x|`).
 */
export function brentOptimize1D(
  fn: (x: number) => number,
  a: number,
  b: number,
  maximize: boolean,
  tol = 1e-9,
  maxIter = 80
): { x: number; y: number } {
  const evalObj = (x: number): number => {
    const v = fn(x)
    if (!Number.isFinite(v)) return Number.POSITIVE_INFINITY
    return maximize ? -v : v
  }

  let lo = Math.min(a, b)
  let hi = Math.max(a, b)
  let x = lo + GOLDEN_RATIO * (hi - lo)
  let w = x
  let v = x
  let fx = evalObj(x)
  let fw = fx
  let fv = fx
  let d = 0
  let e = 0

  for (let iter = 0; iter < maxIter; iter += 1) {
    const m = 0.5 * (lo + hi)
    const tol1 = tol * Math.abs(x) + 1e-11
    const tol2 = 2 * tol1
    if (Math.abs(x - m) <= tol2 - 0.5 * (hi - lo)) break

    let p = 0
    let q = 0
    let r = 0
    if (Math.abs(e) > tol1) {
      r = (x - w) * (fx - fv)
      q = (x - v) * (fx - fw)
      p = (x - v) * q - (x - w) * r
      q = 2 * (q - r)
      if (q > 0) p = -p
      else q = -q
      r = e
      e = d
    }

    let u: number
    if (
      Math.abs(p) < Math.abs(0.5 * q * r) &&
      p > q * (lo - x) &&
      p < q * (hi - x)
    ) {
      d = p / q
      u = x + d
      if (u - lo < tol2 || hi - u < tol2) {
        d = x < m ? tol1 : -tol1
      }
    } else {
      e = x < m ? hi - x : lo - x
      d = GOLDEN_RATIO * e
    }

    u = Math.abs(d) >= tol1 ? x + d : x + (d > 0 ? tol1 : -tol1)
    const fu = evalObj(u)

    if (fu <= fx) {
      if (u < x) hi = x
      else lo = x
      v = w
      fv = fw
      w = x
      fw = fx
      x = u
      fx = fu
    } else {
      if (u < x) lo = u
      else hi = u
      if (fu <= fw || w === x) {
        v = w
        fv = fw
        w = u
        fw = fu
      } else if (fu <= fv || v === x || v === w) {
        v = u
        fv = fu
      }
    }
  }

  return { x, y: fn(x) }
}

function bisectRoot(
  fn: (x: number) => number,
  a: number,
  b: number,
  tol = 1e-9,
  maxIter = 64
): number | null {
  let lo = a
  let hi = b
  let flo = fn(lo)
  const fhi = fn(hi)
  if (!Number.isFinite(flo) || !Number.isFinite(fhi)) return null
  if (Math.abs(flo) <= tol) return lo
  if (Math.abs(fhi) <= tol) return hi
  if (flo * fhi > 0) return null

  for (let i = 0; i < maxIter; i += 1) {
    const mid = 0.5 * (lo + hi)
    const fmid = fn(mid)
    if (!Number.isFinite(fmid)) return null
    if (Math.abs(fmid) <= tol || Math.abs(hi - lo) <= tol) return mid
    if (flo * fmid <= 0) {
      hi = mid
    } else {
      lo = mid
      flo = fmid
    }
  }
  return 0.5 * (lo + hi)
}

function snapNearZero(value: number, eps = 1e-8): number {
  return Math.abs(value) < eps ? 0 : value
}

function formatLinearLabel(slope: number, intercept: number): string {
  const s = snapNearZero(slope, 1e-3)
  const b = snapNearZero(intercept, 1e-3)
  if (s === 0) return `y = ${Number(b.toFixed(3))}`
  const sText = Math.abs(s - 1) < 1e-3
    ? "x"
    : Math.abs(s + 1) < 1e-3
      ? "-x"
      : `${Number(s.toFixed(3))}x`
  if (b === 0) return `y = ${sText}`
  const sign = b > 0 ? " + " : " - "
  return `y = ${sText}${sign}${Number(Math.abs(b).toFixed(3))}`
}

function detectEndAsymptotes(field: CompiledScalarField1D): Asymptote1D[] {
  const found: Asymptote1D[] = []
  const probeSets = [
    [1e4, 3e4, 1e5],
    [-1e4, -3e4, -1e5]
  ]
  for (const [x1, x2, x3] of probeSets) {
    const y1 = field.eval(x1)
    const y2 = field.eval(x2)
    const y3 = field.eval(x3)
    if (!Number.isFinite(y1) || !Number.isFinite(y2) || !Number.isFinite(y3)) continue

    // Check horizontal asymptote first
    if (Math.abs(y3) < 1e4 && Math.abs(y3 - y2) < 1e-2 && Math.abs(y2 - y1) < 5e-2) {
      const intercept = snapNearZero(y3, 1e-3)
      if (!found.some((a) => a.kind === "horizontal" && Math.abs((a.intercept ?? 0) - intercept) < 1e-2)) {
        found.push({
          kind: "horizontal",
          slope: 0,
          intercept,
          label: formatLinearLabel(0, intercept)
        })
      }
      continue
    }

    // Check oblique asymptote: y ~ k*x + b via secant slopes at large |x|
    const k12 = (y2 - y1) / (x2 - x1)
    const k23 = (y3 - y2) / (x3 - x2)
    if (
      Math.abs(k23) > 1e-3 &&
      Math.abs(k23) < 1e3 &&
      Math.abs(k23 - k12) < 2e-3
    ) {
      const b1 = y1 - k23 * x1
      const b2 = y2 - k23 * x2
      const b3 = y3 - k23 * x3
      if (Math.abs(b3) < 1e4 && Math.abs(b3 - b2) < 2e-2 && Math.abs(b2 - b1) < 5e-2) {
        const slope = snapNearZero(k23, 1e-3)
        const intercept = snapNearZero(b3, 1e-3)
        const duplicate = found.some(
          (a) =>
            a.kind === "oblique" &&
            Math.abs((a.slope ?? 0) - slope) < 1e-2 &&
            Math.abs((a.intercept ?? 0) - intercept) < 2e-2
        )
        if (!duplicate) {
          found.push({
            kind: "oblique",
            slope,
            intercept,
            label: formatLinearLabel(slope, intercept)
          })
        }
      }
    }
  }
  return found
}

/**
 * Performs high-precision 1D calculus analysis on closed interval `[a, b]`:
 * - Adaptive Brent refinement for local maxima / minima (including non-differentiable cusps)
 * - Closed-interval endpoint evaluation + global max/min identification
 * - Inflection points (f'' sign change)
 * - Vertical, horizontal, and oblique asymptotes
 * - Discontinuity-aware polylines for f(x) and f'(x)
 */
export function analyzeExtrema1D(
  expression: string,
  domain: [number, number],
  options: AnalyzeExtrema1DOptions = {}
): Extrema1DAnalysis {
  const [rawA, rawB] = domain
  const a = Math.min(rawA, rawB)
  const b = Math.max(rawA, rawB)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b - a <= 1e-9) {
    throw new Error("定义域区间 [a, b] 必须满足 a < b")
  }

  const field = compileScalarField1D(expression)
  const samples = Math.max(180, Math.min(1600, Math.round(options.samples ?? 480)))
  const tol = options.tolerance ?? 1e-8
  const span = b - a
  const step = span / samples

  const xs = new Float64Array(samples + 1)
  const ys = new Float64Array(samples + 1)
  const dys = new Float64Array(samples + 1)

  for (let i = 0; i <= samples; i += 1) {
    const x = i === samples ? b : a + i * step
    xs[i] = x
    ys[i] = field.eval(x)
    dys[i] = Number.isFinite(ys[i]!) ? field.derivative(x) : Number.NaN
  }

  // Estimate vertical scale robustly using percentiles (ignoring near-pole blowups).
  const finiteYs = Array.from(ys).filter((v) => Number.isFinite(v) && Math.abs(v) < 1e6).sort((u, v) => u - v)
  const p05 = finiteYs.length > 0 ? finiteYs[Math.floor(finiteYs.length * 0.05)]! : -5
  const p95 = finiteYs.length > 0 ? finiteYs[Math.min(finiteYs.length - 1, Math.ceil(finiteYs.length * 0.95))]! : 5
  const robustSpan = Math.max(1, p95 - p05)
  const jumpThreshold = Math.max(12, robustSpan * 4.5)
  const clipLimit = Math.max(50, Math.max(Math.abs(p05), Math.abs(p95)) + robustSpan * 6)

  // 1. Detect vertical asymptotes & build discontinuity-safe curve segments.
  const asymptotes: Asymptote1D[] = []
  const segments: Array<Array<{ x: number; y: number }>> = []
  const derivativeSegments: Array<Array<{ x: number; y: number }>> = []
  let currentSeg: Array<{ x: number; y: number }> = []
  let currentDerivSeg: Array<{ x: number; y: number }> = []
  let unboundedAbove = false
  let unboundedBelow = false

  const recordVerticalAsymptote = (xLeft: number, xRight: number): void => {
    // Refine pole by maximizing |f(x)| via bisection on 1/f(x) = 0
    const invRoot = bisectRoot((x) => {
      const v = field.eval(x)
      return Number.isFinite(v) && v !== 0 ? 1 / v : 0
    }, xLeft, xRight, 1e-7)
    const poleX = snapNearZero(invRoot ?? 0.5 * (xLeft + xRight), 1e-5)
    // Verify it truly diverges near poleX
    const eps = Math.max(1e-5, span * 1e-5)
    const vl = field.eval(poleX - eps)
    const vr = field.eval(poleX + eps)
    const maxMag = Math.max(Math.abs(vl), Math.abs(vr))
    if (!Number.isFinite(vl) || !Number.isFinite(vr) || maxMag > Math.max(25, robustSpan * 6)) {
      if (vl > Math.max(25, robustSpan * 6) || vr > Math.max(25, robustSpan * 6)) unboundedAbove = true
      if (vl < -Math.max(25, robustSpan * 6) || vr < -Math.max(25, robustSpan * 6)) unboundedBelow = true
      if (!asymptotes.some((as) => as.kind === "vertical" && Math.abs((as.x ?? 0) - poleX) < step * 2)) {
        asymptotes.push({
          kind: "vertical",
          x: poleX,
          label: `x = ${Number(poleX.toFixed(3))}`
        })
      }
    }
  }

  for (let i = 0; i <= samples; i += 1) {
    const x = xs[i]!
    const y = ys[i]!
    const dy = dys[i]!

    if (i > 0) {
      const prevY = ys[i - 1]!
      const prevX = xs[i - 1]!
      const bothFinite = Number.isFinite(prevY) && Number.isFinite(y)
      if (!bothFinite) {
        if (Number.isFinite(prevY) && Math.abs(prevY) > Math.max(15, robustSpan * 4)) {
          recordVerticalAsymptote(prevX, x)
        } else if (Number.isFinite(y) && Math.abs(y) > Math.max(15, robustSpan * 4)) {
          recordVerticalAsymptote(prevX, x)
        }
        if (currentSeg.length > 1) segments.push(currentSeg)
        currentSeg = []
        if (currentDerivSeg.length > 1) derivativeSegments.push(currentDerivSeg)
        currentDerivSeg = []
      } else if (Math.abs(y - prevY) > jumpThreshold) {
        // Check if midpoint blows up (vertical asymptote) vs merely steep continuous curve
        const midX = 0.5 * (prevX + x)
        const midY = field.eval(midX)
        const signFlip = prevY * y < 0
        if (!Number.isFinite(midY) || Math.abs(midY) > clipLimit || (signFlip && Math.abs(y - prevY) > jumpThreshold)) {
          recordVerticalAsymptote(prevX, x)
          if (currentSeg.length > 1) segments.push(currentSeg)
          currentSeg = []
          if (currentDerivSeg.length > 1) derivativeSegments.push(currentDerivSeg)
          currentDerivSeg = []
        }
      }
    }

    if (Number.isFinite(y) && Math.abs(y) <= clipLimit) {
      currentSeg.push({ x, y })
    } else if (currentSeg.length > 1) {
      segments.push(currentSeg)
      currentSeg = []
    } else {
      currentSeg = []
    }

    if (options.includeDerivativeCurve !== false && Number.isFinite(dy) && Math.abs(dy) <= clipLimit * 2) {
      if (currentDerivSeg.length > 0 && Math.abs(dy - currentDerivSeg[currentDerivSeg.length - 1]!.y) > jumpThreshold * 2) {
        if (currentDerivSeg.length > 1) derivativeSegments.push(currentDerivSeg)
        currentDerivSeg = []
      }
      currentDerivSeg.push({ x, y: dy })
    } else {
      if (currentDerivSeg.length > 1) derivativeSegments.push(currentDerivSeg)
      currentDerivSeg = []
    }
  }
  if (currentSeg.length > 1) segments.push(currentSeg)
  if (currentDerivSeg.length > 1) derivativeSegments.push(currentDerivSeg)

  // Add horizontal / oblique asymptotes
  asymptotes.push(...detectEndAsymptotes(field))

  const nearPole = (x: number): boolean =>
    asymptotes.some((as) => as.kind === "vertical" && Math.abs((as.x ?? 0) - x) < Math.max(step * 1.5, 1e-3))

  // 2. Find interior local maxima & minima (both smooth and cusps) via bracketing + Brent refinement.
  const extremaCandidates: Extremum1DPoint[] = []
  const dedupTol = Math.max(1e-4, span * 1e-3)

  const tryRecordInteriorExtremum = (lo: number, hi: number, isMax: boolean): void => {
    const refined = brentOptimize1D((x) => field.eval(x), lo, hi, isMax, tol)
    const rx = snapNearZero(refined.x, 1e-7)
    const ry = refined.y
    if (!Number.isFinite(ry) || Math.abs(ry) > clipLimit || nearPole(rx)) return
    if (rx <= a + dedupTol * 0.5 || rx >= b - dedupTol * 0.5) return

    // Confirm genuine local extremum against immediate neighbors
    const probe = Math.max(1e-4, Math.min(step * 0.5, (rx - a) * 0.5, (b - rx) * 0.5))
    const yl = field.eval(rx - probe)
    const yr = field.eval(rx + probe)
    if (!Number.isFinite(yl) || !Number.isFinite(yr)) return
    const margin = 1e-10 * (1 + Math.abs(ry))
    if (isMax && (ry < yl - margin || ry < yr - margin)) return
    if (!isMax && (ry > yl + margin || ry > yr + margin)) return
    // Guard against completely flat segments
    if (Math.abs(ry - yl) <= 1e-11 && Math.abs(ry - yr) <= 1e-11) return

    if (extremaCandidates.some((pt) => Math.abs(pt.x - rx) < dedupTol)) return

    const dLeft = field.leftDerivative(rx, 1e-5)
    const dRight = field.rightDerivative(rx, 1e-5)
    const isCusp =
      Number.isFinite(dLeft) &&
      Number.isFinite(dRight) &&
      Math.abs(dLeft - dRight) > 0.15 &&
      dLeft * dRight < 0

    const kind: Extremum1DKind = isCusp
      ? (isMax ? "cusp_max" : "cusp_min")
      : (isMax ? "local_max" : "local_min")

    extremaCandidates.push({
      x: rx,
      y: snapNearZero(ry, 1e-9),
      kind,
      derivative: isCusp ? Number.NaN : snapNearZero(field.derivative(rx), 1e-6),
      leftDerivative: Number.isFinite(dLeft) ? dLeft : undefined,
      rightDerivative: Number.isFinite(dRight) ? dRight : undefined,
      isGlobalMax: false,
      isGlobalMin: false,
      label: isCusp
        ? (isMax ? "尖点极大值" : "尖点极小值")
        : (isMax ? "局部极大值" : "局部极小值")
    })
  }

  for (let i = 1; i < samples; i += 1) {
    const y0 = ys[i - 1]!
    const y1 = ys[i]!
    const y2 = ys[i + 1]!
    if (!Number.isFinite(y0) || !Number.isFinite(y1) || !Number.isFinite(y2)) continue
    if (Math.abs(y1 - y0) > jumpThreshold || Math.abs(y2 - y1) > jumpThreshold) continue

    if (y1 >= y0 && y1 >= y2 && (y1 > y0 || y1 > y2)) {
      tryRecordInteriorExtremum(xs[i - 1]!, xs[i + 1]!, true)
    } else if (y1 <= y0 && y1 <= y2 && (y1 < y0 || y1 < y2)) {
      tryRecordInteriorExtremum(xs[i - 1]!, xs[i + 1]!, false)
    }
  }

  // 3. Evaluate closed interval endpoints x = a and x = b.
  for (const [endX, endLabel] of [[a, "左端点"], [b, "右端点"]] as const) {
    if (nearPole(endX)) continue
    const endY = field.eval(endX)
    if (!Number.isFinite(endY) || Math.abs(endY) > clipLimit) continue
    extremaCandidates.push({
      x: snapNearZero(endX, 1e-9),
      y: snapNearZero(endY, 1e-9),
      kind: "endpoint",
      derivative: endX === a ? field.rightDerivative(endX) : field.leftDerivative(endX),
      isGlobalMax: false,
      isGlobalMin: false,
      label: endLabel
    })
  }

  extremaCandidates.sort((u, v) => u.x - v.x)

  // 4. Identify Global Maximum & Global Minimum across [a, b] (unless unbounded at a pole).
  let globalMax: Extremum1DPoint | null = null
  let globalMin: Extremum1DPoint | null = null

  if (!unboundedAbove && extremaCandidates.length > 0) {
    const maxY = Math.max(...extremaCandidates.map((pt) => pt.y))
    const tieTol = 1e-6 * (1 + Math.abs(maxY))
    for (const pt of extremaCandidates) {
      if (Math.abs(pt.y - maxY) <= tieTol) {
        pt.isGlobalMax = true
        if (!globalMax) globalMax = pt
      }
    }
  }
  if (!unboundedBelow && extremaCandidates.length > 0) {
    const minY = Math.min(...extremaCandidates.map((pt) => pt.y))
    const tieTol = 1e-6 * (1 + Math.abs(minY))
    for (const pt of extremaCandidates) {
      if (Math.abs(pt.y - minY) <= tieTol) {
        pt.isGlobalMin = true
        if (!globalMin) globalMin = pt
      }
    }
  }

  // 5. Find inflection points (f''(x) sign change on smooth regions).
  const inflections: Inflection1DPoint[] = []
  const d2s = new Float64Array(samples + 1)
  for (let i = 0; i <= samples; i += 1) {
    d2s[i] = Number.isFinite(ys[i]!) && !nearPole(xs[i]!) ? field.secondDerivative(xs[i]!) : Number.NaN
  }

  for (let i = 1; i < samples; i += 1) {
    const x0 = xs[i - 1]!
    const x1 = xs[i]!
    const f20 = d2s[i - 1]!
    const f21 = d2s[i]!
    if (!Number.isFinite(f20) || !Number.isFinite(f21)) continue
    if (Math.abs(ys[i]! - ys[i - 1]!) > jumpThreshold) continue
    if (f20 * f21 > 0) continue
    if (Math.abs(f20) < 1e-9 && Math.abs(f21) < 1e-9) continue

    const root = bisectRoot((x) => field.secondDerivative(x), x0, x1, 1e-7)
    if (root === null) continue
    const rx = snapNearZero(root, 1e-7)
    if (rx <= a + dedupTol || rx >= b - dedupTol || nearPole(rx)) continue

    // Verify smooth derivative (exclude cusps where f'' changes artificially)
    const dL = field.leftDerivative(rx, 1e-4)
    const dR = field.rightDerivative(rx, 1e-4)
    if (!Number.isFinite(dL) || !Number.isFinite(dR) || Math.abs(dL - dR) > 0.2) continue

    // Verify actual concavity change across a small neighborhood
    const eps = Math.max(1e-3, step * 0.6)
    const cLeft = field.secondDerivative(rx - eps)
    const cRight = field.secondDerivative(rx + eps)
    if (!Number.isFinite(cLeft) || !Number.isFinite(cRight) || cLeft * cRight >= 0) continue
    if (Math.abs(cLeft) < 1e-5 && Math.abs(cRight) < 1e-5) continue

    const ry = field.eval(rx)
    if (!Number.isFinite(ry) || Math.abs(ry) > clipLimit) continue
    if (inflections.some((pt) => Math.abs(pt.x - rx) < dedupTol)) continue

    inflections.push({
      x: rx,
      y: snapNearZero(ry, 1e-9),
      slope: snapNearZero(field.derivative(rx), 1e-6),
      concavityChange: cLeft > 0 ? "up_to_down" : "down_to_up"
    })
  }

  // 6. Compute suggested viewport Y range including extrema + curve core.
  const yPool: number[] = []
  if (finiteYs.length > 0) {
    yPool.push(p05, p95)
  }
  for (const pt of extremaCandidates) yPool.push(pt.y)
  for (const pt of inflections) yPool.push(pt.y)
  const rawYMin = yPool.length > 0 ? Math.min(...yPool) : -5
  const rawYMax = yPool.length > 0 ? Math.max(...yPool) : 5
  const pad = Math.max(0.8, (rawYMax - rawYMin) * 0.2)
  const suggestedYRange: [number, number] = [rawYMin - pad, rawYMax + pad]

  return {
    expression,
    normalizedExpression: field.normalizedSource,
    domain: [a, b],
    segments,
    derivativeSegments,
    extrema: extremaCandidates,
    inflections,
    asymptotes,
    globalMax,
    globalMin,
    unboundedAbove,
    unboundedBelow,
    suggestedYRange
  }
}

const GL12_NODES = [
  -0.9815606342467192, -0.9041172563704749, -0.7699026741943047,
  -0.5873179542866175, -0.3678314989981802, -0.1252334085114689,
  0.1252334085114689, 0.3678314989981802, 0.5873179542866175,
  0.7699026741943047, 0.9041172563704749, 0.9815606342467192
]
const GL12_WEIGHTS = [
  0.0471753363865118, 0.1069393259953184, 0.1600783285433462,
  0.2031674267230659, 0.2334925365383548, 0.2491470458134028,
  0.2491470458134028, 0.2334925365383548, 0.2031674267230659,
  0.1600783285433462, 0.1069393259953184, 0.0471753363865118
]

/**
 * Computes the definite integral `\int_a^b f(x) dx` using composite 12-point Gauss-Legendre quadrature.
 */
export function integrateDefinite1D(
  expression: string,
  a: number,
  b: number,
  subIntervals = 24
): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN
  if (Math.abs(b - a) < 1e-15) return 0
  const sign = b >= a ? 1 : -1
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  const field = compileScalarField1D(expression)
  const panels = Math.max(4, Math.min(200, Math.round(subIntervals)))
  const h = (hi - lo) / panels
  let total = 0
  for (let p = 0; p < panels; p++) {
    const x0 = lo + p * h
    const mid = x0 + 0.5 * h
    const half = 0.5 * h
    let panelSum = 0
    for (let i = 0; i < 12; i++) {
      const fx = field.eval(mid + half * GL12_NODES[i]!)
      if (!Number.isFinite(fx)) return Number.NaN
      panelSum += GL12_WEIGHTS[i]! * fx
    }
    total += half * panelSum
  }
  return snapNearZero(sign * total, 1e-12)
}
