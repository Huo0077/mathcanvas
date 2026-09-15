import type { Vector3 } from "./geometry3d"

export type DrawingView = "front" | "top" | "left" | "axonometric"

export interface ProjectionBasis {
  horizontal: Vector3
  vertical: Vector3
  depth: Vector3
}

export interface ProjectedPoint {
  x: number
  y: number
  depth: number
}

const AXONOMETRIC_BASIS: ProjectionBasis = {
  horizontal: { x: Math.SQRT1_2, y: -Math.SQRT1_2, z: 0 },
  vertical: { x: -1 / Math.sqrt(6), y: -1 / Math.sqrt(6), z: 2 / Math.sqrt(6) },
  depth: { x: 1 / Math.sqrt(3), y: 1 / Math.sqrt(3), z: 1 / Math.sqrt(3) }
}

export function projectionBasis(view: DrawingView): ProjectionBasis {
  if (view === "front") return { horizontal: { x: 1, y: 0, z: 0 }, vertical: { x: 0, y: 1, z: 0 }, depth: { x: 0, y: 0, z: 1 } }
  if (view === "top") return { horizontal: { x: 1, y: 0, z: 0 }, vertical: { x: 0, y: 0, z: 1 }, depth: { x: 0, y: 1, z: 0 } }
  if (view === "left") return { horizontal: { x: 0, y: 0, z: 1 }, vertical: { x: 0, y: 1, z: 0 }, depth: { x: 1, y: 0, z: 0 } }
  return { horizontal: { ...AXONOMETRIC_BASIS.horizontal }, vertical: { ...AXONOMETRIC_BASIS.vertical }, depth: { ...AXONOMETRIC_BASIS.depth } }
}

export function projectVector3(point: Vector3, view: DrawingView): ProjectedPoint | null {
  if (![point.x, point.y, point.z].every(Number.isFinite)) return null
  const basis = projectionBasis(view)
  return {
    x: dotVector3(point, basis.horizontal),
    y: dotVector3(point, basis.vertical),
    depth: dotVector3(point, basis.depth)
  }
}

function dotVector3(first: Vector3, second: Vector3): number {
  return first.x * second.x + first.y * second.y + first.z * second.z
}
