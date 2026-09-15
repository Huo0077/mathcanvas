import { describe, expect, it } from "vitest"

import { projectVector3, projectionBasis } from "./projections3d"

describe("3D engineering drawing projections", () => {
  it("maps world axes to deterministic front, top, and left views", () => {
    const point = { x: 2, y: 3, z: 4 }

    expect(projectVector3(point, "front")).toEqual({ x: 2, y: 3, depth: 4 })
    expect(projectVector3(point, "top")).toEqual({ x: 2, y: 4, depth: 3 })
    expect(projectVector3(point, "left")).toEqual({ x: 4, y: 3, depth: 2 })
    expect(point).toEqual({ x: 2, y: 3, z: 4 })
  })

  it("uses a stable orthonormal basis for the axonometric view", () => {
    const basis = projectionBasis("axonometric")
    const repeatedBasis = projectionBasis("axonometric")
    const projected = projectVector3({ x: 1, y: 1, z: 1 }, "axonometric")

    expect(projected).not.toBeNull()
    expect(projected?.x).toBeCloseTo(0)
    expect(projected?.y).toBeCloseTo(0)
    expect(repeatedBasis).toEqual(basis)
    expect(Math.abs(projected?.depth ?? 0)).toBeCloseTo(Math.sqrt(3))
    expect(Math.hypot(basis.horizontal.x, basis.horizontal.y, basis.horizontal.z)).toBeCloseTo(1)
    expect(Math.hypot(basis.vertical.x, basis.vertical.y, basis.vertical.z)).toBeCloseTo(1)
    expect(Math.hypot(basis.depth.x, basis.depth.y, basis.depth.z)).toBeCloseTo(1)
    expect(dot(basis.horizontal, basis.vertical)).toBeCloseTo(0)
    expect(dot(basis.horizontal, basis.depth)).toBeCloseTo(0)
    expect(dot(basis.vertical, basis.depth)).toBeCloseTo(0)
  })

  it("rejects non-finite source coordinates", () => {
    expect(projectVector3({ x: Number.NaN, y: 0, z: 0 }, "front")).toBeNull()
    expect(projectVector3({ x: 0, y: Number.POSITIVE_INFINITY, z: 0 }, "top")).toBeNull()
  })
})

function dot(first: { x: number; y: number; z: number }, second: { x: number; y: number; z: number }): number {
  return first.x * second.x + first.y * second.y + first.z * second.z
}
