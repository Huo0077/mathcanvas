export interface FunctionGraphPoint {
  x: number
  y: number
}

export interface FunctionGraphBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

function samePoint(first: FunctionGraphPoint, second: FunctionGraphPoint): boolean {
  return Math.abs(first.x - second.x) < 1e-12 && Math.abs(first.y - second.y) < 1e-12
}

function clipSegment(first: FunctionGraphPoint, second: FunctionGraphPoint, bounds: FunctionGraphBounds): [FunctionGraphPoint, FunctionGraphPoint] | null {
  const deltaX = second.x - first.x
  const deltaY = second.y - first.y
  let entry = 0
  let exit = 1
  for (const [coefficient, constant] of [[-deltaX, first.x - bounds.minX], [deltaX, bounds.maxX - first.x], [-deltaY, first.y - bounds.minY], [deltaY, bounds.maxY - first.y]] as const) {
    if (coefficient === 0) {
      if (constant < 0) return null
      continue
    }
    const ratio = constant / coefficient
    if (coefficient < 0) entry = Math.max(entry, ratio)
    else exit = Math.min(exit, ratio)
    if (entry > exit) return null
  }
  return [
    { x: first.x + entry * deltaX, y: first.y + entry * deltaY },
    { x: first.x + exit * deltaX, y: first.y + exit * deltaY }
  ]
}

function isVerticalDiscontinuity(first: FunctionGraphPoint, second: FunctionGraphPoint, clipped: [FunctionGraphPoint, FunctionGraphPoint], bounds: FunctionGraphBounds): boolean {
  const crossesViewport = (first.y < bounds.minY && second.y > bounds.maxY) || (first.y > bounds.maxY && second.y < bounds.minY)
  if (!crossesViewport) return false
  const clippedWidth = Math.abs(clipped[1].x - clipped[0].x)
  const viewportWidth = bounds.maxX - bounds.minX
  return clippedWidth <= viewportWidth * 0.1 && Math.abs(second.y - first.y) >= (bounds.maxY - bounds.minY) * 4
}

export function clipFunctionSegmentsToBounds(segments: FunctionGraphPoint[][], bounds: FunctionGraphBounds): FunctionGraphPoint[][] {
  const clippedSegments: FunctionGraphPoint[][] = []
  for (const segment of segments) {
    let current: FunctionGraphPoint[] = []
    for (let index = 1; index < segment.length; index += 1) {
      const clipped = clipSegment(segment[index - 1], segment[index], bounds)
      if (!clipped || isVerticalDiscontinuity(segment[index - 1], segment[index], clipped, bounds)) {
        if (current.length > 1) clippedSegments.push(current)
        current = []
        continue
      }
      const [start, end] = clipped
      if (!current.length || !samePoint(current.at(-1)!, start)) {
        if (current.length > 1) clippedSegments.push(current)
        current = [start]
      }
      if (!samePoint(current.at(-1)!, end)) current.push(end)
    }
    if (current.length > 1) clippedSegments.push(current)
  }
  return clippedSegments
}
