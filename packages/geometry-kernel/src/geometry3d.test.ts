import { describe, expect, it } from "vitest"

import { addVector3, crossVector3, dihedralAngle, dotVector3, intersectRayPlane, normalizeVector3, planeFromPoints, scaleVector3, subtractVector3 } from "./geometry3d"

describe("3D geometry kernel", () => {
  it("performs immutable vector operations", () => {
    const first = { x: 1, y: 2, z: 3 }
    const second = { x: 4, y: 5, z: 6 }

    expect(addVector3(first, second)).toEqual({ x: 5, y: 7, z: 9 })
    expect(subtractVector3(second, first)).toEqual({ x: 3, y: 3, z: 3 })
    expect(scaleVector3(first, 2)).toEqual({ x: 2, y: 4, z: 6 })
    expect(dotVector3(first, second)).toBe(32)
    expect(crossVector3(first, second)).toEqual({ x: -3, y: 6, z: -3 })
    expect(normalizeVector3({ x: 0, y: 0, z: 2 })).toEqual({ x: 0, y: 0, z: 1 })
  })

  it("intersects a ray with a plane and measures the dihedral angle", () => {
    const plane = planeFromPoints({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })
    expect(plane).not.toBeNull()
    if (!plane) return

    expect(intersectRayPlane({ x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: -1 }, plane)).toEqual({ x: 0, y: 0, z: 0 })
    expect(intersectRayPlane({ x: 0, y: 0, z: 2 }, { x: 1, y: 0, z: 0 }, plane)).toBeNull()
    expect(dihedralAngle({ x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 0 })).toBeCloseTo(Math.PI / 2)
  })
})
