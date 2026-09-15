import { describe, expect, it } from "vitest"

import { createEmptyDocument, type GeometryDocument, type PrimitiveSpec } from "@draw/dsl"
import { buildSolidTemplate } from "@draw/geometry-kernel"

import { resolveProjectedDrawing } from "./projectionVisuals"

function topologyDocument(primitives: PrimitiveSpec[]): GeometryDocument {
  return { ...createEmptyDocument("cad"), primitives }
}

function tetrahedronPrimitives(): PrimitiveSpec[] {
  const points: PrimitiveSpec[] = [
    { id: "point-a", type: "point3", position: { x: 0, y: 0, z: 0 } },
    { id: "point-b", type: "point3", position: { x: 2, y: 0, z: 0 } },
    { id: "point-c", type: "point3", position: { x: 0, y: 2, z: 0 } },
    { id: "point-d", type: "point3", position: { x: 0, y: 0, z: 2 } }
  ]
  const edges: PrimitiveSpec[] = [
    { id: "edge-ab", type: "edge3", pointIds: ["point-a", "point-b"] },
    { id: "edge-ac", type: "edge3", pointIds: ["point-a", "point-c"] },
    { id: "edge-ad", type: "edge3", pointIds: ["point-a", "point-d"] },
    { id: "edge-bc", type: "edge3", pointIds: ["point-b", "point-c"] },
    { id: "edge-bd", type: "edge3", pointIds: ["point-b", "point-d"] },
    { id: "edge-cd", type: "edge3", pointIds: ["point-c", "point-d"] },
    { id: "edge-missing", type: "edge3", pointIds: ["point-a", "missing-point"] }
  ]
  const faces: PrimitiveSpec[] = [
    { id: "face-abc", type: "face3", pointIds: ["point-a", "point-b", "point-c"] },
    { id: "face-abd", type: "face3", pointIds: ["point-a", "point-b", "point-d"] },
    { id: "face-acd", type: "face3", pointIds: ["point-a", "point-c", "point-d"] },
    { id: "face-bcd", type: "face3", pointIds: ["point-b", "point-c", "point-d"] }
  ]
  const solid: PrimitiveSpec = {
    id: "solid-1",
    type: "polyhedron3",
    vertexIds: ["point-a", "point-b", "point-c", "point-d"],
    edgeIds: ["edge-ab", "edge-ac", "edge-ad", "edge-bc", "edge-bd", "edge-cd"],
    faceIds: ["face-abc", "face-abd", "face-acd", "face-bcd"]
  }
  return [...points, ...edges, ...faces, solid]
}

describe("renderer-neutral engineering drawing projections", () => {
  it("resolves stable source IDs, closed faces, and finite depths", () => {
    const drawing = resolveProjectedDrawing(topologyDocument(tetrahedronPrimitives()), "front")

    expect(drawing.view).toBe("front")
    expect(drawing.primitives.map((primitive) => primitive.sourceId)).toEqual(expect.arrayContaining(["point-a", "edge-ab", "face-abc"]))
    expect(drawing.primitives.some((primitive) => primitive.sourceId === "solid-1")).toBe(false)
    const polygon = drawing.primitives.find((primitive) => primitive.kind === "polygon" && primitive.sourceId === "face-abc")
    expect(polygon?.kind).toBe("polygon")
    if (polygon?.kind === "polygon") {
      expect(polygon.points.length).toBe(4)
      expect(polygon.points[0]).toEqual(polygon.points.at(-1))
      expect(Number.isFinite(polygon.depth)).toBe(true)
    }
    drawing.primitives.forEach((primitive) => {
      if (primitive.kind === "point") expect(Number.isFinite(primitive.point.depth)).toBe(true)
      else primitive.points.forEach((point) => expect(Number.isFinite(point.depth)).toBe(true))
    })
  })

  it("reports missing references without fabricating a projected origin", () => {
    const drawing = resolveProjectedDrawing(topologyDocument(tetrahedronPrimitives()), "top")

    expect(drawing.diagnostics).toEqual(expect.arrayContaining([expect.stringContaining("edge-missing")]))
    expect(drawing.primitives.some((primitive) => primitive.sourceId === "edge-missing")).toBe(false)
  })

  it("orders projected records by depth and stable source ID", () => {
    const drawing = resolveProjectedDrawing(topologyDocument([
      { id: "point-far", type: "point3", position: { x: 0, y: 0, z: 4 } },
      { id: "point-near", type: "point3", position: { x: 0, y: 0, z: -2 } },
      { id: "point-same-depth-b", type: "point3", position: { x: 1, y: 0, z: 0 } },
      { id: "point-same-depth-a", type: "point3", position: { x: 0, y: 1, z: 0 } }
    ]), "front")

    expect(drawing.primitives.map((primitive) => primitive.sourceId)).toEqual([
      "point-near",
      "point-same-depth-a",
      "point-same-depth-b",
      "point-far"
    ])
  })

  it("describes cross-view projection links for each stable source", () => {
    const drawing = resolveProjectedDrawing(topologyDocument(tetrahedronPrimitives()), "front")

    expect(drawing.projectionLines.length).toBeGreaterThan(0)
    expect(drawing.projectionLines.every((line) => line.originView === "front")).toBe(true)
    expect(drawing.projectionLines.some((line) => line.sourceId === "point-a" && line.targetView === "top")).toBe(true)
  })

  it("does not render a parameterized template source beside its materialized topology", () => {
    const source: Extract<PrimitiveSpec, { type: "cube" }> = {
      id: "cube-source",
      type: "cube",
      origin: { x: 0, y: 0, z: 0 },
      size: { x: 2, y: 2, z: 2 }
    }
    const generated = buildSolidTemplate(source)
    const drawing = resolveProjectedDrawing(topologyDocument([source, ...generated.primitives]), "axonometric")
    const sourceIds = drawing.primitives.map((primitive) => primitive.sourceId)

    expect(sourceIds).not.toContain(source.id)
    expect(new Set(sourceIds).size).toBe(sourceIds.length)
    expect(sourceIds).toEqual(expect.arrayContaining(generated.vertexIds))
    expect(sourceIds).toEqual(expect.arrayContaining(generated.edgeIds))
    expect(sourceIds).toEqual(expect.arrayContaining(generated.faceIds))
  })
})
