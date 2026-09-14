export function sampleFunctionSegments(functionValue: (x: number) => number, domain: [number, number], steps = 128): { x: number; y: number }[][] {
  const segments: { x: number; y: number }[][] = []
  let segment: { x: number; y: number }[] = []
  let previousPoint: { x: number; y: number } | null = null
  const finishSegment = () => {
    if (segment.length) segments.push(segment)
    segment = []
  }
  const isDiscontinuousInterval = (first: { x: number; y: number }, second: { x: number; y: number }) => {
    const quarter = (first.x * 3 + second.x) / 4
    const midpoint = (first.x + second.x) / 2
    const threeQuarter = (first.x + second.x * 3) / 4
    const probes = [quarter, midpoint, threeQuarter].map((x) => functionValue(x))
    if (probes.some((value) => !Number.isFinite(value))) return true
    const endpointScale = Math.max(1, Math.abs(first.y), Math.abs(second.y))
    return first.y * second.y < 0 && Math.max(...probes.map((value) => Math.abs(value))) > endpointScale * 3
  }
  for (let index = 0; index <= steps; index += 1) {
    const x = domain[0] + (domain[1] - domain[0]) * index / steps
    const y = functionValue(x)
    if (!Number.isFinite(y)) {
      finishSegment()
      previousPoint = null
      continue
    }
    const point = { x, y }
    if (previousPoint && isDiscontinuousInterval(previousPoint, point)) finishSegment()
    segment.push(point)
    previousPoint = point
  }
  finishSegment()
  return segments
}

export function sampleFunction(functionValue: (x: number) => number, domain: [number, number], steps = 128): { x: number; y: number }[] {
  return sampleFunctionSegments(functionValue, domain, steps).flat()
}

export function numericalDerivative(functionValue: (x: number) => number, x: number, step = 1e-5): number {
  return (functionValue(x + step) - functionValue(x - step)) / (2 * step)
}

export function numericalIntegral(functionValue: (x: number) => number, domain: [number, number], steps = 256): number {
  const width = (domain[1] - domain[0]) / steps
  let sum = 0
  for (let index = 0; index <= steps; index += 1) {
    const value = functionValue(domain[0] + index * width)
    if (!Number.isFinite(value)) return Number.NaN
    sum += value * (index === 0 || index === steps ? 0.5 : 1)
  }
  return sum * width
}
