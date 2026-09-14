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

export type NumericalAnalysisKind = "zero" | "maximum" | "minimum" | "inflection"

export interface NumericalAnalysisPoint extends FunctionSamplePoint {
  kind: NumericalAnalysisKind
  approximate: true
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

function appendAnalysisPoint(points: NumericalAnalysisPoint[], point: NumericalAnalysisPoint): void {
  if (!points.some((candidate) => candidate.kind === point.kind && Math.abs(candidate.x - point.x) < 1e-5)) points.push(point)
}

function analysisSamples(functionValue: (x: number) => number, domain: [number, number], steps: number): FunctionSamplePoint[][] {
  return adaptiveSampleFunctionSegments(functionValue, domain, { initialSteps: steps, maxSteps: Math.max(steps + 1, steps * 8) })
}

function bisectZero(functionValue: (x: number) => number, first: FunctionSamplePoint, second: FunctionSamplePoint): FunctionSamplePoint | null {
  if (first.y === 0) return first
  if (second.y === 0) return second
  if (first.y * second.y > 0) return null
  let left = first
  let right = second
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const midpointX = (left.x + right.x) / 2
    let midpointY: number
    try { midpointY = functionValue(midpointX) } catch { return null }
    if (!Number.isFinite(midpointY)) return null
    const midpoint = { x: midpointX, y: midpointY }
    if (Math.abs(midpointY) < 1e-10 || Math.abs(right.x - left.x) < 1e-8) return midpoint
    if (left.y * midpointY <= 0) right = midpoint
    else left = midpoint
  }
  const x = (left.x + right.x) / 2
  let y: number
  try { y = functionValue(x) } catch { return null }
  return Number.isFinite(y) ? { x, y } : null
}

export function findZeros(functionValue: (x: number) => number, domain: [number, number], steps = 128): NumericalAnalysisPoint[] {
  const points: NumericalAnalysisPoint[] = []
  for (const segment of analysisSamples(functionValue, domain, steps)) {
    for (const point of segment) {
      if (point.y === 0) appendAnalysisPoint(points, { ...point, kind: "zero", approximate: true })
    }
    for (let index = 1; index < segment.length; index += 1) {
      const zero = bisectZero(functionValue, segment[index - 1], segment[index])
      if (zero) appendAnalysisPoint(points, { ...zero, kind: "zero", approximate: true })
    }
  }
  return points.sort((first, second) => first.x - second.x)
}

export function findExtrema(functionValue: (x: number) => number, domain: [number, number], steps = 128): NumericalAnalysisPoint[] {
  const points: NumericalAnalysisPoint[] = []
  for (const segment of analysisSamples(functionValue, domain, steps)) {
    for (let index = 1; index < segment.length - 1; index += 1) {
      const previous = segment[index - 1]
      const current = segment[index]
      const next = segment[index + 1]
      const isMaximum = current.y >= previous.y && current.y >= next.y && (current.y > previous.y || current.y > next.y)
      const isMinimum = current.y <= previous.y && current.y <= next.y && (current.y < previous.y || current.y < next.y)
      if (isMaximum) appendAnalysisPoint(points, { ...current, kind: "maximum", approximate: true })
      if (isMinimum) appendAnalysisPoint(points, { ...current, kind: "minimum", approximate: true })
    }
  }
  return points.sort((first, second) => first.x - second.x)
}

export function findInflectionPoints(functionValue: (x: number) => number, domain: [number, number], steps = 128): NumericalAnalysisPoint[] {
  const points: NumericalAnalysisPoint[] = []
  const secondDerivative = (x: number) => numericalSecondDerivative(functionValue, x)
  for (const segment of analysisSamples(functionValue, domain, steps)) {
    const values = segment.map((point) => ({ point, second: secondDerivative(point.x) }))
    for (let index = 1; index < values.length; index += 1) {
      const previous = values[index - 1]
      const current = values[index]
      if (current.second === 0) appendAnalysisPoint(points, { ...current.point, kind: "inflection", approximate: true })
      if (previous.second * current.second < 0) {
        const zero = bisectZero(secondDerivative, { x: previous.point.x, y: previous.second }, { x: current.point.x, y: current.second })
        if (zero) {
          let y: number
          try { y = functionValue(zero.x) } catch { y = Number.NaN }
          if (Number.isFinite(y)) appendAnalysisPoint(points, { x: zero.x, y, kind: "inflection", approximate: true })
        }
      }
    }
  }
  return points.sort((first, second) => first.x - second.x)
}

export function sampleFunction(functionValue: (x: number) => number, domain: [number, number], steps = 128): { x: number; y: number }[] {
  return sampleFunctionSegments(functionValue, domain, steps).flat()
}

export function numericalDerivative(functionValue: (x: number) => number, x: number, step = 1e-5): number {
  if (!Number.isFinite(x) || !Number.isFinite(step) || step <= 0) return Number.NaN
  try {
    const forward = functionValue(x + step)
    const backward = functionValue(x - step)
    return Number.isFinite(forward) && Number.isFinite(backward) ? (forward - backward) / (2 * step) : Number.NaN
  } catch {
    return Number.NaN
  }
}

export function numericalSecondDerivative(functionValue: (x: number) => number, x: number, step = 1e-4): number {
  if (!Number.isFinite(x) || !Number.isFinite(step) || step <= 0) return Number.NaN
  try {
    const center = functionValue(x)
    const forward = functionValue(x + step)
    const backward = functionValue(x - step)
    return Number.isFinite(center) && Number.isFinite(forward) && Number.isFinite(backward)
      ? (forward - 2 * center + backward) / (step ** 2)
      : Number.NaN
  } catch {
    return Number.NaN
  }
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
