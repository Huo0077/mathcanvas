import type { Point2D, ViewportBounds2D } from "./contour"

export type DistributionKind =
  | "normal"
  | "student_t"
  | "chi_square"
  | "exponential"
  | "binomial"
  | "poisson"

export interface DistributionConfig {
  kind: DistributionKind
  /** mu (normal), df nu (t / chi2), rate lambda (exp / poisson), or trials n (binomial). */
  param1: number
  /** sigma (normal) or success prob p (binomial). */
  param2?: number
  intervalA: number
  intervalB: number
}

export interface DiscreteBar {
  k: number
  prob: number
  cdf: number
  inInterval: boolean
}

export interface DistributionAnalysis {
  kind: DistributionKind
  isDiscrete: boolean
  mean: number
  variance: number
  stdDev: number
  interval: [number, number]
  intervalProb: number
  pdfCurve: Point2D[]
  cdfCurve: Point2D[]
  shadedPolygon: Point2D[]
  discreteBars: DiscreteBar[]
  suggestedBounds: ViewportBounds2D
}

export type CltParentKind = "uniform" | "exponential" | "bimodal" | "dice"

export interface CltSimulationConfig {
  parent: CltParentKind
  sampleSize: number
  numTrials?: number
  seed?: number
}

export interface CltHistogramBin {
  xLeft: number
  xRight: number
  count: number
  density: number
}

export interface CltSimulationResult {
  parent: CltParentKind
  sampleSize: number
  numTrials: number
  theoreticalMean: number
  theoreticalStdError: number
  empiricalMean: number
  empiricalStdDev: number
  bins: CltHistogramBin[]
  normalOverlay: Point2D[]
  suggestedBounds: ViewportBounds2D
}

// ============================================================================
// High-accuracy special functions (erf, lnGamma, incomplete Gamma & Beta)
// ============================================================================

export function erfApprox(x: number): number {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * ax)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax)
  return sign * y
}

const LANCZOS_COEFFS = [
  0.9999999999998099,
  676.5203681218851,
  -1259.1392167224028,
  771.3234287776531,
  -176.6150291621406,
  12.507343278686905,
  -0.13857109526572012,
  9.984369578019572e-6,
  1.5056327351493116e-7
]

export function lnGamma(z: number): number {
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z)
  }
  const zm1 = z - 1
  let x = LANCZOS_COEFFS[0]!
  for (let i = 1; i < LANCZOS_COEFFS.length; i += 1) {
    x += LANCZOS_COEFFS[i]! / (zm1 + i)
  }
  const t = zm1 + 7.5
  return 0.5 * Math.log(2 * Math.PI) + (zm1 + 0.5) * Math.log(t) - t + Math.log(x)
}

/** Regularized lower incomplete gamma P(a, x). */
function regGammaP(a: number, x: number): number {
  if (x <= 0) return 0
  if (x < a + 1) {
    let ap = a
    let sum = 1 / a
    let del = sum
    for (let n = 1; n <= 160; n += 1) {
      ap += 1
      del *= x / ap
      sum += del
      if (Math.abs(del) < Math.abs(sum) * 1e-12) break
    }
    return Math.min(1, Math.max(0, sum * Math.exp(-x + a * Math.log(x) - lnGamma(a))))
  }
  // Lentz continued fraction for Q(a, x) = 1 - P(a, x)
  let b = x + 1 - a
  let c = 1 / 1e-30
  let d = 1 / b
  let h = d
  for (let i = 1; i <= 160; i += 1) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b
    if (Math.abs(d) < 1e-30) d = 1e-30
    c = b + an / c
    if (Math.abs(c) < 1e-30) c = 1e-30
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 1e-12) break
  }
  const q = Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h
  return Math.min(1, Math.max(0, 1 - q))
}

function betacf(a: number, b: number, x: number): number {
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < 1e-30) d = 1e-30
  d = 1 / d
  let h = d
  for (let m = 1; m <= 160; m += 1) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < 1e-30) d = 1e-30
    c = 1 + aa / c
    if (Math.abs(c) < 1e-30) c = 1e-30
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < 1e-30) d = 1e-30
    c = 1 + aa / c
    if (Math.abs(c) < 1e-30) c = 1e-30
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 1e-12) break
  }
  return h
}

/** Regularized incomplete beta I_x(a, b). */
function regBetaI(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x))
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betacf(a, b, x)) / a
  }
  return 1 - (bt * betacf(b, a, 1 - x)) / b
}

export function analyzeProbabilityDistribution(config: DistributionConfig): DistributionAnalysis {
  const lo = Math.min(config.intervalA, config.intervalB)
  const hi = Math.max(config.intervalA, config.intervalB)
  const isDiscrete = config.kind === "binomial" || config.kind === "poisson"

  if (isDiscrete) {
    let mean: number
    let variance: number
    let maxK: number
    const pmf = (k: number): number => {
      if (config.kind === "binomial") {
        const n = Math.max(1, Math.min(80, Math.round(config.param1)))
        const p = Math.max(0.01, Math.min(0.99, config.param2 ?? 0.5))
        if (k < 0 || k > n) return 0
        if (p === 0) return k === 0 ? 1 : 0
        if (p === 1) return k === n ? 1 : 0
        const logComb = lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1)
        return Math.exp(logComb + k * Math.log(p) + (n - k) * Math.log(1 - p))
      }
      const lam = Math.max(0.2, Math.min(40, config.param1))
      if (k < 0) return 0
      return Math.exp(k * Math.log(lam) - lam - lnGamma(k + 1))
    }

    if (config.kind === "binomial") {
      const n = Math.max(1, Math.min(80, Math.round(config.param1)))
      const p = Math.max(0.01, Math.min(0.99, config.param2 ?? 0.5))
      mean = n * p
      variance = n * p * (1 - p)
      maxK = n
    } else {
      const lam = Math.max(0.2, Math.min(40, config.param1))
      mean = lam
      variance = lam
      maxK = Math.max(12, Math.ceil(lam + 4.5 * Math.sqrt(lam)))
    }

    const discreteBars: DiscreteBar[] = []
    const cdfCurve: Point2D[] = []
    let cum = 0
    let intervalProb = 0
    let maxProb = 0.1

    for (let k = 0; k <= maxK; k += 1) {
      const p = pmf(k)
      cum = Math.min(1, cum + p)
      const inside = k >= lo - 1e-9 && k <= hi + 1e-9
      if (inside) intervalProb += p
      if (p > maxProb) maxProb = p
      discreteBars.push({ k, prob: p, cdf: cum, inInterval: inside })
      cdfCurve.push({ x: k, y: cum })
    }

    return {
      kind: config.kind,
      isDiscrete: true,
      mean,
      variance,
      stdDev: Math.sqrt(variance),
      interval: [lo, hi],
      intervalProb: Math.min(1, Math.max(0, intervalProb)),
      pdfCurve: [],
      cdfCurve,
      shadedPolygon: [],
      discreteBars,
      suggestedBounds: {
        xMin: -1,
        xMax: maxK + 1,
        yMin: -maxProb * 0.12,
        yMax: Math.max(maxProb * 1.25, 0.25)
      }
    }
  }

  // Continuous distributions
  let mean: number
  let variance: number
  let xMin: number
  let xMax: number
  let pdf: (x: number) => number
  let cdf: (x: number) => number

  if (config.kind === "normal") {
    const mu = config.param1
    const sigma = Math.max(0.1, config.param2 ?? 1)
    mean = mu
    variance = sigma * sigma
    xMin = mu - 4.2 * sigma
    xMax = mu + 4.2 * sigma
    pdf = (x) => Math.exp(-0.5 * ((x - mu) / sigma) ** 2) / (sigma * Math.sqrt(2 * Math.PI))
    cdf = (x) => 0.5 * (1 + erfApprox((x - mu) / (sigma * Math.SQRT2)))
  } else if (config.kind === "student_t") {
    const nu = Math.max(1, Math.min(120, config.param1))
    mean = nu > 1 ? 0 : Number.NaN
    variance = nu > 2 ? nu / (nu - 2) : Number.POSITIVE_INFINITY
    xMin = -5
    xMax = 5
    const normConst = Math.exp(lnGamma((nu + 1) / 2) - lnGamma(nu / 2)) / Math.sqrt(nu * Math.PI)
    pdf = (x) => normConst * (1 + (x * x) / nu) ** (-(nu + 1) / 2)
    cdf = (x) => {
      const ib = regBetaI(nu / (nu + x * x), nu / 2, 0.5)
      return x >= 0 ? 1 - 0.5 * ib : 0.5 * ib
    }
  } else if (config.kind === "chi_square") {
    const k = Math.max(1, Math.min(60, config.param1))
    mean = k
    variance = 2 * k
    xMin = -0.5
    xMax = Math.max(10, k + 4.2 * Math.sqrt(2 * k))
    const logDenom = (k / 2) * Math.LN2 + lnGamma(k / 2)
    pdf = (x) => (x <= 0 ? 0 : Math.exp((k / 2 - 1) * Math.log(x) - x / 2 - logDenom))
    cdf = (x) => (x <= 0 ? 0 : regGammaP(k / 2, x / 2))
  } else {
    // Exponential(lambda)
    const lam = Math.max(0.1, config.param1)
    mean = 1 / lam
    variance = 1 / (lam * lam)
    xMin = -0.4 / lam
    xMax = 5.5 / lam
    pdf = (x) => (x < 0 ? 0 : lam * Math.exp(-lam * x))
    cdf = (x) => (x < 0 ? 0 : 1 - Math.exp(-lam * x))
  }

  const samples = 280
  const dx = (xMax - xMin) / samples
  const pdfCurve: Point2D[] = []
  const cdfCurve: Point2D[] = []
  let maxPdf = 0.2

  for (let i = 0; i <= samples; i += 1) {
    const x = xMin + i * dx
    const p = pdf(x)
    const c = cdf(x)
    const cleanP = Number.isFinite(p) ? Math.min(20, p) : 0
    if (cleanP > maxPdf) maxPdf = cleanP
    pdfCurve.push({ x, y: cleanP })
    cdfCurve.push({ x, y: Number.isFinite(c) ? c : 0 })
  }

  const clampedLo = Math.max(xMin, lo)
  const clampedHi = Math.min(xMax, hi)
  const shadedPolygon: Point2D[] = []
  if (clampedHi > clampedLo) {
    shadedPolygon.push({ x: clampedLo, y: 0 })
    const shadeSteps = 100
    for (let i = 0; i <= shadeSteps; i += 1) {
      const x = clampedLo + (i / shadeSteps) * (clampedHi - clampedLo)
      const p = pdf(x)
      shadedPolygon.push({ x, y: Number.isFinite(p) ? Math.min(20, p) : 0 })
    }
    shadedPolygon.push({ x: clampedHi, y: 0 })
  }

  const intervalProb = Math.max(0, Math.min(1, cdf(hi) - cdf(lo)))

  return {
    kind: config.kind,
    isDiscrete: false,
    mean,
    variance,
    stdDev: Math.sqrt(variance),
    interval: [lo, hi],
    intervalProb,
    pdfCurve,
    cdfCurve,
    shadedPolygon,
    discreteBars: [],
    suggestedBounds: {
      xMin,
      xMax,
      yMin: -maxPdf * 0.12,
      yMax: maxPdf * 1.22
    }
  }
}

function createMulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Simulates the Central Limit Theorem by drawing `numTrials` sample means of size `sampleSize`
 * from a non-normal parent distribution and overlaying the theoretical Gaussian limit.
 */
export function simulateCentralLimitTheorem(config: CltSimulationConfig): CltSimulationResult {
  const n = Math.max(1, Math.min(60, Math.round(config.sampleSize)))
  const trials = Math.max(100, Math.min(5000, Math.round(config.numTrials ?? 1500)))
  const rng = createMulberry32(config.seed ?? 20261124)

  let mu: number
  let sigma: number
  let drawOne: () => number

  if (config.parent === "uniform") {
    mu = 0.5
    sigma = Math.sqrt(1 / 12)
    drawOne = () => rng()
  } else if (config.parent === "exponential") {
    mu = 1
    sigma = 1
    drawOne = () => -Math.log(Math.max(1e-12, 1 - rng()))
  } else if (config.parent === "bimodal") {
    // Symmetric two-point +/-1 or tight bimodal peaks around 0 and 1
    mu = 0.5
    sigma = 0.5
    drawOne = () => (rng() < 0.5 ? 0 : 1)
  } else {
    // Fair 6-sided die {1, 2, 3, 4, 5, 6}
    mu = 3.5
    sigma = Math.sqrt(35 / 12)
    drawOne = () => Math.floor(rng() * 6) + 1
  }

  const means = new Float64Array(trials)
  let sumM = 0
  let minM = Number.POSITIVE_INFINITY
  let maxM = Number.NEGATIVE_INFINITY

  for (let t = 0; t < trials; t += 1) {
    let s = 0
    for (let i = 0; i < n; i += 1) s += drawOne()
    const m = s / n
    means[t] = m
    sumM += m
    if (m < minM) minM = m
    if (m > maxM) maxM = m
  }

  const empiricalMean = sumM / trials
  let varSum = 0
  for (let t = 0; t < trials; t += 1) {
    const d = means[t]! - empiricalMean
    varSum += d * d
  }
  const empiricalStdDev = Math.sqrt(varSum / Math.max(1, trials - 1))
  const theoreticalStdError = sigma / Math.sqrt(n)

  const span = Math.max(theoreticalStdError * 8, maxM - minM, 0.4)
  const histMin = mu - span * 0.55
  const histMax = mu + span * 0.55
  const binCount = 26
  const binWidth = (histMax - histMin) / binCount
  const counts = new Int32Array(binCount)

  for (let t = 0; t < trials; t += 1) {
    const idx = Math.floor((means[t]! - histMin) / binWidth)
    if (idx >= 0 && idx < binCount) counts[idx] = counts[idx]! + 1
  }

  const bins: CltHistogramBin[] = []
  let maxDensity = 0.2
  for (let b = 0; b < binCount; b += 1) {
    const density = counts[b]! / (trials * binWidth)
    if (density > maxDensity) maxDensity = density
    bins.push({
      xLeft: histMin + b * binWidth,
      xRight: histMin + (b + 1) * binWidth,
      count: counts[b]!,
      density
    })
  }

  const normalOverlay: Point2D[] = []
  const overlaySamples = 180
  for (let i = 0; i <= overlaySamples; i += 1) {
    const x = histMin + (i / overlaySamples) * (histMax - histMin)
    const y = Math.exp(-0.5 * ((x - mu) / theoreticalStdError) ** 2) / (theoreticalStdError * Math.sqrt(2 * Math.PI))
    if (y > maxDensity) maxDensity = y
    normalOverlay.push({ x, y })
  }

  return {
    parent: config.parent,
    sampleSize: n,
    numTrials: trials,
    theoreticalMean: mu,
    theoreticalStdError,
    empiricalMean,
    empiricalStdDev,
    bins,
    normalOverlay,
    suggestedBounds: {
      xMin: histMin,
      xMax: histMax,
      yMin: -maxDensity * 0.1,
      yMax: maxDensity * 1.22
    }
  }
}
