import { describe, expect, it } from "vitest"

import { createEmptyDocument, type GeometryDocument, type Vector3 } from "@draw/dsl"
import { buildSolidTemplate } from "@draw/geometry-kernel"

import { computeIntersectionPreviews3d } from "./intersectionPreviews3d"

/** 一份"实体源 + 物化拓扑"一起进文档的文档：与 App 创建实体的方式一致。 */
function cubeDocument(solids: { id: string; origin: Vector3; size?: Vector3 }[]): GeometryDocument {
  const document = createEmptyDocument("geometry3d")
  document.primitives = solids.flatMap((solid) => {
    const primitive = { id: solid.id, type: "cube" as const, origin: solid.origin, size: solid.size ?? { x: 4, y: 4, z: 4 } }
    return [primitive, ...buildSolidTemplate(primitive).primitives]
  })
  return document
}

const overlapPair = [{ id: "cube-a", origin: { x: -2, y: -2, z: -2 } }, { id: "cube-b", origin: { x: 0, y: -2, z: -2 } }]

describe("automatic 3D intersection previews", () => {
  it("enumerates every overlapping pair without any selection", () => {
    const result = computeIntersectionPreviews3d(cubeDocument([...overlapPair, { id: "cube-far", origin: { x: 40, y: -2, z: -2 } }]))

    // 交叠区间是 x∈[0,2]、y∈[-2,2]、z∈[-2,2]：交集的每一面都各自是一份可点预览。
    const faces = result.previews.filter((preview) => preview.kind === "face")
    expect(faces.length).toBeGreaterThan(0)
    expect(faces.every((preview) => preview.sourceIds.join() === "cube-a,cube-b")).toBe(true)
    // 离得远的那一对不该出现在画布上：它是噪声，且会白白算一遍布尔交集。
    expect(result.previews.some((preview) => preview.sourceIds.includes("cube-far"))).toBe(false)
    expect(result.candidates).toBe(3)
  })

  it("gives a crossing pair a 交线 preview plus one clickable preview per 交面 and per 交点", () => {
    const result = computeIntersectionPreviews3d(cubeDocument(overlapPair))

    const line = result.previews.find((preview) => preview.kind === "intersection")
    expect(line?.sourceIds).toEqual(["cube-a", "cube-b"])
    expect(line?.segments.length).toBeGreaterThan(0)
    expect(line?.label).toContain("交线")

    /**
     * 交面是**一个表面**（用户口径："我需要的交面只是一个表面，而不是所有相交的表面"）：
     * 交集的每一面各自是一份可点预览，而不是整只半透明盒子。
     * 交叠区间是 2×4×4：两个 4×4 的切口面（16）与四个 2×4 的侧面（8），面积和 = 64。
     */
    const faces = result.previews.filter((preview) => preview.kind === "face")
    expect(faces).toHaveLength(6)
    expect(faces.map((preview) => preview.points.length)).toEqual([4, 4, 4, 4, 4, 4])
    expect(faces.reduce((total, preview) => total + preview.area, 0)).toBeCloseTo(64, 6)
    expect(faces.some((preview) => Math.abs(preview.area - 16) < 1e-6)).toBe(true)
    expect(faces.some((preview) => Math.abs(preview.area - 8) < 1e-6)).toBe(true)
    // 每份面预览都带着"我该被建成哪一面"的形心（点击创建时写进 `hint`），key 也各自独立。
    const bottom = faces.find((preview) => Math.abs(preview.area - 8) < 1e-6 && preview.points.every((point) => Math.abs(point.y + 2) < 1e-6))
    expect(bottom?.hint.y).toBeCloseTo(-2, 6)
    expect(faces.every((preview) => preview.key.startsWith("pair:cube-a|cube-b:面"))).toBe(true)

    // 交点是交线的拐点：交叠区那一圈矩形有 8 个拐点（x=0 与 x=2 各 4 个）。
    const points = result.previews.filter((preview) => preview.kind === "point")
    expect(points).toHaveLength(8)
    expect(points.every((preview) => preview.label === "交点")).toBe(true)
    for (const point of points) {
      expect(Math.abs(point.position.x) < 1e-6 || Math.abs(point.position.x - 2) < 1e-6).toBe(true)
    }
  })

  it("reports a contained solid as 交面 previews without inventing a 交线 or a 交点", () => {
    const result = computeIntersectionPreviews3d(cubeDocument([
      { id: "cube-outer", origin: { x: -2, y: -2, z: -2 } },
      { id: "cube-inner", origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }
    ]))

    // 公共部分是里面那个立方体：它的 6 个面都可见可点（面积 6×4 = 24）。
    const faces = result.previews.filter((preview) => preview.kind === "face")
    expect(faces).toHaveLength(6)
    expect(faces.reduce((total, preview) => total + preview.area, 0)).toBeCloseTo(24, 6)
    // 但两个表面根本不相交：不能编出交线，也不能编出交点。
    expect(result.previews.filter((preview) => preview.kind === "intersection")).toEqual([])
    expect(result.previews.filter((preview) => preview.kind === "point")).toEqual([])
  })

  it("skips pairs whose boxes do not touch", () => {
    const result = computeIntersectionPreviews3d(cubeDocument([
      { id: "cube-a", origin: { x: -2, y: -2, z: -2 } },
      { id: "cube-b", origin: { x: 40, y: -2, z: -2 } }
    ]))

    expect(result.previews).toEqual([])
    expect(result.skippedPairs).toBe(1)
  })

  it("reuses unchanged pairs instead of recomputing them on every document change", () => {
    const document = cubeDocument(overlapPair)
    const first = computeIntersectionPreviews3d(document)
    expect(first.computedPairs).toBe(1)
    expect(first.reusedPairs).toBe(0)

    const second = computeIntersectionPreviews3d(document, { previous: first.cache })
    expect(second.computedPairs).toBe(0)
    expect(second.reusedPairs).toBe(1)
    expect(second.previews).toEqual(first.previews)

    // 动了一个来源：这一对必须重算，且交面跟着新位置变（x 方向重叠由 2 变成 3）。
    const moved = cubeDocument([overlapPair[0], { id: "cube-b", origin: { x: -1, y: -2, z: -2 } }])
    const third = computeIntersectionPreviews3d(moved, { previous: second.cache })
    expect(third.computedPairs).toBe(1)
    // 交叠区间变成 3×4×4：4×4 的切口面变成 16，2×4 的侧面变成 3×4 = 12。
    const areas = third.previews.filter((preview) => preview.kind === "face").map((preview) => preview.area)
    expect(areas.filter((area) => Math.abs(area - 16) < 1e-6)).toHaveLength(2)
    expect(areas.filter((area) => Math.abs(area - 12) < 1e-6)).toHaveLength(4)

    // 彻底挪开：预览消失（包围盒先筛掉，连交线都不用算）。
    const apart = cubeDocument([overlapPair[0], { id: "cube-b", origin: { x: 40, y: -2, z: -2 } }])
    const fourth = computeIntersectionPreviews3d(apart, { previous: third.cache })
    expect(fourth.previews).toEqual([])
    expect(fourth.skippedPairs).toBe(1)
  })

  it("caps how many boolean intersections a single sweep computes", () => {
    // 三个两两交叠的立方体：3 对都有交集，但布尔交集只允许算 1 对。
    const document = cubeDocument([
      { id: "cube-a", origin: { x: -2, y: -2, z: -2 } },
      { id: "cube-b", origin: { x: 0, y: -2, z: -2 } },
      { id: "cube-c", origin: { x: 1, y: -2, z: -2 } }
    ])
    const result = computeIntersectionPreviews3d(document, { maxBooleanPairs: 1 })

    // 只有第一对拿到了"算布尔交集"的配额，所以只有它的 6 个面出现在画布上。
    expect(result.previews.filter((preview) => preview.kind === "face")).toHaveLength(6)
    expect(result.truncatedPairs).toBe(2)
    // 交线不受封顶影响：它是"哪里相交"的基本信息，画出来很便宜。
    expect(result.previews.filter((preview) => preview.kind === "intersection").length).toBeGreaterThan(1)
  })

  it("caps the faces of a single pair and says that pair was cut short", () => {
    const result = computeIntersectionPreviews3d(cubeDocument(overlapPair), { maxFacesPerPair: 2 })

    // 一个立方体对立方体的交集有 6 个面，只画前 2 个；"这一对没画全"必须能被说出来。
    expect(result.previews.filter((preview) => preview.kind === "face")).toHaveLength(2)
    expect(result.truncatedPairs).toBe(1)
  })

  it("gives a capped pair its 交面 back as soon as the budget allows", () => {
    // 三个两两交叠的立方体：3 对都有交面，但配额只允许算 1 对。
    const document = cubeDocument([
      { id: "cube-a", origin: { x: -2, y: -2, z: -2 } },
      { id: "cube-b", origin: { x: 0, y: -2, z: -2 } },
      { id: "cube-c", origin: { x: 1, y: -2, z: -2 } }
    ])
    const first = computeIntersectionPreviews3d(document, { maxBooleanPairs: 1 })
    expect(first.previews.filter((preview) => preview.kind === "face")).toHaveLength(6)
    expect(first.truncatedPairs).toBe(2)

    /**
     * 换一次配额再扫：被挤掉的那两对必须能补上。
     * 受限的结果一旦按"完整结果"缓存下来，它们就会**永久**只剩交线——即使配额腾出来了也回不来。
     */
    const second = computeIntersectionPreviews3d(document, { previous: first.cache, maxBooleanPairs: 3 })
    expect(second.previews.filter((preview) => preview.kind === "face")).toHaveLength(18)
    expect(second.truncatedPairs).toBe(0)
  })

  it("keeps the cap stable across sweeps and keeps reporting what it could not compute", () => {
    const document = cubeDocument([
      { id: "cube-a", origin: { x: -2, y: -2, z: -2 } },
      { id: "cube-b", origin: { x: 0, y: -2, z: -2 } },
      { id: "cube-c", origin: { x: 1, y: -2, z: -2 } }
    ])
    const first = computeIntersectionPreviews3d(document, { maxBooleanPairs: 2 })
    expect(first.previews.filter((preview) => preview.kind === "face")).toHaveLength(12)

    // 第二次扫描（文档没变）：沿用的交面同样占配额，因此结果与第一次逐字节一致，
    // 截断说明也必须**每次都报**——不然用户看到"有一对相交却没有面片"却没有任何解释。
    const second = computeIntersectionPreviews3d(document, { previous: first.cache, maxBooleanPairs: 2 })
    expect(second.previews.filter((preview) => preview.kind === "face")).toHaveLength(12)
    expect(second.truncatedPairs).toBe(1)
    expect(second.previews).toEqual(first.previews)
  })

  it("counts a capped pair that has no crossing line at all", () => {
    // 完全包含：两个表面根本不相交，所以连交线都没有——它被配额挤掉时同样是"少了一处交面"，
    // 不能因为没有交线就不计数（那样用户完全看不到解释）。
    const document = cubeDocument([
      { id: "cube-outer", origin: { x: -2, y: -2, z: -2 } },
      { id: "cube-inner", origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }
    ])
    const result = computeIntersectionPreviews3d(document, { maxBooleanPairs: 0 })

    expect(result.previews).toEqual([])
    expect(result.truncatedPairs).toBe(1)
  })

  it("only treats top-level solids as candidates", () => {
    const document = cubeDocument(overlapPair)
    // 模板物化出来的 point3/edge3/face3/polyhedron3 与面、平面都不该参与自动求交：
    // 一个立方体自己就有 6 个面，按面两两求交会瞬间刷出几十条噪声交线。
    document.primitives = [...document.primitives,
      { id: "face-1", type: "face3", pointIds: ["cube-a-point-1", "cube-a-point-2", "cube-a-point-3"] },
      { id: "plane-1", type: "plane3", definition: { kind: "pointNormal", pointId: "cube-a-point-1", normal: { x: 0, y: 0, z: 1 } } } as never
    ]
    const result = computeIntersectionPreviews3d(document)

    expect(result.candidates).toBe(2)
    expect(result.previews.every((preview) => !preview.sourceIds.includes("face-1") && !preview.sourceIds.includes("plane-1"))).toBe(true)
  })
})
