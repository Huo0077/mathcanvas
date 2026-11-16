import type { Vector3 } from "./geometry3d"

export const NUMERIC_POLICY_VERSION = "num-policy-v1" as const

export type ResidualLayer = "topological_sign" | "metric_error" | "solver_residual"
export type NumericJudgementStatus = "satisfied" | "violated" | "unknown" | "degenerate"

export interface NumericPolicy {
  absoluteTolerance: number
  relativeTolerance: number
}

export interface NormalizedResidualResult {
  policyVersion: typeof NUMERIC_POLICY_VERSION
  layer: ResidualLayer
  status: NumericJudgementStatus
  residual: number
  tolerance: number
  scale: number
  reason?: string
}

export const defaultNumericPolicy: Readonly<NumericPolicy> = Object.freeze({
  absoluteTolerance: 1e-12,
  relativeTolerance: 1e-11
})

export const metricVerificationPolicy: Readonly<NumericPolicy> = Object.freeze({
  absoluteTolerance: 1e-6,
  relativeTolerance: 1e-6
})

export function allFinite(values: readonly number[]): boolean {
  return values.every(Number.isFinite)
}

export function characteristicScale(values: readonly number[]): number {
  if (!allFinite(values)) return Number.NaN
  let maxAbs = 0
  for (const value of values) maxAbs = Math.max(maxAbs, Math.abs(value))
  return maxAbs
}

export function classifyUncertaintyInterval(
  residual: number,
  uncertaintyBand: number,
  tolerance: number
): NumericJudgementStatus {
  if (!Number.isFinite(residual) || !Number.isFinite(uncertaintyBand) || !Number.isFinite(tolerance) || uncertaintyBand < 0 || tolerance < 0) {
    return "degenerate"
  }
  const lower = residual - uncertaintyBand
  const upper = residual + uncertaintyBand
  if (upper <= tolerance) return "satisfied"
  if (lower > tolerance) return "violated"
  return "unknown"
}

export function normalizedLengthResidual(
  actualLength: number,
  expectedLength: number,
  figureScale: number,
  policy: NumericPolicy = defaultNumericPolicy
): NormalizedResidualResult {
  if (!allFinite([actualLength, expectedLength, figureScale]) || !(figureScale > 0)) {
    return {
      policyVersion: NUMERIC_POLICY_VERSION,
      layer: "metric_error",
      status: "degenerate",
      residual: Number.NaN,
      tolerance: policy.relativeTolerance,
      scale: figureScale,
      reason: "Length or characteristic scale is non-finite or non-positive."
    }
  }
  const tolerance = Math.max(policy.relativeTolerance, policy.absoluteTolerance / figureScale)
  const residual = Math.abs(actualLength - expectedLength) / figureScale
  return {
    policyVersion: NUMERIC_POLICY_VERSION,
    layer: "metric_error",
    status: residual <= tolerance ? "satisfied" : "violated",
    residual,
    tolerance,
    scale: figureScale
  }
}

export function normalizedPlaneDistanceResidual(
  point: Vector3,
  planeOrigin: Vector3,
  normal: Vector3,
  figureScale: number,
  policy: NumericPolicy = defaultNumericPolicy
): NormalizedResidualResult {
  if (
    !allFinite([point.x, point.y, point.z, planeOrigin.x, planeOrigin.y, planeOrigin.z, normal.x, normal.y, normal.z, figureScale])
    || !(figureScale > 0)
  ) {
    return {
      policyVersion: NUMERIC_POLICY_VERSION,
      layer: "solver_residual",
      status: "degenerate",
      residual: Number.NaN,
      tolerance: policy.relativeTolerance,
      scale: figureScale,
      reason: "Plane distance inputs or scale are non-finite or non-positive."
    }
  }
  const normalNorm = Math.hypot(normal.x, normal.y, normal.z)
  if (!(normalNorm > 0) || !Number.isFinite(normalNorm)) {
    return {
      policyVersion: NUMERIC_POLICY_VERSION,
      layer: "solver_residual",
      status: "degenerate",
      residual: Number.NaN,
      tolerance: policy.relativeTolerance,
      scale: figureScale,
      reason: "Zero-length plane normal vector."
    }
  }
  const dot =
    normal.x * (point.x - planeOrigin.x)
    + normal.y * (point.y - planeOrigin.y)
    + normal.z * (point.z - planeOrigin.z)
  const residual = Math.abs(dot) / (normalNorm * figureScale)
  const tolerance = Math.max(policy.relativeTolerance, policy.absoluteTolerance / figureScale)
  return {
    policyVersion: NUMERIC_POLICY_VERSION,
    layer: "solver_residual",
    status: residual <= tolerance ? "satisfied" : "violated",
    residual,
    tolerance,
    scale: figureScale
  }
}

export function normalizedPerpendicularResidual(
  u: { x: number; y: number; z?: number },
  v: { x: number; y: number; z?: number },
  policy: NumericPolicy = defaultNumericPolicy
): NormalizedResidualResult {
  const uz = u.z ?? 0
  const vz = v.z ?? 0
  if (!allFinite([u.x, u.y, uz, v.x, v.y, vz])) {
    return { policyVersion: NUMERIC_POLICY_VERSION, layer: "topological_sign", status: "degenerate", residual: Number.NaN, tolerance: policy.relativeTolerance, scale: 0, reason: "Non-finite vector component." }
  }
  const lu = Math.hypot(u.x, u.y, uz)
  const lv = Math.hypot(v.x, v.y, vz)
  if (!(lu > 0 && lv > 0) || !Number.isFinite(lu * lv)) {
    return { policyVersion: NUMERIC_POLICY_VERSION, layer: "topological_sign", status: "degenerate", residual: Number.NaN, tolerance: policy.relativeTolerance, scale: 0, reason: "Zero-length direction vector." }
  }
  const residual = Math.abs(u.x * v.x + u.y * v.y + uz * vz) / (lu * lv)
  const tolerance = policy.relativeTolerance
  return {
    policyVersion: NUMERIC_POLICY_VERSION,
    layer: "topological_sign",
    status: residual <= tolerance ? "satisfied" : "violated",
    residual,
    tolerance,
    scale: Math.max(lu, lv)
  }
}

export function normalizedParallelResidual(
  u: { x: number; y: number; z?: number },
  v: { x: number; y: number; z?: number },
  policy: NumericPolicy = defaultNumericPolicy
): NormalizedResidualResult {
  const uz = u.z ?? 0
  const vz = v.z ?? 0
  if (!allFinite([u.x, u.y, uz, v.x, v.y, vz])) {
    return { policyVersion: NUMERIC_POLICY_VERSION, layer: "topological_sign", status: "degenerate", residual: Number.NaN, tolerance: policy.relativeTolerance, scale: 0, reason: "Non-finite vector component." }
  }
  const lu = Math.hypot(u.x, u.y, uz)
  const lv = Math.hypot(v.x, v.y, vz)
  if (!(lu > 0 && lv > 0) || !Number.isFinite(lu * lv)) {
    return { policyVersion: NUMERIC_POLICY_VERSION, layer: "topological_sign", status: "degenerate", residual: Number.NaN, tolerance: policy.relativeTolerance, scale: 0, reason: "Zero-length direction vector." }
  }
  const cx = u.y * vz - uz * v.y
  const cy = uz * v.x - u.x * vz
  const cz = u.x * v.y - u.y * v.x
  const residual = Math.hypot(cx, cy, cz) / (lu * lv)
  const tolerance = policy.relativeTolerance
  return {
    policyVersion: NUMERIC_POLICY_VERSION,
    layer: "topological_sign",
    status: residual <= tolerance ? "satisfied" : "violated",
    residual,
    tolerance,
    scale: Math.max(lu, lv)
  }
}

export function scaledTolerance(values: readonly number[], policy: NumericPolicy = defaultNumericPolicy): number {
  if (!allFinite(values)) throw new Error("numeric inputs must be finite")
  const scale = Math.max(1, ...values.map((value) => Math.abs(value)))
  return Math.max(policy.absoluteTolerance, policy.relativeTolerance * scale)
}

export function nearlyZero(value: number, scaleValues: readonly number[], policy: NumericPolicy = defaultNumericPolicy): boolean {
  return Math.abs(value) <= scaledTolerance([value, ...scaleValues], policy)
}

export function nearlyEqual(first: number, second: number, policy: NumericPolicy = defaultNumericPolicy): boolean {
  return Math.abs(first - second) <= scaledTolerance([first, second], policy)
}
