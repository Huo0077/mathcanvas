import type { GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { isSampledPrimitiveType } from "@draw/dsl"
import { intersectCirclesDetailed, intersectLineCircleDetailed, intersectLinesDetailed, intersectSampledPrimitives, type IntersectionResult, type SampledPrimitive } from "@draw/geometry-kernel"

export interface IntersectionPreview {
  objectA: string
  objectB: string
  point: { x: number; y: number }
  solutionIndex: number
  approximate: boolean
}

function isSampledPrimitive(primitive: PrimitiveSpec): primitive is SampledPrimitive {
  return isSampledPrimitiveType(primitive.type)
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

export interface IntersectionPreviewResult {
  previews: IntersectionPreview[]
  /** 本次真正重算的图元对数量（增量时远小于全量）。 */
  recomputedPairs: number
  /** 直接从 `previous` 沿用的交点数。 */
  reusedPreviews: number
}

export interface IntersectionPreviewOptions {
  /**
   * 只有与这些 id 相关的图元对需要重算，其余从 `previous` 里沿用。
   *
   * 拖动一个动点时用 `getAffectedPrimitiveIds(document, [拖动的 id])` 作为这个集合：
   * 一次 pointermove 里最贵的就是全文档两两求交（实测 52 个图元 / 6 条采样曲线 = 48.8ms，
   * 而拖动预览的其它步骤加起来不到 0.5ms）。拖动只改一个图元，其余交点带上一次的结果即可。
   */
  recomputeFor?: ReadonlySet<string>
  /** 上一次的结果（增量模式的基准）。 */
  previous?: readonly IntersectionPreview[]
}

/**
 * 算出当前文档里所有可点击的交点预览。
 *
 * 给了 `recomputeFor` + `previous` 时走**增量**：与改动无关的图元对直接沿用上一次的交点，
 * 只有与改动相关的对才重新采样求交。没给就是全量计算。
 */
export function computeIntersectionPreviews(document: GeometryDocument, options: IntersectionPreviewOptions = {}): IntersectionPreviewResult {
  const candidates = document.primitives.filter((primitive): primitive is SampledPrimitive => primitive.visible !== false && isSampledPrimitive(primitive))
  const recomputeFor = options.recomputeFor
  const incremental = Boolean(recomputeFor && options.previous)
  /**
   * 增量模式：把上一次的交点按"图元对"归好，逐对决定沿用还是重算。
   * 这样输出顺序与全量计算完全一致（便于断言与稳定渲染），
   * 而且隐藏/删除掉的图元对会自然消失——不会留下过期的交点。
   */
  const keptByPair = new Map<string, IntersectionPreview[]>()
  const pairKey = (first: string, second: string) => (first < second ? `${first}::${second}` : `${second}::${first}`)
  if (incremental) {
    for (const preview of options.previous!) {
      const key = pairKey(preview.objectA, preview.objectB)
      const kept = keptByPair.get(key)
      if (kept) kept.push(preview)
      else keptByPair.set(key, [preview])
    }
  }
  const previews: IntersectionPreview[] = []
  let recomputedPairs = 0
  let reusedPreviews = 0
  for (let firstIndex = 0; firstIndex < candidates.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < candidates.length; secondIndex += 1) {
      const first = candidates[firstIndex]
      const second = candidates[secondIndex]
      if (incremental && !recomputeFor!.has(first.id) && !recomputeFor!.has(second.id)) {
        const kept = keptByPair.get(pairKey(first.id, second.id))
        if (kept) {
          previews.push(...kept)
          reusedPreviews += kept.length
        }
        continue
      }
      recomputedPairs += 1
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
  return { previews, recomputedPairs, reusedPreviews }
}

export function getIntersectionPreviews(document: GeometryDocument): IntersectionPreview[] {
  return computeIntersectionPreviews(document).previews
}
