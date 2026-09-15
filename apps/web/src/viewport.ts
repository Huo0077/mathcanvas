import type { Coordinate } from "@draw/dsl"

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

/** Grid lines every `step` world units, with the step growing as the canvas zooms out so the grid never
 * collapses into a solid block (roughly one line per 28 screen pixels or more). */
export function gridStep(scale: number, minimumSpacing = 28): number {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]
  return steps.find((step) => step * scale >= minimumSpacing) ?? steps[steps.length - 1]
}

export function rayToViewport(ray: { a: Coordinate; b: Coordinate }, bounds: WorldBounds): { a: Coordinate; b: Coordinate } {
  const length = Math.hypot(ray.b.x - ray.a.x, ray.b.y - ray.a.y)
  if (!Number.isFinite(length) || length === 0) return { a: ray.a, b: ray.b }
  const unit = { x: (ray.b.x - ray.a.x) / length, y: (ray.b.y - ray.a.y) / length }
  const limits = [
    unit.x > 0 ? (bounds.maxX - ray.a.x) / unit.x : Infinity,
    unit.x < 0 ? (bounds.minX - ray.a.x) / unit.x : Infinity,
    unit.y > 0 ? (bounds.maxY - ray.a.y) / unit.y : Infinity,
    unit.y < 0 ? (bounds.minY - ray.a.y) / unit.y : Infinity
  ].filter((value) => value >= 0 && Number.isFinite(value))
  const distance = Math.min(...limits, 20)
  return { a: ray.a, b: { x: ray.a.x + unit.x * distance, y: ray.a.y + unit.y * distance } }
}

export const WORLD_SCALE = scale
