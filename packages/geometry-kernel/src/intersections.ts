import type { Coordinate, LinePrimitive } from "@draw/dsl"

export function intersectLines(first: LinePrimitive, second: LinePrimitive): Coordinate | null {
  const x1 = first.a.x
  const y1 = first.a.y
  const x2 = first.b.x
  const y2 = first.b.y
  const x3 = second.a.x
  const y3 = second.a.y
  const x4 = second.b.x
  const y4 = second.b.y
  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
  if (Math.abs(denominator) < 1e-9) return null
  const determinantA = x1 * y2 - y1 * x2
  const determinantB = x3 * y4 - y3 * x4
  return {
    x: (determinantA * (x3 - x4) - (x1 - x2) * determinantB) / denominator,
    y: (determinantA * (y3 - y4) - (y1 - y2) * determinantB) / denominator
  }
}
