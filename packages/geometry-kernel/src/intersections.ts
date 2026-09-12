import type { CirclePrimitive, Coordinate, LinePrimitive } from "@draw/dsl"

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

export function intersectLineCircle(line: LinePrimitive, circle: CirclePrimitive): Coordinate[] {
  const direction = { x: line.b.x - line.a.x, y: line.b.y - line.a.y }
  const offset = { x: line.a.x - circle.center.x, y: line.a.y - circle.center.y }
  const quadraticA = direction.x * direction.x + direction.y * direction.y
  if (quadraticA < 1e-12) return []
  const quadraticB = 2 * (offset.x * direction.x + offset.y * direction.y)
  const quadraticC = offset.x * offset.x + offset.y * offset.y - circle.radius * circle.radius
  const discriminant = quadraticB * quadraticB - 4 * quadraticA * quadraticC
  if (discriminant < -1e-9) return []
  if (Math.abs(discriminant) < 1e-9) {
    const parameter = -quadraticB / (2 * quadraticA)
    return [{ x: line.a.x + parameter * direction.x, y: line.a.y + parameter * direction.y }]
  }
  const root = Math.sqrt(discriminant)
  const firstParameter = (-quadraticB - root) / (2 * quadraticA)
  const secondParameter = (-quadraticB + root) / (2 * quadraticA)
  return [firstParameter, secondParameter].map((parameter) => ({
    x: line.a.x + parameter * direction.x,
    y: line.a.y + parameter * direction.y
  }))
}

export function intersectCircles(first: CirclePrimitive, second: CirclePrimitive): Coordinate[] {
  const delta = { x: second.center.x - first.center.x, y: second.center.y - first.center.y }
  const distance = Math.hypot(delta.x, delta.y)
  if (distance < 1e-9 || distance > first.radius + second.radius + 1e-9 || distance < Math.abs(first.radius - second.radius) - 1e-9) return []
  const along = (first.radius * first.radius - second.radius * second.radius + distance * distance) / (2 * distance)
  const heightSquared = first.radius * first.radius - along * along
  const midpoint = { x: first.center.x + (along * delta.x) / distance, y: first.center.y + (along * delta.y) / distance }
  if (Math.abs(heightSquared) < 1e-9) return [midpoint]
  if (heightSquared < 0) return []
  const height = Math.sqrt(heightSquared)
  const perpendicular = { x: (-delta.y * height) / distance, y: (delta.x * height) / distance }
  return [
    { x: midpoint.x + perpendicular.x, y: midpoint.y + perpendicular.y },
    { x: midpoint.x - perpendicular.x, y: midpoint.y - perpendicular.y }
  ]
}
