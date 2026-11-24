import { compileScalarField1D, compileScalarField2D, type CompiledScalarField2D } from "./bytecode"
import type { Point2D, ViewportBounds2D } from "./contour"

export type DoubleIntegralOrder = "xy" | "yx" | "polar"

export interface DoubleIntegralConfig {
  integrandExpr: string
  order: DoubleIntegralOrder
  /** Outer lower limit: `a` (for xy), `c` (for yx), or `alpha` in radians/expr (for polar). */
  outerMinExpr: string
  /** Outer upper limit: `b` (for xy), `d` (for yx), or `beta` (for polar). */
  outerMaxExpr: string
  /** Inner lower curve: `y1(x)`, `x1(y)`, or `r1(theta)` (variable `t` or `x`/`y`/`theta`). */
  innerMinExpr: string
  /** Inner upper curve: `y2(x)`, `x2(y)`, or `r2(theta)`. */
  innerMaxExpr: string
  partitions?: number
  /** Scan progress in [0, 1] showing live iterated-integral cross-section slice. */
  scanRatio?: number
}

export interface RiemannCell2D {
  polygon: Point2D[]
  center: Point2D
  value: number
  area: number
  volume: number
}

export interface DoubleIntegralAnalysis {
  order: DoubleIntegralOrder
  outerRange: [number, number]
  exactValue: number
  domainArea: number
  riemannSum: number
  domainPolygon: Point2D[]
  scanSlice: {
    outerParam: number
    segment: [Point2D, Point2D]
    innerLimits: [number, number]
  } | null
  cells: RiemannCell2D[]
  suggestedBounds: ViewportBounds2D
}

export interface DivCurlProbe {
  x: number
  y: number
  vx: number
  vy: number
  speed: number
  divergence: number
  curlZ: number
  divKind: "source" | "sink" | "incompressible"
  curlKind: "ccw" | "cw" | "irrotational"
}

// 12-point Gauss-Legendre nodes and weights on [-1, 1]
const GL12_NODES = [
  -0.9815606342467192, -0.9041172563704749, -0.7699026741943047,
  -0.5873179542866175, -0.3678314989981802, -0.1252334085114689,
   0.1252334085114689,  0.3678314989981802,  0.5873179542866175,
   0.7699026741943047,  0.9041172563704749,  0.9815606342467192
]

const GL12_WEIGHTS = [
  0.0471753363865118, 0.1069393259953184, 0.1600783285433462,
  0.2031674267230659, 0.2334925365383548, 0.2491470458134028,
  0.2491470458134028, 0.2334925365383548, 0.2031674267230659,
  0.1600783285433462, 0.1069393259953184, 0.0471753363865118
]

function normalizeSingleVarToX(expr: string, altVar: string): string {
  // Replace standalone identifier `y` or `theta` or `t` with `x` so compileScalarField1D evaluates it cleanly.
  const re = new RegExp(`\\b${altVar}\\b`, "gu")
  return expr.replace(re, "x")
}

function evalConstExpr(expr: string): number {
  const f = compileScalarField1D(expr)
  const v = f.eval(0)
  if (!Number.isFinite(v)) {
    throw new Error(`积分常数限 "${expr}" 无效`)
  }
  return v
}

/**
 * Computes exact numerical value, domain boundary polygon, live scan-line slice, and
 * Cartesian / Polar Riemann partition cells for double integrals `∬_D f(x, y) dσ`.
 */
export function analyzeDoubleIntegral(config: DoubleIntegralConfig): DoubleIntegralAnalysis {
  const usesPolarVars =
    config.order === "polar" && /(?<![A-Za-z_])(?:r|theta)(?![A-Za-z_])/u.test(config.integrandExpr)
  const effectiveIntegrand = usesPolarVars
    ? config.integrandExpr
        .replace(/(?<![A-Za-z_])r(?![A-Za-z_])/gu, "__R__")
        .replace(/(?<![A-Za-z_])theta(?![A-Za-z_])/gu, "y")
        .replace(/__R__/gu, "x")
    : config.integrandExpr
  const fField = compileScalarField2D(effectiveIntegrand, "expression")
  const rawOuterMin = evalConstExpr(config.outerMinExpr)
  const rawOuterMax = evalConstExpr(config.outerMaxExpr)
  const uMin = Math.min(rawOuterMin, rawOuterMax)
  const uMax = Math.max(rawOuterMin, rawOuterMax)
  if (uMax - uMin < 1e-8) {
    throw new Error("外层积分上限必须大于下限")
  }

  const varAlias = config.order === "xy" ? "x" : config.order === "yx" ? "y" : "theta"
  const innerLoField = compileScalarField1D(
    normalizeSingleVarToX(normalizeSingleVarToX(config.innerMinExpr, varAlias), "t")
  )
  const innerHiField = compileScalarField1D(
    normalizeSingleVarToX(normalizeSingleVarToX(config.innerMaxExpr, varAlias), "t")
  )

  const toCartesian = (u: number, v: number): Point2D => {
    if (config.order === "xy") return { x: u, y: v }
    if (config.order === "yx") return { x: v, y: u }
    return { x: v * Math.cos(u), y: v * Math.sin(u) }
  }

  // 1. Iterated 12x12 Gauss-Legendre quadrature (split outer into 20 sub-panels for algebraic endpoint accuracy)
  const panels = 20
  const panelSpan = (uMax - uMin) / panels
  let exactValue = 0
  let domainArea = 0

  for (let p = 0; p < panels; p += 1) {
    const pa = uMin + p * panelSpan
    const pb = pa + panelSpan
    const uMid = 0.5 * (pa + pb)
    const uHalf = 0.5 * (pb - pa)

    for (let i = 0; i < GL12_NODES.length; i += 1) {
      const u = uMid + uHalf * GL12_NODES[i]!
      const wu = uHalf * GL12_WEIGHTS[i]!
      const v1 = innerLoField.eval(u)
      const v2 = innerHiField.eval(u)
      if (!Number.isFinite(v1) || !Number.isFinite(v2)) continue
      const vLo = Math.min(v1, v2)
      const vHi = Math.max(v1, v2)
      const signInner = v2 >= v1 ? 1 : -1
      const vMid = 0.5 * (vLo + vHi)
      const vHalf = 0.5 * (vHi - vLo)
      if (vHalf < 1e-12) continue

      for (let j = 0; j < GL12_NODES.length; j += 1) {
        const v = vMid + vHalf * GL12_NODES[j]!
        const wv = vHalf * GL12_WEIGHTS[j]!
        const jacobian = config.order === "polar" ? Math.abs(v) : 1
        const pt = toCartesian(u, v)
        const fVal = usesPolarVars ? fField.eval(v, u) : fField.eval(pt.x, pt.y)
        if (Number.isFinite(fVal)) {
          exactValue += signInner * wu * wv * fVal * jacobian
        }
        domainArea += wu * wv * jacobian
      }
    }
  }

  // 2. Construct closed boundary polygon of region D
  const edgeSamples = 96
  const upperPts: Point2D[] = []
  const lowerPts: Point2D[] = []
  for (let i = 0; i <= edgeSamples; i += 1) {
    const u = uMin + (i / edgeSamples) * (uMax - uMin)
    const v1 = innerLoField.eval(u)
    const v2 = innerHiField.eval(u)
    if (Number.isFinite(v1)) lowerPts.push(toCartesian(u, v1))
    if (Number.isFinite(v2)) upperPts.push(toCartesian(u, v2))
  }
  upperPts.reverse()
  const domainPolygon = [...lowerPts, ...upperPts]

  // 3. Scan slice at scanRatio in [0, 1]
  const ratio = Math.max(0, Math.min(1, config.scanRatio ?? 0.45))
  const uScan = uMin + ratio * (uMax - uMin)
  const sv1 = innerLoField.eval(uScan)
  const sv2 = innerHiField.eval(uScan)
  const scanSlice = Number.isFinite(sv1) && Number.isFinite(sv2)
    ? {
        outerParam: uScan,
        segment: [toCartesian(uScan, sv1), toCartesian(uScan, sv2)] as [Point2D, Point2D],
        innerLimits: [sv1, sv2] as [number, number]
      }
    : null

  // 4. Riemann partition cells (m x m)
  const m = Math.max(2, Math.min(28, Math.round(config.partitions ?? 10)))
  const du = (uMax - uMin) / m
  const cells: RiemannCell2D[] = []
  let riemannSum = 0

  for (let i = 0; i < m; i += 1) {
    const ua = uMin + i * du
    const ub = ua + du
    const uc = 0.5 * (ua + ub)
    const vlo = innerLoField.eval(uc)
    const vhi = innerHiField.eval(uc)
    if (!Number.isFinite(vlo) || !Number.isFinite(vhi)) continue
    const dv = (vhi - vlo) / m
    if (Math.abs(dv) < 1e-9) continue

    for (let j = 0; j < m; j += 1) {
      const va = vlo + j * dv
      const vb = va + dv
      const vc = 0.5 * (va + vb)
      const center = toCartesian(uc, vc)
      const val = usesPolarVars ? fField.eval(vc, uc) : fField.eval(center.x, center.y)
      if (!Number.isFinite(val)) continue

      const cellArea = config.order === "polar"
        ? 0.5 * Math.abs(vb * vb - va * va) * du
        : Math.abs(dv) * du
      const sign = vhi >= vlo ? 1 : -1
      const vol = sign * val * cellArea
      riemannSum += vol

      const polygon: Point2D[] = [
        toCartesian(ua, va),
        toCartesian(ub, va),
        toCartesian(ub, vb),
        toCartesian(ua, vb)
      ]
      cells.push({ polygon, center, value: val, area: cellArea, volume: vol })
    }
  }

  // Compute tight viewport bounds with comfortable margin
  let xMin = -2, xMax = 2, yMin = -2, yMax = 2
  if (domainPolygon.length > 0) {
    xMin = Math.min(...domainPolygon.map((p) => p.x), 0)
    xMax = Math.max(...domainPolygon.map((p) => p.x), 0)
    yMin = Math.min(...domainPolygon.map((p) => p.y), 0)
    yMax = Math.max(...domainPolygon.map((p) => p.y), 0)
  }
  const span = Math.max(1, xMax - xMin, yMax - yMin)
  const cx = 0.5 * (xMin + xMax)
  const cy = 0.5 * (yMin + yMax)
  const half = span * 0.68

  return {
    order: config.order,
    outerRange: [uMin, uMax],
    exactValue,
    domainArea,
    riemannSum,
    domainPolygon,
    scanSlice,
    cells,
    suggestedBounds: {
      xMin: cx - half,
      xMax: cx + half,
      yMin: cy - half,
      yMax: cy + half
    }
  }
}

/**
 * Evaluates exact 2D divergence (`∂P/∂x + ∂Q/∂y`) and scalar curl (`∂Q/∂x - ∂P/∂y`)
 * at a probe point `(x, y)` inside vector field `F = (P, Q)`.
 */
export function evaluateDivCurlProbe(
  pField: CompiledScalarField2D,
  qField: CompiledScalarField2D,
  x: number,
  y: number
): DivCurlProbe {
  const vx = pField.eval(x, y)
  const vy = qField.eval(x, y)
  const [px, py] = pField.gradient(x, y)
  const [qx, qy] = qField.gradient(x, y)

  const divRaw = px + qy
  const curlRaw = qx - py
  const divergence = Math.abs(divRaw) < 1e-7 ? 0 : divRaw
  const curlZ = Math.abs(curlRaw) < 1e-7 ? 0 : curlRaw

  const divKind = divergence > 1e-4 ? "source" : divergence < -1e-4 ? "sink" : "incompressible"
  const curlKind = curlZ > 1e-4 ? "ccw" : curlZ < -1e-4 ? "cw" : "irrotational"

  return {
    x,
    y,
    vx,
    vy,
    speed: Math.hypot(vx, vy),
    divergence,
    curlZ,
    divKind,
    curlKind
  }
}
