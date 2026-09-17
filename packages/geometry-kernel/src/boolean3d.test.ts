import { describe, expect, it } from "vitest"

import { intersectConvexPolyhedra3, type Polyhedron3Input } from "./boolean3d"

/**
 * 两个凸实体的布尔交集（重叠区域的整体表面）。
 *
 * 用户要求："交面作为单独的图元"，且明确"交面 = 两实体重叠区域的整体表面"（布尔交集）。
 * 这里做内核：把两个实体都看成**半空间的交集**（每个面给出一个半空间），
 * 用"逐个平面裁剪"求交——凸实体被平面裁剪后仍是凸实体，算法简单且数值可控。
 * 非凸输入不做近似，直接给 `insufficient-data` 与诊断（不猜）。
 */

const cube = (origin: { x: number; y: number; z: number }, size: number): Polyhedron3Input => ({
  vertices: [
    { x: origin.x, y: origin.y, z: origin.z },
    { x: origin.x + size, y: origin.y, z: origin.z },
    { x: origin.x + size, y: origin.y + size, z: origin.z },
    { x: origin.x, y: origin.y + size, z: origin.z },
    { x: origin.x, y: origin.y, z: origin.z + size },
    { x: origin.x + size, y: origin.y, z: origin.z + size },
    { x: origin.x + size, y: origin.y + size, z: origin.z + size },
    { x: origin.x, y: origin.y + size, z: origin.z + size }
  ],
  faces: [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7]
  ]
})

/** 每个顶点都必须落在两个输入实体的内部或表面上（凸性 ⇒ 半空间判据）。 */
function insideAll(result: { vertices: { x: number; y: number; z: number }[] }, input: Polyhedron3Input): boolean {
  const centroid = input.vertices.reduce((sum, vertex) => ({ x: sum.x + vertex.x / input.vertices.length, y: sum.y + vertex.y / input.vertices.length, z: sum.z + vertex.z / input.vertices.length }), { x: 0, y: 0, z: 0 })
  return result.vertices.every((vertex) =>
    input.faces.every((face) => {
      const first = input.vertices[face[0]]
      const normal = { x: 0, y: 0, z: 0 }
      for (let index = 0; index < face.length; index += 1) {
        const current = input.vertices[face[index]]
        const next = input.vertices[face[(index + 1) % face.length]]
        normal.x += (current.y - next.y) * (current.z + next.z)
        normal.y += (current.z - next.z) * (current.x + next.x)
        normal.z += (current.x - next.x) * (current.y + next.y)
      }
      const outward = (centroid.x - first.x) * normal.x + (centroid.y - first.y) * normal.y + (centroid.z - first.z) * normal.z < 0 ? normal : { x: -normal.x, y: -normal.y, z: -normal.z }
      const length = Math.hypot(outward.x, outward.y, outward.z) || 1
      const signed = ((vertex.x - first.x) * outward.x + (vertex.y - first.y) * outward.y + (vertex.z - first.z) * outward.z) / length
      return signed <= 1e-6
    })
  )
}

describe("intersectConvexPolyhedra3", () => {
  it("intersects two overlapping unit cubes into the expected 0.5 cube", () => {
    const result = intersectConvexPolyhedra3(cube({ x: 0, y: 0, z: 0 }, 1), cube({ x: 0.5, y: 0.5, z: 0.5 }, 1))

    expect(result.status).toBe("polyhedron")
    expect(result.volume).toBeCloseTo(0.125, 9)
    expect(result.area).toBeCloseTo(6 * 0.25, 9)
    expect(result.faces).toHaveLength(6)
    expect(result.vertices).toHaveLength(8)
  })

  it("reports each face's own normal and area, so callers never re-derive them", () => {
    // 交面图元要的是**一个面**：它得知道"这一面多大、朝哪边"。
    // 这份读数由内核给出（与 `faces` 一一对应），避免调用方各写一份 Newell 法向与面积。
    const result = intersectConvexPolyhedra3(cube({ x: 0, y: 0, z: 0 }, 2), cube({ x: 1, y: 0, z: 0 }, 2))

    expect(result.status).toBe("polyhedron")
    expect(result.faceAreas).toHaveLength(result.faces.length)
    expect(result.faceNormals).toHaveLength(result.faces.length)
    // 交叠区间是 1×2×2：两个 2×2 的切口面（4）与四个 1×2 的侧面（2）。
    expect([...result.faceAreas].sort((first, second) => first - second)).toEqual([2, 2, 2, 2, 4, 4])
    expect(result.faceAreas.reduce((total, area) => total + area, 0)).toBeCloseTo(result.area, 9)
    // 法向是**朝外**的单位向量：每个面都与它自己的顶点环同向（点积为正）。
    expect(result.faceNormals.every((normal) => Math.abs(Math.hypot(normal.x, normal.y, normal.z) - 1) < 1e-9)).toBe(true)
    const centre = result.vertices.reduce((sum, vertex) => ({ x: sum.x + vertex.x / result.vertices.length, y: sum.y + vertex.y / result.vertices.length, z: sum.z + vertex.z / result.vertices.length }), { x: 0, y: 0, z: 0 })
    result.faces.forEach((face, index) => {
      const centroid = face.reduce((sum, vertexIndex) => {
        const vertex = result.vertices[vertexIndex]
        return { x: sum.x + vertex.x / face.length, y: sum.y + vertex.y / face.length, z: sum.z + vertex.z / face.length }
      }, { x: 0, y: 0, z: 0 })
      const outward = { x: centroid.x - centre.x, y: centroid.y - centre.y, z: centroid.z - centre.z }
      const normal = result.faceNormals[index]
      expect(normal.x * outward.x + normal.y * outward.y + normal.z * outward.z).toBeGreaterThan(0)
    })
    // 没有交集 / 退化输入时这两个数组是空的，调用方不必特判 undefined。
    expect(intersectConvexPolyhedra3(cube({ x: 0, y: 0, z: 0 }, 1), cube({ x: 5, y: 0, z: 0 }, 1)).faceAreas).toEqual([])
  })

  it("returns every intersection vertex inside both solids", () => {
    const first = cube({ x: 0, y: 0, z: 0 }, 2)
    const second = cube({ x: 1, y: 0.5, z: 0.5 }, 2)

    const result = intersectConvexPolyhedra3(first, second)

    expect(result.status).toBe("polyhedron")
    expect(insideAll(result, first)).toBe(true)
    expect(insideAll(result, second)).toBe(true)
    // 体积不超过任一输入
    expect(result.volume).toBeLessThanOrEqual(8 + 1e-9)
  })

  it("returns the small cube when one solid contains the other", () => {
    const big = cube({ x: 0, y: 0, z: 0 }, 4)
    const small = cube({ x: 1, y: 1, z: 1 }, 1)

    const result = intersectConvexPolyhedra3(big, small)

    expect(result.status).toBe("polyhedron")
    expect(result.volume).toBeCloseTo(1, 9)
    expect(result.faces).toHaveLength(6)
  })

  it("reports no intersection for disjoint solids", () => {
    const result = intersectConvexPolyhedra3(cube({ x: 0, y: 0, z: 0 }, 1), cube({ x: 5, y: 0, z: 0 }, 1))

    expect(result.status).toBe("none")
    expect(result.vertices).toHaveLength(0)
    expect(result.volume).toBe(0)
  })

  it("reports a flat intersection for solids that only touch", () => {
    const result = intersectConvexPolyhedra3(cube({ x: 0, y: 0, z: 0 }, 1), cube({ x: 1, y: 0, z: 0 }, 1))

    expect(result.status).toBe("flat")
    expect(result.volume).toBeCloseTo(0, 9)
    expect(result.area).toBeCloseTo(1, 6)
  })

  it("refuses non-convex input instead of guessing", () => {
    // L 形棱柱（俯视是 L）：不是凸体
    const lShape: Polyhedron3Input = {
      vertices: [
        { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 1, y: 2, z: 0 }, { x: 0, y: 2, z: 0 },
        { x: 0, y: 0, z: 1 }, { x: 2, y: 0, z: 1 }, { x: 2, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }, { x: 1, y: 2, z: 1 }, { x: 0, y: 2, z: 1 }
      ],
      faces: [
        [0, 1, 2, 3, 4, 5], [6, 11, 10, 9, 8, 7],
        [0, 6, 7, 1], [1, 7, 8, 2], [2, 8, 9, 3], [3, 9, 10, 4], [4, 10, 11, 5], [5, 11, 6, 0]
      ]
    }

    const result = intersectConvexPolyhedra3(lShape, cube({ x: 0, y: 0, z: 0 }, 1))

    expect(result.status).toBe("insufficient-data")
    expect(result.explanation).toContain("凸")
  })

  it("refuses degenerate input", () => {
    const result = intersectConvexPolyhedra3({ vertices: [{ x: 0, y: 0, z: 0 }], faces: [] }, cube({ x: 0, y: 0, z: 0 }, 1))

    expect(result.status).toBe("insufficient-data")
  })
})
