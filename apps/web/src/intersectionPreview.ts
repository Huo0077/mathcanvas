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

/** 预览的命中半径（SVG 用户单位；画布 viewBox 固定，所以约等于屏幕像素）。 */
export const PREVIEW_HIT_RADIUS = 14

/**
 * 在多个预览里按**屏幕像素距离**就近取一个：两个解挨得很近（或完全重合）时，
 * 选中谁不再由 DOM 绘制顺序决定，而是"离光标最近的那个"。
 * `project` 由调用方提供（视口的 world → screen 换算），容差之外返回 null。
 */
export function nearestPreview<T extends { point: { x: number; y: number } }>(
  previews: T[],
  click: { x: number; y: number },
  project: (point: { x: number; y: number }) => { x: number; y: number },
  radius = PREVIEW_HIT_RADIUS
): T | null {
  let best: { preview: T; distance: number } | null = null
  for (const preview of previews) {
    const screen = project(preview.point)
    const distance = Math.hypot(screen.x - click.x, screen.y - click.y)
    if (distance > radius) continue
    if (!best || distance < best.distance) best = { preview, distance }
  }
  return best?.preview ?? null
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
