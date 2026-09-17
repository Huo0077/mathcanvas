import { describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"
import { buildSolidTemplate } from "@draw/geometry-kernel"

import { applyOperation, commitPatch, getDependencyIndex, recomputeDerivedObjects } from "./index"

/** 两个沿 X 轴错开、彼此交叠的立方体模板（各带物化拓扑）：交叠区间是 2×4×4 的长方体。 */
function overlappingCubes() {
  const document = createEmptyDocument("geometry3d")
  const first = { id: "cube-a", type: "cube" as const, origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
  const second = { id: "cube-b", type: "cube" as const, origin: { x: 0, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
  document.primitives = [first, ...buildSolidTemplate(first).primitives, second, ...buildSolidTemplate(second).primitives]
  return document
}

/** 一个立方体完全落在另一个里面。 */
function nestedCubes() {
  const document = createEmptyDocument("geometry3d")
  const outer = { id: "cube-outer", type: "cube" as const, origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
  const inner = { id: "cube-inner", type: "cube" as const, origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }
  document.primitives = [outer, ...buildSolidTemplate(outer).primitives, inner, ...buildSolidTemplate(inner).primitives]
  return document
}

const pending = (sourceIds: [string, string]) => ({
  id: "solid-1",
  type: "intersectionSolid" as const,
  sourceIds,
  vertices: [],
  faces: [],
  volume: 0,
  area: 0,
  status: "none" as const
})

function resolved(document: ReturnType<typeof overlappingCubes>, sourceIds: [string, string] = ["cube-a", "cube-b"]) {
  const withSolid = applyOperation(document, { op: "addPrimitive", primitive: pending(sourceIds) }).document
  const solid = recomputeDerivedObjects(withSolid).primitives.find((primitive) => primitive.id === "solid-1")
  if (solid?.type !== "intersectionSolid") throw new Error("expected intersectionSolid")
  return solid
}

describe("intersection solid primitive", () => {
  it("materialises the boolean intersection of two overlapping cubes", () => {
    const solid = resolved(overlappingCubes())

    expect(solid.status).toBe("polyhedron")
    expect(solid.visible).toBe(true)
    // 交叠区间是 x∈[0,2]、y∈[-2,2]、z∈[-2,2]：体积 2×4×4 = 32。
    expect(solid.volume).toBeCloseTo(32, 6)
    // 表面积 = 2×16（两个 4×4 切口面）+ 4×8（四个 2×4 侧面）= 64。
    expect(solid.area).toBeCloseTo(64, 6)
    expect(solid.faces.length).toBe(6)
    for (const vertex of solid.vertices) {
      expect(vertex.x).toBeGreaterThanOrEqual(-1e-6)
      expect(vertex.x).toBeLessThanOrEqual(2 + 1e-6)
      expect(Math.abs(vertex.y)).toBeLessThanOrEqual(2 + 1e-6)
      expect(Math.abs(vertex.z)).toBeLessThanOrEqual(2 + 1e-6)
    }
  })

  it("returns the contained solid when one source sits inside the other", () => {
    // 布尔交集不是"切一刀"：完全包含时结果就是里面那个实体自己（体积 8、表面积 24）。
    const solid = resolved(nestedCubes(), ["cube-outer", "cube-inner"])

    expect(solid.status).toBe("polyhedron")
    expect(solid.volume).toBeCloseTo(8, 6)
    expect(solid.area).toBeCloseTo(24, 6)
  })

  it("keeps a flat intersection visible but reports that it has no volume", () => {
    const document = createEmptyDocument("geometry3d")
    const first = { id: "cube-a", type: "cube" as const, origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
    // 沿 X 方向正好贴面：交集是 4×4 的一块面，体积为 0。
    const second = { id: "cube-c", type: "cube" as const, origin: { x: 2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
    document.primitives = [first, ...buildSolidTemplate(first).primitives, second, ...buildSolidTemplate(second).primitives]

    const solid = resolved(document, ["cube-a", "cube-c"])
    expect(solid.status).toBe("flat")
    expect(solid.visible).toBe(true)
    expect(solid.volume).toBeCloseTo(0, 6)
    expect(solid.area).toBeCloseTo(16, 4)
    expect(solid.diagnostic).toContain("没有体积")
  })

  it("explains sources that do not overlap instead of keeping stale geometry", () => {
    const document = createEmptyDocument("geometry3d")
    const first = { id: "cube-a", type: "cube" as const, origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
    const faraway = { id: "cube-far", type: "cube" as const, origin: { x: 40, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
    document.primitives = [first, ...buildSolidTemplate(first).primitives, faraway, ...buildSolidTemplate(faraway).primitives]

    const solid = resolved(document, ["cube-a", "cube-far"])
    expect(solid.status).toBe("none")
    expect(solid.visible).toBe(false)
    expect(solid.vertices).toEqual([])
    expect(solid.faces).toEqual([])
    expect(solid.diagnostic).toContain("没有重叠")
  })

  it("explains a missing source and a source that is not a solid", () => {
    const missing = resolved(overlappingCubes(), ["cube-a", "gone"])
    expect(missing.status).toBe("insufficient-data")
    expect(missing.visible).toBe(false)
    expect(missing.diagnostic).toContain("不存在")

    // 面不是实体：布尔交集要的是"有体积的东西"，这里必须给诊断而不是硬算一个面出来。
    const document = overlappingCubes()
    const face = { id: "face-1", type: "face3" as const, pointIds: ["cube-a-point-1", "cube-a-point-2", "cube-a-point-3"] }
    const withFace = { ...document, primitives: [...document.primitives, face] }
    const flat = recomputeDerivedObjects({
      ...withFace,
      primitives: [...withFace.primitives, pending(["cube-a", "face-1"])]
    }).primitives.find((primitive) => primitive.id === "solid-1")
    if (flat?.type !== "intersectionSolid") throw new Error("expected intersectionSolid")
    expect(flat.status).toBe("insufficient-data")
    expect(flat.diagnostic).toContain("实体")
  })

  it("is a pure derived object: it follows its sources and is deleted with them", () => {
    const document = overlappingCubes()
    const withSolid = applyOperation(document, { op: "addPrimitive", primitive: pending(["cube-a", "cube-b"]) }).document

    const index = getDependencyIndex(withSolid)
    expect(index.get("cube-a")).toContain("solid-1")

    const deleted = commitPatch(withSolid, { op: "deleteObject", id: "cube-a" })
    expect(deleted.changed).toBe(true)
    expect(deleted.document.primitives.some((primitive) => primitive.id === "solid-1")).toBe(false)
  })
})
