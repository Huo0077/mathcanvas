export interface NumericPolicy {
  absoluteTolerance: number
  relativeTolerance: number
}

export const defaultNumericPolicy: Readonly<NumericPolicy> = Object.freeze({
  absoluteTolerance: 1e-12,
  relativeTolerance: 1e-11
})

export function allFinite(values: readonly number[]): boolean {
  return values.every(Number.isFinite)
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
