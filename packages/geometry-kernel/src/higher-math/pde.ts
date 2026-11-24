import { compileScalarField2D } from "./bytecode"
import { buildContourLevels, extractContoursFromGrid, type ContourLevelCurves, type ViewportBounds2D } from "./contour"
import type { VectorFieldSample } from "./ode"

export type PdeKind = "heat2d" | "wave2d" | "poisson2d"
export type PdeBoundaryCondition = "dirichlet" | "neumann"

export interface PdeSimulationState {
  kind: PdeKind
  bounds: ViewportBounds2D
  gridSize: number
  boundary: PdeBoundaryCondition
  /** Current scalar field u(x, y) of length (gridSize + 1)^2. */
  u: Float64Array
  /** Velocity field u_t(x, y) for wave2d, length (gridSize + 1)^2. */
  v: Float64Array
  time: number
  uMin: number
  uMax: number
  energy: number
}

export interface CreatePdeOptions {
  kind: PdeKind
  initialExpr: string
  bounds: ViewportBounds2D
  gridSize?: number
  boundary?: PdeBoundaryCondition
  /** Optional boundary value expression for Poisson/Dirichlet. Defaults to 0. */
  boundaryExpr?: string
}

export interface StepPdeOptions {
  dt: number
  /** Diffusivity alpha for heat2d, or wave speed c for wave2d. */
  param: number
  /** Damping gamma for wave2d. */
  damping?: number
}

export interface PoissonSolution {
  state: PdeSimulationState
  iterations: number
  residual: number
  equipotentials: ContourLevelCurves[]
  fluxVectors: VectorFieldSample[]
  fluxP95: number
}

function computeFieldStats(u: Float64Array, dx: number, dy: number): { uMin: number; uMax: number; energy: number } {
  let minVal = Number.POSITIVE_INFINITY
  let maxVal = Number.NEGATIVE_INFINITY
  let sumSq = 0
  for (let i = 0; i < u.length; i += 1) {
    const val = u[i]!
    if (!Number.isFinite(val)) continue
    if (val < minVal) minVal = val
    if (val > maxVal) maxVal = val
    sumSq += val * val
  }
  if (!Number.isFinite(minVal)) minVal = -1
  if (!Number.isFinite(maxVal)) maxVal = 1
  if (maxVal - minVal < 1e-6) {
    minVal -= 0.5
    maxVal += 0.5
  }
  return {
    uMin: minVal,
    uMax: maxVal,
    energy: sumSq * dx * dy
  }
}

function applyBoundaryConditions(
  u: Float64Array,
  gridSize: number,
  boundary: PdeBoundaryCondition
): void {
  const cols = gridSize + 1
  if (boundary === "dirichlet") {
    for (let i = 0; i <= gridSize; i += 1) {
      u[i] = 0
      u[gridSize * cols + i] = 0
      u[i * cols] = 0
      u[i * cols + gridSize] = 0
    }
  } else {
    // Zero-flux Neumann: copy adjacent interior row/column
    for (let i = 1; i < gridSize; i += 1) {
      u[i] = u[cols + i]!
      u[gridSize * cols + i] = u[(gridSize - 1) * cols + i]!
      u[i * cols] = u[i * cols + 1]!
      u[i * cols + gridSize] = u[i * cols + (gridSize - 1)]!
    }
    u[0] = u[cols + 1]!
    u[gridSize] = u[cols + (gridSize - 1)]!
    u[gridSize * cols] = u[(gridSize - 1) * cols + 1]!
    u[gridSize * cols + gridSize] = u[(gridSize - 1) * cols + (gridSize - 1)]!
  }
}

/**
 * Initializes a 2D PDE simulation grid from a user formula `u0(x, y)`.
 */
export function createPdeState(options: CreatePdeOptions): PdeSimulationState {
  const gridSize = Math.max(20, Math.min(80, Math.round(options.gridSize ?? 48)))
  const boundary = options.boundary ?? "dirichlet"
  const initField = compileScalarField2D(options.initialExpr, "expression")
  const { bounds } = options

  const u = initField.evalGrid(bounds.xMin, bounds.xMax, bounds.yMin, bounds.yMax, gridSize, gridSize)
  for (let i = 0; i < u.length; i += 1) {
    if (!Number.isFinite(u[i]!)) u[i] = 0
  }
  if (options.kind !== "poisson2d") {
    applyBoundaryConditions(u, gridSize, boundary)
  }

  const v = new Float64Array(u.length)
  const dx = (bounds.xMax - bounds.xMin) / gridSize
  const dy = (bounds.yMax - bounds.yMin) / gridSize
  const stats = computeFieldStats(u, dx, dy)

  return {
    kind: options.kind,
    bounds,
    gridSize,
    boundary,
    u,
    v,
    time: 0,
    ...stats
  }
}

/**
 * Advances `heat2d` (`u_t = alpha * ∇²u`) or `wave2d` (`u_tt = c² * ∇²u - gamma * u_t`)
 * forward by `dt` with automatic CFL-stable explicit sub-stepping.
 */
export function stepPdeSimulation(
  state: PdeSimulationState,
  options: StepPdeOptions
): PdeSimulationState {
  const { gridSize, bounds, boundary } = state
  const cols = gridSize + 1
  const dx = (bounds.xMax - bounds.xMin) / gridSize
  const dy = (bounds.yMax - bounds.yMin) / gridSize
  const invDx2 = 1 / (dx * dx)
  const invDy2 = 1 / (dy * dy)

  const uCurr = new Float64Array(state.u)
  const uNext = new Float64Array(uCurr.length)
  const vCurr = new Float64Array(state.v)
  const totalDt = Math.max(1e-5, Math.min(0.5, options.dt))

  if (state.kind === "heat2d") {
    const alpha = Math.max(1e-4, options.param)
    const dtCrit = 0.22 / (alpha * (invDx2 + invDy2))
    const subSteps = Math.max(1, Math.min(200, Math.ceil(totalDt / dtCrit)))
    const subDt = totalDt / subSteps

    for (let s = 0; s < subSteps; s += 1) {
      for (let j = 1; j < gridSize; j += 1) {
        const row = j * cols
        for (let i = 1; i < gridSize; i += 1) {
          const idx = row + i
          const center = uCurr[idx]!
          const lap =
            (uCurr[idx - 1]! - 2 * center + uCurr[idx + 1]!) * invDx2 +
            (uCurr[idx - cols]! - 2 * center + uCurr[idx + cols]!) * invDy2
          uNext[idx] = center + subDt * alpha * lap
        }
      }
      applyBoundaryConditions(uNext, gridSize, boundary)
      uCurr.set(uNext)
    }
  } else if (state.kind === "wave2d") {
    const c = Math.max(0.05, options.param)
    const gamma = Math.max(0, options.damping ?? 0.04)
    const cSq = c * c
    const dtCrit = 0.58 / (c * Math.hypot(1 / dx, 1 / dy))
    const subSteps = Math.max(1, Math.min(200, Math.ceil(totalDt / dtCrit)))
    const subDt = totalDt / subSteps

    for (let s = 0; s < subSteps; s += 1) {
      for (let j = 1; j < gridSize; j += 1) {
        const row = j * cols
        for (let i = 1; i < gridSize; i += 1) {
          const idx = row + i
          const center = uCurr[idx]!
          const lap =
            (uCurr[idx - 1]! - 2 * center + uCurr[idx + 1]!) * invDx2 +
            (uCurr[idx - cols]! - 2 * center + uCurr[idx + cols]!) * invDy2
          const acc = cSq * lap - gamma * vCurr[idx]!
          const vNew = vCurr[idx]! + subDt * acc
          vCurr[idx] = vNew
          uNext[idx] = center + subDt * vNew
        }
      }
      applyBoundaryConditions(uNext, gridSize, boundary)
      if (boundary === "dirichlet") {
        applyBoundaryConditions(vCurr, gridSize, "dirichlet")
      }
      uCurr.set(uNext)
    }
  }

  const stats = computeFieldStats(uCurr, dx, dy)
  return {
    ...state,
    u: uCurr,
    v: vCurr,
    time: state.time + totalDt,
    ...stats
  }
}

/**
 * Injects a localized Gaussian pulse at `(wx, wy)` (e.g. when clicking/painting on the PDE canvas).
 */
export function injectPdeGaussianPulse(
  state: PdeSimulationState,
  wx: number,
  wy: number,
  amplitude = 1.5,
  radiusRatio = 0.08
): PdeSimulationState {
  const { bounds, gridSize } = state
  const cols = gridSize + 1
  const dx = (bounds.xMax - bounds.xMin) / gridSize
  const dy = (bounds.yMax - bounds.yMin) / gridSize
  const sigma = Math.max(dx * 1.5, Math.hypot(bounds.xMax - bounds.xMin, bounds.yMax - bounds.yMin) * radiusRatio)
  const twoSigmaSq = 2 * sigma * sigma

  const uNext = new Float64Array(state.u)
  for (let j = 1; j < gridSize; j += 1) {
    const y = bounds.yMin + j * dy
    for (let i = 1; i < gridSize; i += 1) {
      const x = bounds.xMin + i * dx
      const rSq = (x - wx) * (x - wx) + (y - wy) * (y - wy)
      uNext[j * cols + i] = uNext[j * cols + i]! + amplitude * Math.exp(-rSq / twoSigmaSq)
    }
  }
  applyBoundaryConditions(uNext, gridSize, state.boundary)
  const stats = computeFieldStats(uNext, dx, dy)
  return {
    ...state,
    u: uNext,
    ...stats
  }
}

/**
 * Solves steady-state 2D Poisson / Laplace equation `-∇²u = source(x, y)` on `bounds`
 * with Dirichlet boundary `u = boundaryExpr(x, y)` via Successive Over-Relaxation (SOR).
 */
export function solvePoissonSteady2D(
  sourceExpr: string,
  boundaryExpr: string,
  bounds: ViewportBounds2D,
  gridSize = 48,
  maxIter = 280
): PoissonSolution {
  const n = Math.max(20, Math.min(80, Math.round(gridSize)))
  const cols = n + 1
  const srcField = compileScalarField2D(sourceExpr, "expression")
  const bndField = compileScalarField2D(boundaryExpr || "0", "expression")

  const fGrid = srcField.evalGrid(bounds.xMin, bounds.xMax, bounds.yMin, bounds.yMax, n, n)
  const u = new Float64Array(cols * cols)

  const dx = (bounds.xMax - bounds.xMin) / n
  const dy = (bounds.yMax - bounds.yMin) / n

  // Set Dirichlet boundary values
  for (let i = 0; i <= n; i += 1) {
    const x = bounds.xMin + i * dx
    const y = bounds.yMin + i * dy
    const bBottom = bndField.eval(x, bounds.yMin)
    const bTop = bndField.eval(x, bounds.yMax)
    const bLeft = bndField.eval(bounds.xMin, y)
    const bRight = bndField.eval(bounds.xMax, y)
    u[i] = Number.isFinite(bBottom) ? bBottom : 0
    u[n * cols + i] = Number.isFinite(bTop) ? bTop : 0
    u[i * cols] = Number.isFinite(bLeft) ? bLeft : 0
    u[i * cols + n] = Number.isFinite(bRight) ? bRight : 0
  }

  const invDx2 = 1 / (dx * dx)
  const invDy2 = 1 / (dy * dy)
  const denom = 2 * (invDx2 + invDy2)
  const omega = 2 / (1 + Math.sin(Math.PI / n))

  let iterations = 0
  let residual = 0
  for (let iter = 0; iter < maxIter; iter += 1) {
    iterations = iter + 1
    let maxDiff = 0
    for (let j = 1; j < n; j += 1) {
      const row = j * cols
      for (let i = 1; i < n; i += 1) {
        const idx = row + i
        const rhs = Number.isFinite(fGrid[idx]!) ? fGrid[idx]! : 0
        const gs =
          ((u[idx - 1]! + u[idx + 1]!) * invDx2 +
            (u[idx - cols]! + u[idx + cols]!) * invDy2 +
            rhs) / denom
        const prev = u[idx]!
        const next = prev + omega * (gs - prev)
        u[idx] = next
        const diff = Math.abs(next - prev)
        if (diff > maxDiff) maxDiff = diff
      }
    }
    residual = maxDiff
    if (maxDiff < 1e-6) break
  }

  const stats = computeFieldStats(u, dx, dy)
  const levels = buildContourLevels(stats.uMin, stats.uMax, 11)
  const equipotentials: ContourLevelCurves[] = levels.map((level) => ({
    level,
    polylines: extractContoursFromGrid(u, bounds, n, n, level)
  }))

  // Sample flux field F = -∇u on a coarse grid
  const stride = Math.max(2, Math.floor(n / 16))
  const fluxVectors: VectorFieldSample[] = []
  const speeds: number[] = []
  for (let j = stride; j <= n - stride; j += stride) {
    const y = bounds.yMin + j * dy
    for (let i = stride; i <= n - stride; i += stride) {
      const x = bounds.xMin + i * dx
      const idx = j * cols + i
      const ux = (u[idx + 1]! - u[idx - 1]!) / (2 * dx)
      const uy = (u[idx + cols]! - u[idx - cols]!) / (2 * dy)
      const vx = -ux
      const vy = -uy
      const speed = Math.hypot(vx, vy)
      fluxVectors.push({ x, y, vx, vy, speed })
      speeds.push(speed)
    }
  }
  speeds.sort((a, b) => a - b)
  const fluxP95 = speeds.length > 0 ? Math.max(1e-4, speeds[Math.floor(speeds.length * 0.92)]!) : 1

  return {
    state: {
      kind: "poisson2d",
      bounds,
      gridSize: n,
      boundary: "dirichlet",
      u,
      v: new Float64Array(u.length),
      time: 0,
      ...stats
    },
    iterations,
    residual,
    equipotentials,
    fluxVectors,
    fluxP95
  }
}
