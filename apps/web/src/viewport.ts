import type { Coordinate } from "@draw/dsl"

import { GRID_CELL } from "./sceneGrid"

export const VIEWBOX = { width: 800, height: 440, left: 40, right: 760, top: 20, bottom: 420 }
export const WORLD_BOUNDS = { minX: -10, maxX: 10, minY: -6, maxY: 6 }
const scale = Math.min(
  (VIEWBOX.right - VIEWBOX.left) / (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX),
  (VIEWBOX.bottom - VIEWBOX.top) / (WORLD_BOUNDS.maxY - WORLD_BOUNDS.minY)
)
const svgCenter = { x: (VIEWBOX.left + VIEWBOX.right) / 2, y: (VIEWBOX.top + VIEWBOX.bottom) / 2 }

export interface Viewport {
  center: Coordinate
  scale: number
}

export interface WorldBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export const DEFAULT_VIEWPORT: Viewport = { center: { x: 0, y: 0 }, scale }

export function worldToSvg(point: Coordinate, viewport: Viewport = DEFAULT_VIEWPORT): Coordinate {
  return { x: svgCenter.x + (point.x - viewport.center.x) * viewport.scale, y: svgCenter.y - (point.y - viewport.center.y) * viewport.scale }
}

export function svgToWorld(point: Coordinate, viewport: Viewport = DEFAULT_VIEWPORT): Coordinate {
  const normalize = (value: number) => Math.round(value * 1e12) / 1e12
  return { x: normalize(viewport.center.x + (point.x - svgCenter.x) / viewport.scale), y: normalize(viewport.center.y + (svgCenter.y - point.y) / viewport.scale) }
}

export function visibleWorldBounds(viewport: Viewport = DEFAULT_VIEWPORT) {
  const halfWidth = (VIEWBOX.right - VIEWBOX.left) / (2 * viewport.scale)
  const halfHeight = (VIEWBOX.bottom - VIEWBOX.top) / (2 * viewport.scale)
  return { minX: viewport.center.x - halfWidth, maxX: viewport.center.x + halfWidth, minY: viewport.center.y - halfHeight, maxY: viewport.center.y + halfHeight }
}

/** Zoom is expressed as a multiple of the default scale. 0.05x shows a wide neighbourhood, 40x resolves a
 * single feature; outside that range circles and grid lines either vanish or swamp the canvas. */
export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 40

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/**
 * Zoom about a screen anchor so the world point under the pointer stays under the pointer — the behaviour users
 * expect from a wheel zoom. `zoomViewport` is the same operation anchored at the middle of the canvas.
 */
export function zoomViewportAt(viewport: Viewport, factor: number, anchorSvg: Coordinate): Viewport {
  const scale = DEFAULT_VIEWPORT.scale * clampZoom((viewport.scale / DEFAULT_VIEWPORT.scale) * factor)
  const anchor = svgToWorld(anchorSvg, viewport)
  return {
    center: { x: anchor.x - (anchorSvg.x - svgCenter.x) / scale, y: anchor.y + (anchorSvg.y - svgCenter.y) / scale },
    scale
  }
}

export function zoomViewport(viewport: Viewport, factor: number, anchorSvg: Coordinate = svgCenter): Viewport {
  return zoomViewportAt(viewport, factor, anchorSvg)
}

/** 平面画布网格线的条数上限：极端缩小理论上会要求上万条线，超过就干脆不画（宁可没有网格，
 * 也不要把画布冻住）。在当前缩放范围（0.05×～40×）内远达不到这个数。 */
export const MAX_GRID_LINES = 4000

/**
 * 网格线位置：`[min, max]` 之间所有 `step` 的整数倍（**世界坐标**）。
 *
 * 用户要求："平面缩放也会导致网格大小变化，我需要固定网格大小"。
 * 因此平面画布的格子**恒为 `GRID_CELL`（= 1）个世界单位**，缩放只改变**可见范围**
 * （看到更多 / 更少的格），与 3D 背景网格完全同一套语义（见 `sceneGrid.ts`）。
 *
 * 旧实现按屏幕像素挑一个"好读"的步长（0.1 / 0.2 / 0.5 / 1 / 2 / 5 / …），于是缩放时
 * **格子本身在变**，网格就不再是一把可靠的尺子。
 *
 * 这里刻意不接受缩放比例：位置只由世界坐标区间与格边长决定，因此"格边长不随缩放变化"
 * 是结构性的，而不是靠约定维持。
 */
export function gridLinePositions(min: number, max: number, step = GRID_CELL): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step) || step <= 0 || max < min) return []
  const first = Math.ceil(min / step) * step
  const count = Math.floor((max - first) / step) + 1
  if (!Number.isFinite(count) || count <= 0 || count > MAX_GRID_LINES) return []
  return Array.from({ length: count }, (_, index) => first + index * step)
}

/**
 * 把射线裁到世界视口矩形上（slab 法）。
 *
 * 旧实现取"到四条边界的最小正距离"，再和常数 20 取 min。起点在视口**之外**时，射线只画 20 个单位
 * 就断了（实测：从 x = −20 向右射出的射线停在视口中间，没有横穿视口）；导出侧还有另一份副本，
 * 把 x 方向写反。现在进入点与离开点一起算：起点在视口外也从整个视口穿过，完全打不到视口时退化成一点。
 */
export function rayToViewport(ray: { a: Coordinate; b: Coordinate }, bounds: WorldBounds): { a: Coordinate; b: Coordinate } {
  const length = Math.hypot(ray.b.x - ray.a.x, ray.b.y - ray.a.y)
  if (!Number.isFinite(length) || length === 0) return { a: ray.a, b: ray.b }
  const unit = { x: (ray.b.x - ray.a.x) / length, y: (ray.b.y - ray.a.y) / length }
  let entry = 0
  let exit = Number.POSITIVE_INFINITY
  for (const [origin, direction, min, max] of [
    [ray.a.x, unit.x, bounds.minX, bounds.maxX],
    [ray.a.y, unit.y, bounds.minY, bounds.maxY]
  ] as const) {
    if (Math.abs(direction) <= 1e-12) {
      // 与该轴平行：落在带外就永远进不去。
      if (origin < min || origin > max) return { a: ray.a, b: ray.a }
      continue
    }
    const first = (min - origin) / direction
    const second = (max - origin) / direction
    entry = Math.max(entry, Math.min(first, second))
    exit = Math.min(exit, Math.max(first, second))
  }
  if (!(exit > entry)) return { a: ray.a, b: ray.a }
  return { a: ray.a, b: { x: ray.a.x + unit.x * exit, y: ray.a.y + unit.y * exit } }
}

export const WORLD_SCALE = scale
