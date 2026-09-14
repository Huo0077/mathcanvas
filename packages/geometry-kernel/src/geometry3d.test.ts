import { describe, expect, it } from "vitest"

import { addVector3, areCoplanar, crossVector3, dihedralAngle, dihedralAngleDegrees, distanceVector3, dotVector3, intersectRayPlane, normalizeVector3, planeFromPoints, scaleVector3, sectionCube, subtractVector3, tripleProduct } from "./geometry3d"

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
    expect(distanceVector3(first, second)).toBeCloseTo(Math.sqrt(27))
    expect(tripleProduct(first, second, { x: 0, y: 1, z: 0 })).toBeCloseTo(6)
  })

  it("intersects a ray with a plane and measures the dihedral angle", () => {
    const plane = planeFromPoints({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })
    expect(plane).not.toBeNull()
    if (!plane) return

    expect(intersectRayPlane({ x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: -1 }, plane)).toEqual({ x: 0, y: 0, z: 0 })
    expect(intersectRayPlane({ x: 0, y: 0, z: 2 }, { x: 1, y: 0, z: 0 }, plane)).toBeNull()
    expect(dihedralAngle({ x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 0 })).toBeCloseTo(Math.PI / 2)
    expect(dihedralAngleDegrees({ x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 0 })).toBeCloseTo(90)
  })

  it("computes the four-point section of a cube by a horizontal plane", () => {
    const points = sectionCube({ x: -1, y: -1, z: -1 }, { x: 2, y: 2, z: 2 }, { normal: { x: 0, y: 0, z: 1 }, constant: 0 })

    expect(points).toHaveLength(4)
    expect(points.every((point) => Math.abs(point.z) < 1e-10)).toBe(true)
    expect(new Set(points.map((point) => `${point.x},${point.y},${point.z}`)).size).toBe(4)
  })

  it("classifies coplanar point sets without mutating inputs", () => {
    expect(areCoplanar([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 1, z: 0 }
    ])).toBe(true)
    expect(areCoplanar([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 }
    ])).toBe(false)
  })
})
