import { describe, expect, it } from "vitest"

import { createEmptyDocument, decodeMgeo, encodeMgeo, validateDocument } from "./index"

describe("Geometry DSL codec", () => {
  it("round-trips a versioned document with stable metadata", () => {
    const document = createEmptyDocument("calculus")
    const restored = decodeMgeo(encodeMgeo(document))

    expect(restored.schemaVersion).toBe("0.1")
    expect(restored.workspace).toBe("calculus")
    expect(restored.revision).toBe(0)
    expect(restored.metadata.id).toBe(document.metadata.id)
  })

  it("round-trips a segment primitive", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [{ id: "segment-1", type: "segment", a: { x: -1, y: 2 }, b: { x: 3, y: 4 } }]

    expect(decodeMgeo(encodeMgeo(document)).primitives[0]).toEqual(document.primitives[0])
  })

  it("round-trips a point-referenced connection", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "point-a", type: "point", x: 0, y: 0, label: "A" },
      { id: "point-b", type: "point", x: 3, y: 2, label: "B" },
      { id: "connection-1", type: "connection", kind: "segment", startPointId: "point-a", endPointId: "point-b" }
    ]

    expect(decodeMgeo(encodeMgeo(document)).primitives).toEqual(document.primitives)
  })

  it("rejects connections that do not reference two points", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [{ id: "connection-1", type: "connection", kind: "segment", startPointId: "missing-a", endPointId: "missing-b" }]

    expect(validateDocument(document)).toEqual({ valid: false, errors: ["connection references invalid points"] })
  })

  it("round-trips a locus primitive", () => {
    const document = createEmptyDocument("calculus")
    document.parameters = { t: { id: "t", value: 0.5, min: 0, max: 1, step: 0.01 } }
    document.primitives = [
      { id: "point-1", type: "point", x: 1, y: 0, binding: { kind: "onPath", pathId: "circle-1", parameterId: "t", parameter: 0.5 } },
      { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 2 },
      { id: "locus-1", type: "locus", sourcePointId: "point-1", parameterId: "t", domain: [0, 1], samples: 32 }
    ]

    expect(decodeMgeo(encodeMgeo(document)).primitives).toEqual(document.primitives)
  })

  it("round-trips persistent primitive groups", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "point-1", type: "point", x: 1, y: 2 },
      { id: "point-2", type: "point", x: 3, y: 4 }
    ]
    document.groups = [{ id: "group-1", label: "示例分组", members: ["point-1", "point-2"] }]

    expect(decodeMgeo(encodeMgeo(document)).groups).toEqual(document.groups)
  })

  it("loads legacy documents without groups as an empty group list", () => {
    const document = createEmptyDocument("calculus")
    const legacy = JSON.parse(encodeMgeo(document))
    delete legacy.document.groups

    expect(decodeMgeo(JSON.stringify(legacy)).groups).toEqual([])
  })

  it("round-trips ray and polyline primitives", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "ray-1", type: "ray", a: { x: 0, y: 0 }, b: { x: 2, y: 1 } },
      { id: "polyline-1", type: "polyline", points: [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 6, y: 4 }] }
    ]

    expect(decodeMgeo(encodeMgeo(document)).primitives).toEqual(document.primitives)
  })

  it("round-trips conic and function primitives", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "ellipse-1", type: "ellipse", center: { x: 1, y: -1 }, radiusX: 4, radiusY: 2 },
      { id: "function-1", type: "function", expression: "2*x+1", domain: [-5, 5], samples: 64 },
      { id: "curve-intersection-1", type: "curveIntersection", objectA: "ellipse-1", objectB: "function-1", x: 0, y: 0, label: "交点 1" }
    ]

    expect(decodeMgeo(encodeMgeo(document)).primitives).toEqual(document.primitives)
  })

  it("rejects degenerate rays and polylines", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "ray-1", type: "ray", a: { x: 0, y: 0 }, b: { x: 0, y: 0 } },
      { id: "polyline-1", type: "polyline", points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] }
    ]

    const result = validateDocument(document)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toContain("ray direction must differ")
      expect(result.errors).toContain("polyline consecutive points must differ")
    }
  })

  it("rejects malformed primitive fields without throwing", () => {
    const base = createEmptyDocument("calculus")
    const malformedDocuments = [
      { ...base, primitives: [{ id: "point-1", type: "point" }] },
      { ...base, primitives: [{ id: "segment-1", type: "segment" }] },
      { ...base, primitives: [{ id: "circle-1", type: "circle", radius: 1 }] }
    ]

    for (const document of malformedDocuments) {
      expect(() => validateDocument(document)).not.toThrow()
      expect(validateDocument(document).valid).toBe(false)
    }
  })
})
