import { compileScalarField2D, type CompiledScalarField2D } from "./bytecode"
import type { Point2D, ViewportBounds2D } from "./contour"

export type SurfaceStationaryKind =
  | "local_max"
  | "local_min"
  | "saddle"
  | "degenerate"

export interface SurfaceStationaryPoint {
  x: number
  y: number
  z: number
  fxx: number
  fxy: number
  fyy: number
  /** Hessian discriminant AC - B^2. */
  discriminant: number
  kind: SurfaceStationaryKind
  label: string
}

export interface TangentPlaneInfo {
  x: number
  y: number
  z: number
  fx: number
  fy: number
  equation: string
}

export interface Surface3DAnalysis {
  expression: string
  bounds: ViewportBounds2D
  gridSize: number
  zGrid: Float64Array
  zMin: number
  zMax: number
  stationaryPoints: SurfaceStationaryPoint[]
}

export interface Point3D {
  x: number
  y: number
  z: number
}

function snapZero(v: number, eps = 1e-7): number {
  return Math.abs(v) < eps ? 0 : v
}

function solveStationaryNewton2D(
  fField: CompiledScalarField2D,
  x0: number,
  y0: number,
  bounds: ViewportBounds2D
): Point2D | null {
  let x = x0
  let y = y0
  const padX = (bounds.xMax - bounds.xMin) * 0.12
  const padY = (bounds.yMax - bounds.yMin) * 0.12

  for (let iter = 0; iter < 28; iter += 1) {
    const [fx, fy] = fField.gradient(x, y)
    if (!Number.isFinite(fx) || !Number.isFinite(fy)) return null
    const errSq = fx * fx + fy * fy
    if (errSq < 1e-17) return { x, y }

    const { fxx, fxy, fyy } = fField.hessian(x, y)
    const det = fxx * fyy - fxy * fxy
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null

    const dx = (-fx * fyy + fxy * fy) / det
    const dy = (-fxx * fy + fx * fxy) / det
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null

    let alpha = 1
    let improved = false
    for (let ls = 0; ls < 8; ls += 1) {
      const nx = x + alpha * dx
      const ny = y + alpha * dy
      const [nfx, nfy] = fField.gradient(nx, ny)
      if (Number.isFinite(nfx) && Number.isFinite(nfy)) {
        const nErrSq = nfx * nfx + nfy * nfy
        if (nErrSq < errSq * (1 - 1e-4 * alpha) || nErrSq < 1e-17) {
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

  const [fx, fy] = fField.gradient(x, y)
  return Number.isFinite(fx) && Number.isFinite(fy) && Math.hypot(fx, fy) < 1e-5 ? { x, y } : null
}

export interface AnalyzeSurface3DOptions {
  gridSize?: number
}

/**
 * Evaluates an explicit 3D surface `z = f(x, y)` on a uniform mesh and solves + classifies
 * all interior stationary points via Hessian discriminant `AC - B^2`.
 */
export function analyzeSurface3D(
  expression: string,
  bounds: ViewportBounds2D,
  options: AnalyzeSurface3DOptions = {}
): Surface3DAnalysis {
  const fField = compileScalarField2D(expression, "expression")
  const gridSize = Math.max(24, Math.min(88, Math.round(options.gridSize ?? 52)))
  const zGrid = fField.evalGrid(bounds.xMin, bounds.xMax, bounds.yMin, bounds.yMax, gridSize, gridSize)

  const finiteZ: number[] = []
  for (let i = 0; i < zGrid.length; i += 1) {
    const v = zGrid[i]!
    if (Number.isFinite(v) && Math.abs(v) < 1e5) finiteZ.push(v)
  }
  finiteZ.sort((a, b) => a - b)
  const p02 = finiteZ.length > 0 ? finiteZ[Math.floor(finiteZ.length * 0.02)]! : -2
  const p98 = finiteZ.length > 0 ? finiteZ[Math.min(finiteZ.length - 1, Math.ceil(finiteZ.length * 0.98))]! : 2
  const zMin = p02
  const zMax = p98 > p02 + 1e-5 ? p98 : p02 + 1

  // Build multi-start seeds from a 12x12 gradient-norm grid + local minima
  const seedN = 14
  const gradSq = new Float64Array((seedN + 1) * (seedN + 1))
  const sdx = (bounds.xMax - bounds.xMin) / seedN
  const sdy = (bounds.yMax - bounds.yMin) / seedN
  for (let j = 0; j <= seedN; j += 1) {
    const y = bounds.yMin + j * sdy
    for (let i = 0; i <= seedN; i += 1) {
      const x = bounds.xMin + i * sdx
      const [fx, fy] = fField.gradient(x, y)
      gradSq[j * (seedN + 1) + i] = Number.isFinite(fx) && Number.isFinite(fy) ? fx * fx + fy * fy : Number.POSITIVE_INFINITY
    }
  }

  const seeds: Point2D[] = [{ x: 0, y: 0 }]
  for (let j = 1; j < seedN; j += 1) {
    for (let i = 1; i < seedN; i += 1) {
      const cols = seedN + 1
      const v = gradSq[j * cols + i]!
      if (!Number.isFinite(v)) continue
      if (
        v <= gradSq[j * cols + (i - 1)]! &&
        v <= gradSq[j * cols + (i + 1)]! &&
        v <= gradSq[(j - 1) * cols + i]! &&
        v <= gradSq[(j + 1) * cols + i]!
      ) {
        seeds.push({ x: bounds.xMin + i * sdx, y: bounds.yMin + j * sdy })
      }
    }
  }
  for (let j = 0; j <= 4; j += 1) {
    for (let i = 0; i <= 4; i += 1) {
      seeds.push({
        x: bounds.xMin + (i / 4) * (bounds.xMax - bounds.xMin),
        y: bounds.yMin + (j / 4) * (bounds.yMax - bounds.yMin)
      })
    }
  }

  const stationaryPoints: SurfaceStationaryPoint[] = []
  const dedupTol = Math.max(1e-3, Math.hypot(bounds.xMax - bounds.xMin, bounds.yMax - bounds.yMin) * 2e-3)

  for (const seed of seeds) {
    const sol = solveStationaryNewton2D(fField, seed.x, seed.y, bounds)
    if (!sol) continue
    if (
      sol.x < bounds.xMin - 1e-3 || sol.x > bounds.xMax + 1e-3 ||
      sol.y < bounds.yMin - 1e-3 || sol.y > bounds.yMax + 1e-3
    ) {
      continue
    }
    if (stationaryPoints.some((pt) => Math.hypot(pt.x - sol.x, pt.y - sol.y) < dedupTol)) continue

    const z = fField.eval(sol.x, sol.y)
    if (!Number.isFinite(z)) continue
    const { fxx, fxy, fyy } = fField.hessian(sol.x, sol.y)
    const disc = snapZero(fxx * fyy - fxy * fxy, 1e-6)

    let kind: SurfaceStationaryKind
    let label: string
    if (Math.abs(disc) <= 1e-6) {
      kind = "degenerate"
      label = "退化驻点"
    } else if (disc < 0) {
      kind = "saddle"
      label = "鞍点"
    } else if (fxx < 0) {
      kind = "local_max"
      label = "局部极大值"
    } else {
      kind = "local_min"
      label = "局部极小值"
    }

    stationaryPoints.push({
      x: snapZero(sol.x),
      y: snapZero(sol.y),
      z: snapZero(z),
      fxx: snapZero(fxx),
      fxy: snapZero(fxy),
      fyy: snapZero(fyy),
      discriminant: disc,
      kind,
      label
    })
  }

  stationaryPoints.sort((a, b) => b.z - a.z || a.x - b.x)

  return {
    expression,
    bounds,
    gridSize,
    zGrid,
    zMin,
    zMax,
    stationaryPoints
  }
}

/**
 * Computes tangent plane equation `z = z0 + fx*(x - x0) + fy*(y - y0)` at `(x0, y0)`.
 */
export function computeTangentPlane3D(
  fField: CompiledScalarField2D,
  x0: number,
  y0: number
): TangentPlaneInfo | null {
  const z0 = fField.eval(x0, y0)
  const [fx, fy] = fField.gradient(x0, y0)
  if (!Number.isFinite(z0) || !Number.isFinite(fx) || !Number.isFinite(fy)) return null

  const sx = snapZero(fx, 1e-4)
  const sy = snapZero(fy, 1e-4)
  const c = snapZero(z0 - sx * x0 - sy * y0, 1e-4)

  const parts: string[] = []
  if (sx !== 0) parts.push(`${Number(sx.toFixed(2))}x`)
  if (sy !== 0) {
    const prefix = parts.length === 0 ? (sy < 0 ? "-" : "") : (sy > 0 ? "+ " : "- ")
    parts.push(`${prefix}${Number(Math.abs(sy).toFixed(2))}y`)
  }
  if (c !== 0 || parts.length === 0) {
    const prefix = parts.length === 0 ? (c < 0 ? "-" : "") : (c > 0 ? "+ " : "- ")
    parts.push(`${prefix}${Number(Math.abs(c).toFixed(2))}`)
  }

  return {
    x: snapZero(x0),
    y: snapZero(y0),
    z: snapZero(z0),
    fx: snapZero(fx),
    fy: snapZero(fy),
    equation: `z = ${parts.join(" ")}`
  }
}

/**
 * Lifts 2D constraint polylines `g(x, y) = 0` onto the 3D surface `(x, y, f(x, y))`.
 */
export function liftConstraintCurvesTo3D(
  fField: CompiledScalarField2D,
  constraintPolylines: Point2D[][]
): Point3D[][] {
  const result: Point3D[][] = []
  for (const poly of constraintPolylines) {
    let seg: Point3D[] = []
    for (const pt of poly) {
      const z = fField.eval(pt.x, pt.y)
      if (Number.isFinite(z) && Math.abs(z) < 1e4) {
        seg.push({ x: pt.x, y: pt.y, z })
      } else if (seg.length >= 2) {
        result.push(seg)
        seg = []
      } else {
        seg = []
      }
    }
    if (seg.length >= 2) result.push(seg)
  }
  return result
}
