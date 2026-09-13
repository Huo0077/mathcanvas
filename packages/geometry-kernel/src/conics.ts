import type { Coordinate, EllipsePrimitive, HyperbolaPrimitive, ParabolaPrimitive } from "@draw/dsl"

function rotateAround(point: Coordinate, center: Coordinate, rotation: number): Coordinate {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const x = point.x - center.x
  const y = point.y - center.y
  return { x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos }
}

export function sampleParabola(parabola: ParabolaPrimitive, domain: [number, number], steps = 64): Coordinate[] {
  const points: Coordinate[] = []
  for (let index = 0; index <= steps; index += 1) {
    const parameter = domain[0] + (domain[1] - domain[0]) * index / steps
    const value = parameter * parameter / (2 * parabola.focalParameter)
    const local = parabola.axis === "x" ? { x: parabola.vertex.x + value, y: parabola.vertex.y + parameter } : { x: parabola.vertex.x + parameter, y: parabola.vertex.y + value }
    points.push(rotateAround(local, parabola.vertex, parabola.rotation ?? 0))
  }
  return points
}

export function sampleEllipse(ellipse: EllipsePrimitive, steps = 128): Coordinate[] {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = Math.PI * 2 * index / steps
    return rotateAround({ x: ellipse.center.x + ellipse.radiusX * Math.cos(angle), y: ellipse.center.y + ellipse.radiusY * Math.sin(angle) }, ellipse.center, ellipse.rotation ?? 0)
  })
}

export function sampleHyperbola(hyperbola: HyperbolaPrimitive, domain: [number, number], steps = 64): Coordinate[] {
  const points: Coordinate[] = []
  for (let index = 0; index <= steps; index += 1) {
    const parameter = domain[0] + (domain[1] - domain[0]) * index / steps
    const value = hyperbola.radiusY * Math.sqrt(1 + (parameter * parameter) / (hyperbola.radiusX * hyperbola.radiusX))
    const local = hyperbola.axis === "x" ? { x: hyperbola.center.x + parameter, y: hyperbola.center.y + value } : { x: hyperbola.center.x + value, y: hyperbola.center.y + parameter }
    points.push(rotateAround(local, hyperbola.center, hyperbola.rotation ?? 0))
  }
  return points
}
