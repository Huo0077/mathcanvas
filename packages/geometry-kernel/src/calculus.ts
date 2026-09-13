export function sampleFunctionSegments(functionValue: (x: number) => number, domain: [number, number], steps = 128): { x: number; y: number }[][] {
  const segments: { x: number; y: number }[][] = []
  let segment: { x: number; y: number }[] = []
  for (let index = 0; index <= steps; index += 1) {
    const x = domain[0] + (domain[1] - domain[0]) * index / steps
    const y = functionValue(x)
    if (Number.isFinite(y)) segment.push({ x, y })
    else if (segment.length) {
      segments.push(segment)
      segment = []
    }
  }
  if (segment.length) segments.push(segment)
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
