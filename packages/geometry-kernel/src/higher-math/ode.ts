import { compileScalarField2D, type CompiledScalarField2D } from "./bytecode"
import { extractContoursFromGrid, type Point2D, type ViewportBounds2D } from "./contour"

export interface SlopeSample {
  x: number
  y: number
  slope: number
  angle: number
}

export interface OdeSlopeFieldAnalysis {
  rhsSource: string
  bounds: ViewportBounds2D
  samples: SlopeSample[]
}

export interface Ode1DTrajectory {
  initial: Point2D
  points: Point2D[]
}

export interface VectorFieldSample {
  x: number
  y: number
  vx: number
  vy: number
  speed: number
}

export type EquilibriumKind =
  | "saddle"
  | "stable_node"
  | "unstable_node"
  | "stable_focus"
  | "unstable_focus"
  | "center"
  | "degenerate"

export interface ComplexNumber {
  re: number
  im: number
}

export interface EquilibriumPoint {
  x: number
  y: number
  jacobian: [[number, number], [number, number]]
  trace: number
  determinant: number
  eigenvalues: [ComplexNumber, ComplexNumber]
  kind: EquilibriumKind
  label: string
  stability: "stable" | "unstable" | "neutral" | "saddle" | "degenerate"
}

export interface PhasePlaneAnalysis {
  pSource: string
  qSource: string
  bounds: ViewportBounds2D
  vectors: VectorFieldSample[]
  speedP95: number
  pNullclines: Point2D[][]
  qNullclines: Point2D[][]
  equilibria: EquilibriumPoint[]
}

export interface PhaseTrajectory {
  initial: Point2D
  /** Points ordered from backward end -> initial -> forward end, following flow direction. */
  points: Point2D[]
  forwardCount: number
  backwardCount: number
}

// Dormand-Prince RK45 Butcher tableau coefficients
const DP_A21 = 1 / 5
const DP_A31 = 3 / 40
const DP_A32 = 9 / 40
const DP_A41 = 44 / 45
const DP_A42 = -56 / 15
const DP_A43 = 32 / 9
const DP_A51 = 19372 / 6561
const DP_A52 = -25360 / 2187
const DP_A53 = 64448 / 6561
const DP_A54 = -212 / 729
const DP_A61 = 9017 / 3168
const DP_A62 = -355 / 33
const DP_A63 = 46732 / 5247
const DP_A64 = 49 / 176
const DP_A65 = -5103 / 18656

// 5th-order solution weights
const DP_B1 = 35 / 384
const DP_B3 = 500 / 1113
const DP_B4 = 125 / 192
const DP_B5 = -2187 / 6784
const DP_B6 = 11 / 84

// Error estimate weights (5th - 4th order)
const DP_E1 = 71 / 57600
const DP_E3 = -71 / 16695
const DP_E4 = 71 / 1920
const DP_E5 = -17253 / 339200
const DP_E6 = 22 / 525
const DP_E7 = -1 / 40

function snapZero(v: number, eps = 1e-7): number {
  return Math.abs(v) < eps ? 0 : v
}

export interface OdeSlopeOptions {
  cols?: number
  rows?: number
}

/**
 * Samples the 1st-order ODE slope field `y' = f(x, y)` on a uniform viewport grid.
 */
export function analyzeOdeSlopeField(
  rhsSource: string,
  bounds: ViewportBounds2D,
  options: OdeSlopeOptions = {}
): OdeSlopeFieldAnalysis {
  const field = compileScalarField2D(rhsSource, "expression")
  const cols = Math.max(8, Math.min(36, Math.round(options.cols ?? 22)))
  const rows = Math.max(8, Math.min(30, Math.round(options.rows ?? 16)))

  const dx = (bounds.xMax - bounds.xMin) / cols
  const dy = (bounds.yMax - bounds.yMin) / rows
  const samples: SlopeSample[] = []

  for (let j = 0; j < rows; j += 1) {
    const y = bounds.yMin + (j + 0.5) * dy
    for (let i = 0; i < cols; i += 1) {
      const x = bounds.xMin + (i + 0.5) * dx
      const slope = field.eval(x, y)
      if (!Number.isFinite(slope)) continue
      samples.push({ x, y, slope, angle: Math.atan(slope) })
    }
  }

  return { rhsSource, bounds, samples }
}

export interface IntegrateOde1DOptions {
  maxSteps?: number
  tolerance?: number
  maxStepSize?: number
}

function integrateOde1DOneWay(
  fField: CompiledScalarField2D,
  x0: number,
  y0: number,
  direction: 1 | -1,
  bounds: ViewportBounds2D,
  maxSteps: number,
  tol: number,
  hMax: number
): Point2D[] {
  const spanX = bounds.xMax - bounds.xMin
  const spanY = bounds.yMax - bounds.yMin
  const padX = spanX * 0.08
  const padY = spanY * 0.35
  const minX = bounds.xMin - padX
  const maxX = bounds.xMax + padX
  const minY = bounds.yMin - padY
  const maxY = bounds.yMax + padY

  const pts: Point2D[] = []
  let x = x0
  let y = y0
  let h = direction * Math.min(hMax, spanX / 60)
  const hMin = Math.max(1e-6, spanX * 1e-5)

  for (let step = 0; step < maxSteps; step += 1) {
    const k1 = fField.eval(x, y)
    if (!Number.isFinite(k1)) break

    let accepted = false
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const k2 = fField.eval(x + h * (1 / 5), y + h * DP_A21 * k1)
      const k3 = fField.eval(x + h * (3 / 10), y + h * (DP_A31 * k1 + DP_A32 * k2))
      const k4 = fField.eval(x + h * (4 / 5), y + h * (DP_A41 * k1 + DP_A42 * k2 + DP_A43 * k3))
      const k5 = fField.eval(x + h * (8 / 9), y + h * (DP_A51 * k1 + DP_A52 * k2 + DP_A53 * k3 + DP_A54 * k4))
      const k6 = fField.eval(x + h, y + h * (DP_A61 * k1 + DP_A62 * k2 + DP_A63 * k3 + DP_A64 * k4 + DP_A65 * k5))
      const yNext = y + h * (DP_B1 * k1 + DP_B3 * k3 + DP_B4 * k4 + DP_B5 * k5 + DP_B6 * k6)
      const xNext = x + h
      const k7 = fField.eval(xNext, yNext)

      if (!Number.isFinite(yNext) || !Number.isFinite(k7)) {
        h *= 0.4
        if (Math.abs(h) < hMin) break
        continue
      }

      const err = Math.abs(h * (DP_E1 * k1 + DP_E3 * k3 + DP_E4 * k4 + DP_E5 * k5 + DP_E6 * k6 + DP_E7 * k7))
      const scale = tol * (1 + Math.abs(y) + Math.abs(yNext))

      if (err <= scale || Math.abs(h) <= hMin) {
        x = xNext
        y = yNext
        pts.push({ x, y })
        accepted = true

        const factor = err < 1e-14 ? 2 : Math.min(2.2, Math.max(0.4, 0.9 * (scale / err) ** 0.2))
        const nextMag = Math.min(hMax, Math.max(hMin, Math.abs(h) * factor))
        h = direction * nextMag
        break
      }

      const shrink = Math.max(0.25, Math.min(0.8, 0.9 * (scale / err) ** 0.25))
      h = direction * Math.max(hMin, Math.abs(h) * shrink)
    }

    if (!accepted) break
    if (x < minX || x > maxX || y < minY || y > maxY) break
  }

  return pts
}

/**
 * Integrates `y' = f(x, y)` forward and backward from `(x0, y0)` via Dormand-Prince RK45.
 */
export function integrateOde1DBidirectional(
  fField: CompiledScalarField2D,
  x0: number,
  y0: number,
  bounds: ViewportBounds2D,
  options: IntegrateOde1DOptions = {}
): Ode1DTrajectory {
  const maxSteps = options.maxSteps ?? 260
  const tol = options.tolerance ?? 1e-5
  const hMax = options.maxStepSize ?? (bounds.xMax - bounds.xMin) / 28

  const backward = integrateOde1DOneWay(fField, x0, y0, -1, bounds, maxSteps, tol, hMax)
  const forward = integrateOde1DOneWay(fField, x0, y0, 1, bounds, maxSteps, tol, hMax)

  backward.reverse()
  const points: Point2D[] = [...backward, { x: x0, y: y0 }, ...forward]
  return { initial: { x: x0, y: y0 }, points }
}

/**
 * Integrates initial-value problem `y' = f(x, y), y(x0) = y0` directly to `xTarget`
 * via adaptive Dormand-Prince RK45, clamping the final step to hit `xTarget` exactly.
 */
export function solveOde1DIvp(
  fField: CompiledScalarField2D,
  x0: number,
  y0: number,
  xTarget: number,
  tol = 1e-9,
  maxSteps = 2000
): number {
  if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(xTarget)) return Number.NaN
  const span = Math.abs(xTarget - x0)
  if (span < 1e-14) return y0
  const dir: 1 | -1 = xTarget > x0 ? 1 : -1
  let x = x0
  let y = y0
  const hMax = Math.max(1e-4, span / 20)
  const hMin = Math.max(1e-12, span * 1e-9)
  let h = dir * Math.min(hMax, span / 40)

  for (let step = 0; step < maxSteps; step += 1) {
    const rem = xTarget - x
    if (Math.abs(rem) <= 1e-13) return y
    if ((dir > 0 && x + h > xTarget) || (dir < 0 && x + h < xTarget)) {
      h = rem
    }
    const k1 = fField.eval(x, y)
    if (!Number.isFinite(k1)) return Number.NaN

    let accepted = false
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const k2 = fField.eval(x + h * (1 / 5), y + h * DP_A21 * k1)
      const k3 = fField.eval(x + h * (3 / 10), y + h * (DP_A31 * k1 + DP_A32 * k2))
      const k4 = fField.eval(x + h * (4 / 5), y + h * (DP_A41 * k1 + DP_A42 * k2 + DP_A43 * k3))
      const k5 = fField.eval(x + h * (8 / 9), y + h * (DP_A51 * k1 + DP_A52 * k2 + DP_A53 * k3 + DP_A54 * k4))
      const k6 = fField.eval(x + h, y + h * (DP_A61 * k1 + DP_A62 * k2 + DP_A63 * k3 + DP_A64 * k4 + DP_A65 * k5))
      const yNext = y + h * (DP_B1 * k1 + DP_B3 * k3 + DP_B4 * k4 + DP_B5 * k5 + DP_B6 * k6)
      const xNext = x + h
      const k7 = fField.eval(xNext, yNext)

      if (!Number.isFinite(yNext) || !Number.isFinite(k7)) {
        h *= 0.4
        if (Math.abs(h) < hMin) break
        continue
      }

      const err = Math.abs(h * (DP_E1 * k1 + DP_E3 * k3 + DP_E4 * k4 + DP_E5 * k5 + DP_E6 * k6 + DP_E7 * k7))
      const scale = tol * (1 + Math.abs(y) + Math.abs(yNext))

      if (err <= scale || Math.abs(h) <= hMin) {
        x = xNext
        y = yNext
        accepted = true
        if (Math.abs(xTarget - x) <= 1e-13) return y
        const factor = err < 1e-16 ? 2 : Math.min(2.2, Math.max(0.4, 0.9 * (scale / err) ** 0.2))
        const nextMag = Math.min(hMax, Math.max(hMin, Math.abs(h) * factor))
        h = dir * nextMag
        break
      }
      const factor = Math.max(0.15, 0.85 * (scale / err) ** 0.2)
      h = dir * Math.max(hMin, Math.abs(h) * factor)
    }
    if (!accepted || Math.abs(y) > 1e12) return Number.NaN
  }
  return Math.abs(xTarget - x) < 1e-6 ? y : Number.NaN
}

function solveNewton2DZero(
  pField: CompiledScalarField2D,
  qField: CompiledScalarField2D,
  x0: number,
  y0: number,
  bounds: ViewportBounds2D
): Point2D | null {
  let x = x0
  let y = y0
  const padX = (bounds.xMax - bounds.xMin) * 0.15
  const padY = (bounds.yMax - bounds.yMin) * 0.15

  for (let iter = 0; iter < 28; iter += 1) {
    const pv = pField.eval(x, y)
    const qv = qField.eval(x, y)
    if (!Number.isFinite(pv) || !Number.isFinite(qv)) return null
    const errSq = pv * pv + qv * qv
    if (errSq < 1e-18) return { x, y }

    const [px, py] = pField.gradient(x, y)
    const [qx, qy] = qField.gradient(x, y)
    const det = px * qy - py * qx
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null

    const dx = (-pv * qy + py * qv) / det
    const dy = (-px * qv + pv * qx) / det
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null

    let alpha = 1
    let improved = false
    for (let ls = 0; ls < 8; ls += 1) {
      const nx = x + alpha * dx
      const ny = y + alpha * dy
      const np = pField.eval(nx, ny)
      const nq = qField.eval(nx, ny)
      if (Number.isFinite(np) && Number.isFinite(nq)) {
        const nErrSq = np * np + nq * nq
        if (nErrSq < errSq * (1 - 1e-4 * alpha) || nErrSq < 1e-18) {
          x = nx
          y = ny
          improved = true
          break
        }
      }
      alpha *= 0.5
    }

    if (
      !improved ||
      x < bounds.xMin - padX || x > bounds.xMax + padX ||
      y < bounds.yMin - padY || y > bounds.yMax + padY
    ) {
      break
    }
  }

  const fp = pField.eval(x, y)
  const fq = qField.eval(x, y)
  return Number.isFinite(fp) && Number.isFinite(fq) && Math.hypot(fp, fq) < 1e-6 ? { x, y } : null
}

function classifyEquilibrium(
  pField: CompiledScalarField2D,
  qField: CompiledScalarField2D,
  x: number,
  y: number
): EquilibriumPoint {
  const [px, py] = pField.gradient(x, y)
  const [qx, qy] = qField.gradient(x, y)
  const trace = snapZero(px + qy, 1e-6)
  const det = snapZero(px * qy - py * qx, 1e-7)
  const disc = trace * trace - 4 * det

  let eigenvalues: [ComplexNumber, ComplexNumber]
  if (disc >= 0) {
    const root = Math.sqrt(disc)
    eigenvalues = [
      { re: snapZero(0.5 * (trace + root), 1e-7), im: 0 },
      { re: snapZero(0.5 * (trace - root), 1e-7), im: 0 }
    ]
  } else {
    const im = Math.sqrt(-disc) * 0.5
    const re = snapZero(0.5 * trace, 1e-7)
    eigenvalues = [
      { re, im },
      { re, im: -im }
    ]
  }

  let kind: EquilibriumKind
  let label: string
  let stability: EquilibriumPoint["stability"]

  if (Math.abs(det) < 1e-6) {
    kind = "degenerate"
    label = "退化奇点"
    stability = "degenerate"
  } else if (det < 0) {
    kind = "saddle"
    label = "鞍点（不稳定）"
    stability = "saddle"
  } else if (Math.abs(trace) < 1e-5) {
    kind = "center"
    label = "中心点（临界稳定）"
    stability = "neutral"
  } else if (disc < 0) {
    if (trace < 0) {
      kind = "stable_focus"
      label = "稳定焦点"
      stability = "stable"
    } else {
      kind = "unstable_focus"
      label = "不稳定焦点"
      stability = "unstable"
    }
  } else if (trace < 0) {
    kind = "stable_node"
    label = "稳定节点"
    stability = "stable"
  } else {
    kind = "unstable_node"
    label = "不稳定节点"
    stability = "unstable"
  }

  return {
    x: snapZero(x),
    y: snapZero(y),
    jacobian: [[snapZero(px), snapZero(py)], [snapZero(qx), snapZero(qy)]],
    trace,
    determinant: det,
    eigenvalues,
    kind,
    label,
    stability
  }
}

export interface PhasePlaneOptions {
  vectorCols?: number
  vectorRows?: number
  nullclineGrid?: number
}

/**
 * Computes 2D autonomous system phase plane analysis:
 * - Vector field samples with robust speed scaling
 * - P-nullclines (`P = 0`) and Q-nullclines (`Q = 0`) via Marching Squares
 * - Multi-seed 2D Newton equilibrium solver with Jacobian eigenvalue stability classification
 */
export function analyzePhasePlane2D(
  pSource: string,
  qSource: string,
  bounds: ViewportBounds2D,
  options: PhasePlaneOptions = {}
): PhasePlaneAnalysis {
  const pField = compileScalarField2D(pSource, "expression")
  const qField = compileScalarField2D(qSource, "expression")

  const cols = Math.max(8, Math.min(30, Math.round(options.vectorCols ?? 19)))
  const rows = Math.max(8, Math.min(26, Math.round(options.vectorRows ?? 15)))
  const dx = (bounds.xMax - bounds.xMin) / cols
  const dy = (bounds.yMax - bounds.yMin) / rows

  const vectors: VectorFieldSample[] = []
  const speeds: number[] = []
  for (let j = 0; j < rows; j += 1) {
    const y = bounds.yMin + (j + 0.5) * dy
    for (let i = 0; i < cols; i += 1) {
      const x = bounds.xMin + (i + 0.5) * dx
      const vx = pField.eval(x, y)
      const vy = qField.eval(x, y)
      if (!Number.isFinite(vx) || !Number.isFinite(vy)) continue
      const speed = Math.hypot(vx, vy)
      vectors.push({ x, y, vx, vy, speed })
      if (speed < 1e5) speeds.push(speed)
    }
  }
  speeds.sort((a, b) => a - b)
  const speedP95 = speeds.length > 0 ? Math.max(1e-4, speeds[Math.floor(speeds.length * 0.92)]!) : 1

  const gridN = Math.max(40, Math.min(120, Math.round(options.nullclineGrid ?? 72)))
  const pGrid = pField.evalGrid(bounds.xMin, bounds.xMax, bounds.yMin, bounds.yMax, gridN, gridN)
  const qGrid = qField.evalGrid(bounds.xMin, bounds.xMax, bounds.yMin, bounds.yMax, gridN, gridN)
  const pNullclines = extractContoursFromGrid(pGrid, bounds, gridN, gridN, 0)
  const qNullclines = extractContoursFromGrid(qGrid, bounds, gridN, gridN, 0)

  // Seed equilibrium Newton solver from grid local minima of P^2 + Q^2 + coarse grid
  const seeds: Point2D[] = []
  const gCols = gridN + 1
  const gdx = (bounds.xMax - bounds.xMin) / gridN
  const gdy = (bounds.yMax - bounds.yMin) / gridN

  const normSq = (i: number, j: number): number => {
    const idx = j * gCols + i
    const pv = pGrid[idx]!
    const qv = qGrid[idx]!
    if (!Number.isFinite(pv) || !Number.isFinite(qv)) return Number.POSITIVE_INFINITY
    return pv * pv + qv * qv
  }

  for (let j = 1; j < gridN; j += 1) {
    for (let i = 1; i < gridN; i += 1) {
      const v = normSq(i, j)
      if (!Number.isFinite(v)) continue
      if (
        v <= normSq(i - 1, j) &&
        v <= normSq(i + 1, j) &&
        v <= normSq(i, j - 1) &&
        v <= normSq(i, j + 1) &&
        v <= normSq(i - 1, j - 1) &&
        v <= normSq(i + 1, j + 1) &&
        v <= normSq(i - 1, j + 1) &&
        v <= normSq(i + 1, j - 1)
      ) {
        seeds.push({ x: bounds.xMin + i * gdx, y: bounds.yMin + j * gdy })
      }
    }
  }
  // Always include origin and a coarse 6x6 sweep so boundary/axis equilibria are never missed
  seeds.push({ x: 0, y: 0 })
  for (let j = 0; j <= 5; j += 1) {
    for (let i = 0; i <= 5; i += 1) {
      seeds.push({
        x: bounds.xMin + (i / 5) * (bounds.xMax - bounds.xMin),
        y: bounds.yMin + (j / 5) * (bounds.yMax - bounds.yMin)
      })
    }
  }

  const equilibria: EquilibriumPoint[] = []
  const dedupTol = Math.max(1e-3, Math.hypot(bounds.xMax - bounds.xMin, bounds.yMax - bounds.yMin) * 2e-3)

  for (const seed of seeds) {
    const sol = solveNewton2DZero(pField, qField, seed.x, seed.y, bounds)
    if (!sol) continue
    if (
      sol.x < bounds.xMin - 1e-3 || sol.x > bounds.xMax + 1e-3 ||
      sol.y < bounds.yMin - 1e-3 || sol.y > bounds.yMax + 1e-3
    ) {
      continue
    }
    if (equilibria.some((eq) => Math.hypot(eq.x - sol.x, eq.y - sol.y) < dedupTol)) continue
    equilibria.push(classifyEquilibrium(pField, qField, sol.x, sol.y))
  }

  equilibria.sort((a, b) => a.x - b.x || a.y - b.y)

  return {
    pSource,
    qSource,
    bounds,
    vectors,
    speedP95,
    pNullclines,
    qNullclines,
    equilibria
  }
}

export interface IntegratePhaseOptions {
  maxSteps?: number
  maxTime?: number
  tolerance?: number
}

function integratePhaseOneWay(
  pField: CompiledScalarField2D,
  qField: CompiledScalarField2D,
  x0: number,
  y0: number,
  direction: 1 | -1,
  bounds: ViewportBounds2D,
  maxSteps: number,
  maxTime: number,
  tol: number
): Point2D[] {
  const span = Math.hypot(bounds.xMax - bounds.xMin, bounds.yMax - bounds.yMin)
  const padX = (bounds.xMax - bounds.xMin) * 0.25
  const padY = (bounds.yMax - bounds.yMin) * 0.25
  const minX = bounds.xMin - padX
  const maxX = bounds.xMax + padX
  const minY = bounds.yMin - padY
  const maxY = bounds.yMax + padY

  const pts: Point2D[] = []
  let x = x0
  let y = y0
  let t = 0
  let h = direction * 0.04
  const hMin = 1e-5
  const hMax = 0.25
  const maxArcStep = span * 0.045
  let arcLength = 0

  for (let step = 0; step < maxSteps && Math.abs(t) < maxTime; step += 1) {
    const k1x = pField.eval(x, y)
    const k1y = qField.eval(x, y)
    if (!Number.isFinite(k1x) || !Number.isFinite(k1y)) break
    const speed = Math.hypot(k1x, k1y)
    if (speed < 1e-4) break

    let accepted = false
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const k2x = pField.eval(x + h * DP_A21 * k1x, y + h * DP_A21 * k1y)
      const k2y = qField.eval(x + h * DP_A21 * k1x, y + h * DP_A21 * k1y)

      const x3 = x + h * (DP_A31 * k1x + DP_A32 * k2x)
      const y3 = y + h * (DP_A31 * k1y + DP_A32 * k2y)
      const k3x = pField.eval(x3, y3)
      const k3y = qField.eval(x3, y3)

      const x4 = x + h * (DP_A41 * k1x + DP_A42 * k2x + DP_A43 * k3x)
      const y4 = y + h * (DP_A41 * k1y + DP_A42 * k2y + DP_A43 * k3y)
      const k4x = pField.eval(x4, y4)
      const k4y = qField.eval(x4, y4)

      const x5 = x + h * (DP_A51 * k1x + DP_A52 * k2x + DP_A53 * k3x + DP_A54 * k4x)
      const y5 = y + h * (DP_A51 * k1y + DP_A52 * k2y + DP_A53 * k3y + DP_A54 * k4y)
      const k5x = pField.eval(x5, y5)
      const k5y = qField.eval(x5, y5)

      const x6 = x + h * (DP_A61 * k1x + DP_A62 * k2x + DP_A63 * k3x + DP_A64 * k4x + DP_A65 * k5x)
      const y6 = y + h * (DP_A61 * k1y + DP_A62 * k2y + DP_A63 * k3y + DP_A64 * k4y + DP_A65 * k5y)
      const k6x = pField.eval(x6, y6)
      const k6y = qField.eval(x6, y6)

      const xNext = x + h * (DP_B1 * k1x + DP_B3 * k3x + DP_B4 * k4x + DP_B5 * k5x + DP_B6 * k6x)
      const yNext = y + h * (DP_B1 * k1y + DP_B3 * k3y + DP_B4 * k4y + DP_B5 * k5y + DP_B6 * k6y)
      const k7x = pField.eval(xNext, yNext)
      const k7y = qField.eval(xNext, yNext)

      if (!Number.isFinite(xNext) || !Number.isFinite(yNext) || !Number.isFinite(k7x) || !Number.isFinite(k7y)) {
        h *= 0.4
        if (Math.abs(h) < hMin) break
        continue
      }

      const stepDist = Math.hypot(xNext - x, yNext - y)
      if (stepDist > maxArcStep && Math.abs(h) > hMin) {
        h *= 0.5
        continue
      }

      const errX = Math.abs(h * (DP_E1 * k1x + DP_E3 * k3x + DP_E4 * k4x + DP_E5 * k5x + DP_E6 * k6x + DP_E7 * k7x))
      const errY = Math.abs(h * (DP_E1 * k1y + DP_E3 * k3y + DP_E4 * k4y + DP_E5 * k5y + DP_E6 * k6y + DP_E7 * k7y))
      const err = Math.hypot(errX, errY)
      const scale = tol * (1 + Math.hypot(x, y))

      if (err <= scale || Math.abs(h) <= hMin) {
        arcLength += stepDist
        x = xNext
        y = yNext
        t += h
        pts.push({ x, y })
        accepted = true

        const factor = err < 1e-14 ? 2 : Math.min(2, Math.max(0.4, 0.9 * (scale / err) ** 0.2))
        const nextMag = Math.min(hMax, Math.max(hMin, Math.abs(h) * factor))
        h = direction * nextMag
        break
      }

      const shrink = Math.max(0.25, Math.min(0.8, 0.9 * (scale / err) ** 0.25))
      h = direction * Math.max(hMin, Math.abs(h) * shrink)
    }

    if (!accepted) break
    if (x < minX || x > maxX || y < minY || y > maxY) break
    // Detect closed periodic orbit after meaningful travel
    if (pts.length > 24 && arcLength > span * 0.15 && Math.hypot(x - x0, y - y0) < span * 0.012) {
      pts.push({ x: x0, y: y0 })
      break
    }
  }

  return pts
}

/**
 * Integrates a 2D autonomous system `(x', y') = (P(x, y), Q(x, y))` both forward and backward
 * from `(x0, y0)` via adaptive Dormand-Prince RK45.
 */
export function integratePhaseTrajectoryBidirectional(
  pField: CompiledScalarField2D,
  qField: CompiledScalarField2D,
  x0: number,
  y0: number,
  bounds: ViewportBounds2D,
  options: IntegratePhaseOptions = {}
): PhaseTrajectory {
  const maxSteps = options.maxSteps ?? 340
  const maxTime = options.maxTime ?? 18
  const tol = options.tolerance ?? 1e-5

  const backward = integratePhaseOneWay(pField, qField, x0, y0, -1, bounds, maxSteps, maxTime, tol)
  const forward = integratePhaseOneWay(pField, qField, x0, y0, 1, bounds, maxSteps, maxTime, tol)

  backward.reverse()
  const points: Point2D[] = [...backward, { x: x0, y: y0 }, ...forward]
  return {
    initial: { x: x0, y: y0 },
    points,
    forwardCount: forward.length,
    backwardCount: backward.length
  }
}
