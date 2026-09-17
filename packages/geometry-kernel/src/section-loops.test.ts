import { describe, expect, it } from "vitest"

import { buildSolidTemplate } from "./solid-builders"
import { sectionPolyhedron3 } from "./sections3d"
import type { Vector3 } from "./geometry3d"

/**
 * 截面成环的两类硬问题：
 * ① 轴对齐法向的"浮点悬崖"——旋转 90° 得到的法向带着 ~1e-17 的残差，
 *    同一个交点在不同面上算出的坐标差几个 ulp，固定 9 位小数的键分不开，于是"连不成闭合边界"；
 * ② 多环——不连通或带孔的截面会产生两条以上闭合边界，旧实现只取周长最大的一条，其余几何被丢掉。
 */
function cubeTopology(origin: Vector3, size: Vector3) {
  const cube = { id: "cube", type: "cube" as const, origin, size }
  const built = buildSolidTemplate(cube)
  const index = new Map(built.primitives.filter((primitive) => primitive.type === "point3").map((primitive, position) => [primitive.id, position]))
  const vertices = built.primitives.filter((primitive) => primitive.type === "point3").map((primitive) => primitive.position)
  const polyhedron = built.primitives.find((primitive) => primitive.type === "polyhedron3")!
  const faces = polyhedron.type === "polyhedron3"
    ? polyhedron.faceIds.map((faceId) => {
        const face = built.primitives.find((primitive) => primitive.id === faceId)!
        return face.type === "face3" ? face.pointIds.map((pointId) => index.get(pointId)!) : []
      })
    : []
  return { vertices, faces }
}

describe("section loops", () => {
  it("survives a normal that carries floating-point residue from a 90° rotation", () => {
    const { vertices, faces } = cubeTopology({ x: -1, y: -1, z: -1 }, { x: 2, y: 2, z: 2 })
    // 与 rotatedSectionPlane 的输出同形：单位法向在绕轴 90° 之后带着 ~1e-17 的残差。
    const plane = { normal: { x: 0, y: 1e-17, z: 1 }, constant: -0 }

    const result = sectionPolyhedron3(vertices, faces, plane, 1e-9)

    expect(result.status).toBe("polygon")
    expect(result.points).toHaveLength(4)
    expect(result.loops).toHaveLength(1)
  })

  it("returns every closed loop for a section that splits into two", () => {
    // 两个互不相邻的立方体当作一个多面体来切：平面在每个立方体上各切出一圈，共两环。
    const first = cubeTopology({ x: -5, y: -1, z: -1 }, { x: 2, y: 2, z: 2 })
    const second = cubeTopology({ x: 5, y: -1, z: -1 }, { x: 2, y: 2, z: 2 })
    const vertices = [...first.vertices, ...second.vertices]
    const faces = [...first.faces, ...second.faces.map((face) => face.map((index) => index + first.vertices.length))]

    const result = sectionPolyhedron3(vertices, faces, { normal: { x: 0, y: 1, z: 0 }, constant: 0 }, 1e-9)

    expect(result.status).toBe("polygon")
    expect(result.loops).toHaveLength(2)
    // 两环各自闭合，各 4 个顶点；`points` 保持"周长最大的一环"以兼容既有消费方。
    expect(result.loops.map((loop) => loop.length)).toEqual([4, 4])
    expect(result.points).toHaveLength(4)
    expect(result.explanation).toContain("2 条独立边界")
  })

  it("keeps a hole: an outer ring and an inner ring are both reported", () => {
    // "回"字形棱柱：外圈与内圈各 4 个顶点、上下两层，共 16 个顶点。
    const outer = [{ x: -3, y: -3 }, { x: 3, y: -3 }, { x: 3, y: 3 }, { x: -3, y: 3 }]
    const inner = [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }]
    const vertices: Vector3[] = []
    for (const z of [0, 2]) for (const point of [...outer, ...inner]) vertices.push({ x: point.x, y: point.y, z })
    // 索引：0-3 外@z0、4-7 内@z0、8-11 外@z2、12-15 内@z2。
    const outerBottom = [0, 1, 2, 3]
    const innerBottom = [4, 5, 6, 7]
    const outerTop = [8, 9, 10, 11]
    const innerTop = [12, 13, 14, 15]
    const wall = (bottom: number[], top: number[]) => [0, 1, 2, 3].map((index) => [bottom[index], bottom[(index + 1) % 4], top[(index + 1) % 4], top[index]])
    const annulus = (outerRing: number[], innerRing: number[]) => [0, 1, 2, 3].map((index) => [outerRing[index], outerRing[(index + 1) % 4], innerRing[(index + 1) % 4], innerRing[index]])
    const faces: number[][] = [
      ...wall(outerBottom, outerTop),
      ...wall(innerTop, innerBottom),
      ...annulus(outerTop, innerTop),
      ...annulus(innerBottom, outerBottom)
    ]

    const result = sectionPolyhedron3(vertices, faces, { normal: { x: 0, y: 0, z: 1 }, constant: -1 }, 1e-9)

    expect(result.status).toBe("polygon")
    expect(result.loops).toHaveLength(2)
    // 外环面积大于内环，所以 points 是外环（正方形边长 6 对边长 2）。
    expect(result.loops.map((loop) => loop.length)).toEqual([4, 4])
    expect(result.points.length).toBe(4)
    expect(result.explanation).toContain("2 条独立边界")
  })

  it("still reports degenerate cuts explicitly instead of fabricating a polygon", () => {
    const { vertices, faces } = cubeTopology({ x: -1, y: -1, z: -1 }, { x: 2, y: 2, z: 2 })

    expect(sectionPolyhedron3(vertices, faces, { normal: { x: 0, y: 0, z: 1 }, constant: -5 }, 1e-9).status).toBe("none")
    expect(sectionPolyhedron3(vertices, faces, { normal: { x: 0, y: 0, z: 1 }, constant: -1 }, 1e-9).status).toBe("polygon")
  })
})
