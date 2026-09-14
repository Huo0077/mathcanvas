import { describe, expect, it } from "vitest"

import { createEmptyDocument, decodeMgeo, encodeMgeo, validateDocument } from "./index"

describe("Geometry DSL codec", () => {
  it("loads legacy documents without measurements", () => {
    const document = createEmptyDocument("geometry3d")
    const legacy = JSON.stringify({ ...document, measurements: undefined })

    const restored = decodeMgeo(legacy)

    expect(restored.measurements).toEqual([])
  })

  it("round-trips spatial measurements with their sources", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "point-a", type: "point3", position: { x: 0, y: 0, z: 0 } },
      { id: "point-b", type: "point3", position: { x: 3, y: 4, z: 0 } }
    ]
    document.measurements = [{ id: "measurement3-1", kind: "measurement3", sourceIds: ["point-a", "point-b"], metric: "distance", value: 5, unit: "u", precision: "numeric-approximation", status: "valid", explanation: "由两个空间点 point-a、point-b 的坐标计算距离。" }]

    const restored = decodeMgeo(encodeMgeo(document))

    expect(restored.measurements).toEqual(document.measurements)
  })

  it("derives a section classification for documents written before the field existed", () => {
    const document = createEmptyDocument("geometry3d")
    const legacy = JSON.stringify({
      format: "mgeo",
      formatVersion: "0.1",
      document: {
        ...document,
        primitives: [
          { id: "cube-1", type: "cube", origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } },
          { id: "polygon-section", type: "section", sourceId: "cube-1", plane: { normal: { x: 0, y: 0, z: 1 }, constant: 0 }, points: [{ x: -1, y: -1, z: 0 }, { x: 1, y: -1, z: 0 }, { x: 1, y: 1, z: 0 }], status: "approximate" },
          { id: "segment-section", type: "section", sourceId: "cube-1", plane: { normal: { x: 1, y: 0, z: 1 }, constant: -2 }, points: [{ x: 1, y: -1, z: 1 }, { x: 1, y: 1, z: 1 }], status: "approximate" },
          { id: "empty-section", type: "section", sourceId: "cube-1", plane: { normal: { x: 0, y: 1, z: 0 }, constant: 99 }, points: [], status: "undefined" }
        ]
      }
    })

    const restored = decodeMgeo(legacy)

    expect(restored.primitives.filter((primitive) => primitive.type === "section").map((primitive) => primitive.type === "section" ? primitive.classification : null)).toEqual(["polygon", "segment", "none"])
  })

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

  it("round-trips parameterized 3D solids while keeping the schema version", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "cube-1", type: "cube", origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } },
      { id: "pyramid-1", type: "pyramid", baseCenter: { x: 0, y: 0, z: 0 }, baseSize: { x: 2, y: 2 }, height: 3 },
      { id: "cylinder-1", type: "cylinder", center: { x: 0, y: 0, z: 0 }, radius: 1, height: 2, segments: 16 },
      { id: "cone-1", type: "cone", center: { x: 3, y: 0, z: 0 }, radius: 1, height: 2, segments: 16 }
    ]

    const restored = decodeMgeo(encodeMgeo(document))
    expect(restored.schemaVersion).toBe("0.1")
    expect(restored.coordinateSystems).toEqual(["cartesian-3d"])
    expect(restored.primitives).toEqual(document.primitives)
  })

  it("round-trips a section with a stable solid source reference", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "cube-1", type: "cube", origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } },
      { id: "section-1", type: "section", sourceId: "cube-1", plane: { normal: { x: 0, y: 0, z: 1 }, constant: 0 }, points: [{ x: -1, y: -1, z: 0 }, { x: 1, y: -1, z: 0 }, { x: 1, y: 1, z: 0 }, { x: -1, y: 1, z: 0 }], classification: "polygon", status: "approximate" }
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

  it("round-trips a point-driven 3D topology document", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "point-a", type: "point3", position: { x: 0, y: 0, z: 0 }, label: "A", binding: { kind: "free" } },
      { id: "point-b", type: "point3", position: { x: 1, y: 0, z: 0 }, label: "B", binding: { kind: "free" } },
      { id: "point-c", type: "point3", position: { x: 0, y: 1, z: 0 }, label: "C", binding: { kind: "free" } },
      { id: "point-d", type: "point3", position: { x: 0, y: 0, z: 1 }, label: "D", binding: { kind: "free" } },
      { id: "line-ab", type: "line3", definition: { kind: "throughPoints", pointIds: ["point-a", "point-b"] } },
      { id: "segment-ab", type: "segment3", pointIds: ["point-a", "point-b"] },
      { id: "ray-ac", type: "ray3", originId: "point-a", throughId: "point-c" },
      { id: "plane-abc", type: "plane3", definition: { kind: "throughPoints", pointIds: ["point-a", "point-b", "point-c"] } },
      { id: "circle-abc", type: "circle3", centerId: "point-a", normal: { x: 0, y: 0, z: 1 }, radius: 2 },
      { id: "edge-ab", type: "edge3", pointIds: ["point-a", "point-b"], faceIds: ["face-abc", "face-abd"] },
      { id: "edge-ac", type: "edge3", pointIds: ["point-a", "point-c"], faceIds: ["face-abc", "face-acd"] },
      { id: "edge-ad", type: "edge3", pointIds: ["point-a", "point-d"], faceIds: ["face-abd", "face-acd"] },
      { id: "edge-bc", type: "edge3", pointIds: ["point-b", "point-c"], faceIds: ["face-abc", "face-bcd"] },
      { id: "edge-bd", type: "edge3", pointIds: ["point-b", "point-d"], faceIds: ["face-abd", "face-bcd"] },
      { id: "edge-cd", type: "edge3", pointIds: ["point-c", "point-d"], faceIds: ["face-acd", "face-bcd"] },
      { id: "face-abc", type: "face3", pointIds: ["point-a", "point-b", "point-c"], edgeIds: ["edge-ab", "edge-bc", "edge-ac"], planeId: "plane-abc" },
      { id: "face-abd", type: "face3", pointIds: ["point-a", "point-b", "point-d"], edgeIds: ["edge-ab", "edge-bd", "edge-ad"] },
      { id: "face-acd", type: "face3", pointIds: ["point-a", "point-c", "point-d"], edgeIds: ["edge-ac", "edge-cd", "edge-ad"] },
      { id: "face-bcd", type: "face3", pointIds: ["point-b", "point-c", "point-d"], edgeIds: ["edge-bc", "edge-cd", "edge-bd"] },
      { id: "solid-1", type: "polyhedron3", vertexIds: ["point-a", "point-b", "point-c", "point-d"], edgeIds: ["edge-ab", "edge-ac", "edge-ad", "edge-bc", "edge-bd", "edge-cd"], faceIds: ["face-abc", "face-abd", "face-acd", "face-bcd"], construction: { kind: "fromFaces", sourceIds: ["face-abc", "face-abd", "face-acd", "face-bcd"] } }
    ]

    expect(decodeMgeo(encodeMgeo(document)).primitives).toEqual(document.primitives)
  })

  it("rejects invalid 3D references and degenerate definitions", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "point-a", type: "point3", position: { x: 0, y: 0, z: 0 } },
      { id: "point-b", type: "point3", position: { x: 1, y: 0, z: 0 } },
      { id: "point-c", type: "point3", position: { x: 2, y: 0, z: 0 } },
      { id: "point-d", type: "point3", position: { x: 0, y: 1, z: 0 } },
      { id: "point-e", type: "point3", position: { x: 3, y: 0, z: 0 } },
      { id: "point-f", type: "point3", position: { x: 3, y: 1, z: 0 } },
      { id: "line-1", type: "line3", definition: { kind: "throughPoints", pointIds: ["point-a", "missing"] } },
      { id: "plane-1", type: "plane3", definition: { kind: "throughPoints", pointIds: ["point-a", "point-a", "point-a"] } },
      { id: "plane-2", type: "plane3", definition: { kind: "throughPoints", pointIds: ["point-a", "point-b", "point-c"] } },
      { id: "edge-1", type: "edge3", pointIds: ["point-a", "point-b"] },
      { id: "edge-2", type: "edge3", pointIds: ["point-b", "point-c"] },
      { id: "edge-3", type: "edge3", pointIds: ["point-c", "point-a"] },
      { id: "edge-4", type: "edge3", pointIds: ["point-d", "point-e"] },
      { id: "edge-5", type: "edge3", pointIds: ["point-e", "point-f"] },
      { id: "edge-6", type: "edge3", pointIds: ["point-f", "point-d"] },
      { id: "face-1", type: "face3", pointIds: ["point-a", "point-a"] },
      { id: "face-2", type: "face3", pointIds: ["point-a", "point-b", "point-c"], edgeIds: ["edge-1"] },
      { id: "face-3", type: "face3", pointIds: ["point-a", "point-b", "point-c", "point-d", "point-e", "point-f"], edgeIds: ["edge-1", "edge-2", "edge-3", "edge-4", "edge-5", "edge-6"] },
      { id: "solid-1", type: "polyhedron3", vertexIds: ["point-a", "missing"], edgeIds: [], faceIds: [] },
      { id: "solid-2", type: "polyhedron3", vertexIds: ["point-a", "point-b", "point-c", "point-d"], edgeIds: [], faceIds: [] },
      { id: "solid-3", type: "polyhedron3", vertexIds: ["point-a", "point-b", "point-c", "point-d"], edgeIds: ["edge-1", "edge-1", "edge-1", "edge-1", "edge-1", "edge-1"], faceIds: ["face-2", "face-2", "face-2", "face-2"] },
      { id: "solid-4", type: "polyhedron3", vertexIds: ["point-a", "point-b", "point-c", "point-d"], edgeIds: [], faceIds: [], construction: { kind: "template", templateId: "cube", parameterIds: ["missing-parameter"], sourceIds: [] } }
    ]

    const result = validateDocument(document)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toContain("line3 references invalid points")
      expect(result.errors).toContain("plane3 points must be distinct")
      expect(result.errors).toContain("plane3 points are collinear")
      expect(result.errors).toContain("face3 needs at least three distinct points")
      expect(result.errors).toContain("face3 boundary is not closed")
      expect(result.errors).toContain("face3 points are collinear")
      expect(result.errors).toContain("polyhedron3 references missing vertex")
      expect(result.errors).toContain("polyhedron3 vertices are coplanar")
      expect(result.errors).toContain("polyhedron3 edge references must be unique")
      expect(result.errors).toContain("polyhedron3 face references must be unique")
      expect(result.errors).toContain("polyhedron3 template construction is invalid")
    }
  })

  it("keeps legacy parameterized solids readable alongside point-driven objects", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "cube-legacy", type: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } },
      { id: "point-a", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "free" } }
    ]

    const restored = decodeMgeo(encodeMgeo(document))
    expect(restored.schemaVersion).toBe("0.1")
    expect(restored.primitives).toEqual(document.primitives)
  })
})
