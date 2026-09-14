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

  it("round-trips an intersection set", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "line-a", type: "line", a: { x: -2, y: 0 }, b: { x: 2, y: 0 } },
      { id: "line-b", type: "line", a: { x: 0, y: -2 }, b: { x: 0, y: 2 } },
      { id: "intersection-set-1", type: "intersectionSet", objectA: "line-a", objectB: "line-b", points: [] }
    ]

    expect(decodeMgeo(encodeMgeo(document)).primitives).toEqual(document.primitives)
  })

  it("rejects a parabola connection without an extra constraint", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "point-a", type: "point", x: 0, y: 0 },
      { id: "point-b", type: "point", x: 2, y: 1 },
      { id: "connection-1", type: "connection", kind: "parabola", startPointId: "point-a", endPointId: "point-b" }
    ]

    expect(validateDocument(document)).toEqual({ valid: false, errors: ["parabola connection needs a third point or vertex model"] })
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

  it("round-trips anchored annotations", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [{ id: "circle-1", type: "circle", center: { x: 1, y: 2 }, radius: 3 }]
    const annotation = {
      id: "annotation-1",
      text: "圆心 O",
      anchor: { kind: "primitive", primitiveId: "circle-1", feature: "center" },
      offset: { x: 0.2, y: -0.3 },
      visible: true
    }
    document.annotations = [annotation as never]

    expect(decodeMgeo(encodeMgeo(document)).annotations).toEqual([annotation])
  })

  it("rejects annotations with missing anchors", () => {
    const document = createEmptyDocument("calculus")
    document.annotations = [{ id: "annotation-1", text: "缺失图元", anchor: { kind: "primitive", primitiveId: "missing" } } as never]

    expect(validateDocument(document)).toEqual({ valid: false, errors: ["annotation references missing primitive: annotation-1"] })
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

  it("round-trips a derivative primitive with a stable source reference", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "function-1", type: "function", expression: "x^2", domain: [-2, 2], samples: 32 },
      { id: "derivative-1", type: "derivative", sourceId: "function-1", order: 1, domain: [-2, 2], samples: 32, points: [], status: "approximate" }
    ]

    expect(decodeMgeo(encodeMgeo(document)).primitives).toEqual(document.primitives)
  })

  it("round-trips tangent, normal, and secant primitives", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "function-1", type: "function", expression: "x^2", domain: [-2, 2], samples: 32 },
      { id: "tangent-1", type: "tangent", sourceId: "function-1", x: 1, point: { x: 1, y: 1 }, slope: 2, a: { x: -2, y: -5 }, b: { x: 2, y: 7 }, status: "approximate" },
      { id: "normal-1", type: "normal", sourceId: "function-1", x: 1, point: { x: 1, y: 1 }, slope: -0.5, a: { x: -2, y: 2.5 }, b: { x: 2, y: 0.5 }, status: "approximate" },
      { id: "secant-1", type: "secant", sourceId: "function-1", x1: -1, x2: 1, points: [{ x: -1, y: 1 }, { x: 1, y: 1 }], slope: 0, a: { x: -2, y: 1 }, b: { x: 2, y: 1 }, status: "approximate" }
    ]

    expect(decodeMgeo(encodeMgeo(document)).primitives).toEqual(document.primitives)
  })

  it("round-trips integral and analysis result primitives", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "function-1", type: "function", expression: "x^2", domain: [-1, 1], samples: 32 },
      { id: "integral-1", type: "integral", sourceId: "function-1", domain: [0, 1], steps: 64, points: [], area: 1 / 3, status: "approximate" },
      { id: "analysis-1", type: "analysisSet", sourceId: "function-1", domain: [-1, 1], samples: 64, results: [{ kind: "zero", x: 0, y: 0, approximate: true }], status: "approximate" }
    ]

    expect(decodeMgeo(encodeMgeo(document)).primitives).toEqual(document.primitives)
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
