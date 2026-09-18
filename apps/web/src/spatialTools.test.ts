import { describe, expect, it } from "vitest"

import type { PrimitiveSpec } from "@draw/dsl"

import { constraintOptionsFor, measurementOptionsFor, point3ToolAvailability, point3ToolHint } from "./spatialTools"

const pointA: PrimitiveSpec = { id: "point-a", type: "point3", position: { x: 0, y: 0, z: 0 } }
const pointB: PrimitiveSpec = { id: "point-b", type: "point3", position: { x: 1, y: 0, z: 0 } }
const pointC: PrimitiveSpec = { id: "point-c", type: "point3", position: { x: 0, y: 1, z: 0 } }
const pointD: PrimitiveSpec = { id: "point-d", type: "point3", position: { x: 0, y: 0, z: 1 } }
const line: PrimitiveSpec = { id: "line-ab", type: "line3", definition: { kind: "throughPoints", pointIds: ["point-a", "point-b"] } }
const plane: PrimitiveSpec = { id: "plane-abc", type: "plane3", definition: { kind: "throughPoints", pointIds: ["point-a", "point-b", "point-c"] } }
const face: PrimitiveSpec = { id: "face-abc", type: "face3", pointIds: ["point-a", "point-b", "point-c"] }
const circle: PrimitiveSpec = { id: "circle-a", type: "circle3", center: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, radius: 2 }
const polyhedron: PrimitiveSpec = { id: "solid", type: "polyhedron3", vertexIds: ["point-a"], edgeIds: [], faceIds: ["face-abc"] }
const cube: PrimitiveSpec = { id: "cube-1", type: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 } }

const metrics = (selection: PrimitiveSpec[]) => measurementOptionsFor("geometry3d", selection).map((option) => option.metric)

describe("planar measurement options", () => {
  const planarPoint = (id: string, x: number, y: number): PrimitiveSpec => ({ id, type: "point", x, y })
  const a = planarPoint("a", 0, 0)
  const b = planarPoint("b", 1, 0)
  const c = planarPoint("c", 0, 1)

  it("offers only measurements the kernel can actually evaluate for the selection", () => {
    expect(measurementOptionsFor("calculus", [a, b]).map((option) => option.metric)).toEqual(["length"])
    expect(measurementOptionsFor("conics", [a, b, c]).map((option) => option.metric)).toEqual(["angle", "area", "distance"])
  })

  it("offers nothing for a selection that is not all planar points", () => {
    // A 3D point in a planar workspace is not a planar point.
    expect(measurementOptionsFor("calculus", [pointA, pointB])).toEqual([])
    expect(measurementOptionsFor("conics", [a])).toEqual([])
    expect(measurementOptionsFor("conics", [a, b, c, planarPoint("d", 1, 1)])).toEqual([])
    const line: PrimitiveSpec = { id: "l", type: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }
    expect(measurementOptionsFor("conics", [a, b, line])).toEqual([])
  })

  it("states the angle-vertex convention in the button label", () => {
    const angle = measurementOptionsFor("conics", [a, b, c]).find((option) => option.metric === "angle")
    expect(angle?.label).toContain("顶点")
    // The existing button signature carries the interior/exterior choice.
    expect(angle?.dihedralKind).toBe("interior")
  })
})

describe("spatial measurement options", () => {
  it("offers no spatial constraints for planar workspaces", () => {
    expect(constraintOptionsFor("calculus", [line, line])).toEqual([])
  })

  it("offers length for a line or two points but never for a face or circle", () => {
    expect(metrics([line])).toContain("length")
    expect(metrics([pointA, pointB])).toContain("length")
    expect(metrics([face])).not.toContain("length")
    expect(metrics([circle])).not.toContain("length")
  })

  it("offers distance for two points, a point with a line, and a point with a plane", () => {
    expect(metrics([pointA, pointB])).toContain("distance")
    expect(metrics([line, pointA])).toContain("distance")
    expect(metrics([plane, pointA])).toContain("distance")
    expect(metrics([pointA])).not.toContain("distance")
  })

  it("offers area and volume from inputs the kernel can actually evaluate", () => {
    expect(metrics([face])).toContain("area")
    expect(metrics([circle])).toContain("area")
    expect(metrics([pointA, pointB, pointC])).toContain("area")
    expect(metrics([polyhedron])).toContain("volume")
    expect(metrics([cube])).toContain("volume")
    expect(metrics([face])).not.toContain("volume")
  })

  it("offers dihedral only for two faces", () => {
    expect(metrics([face, face])).toContain("dihedral")
    expect(metrics([face, plane])).not.toContain("dihedral")
  })
})

describe("spatial constraint options", () => {
  it("offers parallel and perpendicular for two lines", () => {
    const types = constraintOptionsFor("geometry3d", [line, line]).map((option) => option.type)
    expect(types).toContain("parallel")
    expect(types).toContain("perpendicular")
  })

  it("orders point-on-line targets as point then line regardless of click order", () => {
    expect(constraintOptionsFor("geometry3d", [line, pointA])).toEqual([{ type: "pointOnLine", label: "点在线", targets: ["point-a", "line-ab"] }])
    expect(constraintOptionsFor("geometry3d", [pointA, line])).toEqual([{ type: "pointOnLine", label: "点在线", targets: ["point-a", "line-ab"] }])
  })

  it("orders point-on-plane targets as point then plane regardless of click order", () => {
    expect(constraintOptionsFor("geometry3d", [plane, pointA])).toEqual([{ type: "pointOnPlane", label: "点在面", targets: ["point-a", "plane-abc"] }])
  })

  it("requires three points for collinear and four for coplanar", () => {
    expect(constraintOptionsFor("geometry3d", [pointA, pointB, pointC]).map((option) => option.type)).toContain("collinear")
    expect(constraintOptionsFor("geometry3d", [pointA, pointB]).map((option) => option.type)).not.toContain("collinear")
    expect(constraintOptionsFor("geometry3d", [pointA, pointB, pointC, pointD]).map((option) => option.type)).toContain("coplanar")
    expect(constraintOptionsFor("geometry3d", [pointA, pointB, pointC]).map((option) => option.type)).not.toContain("coplanar")
  })
})

describe("create-from-selected-points tools", () => {
  it("gates each tool on a selection made only of spatial points", () => {
    expect(point3ToolAvailability(2, 2)).toEqual({ line: true, plane: false, face: false, circle: true })
    expect(point3ToolAvailability(3, 3)).toEqual({ line: false, plane: true, face: true, circle: true })
    expect(point3ToolAvailability(4, 4)).toEqual({ line: false, plane: false, face: true, circle: false })
    // A face picked alongside the points must not silently satisfy the tool.
    expect(point3ToolAvailability(2, 3)).toEqual({ line: false, plane: false, face: false, circle: false })
    expect(point3ToolAvailability(0, 0)).toEqual({ line: false, plane: false, face: false, circle: false })
  })

  /**
   * 圆轨道的三条路：1 个点定圆心（法向默认 +Z）、2 个点再定半径、3 个点顺带定平面。
   * 超过 3 个点就没有唯一的圆可言了——如实不给入口，而不是拿前三个凑一个。
   */
  it("offers the circle track for one to three spatial points only", () => {
    expect(point3ToolAvailability(1, 1).circle).toBe(true)
    expect(point3ToolAvailability(3, 3).circle).toBe(true)
    expect(point3ToolAvailability(4, 4).circle).toBe(false)
  })

  it("spells out the shift-click requirement until the selection qualifies", () => {
    expect(point3ToolHint(0)).toContain("Shift")
    expect(point3ToolHint(1)).toContain("圆轨道")
    expect(point3ToolHint(2)).toContain("直线")
    expect(point3ToolHint(2)).toContain("圆轨道")
    expect(point3ToolHint(2)).not.toContain("平面")
    expect(point3ToolHint(3)).toContain("平面")
    expect(point3ToolHint(3)).toContain("空间面")
    expect(point3ToolHint(5)).toContain("空间面")
  })
})
