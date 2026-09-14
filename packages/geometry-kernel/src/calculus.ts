export interface FunctionSamplePoint {
  x: number
  y: number
}

export interface AdaptiveSamplingOptions {
  initialSteps?: number
  maxSteps?: number
  tolerance?: number
  maxDepth?: number
}

function isDiscontinuousInterval(functionValue: (x: number) => number, first: FunctionSamplePoint, second: FunctionSamplePoint): boolean {
  const quarter = (first.x * 3 + second.x) / 4
  const midpoint = (first.x + second.x) / 2
  const threeQuarter = (first.x + second.x * 3) / 4
  const probes = [quarter, midpoint, threeQuarter].map((x) => functionValue(x))
  if (probes.some((value) => !Number.isFinite(value))) return true
  const endpointScale = Math.max(1, Math.abs(first.y), Math.abs(second.y))
  return first.y * second.y < 0 && Math.max(...probes.map((value) => Math.abs(value))) > endpointScale * 3
}

function segmentsFromSamples(functionValue: (x: number) => number, samples: Array<FunctionSamplePoint | null>): FunctionSamplePoint[][] {
  const segments: { x: number; y: number }[][] = []
  let segment: { x: number; y: number }[] = []
  let previousPoint: { x: number; y: number } | null = null
  const finishSegment = () => {
    if (segment.length) segments.push(segment)
    segment = []
  }
  for (const point of samples) {
    if (!point) {
      finishSegment()
      previousPoint = null
      continue
    }
    if (previousPoint && isDiscontinuousInterval(functionValue, previousPoint, point)) finishSegment()
    segment.push(point)
    previousPoint = point
  }
  finishSegment()
  return segments
}

export function sampleFunctionSegments(functionValue: (x: number) => number, domain: [number, number], steps = 128): FunctionSamplePoint[][] {
  const samples: Array<FunctionSamplePoint | null> = []
  for (let index = 0; index <= steps; index += 1) {
    const x = domain[0] + (domain[1] - domain[0]) * index / steps
    const y = functionValue(x)
    samples.push(Number.isFinite(y) ? { x, y } : null)
  }
  return segmentsFromSamples(functionValue, samples)
}

export function adaptiveSampleFunctionSegments(functionValue: (x: number) => number, domain: [number, number], options: AdaptiveSamplingOptions = {}): FunctionSamplePoint[][] {
  const initialSteps = Math.max(2, Math.min(2048, Math.floor(options.initialSteps ?? 32)))
  const maxSteps = Math.max(initialSteps + 1, Math.min(8192, Math.floor(options.maxSteps ?? 2048)))
  const tolerance = Math.max(0.0001, Math.min(1, options.tolerance ?? 0.02))
  const maxDepth = Math.max(1, Math.min(16, Math.floor(options.maxDepth ?? 10)))
  const cache = new Map<number, FunctionSamplePoint | null>()
  let evaluations = 0
  const evaluate = (x: number): FunctionSamplePoint | null => {
    if (cache.has(x)) return cache.get(x) ?? null
    if (evaluations >= maxSteps) return null
    evaluations += 1
    let y: number
    try { y = functionValue(x) } catch { y = Number.NaN }
    const point = Number.isFinite(y) ? { x, y } : null
    cache.set(x, point)
    return point
  }
  type Sample = FunctionSamplePoint | null
  const shouldRefine = (first: Sample, midpoint: Sample, second: Sample): boolean => {
    if (!first || !midpoint || !second) return true
    const linear = (first.y + second.y) / 2
    const scale = Math.max(1, Math.abs(first.y), Math.abs(midpoint.y), Math.abs(second.y))
    return Math.abs(midpoint.y - linear) / scale > tolerance
  }
  const refine = (first: Sample, second: Sample, depth: number): Sample[] => {
    if (depth >= maxDepth || evaluations >= maxSteps) return [first, second]
    const midpointX = first && second ? (first.x + second.x) / 2 : null
    if (midpointX === null) return [first, second]
    const midpoint = evaluate(midpointX)
    if (!shouldRefine(first, midpoint, second)) return [first, second]
    const left = refine(first, midpoint, depth + 1)
    const right = refine(midpoint, second, depth + 1)
    return [...left.slice(0, -1), ...right]
  }
  const samples: Sample[] = []
  for (let index = 0; index < initialSteps; index += 1) {
    const first = evaluate(domain[0] + (domain[1] - domain[0]) * index / initialSteps)
    const second = evaluate(domain[0] + (domain[1] - domain[0]) * (index + 1) / initialSteps)
    const refined = refine(first, second, 0)
    samples.push(...(index === 0 ? refined : refined.slice(1)))
  }
  return segmentsFromSamples(functionValue, samples)
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
