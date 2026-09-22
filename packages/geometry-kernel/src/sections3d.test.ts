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

  /**
   * 体检发现的真缺陷：剖切平面**从不校验**（DSL 也只查"有限数"），于是 `{0,0,0}` 这个零法向会被当成
   * 合法平面。零法向意味着"每个点都在平面上"（`|n·p + c| = 0 ≤ tol`），逐面环首尾相连后凑出一个
   * 看起来正常的立方体面，状态报 `"polygon"`——**凭空造出了一片几何**。法向退化时必须报数据不足。
   */
  it("rejects a zero-normal cutting plane instead of fabricating a face", () => {
    const zero = sectionPolyhedron3(cubeVertices, cubeFaces, { normal: { x: 0, y: 0, z: 0 }, constant: 0 })
    expect(zero.status).toBe("insufficient-data")
    expect(zero.points).toEqual([])
    expect(zero.loops).toEqual([])

    // 常数不为 0 时同样的输入会走另一条分支（逐面环为空 → none）：同一份输入给出两种结论本身就是缺陷。
    const offset = sectionPolyhedron3(cubeVertices, cubeFaces, { normal: { x: 0, y: 0, z: 0 }, constant: 1 })
    expect(offset.status).toBe("insufficient-data")
    expect(offset.points).toEqual([])

    // 极小的法向同样是退化（尺度相关的判据）：它和零法向没有可区分的几何意义。
    const tiny = sectionPolyhedron3(cubeVertices, cubeFaces, { normal: { x: 1e-15, y: 0, z: 0 }, constant: 0 })
    expect(tiny.status).toBe("insufficient-data")
    expect(tiny.points).toEqual([])
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

  it("chains an L-shaped non-convex section in boundary order", () => {
    // L profile (x,z) = (0,0),(3,0),(3,1),(1,1),(1,3),(0,3) extruded along y from 0 to 1, cut at y = 0.5.
    const profile = [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 1 }, { x: 1, z: 1 }, { x: 1, z: 3 }, { x: 0, z: 3 }]
    const vertices: Vector3[] = [...profile.map((point) => ({ x: point.x, y: 0, z: point.z })), ...profile.map((point) => ({ x: point.x, y: 1, z: point.z }))]
    const faces: number[][] = [
      profile.map((_, index) => index),
      profile.map((_, index) => profile.length + index),
      ...profile.map((_, index) => [index, (index + 1) % profile.length, profile.length + ((index + 1) % profile.length), profile.length + index])
    ]

    const section = sectionPolyhedron3(vertices, faces, { normal: { x: 0, y: 1, z: 0 }, constant: -0.5 })

    expect(section.status).toBe("polygon")
    expect(section.points).toHaveLength(6)
    const profileKeys = new Set(profile.map((point) => `${point.x},0.5,${point.z}`))
    for (const point of section.points) expect(profileKeys.has(`${point.x},${point.y},${point.z}`)).toBe(true)
    // Every consecutive pair must be a real profile edge: three of length 1/2 and two of length 3, so the ring
    // cannot cut the diagonal across the notch (which would show up as sqrt(2)).
    const edgeLengths = section.points.map((point, index) => {
      const next = section.points[(index + 1) % section.points.length]
      return Math.round(Math.hypot(point.x - next.x, point.z - next.z))
    }).sort((first, second) => first - second)
    expect(edgeLengths).toEqual([1, 1, 2, 2, 3, 3])
  })

  /**
   * M1（评审）：原先这里还有一条"非凸截面必须沿拓扑邻接成环"的用例，已**删除**。
   *
   * 理由（评审 M1 的判定，也是事实）：`sections3d.ts` 在本切片里**没有被改动**
   * （`sectionPolyhedron3` 从实现之初就是"逐面求交 + 按共享端点串环"，见 `faceSectionRing` /
   * `chainSectionLoops`），所以那条用例对着改动前的代码同样会绿 —— 它证明不了 Task 4 的
   * "改用拓扑邻接排序"这一条，只是重复了上面已有的那条更弱的夹具。
   * Task 4 真正的证据是 `solidDerived.test.ts` 里的 `sectionSolid3`：
   * 那个函数是本切片新增的，它们才对着"改动前不存在的行为"。
   */
})
