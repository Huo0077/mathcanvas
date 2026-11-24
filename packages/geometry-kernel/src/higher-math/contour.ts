import { compileScalarField2D, type CompiledScalarField2D } from "./bytecode"

export interface Point2D {
  x: number
  y: number
}

export interface ViewportBounds2D {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

export interface ContourLevelCurves {
  level: number
  polylines: Point2D[][]
  isHighlighted?: boolean
}

export type LagrangeStationaryKind =
  | "constrained_max"
  | "constrained_min"
  | "constrained_stationary"

export interface LagrangeStationaryPoint {
  x: number
  y: number
  value: number
  lambda: number
  gradF: [number, number]
  gradG: [number, number]
  kind: LagrangeStationaryKind
  isGlobalMax: boolean
  isGlobalMin: boolean
  label: string
}

export interface LagrangePointProbe {
  x: number
  y: number
  fValue: number
  gValue: number
  gradF: [number, number]
  gradG: [number, number]
  /** Angle in degrees between gradF and gradG, in [0, 180]. */
  angleDeg: number
  /** |sin(theta)| in [0, 1]; 0 means perfectly collinear (tangent). */
  collinearitySin: number
  /** Best least-squares multiplier lambda = (gradF · gradG) / ||gradG||^2. */
  estimatedLambda: number
  isTangent: boolean
}

export interface LagrangeAnalysis {
  objectiveSource: string
  constraintSource: string
  bounds: ViewportBounds2D
  gridSize: number
  fGrid: Float64Array
  fMin: number
  fMax: number
  contourLevels: number[]
  contours: ContourLevelCurves[]
  constraintCurves: Point2D[][]
  stationaryPoints: LagrangeStationaryPoint[]
  suggestedLevelRange: [number, number]
}

interface RawSegment {
  k1: string
  k2: string
  p1: Point2D
  p2: Point2D
}

function interpEdge(
  xA: number,
  yA: number,
  vA: number,
  xB: number,
  yB: number,
  vB: number,
  level: number
): Point2D {
  const denom = vB - vA
  const t = Math.abs(denom) < 1e-12 ? 0.5 : Math.max(0, Math.min(1, (level - vA) / denom))
  return {
    x: xA + t * (xB - xA),
    y: yA + t * (yB - yA)
  }
}

/**
 * Extracts iso-contour polylines for `F(x, y) = level` from a precomputed
 * `(nx + 1) x (ny + 1)` grid using Marching Squares with asymptotic-decider saddle disambiguation
 * and exact topological grid-edge chaining.
 */
export function extractContoursFromGrid(
  grid: Float64Array,
  bounds: ViewportBounds2D,
  nx: number,
  ny: number,
  level: number
): Point2D[][] {
  const cols = nx + 1
  const dx = (bounds.xMax - bounds.xMin) / nx
  const dy = (bounds.yMax - bounds.yMin) / ny

  const segments: RawSegment[] = []

  for (let j = 0; j < ny; j += 1) {
    const y0 = bounds.yMin + j * dy
    const y1 = y0 + dy
    const row0 = j * cols
    const row1 = (j + 1) * cols

    for (let i = 0; i < nx; i += 1) {
      const v0 = grid[row0 + i]!     // bottom-left
      const v1 = grid[row0 + i + 1]! // bottom-right
      const v2 = grid[row1 + i + 1]! // top-right
      const v3 = grid[row1 + i]!     // top-left

      if (!Number.isFinite(v0) || !Number.isFinite(v1) || !Number.isFinite(v2) || !Number.isFinite(v3)) {
        continue
      }

      const mask =
        (v0 >= level ? 1 : 0) |
        (v1 >= level ? 2 : 0) |
        (v2 >= level ? 4 : 0) |
        (v3 >= level ? 8 : 0)

      if (mask === 0 || mask === 15) continue

      const x0 = bounds.xMin + i * dx
      const x1 = x0 + dx

      const edgePoint = (edge: number): { key: string; pt: Point2D } => {
        switch (edge) {
          case 0:
            return { key: `H:${i}:${j}`, pt: interpEdge(x0, y0, v0, x1, y0, v1, level) }
          case 1:
            return { key: `V:${i + 1}:${j}`, pt: interpEdge(x1, y0, v1, x1, y1, v2, level) }
          case 2:
            return { key: `H:${i}:${j + 1}`, pt: interpEdge(x0, y1, v3, x1, y1, v2, level) }
          default:
            return { key: `V:${i}:${j}`, pt: interpEdge(x0, y0, v0, x0, y1, v3, level) }
        }
      }

      const emitPair = (eA: number, eB: number): void => {
        const a = edgePoint(eA)
        const b = edgePoint(eB)
        segments.push({ k1: a.key, k2: b.key, p1: a.pt, p2: b.pt })
      }

      switch (mask) {
        case 1:
        case 14:
          emitPair(3, 0)
          break
        case 2:
        case 13:
          emitPair(0, 1)
          break
        case 3:
        case 12:
          emitPair(3, 1)
          break
        case 4:
        case 11:
          emitPair(1, 2)
          break
        case 6:
        case 9:
          emitPair(0, 2)
          break
        case 7:
        case 8:
          emitPair(3, 2)
          break
        case 5: {
          const center = 0.25 * (v0 + v1 + v2 + v3)
          if (center >= level) {
            emitPair(3, 2)
            emitPair(0, 1)
          } else {
            emitPair(3, 0)
            emitPair(1, 2)
          }
          break
        }
        case 10: {
          const center = 0.25 * (v0 + v1 + v2 + v3)
          if (center >= level) {
            emitPair(3, 0)
            emitPair(1, 2)
          } else {
            emitPair(3, 2)
            emitPair(0, 1)
          }
          break
        }
      }
    }
  }

  return chainSegments(segments)
}

function chainSegments(segments: RawSegment[]): Point2D[][] {
  if (segments.length === 0) return []

  const adjacency = new Map<string, number[]>()
  const addAdj = (key: string, segIndex: number): void => {
    const list = adjacency.get(key)
    if (list) list.push(segIndex)
    else adjacency.set(key, [segIndex])
  }

  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]!
    addAdj(seg.k1, i)
    addAdj(seg.k2, i)
  }

  const used = new Uint8Array(segments.length)
  const polylines: Point2D[][] = []

  const extendDirection = (
    startKey: string,
    pts: Point2D[],
    pushFront: boolean
  ): void => {
    let currKey = startKey
    while (true) {
      const candidates = adjacency.get(currKey)
      if (!candidates) break
      let nextSegIdx = -1
      for (const idx of candidates) {
        if (!used[idx]) {
          nextSegIdx = idx
          break
        }
      }
      if (nextSegIdx === -1) break
      used[nextSegIdx] = 1
      const seg = segments[nextSegIdx]!
      const nextIsP2 = seg.k1 === currKey
      const nextPt = nextIsP2 ? seg.p2 : seg.p1
      const nextKey = nextIsP2 ? seg.k2 : seg.k1
      if (pushFront) pts.unshift(nextPt)
      else pts.push(nextPt)
      currKey = nextKey
    }
  }

  for (let i = 0; i < segments.length; i += 1) {
    if (used[i]) continue
    used[i] = 1
    const seg = segments[i]!
    const pts: Point2D[] = [seg.p1, seg.p2]
    extendDirection(seg.k2, pts, false)
    extendDirection(seg.k1, pts, true)
    if (pts.length >= 2) {
      polylines.push(pts)
    }
  }

  return polylines
}

/**
 * Generates nice evenly-spaced contour levels across `[minVal, maxVal]`.
 */
export function buildContourLevels(minVal: number, maxVal: number, count = 13): number[] {
  if (!Number.isFinite(minVal) || !Number.isFinite(maxVal) || maxVal <= minVal) {
    return [0]
  }
  const n = Math.max(3, Math.min(35, Math.round(count)))
  const rawStep = (maxVal - minVal) / (n + 1)
  const mag = 10 ** Math.floor(Math.log10(rawStep))
  const norm = rawStep / mag
  const niceNorm = norm <= 1.2 ? 1 : norm <= 2.4 ? 2 : norm <= 3.5 ? 2.5 : norm <= 7 ? 5 : 10
  const step = niceNorm * mag

  const start = Math.ceil(minVal / step) * step
  const levels: number[] = []
  for (let v = start; v <= maxVal + step * 1e-6 && levels.length < 40; v += step) {
    const clean = Math.abs(v) < step * 1e-6 ? 0 : Number(v.toPrecision(6))
    levels.push(clean)
  }
  return levels.length > 0 ? levels : [0.5 * (minVal + maxVal)]
}

/**
 * Projects a 2D point `(x0, y0)` onto the implicit curve `g(x, y) = 0` via damped Gauss-Newton steps.
 */
export function projectPointOntoConstraint(
  gField: CompiledScalarField2D,
  x0: number,
  y0: number,
  fallbackPolylines?: Point2D[][],
  maxIter = 20
): Point2D | null {
  let x = x0
  let y = y0

  // If we have Marching Squares samples, start from the nearest sample when far from g=0
  if (fallbackPolylines && fallbackPolylines.length > 0) {
    const gInit = gField.eval(x, y)
    let bestPt: Point2D | null = null
    let bestDistSq = Number.POSITIVE_INFINITY
    for (const poly of fallbackPolylines) {
      for (const pt of poly) {
        const dx = pt.x - x0
        const dy = pt.y - y0
        const d2 = dx * dx + dy * dy
        if (d2 < bestDistSq) {
          bestDistSq = d2
          bestPt = pt
        }
      }
    }
    if (bestPt && (!Number.isFinite(gInit) || Math.abs(gInit) > 0.2 || bestDistSq < 4)) {
      x = bestPt.x
      y = bestPt.y
    }
  }

  for (let iter = 0; iter < maxIter; iter += 1) {
    const gv = gField.eval(x, y)
    if (!Number.isFinite(gv)) return null
    if (Math.abs(gv) < 1e-10) return { x, y }
    const [gx, gy] = gField.gradient(x, y)
    const normSq = gx * gx + gy * gy
    if (!Number.isFinite(normSq) || normSq < 1e-14) break
    let stepScale = 1
    let accepted = false
    for (let ls = 0; ls < 6; ls += 1) {
      const nx = x - stepScale * (gv * gx) / normSq
      const ny = y - stepScale * (gv * gy) / normSq
      const ng = gField.eval(nx, ny)
      if (Number.isFinite(ng) && Math.abs(ng) < Math.abs(gv)) {
        x = nx
        y = ny
        accepted = true
        break
      }
      stepScale *= 0.5
    }
    if (!accepted) break
  }

  const finalG = gField.eval(x, y)
  return Number.isFinite(finalG) && Math.abs(finalG) < 1e-3 ? { x, y } : null
}

function solveLinear3x3(A: number[][], b: number[]): [number, number, number] | null {
  const M = [
    [A[0]![0]!, A[0]![1]!, A[0]![2]!, b[0]!],
    [A[1]![0]!, A[1]![1]!, A[1]![2]!, b[1]!],
    [A[2]![0]!, A[2]![1]!, A[2]![2]!, b[2]!]
  ]

  for (let col = 0; col < 3; col += 1) {
    let pivotRow = col
    let maxVal = Math.abs(M[col]![col]!)
    for (let r = col + 1; r < 3; r += 1) {
      const v = Math.abs(M[r]![col]!)
      if (v > maxVal) {
        maxVal = v
        pivotRow = r
      }
    }
    if (!Number.isFinite(maxVal) || maxVal < 1e-13) return null
    if (pivotRow !== col) {
      const tmp = M[col]!
      M[col] = M[pivotRow]!
      M[pivotRow] = tmp
    }
    const pivot = M[col]![col]!
    for (let r = col + 1; r < 3; r += 1) {
      const factor = M[r]![col]! / pivot
      for (let c = col; c < 4; c += 1) {
        M[r]![c] = M[r]![c]! - factor * M[col]![c]!
      }
    }
  }

  const x2 = M[2]![3]! / M[2]![2]!
  const x1 = (M[1]![3]! - M[1]![2]! * x2) / M[1]![1]!
  const x0 = (M[0]![3]! - M[0]![2]! * x2 - M[0]![1]! * x1) / M[0]![0]!
  if (!Number.isFinite(x0) || !Number.isFinite(x1) || !Number.isFinite(x2)) return null
  return [x0, x1, x2]
}

function newtonLagrange(
  fField: CompiledScalarField2D,
  gField: CompiledScalarField2D,
  x0: number,
  y0: number,
  lambda0: number,
  bounds: ViewportBounds2D
): { x: number; y: number; lambda: number } | null {
  let x = x0
  let y = y0
  let lam = lambda0

  const padX = (bounds.xMax - bounds.xMin) * 0.2
  const padY = (bounds.yMax - bounds.yMin) * 0.2

  const evalResidual = (cx: number, cy: number, clam: number): [number, number, number] | null => {
    const gVal = gField.eval(cx, cy)
    const [fx, fy] = fField.gradient(cx, cy)
    const [gx, gy] = gField.gradient(cx, cy)
    if (
      !Number.isFinite(gVal) ||
      !Number.isFinite(fx) || !Number.isFinite(fy) ||
      !Number.isFinite(gx) || !Number.isFinite(gy)
    ) {
      return null
    }
    return [fx - clam * gx, fy - clam * gy, gVal]
  }

  for (let iter = 0; iter < 32; iter += 1) {
    const res = evalResidual(x, y, lam)
    if (!res) return null
    const errSq = res[0] * res[0] + res[1] * res[1] + res[2] * res[2]
    if (errSq < 1e-18) {
      return { x, y, lambda: lam }
    }

    const [gx, gy] = gField.gradient(x, y)
    const hF = fField.hessian(x, y)
    const hG = gField.hessian(x, y)
    const Lxx = hF.fxx - lam * hG.fxx
    const Lxy = hF.fxy - lam * hG.fxy
    const Lyy = hF.fyy - lam * hG.fyy

    const delta = solveLinear3x3(
      [
        [Lxx, Lxy, -gx],
        [Lxy, Lyy, -gy],
        [gx, gy, 0]
      ],
      [-res[0], -res[1], -res[2]]
    )
    if (!delta) return null

    // Backtracking line search
    let alpha = 1
    let improved = false
    for (let ls = 0; ls < 10; ls += 1) {
      const nx = x + alpha * delta[0]
      const ny = y + alpha * delta[1]
      const nlam = lam + alpha * delta[2]
      const nres = evalResidual(nx, ny, nlam)
      if (nres) {
        const nErrSq = nres[0] * nres[0] + nres[1] * nres[1] + nres[2] * nres[2]
        if (nErrSq < errSq * (1 - 1e-4 * alpha) || nErrSq < 1e-18) {
          x = nx
          y = ny
          lam = nlam
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

  const finalRes = evalResidual(x, y, lam)
  if (!finalRes) return null
  const finalNorm = Math.hypot(finalRes[0], finalRes[1], finalRes[2])
  return finalNorm < 1e-6 ? { x, y, lambda: lam } : null
}

function classifyLagrangeStationary(
  fField: CompiledScalarField2D,
  gField: CompiledScalarField2D,
  x: number,
  y: number,
  lambda: number
): LagrangeStationaryKind {
  const [gx, gy] = gField.gradient(x, y)
  const hF = fField.hessian(x, y)
  const hG = gField.hessian(x, y)
  const Lxx = hF.fxx - lambda * hG.fxx
  const Lxy = hF.fxy - lambda * hG.fxy
  const Lyy = hF.fyy - lambda * hG.fyy

  // Second directional derivative along constraint tangent t = (-gy, gx): t^T H_L t
  const tangentCurvature = gy * gy * Lxx - 2 * gx * gy * Lxy + gx * gx * Lyy
  const gNormSq = gx * gx + gy * gy
  if (Number.isFinite(tangentCurvature) && gNormSq > 1e-12) {
    const normalized = tangentCurvature / gNormSq
    if (normalized > 1e-5) return "constrained_min"
    if (normalized < -1e-5) return "constrained_max"
  }

  // Fallback: probe both directions along the constraint tangent
  const gNorm = Math.hypot(gx, gy)
  if (gNorm > 1e-9) {
    const tx = -gy / gNorm
    const ty = gx / gNorm
    const eps = 1e-3
    const pPlus = projectPointOntoConstraint(gField, x + eps * tx, y + eps * ty)
    const pMinus = projectPointOntoConstraint(gField, x - eps * tx, y - eps * ty)
    const f0 = fField.eval(x, y)
    if (pPlus && pMinus && Number.isFinite(f0)) {
      const fp = fField.eval(pPlus.x, pPlus.y)
      const fm = fField.eval(pMinus.x, pMinus.y)
      if (fp < f0 - 1e-9 && fm < f0 - 1e-9) return "constrained_max"
      if (fp > f0 + 1e-9 && fm > f0 + 1e-9) return "constrained_min"
    }
  }
  return "constrained_stationary"
}

function snapZero(v: number, eps = 1e-7): number {
  return Math.abs(v) < eps ? 0 : v
}

/**
 * Evaluates live Lagrange diagnostics at a user-positioned point `P = (x, y)` on/near `g(x, y) = 0`.
 */
export function evaluateLagrangePoint(
  fField: CompiledScalarField2D,
  gField: CompiledScalarField2D,
  x: number,
  y: number
): LagrangePointProbe {
  const fValue = fField.eval(x, y)
  const gValue = gField.eval(x, y)
  const gradF = fField.gradient(x, y)
  const gradG = gField.gradient(x, y)

  const normF = Math.hypot(gradF[0], gradF[1])
  const normG = Math.hypot(gradG[0], gradG[1])
  const dot = gradF[0] * gradG[0] + gradF[1] * gradG[1]
  const cross = gradF[0] * gradG[1] - gradF[1] * gradG[0]

  let angleDeg = 0
  let collinearitySin = 0
  if (normF > 1e-9 && normG > 1e-9) {
    const cosTheta = Math.max(-1, Math.min(1, dot / (normF * normG)))
    angleDeg = (Math.acos(cosTheta) * 180) / Math.PI
    collinearitySin = Math.min(1, Math.abs(cross) / (normF * normG))
  }

  const estimatedLambda = normG > 1e-10 ? dot / (normG * normG) : Number.NaN
  const isTangent = normF < 1e-5 || collinearitySin < 0.05

  return {
    x,
    y,
    fValue,
    gValue,
    gradF,
    gradG,
    angleDeg,
    collinearitySin,
    estimatedLambda,
    isTangent
  }
}

export interface AnalyzeLagrangeOptions {
  gridSize?: number
  contourCount?: number
}

/**
 * Computes full 2D Lagrange multiplier visualization & exact KKT stationary points:
 * - Precomputes objective scalar grid & Marching Squares level-set contour family `f(x, y) = c`
 * - Extracts implicit constraint curve `g(x, y) = 0` via Marching Squares
 * - Solves `∇f = λ∇g, g = 0` using multi-seed damped 3D Newton-Raphson
 * - Classifies constrained maxima, minima, and global extrema on the visible constraint
 */
export function analyzeLagrange2D(
  objectiveSource: string,
  constraintSource: string,
  bounds: ViewportBounds2D,
  options: AnalyzeLagrangeOptions = {}
): LagrangeAnalysis {
  const fField = compileScalarField2D(objectiveSource, "expression")
  const gField = compileScalarField2D(constraintSource, "implicit")

  const gridSize = Math.max(48, Math.min(160, Math.round(options.gridSize ?? 96)))
  const fGrid = fField.evalGrid(bounds.xMin, bounds.xMax, bounds.yMin, bounds.yMax, gridSize, gridSize)
  const gGrid = gField.evalGrid(bounds.xMin, bounds.xMax, bounds.yMin, bounds.yMax, gridSize, gridSize)

  // Compute robust f range across the viewport
  const finiteF: number[] = []
  for (let i = 0; i < fGrid.length; i += 1) {
    const v = fGrid[i]!
    if (Number.isFinite(v) && Math.abs(v) < 1e6) finiteF.push(v)
  }
  finiteF.sort((a, b) => a - b)
  const fMin = finiteF.length > 0 ? finiteF[Math.floor(finiteF.length * 0.02)]! : -5
  const fMax = finiteF.length > 0 ? finiteF[Math.min(finiteF.length - 1, Math.ceil(finiteF.length * 0.98))]! : 5

  const contourLevels = buildContourLevels(fMin, fMax, options.contourCount ?? 13)
  const contours: ContourLevelCurves[] = contourLevels.map((level) => ({
    level,
    polylines: extractContoursFromGrid(fGrid, bounds, gridSize, gridSize, level)
  }))

  const constraintCurves = extractContoursFromGrid(gGrid, bounds, gridSize, gridSize, 0)

  // Seed multi-start 3D Newton solver along the Marching Squares constraint curves.
  const seeds: Array<{ x: number; y: number; lam: number }> = []
  const constraintValues: number[] = []

  for (const poly of constraintCurves) {
    const crossList: number[] = []
    const sinList: number[] = []
    for (let i = 0; i < poly.length; i += 1) {
      const pt = poly[i]!
      const fv = fField.eval(pt.x, pt.y)
      if (Number.isFinite(fv)) constraintValues.push(fv)
      const [fx, fy] = fField.gradient(pt.x, pt.y)
      const [gx, gy] = gField.gradient(pt.x, pt.y)
      const cross = fx * gy - fy * gx
      const nF = Math.hypot(fx, fy)
      const nG = Math.hypot(gx, gy)
      crossList.push(cross)
      sinList.push(nF > 1e-8 && nG > 1e-8 ? Math.abs(cross) / (nF * nG) : 0)
    }

    const stride = Math.max(1, Math.floor(poly.length / 10))
    for (let i = 0; i < poly.length; i += 1) {
      const pt = poly[i]!
      const signChange =
        i > 0 &&
        Number.isFinite(crossList[i - 1]!) &&
        Number.isFinite(crossList[i]!) &&
        crossList[i - 1]! * crossList[i]! <= 0
      const localSinMin =
        i > 0 &&
        i + 1 < poly.length &&
        sinList[i]! <= sinList[i - 1]! &&
        sinList[i]! <= sinList[i + 1]! &&
        sinList[i]! < 0.25
      const periodicSeed = i % stride === 0

      if (signChange || localSinMin || periodicSeed) {
        const [fx, fy] = fField.gradient(pt.x, pt.y)
        const [gx, gy] = gField.gradient(pt.x, pt.y)
        const gNormSq = gx * gx + gy * gy
        if (gNormSq > 1e-10) {
          const lam0 = (fx * gx + fy * gy) / gNormSq
          seeds.push({ x: pt.x, y: pt.y, lam: lam0 })
        }
      }
    }
  }

  const stationaryPoints: LagrangeStationaryPoint[] = []
  const dedupDist = Math.max(1e-3, Math.hypot(bounds.xMax - bounds.xMin, bounds.yMax - bounds.yMin) * 1e-3)

  for (const seed of seeds) {
    const sol = newtonLagrange(fField, gField, seed.x, seed.y, seed.lam, bounds)
    if (!sol) continue
    if (
      sol.x < bounds.xMin - 1e-4 || sol.x > bounds.xMax + 1e-4 ||
      sol.y < bounds.yMin - 1e-4 || sol.y > bounds.yMax + 1e-4
    ) {
      continue
    }
    const [gx, gy] = gField.gradient(sol.x, sol.y)
    if (Math.hypot(gx, gy) < 1e-7) continue

    const duplicate = stationaryPoints.some(
      (pt) => Math.hypot(pt.x - sol.x, pt.y - sol.y) < dedupDist
    )
    if (duplicate) continue

    const val = fField.eval(sol.x, sol.y)
    if (!Number.isFinite(val)) continue
    const gradF = fField.gradient(sol.x, sol.y)
    const kind = classifyLagrangeStationary(fField, gField, sol.x, sol.y, sol.lambda)

    stationaryPoints.push({
      x: snapZero(sol.x),
      y: snapZero(sol.y),
      value: snapZero(val),
      lambda: snapZero(sol.lambda),
      gradF: [snapZero(gradF[0]), snapZero(gradF[1])],
      gradG: [snapZero(gx), snapZero(gy)],
      kind,
      isGlobalMax: false,
      isGlobalMin: false,
      label: kind === "constrained_max"
        ? "条件极大值"
        : kind === "constrained_min"
          ? "条件极小值"
          : "条件驻点"
    })
  }

  // Sort stationary points by objective value descending (most intuitive for optimization tables).
  stationaryPoints.sort((a, b) => b.value - a.value || a.x - b.x)

  // Tag global max/min among stationary points (when matching constraint extremes).
  if (stationaryPoints.length > 0) {
    const maxVal = Math.max(...stationaryPoints.map((p) => p.value))
    const minVal = Math.min(...stationaryPoints.map((p) => p.value))
    const cMax = constraintValues.length > 0 ? Math.max(...constraintValues) : maxVal
    const cMin = constraintValues.length > 0 ? Math.min(...constraintValues) : minVal
    const tolMax = 1e-3 * (1 + Math.abs(maxVal))
    const tolMin = 1e-3 * (1 + Math.abs(minVal))

    for (const pt of stationaryPoints) {
      if (Math.abs(pt.value - maxVal) <= tolMax && pt.value >= cMax - Math.max(0.05, tolMax * 10)) {
        pt.isGlobalMax = true
      }
      if (Math.abs(pt.value - minVal) <= tolMin && pt.value <= cMin + Math.max(0.05, tolMin * 10)) {
        pt.isGlobalMin = true
      }
    }
  }

  // Compute sensible slider range for level `c` centered around the constraint values.
  const cPool = [
    ...constraintValues,
    ...stationaryPoints.map((p) => p.value)
  ]
  const rawCMin = cPool.length > 0 ? Math.min(...cPool) : fMin
  const rawCMax = cPool.length > 0 ? Math.max(...cPool) : fMax
  const cSpan = Math.max(1, rawCMax - rawCMin)
  const suggestedLevelRange: [number, number] = [
    Number((rawCMin - cSpan * 0.35).toPrecision(5)),
    Number((rawCMax + cSpan * 0.35).toPrecision(5))
  ]

  return {
    objectiveSource,
    constraintSource,
    bounds,
    gridSize,
    fGrid,
    fMin,
    fMax,
    contourLevels,
    contours,
    constraintCurves,
    stationaryPoints,
    suggestedLevelRange
  }
}
