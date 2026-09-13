import type { GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { intersectCirclesDetailed, intersectLineCircleDetailed, intersectLinesDetailed, intersectSampledPrimitives, type IntersectionResult, type SampledPrimitive } from "@draw/geometry-kernel"

export interface IntersectionPreview {
  objectA: string
  objectB: string
  point: { x: number; y: number }
  solutionIndex: number
  approximate: boolean
}

const sampledTypes = new Set<PrimitiveSpec["type"]>(["line", "segment", "ray", "polyline", "circle", "arc", "parabola", "ellipse", "hyperbola", "function"])

function isSampledPrimitive(primitive: PrimitiveSpec): primitive is SampledPrimitive {
  return sampledTypes.has(primitive.type)
}

function intersectionPoints(result: IntersectionResult): { x: number; y: number }[] {
  if (result.kind === "point" || result.kind === "tangent") return [result.point]
  return result.kind === "points" ? result.points : []
}

function calculateIntersection(first: SampledPrimitive, second: SampledPrimitive): { points: { x: number; y: number }[]; approximate: boolean } {
  if (first.type === "line" && second.type === "line") return { points: intersectionPoints(intersectLinesDetailed(first, second)), approximate: false }
  if (first.type === "line" && second.type === "circle") return { points: intersectionPoints(intersectLineCircleDetailed(first, second)), approximate: false }
  if (first.type === "circle" && second.type === "line") return { points: intersectionPoints(intersectLineCircleDetailed(second, first)), approximate: false }
  if (first.type === "circle" && second.type === "circle") return { points: intersectionPoints(intersectCirclesDetailed(first, second)), approximate: false }
  return { points: intersectionPoints(intersectSampledPrimitives(first, second)), approximate: true }
}

export function getIntersectionPreviews(document: GeometryDocument): IntersectionPreview[] {
  const candidates = document.primitives.filter((primitive): primitive is SampledPrimitive => primitive.visible !== false && isSampledPrimitive(primitive))
  const previews: IntersectionPreview[] = []
  for (let firstIndex = 0; firstIndex < candidates.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < candidates.length; secondIndex += 1) {
      const first = candidates[firstIndex]
      const second = candidates[secondIndex]
      try {
        const result = calculateIntersection(first, second)
        result.points.forEach((point, solutionIndex) => {
          if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return
          if (previews.some((preview) => preview.objectA === first.id && preview.objectB === second.id && Math.hypot(preview.point.x - point.x, preview.point.y - point.y) < 1e-5)) return
          previews.push({ objectA: first.id, objectB: second.id, point, solutionIndex, approximate: result.approximate })
        })
      } catch {
        continue
      }
    }
  }
  return previews
}
