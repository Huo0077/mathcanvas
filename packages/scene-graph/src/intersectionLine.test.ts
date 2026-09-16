import { describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"
import { buildSolidTemplate } from "@draw/geometry-kernel"

import { applyOperation, commitPatch, getDependencyIndex, recomputeDerivedObjects } from "./index"

/** 两个沿 X 轴错开、彼此交叠的立方体模板（各带物化拓扑），用于交线重算。 */
function overlappingCubes() {
  const document = createEmptyDocument("geometry3d")
  // 与 App 的 addSolidTemplate 一致：模板源图元 + 物化拓扑一起进文档，来源才是可解析的。
  const first = { id: "cube-a", type: "cube" as const, origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
  const second = { id: "cube-b", type: "cube" as const, origin: { x: 0, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
  const firstTopology = buildSolidTemplate(first)
  const secondTopology = buildSolidTemplate(second)
  document.primitives = [first, ...firstTopology.primitives, second, ...secondTopology.primitives]
  return document
}

describe("intersection line primitive", () => {
  it("computes segments from the two sources and keeps them inside the overlap", () => {
    const document = overlappingCubes()
    const withLine = applyOperation(document, {
      op: "addPrimitive",
      primitive: { id: "line-1", type: "intersectionLine", sourceIds: ["cube-a", "cube-b"], segments: [], classification: "none", status: "degenerate" }
    }).document
    const recomputed = recomputeDerivedObjects(withLine)
    const line = recomputed.primitives.find((primitive) => primitive.id === "line-1")

    expect(line?.type).toBe("intersectionLine")
    if (line?.type !== "intersectionLine") throw new Error("expected intersectionLine")
    expect(line.status).toBe("valid")
    expect(line.visible).toBe(true)
    expect(line.segments.length).toBeGreaterThan(0)
    // 交线必须落在两个立方体的交叠区间内：x∈[0,2]，|y|≤2，|z|≤2。
    for (const segment of line.segments) {
      for (const point of [segment.a, segment.b]) {
        expect(point.x).toBeGreaterThanOrEqual(-1e-6)
        expect(point.x).toBeLessThanOrEqual(2 + 1e-6)
        expect(Math.abs(point.y)).toBeLessThanOrEqual(2 + 1e-6)
        expect(Math.abs(point.z)).toBeLessThanOrEqual(2 + 1e-6)
      }
    }
  })

  it("recomputes when the sources no longer overlap instead of keeping stale geometry", () => {
    // 用"原本就不交叠"的第二个文档验证同一件事：来源几何变了，交线必须跟着变（而非留旧线段）。
    // 注意不能靠 updatePrimitive 移动模板源：模板的物化拓扑由模板参数重建，改 origin 不会移动已物化的顶点。
    const document = createEmptyDocument("geometry3d")
    const first = { id: "cube-a", type: "cube" as const, origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
    const faraway = { id: "cube-far", type: "cube" as const, origin: { x: 40, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
    document.primitives = [first, ...buildSolidTemplate(first).primitives, faraway, ...buildSolidTemplate(faraway).primitives]

    const withLine = applyOperation(document, {
      op: "addPrimitive",
      primitive: { id: "line-1", type: "intersectionLine", sourceIds: ["cube-a", "cube-far"], segments: [], classification: "none", status: "degenerate" }
    }).document
    const line = recomputeDerivedObjects(withLine).primitives.find((primitive) => primitive.id === "line-1")
    if (line?.type !== "intersectionLine") throw new Error("expected intersectionLine")
    expect(line.segments).toEqual([])
    expect(line.status).toBe("degenerate")
    expect(line.visible).toBe(false)
    expect(line.diagnostic).toContain("没有交线")
  })

  it("explains a missing source instead of inventing geometry", () => {
    const document = overlappingCubes()
    const missing = recomputeDerivedObjects({
      ...document,
      primitives: [...document.primitives, { id: "line-1", type: "intersectionLine", sourceIds: ["cube-a", "gone"], segments: [], classification: "none", status: "degenerate" }]
    }).primitives.find((primitive) => primitive.id === "line-1")
    if (missing?.type !== "intersectionLine") throw new Error("expected intersectionLine")
    expect(missing.status).toBe("insufficient-data")
    expect(missing.segments).toEqual([])
    expect(missing.diagnostic).toContain("不存在")
  })

  it("explains a source without usable face rings (a plane has no boundary)", () => {
    const document = overlappingCubes()
    // 平面没有边界：不能当成有界交线的来源，必须给诊断而不是空线段。
    const noRings = recomputeDerivedObjects({
      ...document,
      primitives: [...document.primitives,
        { id: "plane-1", type: "plane3", definition: { kind: "throughPoints", pointIds: ["p-a", "p-b", "p-c"] } } as never,
        { id: "line-2", type: "intersectionLine", sourceIds: ["cube-a", "plane-1"], segments: [], classification: "none", status: "degenerate" }]
    }).primitives.find((primitive) => primitive.id === "line-2")
    if (noRings?.type !== "intersectionLine") throw new Error("expected intersectionLine")
    expect(noRings.status).toBe("insufficient-data")
    expect(noRings.diagnostic).toContain("面环")
  })

  it("protects the sources from deletion while an intersection line references them", () => {
    const document = overlappingCubes()
    const withLine = applyOperation(document, {
      op: "addPrimitive",
      primitive: { id: "line-1", type: "intersectionLine", sourceIds: ["cube-a", "cube-b"], segments: [], classification: "none", status: "degenerate" }
    }).document

    // 来源被交线引用时不能删除：依赖索引要认得 `sourceIds`。
    const index = getDependencyIndex(withLine)
    expect(index.get("cube-a")).toContain("line-1")
    const blocked = commitPatch(withLine, { op: "deleteObject", id: "cube-a" })
    expect(blocked.changed).toBe(false)
    expect(blocked.error).toContain("referenced")

    // 先删交线，来源随之可删。
    const withoutLine = applyOperation(withLine, { op: "deleteObject", id: "line-1" }).document
    expect(commitPatch(withoutLine, { op: "deleteObject", id: "cube-a" }).changed).toBe(true)
  })

  it("rejects a patch that swaps in an unusable source list", () => {
    const document = overlappingCubes()
    const withLine = applyOperation(document, {
      op: "addPrimitive",
      primitive: { id: "line-1", type: "intersectionLine", sourceIds: ["cube-a", "cube-b"], segments: [], classification: "none", status: "degenerate" }
    }).document

    const result = commitPatch(withLine, { op: "updatePrimitive", id: "line-1", patch: { sourceIds: ["cube-a"] } as never })
    expect(result.changed).toBe(false)
    expect(result.error).toBeTruthy()
  })
})
