import { describe, expect, it } from "vitest"

import type { Vector3 } from "./geometry3d"
import { faceRingsFromFaces, intersectFaceSets, intersectRings3, planeFromRing, planeIntersectionLine } from "./intersections3d"

/** 轴对齐盒子的八个顶点与六个面（ring 顺序为外法向逆时针）。 */
function boxRings(min: Vector3, max: Vector3): Vector3[][] {
  const { x: x0, y: y0, z: z0 } = min
  const { x: x1, y: y1, z: z1 } = max
  const v: Vector3[] = [
    { x: x0, y: y0, z: z0 }, { x: x1, y: y0, z: z0 }, { x: x1, y: y1, z: z0 }, { x: x0, y: y1, z: z0 },
    { x: x0, y: y0, z: z1 }, { x: x1, y: y0, z: z1 }, { x: x1, y: y1, z: z1 }, { x: x0, y: y1, z: z1 }
  ]
  const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
  return faceRingsFromFaces(faces, v)
}

describe("3D face intersections", () => {
  it("derives a plane from a ring and rejects degenerate rings", () => {
    const square: Vector3[] = [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 2, z: 0 }, { x: 0, y: 2, z: 0 }]
    const plane = planeFromRing(square)
    expect(plane).not.toBeNull()
    expect(Math.abs(plane!.normal.z)).toBeCloseTo(1)
    // 共线的三个点没有平面。
    expect(planeFromRing([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }])).toBeNull()
    // 非有限值被拒。
    expect(planeFromRing([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: Number.NaN, z: 0 }])).toBeNull()
  })

  it("finds the intersection line of two planes and reports parallel planes", () => {
    const horizontal = { normal: { x: 0, y: 0, z: 1 }, constant: 0 }
    const vertical = { normal: { x: 1, y: 0, z: 0 }, constant: -1 }
    const line = planeIntersectionLine(horizontal, vertical)
    expect(line).not.toBeNull()
    expect(Math.abs(Math.abs(line!.direction.y) - 1)).toBeCloseTo(0)
    // 交线必须同时落在两个平面上：n·p + c = 0。
    expect(Math.abs(line!.point.z)).toBeLessThan(1e-9)
    expect(Math.abs(line!.point.x - 1)).toBeLessThan(1e-9)
    // 平行（含共面）平面没有唯一交线。
    expect(planeIntersectionLine(horizontal, { normal: { x: 0, y: 0, z: 2 }, constant: -1 })).toBeNull()
  })

  it("intersects two perpendicular rings into one segment", () => {
    const horizontal: Vector3[] = [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 4, z: 0 }, { x: 0, y: 4, z: 0 }]
    const vertical: Vector3[] = [{ x: 2, y: -1, z: -1 }, { x: 2, y: 5, z: -1 }, { x: 2, y: 5, z: 1 }, { x: 2, y: -1, z: 1 }]
    const segment = intersectRings3(horizontal, vertical)
    expect(segment).not.toBeNull()
    // 交线应是 x=2、z=0、y 从 0 到 4。
    expect(segment!.a.z).toBeCloseTo(0, 6)
    expect(segment!.b.z).toBeCloseTo(0, 6)
    expect(segment!.a.x).toBeCloseTo(2, 6)
    expect(segment!.b.x).toBeCloseTo(2, 6)
    expect(Math.min(segment!.a.y, segment!.b.y)).toBeCloseTo(0, 6)
    expect(Math.max(segment!.a.y, segment!.b.y)).toBeCloseTo(4, 6)
  })

  it("returns nothing for coplanar rings (no unique line) and for disjoint rings", () => {
    const base: Vector3[] = [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 4, z: 0 }, { x: 0, y: 4, z: 0 }]
    const coplanar: Vector3[] = [{ x: 1, y: 1, z: 0 }, { x: 3, y: 1, z: 0 }, { x: 3, y: 3, z: 0 }, { x: 1, y: 3, z: 0 }]
    expect(intersectRings3(base, coplanar)).toBeNull()

    // 平行但不同高度：无交。
    const above: Vector3[] = base.map((point) => ({ ...point, z: 5 }))
    expect(intersectRings3(base, above)).toBeNull()

    // 垂直但错开：无交。
    const far: Vector3[] = [{ x: 9, y: -1, z: -1 }, { x: 9, y: 5, z: -1 }, { x: 9, y: 5, z: 1 }, { x: 9, y: -1, z: 1 }]
    expect(intersectRings3(base, far)).toBeNull()
  })

  it("intersects two overlapping boxes into a polyline without duplicate segments", () => {
    // 两个立方体沿 X 轴错开 2：交叠区域是 2×4×4。
    // 注意 y=±2 与 z=±2 这四对面**完全共面**（两个盒子同宽同高），共面没有唯一交线，因此会有诊断。
    const first = boxRings({ x: -2, y: -2, z: -2 }, { x: 2, y: 2, z: 2 })
    const second = boxRings({ x: 0, y: -2, z: -2 }, { x: 4, y: 2, z: 2 })
    const result = intersectFaceSets(first, second)

    expect(result.diagnostics.some((message) => message.includes("共面"))).toBe(true)
    expect(result.segments.length).toBeGreaterThan(0)
    // 每条交线都必须落在交叠区域内：否则就是算错了。
    for (const segment of result.segments) {
      for (const point of [segment.a, segment.b]) {
        // 交线必须落在两个盒子的交叠区域内（x∈[0,2]，|y|≤2，|z|≤2）。
        expect(point.x).toBeGreaterThanOrEqual(-1e-6)
        expect(point.x).toBeLessThanOrEqual(2 + 1e-6)
        expect(Math.abs(point.y)).toBeLessThanOrEqual(2 + 1e-6)
        expect(Math.abs(point.z)).toBeLessThanOrEqual(2 + 1e-6)
      }
      // 不允许零长度段。
      expect(Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y, segment.b.z - segment.a.z)).toBeGreaterThan(1e-6)
    }
    // 相邻面会重复算出同一条交线，去重后不应出现完全重复的段。
    const keys = result.segments.map((segment) => {
      const key = [segment.a, segment.b].map((point) => `${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z.toFixed(6)}`).sort().join("~")
      return key
    })
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("reports coplanar faces instead of inventing a line", () => {
    const first = boxRings({ x: 0, y: 0, z: 0 }, { x: 4, y: 4, z: 4 })
    // 第二个盒子与第一个共享 z=0 那个面（完全共面）。
    const second = boxRings({ x: 1, y: 1, z: 0 }, { x: 3, y: 3, z: 4 })
    const result = intersectFaceSets(first, second)

    expect(result.diagnostics.some((message) => message.includes("共面"))).toBe(true)
    // 共面的那一对不产出交线，但侧面的真实交线仍然要给出。
    expect(result.segments.length).toBeGreaterThan(0)
  })

  it("reports insufficient data when a side has no usable faces", () => {
    const first = boxRings({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })
    const result = intersectFaceSets(first, [])
    expect(result.classification).toBe("insufficient-data")
    expect(result.segments).toEqual([])
    expect(result.diagnostics.length).toBeGreaterThan(0)
  })

  it("merges collinear segments that share an endpoint", () => {
    // 两块相邻薄板拼成一条长条，与盒子相交：x=4 那侧的两段（y∈[0,1] 与 y∈[1,2]）共线且相接，必须合并成一条；
    // 矩形边界的其余两条边（x=3 与 y=2）保持独立。
    const first = boxRings({ x: 0, y: 0, z: 0 }, { x: 4, y: 2, z: 4 })
    const plate: Vector3[][] = [
      [{ x: 3, y: 0, z: 2 }, { x: 5, y: 0, z: 2 }, { x: 5, y: 1, z: 2 }, { x: 3, y: 1, z: 2 }],
      [{ x: 3, y: 1, z: 2 }, { x: 5, y: 1, z: 2 }, { x: 5, y: 2, z: 2 }, { x: 3, y: 2, z: 2 }]
    ]
    const result = intersectFaceSets(first, plate)

    const mergedEdge = result.segments.filter((segment) =>
      Math.abs(segment.a.x - 4) < 1e-6 && Math.abs(segment.b.x - 4) < 1e-6 && Math.abs(segment.a.z - 2) < 1e-6 && Math.abs(segment.b.z - 2) < 1e-6)
    expect(mergedEdge).toHaveLength(1)
    expect(Math.min(mergedEdge[0].a.y, mergedEdge[0].b.y)).toBeCloseTo(0, 6)
    expect(Math.max(mergedEdge[0].a.y, mergedEdge[0].b.y)).toBeCloseTo(2, 6)
  })
})
