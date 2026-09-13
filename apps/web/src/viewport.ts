import type { Coordinate } from "@draw/dsl"

export const VIEWBOX = { width: 800, height: 440, left: 40, right: 760, top: 20, bottom: 420 }
export const WORLD_BOUNDS = { minX: -10, maxX: 10, minY: -6, maxY: 6 }
const scale = Math.min(
  (VIEWBOX.right - VIEWBOX.left) / (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX),
  (VIEWBOX.bottom - VIEWBOX.top) / (WORLD_BOUNDS.maxY - WORLD_BOUNDS.minY)
)
const worldCenter = { x: (WORLD_BOUNDS.minX + WORLD_BOUNDS.maxX) / 2, y: (WORLD_BOUNDS.minY + WORLD_BOUNDS.maxY) / 2 }
const svgCenter = { x: (VIEWBOX.left + VIEWBOX.right) / 2, y: (VIEWBOX.top + VIEWBOX.bottom) / 2 }

export function worldToSvg(point: Coordinate): Coordinate {
  return { x: svgCenter.x + (point.x - worldCenter.x) * scale, y: svgCenter.y - (point.y - worldCenter.y) * scale }
}

export function svgToWorld(point: Coordinate): Coordinate {
  const normalize = (value: number) => Math.round(value * 1e12) / 1e12
  return { x: normalize(worldCenter.x + (point.x - svgCenter.x) / scale), y: normalize(worldCenter.y + (svgCenter.y - point.y) / scale) }
}

export const WORLD_SCALE = scale
