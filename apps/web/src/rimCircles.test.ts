import { describe, expect, it } from "vitest"

import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { buildSolidTemplate } from "@draw/geometry-kernel"

import { collectRimCircles, rimChordEdgeIds } from "./rimCircles"

const cylinder = { id: "cylinder-1", type: "cylinder" as const, center: { x: 0, y: 0, z: 0 }, radius: 2, height: 3, segments: 48 }
const cone = { id: "cone-1", type: "cone" as const, center: { x: 0, y: 0, z: 0 }, radius: 2, height: 3, segments: 48 }
const cube = { id: "cube-1", type: "cube" as const, origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } }

const documentWith = (solid: typeof cylinder | typeof cone | typeof cube): GeometryDocument => {
  const document = createEmptyDocument("geometry3d")
  document.primitives = [solid, ...buildSolidTemplate(solid).primitives]
  return document
}

/**
 * A1 第 3 片漏做的一项：**3D 边界圆**。
 *
 * 48 段近似下圆柱的两圈底边是 96 条弦；画布现在用解析圆画它们（按屏幕误差细分），
 * 这些弦仍留在文档里（列表 / 拾取 / 面片要用），只是不再逐段画。
 */
describe("round solid rim circles", () => {
  it("collects two rims for a cylinder and one for a cone", () => {
    const cylinderRims = collectRimCircles(documentWith(cylinder))
    expect(cylinderRims).toHaveLength(1)
    expect(cylinderRims[0].id).toBe("cylinder-1")
    expect(cylinderRims[0].circles).toHaveLength(2)
    expect(cylinderRims[0].circles.every((circle) => circle.semiMajor === 2)).toBe(true)

    expect(collectRimCircles(documentWith(cone))[0].circles).toHaveLength(1)
    // 立方体没有边界圆：不该凭空造出两圈来。
    expect(collectRimCircles(documentWith(cube))).toEqual([])
  })

  it("finds exactly the ring chords (the two circles), not the generatrices", () => {
    const document = documentWith(cylinder)
    const ids = rimChordEdgeIds(document)
    const edges = document.primitives.filter((primitive) => primitive.type === "edge3")
    const generatrices = edges.filter((primitive) => primitive.type === "edge3" && primitive.tessellation === true)
    const rings = edges.filter((primitive) => primitive.type === "edge3" && primitive.tessellation !== true)

    // 48 段：两环各 48 条（都在集合里），母线 48 条（本来就不是可见棱，也不该进来）。
    expect(rings).toHaveLength(96)
    expect(generatrices).toHaveLength(48)
    expect(ids.size).toBe(96)
    expect(rings.every((primitive) => ids.has(primitive.id))).toBe(true)
    expect(generatrices.every((primitive) => !ids.has(primitive.id))).toBe(true)
  })

  it("reports nothing for a document without round solids", () => {
    const document = documentWith(cube)
    expect(rimChordEdgeIds(document).size).toBe(0)
  })

  it("keeps up with a rotated solid", () => {
    // 绕轴中点转 90°：边界圆跟着走，弦的判定也必须跟着走（不是只认未旋转的坐标）。
    const turned = { ...cylinder, rotation: { x: Math.PI / 2, y: 0, z: 0 } }
    const rims = collectRimCircles(documentWith(turned))[0].circles
    expect(rims).toHaveLength(2)
    expect(rims[0].frame.normal.y).toBeCloseTo(-1, 12)
    const ids = rimChordEdgeIds(documentWith(turned))
    expect(ids.size).toBe(96)
  })
})
