import { describe, expect, it } from "vitest"

import type { PrimitiveSpec } from "@draw/dsl"

import { constraintOptionsFor, measurementOptionsFor } from "./spatialTools"

const pointA: PrimitiveSpec = { id: "point-a", type: "point3", position: { x: 0, y: 0, z: 0 } }
const pointB: PrimitiveSpec = { id: "point-b", type: "point3", position: { x: 1, y: 0, z: 0 } }
const pointC: PrimitiveSpec = { id: "point-c", type: "point3", position: { x: 0, y: 1, z: 0 } }
const pointD: PrimitiveSpec = { id: "point-d", type: "point3", position: { x: 0, y: 0, z: 1 } }
const line: PrimitiveSpec = { id: "line-ab", type: "line3", definition: { kind: "throughPoints", pointIds: ["point-a", "point-b"] } }
const plane: PrimitiveSpec = { id: "plane-abc", type: "plane3", definition: { kind: "throughPoints", pointIds: ["point-a", "point-b", "point-c"] } }
const face: PrimitiveSpec = { id: "face-abc", type: "face3", pointIds: ["point-a", "point-b", "point-c"] }
const circle: PrimitiveSpec = { id: "circle-a", type: "circle3", centerId: "point-a", normal: { x: 0, y: 0, z: 1 }, radius: 2 }
const polyhedron: PrimitiveSpec = { id: "solid", type: "polyhedron3", vertexIds: ["point-a"], edgeIds: [], faceIds: ["face-abc"] }
const cube: PrimitiveSpec = { id: "cube-1", type: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 } }

const metrics = (selection: PrimitiveSpec[]) => measurementOptionsFor("geometry3d", selection).map((option) => option.metric)

describe("spatial measurement options", () => {
  it("offers no spatial tools for planar workspaces", () => {
    expect(measurementOptionsFor("calculus", [pointA, pointB])).toEqual([])
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
