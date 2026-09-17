import { createEmptyDocument, type PrimitiveSpec } from "@draw/dsl"
import { buildSolidTemplate, templateEdgeLabel, templatePointLabel } from "@draw/geometry-kernel"
import { describe, expect, it } from "vitest"

import { migrateLegacySolids } from "./solidTemplates"

/** 去掉内核新加的可见性标记：模拟"升级之前物化出来"的那份子对象。 */
function withoutTessellation<T extends { tessellation?: boolean }>(primitive: T): T {
  const clone = { ...primitive }
  delete clone.tessellation
  return clone
}

/** 旧口径的物化结果：每个细分顶点都是带标签的点、每条母线都是带标签的棱。 */
function oldStyleRoundSolid(primitive: Extract<PrimitiveSpec, { type: "cylinder" | "cone" }>): PrimitiveSpec[] {
  const built = buildSolidTemplate(primitive)
  return built.primitives.map((child) => {
    if (child.type === "point3") return { ...withoutTessellation(child), label: templatePointLabel(built.vertexIds.indexOf(child.id)) }
    if (child.type === "edge3") return { ...withoutTessellation(child), label: templateEdgeLabel(built.edgeIds.indexOf(child.id)) }
    return child
  })
}

describe("solid template migration", () => {
  it("materializes a legacy solid into stable topology on load", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [{ id: "cube-1", type: "cube", origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 }, label: "旧立方体" }]

    const migrated = migrateLegacySolids(document)
    const polyhedron = migrated.primitives.find((primitive) => primitive.type === "polyhedron3")

    expect(migrated.primitives).toHaveLength(28)
    expect(polyhedron).toMatchObject({ construction: { kind: "template", templateId: "cube", sourceIds: expect.arrayContaining(["cube-1"]) } })
    expect(migrateLegacySolids(migrated).primitives).toHaveLength(migrated.primitives.length)
  })

  /**
   * 用户反馈："圆锥中间还有好多点，我不需要这些，同时有太多母线，用不上这些。"
   *
   * 已经物化过的旧文档（草稿 / `.mgeo`）走的是"补标记"这条路：子对象一个都不重建
   *（位置是用户拖过的、名字是用户改过的），只把新的可见性口径补上。
   */
  it("re-marks the round solid topology of a document materialized before the visibility rule", () => {
    const cone = { id: "cone-1", type: "cone" as const, center: { x: 0, y: 0, z: 0 }, radius: 2, height: 3, segments: 6, label: "圆锥 1" }
    const document = createEmptyDocument("geometry3d")
    document.primitives = [cone, ...oldStyleRoundSolid(cone)]
    const apex = document.primitives.find((primitive) => primitive.type === "point3" && primitive.position.z === 3)
    expect(apex).toBeDefined()
    // 用户给顶点改过的名字必须原样保留。
    if (apex) apex.label = "顶点甲"
    expect(document.primitives.filter((primitive) => primitive.type === "point3")).toHaveLength(7)

    const migrated = migrateLegacySolids(document)
    const points = migrated.primitives.filter((primitive) => primitive.type === "point3")
    const visible = points.filter((primitive) => primitive.tessellation !== true)

    // 6 段圆锥：底环 6 个细分点里只留离象限最近的 4 个，加上顶点共 5 个可见点。
    expect(points).toHaveLength(7)
    expect(visible).toHaveLength(5)
    expect(visible.map((primitive) => primitive.label)).toEqual(["A", "B", "C", "D", "顶点甲"])
    expect(points.filter((primitive) => primitive.tessellation === true).every((primitive) => primitive.label === undefined)).toBe(true)

    // 6 条母线全部隐藏，底面环的 6 条棱保留并按可见顺序重编。
    const edges = migrated.primitives.filter((primitive) => primitive.type === "edge3")
    expect(edges.filter((primitive) => primitive.tessellation === true)).toHaveLength(6)
    expect(edges.filter((primitive) => primitive.tessellation !== true).map((primitive) => primitive.label)).toEqual(["棱 1", "棱 2", "棱 3", "棱 4", "棱 5", "棱 6"])

    // 迁移是幂等的：已经补过标记的文档再迁一次，结果不变。
    const again = migrateLegacySolids(migrated)
    expect(again.primitives.filter((primitive) => primitive.type === "point3").map((primitive) => primitive.label)).toEqual(points.map((primitive) => primitive.label))
    expect(again.primitives.filter((primitive) => primitive.type === "edge3").map((primitive) => primitive.label)).toEqual(edges.map((primitive) => primitive.label))
  })

  it("leaves ordinary solids exactly as they were", () => {
    const cube = { id: "cube-2", type: "cube" as const, origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } }
    const document = createEmptyDocument("geometry3d")
    document.primitives = [cube, ...buildSolidTemplate(cube).primitives]

    const migrated = migrateLegacySolids(document)
    const points = migrated.primitives.filter((primitive) => primitive.type === "point3")

    expect(points).toHaveLength(8)
    expect(points.map((primitive) => primitive.label)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H"])
    expect(points.every((primitive) => primitive.tessellation === undefined)).toBe(true)
    expect(migrated.primitives.filter((primitive) => primitive.type === "edge3").every((primitive) => primitive.tessellation === undefined)).toBe(true)
  })
})
