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

    const solid = result.previews.find((preview) => preview.kind === "solid")
    expect(solid?.sourceIds).toEqual(["cube-a", "cube-b"])
    expect(solid?.volume).toBeCloseTo(32, 6)
    // 离得远的那一对不该出现在画布上：它是噪声，且会白白算一遍布尔交集。
    expect(result.previews.some((preview) => preview.sourceIds.includes("cube-far"))).toBe(false)
    expect(result.candidates).toBe(3)
  })

  it("gives a crossing pair both a 交面 and a 交线 preview", () => {
    const result = computeIntersectionPreviews3d(cubeDocument(overlapPair))

    const solid = result.previews.find((preview) => preview.kind === "solid")
    const line = result.previews.find((preview) => preview.kind === "intersection")
    expect(solid?.sourceIds).toEqual(["cube-a", "cube-b"])
    expect(line?.sourceIds).toEqual(["cube-a", "cube-b"])
    // 两个图元各自独立：它们的 key 不同，点击时分别创建交面与交线。
    expect(solid?.key).not.toBe(line?.key)
    expect(line?.segments.length).toBeGreaterThan(0)
    expect(solid?.faces.length).toBeGreaterThan(0)
    expect(solid?.label).toContain("交面")
    expect(line?.label).toContain("交线")
  })

  it("reports a contained solid as a 交面 without inventing a 交线", () => {
    const result = computeIntersectionPreviews3d(cubeDocument([
      { id: "cube-outer", origin: { x: -2, y: -2, z: -2 } },
      { id: "cube-inner", origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }
    ]))

    const solid = result.previews.find((preview) => preview.kind === "solid")
    expect(solid?.volume).toBeCloseTo(8, 6)
    // 包含关系下两个表面根本不相交，所以只能给交面，不能编一条交线出来。
    expect(result.previews.filter((preview) => preview.kind === "intersection")).toEqual([])
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
    expect(third.previews.find((preview) => preview.kind === "solid")?.volume).toBeCloseTo(48, 6)

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
    const result = computeIntersectionPreviews3d(document, { maxSolidPreviews: 1 })

    expect(result.previews.filter((preview) => preview.kind === "solid")).toHaveLength(1)
    expect(result.truncatedPairs).toBe(2)
    // 交线不受封顶影响：它是"哪里相交"的基本信息，画出来很便宜。
    expect(result.previews.filter((preview) => preview.kind === "intersection").length).toBeGreaterThan(1)
  })

  it("gives a capped pair its 交面 back as soon as the budget allows", () => {
    // 三个两两交叠的立方体：3 对都有交面，但配额只允许算 1 对。
    const document = cubeDocument([
      { id: "cube-a", origin: { x: -2, y: -2, z: -2 } },
      { id: "cube-b", origin: { x: 0, y: -2, z: -2 } },
      { id: "cube-c", origin: { x: 1, y: -2, z: -2 } }
    ])
    const first = computeIntersectionPreviews3d(document, { maxSolidPreviews: 1 })
    expect(first.previews.filter((preview) => preview.kind === "solid")).toHaveLength(1)
    expect(first.truncatedPairs).toBe(2)

    /**
     * 换一次配额再扫：被挤掉的那两对必须能补上。
     * 受限的结果一旦按"完整结果"缓存下来，它们就会**永久**只剩交线——即使配额腾出来了也回不来。
     */
    const second = computeIntersectionPreviews3d(document, { previous: first.cache, maxSolidPreviews: 3 })
    expect(second.previews.filter((preview) => preview.kind === "solid")).toHaveLength(3)
    expect(second.truncatedPairs).toBe(0)
  })

  it("keeps the cap stable across sweeps and keeps reporting what it could not compute", () => {
    const document = cubeDocument([
      { id: "cube-a", origin: { x: -2, y: -2, z: -2 } },
      { id: "cube-b", origin: { x: 0, y: -2, z: -2 } },
      { id: "cube-c", origin: { x: 1, y: -2, z: -2 } }
    ])
    const first = computeIntersectionPreviews3d(document, { maxSolidPreviews: 2 })
    expect(first.previews.filter((preview) => preview.kind === "solid")).toHaveLength(2)

    // 第二次扫描（文档没变）：沿用的交面同样占配额，因此结果与第一次逐字节一致，
    // 截断说明也必须**每次都报**——不然用户看到"有一对相交却没有面片"却没有任何解释。
    const second = computeIntersectionPreviews3d(document, { previous: first.cache, maxSolidPreviews: 2 })
    expect(second.previews.filter((preview) => preview.kind === "solid")).toHaveLength(2)
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
    const result = computeIntersectionPreviews3d(document, { maxSolidPreviews: 0 })

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
