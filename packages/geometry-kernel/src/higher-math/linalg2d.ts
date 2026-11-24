import type { Point2D } from "./contour"
import type { ComplexNumber } from "./ode"

export type Matrix2x2 = [[number, number], [number, number]]

export interface RealEigenvector2D {
  eigenvalue: number
  /** Unit eigenvector (vx, vy). */
  unitVector: Point2D
  /** Image A * unitVector = eigenvalue * unitVector. */
  transformedVector: Point2D
}

export interface Svd2DResult {
  sigma1: number
  sigma2: number
  conditionNumber: number
  /** Orthogonal columns u1, u2 (semi-axis directions of image ellipse). */
  u1: Point2D
  u2: Point2D
  /** Orthogonal columns v1, v2 (pre-image directions on unit circle). */
  v1: Point2D
  v2: Point2D
}

export interface LinearTransform2DAnalysis {
  matrix: Matrix2x2
  interpolatedMatrix: Matrix2x2
  progress: number
  trace: number
  determinant: number
  interpolatedDet: number
  rank: 0 | 1 | 2
  orientation: "preserving" | "reversing" | "singular"
  eigenvalues: [ComplexNumber, ComplexNumber]
  realEigenvectors: RealEigenvector2D[]
  svd: Svd2DResult
  /** Basis i' and j' under M(t). */
  basisI: Point2D
  basisJ: Point2D
  /** Transformed unit square [0,0] -> i' -> i'+j' -> j' under M(t). */
  unitParallelogram: [Point2D, Point2D, Point2D, Point2D]
  /** Transformed unit circle under M(t) (73 points). */
  transformedCircle: Point2D[]
}

function snapZero(v: number, eps = 1e-8): number {
  return Math.abs(v) < eps ? 0 : v
}

export function applyMatrix2x2(m: Matrix2x2, x: number, y: number): Point2D {
  return {
    x: m[0][0] * x + m[0][1] * y,
    y: m[1][0] * x + m[1][1] * y
  }
}

export function computeSvd2x2(matrix: Matrix2x2): Svd2DResult {
  const [[a, b], [c, d]] = matrix
  // A^T * A = [[e, f], [f, g]]
  const e = a * a + c * c
  const f = a * b + c * d
  const g = b * b + d * d

  const theta = 0.5 * Math.atan2(2 * f, e - g)
  const ct = Math.cos(theta)
  const st = Math.sin(theta)

  let v1: Point2D = { x: ct, y: st }
  let v2: Point2D = { x: -st, y: ct }

  const av1 = applyMatrix2x2(matrix, v1.x, v1.y)
  const av2 = applyMatrix2x2(matrix, v2.x, v2.y)
  let s1 = Math.hypot(av1.x, av1.y)
  let s2 = Math.hypot(av2.x, av2.y)

  if (s2 > s1) {
    const tmpS = s1; s1 = s2; s2 = tmpS
    const tmpV = v1; v1 = v2; v2 = tmpV
  }

  const img1 = applyMatrix2x2(matrix, v1.x, v1.y)
  const img2 = applyMatrix2x2(matrix, v2.x, v2.y)

  const u1: Point2D = s1 > 1e-10
    ? { x: img1.x / s1, y: img1.y / s1 }
    : { x: 1, y: 0 }

  const u2: Point2D = s2 > 1e-10
    ? { x: img2.x / s2, y: img2.y / s2 }
    : { x: -u1.y, y: u1.x }

  const sigma1 = snapZero(s1, 1e-9)
  const sigma2 = snapZero(s2, 1e-9)
  const conditionNumber = sigma2 > 1e-9 ? sigma1 / sigma2 : Number.POSITIVE_INFINITY

  return {
    sigma1,
    sigma2,
    conditionNumber,
    u1,
    u2,
    v1,
    v2
  }
}

function solveRealEigenvectors(matrix: Matrix2x2, eigenvalues: [ComplexNumber, ComplexNumber]): RealEigenvector2D[] {
  if (Math.abs(eigenvalues[0].im) > 1e-7) return []

  const [[a, b], [c, d]] = matrix
  const l1 = eigenvalues[0].re
  const l2 = eigenvalues[1].re

  // Check if matrix is scalar multiple k * I
  if (Math.abs(a - d) < 1e-8 && Math.abs(b) < 1e-8 && Math.abs(c) < 1e-8) {
    return [
      { eigenvalue: l1, unitVector: { x: 1, y: 0 }, transformedVector: { x: l1, y: 0 } },
      { eigenvalue: l1, unitVector: { x: 0, y: 1 }, transformedVector: { x: 0, y: l1 } }
    ]
  }

  const findNullUnit = (lam: number): Point2D | null => {
    const r0x = a - lam
    const r0y = b
    const r1x = c
    const r1y = d - lam
    const n0 = Math.hypot(r0x, r0y)
    const n1 = Math.hypot(r1x, r1y)
    if (n0 >= n1 && n0 > 1e-9) {
      let vx = -r0y / n0
      let vy = r0x / n0
      if (vx < -1e-6 || (Math.abs(vx) <= 1e-6 && vy < 0)) { vx = -vx; vy = -vy }
      return { x: vx, y: vy }
    }
    if (n1 > 1e-9) {
      let vx = -r1y / n1
      let vy = r1x / n1
      if (vx < -1e-6 || (Math.abs(vx) <= 1e-6 && vy < 0)) { vx = -vx; vy = -vy }
      return { x: vx, y: vy }
    }
    return null
  }

  const out: RealEigenvector2D[] = []
  const vec1 = findNullUnit(l1)
  if (vec1) {
    out.push({
      eigenvalue: l1,
      unitVector: vec1,
      transformedVector: applyMatrix2x2(matrix, vec1.x, vec1.y)
    })
  }

  if (Math.abs(l1 - l2) > 1e-6) {
    const vec2 = findNullUnit(l2)
    if (vec2) {
      out.push({
        eigenvalue: l2,
        unitVector: vec2,
        transformedVector: applyMatrix2x2(matrix, vec2.x, vec2.y)
      })
    }
  }

  return out
}

/**
 * Computes full geometric linear-algebra diagnostics for a 2x2 matrix `A`
 * and its homotopy interpolation `M(t) = (1 - t)I + tA` at `progress = t` in `[0, 1]`.
 */
export function analyzeLinearTransform2D(
  matrix: Matrix2x2,
  progress = 1
): LinearTransform2DAnalysis {
  const t = Math.max(0, Math.min(1, progress))
  const [[a, b], [c, d]] = matrix

  const interpolatedMatrix: Matrix2x2 = [
    [(1 - t) + t * a, t * b],
    [t * c, (1 - t) + t * d]
  ]

  const trace = snapZero(a + d)
  const determinant = snapZero(a * d - b * c)
  const interpolatedDet = snapZero(
    interpolatedMatrix[0][0] * interpolatedMatrix[1][1] -
    interpolatedMatrix[0][1] * interpolatedMatrix[1][0]
  )

  const svd = computeSvd2x2(matrix)
  const rank: 0 | 1 | 2 = svd.sigma1 < 1e-7 ? 0 : svd.sigma2 < 1e-7 ? 1 : 2
  const orientation = Math.abs(determinant) < 1e-7
    ? "singular"
    : determinant > 0
      ? "preserving"
      : "reversing"

  const disc = trace * trace - 4 * determinant
  const eigenvalues: [ComplexNumber, ComplexNumber] = disc >= -1e-11
    ? [
        { re: snapZero(0.5 * (trace + Math.sqrt(Math.max(0, disc)))), im: 0 },
        { re: snapZero(0.5 * (trace - Math.sqrt(Math.max(0, disc)))), im: 0 }
      ]
    : [
        { re: snapZero(0.5 * trace), im: 0.5 * Math.sqrt(-disc) },
        { re: snapZero(0.5 * trace), im: -0.5 * Math.sqrt(-disc) }
      ]

  const realEigenvectors = solveRealEigenvectors(matrix, eigenvalues)

  const basisI = applyMatrix2x2(interpolatedMatrix, 1, 0)
  const basisJ = applyMatrix2x2(interpolatedMatrix, 0, 1)
  const unitParallelogram: [Point2D, Point2D, Point2D, Point2D] = [
    { x: 0, y: 0 },
    basisI,
    { x: basisI.x + basisJ.x, y: basisI.y + basisJ.y },
    basisJ
  ]

  const circleSamples = 72
  const transformedCircle: Point2D[] = []
  for (let i = 0; i <= circleSamples; i += 1) {
    const ang = (i / circleSamples) * Math.PI * 2
    transformedCircle.push(applyMatrix2x2(interpolatedMatrix, Math.cos(ang), Math.sin(ang)))
  }

  return {
    matrix,
    interpolatedMatrix,
    progress: t,
    trace,
    determinant,
    interpolatedDet,
    rank,
    orientation,
    eigenvalues,
    realEigenvectors,
    svd,
    basisI,
    basisJ,
    unitParallelogram,
    transformedCircle
  }
}
