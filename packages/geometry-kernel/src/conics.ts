import type { Coordinate, EllipsePrimitive, HyperbolaPrimitive, ParabolaPrimitive } from "@draw/dsl"

export function sampleParabola(parabola: ParabolaPrimitive, domain: [number, number], steps = 64): Coordinate[] {
  const points: Coordinate[] = []
  for (let index = 0; index <= steps; index += 1) {
    const parameter = domain[0] + (domain[1] - domain[0]) * index / steps
    const value = parameter * parameter / (2 * parabola.focalParameter)
    points.push(parabola.axis === "x" ? { x: parabola.vertex.x + value, y: parabola.vertex.y + parameter } : { x: parabola.vertex.x + parameter, y: parabola.vertex.y + value })
  }
  return points
}

export function sampleEllipse(ellipse: EllipsePrimitive, steps = 128): Coordinate[] {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = Math.PI * 2 * index / steps
    return { x: ellipse.center.x + ellipse.radiusX * Math.cos(angle), y: ellipse.center.y + ellipse.radiusY * Math.sin(angle) }
  })
}

export function sampleHyperbola(hyperbola: HyperbolaPrimitive, domain: [number, number], steps = 64): Coordinate[] {
  const points: Coordinate[] = []
  for (let index = 0; index <= steps; index += 1) {
    const parameter = domain[0] + (domain[1] - domain[0]) * index / steps
    const value = hyperbola.radiusY * Math.sqrt(1 + (parameter * parameter) / (hyperbola.radiusX * hyperbola.radiusX))
    points.push(hyperbola.axis === "x" ? { x: hyperbola.center.x + parameter, y: hyperbola.center.y + value } : { x: hyperbola.center.x + value, y: hyperbola.center.y + parameter })
  }
  return points
}
