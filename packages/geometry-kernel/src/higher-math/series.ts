import { parseExpression, type ExpressionNode } from "../expression"
import { compileScalarField1D, normalizeHigherMathInput } from "./bytecode"
import type { Point2D } from "./contour"

export interface TaylorAnalysis {
  expression: string
  center: number
  order: number
  /** Exact Taylor coefficients c_k = f^(k)(center) / k! for k = 0..order. */
  coefficients: number[]
  polynomialText: string
  targetCurve: Point2D[]
  approxCurve: Point2D[]
  errorCurve: Point2D[]
  maxLocalError: number
}

export type FourierWaveformKind =
  | "square"
  | "sawtooth"
  | "triangle"
  | "half_rectified"
  | "full_rectified"
  | "custom"

export interface FourierHarmonic {
  n: number
  an: number
  bn: number
  amplitude: number
  phase: number
}

export interface EpicycleCircle {
  centerX: number
  centerY: number
  radius: number
  tipX: number
  tipY: number
  harmonic: number
}

export interface FourierAnalysis {
  waveform: FourierWaveformKind
  customExpression?: string
  halfPeriod: number
  harmonicsCount: number
  a0: number
  harmonics: FourierHarmonic[]
  targetCurve: Point2D[]
  approxCurve: Point2D[]
  rmsError: number
  peakOvershoot: number
}

// ============================================================================
// 1D Truncated Power Series (Jet Automatic Differentiation) up to order N
// Represents A(t) = sum_{k=0}^N a[k] * t^k where x = center + t.
// ============================================================================

function jetConst(val: number, order: number): Float64Array {
  const j = new Float64Array(order + 1)
  j[0] = val
  return j
}

function jetAdd(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(a.length)
  for (let i = 0; i < a.length; i += 1) out[i] = a[i]! + b[i]!
  return out
}

function jetSub(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(a.length)
  for (let i = 0; i < a.length; i += 1) out[i] = a[i]! - b[i]!
  return out
}

function jetNeg(a: Float64Array): Float64Array {
  const out = new Float64Array(a.length)
  for (let i = 0; i < a.length; i += 1) out[i] = -a[i]!
  return out
}

function jetMul(a: Float64Array, b: Float64Array): Float64Array {
  const n = a.length - 1
  const out = new Float64Array(n + 1)
  for (let k = 0; k <= n; k += 1) {
    let s = 0
    for (let j = 0; j <= k; j += 1) {
      s += a[j]! * b[k - j]!
    }
    out[k] = s
  }
  return out
}

function jetDiv(a: Float64Array, b: Float64Array): Float64Array {
  const n = a.length - 1
  const b0 = b[0]!
  if (Math.abs(b0) < 1e-13) {
    throw new Error("展开中心点处分母为 0（存在奇点，无法进行泰勒展开）")
  }
  const out = new Float64Array(n + 1)
  for (let k = 0; k <= n; k += 1) {
    let s = a[k]!
    for (let j = 1; j <= k; j += 1) {
      s -= b[j]! * out[k - j]!
    }
    out[k] = s / b0
  }
  return out
}

function jetDeriv(a: Float64Array): Float64Array {
  const n = a.length - 1
  const out = new Float64Array(n + 1)
  for (let k = 0; k < n; k += 1) {
    out[k] = (k + 1) * a[k + 1]!
  }
  return out
}

function jetExp(u: Float64Array): Float64Array {
  const n = u.length - 1
  const out = new Float64Array(n + 1)
  out[0] = Math.exp(u[0]!)
  for (let k = 1; k <= n; k += 1) {
    let s = 0
    for (let j = 1; j <= k; j += 1) {
      s += j * u[j]! * out[k - j]!
    }
    out[k] = s / k
  }
  return out
}

function jetLn(u: Float64Array): Float64Array {
  const n = u.length - 1
  if (u[0]! <= 0) {
    throw new Error("展开中心点处对数真数非正，无法实数泰勒展开")
  }
  const du = jetDeriv(u)
  const ratio = jetDiv(du, u)
  const out = new Float64Array(n + 1)
  out[0] = Math.log(u[0]!)
  for (let k = 1; k <= n; k += 1) {
    out[k] = ratio[k - 1]! / k
  }
  return out
}

function jetSinCos(u: Float64Array): { sin: Float64Array; cos: Float64Array } {
  const n = u.length - 1
  const s = new Float64Array(n + 1)
  const c = new Float64Array(n + 1)
  s[0] = Math.sin(u[0]!)
  c[0] = Math.cos(u[0]!)
  for (let k = 1; k <= n; k += 1) {
    let sumS = 0
    let sumC = 0
    for (let j = 1; j <= k; j += 1) {
      sumS += j * u[j]! * c[k - j]!
      sumC -= j * u[j]! * s[k - j]!
    }
    s[k] = sumS / k
    c[k] = sumC / k
  }
  return { sin: s, cos: c }
}

function jetSinhCosh(u: Float64Array): { sinh: Float64Array; cosh: Float64Array } {
  const ep = jetExp(u)
  const em = jetExp(jetNeg(u))
  const n = u.length - 1
  const sh = new Float64Array(n + 1)
  const ch = new Float64Array(n + 1)
  for (let k = 0; k <= n; k += 1) {
    sh[k] = 0.5 * (ep[k]! - em[k]!)
    ch[k] = 0.5 * (ep[k]! + em[k]!)
  }
  return { sinh: sh, cosh: ch }
}

function jetSqrt(u: Float64Array): Float64Array {
  const n = u.length - 1
  if (u[0]! <= 0) {
    throw new Error("展开中心点处根号内非正，无法光滑泰勒展开")
  }
  const out = new Float64Array(n + 1)
  out[0] = Math.sqrt(u[0]!)
  for (let k = 1; k <= n; k += 1) {
    let s = u[k]!
    for (let j = 1; j < k; j += 1) {
      s -= out[j]! * out[k - j]!
    }
    out[k] = s / (2 * out[0]!)
  }
  return out
}

function jetPowConst(u: Float64Array, p: number): Float64Array {
  const n = u.length - 1
  if (Number.isInteger(p) && p >= 0 && p <= 24) {
    let res = jetConst(1, n)
    let base: Float64Array = u
    let exp = p
    while (exp > 0) {
      if (exp & 1) res = jetMul(res, base)
      exp >>= 1
      if (exp > 0) base = jetMul(base, base)
    }
    return res
  }
  if (Number.isInteger(p) && p < 0 && p >= -24) {
    return jetDiv(jetConst(1, n), jetPowConst(u, -p))
  }
  if (u[0]! <= 0) {
    throw new Error("非整数次幂在展开中心处要求底数大于 0")
  }
  const lnU = jetLn(u)
  for (let k = 0; k <= n; k += 1) lnU[k] = lnU[k]! * p
  return jetExp(lnU)
}

function evalJetAst(node: ExpressionNode, center: number, order: number): Float64Array {
  if (node.type === "number") return jetConst(node.value, order)
  if (node.type === "variable") {
    const lower = node.name.toLowerCase()
    if (lower === "pi") return jetConst(Math.PI, order)
    if (lower === "e") return jetConst(Math.E, order)
    if (node.name !== "x") throw new Error(`泰勒展开仅支持单变量 x（发现 "${node.name}"）`)
    const j = new Float64Array(order + 1)
    j[0] = center
    if (order >= 1) j[1] = 1
    return j
  }
  if (node.type === "unary") {
    const arg = evalJetAst(node.argument, center, order)
    return node.operator === "-" ? jetNeg(arg) : arg
  }
  if (node.type === "call") {
    const u = evalJetAst(node.argument, center, order)
    switch (node.name) {
      case "exp": return jetExp(u)
      case "ln":
      case "log": return jetLn(u)
      case "log10": {
        const lnU = jetLn(u)
        const inv = 1 / Math.LN10
        for (let i = 0; i < lnU.length; i += 1) lnU[i] = lnU[i]! * inv
        return lnU
      }
      case "sin": return jetSinCos(u).sin
      case "cos": return jetSinCos(u).cos
      case "tan": {
        const sc = jetSinCos(u)
        return jetDiv(sc.sin, sc.cos)
      }
      case "sinh": return jetSinhCosh(u).sinh
      case "cosh": return jetSinhCosh(u).cosh
      case "tanh": {
        const sc = jetSinhCosh(u)
        return jetDiv(sc.sinh, sc.cosh)
      }
      case "sqrt": return jetSqrt(u)
      case "atan": {
        // d/dt atan(u) = u' / (1 + u^2)
        const du = jetDeriv(u)
        const denom = jetAdd(jetConst(1, order), jetMul(u, u))
        const deriv = jetDiv(du, denom)
        const out = new Float64Array(order + 1)
        out[0] = Math.atan(u[0]!)
        for (let k = 1; k <= order; k += 1) out[k] = deriv[k - 1]! / k
        return out
      }
      case "asin":
      case "acos": {
        if (Math.abs(u[0]!) >= 1) throw new Error("反三角函数在 |u| >= 1 处不可展开")
        const du = jetDeriv(u)
        const rad = jetSqrt(jetSub(jetConst(1, order), jetMul(u, u)))
        const deriv = jetDiv(du, rad)
        const out = new Float64Array(order + 1)
        out[0] = node.name === "asin" ? Math.asin(u[0]!) : Math.acos(u[0]!)
        const sign = node.name === "asin" ? 1 : -1
        for (let k = 1; k <= order; k += 1) out[k] = (sign * deriv[k - 1]!) / k
        return out
      }
      case "abs": {
        if (Math.abs(u[0]!) < 1e-12) throw new Error("绝对值函数在尖点处不可导，无法泰勒展开")
        return u[0]! > 0 ? u : jetNeg(u)
      }
      default:
        throw new Error(`函数 "${node.name}" 暂不支持高阶泰勒展开`)
    }
  }

  const left = evalJetAst(node.left, center, order)
  const right = evalJetAst(node.right, center, order)
  switch (node.operator) {
    case "+": return jetAdd(left, right)
    case "-": return jetSub(left, right)
    case "*": return jetMul(left, right)
    case "/": return jetDiv(left, right)
    case "^": {
      const isRightConst = right.slice(1).every((c) => Math.abs(c) < 1e-15)
      if (isRightConst) {
        return jetPowConst(left, right[0]!)
      }
      const lnLeft = jetLn(left)
      return jetExp(jetMul(right, lnLeft))
    }
  }
}

function evalTaylorPoly(coeffs: readonly number[], center: number, x: number): number {
  const dx = x - center
  let acc = 0
  for (let k = coeffs.length - 1; k >= 0; k -= 1) {
    acc = acc * dx + coeffs[k]!
  }
  return acc
}

function formatTaylorPolynomial(coeffs: readonly number[], center: number): string {
  const terms: string[] = []
  const xTerm = Math.abs(center) < 1e-8
    ? "x"
    : center > 0
      ? `(x - ${Number(center.toFixed(2))})`
      : `(x + ${Number(Math.abs(center).toFixed(2))})`

  for (let k = 0; k < coeffs.length; k += 1) {
    const c = coeffs[k]!
    if (!Number.isFinite(c) || Math.abs(c) < 1e-8) continue
    const absC = Number(Math.abs(c).toPrecision(4))
    const sign = c < 0 ? (terms.length === 0 ? "-" : " - ") : (terms.length === 0 ? "" : " + ")
    if (k === 0) {
      terms.push(`${sign}${absC}`)
    } else {
      const coefPart = Math.abs(absC - 1) < 1e-7 ? "" : `${absC}·`
      const powPart = k === 1 ? xTerm : `${xTerm}^${k}`
      terms.push(`${sign}${coefPart}${powPart}`)
    }
  }
  return terms.length > 0 ? `P_${coeffs.length - 1}(x) = ${terms.join("")}` : `P_${coeffs.length - 1}(x) = 0`
}

/**
 * Computes machine-exact Taylor polynomial `P_n(x)` around `center` up to `order` (0..20)
 * using truncated power-series Jet Automatic Differentiation.
 */
export function analyzeTaylorSeries(
  expression: string,
  center: number,
  order: number,
  domain: [number, number] = [-4.5, 4.5],
  samples = 360
): TaylorAnalysis {
  const clampedOrder = Math.max(0, Math.min(20, Math.round(order)))
  const normalized = normalizeHigherMathInput(expression, "expression")
  const ast = parseExpression(normalized)
  const field = compileScalarField1D(expression)

  const jet = evalJetAst(ast, center, clampedOrder)
  const coefficients = Array.from(jet).map((c) => (Math.abs(c) < 1e-14 ? 0 : c))
  const polynomialText = formatTaylorPolynomial(coefficients, center)

  const [a, b] = domain[0] < domain[1] ? domain : [domain[1], domain[0]]
  const step = (b - a) / samples
  const targetCurve: Point2D[] = []
  const approxCurve: Point2D[] = []
  const errorCurve: Point2D[] = []
  let maxLocalError = 0

  for (let i = 0; i <= samples; i += 1) {
    const x = a + i * step
    const fx = field.eval(x)
    const px = evalTaylorPoly(coefficients, center, x)
    if (Number.isFinite(fx) && Math.abs(fx) < 200) {
      targetCurve.push({ x, y: fx })
    }
    if (Number.isFinite(px) && Math.abs(px) < 200) {
      approxCurve.push({ x, y: px })
    }
    if (Number.isFinite(fx) && Number.isFinite(px)) {
      const err = Math.abs(fx - px)
      if (err < 200) errorCurve.push({ x, y: err })
      if (Math.abs(x - center) <= 1.0 && err > maxLocalError) {
        maxLocalError = err
      }
    }
  }

  return {
    expression,
    center,
    order: clampedOrder,
    coefficients,
    polynomialText,
    targetCurve,
    approxCurve,
    errorCurve,
    maxLocalError
  }
}

function evalPeriodicWaveform(
  kind: FourierWaveformKind,
  L: number,
  customFn: ((x: number) => number) | null,
  x: number
): number {
  const period = 2 * L
  // Wrap x into [-L, L)
  let t = ((x + L) % period + period) % period - L
  if (Math.abs(t + L) < 1e-12) t = -L

  switch (kind) {
    case "square":
      return t >= 0 ? 1 : -1
    case "sawtooth":
      return t / L
    case "triangle":
      return 1 - (2 * Math.abs(t)) / L
    case "half_rectified": {
      const s = Math.sin((Math.PI * t) / L)
      return s > 0 ? s : 0
    }
    case "full_rectified":
      return Math.abs(Math.sin((Math.PI * t) / L))
    case "custom":
      return customFn ? customFn(t) : 0
  }
}

/**
 * Computes Fourier series partial sum `S_N(x)`, harmonic amplitude spectrum, and Gibbs overshoot
 * on `[-2L, 2L]` (2 periods) via composite Simpson quadrature.
 */
export function analyzeFourierSeries(
  waveform: FourierWaveformKind,
  harmonicsCount: number,
  halfPeriod = Math.PI,
  customExpression = "x^2 / 3 - 1"
): FourierAnalysis {
  const N = Math.max(1, Math.min(40, Math.round(harmonicsCount)))
  const L = Math.max(0.2, halfPeriod)
  const customField = waveform === "custom" ? compileScalarField1D(customExpression) : null
  const fn = (x: number): number => {
    const v = evalPeriodicWaveform(waveform, L, customField ? (t) => customField.eval(t) : null, x)
    return Number.isFinite(v) ? v : 0
  }

  // Composite Simpson quadrature with M = 600 even subintervals over [-L, L]
  const M = 600
  const h = (2 * L) / M
  const xs = new Float64Array(M + 1)
  const fs = new Float64Array(M + 1)
  for (let i = 0; i <= M; i += 1) {
    const x = -L + i * h
    xs[i] = x
    fs[i] = fn(x)
  }

  const simpsonWeight = (i: number): number => (i === 0 || i === M ? 1 : i % 2 === 1 ? 4 : 2)

  let sum0 = 0
  for (let i = 0; i <= M; i += 1) {
    sum0 += simpsonWeight(i) * fs[i]!
  }
  // Using convention f(x) ~ a0 / 2 + sum_{n=1}^N (an cos(n pi x / L) + bn sin(n pi x / L))
  const a0 = ((h / 3) * sum0) / L

  const harmonics: FourierHarmonic[] = []
  for (let n = 1; n <= N; n += 1) {
    const omega = (n * Math.PI) / L
    let sumCos = 0
    let sumSin = 0
    for (let i = 0; i <= M; i += 1) {
      const w = simpsonWeight(i) * fs[i]!
      const angle = omega * xs[i]!
      sumCos += w * Math.cos(angle)
      sumSin += w * Math.sin(angle)
    }
    const anRaw = ((h / 3) * sumCos) / L
    const bnRaw = ((h / 3) * sumSin) / L
    const an = Math.abs(anRaw) < 1e-10 ? 0 : anRaw
    const bn = Math.abs(bnRaw) < 1e-10 ? 0 : bnRaw
    const amplitude = Math.hypot(an, bn)
    const phase = Math.atan2(-bn, an)
    harmonics.push({ n, an, bn, amplitude, phase })
  }

  const evalPartialSum = (x: number): number => {
    let s = 0.5 * a0
    for (const hm of harmonics) {
      const angle = (hm.n * Math.PI * x) / L
      s += hm.an * Math.cos(angle) + hm.bn * Math.sin(angle)
    }
    return s
  }

  const plotSamples = 480
  const xStart = -2 * L
  const xEnd = 2 * L
  const plotStep = (xEnd - xStart) / plotSamples
  const targetCurve: Point2D[] = []
  const approxCurve: Point2D[] = []
  let errSqSum = 0
  let maxTargetAbs = 0
  let maxApproxAbs = 0

  for (let i = 0; i <= plotSamples; i += 1) {
    const x = xStart + i * plotStep
    const yt = fn(x)
    const ya = evalPartialSum(x)
    targetCurve.push({ x, y: yt })
    approxCurve.push({ x, y: ya })
    errSqSum += (yt - ya) * (yt - ya)
    if (Math.abs(yt) > maxTargetAbs) maxTargetAbs = Math.abs(yt)
    if (Math.abs(ya) > maxApproxAbs) maxApproxAbs = Math.abs(ya)
  }

  const rmsError = Math.sqrt(errSqSum / (plotSamples + 1))
  const peakOvershoot = Math.max(0, maxApproxAbs - maxTargetAbs)

  return {
    waveform,
    customExpression: waveform === "custom" ? customExpression : undefined,
    halfPeriod: L,
    harmonicsCount: N,
    a0,
    harmonics,
    targetCurve,
    approxCurve,
    rmsError,
    peakOvershoot
  }
}

/**
 * Computes rotating epicycle phasor chain at parameter `xPhase` so the tip Y-coordinate
 * equals `S_N(xPhase) - a0/2`.
 */
export function computeFourierEpicycles(
  analysis: FourierAnalysis,
  xPhase: number
): EpicycleCircle[] {
  const L = analysis.halfPeriod
  let cx = 0
  let cy = 0.5 * analysis.a0
  const circles: EpicycleCircle[] = []

  for (const hm of analysis.harmonics) {
    if (hm.amplitude < 1e-4) continue
    const theta = (hm.n * Math.PI * xPhase) / L
    // We want tip Y displacement = an * cos(theta) + bn * sin(theta)
    // Note: sin(theta + alpha) = sin(theta)cos(alpha) + cos(theta)sin(alpha)
    // Choose dx = bn * cos(theta) - an * sin(theta), dy = an * cos(theta) + bn * sin(theta)
    // Length^2 = dx^2 + dy^2 = an^2 + bn^2 = amplitude^2! Exact!
    const dx = hm.bn * Math.cos(theta) - hm.an * Math.sin(theta)
    const dy = hm.an * Math.cos(theta) + hm.bn * Math.sin(theta)
    const nx = cx + dx
    const ny = cy + dy
    circles.push({
      centerX: cx,
      centerY: cy,
      radius: hm.amplitude,
      tipX: nx,
      tipY: ny,
      harmonic: hm.n
    })
    cx = nx
    cy = ny
  }

  return circles
}
