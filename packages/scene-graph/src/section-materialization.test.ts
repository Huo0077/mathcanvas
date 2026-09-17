import { describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"

import { applyOperation, createPoint3, recomputeDerivedObjects, sectionMaterialization } from "./index"

/** 截面 → 独立图元：物化出来的东西与来源解耦，这正是"可以获取截面图元"。 */
describe("section materialization", () => {
  function sectionDocument() {
    const document = createEmptyDocument("geometry3d")
    const cube = { id: "cube-1", type: "cube" as const, origin: { x: -2, y: -2, z: -1 }, size: { x: 4, y: 4, z: 2 }, label: "立方体 1" }
    document.primitives = [
      cube,
      createPoint3("point-a", { x: 0, y: 0, z: 0 }),
      {
        id: "section-1",
        type: "section",
        sourceId: "cube-1",
        plane: { normal: { x: 0, y: 0, z: 1 }, constant: 0 },
        points: [],
        classification: "none",
        status: "undefined",
        label: "截面 1"
      }
    ]
    return recomputeDerivedObjects(document)
  }

  it("materializes a closed loop into points, edges and one face", () => {
    const document = sectionDocument()
    const materialized = sectionMaterialization(document, "section-1")!

    expect(materialized.filter((primitive) => primitive.type === "point3")).toHaveLength(4)
    expect(materialized.filter((primitive) => primitive.type === "edge3")).toHaveLength(4)
    expect(materialized.filter((primitive) => primitive.type === "face3")).toHaveLength(1)
    // 顺序是"点 → 棱 → 面"：一条 addPrimitives 提交时引用已经存在。
    expect(materialized.map((primitive) => primitive.type)).toEqual(["point3", "point3", "point3", "point3", "edge3", "edge3", "edge3", "edge3", "face3"])

    const face = materialized.find((primitive) => primitive.type === "face3")!
    if (face.type !== "face3") throw new Error("expected a face")
    expect(face.pointIds).toHaveLength(4)
    expect(face.edgeIds).toHaveLength(4)
    // 每一环是闭合的：第 i 条棱连接第 i 与第 i+1 个顶点。
    const points = materialized.filter((primitive) => primitive.type === "point3")
    const edges = materialized.filter((primitive) => primitive.type === "edge3")
    edges.forEach((edge, index) => {
      if (edge.type !== "edge3") return
      expect(edge.pointIds).toEqual([points[index].id, points[(index + 1) % points.length].id])
    })
    // 与来源解耦：物化结果里没有 sourceId 这种引用。
    for (const primitive of materialized) expect(JSON.stringify(primitive)).not.toContain("cube-1")
  })

  it("accepts the materialized primitives in one patch and keeps them after the source is deleted", () => {
    const document = sectionDocument()
    const materialized = sectionMaterialization(document, "section-1")!
    const added = applyOperation(document, { op: "addPrimitives", primitives: materialized })

    expect(added.changed).toBe(true)
    expect(added.document.primitives.filter((primitive) => primitive.type === "face3")).toHaveLength(1)

    // 删掉截面（它引用着立方体）之后，物化出来的几何必须原样存在。
    const removed = applyOperation(added.document, { op: "deleteObject", id: "section-1" })
    expect(removed.changed).toBe(true)
    expect(removed.document.primitives.filter((primitive) => primitive.type === "face3")).toHaveLength(1)
    expect(removed.document.primitives.filter((primitive) => primitive.type === "point3")).toHaveLength(5)
  })

  it("refuses to materialize something that is not a section or has no closed loop", () => {
    const document = sectionDocument()

    expect(sectionMaterialization(document, "cube-1")).toBeNull()
    expect(sectionMaterialization(document, "absent")).toBeNull()

    const degenerate = applyOperation(document, { op: "setSectionPlane", id: "section-1", normal: { x: 0, y: 0, z: 1 }, constant: -5 })
    expect(sectionMaterialization(degenerate.document, "section-1")).toBeNull()
  })
})
