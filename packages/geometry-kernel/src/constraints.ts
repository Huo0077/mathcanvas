import type { ConstraintSpec, LinePrimitive } from "@draw/dsl"

function direction(line: LinePrimitive): { x: number; y: number; length: number } {
  const x = line.b.x - line.a.x
  const y = line.b.y - line.a.y
  return { x, y, length: Math.hypot(x, y) }
}

function oriented(unit: { x: number; y: number }, reference: { x: number; y: number }): { x: number; y: number } {
  return unit.x * reference.x + unit.y * reference.y < 0 ? { x: -unit.x, y: -unit.y } : unit
}

export function projectLineConstraint(first: LinePrimitive, second: LinePrimitive, type: ConstraintSpec["type"]): LinePrimitive {
  const firstDirection = direction(first)
  const secondDirection = direction(second)
  if (firstDirection.length < 1e-12 || secondDirection.length < 1e-12) return second

  const firstUnit = { x: firstDirection.x / firstDirection.length, y: firstDirection.y / firstDirection.length }
  const currentSecondUnit = { x: secondDirection.x / secondDirection.length, y: secondDirection.y / secondDirection.length }
  const targetUnit = type === "perpendicular" ? { x: -firstUnit.y, y: firstUnit.x } : firstUnit
  const projectedUnit = oriented(targetUnit, currentSecondUnit)
  const center = { x: (second.a.x + second.b.x) / 2, y: (second.a.y + second.b.y) / 2 }
  const projectedCenter = type === "coincident"
    ? {
        x: first.a.x + firstUnit.x * ((center.x - first.a.x) * firstUnit.x + (center.y - first.a.y) * firstUnit.y),
        y: first.a.y + firstUnit.y * ((center.x - first.a.x) * firstUnit.x + (center.y - first.a.y) * firstUnit.y)
      }
    : center
  const halfLength = secondDirection.length / 2

  return {
    ...second,
    a: { x: projectedCenter.x - projectedUnit.x * halfLength, y: projectedCenter.y - projectedUnit.y * halfLength },
    b: { x: projectedCenter.x + projectedUnit.x * halfLength, y: projectedCenter.y + projectedUnit.y * halfLength }
  }
}
