import type { LimitTarget1D } from "./calculus1dExtras"
import type { Matrix2x2 } from "./linalg2d"
import type { DoubleIntegralOrder } from "./multivariable"
import type { PdeKind } from "./pde"
import type { CltParentKind, DistributionKind } from "./probability"
import type { FourierWaveformKind } from "./series"

export type HigherMathRouteAction =
  | {
      module: "extrema1d"
      expression: string
      domain?: [number, number]
      x0?: number
      compareExpr?: string
      limitTarget?: LimitTarget1D
      computeIntegral?: boolean
      computeArcLength?: boolean
      computeVolume?: boolean
      computeRoots?: boolean
      summary: string
    }
  | {
      module: "parametricPolar"
      subMode: "parametric" | "polar"
      xExpr?: string
      yExpr?: string
      tRange?: [number, number]
      activeT?: number
      rExpr?: string
      thetaRange?: [number, number]
      activeTheta?: number
      summary: string
    }
  | {
      module: "lagrange"
      objective: string
      constraint: string
      summary: string
    }
  | {
      module: "ode1d"
      rhs: string
      x0?: number
      y0?: number
      xTarget?: number
      summary: string
    }
  | {
      module: "phase2d"
      pExpr: string
      qExpr: string
      probePoint?: [number, number]
      computeDivCurl?: boolean
      summary: string
    }
  | {
      module: "surface3d"
      expression: string
      tangentPoint?: [number, number]
      dirAngleDeg?: number
      summary: string
    }
  | {
      module: "pde"
      kind: PdeKind
      initialExpr?: string
      summary: string
    }
  | {
      module: "series"
      subMode: "taylor" | "fourier"
      expression?: string
      center?: number
      evalAt?: number
      order?: number
      waveform?: FourierWaveformKind
      halfPeriod?: number
      summary: string
    }
  | {
      module: "doubleIntegral"
      order: DoubleIntegralOrder
      integrand?: string
      outerMinExpr?: string
      outerMaxExpr?: string
      innerMinExpr?: string
      innerMaxExpr?: string
      summary: string
    }
  | {
      module: "linalg"
      matrix: Matrix2x2
      summary: string
    }
  | {
      module: "probability"
      subMode: "dist" | "clt"
      kind?: DistributionKind
      param1?: number
      param2?: number
      interval?: [number, number]
      sampleSize?: number
      parent?: CltParentKind
      summary: string
    }

function parseScalarExpr(raw: string): number | undefined {
  const s = raw.trim().replace(/[−–—]/gu, "-").replace(/π/gu, "pi")
  if (!s) return undefined
  const direct = Number(s)
  if (Number.isFinite(direct)) return direct
  if (/^[+-]?pi$/iu.test(s)) return s.startsWith("-") ? -Math.PI : Math.PI
  const piFrac = s.match(/^([+-]?\d*(?:\.\d+)?)\s*\*?\s*pi(?:\s*\/\s*(\d+(?:\.\d+)?))?$/iu)
  if (piFrac) {
    const numStr = piFrac[1] ?? ""
    const num = numStr === "" || numStr === "+" ? 1 : numStr === "-" ? -1 : Number(numStr)
    const den = piFrac[2] ? Number(piFrac[2]) : 1
    if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) return (num * Math.PI) / den
  }
  const frac = s.match(/^([+-]?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/u)
  if (frac) {
    const num = Number(frac[1])
    const den = Number(frac[2])
    if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) return num / den
  }
  return undefined
}

function extractInterval(text: string): [number, number] | undefined {
  const m = text.match(/\[\s*([^,\]]+?)\s*[,，]\s*([^\]]+?)\s*\]/u)
  if (!m) return undefined
  const a = parseScalarExpr(m[1]!)
  const b = parseScalarExpr(m[2]!)
  if (a !== undefined && b !== undefined && a !== b) {
    return a < b ? [a, b] : [b, a]
  }
  return undefined
}

function extractPoint2D(text: string): [number, number] | undefined {
  const m = text.match(/(?:点\s*[A-Za-z0-9_]*\s*)?\(\s*([+-]?\d+(?:\.\d+)?)\s*[,，]\s*([+-]?\d+(?:\.\d+)?)\s*\)/u)
  if (!m) return undefined
  const x = Number(m[1])
  const y = Number(m[2])
  if (Number.isFinite(x) && Number.isFinite(y)) return [x, y]
  return undefined
}

function extractMatrix2x2(text: string): Matrix2x2 | null {
  const nested = text.match(/\[\s*\[\s*([+-]?\d+(?:\.\d+)?)\s*[,，\s]\s*([+-]?\d+(?:\.\d+)?)\s*\]\s*[,，;；]?\s*\[\s*([+-]?\d+(?:\.\d+)?)\s*[,，\s]\s*([+-]?\d+(?:\.\d+)?)\s*\]\s*\]/u)
  if (nested) {
    return [[Number(nested[1]), Number(nested[2])], [Number(nested[3]), Number(nested[4])]]
  }
  const semi = text.match(/\[\s*([+-]?\d+(?:\.\d+)?)\s*[,，\s]\s*([+-]?\d+(?:\.\d+)?)\s*[;；]\s*([+-]?\d+(?:\.\d+)?)\s*[,，\s]\s*([+-]?\d+(?:\.\d+)?)\s*\]/u)
  if (semi) {
    return [[Number(semi[1]), Number(semi[2])], [Number(semi[3]), Number(semi[4])]]
  }
  return null
}

function cleanFormulaToken(raw: string): string {
  return raw
    .trim()
    .replace(/[，。；！？、]+$/gu, "")
    .replace(/\s*(?:在|上|的|当|满足|受限于|其中|求|并).*$/u, "")
    .trim()
}

function extractProbInterval(text: string): [number, number] | undefined {
  const between = text.match(/P\s*\(\s*([+-]?\d+(?:\.\d+)?)\s*(?:<=|≤|<)\s*[A-Za-z]\s*(?:<=|≤|<)\s*([+-]?\d+(?:\.\d+)?)\s*\)/iu)
  if (between) {
    const a = Number(between[1])
    const b = Number(between[2])
    if (Number.isFinite(a) && Number.isFinite(b)) return a <= b ? [a, b] : [b, a]
  }
  const upper = text.match(/P\s*\(\s*[A-Za-z]\s*(?:<=|≤|<)\s*([+-]?\d+(?:\.\d+)?)\s*\)/iu)
  if (upper) {
    const b = Number(upper[1])
    if (Number.isFinite(b)) return [-1e4, b]
  }
  const lower = text.match(/P\s*\(\s*[A-Za-z]\s*(?:>=|≥|>)\s*([+-]?\d+(?:\.\d+)?)\s*\)/iu)
  if (lower) {
    const a = Number(lower[1])
    if (Number.isFinite(a)) return [a, 1e4]
  }
  return extractInterval(text)
}

/**
 * Deterministic zero-latency university math prompt parser that maps natural-language
 * Chinese/English problem statements directly to the matching module and parameters.
 */
export function routeHigherMathPrompt(rawPrompt: string): HigherMathRouteAction | null {
  const text = rawPrompt.trim()
  if (!text) return null

  // 1. Matrix / Linear Algebra / SVD / Eigenvalues
  const mat = extractMatrix2x2(text)
  if (mat || /矩阵|特征值|特征向量|奇异值|\bsvd\b|线性变换/iu.test(text)) {
    const resolvedMat: Matrix2x2 = mat ?? (
      /旋转/u.test(text) ? [[0.8, -0.6], [0.6, 0.8]]
        : /错切/u.test(text) ? [[1, 1.2], [0, 1]]
          : /降维|奇异|塌缩|秩\s*1/u.test(text) ? [[1.2, 0.6], [0.8, 0.4]]
            : [[2, 0.8], [0.8, 1.2]]
    )
    return {
      module: "linalg",
      matrix: resolvedMat,
      summary: `已切入「线性代数矩阵变换」：A = [[${resolvedMat[0][0]}, ${resolvedMat[0][1]}], [${resolvedMat[1][0]}, ${resolvedMat[1][1]}]]`
    }
  }

  // 2. Probability / Statistics / CLT
  if (/中心极限定理|\bclt\b|样本均值抽样|大数定律/iu.test(text)) {
    const nMatch = text.match(/n\s*[=＝]\s*(\d+)/iu) ?? text.match(/(\d+)\s*(?:个样本|阶|次)/u)
    const sampleSize = nMatch ? Math.max(1, Math.min(50, Number(nMatch[1]))) : 12
    const parent: CltParentKind = /指数/u.test(text)
      ? "exponential"
      : /双峰|两点|伯努利/u.test(text)
        ? "bimodal"
        : /骰子/u.test(text)
          ? "dice"
          : "exponential"
    return {
      module: "probability",
      subMode: "clt",
      sampleSize,
      parent,
      summary: `已切入「中心极限定理抽样模拟」（n = ${sampleSize}）`
    }
  }

  if (
    !/泰勒|麦克劳林|傅里叶|taylor|maclaurin|fourier/iu.test(text) &&
    (/正态分布|标准正态|卡方分布|\bt\s*分布|二项分布|泊松分布|指数分布/iu.test(text) ||
      /\b(?:N|B)\s*\(\s*[+-]?\d+\s*[,，]\s*[+-]?[0-9.]/u.test(text) ||
      /(?:~|服从)\s*(?:Exp|Poisson)\s*\(/u.test(text))
  ) {
    const interval = extractProbInterval(text)
    const normalMatch = text.match(/N\s*\(\s*([+-]?\d+(?:\.\d+)?)\s*[,，]\s*([+-]?\d+(?:\.\d+)?(?:\^2|²)?)\s*\)/iu)
    if (normalMatch) {
      const mu = Number(normalMatch[1])
      const rawVar = normalMatch[2]!
      const sigma = rawVar.endsWith("^2") || rawVar.endsWith("²")
        ? Math.abs(Number(rawVar.replace(/(\^2|²)$/u, "")))
        : Math.sqrt(Math.max(0.0001, Number(rawVar)))
      return {
        module: "probability",
        subMode: "dist",
        kind: "normal",
        param1: mu,
        param2: sigma,
        interval,
        summary: `已切入「概率分布实验室」：正态分布 N(${mu}, ${rawVar})`
      }
    }
    const binomMatch = text.match(/B\s*\(\s*(\d+)\s*[,，]\s*(0?\.\d+|\d+\/\d+)\s*\)/iu)
    if (binomMatch || /二项分布/u.test(text)) {
      const n = binomMatch ? Number(binomMatch[1]) : Number(text.match(/n\s*[=＝]\s*(\d+)/iu)?.[1] ?? 10)
      const p = binomMatch
        ? (parseScalarExpr(binomMatch[2]!) ?? 0.5)
        : (parseScalarExpr(text.match(/p\s*[=＝]\s*([0-9./]+)/iu)?.[1] ?? "0.5") ?? 0.5)
      return {
        module: "probability",
        subMode: "dist",
        kind: "binomial",
        param1: n,
        param2: p,
        interval,
        summary: `已切入「概率分布实验室」：二项分布 B(${n}, ${p})`
      }
    }
    const poisMatch = text.match(/(?:Poisson|泊松分布[^0-9+-]*?λ?\s*[=＝(]?)\s*(\d+(?:\.\d+)?)/iu)
    if (/泊松|poisson/iu.test(text)) {
      const lambda = poisMatch ? Number(poisMatch[1]) : 4
      return {
        module: "probability",
        subMode: "dist",
        kind: "poisson",
        param1: lambda,
        interval,
        summary: `已切入「概率分布实验室」：泊松分布 Poisson(${lambda})`
      }
    }
    const expMatch = text.match(/(?:Exp\s*\(\s*|指数分布[^0-9+-]*?(?:λ|lambda|参数)?\s*[=＝]?\s*)(\d+(?:\.\d+)?)/iu)
    if (/指数分布|\bExp\s*\(/iu.test(text)) {
      const rate = expMatch ? Number(expMatch[1]) : 1
      return {
        module: "probability",
        subMode: "dist",
        kind: "exponential",
        param1: rate,
        interval,
        summary: `已切入「概率分布实验室」：指数分布 Exp(${rate})`
      }
    }
    const chiMatch = text.match(/(?:卡方分布|chi[_\s-]*square|\bχ²)\s*\(?[^0-9]*(\d+)/iu)
    if (/卡方|chi|χ²/iu.test(text)) {
      const df = chiMatch ? Number(chiMatch[1]) : 4
      return {
        module: "probability",
        subMode: "dist",
        kind: "chi_square",
        param1: df,
        interval,
        summary: `已切入「概率分布实验室」：卡方分布 χ²(${df})`
      }
    }
    if (/t\s*分布/iu.test(text)) {
      const df = Number(text.match(/(?:自由度|t\s*\()\s*(\d+)/iu)?.[1] ?? 5)
      return {
        module: "probability",
        subMode: "dist",
        kind: "student_t",
        param1: df,
        interval,
        summary: `已切入「概率分布实验室」：t 分布 t(${df})`
      }
    }
    return {
      module: "probability",
      subMode: "dist",
      kind: "normal",
      param1: 0,
      param2: 1,
      interval,
      summary: "已切入「概率分布实验室」：标准正态分布 N(0, 1)"
    }
  }

  // 3. PDE (Heat / Wave / Poisson / Laplace)
  if (/偏微分|热传导|波动方程|弦振动|膜振动|泊松方程|拉普拉斯|\bpde\b/iu.test(text)) {
    const kind: PdeKind = /波动|振动|wave/iu.test(text)
      ? "wave2d"
      : /泊松|拉普拉斯|稳态|电势|laplace|poisson/iu.test(text)
        ? "poisson2d"
        : "heat2d"
    return {
      module: "pde",
      kind,
      summary: `已切入「PDE 偏微分方程模拟」（${kind === "heat2d" ? "2D 热传导" : kind === "wave2d" ? "2D 波动方程" : "2D 泊松/拉普拉斯"}）`
    }
  }

  // 4. Taylor & Fourier Series
  if (/傅里叶|吉布斯|gibbs|fourier|方波|锯齿波|三角波/iu.test(text)) {
    const orderMatch = text.match(/(\d+)\s*(?:阶|项|次谐波)/u) ?? text.match(/[nN]\s*[=＝]\s*(\d+)/u)
    const order = orderMatch ? Number(orderMatch[1]) : 9
    const waveform: FourierWaveformKind = /锯齿/u.test(text)
      ? "sawtooth"
      : /三角波/u.test(text)
        ? "triangle"
        : /整流/u.test(text)
          ? "full_rectified"
          : "square"
    return {
      module: "series",
      subMode: "fourier",
      waveform,
      order,
      summary: `已切入「傅里叶级数合成」（N = ${order} 阶）`
    }
  }

  if (/泰勒|麦克劳林|taylor|maclaurin/iu.test(text)) {
    const orderMatch = text.match(/(\d+)\s*阶/u) ?? text.match(/n\s*[=＝]\s*(\d+)/iu)
    const order = orderMatch ? Number(orderMatch[1]) : 5
    const centerMatch = text.match(/x_?0\s*[=＝]\s*([+-]?\d+(?:\.\d+)?)/iu) ??
      text.match(/在\s*x\s*[=＝]\s*([+-]?\d+(?:\.\d+)?)\s*处/iu)
    const center = /麦克劳林|maclaurin/iu.test(text)
      ? 0
      : centerMatch
        ? Number(centerMatch[1])
        : 0
    const evalMatch = text.match(/(?:估计|计算|近似|求)\s*[A-Za-z]?\(\s*([+-]?\d+(?:\.\d+)?)\s*\)/u)
    const evalAt = evalMatch ? Number(evalMatch[1]) : undefined
    const fnMatch =
      text.match(/(?:f\(x\)\s*[=＝]\s*|y\s*[=＝]\s*)([^,，。；]+?)(?:\s*在|\s*的|\s*展开|$)/iu) ??
      text.match(/将(?:函数)?\s*([A-Za-z0-9_+*/^().\s-]+?)(?:\s*在|\s*展开|\s*的|,|，|$)/u)
    const expr = fnMatch ? cleanFormulaToken(fnMatch[1]!) : "sin(x)"
    return {
      module: "series",
      subMode: "taylor",
      expression: expr || "sin(x)",
      center,
      ...(evalAt !== undefined ? { evalAt } : {}),
      order,
      summary: `已切入「泰勒级数动态逼近」：${expr || "sin(x)"}（x₀ = ${center}, n = ${order} 阶）`
    }
  }

  // 5. Double Integral
  if (/二重积分|累次积分|交换积分次序|极坐标积分|∬/u.test(text)) {
    const isPolar = /极坐标|polar|x\^2\s*\+\s*y\^2\s*(?:<=|≤|<|=)\s*\d+|x²\s*\+\s*y²/iu.test(text)
    const order: DoubleIntegralOrder = isPolar
      ? "polar"
      : /先\s*x\s*后\s*y|dx\s*dy.*y\s*[∈=]/iu.test(text)
        ? "yx"
        : "xy"
    const intMatch =
      text.match(/∬(?:_[A-Za-z0-9]+)?\s*\(?\s*([^,，;；]+?)\s*\)?\s*d[xyr]/iu) ??
      text.match(/被积函数(?:\s*f\(x\s*,\s*y\))?\s*[=＝为]?\s*([^,，。；]+?)(?:\s*在|\s*其中|,|，|$)/iu) ??
      text.match(/二重积分\s*([xXyYr0-9_+*/^().\s-]+?)\s*(?:dx|dy|在|其中|,|，)/iu)
    const integrand = intMatch ? cleanFormulaToken(intMatch[1]!) : undefined

    if (isPolar) {
      const rSqMatch = text.match(/x(?:\^2|²)\s*\+\s*y(?:\^2|²)\s*(?:<=|≤|<|=)\s*(\d+(?:\.\d+)?)/iu)
      const rMax = rSqMatch ? String(Math.sqrt(Number(rSqMatch[1]))) : "2"
      const firstQuad = /第一象限|x\s*(?:>=|≥)\s*0.*y\s*(?:>=|≥)\s*0/iu.test(text)
      const upperHalf = /上半|y\s*(?:>=|≥)\s*0/iu.test(text) && !firstQuad
      const thetaMax = firstQuad ? "pi/2" : upperHalf ? "pi" : "2*pi"
      const polarIntegrand = integrand
        ? integrand
            .replace(/x(?:\^2|²)\s*\+\s*y(?:\^2|²)/giu, "r^2")
            .replace(/(?<![A-Za-z_])x(?![A-Za-z_])/gu, "(r*cos(theta))")
            .replace(/(?<![A-Za-z_])y(?![A-Za-z_])/gu, "(r*sin(theta))")
        : undefined
      return {
        module: "doubleIntegral",
        order: "polar",
        ...(polarIntegrand ? { integrand: polarIntegrand } : {}),
        outerMinExpr: "0",
        outerMaxExpr: thetaMax,
        innerMinExpr: "0",
        innerMaxExpr: rMax,
        summary: `已切入「二重积分与极坐标」（极坐标 r ∈ [0, ${rMax}], θ ∈ [0, ${thetaMax}]）`
      }
    }

    const xBoundsMatch =
      text.match(/([+-]?\d+(?:\.\d+)?)\s*(?:<=|≤|<)\s*x\s*(?:<=|≤|<)\s*([+-]?\d+(?:\.\d+)?)/iu) ??
      text.match(/x\s*∈\s*\[\s*([^,\]]+?)\s*[,，]\s*([^\]]+?)\s*\]/iu)
    const yBoundsMatch =
      text.match(/([^,，；;\s]+)\s*(?:<=|≤|<)\s*y\s*(?:<=|≤|<)\s*([^,，。；;\s]+)/iu) ??
      text.match(/y\s*∈\s*\[\s*([^,\]]+?)\s*[,，]\s*([^\]]+?)\s*\]/iu)
    return {
      module: "doubleIntegral",
      order,
      ...(integrand ? { integrand } : {}),
      ...(xBoundsMatch ? { outerMinExpr: xBoundsMatch[1]!.trim(), outerMaxExpr: xBoundsMatch[2]!.trim() } : {}),
      ...(yBoundsMatch ? { innerMinExpr: yBoundsMatch[1]!.trim(), innerMaxExpr: yBoundsMatch[2]!.trim() } : {}),
      summary: `已切入「二重积分与极坐标」（${order === "xy" ? "先 y 后 x" : "先 x 后 y"}）`
    }
  }

  // 5b. Vector field Divergence & Curl
  if (/散度|旋度|\bdiv\b|\bcurl\b/iu.test(text)) {
    const vecMatch = text.match(/F(?:\(x\s*,\s*y\))?\s*[=＝]\s*\(\s*([^,，]+)\s*[,，]\s*([^)]+)\s*\)/iu)
    const pExpr = vecMatch ? cleanFormulaToken(vecMatch[1]!) : "x^2*y"
    const qExpr = vecMatch ? cleanFormulaToken(vecMatch[2]!) : "-x*y^2"
    const pt = extractPoint2D(text.replace(/F(?:\(x\s*,\s*y\))?\s*[=＝]\s*\([^)]+\)/iu, "")) ?? [1, 1]
    return {
      module: "phase2d",
      pExpr,
      qExpr,
      probePoint: pt,
      computeDivCurl: true,
      summary: `已切入「平面向量场散度与旋度」：F = (${pExpr}, ${qExpr})`
    }
  }

  // 5c. Parametric & Polar Curves (must run after Double Integral so polar double integrals stay in #5)
  const paramPairMatch = text.match(/x(?:\(t\))?\s*[=＝]\s*([^,，;；]+?)\s*[,，;；\s]+y(?:\(t\))?\s*[=＝]\s*([^,，。;；]+)/iu)
  if (
    paramPairMatch ||
    /参数方程|摆线|星形线|利萨茹/u.test(text)
  ) {
    const tRange = extractInterval(text) ?? [0, 2 * Math.PI]
    const t0Match = text.match(/t_?0?\s*[=＝]\s*([^\s,，。；]+)/iu)
    const activeT = t0Match ? parseScalarExpr(t0Match[1]!) : undefined
    let xExpr = paramPairMatch ? cleanFormulaToken(paramPairMatch[1]!) : "t - sin(t)"
    let yExpr = paramPairMatch ? cleanFormulaToken(paramPairMatch[2]!) : "1 - cos(t)"
    if (!paramPairMatch) {
      if (/星形线/u.test(text)) { xExpr = "2*cos(t)^3"; yExpr = "2*sin(t)^3" }
      else if (/利萨茹/u.test(text)) { xExpr = "2.5*sin(3*t)"; yExpr = "2.5*sin(2*t)" }
    }
    return {
      module: "parametricPolar",
      subMode: "parametric",
      xExpr,
      yExpr,
      tRange,
      ...(activeT !== undefined ? { activeT } : {}),
      summary: `已切入「参数与极坐标」参数方程：x(t) = ${xExpr}, y(t) = ${yExpr}`
    }
  }

  const polarExprMatch = text.match(/r(?:\(\s*(?:θ|theta)\s*\))?\s*[=＝]\s*([^,，。;；]+)/iu)
  if (
    polarExprMatch ||
    /极坐标|心脏线|心形线|玫瑰线|阿基米德螺线|蜗线/u.test(text)
  ) {
    const thetaRange = extractInterval(text) ?? (/三叶玫瑰/u.test(text) ? [0, Math.PI] : [0, 2 * Math.PI])
    const th0Match = text.match(/(?:θ|theta)_?0?\s*[=＝]\s*([^\s,，。；]+)/iu)
    const activeTheta = th0Match ? parseScalarExpr(th0Match[1]!) : undefined
    let rExpr = polarExprMatch ? cleanFormulaToken(polarExprMatch[1]!) : "1 + cos(theta)"
    if (!polarExprMatch) {
      if (/三叶玫瑰/u.test(text)) rExpr = "2*cos(3*theta)"
      else if (/四叶玫瑰|玫瑰线/u.test(text)) rExpr = "2*sin(2*theta)"
      else if (/阿基米德螺线/u.test(text)) rExpr = "0.35*theta"
      else if (/蜗线/u.test(text)) rExpr = "1 + 2*cos(theta)"
    }
    return {
      module: "parametricPolar",
      subMode: "polar",
      rExpr,
      thetaRange,
      ...(activeTheta !== undefined ? { activeTheta } : {}),
      summary: `已切入「参数与极坐标」极坐标：r(θ) = ${rExpr}`
    }
  }

  // 6. Lagrange Multipliers (objective + constraint equation)
  if (/拉格朗日|条件极值|(?:在|受限于|满足).*约束|(?:约束|条件).*(?:极值|最大值|最小值|最值)/u.test(text)) {
    const fMatch =
      text.match(/(?:目标函数\s*)?(?:f\(\s*x\s*,\s*y\s*\)|u|z)\s*[=＝]\s*([^,，。；;]+?)(?:\s*在|\s*满足|\s*受限|,|，|;|$)/iu) ??
      text.match(/求(?:函数)?\s*([xXyY0-9_+*/^().\s-]+?)\s*(?:在|受限|满足)/u)
    const objective = fMatch ? cleanFormulaToken(fMatch[1]!) : "x + 2*y"
    const textWithoutObj = fMatch ? text.replace(fMatch[0], " ") : text
    const eqMatches = [...textWithoutObj.matchAll(/([xXyY0-9_+*/^().\s-]+\s*[=＝]\s*[+-]?[xXyY0-9_+*/^().\s-]+)/gu)]
    const constraintRaw = eqMatches[0]?.[1]
    const constraint = constraintRaw ? constraintRaw.trim().replace(/[，。；！？、]+$/gu, "").replace(/\s*(?:下|上|处|的|时).*$/u, "").trim() : "x^2 + y^2 = 4"
    return {
      module: "lagrange",
      objective,
      constraint,
      summary: `已切入「拉格朗日乘数法」：f = ${objective}，约束 ${constraint}`
    }
  }

  // 7. Phase Plane (x' = ..., y' = ...)
  const phaseMatch = text.match(/(?:dx\/dt|x')\s*[=＝]\s*([^,，;；]+)[,，;；\s]+(?:dy\/dt|y')\s*[=＝]\s*([^,，。;；]+)/iu)
  if (phaseMatch || /相平面|自治系统|极限环|捕食者/u.test(text)) {
    const pExpr = phaseMatch ? cleanFormulaToken(phaseMatch[1]!) : "y"
    const qExpr = phaseMatch ? cleanFormulaToken(phaseMatch[2]!) : "-sin(x) - 0.35*y"
    return {
      module: "phase2d",
      pExpr,
      qExpr,
      summary: `已切入「相平面向量场」：x' = ${pExpr}, y' = ${qExpr}`
    }
  }

  // 8. 1st-Order ODE (y' = ... or dy/dx = ...)
  const odeMatch = text.match(/(?:dy\/dx|y')\s*[=＝]\s*([^,，。;；]+)/iu)
  if (odeMatch || /斜率场|一阶微分方程|初值问题/u.test(text)) {
    const rhs = odeMatch ? cleanFormulaToken(odeMatch[1]!) : "y * (1 - y / 3)"
    const ivpMatch = text.match(/y\s*\(\s*([+-]?\d+(?:\.\d+)?)\s*\)\s*[=＝]\s*([+-]?\d+(?:\.\d+)?)/iu)
    const targetMatch = text.match(/(?:求|计算|估计)\s*y\s*\(\s*([+-]?\d+(?:\.\d+)?)\s*\)/iu)
    return {
      module: "ode1d",
      rhs,
      ...(ivpMatch ? { x0: Number(ivpMatch[1]), y0: Number(ivpMatch[2]) } : {}),
      ...(targetMatch ? { xTarget: Number(targetMatch[1]) } : {}),
      summary: `已切入「ODE 斜率场」：y' = ${rhs}`
    }
  }

  // 9. 3D Surface (z = ... or f(x, y) = ... without Lagrange constraint)
  const zMatch =
    text.match(/(?:曲面\s*)?z\s*[=＝]\s*([^,，。;；]+)/iu) ??
    text.match(/f\(\s*x\s*,\s*y\s*\)\s*[=＝]\s*([^,，。;；]+)/iu)
  if (zMatch || (/鞍点|三维曲面|二元函数|切平面|偏导|方向导数/u.test(text) && /y/iu.test(text))) {
    const expr = zMatch ? cleanFormulaToken(zMatch[1]!) : "x^3 - 3*x + y^2"
    const strippedForPt = text.replace(/f\(\s*x\s*,\s*y\s*\)/giu, "")
    const pt3Match = strippedForPt.match(/\(\s*([+-]?\d+(?:\.\d+)?)\s*[,，]\s*([+-]?\d+(?:\.\d+)?)(?:\s*[,，]\s*[+-]?\d+(?:\.\d+)?)?\s*\)/u)
    const tangentPoint: [number, number] | undefined =
      /切平面|法线|在点|方向导数/u.test(text) && pt3Match
        ? [Number(pt3Match[1]), Number(pt3Match[2])]
        : undefined
    let dirAngleDeg: number | undefined
    const degMatch = text.match(/(?:方向角|夹角|角度|θ)\s*[=＝为]?\s*([+-]?\d+(?:\.\d+)?)\s*[°度]/iu)
    const dirVecMatch = text.match(/(?:沿方向|方向向量|方向)\s*(?:[lLvV]\u20d7?)?\s*[=＝]?\s*\(\s*([+-]?\d+(?:\.\d+)?)\s*[,，]\s*([+-]?\d+(?:\.\d+)?)\s*\)/iu)
    if (degMatch) {
      dirAngleDeg = Number(degMatch[1])
    } else if (dirVecMatch) {
      const vx = Number(dirVecMatch[1])
      const vy = Number(dirVecMatch[2])
      if (Math.hypot(vx, vy) > 1e-9) {
        dirAngleDeg = Math.round(((Math.atan2(vy, vx) * 180) / Math.PI + 360) % 360)
      }
    } else if (/方向导数/u.test(text)) {
      dirAngleDeg = 45
    }
    return {
      module: "surface3d",
      expression: expr,
      ...(tangentPoint ? { tangentPoint } : {}),
      ...(dirAngleDeg !== undefined ? { dirAngleDeg } : {}),
      summary: `已切入「3D 曲面与鞍点」：z = ${expr}${dirAngleDeg !== undefined ? `（方向导数 θ=${dirAngleDeg}°）` : ""}`
    }
  }

  // 10. 1D Definite Integral / Extrema / Limits / Arc Length / Revolution Volume / Dual Curve
  const int1dMatch = text.match(/∫_?\{?\s*([^}^,\s]+)\s*\}?\s*\^\s*\{?\s*([^}\s]+)\s*\}?\s*\(?\s*([^,，。；]+?)\s*\)?\s*dx/iu)
  if (int1dMatch) {
    const a = parseScalarExpr(int1dMatch[1]!)
    const b = parseScalarExpr(int1dMatch[2]!)
    const expr = cleanFormulaToken(int1dMatch[3]!)
    if (a !== undefined && b !== undefined && expr) {
      return {
        module: "extrema1d",
        expression: expr,
        domain: a < b ? [a, b] : [b, a],
        computeIntegral: true,
        summary: `已切入「一元函数与定积分」：∫_[${a}, ${b}] (${expr}) dx`
      }
    }
  }

  const interval = extractInterval(text)
  const computeIntegral = /定积分|曲线下面积|所围面积|围成面积|围成的面积/u.test(text)
  const computeArcLength = /弧长/u.test(text)
  const computeVolume = /旋转体|绕\s*x\s*轴/iu.test(text)
  const computeRoots = /零点|实根|方程求根/u.test(text)
  const x0Match = text.match(/x_?0?\s*[=＝]\s*([+-]?\d+(?:\.\d+)?)\s*处/iu)

  // Optional limit target: `lim_{x->0}`, `x -> +∞`, `x 趋于 0`, `在 x=0 处的极限/间断点`
  let limitTarget: LimitTarget1D | undefined
  if (/极限|间断点|\blim\b/iu.test(text)) {
    if (/(?:x\s*(?:->|→|趋于|趋向)\s*\+?\s*(?:∞|inf)|正无穷)/iu.test(text)) {
      limitTarget = { kind: "pos_inf" }
    } else if (/(?:x\s*(?:->|→|趋于|趋向)\s*[-−]\s*(?:∞|inf)|负无穷)/iu.test(text)) {
      limitTarget = { kind: "neg_inf" }
    } else {
      const limPtMatch = text.match(/(?:x\s*(?:->|→|趋于|趋向)|x_?0?\s*[=＝])\s*([+-]?\d+(?:\.\d+)?|pi|π)/iu)
      const val = limPtMatch ? parseScalarExpr(limPtMatch[1]!) : 0
      limitTarget = { kind: "point", x0: val ?? 0 }
    }
  }

  // Optional dual-curve g(x) comparison: `f(x)=... 与 g(x)=...` or `y=... 与 y=...`
  const gExplicitMatch = text.match(/g\(\s*x\s*\)\s*[=＝]\s*([^,，。；;]+?)(?:\s*在|\s*\[|\s*所围|\s*围成|\s*的交点|$)/iu)
  const twoYMatches = [...text.matchAll(/(?:f\(\s*x\s*\)|y)\s*[=＝]\s*([^,，。；;与和]+?)(?=\s*(?:与|和|在|\[|,|，|。|；|$))/giu)]
  let compareExpr: string | undefined
  if (gExplicitMatch) {
    compareExpr = cleanFormulaToken(gExplicitMatch[1]!)
  } else if (twoYMatches.length >= 2) {
    compareExpr = cleanFormulaToken(twoYMatches[1]![1]!)
  }

  const limExprMatch = text.match(/lim(?:_\{?[^}\s]+\}?)?\s*(?:\(\s*x\s*(?:->|→)\s*[^)]+\s*\))?\s*([^,，。；]+?)(?:\s*的极限|\s*的间断点|$)/iu)
  const f1Match =
    text.match(/(?:f\(\s*x\s*\)|y)\s*[=＝]\s*([^,，。；;与和]+?)(?:\s*在|\s*\[|\s*与|\s*和|$)/iu) ??
    text.match(/(?:求|计算|分析)(?:函数)?\s*([xX0-9_+*/^().\s-]+?)\s*(?:在|的极值|的最值|的最大值|的最小值|的拐点|的渐近线|的定积分|的极限|的间断点|的弧长|绕)/u) ??
    limExprMatch
  const expr1D = cleanFormulaToken(f1Match ? f1Match[1]! : text)
  if (expr1D) {
    return {
      module: "extrema1d",
      expression: expr1D,
      domain: interval,
      ...(x0Match ? { x0: Number(x0Match[1]) } : {}),
      ...(compareExpr ? { compareExpr } : {}),
      ...(limitTarget ? { limitTarget } : {}),
      ...(computeIntegral ? { computeIntegral: true } : {}),
      ...(computeArcLength ? { computeArcLength: true } : {}),
      ...(computeVolume ? { computeVolume: true } : {}),
      ...(computeRoots ? { computeRoots: true } : {}),
      summary: `已切入「一元微积分」：f(x) = ${expr1D}${compareExpr ? ` vs g(x) = ${compareExpr}` : ""}${interval ? `，区间 [${interval[0]}, ${interval[1]}]` : ""}`
    }
  }

  return null
}
