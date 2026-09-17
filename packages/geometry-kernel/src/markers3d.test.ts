import { describe, expect, it } from "vitest"

import type { Vector3 } from "./geometry3d"

import { dihedralAngleDetail3, dihedralMarker3, perpendicularFootOnLine3, perpendicularFootOnPlane3, sharedRingEdge3 } from "./markers3d"

// Regular tetrahedron with edge length 2*sqrt(2); its interior dihedral is arccos(1/3) = 70.5288 degrees.
const v0: Vector3 = { x: 1, y: 1, z: 1 }
const v1: Vector3 = { x: 1, y: -1, z: -1 }
const v2: Vector3 = { x: -1, y: 1, z: -1 }
const v3: Vector3 = { x: -1, y: -1, z: 1 }

describe("3D dihedral detail", () => {
  it("reports the interior dihedral of a regular tetrahedron with its supplement", () => {
    const detail = dihedralAngleDetail3([v0, v1, v2], [v0, v1, v3], v0, v1)

    expect(detail).not.toBeNull()
    expect(detail?.interiorDegrees).toBeCloseTo(70.5288, 3)
    expect(detail?.exteriorDegrees).toBeCloseTo(109.4712, 3)
    expect(detail?.hingeAxis).toBeTruthy()
    expect(detail?.explanation).toContain("公共棱")
  })

  it("keeps the same interior angle when a face winding is flipped", () => {
    const forward = dihedralAngleDetail3([v0, v1, v2], [v0, v1, v3], v0, v1)
    const flipped = dihedralAngleDetail3([v2, v1, v0], [v0, v1, v3], v0, v1)

    expect(flipped?.interiorDegrees).toBeCloseTo(forward?.interiorDegrees ?? 0, 6)
  })

  it("reports a right angle for two perpendicular faces", () => {
    const first: Vector3[] = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }]
    const second: Vector3[] = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 1 }, { x: 0, y: 0, z: 1 }]

    const detail = dihedralAngleDetail3(first, second, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })

    expect(detail?.interiorDegrees).toBeCloseTo(90, 6)
    expect(detail?.exteriorDegrees).toBeCloseTo(90, 6)
  })

  it("returns null instead of guessing for degenerate input", () => {
    expect(dihedralAngleDetail3([v0, v1], [v0, v1, v3], v0, v1)).toBeNull()
    expect(dihedralAngleDetail3([v0, v1, v2], [v0, v1, v3], v0, v0)).toBeNull()
    expect(dihedralAngleDetail3([v0, v1, v2], [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }], v0, v1)).toBeNull()
  })

  /**
   * 体检发现的真缺陷：`Math.max(2, Math.floor(NaN))` 还是 NaN，于是 `for (step = 0; step <= NaN; …)`
   * 一次都不执行——标记照常返回，但 `arc` 是**空数组**（画布上什么弧都画不出来）。
   * 同一次体检：`arcSteps: 1e9` 会去分配十亿个点，也要夹住。
   */
  it("falls back to a sane arc when the requested step count is unusable", () => {
    const first: Vector3[] = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }]
    const second: Vector3[] = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 1 }, { x: 0, y: 0, z: 1 }]
    const build = (arcSteps: number) => dihedralMarker3(first, second, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { arcSteps })

    for (const arcSteps of [Number.NaN, Number.POSITIVE_INFINITY, 0, -3]) {
      const marker = build(arcSteps)
      expect(marker, `arcSteps=${arcSteps}`).not.toBeNull()
      expect(marker!.arc.length, `arcSteps=${arcSteps}`).toBeGreaterThan(2)
      expect(marker!.arc.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z))).toBe(true)
    }
    expect(build(1e9)!.arc.length).toBeLessThanOrEqual(722)
  })
})

describe("dihedral markers", () => {
  it("builds an arc between both in-face directions plus outward normals", () => {
    const first: Vector3[] = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }]
    const second: Vector3[] = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 1 }, { x: 0, y: 0, z: 1 }]

    const marker = dihedralMarker3(first, second, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { radius: 0.5, arcSteps: 4 })

    expect(marker).not.toBeNull()
    expect(marker?.arc).toHaveLength(5)
    expect(marker?.interiorDegrees).toBeCloseTo(90, 6)
    expect(marker?.arc[0]).toEqual({ x: 0.5, y: 0, z: 0.5 })
    expect(marker?.arc[4].x).toBeCloseTo(0, 6)
    expect(marker?.arc[4].y).toBeCloseTo(0.5, 6)
    expect(marker?.arc[4].z).toBeCloseTo(0.5, 6)
    // Normals point away from the other face, so the two arrows separate the wedge.
    const firstNormal = marker!.firstNormal
    const secondNormal = marker!.secondNormal
    expect(firstNormal.end.y).toBeLessThanOrEqual(0)
    expect(secondNormal.end.x).toBeLessThanOrEqual(0)
  })

  it("returns null when the marker cannot be built", () => {
    expect(dihedralMarker3([v0, v1], [v0, v1, v3], v0, v1)).toBeNull()
    expect(dihedralMarker3([v0, v1, v2], [v0, v1, v3], v0, v0)).toBeNull()
    expect(sharedRingEdge3(["a", "b", "c"], ["a", "d", "e"])).toBeNull()
    expect(sharedRingEdge3(["a", "b", "c"], ["b", "c", "d"])).toEqual(["b", "c"])
  })
})

describe("perpendicular feet", () => {
  it("projects a point onto a plane", () => {
    const foot = perpendicularFootOnPlane3({ x: 2, y: 3, z: 5 }, { normal: { x: 0, y: 0, z: 1 }, constant: -1 })

    expect(foot).toEqual({ x: 2, y: 3, z: 1 })
  })

  it("projects a point onto a line and reports the parameter", () => {
    const foot = perpendicularFootOnLine3({ x: 1, y: 2, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 })

    expect(foot?.point).toEqual({ x: 1, y: 0, z: 0 })
    expect(foot?.parameter).toBeCloseTo(0.25, 6)
  })

  it("returns null for a degenerate line or plane", () => {
    expect(perpendicularFootOnLine3({ x: 1, y: 2, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })).toBeNull()
    expect(perpendicularFootOnPlane3({ x: 1, y: 1, z: 1 }, { normal: { x: 0, y: 0, z: 0 }, constant: 0 })).toBeNull()
  })
})
