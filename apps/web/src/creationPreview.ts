import type { Coordinate, PrimitiveSpec } from "@draw/dsl"

import type { CreationStep } from "./draftingCommands"

/**
 * 2D 多步创建的**橡皮筋预览 + 磁吸**（UI/UX 优化规格 §细节手感）。
 *
 * 纯函数：只回答"该画什么"和"该吸到哪"，不碰 React / DOM，所以单测可以直接喂数据。
 * 渲染在 `GraphicsView` 里，那一层 `pointer-events: none`，不参与任何拾取。
 */

/** 磁吸半径（屏幕像素）：与点的命中区（`r=12`）同一档，"看得见能点中"与"会吸过去"一致。 */
export const SNAP_RADIUS_PX = 12

const POINT_LIKE = new Set(["point", "intersection", "lineCircleIntersection", "circleIntersection", "curveIntersection"])

/** 画布上可作为吸附目标的点：自由点、各类交点、交点集合里的每个解，以及交点预览。 */
export function snapCandidatesOf(primitives: readonly PrimitiveSpec[], previews: readonly { point: Coordinate }[] = []): Coordinate[] {
  const candidates: Coordinate[] = []
  for (const primitive of primitives) {
    if (primitive.visible === false) continue
    if (POINT_LIKE.has(primitive.type)) {
      const point = primitive as unknown as Coordinate
      if (Number.isFinite(point.x) && Number.isFinite(point.y)) candidates.push({ x: point.x, y: point.y })
    } else if (primitive.type === "intersectionSet") {
      for (const point of primitive.points) candidates.push({ x: point.x, y: point.y })
    }
  }
  for (const preview of previews) candidates.push({ x: preview.point.x, y: preview.point.y })
  return candidates
}

/**
 * 指针附近（屏幕距离 ≤ `radiusPx`）最近的吸附点；没有就返回 null。
 * `scale` 是视口的"每世界单位多少像素"，世界距离乘它就是屏幕距离。
 */
export function creationSnapTarget(candidates: readonly Coordinate[], pointer: Coordinate, scale: number, radiusPx = SNAP_RADIUS_PX): Coordinate | null {
  let best: Coordinate | null = null
  let bestDistance = radiusPx
  for (const candidate of candidates) {
    const distance = Math.hypot(candidate.x - pointer.x, candidate.y - pointer.y) * scale
    if (distance <= bestDistance) { best = candidate; bestDistance = distance }
  }
  return best
}

export type CreationPreviewShape =
  | { kind: "anchor"; point: Coordinate }
  | { kind: "segment"; a: Coordinate; b: Coordinate }
  | { kind: "circle"; center: Coordinate; radius: number }
  | { kind: "arc"; center: Coordinate; radius: number; startAngle: number; endAngle: number }
  | { kind: "polyline"; points: Coordinate[] }
  | { kind: "label"; at: Coordinate; text: string }

/**
 * 给定"已经放下的点"与当前指针，算出要画的预览图形（世界坐标）。
 * `reach` 是直线 / 射线向外延伸的世界长度（取可见范围对角线即可，SVG 会自己裁掉）。
 */
export function creationPreviewShapes(step: CreationStep | null | undefined, pointer: Coordinate | null, reach: number): CreationPreviewShape[] {
  if (!step) return []
  if (step.mode === "polyline") {
    const placed = step.points ?? []
    if (placed.length === 0) return pointer ? [{ kind: "anchor", point: pointer }] : []
    const shapes: CreationPreviewShape[] = placed.map((point) => ({ kind: "anchor", point }))
    shapes.push({ kind: "polyline", points: pointer ? [...placed, pointer] : [...placed] })
    return shapes
  }
  if (step.mode === "point") {
    return pointer ? [{ kind: "anchor", point: pointer }] : []
  }
  const center = step.center
  if (!center) return pointer ? [{ kind: "anchor", point: pointer }] : []
  const shapes: CreationPreviewShape[] = [{ kind: "anchor", point: center }]
  if (!pointer) return shapes
  const dx = pointer.x - center.x
  const dy = pointer.y - center.y
  const length = Math.hypot(dx, dy)
  if (length < 1e-9) return shapes
  const ux = dx / length
  const uy = dy / length
  const mid = { x: (center.x + pointer.x) / 2, y: (center.y + pointer.y) / 2 }
  switch (step.mode) {
    case "segment":
      shapes.push({ kind: "segment", a: center, b: pointer }, { kind: "label", at: mid, text: `长度 ${length.toFixed(2)}` })
      break
    case "line":
      shapes.push({ kind: "segment", a: { x: center.x - ux * reach, y: center.y - uy * reach }, b: { x: center.x + ux * reach, y: center.y + uy * reach } })
      break
    case "ray":
      shapes.push({ kind: "segment", a: center, b: { x: center.x + ux * reach, y: center.y + uy * reach } })
      break
    case "circle":
      shapes.push({ kind: "segment", a: center, b: pointer }, { kind: "circle", center, radius: length }, { kind: "label", at: mid, text: `r = ${length.toFixed(2)}` })
      break
    case "arc": {
      if (!step.start) {
        shapes.push({ kind: "segment", a: center, b: pointer }, { kind: "label", at: mid, text: `r = ${length.toFixed(2)}` })
        break
      }
      const radius = Math.hypot(step.start.x - center.x, step.start.y - center.y)
      if (radius < 1e-9) break
      const startAngle = Math.atan2(step.start.y - center.y, step.start.x - center.x)
      const endAngle = Math.atan2(dy, dx)
      shapes.push({ kind: "anchor", point: step.start }, { kind: "arc", center, radius, startAngle, endAngle })
      break
    }
  }
  return shapes
}
