import { describe, expect, it } from "vitest"

import type { Plane3, Vector3 } from "./geometry3d"

import { orderSectionPoints3, sectionPolyhedron3 } from "./sections3d"

const cubeVertices: Vector3[] = [
  { x: -1, y: -1, z: -1 },
  { x: 1, y: -1, z: -1 },
  { x: 1, y: 1, z: -1 },
  { x: -1, y: 1, z: -1 },
  { x: -1, y: -1, z: 1 },
  { x: 1, y: -1, z: 1 },
  { x: 1, y: 1, z: 1 },
  { x: -1, y: 1, z: 1 }
]

const cubeFaces: number[][] = [
  [0, 1, 2, 3],
  [4, 5, 6, 7],
  [0, 1, 5, 4],
  [1, 2, 6, 5],
  [2, 3, 7, 6],
  [3, 0, 4, 7]
]

const key = (point: Vector3) => `${point.x},${point.y},${point.z}`

describe("3D sections", () => {
  it("returns an ordered square for a plane that cuts the cube in half", () => {
    const section = sectionPolyhedron3(cubeVertices, cubeFaces, { normal: { x: 0, y: 0, z: 1 }, constant: 0 })

    expect(section.status).toBe("polygon")
    expect(section.points).toHaveLength(4)
    expect(new Set(section.points.map(key))).toEqual(new Set(["-1,-1,0", "1,-1,0", "1,1,0", "-1,1,0"]))
    const ordered = section.points
    for (let index = 0; index < ordered.length; index += 1) {
      const next = ordered[(index + 1) % ordered.length]
      expect(Math.hypot(ordered[index].x - next.x, ordered[index].y - next.y, ordered[index].z - next.z)).toBeCloseTo(2, 6)
    }
  })

  it("classifies a tangent plane that only touches one vertex", () => {
    const section = sectionPolyhedron3(cubeVertices, cubeFaces, { normal: { x: 1, y: 1, z: 1 }, constant: -3 })

    expect(section.status).toBe("point")
    expect(section.points).toEqual([{ x: 1, y: 1, z: 1 }])
    expect(section.explanation).toContain("相切")
  })

  it("classifies a plane that touches the cube along a single edge", () => {
    const section = sectionPolyhedron3(cubeVertices, cubeFaces, { normal: { x: 1, y: 0, z: 1 }, constant: -2 })

    expect(section.status).toBe("segment")
    expect(new Set(section.points.map(key))).toEqual(new Set(["1,-1,1", "1,1,1"]))
  })

  it("returns the face itself when the plane is coplanar with it", () => {
    const section = sectionPolyhedron3(cubeVertices, cubeFaces, { normal: { x: 0, y: 0, z: 1 }, constant: 1 })

    expect(section.status).toBe("polygon")
    expect(new Set(section.points.map(key))).toEqual(new Set(["-1,-1,-1", "1,-1,-1", "1,1,-1", "-1,1,-1"]))
  })

  it("reports no intersection instead of inventing points", () => {
    const section = sectionPolyhedron3(cubeVertices, cubeFaces, { normal: { x: 0, y: 0, z: 1 }, constant: -5 })

    expect(section.status).toBe("none")
    expect(section.points).toEqual([])
    expect(section.explanation).toContain("没有交集")
  })

  it("reports insufficient data for a degenerate topology description", () => {
    const section = sectionPolyhedron3([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], [[0, 1]], { normal: { x: 0, y: 0, z: 1 }, constant: 0 })

    expect(section.status).toBe("insufficient-data")
  })

  it("keeps section points on the cutting plane", () => {
    const plane: Plane3 = { normal: { x: 1, y: 1, z: 0 }, constant: -0.5 }
    const section = sectionPolyhedron3(cubeVertices, cubeFaces, plane)

    expect(section.status).toBe("polygon")
    for (const point of section.points) expect(point.x + point.y - 0.5).toBeCloseTo(0, 6)
  })

  it("orders an unordered point set around the cutting plane", () => {
    const plane: Plane3 = { normal: { x: 0, y: 0, z: 1 }, constant: 0 }
    const shuffled: Vector3[] = [
      { x: 1, y: 1, z: 0 },
      { x: -1, y: -1, z: 0 },
      { x: -1, y: 1, z: 0 },
      { x: 1, y: -1, z: 0 }
    ]

    const ordered = orderSectionPoints3(shuffled, plane)

    expect(ordered).toHaveLength(4)
    for (let index = 0; index < ordered.length; index += 1) {
      const next = ordered[(index + 1) % ordered.length]
      expect(Math.hypot(ordered[index].x - next.x, ordered[index].y - next.y, ordered[index].z - next.z)).toBeCloseTo(2, 6)
    }
  })
})
