import { describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"
import { buildSolidTemplate } from "./solid-builders"
import { coneSurfaceHost3, cylinderSurfaceHost3, faceHost3, host3FromPrimitive, lineHost3, planeHost3 } from "./hosts3"

const a = { x: 0, y: 0, z: 0 }
const b = { x: 2, y: 0, z: 0 }

describe("line hosts", () => {
  it("evaluates the affine parameter and reports its domain", () => {
    const segment = lineHost3(a, b, "segment")!
    expect(segment.evaluate({ u: 0 })).toEqual(a)
    expect(segment.evaluate({ u: 0.5 })).toEqual({ x: 1, y: 0, z: 0 })
    expect(segment.evaluate({ u: 1 })).toEqual(b)
    expect(segment.domain.u).toEqual([0, 1])
    expect(segment.kind).toBe("segment")
    expect(lineHost3(a, b, "ray")!.domain.u).toEqual([0, Number.POSITIVE_INFINITY])
    expect(lineHost3(a, b, "line")!.domain.u).toEqual([Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY])
  })

  it("clamps the closest parameter into the domain instead of leaving the host", () => {
    expect(lineHost3(a, b, "segment")!.closestParameter({ x: 5, y: 3, z: 0 })).toEqual({ u: 1 })
    expect(lineHost3(a, b, "line")!.closestParameter({ x: 5, y: 3, z: 0 }).u).toBeCloseTo(2.5, 10)
    expect(lineHost3(a, b, "ray")!.closestParameter({ x: -4, y: 0, z: 0 })).toEqual({ u: 0 })
  })

  it("projects and measures the residual", () => {
    const segment = lineHost3(a, b, "segment")!
    const projected = segment.project({ x: 1, y: 3, z: 0 })
    expect(projected.point).toEqual({ x: 1, y: 0, z: 0 })
    expect(projected.distance).toBeCloseTo(3, 10)
    expect(segment.residual({ x: 1, y: 3, z: 0 })).toBeCloseTo(3, 10)
    // 落在宿主上的点残差为 0 —— 这是"点永远贴住宿主"的可测判据。
    expect(segment.residual({ x: 0.25, y: 0, z: 0 })).toBeCloseTo(0, 10)
  })

  it("refuses degenerate hosts", () => {
    expect(lineHost3(a, { x: 0, y: 0, z: 0 }, "segment")).toBeNull()
  })
})

describe("face and plane hosts", () => {
  // 4×4 的正方形，落在 z = 0 平面上。
  const square = [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 4, z: 0 }, { x: 0, y: 4, z: 0 }]

  it("projects points inside the ring onto the plane, and clamps the rest to the boundary", () => {
    const face = faceHost3(square)!
    expect(face.kind).toBe("face")
    expect(face.evaluate({ u: 1, v: 2 })).toEqual({ x: 1, y: 2, z: 0 })
    expect(face.domain.u).toEqual([0, 4])
    expect(face.domain.v).toEqual([0, 4])

    // 环内：正交投影，残差就是到平面的距离。
    expect(face.project({ x: 2, y: 2, z: 5 }).point).toEqual({ x: 2, y: 2, z: 0 })
    expect(face.residual({ x: 2, y: 2, z: 5 })).toBeCloseTo(5, 10)

    // 一条边外：夹到最近的那条边上，而不是留在平面里的虚空处。
    expect(face.project({ x: 6, y: 2, z: 0 }).point).toEqual({ x: 4, y: 2, z: 0 })
    expect(face.residual({ x: 6, y: 2, z: 0 })).toBeCloseTo(2, 10)

    // 对角外侧：夹到最近的顶点。
    expect(face.project({ x: 6, y: 6, z: 0 }).point).toEqual({ x: 4, y: 4, z: 0 })
    expect(face.residual({ x: 6, y: 6, z: 0 })).toBeCloseTo(Math.hypot(2, 2), 10)
  })

  it("refuses rings that are not coplanar or too small", () => {
    expect(faceHost3([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }])).toBeNull()
    expect(faceHost3([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }])).toBeNull()
    expect(faceHost3([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 3 }])).toBeNull()
  })

  it("keeps a plane host unbounded", () => {
    const plane = planeHost3({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })!
    expect(plane.kind).toBe("plane")
    expect(plane.domain.u).toEqual([Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY])
    expect(plane.project({ x: 3, y: 4, z: 9 }).point).toEqual({ x: 3, y: 4, z: 0 })
    expect(plane.residual({ x: 3, y: 4, z: 9 })).toBeCloseTo(9, 10)
    expect(plane.residual({ x: 3, y: 4, z: 0 })).toBeCloseTo(0, 10)
  })
})

describe("surface hosts", () => {
  const center = { x: 0, y: 0, z: 0 }

  it("puts cylinder points on the lateral surface and clamps the axial parameter", () => {
    const cylinder = cylinderSurfaceHost3(center, 2, 4)!
    expect(cylinder.kind).toBe("cylinder-surface")
    expect(cylinder.domain.u).toEqual([0, Math.PI * 2])
    expect(cylinder.domain.closedU).toBe(true)
    expect(cylinder.evaluate({ u: 0, v: 0.5 }).x).toBeCloseTo(2, 10)
    expect(cylinder.evaluate({ u: 0, v: 0.5 }).z).toBeCloseTo(2, 10)

    // 侧面上的点残差为 0。
    expect(cylinder.residual({ x: 2, y: 0, z: 2 })).toBeCloseTo(0, 10)
    // 轴上的点沿半径投影到最近的侧面点。
    const onAxis = cylinder.project({ x: 0, y: 0, z: 2 })
    expect(onAxis.distance).toBeCloseTo(2, 10)
    expect(Math.hypot(onAxis.point.x, onAxis.point.y)).toBeCloseTo(2, 10)
    // 超出高度的点把 v 夹到端点，而不是跑到侧面之外。
    expect(cylinder.project({ x: 2, y: 0, z: 9 }).parameter.v).toBeCloseTo(1, 10)
    expect(cylinder.project({ x: 2, y: 0, z: -3 }).parameter.v).toBeCloseTo(0, 10)
    expect(cylinderSurfaceHost3(center, 0, 4)).toBeNull()
    expect(cylinderSurfaceHost3(center, 2, 0)).toBeNull()
  })

  it("solves the cone's closest point in closed form", () => {
    const cone = coneSurfaceHost3(center, 2, 4)!
    expect(cone.kind).toBe("cone-surface")
    // 顶点。
    expect(cone.evaluate({ u: 0, v: 1 }).z).toBeCloseTo(4, 10)
    expect(Math.hypot(cone.evaluate({ u: 0, v: 1 }).x, cone.evaluate({ u: 0, v: 1 }).y)).toBeCloseTo(0, 10)
    // 母线上的点：v = 0.5 处半径 1。
    expect(cone.residual({ x: 1, y: 0, z: 2 })).toBeCloseTo(0, 10)
    expect(cone.closestParameter({ x: 1, y: 0, z: 2 }).v).toBeCloseTo(0.5, 10)
    // 轴上的点：最小化 (2v-2)² + (2-4v)² ⇒ v = 0.6、距离 √0.8。
    const onAxis = cone.project({ x: 0, y: 0, z: 2 })
    expect(onAxis.parameter.v).toBeCloseTo(0.6, 10)
    expect(onAxis.distance).toBeCloseTo(Math.sqrt(0.8), 10)
    expect(coneSurfaceHost3(center, 2, 0)).toBeNull()
  })

  it("folds the azimuthal parameter back into [0, 2π)", () => {
    const cylinder = cylinderSurfaceHost3(center, 2, 4)!
    const behind = cylinder.closestParameter({ x: -2, y: -1e-12, z: 1 })
    expect(behind.u).toBeGreaterThanOrEqual(0)
    expect(behind.u).toBeLessThan(Math.PI * 2)
    expect(behind.u).toBeCloseTo(Math.PI, 6)
  })
})

describe("host resolution from primitives", () => {
  const cylinder = { id: "cylinder-1", type: "cylinder" as const, center: { x: 0, y: 0, z: 0 }, radius: 2, height: 4, segments: 8 }

  it("resolves the hosts the DSL can express, and refuses the rest", () => {
    const built = buildSolidTemplate(cylinder)
    const document = { ...createEmptyDocument("geometry3d"), primitives: [cylinder, ...built.primitives] }
    const map = new Map(document.primitives.map((primitive) => [primitive.id, primitive]))
    const polyhedron = document.primitives.find((primitive) => primitive.type === "polyhedron3")!
    const edge = document.primitives.find((primitive) => primitive.type === "edge3")!
    const face = document.primitives.find((primitive) => primitive.type === "face3")!

    expect(host3FromPrimitive(cylinder, map)?.kind).toBe("cylinder-surface")
    // 棱的 kind 是 "edge"（而不是 "segment"）：它保留来源信息，但参数域与线段相同。
    expect(host3FromPrimitive(edge, map)?.kind).toBe("edge")
    expect(host3FromPrimitive(edge, map)?.domain.u).toEqual([0, 1])
    expect(host3FromPrimitive(face, map)?.kind).toBe("face")
    // 多面体与孤立的点不是宿主。
    expect(host3FromPrimitive(polyhedron, map)).toBeNull()
    expect(host3FromPrimitive(document.primitives.find((primitive) => primitive.type === "point3")!, map)).toBeNull()
  })

  it("returns null when the referenced points are missing", () => {
    const dangling = { id: "edge-x", type: "edge3" as const, pointIds: ["missing-a", "missing-b"] as [string, string] }
    const document = createEmptyDocument("geometry3d")
    const map = new Map([[dangling.id, dangling]])
    expect(host3FromPrimitive(dangling, document.primitives)).toBeNull()
    expect(host3FromPrimitive(dangling, map)).toBeNull()
  })
})
