import { describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"
import { buildSolidTemplate } from "@draw/geometry-kernel"

import { applyOperation, commitPatch, createFace3, createLine3, createPoint3, createPolyhedron3, getAffectedPrimitiveIds, getDependencyIndex, patchPoint3, recomputeDerivedObjects, resolvePolyhedronTopology, sectionPlaneThroughSource } from "./index"

describe("scene graph operations", () => {
  it("recomputes template topology when legacy solid parameters change", () => {
    const source = { id: "cube-1", type: "cube" as const, origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 }, label: "立方体 1" }
    const topology = buildSolidTemplate(source)
    const document = createEmptyDocument("geometry3d")
    document.primitives = [source, ...topology.primitives]

    const updated = commitPatch(document, { op: "updatePrimitive", id: source.id, patch: { size3: { x: 5, y: 2, z: 2 } } })
    expect(updated.changed).toBe(true)
    const point = updated.document.primitives.find((primitive) => primitive.id === topology.vertexIds[1])
    expect(point).toMatchObject({ type: "point3", position: { x: 4 } })
  })

  it("materializes a template when a generated point is edited", () => {
    const source = { id: "cube-1", type: "cube" as const, origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 }, label: "立方体 1" }
    const topology = buildSolidTemplate(source)
    const document = createEmptyDocument("geometry3d")
    document.primitives = [source, ...topology.primitives]

    const updated = commitPatch(document, { op: "updatePrimitive", id: topology.vertexIds[0], patch: { position3: { x: -2, y: -1, z: -1 } } })
    const polyhedron = updated.document.primitives.find((primitive) => primitive.type === "polyhedron3")
    expect(updated.changed).toBe(true)
    expect(polyhedron).toMatchObject({ construction: { kind: "fromFaces" } })
    expect(updated.document.primitives.find((primitive) => primitive.id === topology.vertexIds[0])).toMatchObject({ position: { x: -2 } })
  })

  it("creates point-driven 3D primitives with stable topology references", () => {
    const pointA = createPoint3("point-a", { x: 0, y: 0, z: 0 })
    const pointB = createPoint3("point-b", { x: 1, y: 0, z: 0 })
    const pointC = createPoint3("point-c", { x: 0, y: 1, z: 0 })
    const pointD = createPoint3("point-d", { x: 0, y: 0, z: 1 })
    const line = createLine3("line-ab", [pointA.id, pointB.id])
    const face = createFace3("face-abc", [pointA.id, pointB.id, pointC.id])
    const solid = createPolyhedron3("solid-abcd", [pointA.id, pointB.id, pointC.id, pointD.id], ["edge-ab"], [face.id])
    const document = createEmptyDocument("geometry3d")
    document.primitives = [pointA, pointB, pointC, pointD, line, face, solid]

    expect(line.definition).toEqual({ kind: "throughPoints", pointIds: ["point-a", "point-b"] })
    expect(face.pointIds).toEqual(["point-a", "point-b", "point-c"])
    expect(solid.vertexIds).toEqual(["point-a", "point-b", "point-c", "point-d"])
    expect(getDependencyIndex(document).get("point-a")).toEqual(new Set(["line-ab", "face-abc", "solid-abcd"]))
  })

  it("patches a point3 through the same immutable operation pipeline", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [createPoint3("point-a", { x: 0, y: 0, z: 0 })]

    const result = applyOperation(document, patchPoint3("point-a", { x: 2, y: 3, z: 4 }))

    expect(result.changed).toBe(true)
    expect(result.document).not.toBe(document)
    expect(result.document.primitives[0]).toMatchObject({ type: "point3", position: { x: 2, y: 3, z: 4 } })
  })

  it("recomputes a point3 bound to a line3 after its source point moves", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      createPoint3("point-a", { x: 0, y: 0, z: 0 }),
      createPoint3("point-b", { x: 2, y: 0, z: 0 }),
      createLine3("line-ab", ["point-a", "point-b"]),
      createPoint3("point-on-line", { x: 0, y: 0, z: 0 }, { kind: "onLine", lineId: "line-ab", parameter: 0.5 })
    ]

    const result = applyOperation(document, patchPoint3("point-a", { x: 2, y: 0, z: 0 }))
    const boundPoint = result.document.primitives.find((primitive) => primitive.id === "point-on-line")

    expect(boundPoint).toMatchObject({ position: { x: 2, y: 0, z: 0 } })
    expect([...getAffectedPrimitiveIds(document, ["point-a"])]).toEqual(["point-a", "line-ab", "point-on-line"])
  })

  it("recomputes chained point3 bindings regardless of document order", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      createPoint3("point-a", { x: 0, y: 0, z: 0 }),
      createPoint3("point-b", { x: 2, y: 0, z: 0 }),
      createPoint3("point-midpoint", { x: 0, y: 0, z: 0 }, { kind: "derived", sourceIds: ["point-on-line", "point-b"], feature: "midpoint" }),
      createPoint3("point-on-line", { x: 0, y: 0, z: 0 }, { kind: "onLine", lineId: "line-ab", parameter: 0.5 }),
      createLine3("line-ab", ["point-a", "point-b"])
    ]

    const result = recomputeDerivedObjects(document, ["point-a"])

    expect(result.primitives.find((primitive) => primitive.id === "point-on-line")).toMatchObject({ position: { x: 1, y: 0, z: 0 } })
    expect(result.primitives.find((primitive) => primitive.id === "point-midpoint")).toMatchObject({ position: { x: 1.5, y: 0, z: 0 } })
  })

  it("protects 3D source points and topology objects from deletion", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      createPoint3("point-a", { x: 0, y: 0, z: 0 }),
      createPoint3("point-b", { x: 1, y: 0, z: 0 }),
      createLine3("line-ab", ["point-a", "point-b"])
    ]

    const pointResult = commitPatch(document, { op: "deleteObject", id: "point-a" })
    const lineResult = commitPatch(document, { op: "deleteObject", id: "line-ab" })

    expect(pointResult.changed).toBe(false)
    expect(pointResult.error).toContain("referenced")
    expect(lineResult.changed).toBe(true)
  })
  it("updates a parameter without mutating the previous document", () => {
    const before = createEmptyDocument("calculus")
    const result = applyOperation(before, { op: "setParameter", id: "slope", value: 2 })

    expect(before.parameters.slope).toBeUndefined()
    expect(result.document.parameters.slope?.value).toBe(2)
  })

  it("recomputes expression parameters after a base parameter update", () => {
    const before = createEmptyDocument("calculus")
    before.parameters = {
      slope: { id: "slope", value: 2 },
      doubled: { id: "doubled", value: 4, expression: "slope * 2" }
    }

    const result = applyOperation(before, { op: "setParameter", id: "slope", value: 3 })

    expect(result.changed).toBe(true)
    expect(result.document.parameters.doubled.value).toBe(6)
  })

  it("rejects circular expression parameters without mutating the document", () => {
    const before = createEmptyDocument("calculus")
    before.parameters = {
      first: { id: "first", value: 1, expression: "second + 1" },
      second: { id: "second", value: 2, expression: "first + 1" }
    }

    const result = applyOperation(before, { op: "setParameterExpression", id: "first", expression: "second + 1" })

    expect(result.changed).toBe(false)
    expect(result.document).toBe(before)
    expect(result.error).toContain("Circular parameter reference")
  })

  it("tracks only the dependent primitives for a parameter change", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "line-a", type: "line", a: { x: -1, y: 0 }, b: { x: 1, y: 1 }, slopeParameter: "slope" },
      { id: "line-b", type: "line", a: { x: -1, y: 1 }, b: { x: 1, y: 0 } },
      { id: "intersection", type: "intersection", lineA: "line-a", lineB: "line-b", x: 0, y: 0 },
      { id: "unrelated", type: "point", x: 2, y: 2 }
    ]
    expect([...getAffectedPrimitiveIds(document, ["slope"])]).toEqual(["slope", "line-a", "intersection"])
    expect(recomputeDerivedObjects(document, ["slope"]).primitives.find((primitive) => primitive.id === "unrelated")).toEqual(document.primitives[3])
  })

  it("recomputes a point bound to a circle path", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "circle-1", type: "circle", center: { x: 1, y: 2 }, radius: 3 },
      { id: "point-1", type: "point", x: 0, y: 0, binding: { kind: "onPath", pathId: "circle-1", parameter: 0.25 } }
    ]

    const recomputed = recomputeDerivedObjects(document)
    const point = recomputed.primitives.find((primitive) => primitive.id === "point-1")
    expect(point?.type).toBe("point")
    if (point?.type === "point") {
      expect(point.x).toBeCloseTo(1)
      expect(point.y).toBeCloseTo(5)
    }
  })

  it("recomputes a persisted section when its solid source changes", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "cube-1", type: "cube", origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } },
      { id: "section-1", type: "section", sourceId: "cube-1", plane: { normal: { x: 0, y: 0, z: 1 }, constant: 0 }, points: [], classification: "none", status: "undefined" }
    ]

    const initial = recomputeDerivedObjects(document)
    expect(initial.primitives.find((primitive) => primitive.id === "section-1")).toMatchObject({ status: "approximate", visible: true, points: expect.any(Array) })

    const moved = structuredClone(initial) as typeof initial
    const cube = moved.primitives.find((primitive) => primitive.id === "cube-1")
    if (cube?.type === "cube") cube.origin.z = 4
    const updated = recomputeDerivedObjects(moved, ["cube-1"])
    expect(updated.primitives.find((primitive) => primitive.id === "section-1")).toMatchObject({ status: "undefined", visible: false, points: [] })
  })

  it("cuts materialized point-driven topology with an ordered classified boundary", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      createPoint3("v0", { x: -1, y: -1, z: -1 }), createPoint3("v1", { x: 1, y: -1, z: -1 }), createPoint3("v2", { x: 1, y: 1, z: -1 }), createPoint3("v3", { x: -1, y: 1, z: -1 }),
      createPoint3("v4", { x: -1, y: -1, z: 1 }), createPoint3("v5", { x: 1, y: -1, z: 1 }), createPoint3("v6", { x: 1, y: 1, z: 1 }), createPoint3("v7", { x: -1, y: 1, z: 1 }),
      createFace3("f-bottom", ["v0", "v1", "v2", "v3"]), createFace3("f-top", ["v4", "v5", "v6", "v7"]), createFace3("f-front", ["v0", "v1", "v5", "v4"]),
      createFace3("f-right", ["v1", "v2", "v6", "v5"]), createFace3("f-back", ["v2", "v3", "v7", "v6"]), createFace3("f-left", ["v3", "v0", "v4", "v7"]),
      createPolyhedron3("solid-1", ["v0", "v1", "v2", "v3", "v4", "v5", "v6", "v7"], [], ["f-bottom", "f-top", "f-front", "f-right", "f-back", "f-left"]),
      { id: "section-1", type: "section", sourceId: "solid-1", plane: { normal: { x: 0, y: 0, z: 1 }, constant: 0 }, points: [], classification: "none", status: "undefined" }
    ]

    const recomputed = recomputeDerivedObjects(document)
    const section = recomputed.primitives.find((primitive) => primitive.id === "section-1")
    expect(section).toMatchObject({ classification: "polygon", status: "approximate", visible: true })

    const points = section?.type === "section" ? section.points : []
    expect(points).toHaveLength(4)
    for (let index = 0; index < points.length; index += 1) {
      const next = points[(index + 1) % points.length]
      expect(Math.hypot(points[index].x - next.x, points[index].y - next.y, points[index].z - next.z)).toBeCloseTo(2, 6)
    }

    const moved = applyOperation(recomputed, patchPoint3("v7", { x: 3, y: 1, z: 1 }))
    const movedSection = moved.document.primitives.find((primitive) => primitive.id === "section-1")
    expect(movedSection).toMatchObject({ classification: "polygon", visible: true })
    expect(movedSection?.type === "section" && movedSection.points.some((point) => Math.abs(point.x - 1) < 1e-9 && Math.abs(point.y - 1) < 1e-9 && Math.abs(point.z) < 1e-9)).toBe(true)
  })

  it("reports a vertex-tangent cut as a point without claiming drawable geometry", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      createPoint3("v0", { x: -1, y: -1, z: -1 }), createPoint3("v1", { x: 1, y: -1, z: -1 }), createPoint3("v2", { x: 1, y: 1, z: -1 }), createPoint3("v3", { x: -1, y: 1, z: -1 }),
      createPoint3("v4", { x: -1, y: -1, z: 1 }), createPoint3("v5", { x: 1, y: -1, z: 1 }), createPoint3("v6", { x: 1, y: 1, z: 1 }), createPoint3("v7", { x: -1, y: 1, z: 1 }),
      createFace3("f-bottom", ["v0", "v1", "v2", "v3"]), createFace3("f-top", ["v4", "v5", "v6", "v7"]), createFace3("f-front", ["v0", "v1", "v5", "v4"]),
      createFace3("f-right", ["v1", "v2", "v6", "v5"]), createFace3("f-back", ["v2", "v3", "v7", "v6"]), createFace3("f-left", ["v3", "v0", "v4", "v7"]),
      createPolyhedron3("solid-1", ["v0", "v1", "v2", "v3", "v4", "v5", "v6", "v7"], [], ["f-bottom", "f-top", "f-front", "f-right", "f-back", "f-left"]),
      { id: "section-1", type: "section", sourceId: "solid-1", plane: { normal: { x: 1, y: 1, z: 1 }, constant: -3 }, points: [], classification: "none", status: "undefined" }
    ]

    const section = recomputeDerivedObjects(document).primitives.find((primitive) => primitive.id === "section-1")

    expect(section).toMatchObject({ classification: "point", visible: false })
    expect(section?.type === "section" && section.points).toEqual([{ x: 1, y: 1, z: 1 }])
  })

  it("refuses to invent a cut plane when the source vertices cannot be resolved", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "solid-broken", type: "polyhedron3", vertexIds: ["missing-vertex"], edgeIds: [], faceIds: [] },
      { id: "cube-1", type: "cube", origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }
    ]

    expect(sectionPlaneThroughSource(document, "solid-broken")).toBeNull()
    expect(sectionPlaneThroughSource(document, "absent")).toBeNull()
    const cubePlane = sectionPlaneThroughSource(document, "cube-1")
    expect(cubePlane?.normal).toEqual({ x: 0, y: 1, z: 0 })
    expect(cubePlane?.constant).toBeCloseTo(0)
  })

  it("resolves a polyhedron topology for unfolding and rejects incomplete topology", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      createPoint3("v0", { x: -1, y: -1, z: -1 }), createPoint3("v1", { x: 1, y: -1, z: -1 }), createPoint3("v2", { x: 1, y: 1, z: -1 }), createPoint3("v3", { x: -1, y: 1, z: -1 }),
      createPoint3("v4", { x: -1, y: -1, z: 1 }), createPoint3("v5", { x: 1, y: -1, z: 1 }), createPoint3("v6", { x: 1, y: 1, z: 1 }), createPoint3("v7", { x: -1, y: 1, z: 1 }),
      createFace3("f-bottom", ["v0", "v1", "v2", "v3"]), createFace3("f-top", ["v4", "v5", "v6", "v7"]), createFace3("f-front", ["v0", "v1", "v5", "v4"]),
      createFace3("f-right", ["v1", "v2", "v6", "v5"]), createFace3("f-back", ["v2", "v3", "v7", "v6"]), createFace3("f-left", ["v3", "v0", "v4", "v7"]),
      createPolyhedron3("solid-1", ["v0", "v1", "v2", "v3", "v4", "v5", "v6", "v7"], [], ["f-bottom", "f-top", "f-front", "f-right", "f-back", "f-left"]),
      { id: "solid-broken", type: "polyhedron3", vertexIds: ["v0", "missing"], edgeIds: [], faceIds: ["f-bottom"] }
    ]

    const topology = resolvePolyhedronTopology(document, "solid-1")

    expect(topology?.faces.map((face) => face.id)).toHaveLength(6)
    expect(topology?.rootFaceId).toBe("f-bottom")
    expect(topology?.vertices.v6).toEqual({ x: 1, y: 1, z: 1 })
    expect(resolvePolyhedronTopology(document, "solid-broken")).toBeNull()
    expect(resolvePolyhedronTopology(document, "v0")).toBeNull()
  })

  it("styles any spatial object, including derived topology and sections", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      createPoint3("v0", { x: -1, y: -1, z: -1 }), createPoint3("v1", { x: 1, y: -1, z: -1 }), createPoint3("v2", { x: 1, y: 1, z: -1 }),
      createFace3("f-bottom", ["v0", "v1", "v2"]),
      { id: "section-1", type: "section", sourceId: "f-bottom", plane: { normal: { x: 0, y: 0, z: 1 }, constant: 0 }, points: [], classification: "none", status: "undefined" }
    ]

    const faceStyled = applyOperation(document, { op: "updatePrimitive", id: "f-bottom", patch: { style: { stroke: "#ff0000", opacity: 0.5 } } })
    const sectionStyled = applyOperation(faceStyled.document, { op: "updatePrimitive", id: "section-1", patch: { style: { stroke: "#00ff00" } } })

    expect(faceStyled.changed).toBe(true)
    expect(faceStyled.document.primitives.find((primitive) => primitive.id === "f-bottom")).toMatchObject({ style: { stroke: "#ff0000", opacity: 0.5 } })
    expect(sectionStyled.changed).toBe(true)
    expect(sectionStyled.document.primitives.find((primitive) => primitive.id === "section-1")).toMatchObject({ style: { stroke: "#00ff00" } })
  })

  it("recolours every generated child when a template solid style changes", () => {
    const source = { id: "cube-1", type: "cube" as const, origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 }, label: "立方体 1" }
    const topology = buildSolidTemplate(source)
    const document = createEmptyDocument("geometry3d")
    document.primitives = [source, ...topology.primitives]

    const styled = commitPatch(document, { op: "updatePrimitive", id: "cube-1", patch: { style: { stroke: "#ff0000" } } })

    expect(styled.changed).toBe(true)
    const children = styled.document.primitives.filter((primitive) => ["point3", "edge3", "face3", "polyhedron3"].includes(primitive.type))
    expect(children.length).toBeGreaterThan(10)
    for (const child of children) expect(child.style?.stroke).toBe("#ff0000")
  })

  it("places a default cut plane through the bounding box of the source", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "cube-1", type: "cube", origin: { x: -1, y: -3, z: -1 }, size: { x: 2, y: 2, z: 2 } },
      { id: "pyramid-1", type: "pyramid", baseCenter: { x: 0, y: 0, z: 0 }, baseSize: { x: 4, y: 4 }, height: 4 }
    ]

    expect(sectionPlaneThroughSource(document, "cube-1")).toEqual({ normal: { x: 0, y: 1, z: 0 }, constant: 2 })
    expect(sectionPlaneThroughSource(document, "pyramid-1")).toEqual({ normal: { x: 0, y: 1, z: 0 }, constant: -2 })
  })

  it("recomputes an intersection set with every sampled solution", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "line-a", type: "line", a: { x: -2, y: 0 }, b: { x: 2, y: 0 } },
      { id: "line-b", type: "line", a: { x: 0, y: -2 }, b: { x: 0, y: 2 } },
      { id: "set-1", type: "intersectionSet", objectA: "line-a", objectB: "line-b", points: [] }
    ]

    const result = recomputeDerivedObjects(document)
    expect(result.primitives.find((primitive) => primitive.id === "set-1")).toMatchObject({ visible: true, points: [{ x: 0, y: 0 }] })
  })

  it("recomputes a derivative when its source function changes", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "function-1", type: "function", expression: "x^2", domain: [-2, 2], samples: 16 },
      { id: "derivative-1", type: "derivative", sourceId: "function-1", order: 1, domain: [-2, 2], samples: 16, points: [], status: "approximate" }
    ]

    const initial = recomputeDerivedObjects(document)
    const updated = applyOperation(initial, { op: "updatePrimitive", id: "function-1", patch: { expression: "2*x" } })
    const derivative = updated.document.primitives.find((primitive) => primitive.id === "derivative-1")

    expect(initial.primitives.find((primitive) => primitive.id === "derivative-1")).toMatchObject({ points: expect.any(Array) })
    expect(derivative).toMatchObject({ status: "approximate", points: expect.arrayContaining([expect.objectContaining({ y: expect.closeTo(2, 0.1) })]) })
  })

  it("recomputes tangent, normal, and secant values from their source function", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "function-1", type: "function", expression: "x^2", domain: [-2, 2], samples: 16 },
      { id: "tangent-1", type: "tangent", sourceId: "function-1", x: 1, point: { x: 0, y: 0 }, slope: 0, a: { x: -2, y: 0 }, b: { x: 2, y: 0 }, status: "failed" },
      { id: "normal-1", type: "normal", sourceId: "function-1", x: 1, point: { x: 0, y: 0 }, slope: 0, a: { x: -2, y: 0 }, b: { x: 2, y: 0 }, status: "failed" },
      { id: "secant-1", type: "secant", sourceId: "function-1", x1: -1, x2: 1, points: [], slope: 0, a: { x: -2, y: 0 }, b: { x: 2, y: 0 }, status: "failed" }
    ]

    const result = recomputeDerivedObjects(document)
    expect(result.primitives).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "tangent-1", point: { x: 1, y: 1 }, slope: expect.closeTo(2, 0.1), status: "approximate" }),
      expect.objectContaining({ id: "normal-1", point: { x: 1, y: 1 }, slope: expect.closeTo(-0.5, 0.1), status: "approximate" }),
      expect.objectContaining({ id: "secant-1", points: [{ x: -1, y: 1 }, { x: 1, y: 1 }], slope: expect.closeTo(0, 0.1), status: "approximate" })
    ]))
  })

  it("recomputes integral area and analysis results from their source function", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "function-1", type: "function", expression: "x^2", domain: [-1, 1], samples: 16 },
      { id: "integral-1", type: "integral", sourceId: "function-1", domain: [0, 1], steps: 64, points: [], area: null, status: "failed" },
      { id: "analysis-1", type: "analysisSet", sourceId: "function-1", domain: [-1, 1], samples: 64, results: [], status: "failed" }
    ]

    const result = recomputeDerivedObjects(document)
    expect(result.primitives).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "integral-1", area: expect.closeTo(1 / 3, 0.001), status: "approximate" }),
      expect.objectContaining({ id: "analysis-1", results: expect.arrayContaining([expect.objectContaining({ kind: "minimum" })]), status: "approximate" })
    ]))
  })

  it("rejects an invalid constraint without changing the document", () => {
    const document = createEmptyDocument("calculus")
    const result = commitPatch(document, { op: "addConstraint", constraint: { id: "parallel-1", type: "parallel", targets: ["missing-a", "missing-b"] } })

    expect(result.changed).toBe(false)
    expect(result.document).toBe(document)
    expect(result.error).toContain("constraint has invalid targets")
  })

  it("projects a valid parallel constraint through the domain operation", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "line-a", type: "line", a: { x: 0, y: 0 }, b: { x: 4, y: 0 } },
      { id: "line-b", type: "line", a: { x: 1, y: 2 }, b: { x: 2, y: 5 } }
    ]

    const result = commitPatch(document, { op: "addConstraint", constraint: { id: "parallel-1", type: "parallel", targets: ["line-a", "line-b"] } })
    const line = result.document.primitives.find((primitive) => primitive.id === "line-b")

    expect(result.changed).toBe(true)
    expect(line).toMatchObject({ a: { y: 3.5 }, b: { y: 3.5 } })
    expect((line as Extract<typeof line, { type: "line" }>).b.x - (line as Extract<typeof line, { type: "line" }>).a.x).toBeCloseTo(Math.sqrt(10))
  })

  it("reprojects constrained dependents when a driving parameter changes", () => {
    const document = createEmptyDocument("calculus")
    document.parameters.slope = { id: "slope", value: 1 }
    document.primitives = [
      { id: "line-a", type: "line", a: { x: 0, y: 0 }, b: { x: 4, y: 4 }, slopeParameter: "slope" },
      { id: "line-b", type: "line", a: { x: 1, y: 2 }, b: { x: 2, y: 5 } }
    ]
    document.constraints = [{ id: "perpendicular-1", type: "perpendicular", targets: ["line-a", "line-b"] }]

    const result = applyOperation(document, { op: "setParameter", id: "slope", value: 0 })
    const line = result.document.primitives.find((primitive) => primitive.id === "line-b") as Extract<typeof document.primitives[number], { type: "line" }>
    const delta = { x: line.b.x - line.a.x, y: line.b.y - line.a.y }

    expect(delta.x).toBeCloseTo(0)
    expect(delta.y).toBeCloseTo(Math.sqrt(10))
  })

  it("rejects conflicting constraints and rolls back the document", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "line-a", type: "line", a: { x: 0, y: 0 }, b: { x: 4, y: 0 } },
      { id: "line-b", type: "line", a: { x: 1, y: 2 }, b: { x: 2, y: 5 } }
    ]
    document.constraints = [{ id: "parallel-1", type: "parallel", targets: ["line-a", "line-b"] }]

    const result = commitPatch(document, { op: "addConstraint", constraint: { id: "perpendicular-1", type: "perpendicular", targets: ["line-a", "line-b"] } })

    expect(result.changed).toBe(false)
    expect(result.document).toBe(document)
    expect(result.error).toContain("constraint solving failed")
  })

  it("hides a valid parallel intersection without rejecting the transaction", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "line-a", type: "line", a: { x: 0, y: 0 }, b: { x: 2, y: 0 } },
      { id: "line-b", type: "line", a: { x: 0, y: 1 }, b: { x: 2, y: 1 } },
      { id: "intersection", type: "intersection", lineA: "line-a", lineB: "line-b", x: 0, y: 0 }
    ]

    const result = applyOperation(document, { op: "updatePrimitive", id: "line-a", patch: { b: { x: 3, y: 0 } } })

    expect(result.changed).toBe(true)
    expect(result.document.primitives[2]).toMatchObject({ visible: false })
  })

  it("rolls back recomputation for a degenerate intersection source", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "line-a", type: "line", a: { x: 1, y: 1 }, b: { x: 1, y: 1 } },
      { id: "line-b", type: "line", a: { x: 0, y: 0 }, b: { x: 2, y: 0 } },
      { id: "intersection", type: "intersection", lineA: "line-a", lineB: "line-b", x: 0, y: 0 }
    ]

    const result = applyOperation(document, { op: "updatePrimitive", id: "line-b", patch: { b: { x: 3, y: 0 } } })

    expect(result.changed).toBe(false)
    expect(result.document).toBe(document)
    expect(result.error).toContain("degenerate intersection")
  })

  it("toggles lock state through a domain operation", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [{ id: "point-1", type: "point", x: 1, y: 2 }]

    const result = applyOperation(document, { op: "toggleLock", id: "point-1", locked: true })

    expect(result.changed).toBe(true)
    expect(result.document.primitives[0]).toMatchObject({ id: "point-1", locked: true })
  })

  it("creates and removes a persistent group atomically", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "point-1", type: "point", x: 1, y: 2 },
      { id: "point-2", type: "point", x: 3, y: 4 }
    ]

    const grouped = commitPatch(document, { op: "createGroup", group: { id: "group-1", label: "分组 1", members: ["point-1", "point-2"] } })
    const ungrouped = commitPatch(grouped.document, { op: "deleteGroup", id: "group-1" })

    expect(grouped.document.groups).toEqual([{ id: "group-1", label: "分组 1", members: ["point-1", "point-2"] }])
    expect(grouped.document.revision).toBe(1)
    expect(ungrouped.document.groups).toEqual([])
    expect(ungrouped.document.revision).toBe(2)
  })

  it("aligns primitive bounds in one transaction", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "point-1", type: "point", x: 1, y: 2 },
      { id: "circle-1", type: "circle", center: { x: 5, y: 4 }, radius: 2 }
    ]

    const result = commitPatch(document, { op: "alignPrimitives", ids: ["point-1", "circle-1"], alignment: "left" })

    expect(result.document.primitives).toEqual([
      { id: "point-1", type: "point", x: 1, y: 2 },
      { id: "circle-1", type: "circle", center: { x: 3, y: 4 }, radius: 2 }
    ])
    expect(result.document.revision).toBe(1)
  })

  it("aligns horizontal and vertical centers on their matching axes", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "point-1", type: "point", x: 1, y: 2 },
      { id: "point-2", type: "point", x: 5, y: 6 }
    ]

    const horizontal = commitPatch(document, { op: "alignPrimitives", ids: ["point-1", "point-2"], alignment: "horizontalCenter" })
    const vertical = commitPatch(document, { op: "alignPrimitives", ids: ["point-1", "point-2"], alignment: "verticalCenter" })

    expect(horizontal.document.primitives.map((primitive) => (primitive.type === "point" ? primitive.x : null))).toEqual([3, 3])
    expect(vertical.document.primitives.map((primitive) => (primitive.type === "point" ? primitive.y : null))).toEqual([4, 4])
  })

  it("updates visibility for multiple primitives in one transaction", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "point-1", type: "point", x: 1, y: 2 },
      { id: "point-2", type: "point", x: 3, y: 4 }
    ]

    const result = commitPatch(document, { op: "setPrimitivesVisible", ids: ["point-1", "point-2"], visible: false })

    expect(result.document.primitives.map((primitive) => primitive.visible)).toEqual([false, false])
    expect(result.document.revision).toBe(1)
  })

  it("keeps a 1000-primitive incremental recomputation bounded", () => {
    const document = createEmptyDocument("calculus")
    document.parameters.slope = { id: "slope", value: 1 }
    document.primitives = [
      { id: "line-a", type: "line", a: { x: -2, y: -2 }, b: { x: 2, y: 2 }, slopeParameter: "slope" },
      { id: "line-b", type: "line", a: { x: -2, y: 2 }, b: { x: 2, y: -2 } },
      { id: "intersection", type: "intersection", lineA: "line-a", lineB: "line-b", x: 0, y: 0 },
      { id: "near-line-a", type: "line", a: { x: -2, y: -1e-9 }, b: { x: 2, y: 1e-9 } },
      { id: "near-line-b", type: "line", a: { x: -2, y: 1 }, b: { x: 2, y: 1 + 3e-9 } },
      { id: "near-intersection", type: "intersection", lineA: "near-line-a", lineB: "near-line-b", x: 0, y: 0 },
      ...Array.from({ length: 994 }, (_, index) => ({ id: `point-${index}`, type: "point" as const, x: index % 20, y: Math.floor(index / 20) }))
    ]
    const unrelated = document.primitives.at(-1)

    const startedAt = performance.now()
    const recomputed = recomputeDerivedObjects(document, ["slope", "near-line-a"])
    const elapsed = performance.now() - startedAt

    expect(document.primitives).toHaveLength(1000)
    expect([...getAffectedPrimitiveIds(document, ["slope", "near-line-a"])]).toEqual(["slope", "near-line-a", "line-a", "near-intersection", "intersection"])
    const nearIntersection = recomputed.primitives.find((primitive) => primitive.id === "near-intersection")
    expect(nearIntersection).toMatchObject({ visible: true })
    expect(nearIntersection && nearIntersection.type === "intersection" && Number.isFinite(nearIntersection.x) && Number.isFinite(nearIntersection.y)).toBe(true)
    expect(recomputed.primitives.at(-1)).toBe(unrelated)
    expect(elapsed).toBeLessThan(100)
  })

  it("keeps independent constraint components stable during incremental recomputation", () => {
    const document = createEmptyDocument("calculus")
    document.parameters.slope = { id: "slope", value: 1 }
    const activeLines = Array.from({ length: 12 }, (_, index) => ({ id: `active-${index}`, type: "line" as const, a: { x: 0, y: index }, b: { x: 2, y: index + 1 }, ...(index === 0 ? { slopeParameter: "slope" } : {}) }))
    const untouchedLines = Array.from({ length: 12 }, (_, index) => ({ id: `untouched-${index}`, type: "line" as const, a: { x: 10, y: index }, b: { x: 12, y: index + 2 } }))
    document.primitives = [...activeLines, ...untouchedLines]
    document.constraints = [...Array.from({ length: 11 }, (_, index) => ({ id: `active-${index}`, type: "parallel" as const, targets: [`active-${index}`, `active-${index + 1}`] })), ...Array.from({ length: 11 }, (_, index) => ({ id: `untouched-${index}`, type: "perpendicular" as const, targets: [`untouched-${index}`, `untouched-${index + 1}`] }))]
    const untouched = document.primitives.find((primitive) => primitive.id === "untouched-11")

    const recomputed = recomputeDerivedObjects(document, ["slope"])

    expect(recomputed.primitives.find((primitive) => primitive.id === "untouched-11")).toBe(untouched)
    expect(recomputed.primitives.find((primitive) => primitive.id === "active-11")).not.toBe(activeLines[11])
  })

  it.each([1000, 5000, 10000])("keeps %s constrained lines within the incremental budget", (lineCount) => {
    const document = createEmptyDocument("calculus")
    document.parameters.slope = { id: "slope", value: 1 }
    document.primitives = Array.from({ length: lineCount }, (_, index) => ({
      id: `line-${index}`,
      type: "line" as const,
      a: { x: 0, y: index },
      b: { x: 2, y: index + (index === 0 ? 2 : 1) },
      ...(index === 0 ? { slopeParameter: "slope" } : {})
    }))
    const componentSize = 10
    document.constraints = Array.from({ length: (lineCount / componentSize) * (componentSize - 1) }, (_, index) => {
      const componentIndex = Math.floor(index / (componentSize - 1))
      const lineIndex = componentIndex * componentSize + index % (componentSize - 1)
      return {
        id: `constraint-${index}`,
        type: "parallel" as const,
        targets: [`line-${lineIndex}`, `line-${lineIndex + 1}`]
      }
    })
    const untouched = document.primitives.at(-1)

    const startedAt = performance.now()
    const recomputed = recomputeDerivedObjects(document, ["slope"])
    const elapsed = performance.now() - startedAt

    expect(elapsed).toBeLessThan(1000)
    expect(recomputed.primitives.find((primitive) => primitive.id === "line-1")).not.toBe(document.primitives[1])
    expect(recomputed.primitives.at(-1)).toBe(untouched)
  })

  it("recomputes a spatial measurement after its source point moves", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [createPoint3("point-a", { x: 0, y: 0, z: 0 }), createPoint3("point-b", { x: 1, y: 0, z: 0 })]
    const measurement = { id: "measurement3-1", kind: "measurement3" as const, sourceIds: ["point-a", "point-b"], metric: "distance" as const, precision: "numeric-approximation" as const, status: "valid" as const, explanation: "两点距离" }
    const measured = applyOperation(document, { op: "addMeasurement", measurement })

    expect(measured.document.measurements[0]).toMatchObject({ metric: "distance", value: 1, status: "valid" })

    const moved = applyOperation(measured.document, patchPoint3("point-a", { x: 1, y: 4, z: 0 }))

    expect(moved.document.measurements[0]).toMatchObject({ metric: "distance", value: 4, status: "valid" })
    expect(moved.document.measurements[0].explanation).toContain("两个空间点")
  })
})
