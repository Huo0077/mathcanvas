import { describe, expect, it } from "vitest"

import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { buildSolidTemplate } from "@draw/geometry-kernel"

import { canPreviewIntersection, resolveIntersectionPreview } from "./intersectionPreview3d"

/** 与 App 的 addSolidTemplate 一致：模板源图元 + 物化拓扑一起进文档。 */
function addCube(document: GeometryDocument, id: string, origin: { x: number; y: number; z: number }): GeometryDocument {
  const template = { id, type: "cube" as const, origin, size: { x: 4, y: 4, z: 4 } }
  const topology = buildSolidTemplate(template)
  return { ...document, primitives: [...document.primitives, template, ...topology.primitives] }
}

function twoOverlappingCubes(): GeometryDocument {
  const document = addCube(createEmptyDocument("geometry3d"), "cube-a", { x: -2, y: -2, z: -2 })
  return addCube(document, "cube-b", { x: 0, y: -2, z: -2 })
}

describe("3D intersection preview", () => {
  it("previews the real face intersection of two overlapping solids", () => {
    const preview = resolveIntersectionPreview(twoOverlappingCubes(), ["cube-a", "cube-b"])

    expect(preview.kind).toBe("intersection")
    expect(preview.sourceIds).toEqual(["cube-a", "cube-b"])
    expect(preview.segments.length).toBeGreaterThan(0)
    expect(preview.label).toContain("交线")
  })

  it("previews the default section for a single solid", () => {
    const document = addCube(createEmptyDocument("geometry3d"), "cube-a", { x: -2, y: -2, z: -2 })
    const preview = resolveIntersectionPreview(document, ["cube-a"])

    expect(preview.kind).toBe("section")
    expect(preview.points.length).toBeGreaterThanOrEqual(3)
    expect(preview.label).toContain("默认剖切平面截面")
  })

  it("explains a non-overlapping pair instead of drawing something", () => {
    const document = addCube(createEmptyDocument("geometry3d"), "cube-a", { x: -2, y: -2, z: -2 })
    const far = addCube(document, "cube-far", { x: 40, y: -2, z: -2 })
    const preview = resolveIntersectionPreview(far, ["cube-a", "cube-far"])

    expect(preview.kind).toBe("insufficient")
    expect(preview.segments).toEqual([])
    expect(preview.reason).toContain("没有交线")
  })

  it("refuses sources that cannot bound a line, and stays quiet with nothing or three selected", () => {
    const document = twoOverlappingCubes()
    const withPlane: GeometryDocument = {
      ...document,
      primitives: [...document.primitives, { id: "plane-1", type: "plane3", definition: { kind: "throughPoints", pointIds: ["p1", "p2", "p3"] } } as never]
    }
    const withPlanePreview = resolveIntersectionPreview(withPlane, ["cube-a", "plane-1"])
    expect(withPlanePreview.kind).toBe("insufficient")
    // 平面没有边界：必须说明原因，而不是给出一条假的交线。
    expect(withPlanePreview.reason).toContain("平面没有边界")

    expect(resolveIntersectionPreview(document, []).kind).toBe("none")
    // 三个及以上对象没有单一交线语义：保持安静，不猜其中任意一对。
    expect(resolveIntersectionPreview(twoOverlappingCubes(), ["cube-a", "cube-b", "cube-a"])).toMatchObject({ kind: "none" })
    // 平面不能参与交线预览。
    expect(canPreviewIntersection({ id: "p", type: "plane3", definition: { kind: "throughPoints", pointIds: [] } } as never)).toBe(false)
    expect(canPreviewIntersection(document.primitives.find((primitive) => primitive.id === "cube-a"))).toBe(true)
  })
})
