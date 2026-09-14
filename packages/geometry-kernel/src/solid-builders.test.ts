import { describe, expect, it } from "vitest"

import { buildFromPoints, buildFrustum, buildPrism, buildSolid, createBuilderContext, listSolidBuilders, registerSolidBuilder } from "./solid-builders"

const triangle = [
  { x: 0, y: 0, z: 0 },
  { x: 2, y: 0, z: 0 },
  { x: 0, y: 2, z: 0 }
]

describe("solid builders", () => {
  it("builds a point-driven triangular prism with closed topology", () => {
    const result = buildPrism({ base: triangle, vector: { x: 0, y: 0, z: 3 } }, createBuilderContext("prism"))

    expect(result.diagnostics).toEqual([])
    expect(result.primitives.filter((primitive) => primitive.type === "point3")).toHaveLength(6)
    expect(result.primitives.filter((primitive) => primitive.type === "edge3")).toHaveLength(9)
    expect(result.primitives.filter((primitive) => primitive.type === "face3")).toHaveLength(5)
    expect(result.primitives.find((primitive) => primitive.type === "polyhedron3")).toMatchObject({ vertexIds: expect.arrayContaining(result.vertexIds), edgeIds: expect.arrayContaining(result.edgeIds), faceIds: expect.arrayContaining(result.faceIds) })
  })

  it("requires explicit face rings when building from points", () => {
    const result = buildFromPoints({ vertices: [...triangle, { x: 0, y: 0, z: 1 }], faces: [] }, createBuilderContext("points"))

    expect(result.primitives).toEqual([])
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("missing-face-rings")
  })

  it("rejects degenerate prism input without creating partial objects", () => {
    const result = buildPrism({ base: [triangle[0], triangle[0], triangle[1]], vector: { x: 0, y: 0, z: 0 } }, createBuilderContext("invalid"))

    expect(result.primitives).toEqual([])
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining(["degenerate-base", "degenerate-vector"]))
  })

  it("rejects a non-planar polygon face", () => {
    const result = buildFromPoints({
      vertices: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 1 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 0, z: 2 }
      ],
      faces: [[0, 1, 2, 3], [0, 1, 4], [1, 2, 4], [2, 3, 4]]
    }, createBuilderContext("non-planar"))

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("non-planar-base")
  })

  it("rejects unused vertices and disconnected closed shells", () => {
    const tetrahedronFaces = [[2, 1, 0], [0, 1, 3], [1, 2, 3], [2, 0, 3]]
    const result = buildFromPoints({
      vertices: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 4, y: 4, z: 4 },
        { x: 10, y: 0, z: 0 },
        { x: 11, y: 0, z: 0 },
        { x: 10, y: 1, z: 0 },
        { x: 10, y: 0, z: 1 }
      ],
      faces: [...tetrahedronFaces, ...tetrahedronFaces.map((face) => face.map((index) => index + 5))]
    }, createBuilderContext("disconnected"))

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining(["unused-vertex", "disconnected-topology"]))
  })

  it("rejects open boundaries", () => {
    const result = buildFromPoints({
      vertices: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0.5, y: 0.5, z: 1 }
      ],
      faces: [[3, 2, 1, 0], [0, 1, 4], [1, 2, 4], [2, 3, 4]]
    }, createBuilderContext("open"))

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("open-boundary")
  })

  it("rejects duplicate faces", () => {
    const result = buildFromPoints({ vertices: [...triangle, { x: 0, y: 0, z: 1 }], faces: [[2, 1, 0], [0, 1, 3], [1, 2, 3], [2, 0, 3], [2, 1, 0]] }, createBuilderContext("duplicate"))

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("duplicate-face")
  })

  it("rejects shared edges with inconsistent winding", () => {
    const result = buildFromPoints({ vertices: [...triangle, { x: 0, y: 0, z: 1 }], faces: [[0, 1, 2], [0, 1, 3], [1, 2, 3], [2, 0, 3]] }, createBuilderContext("winding"))

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("inconsistent-winding")
  })

  it("rejects a coplanar closed shell with zero volume", () => {
    const result = buildFromPoints({
      vertices: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 }
      ],
      faces: [[0, 1, 2], [0, 2, 3], [1, 3, 2], [0, 3, 1]]
    }, createBuilderContext("zero-volume"))

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("degenerate-volume")
  })

  it("rejects a self-intersecting face ring", () => {
    const result = buildFromPoints({
      vertices: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0.5, y: 0.5, z: 1 }
      ],
      faces: [[0, 1, 2, 3], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]]
    }, createBuilderContext("self-intersecting"))

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("self-intersection")
  })

  it("registers generic and parameterized solid strategies", () => {
    expect(listSolidBuilders()).toEqual(expect.arrayContaining(["cube", "pyramid", "cylinder", "cone", "prism", "frustum", "fromPoints"]))
    expect(buildSolid("cube", { origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 3, z: 4 } }, createBuilderContext("cube")).diagnostics).toEqual([])
    expect(buildSolid("pyramid", { baseCenter: { x: 0, y: 0, z: 0 }, baseSize: { x: 2, y: 2 }, height: 3 }, createBuilderContext("pyramid")).diagnostics).toEqual([])
    expect(buildSolid("cylinder", { center: { x: 0, y: 0, z: 0 }, radius: 1, height: 2, segments: 8 }, createBuilderContext("cylinder")).diagnostics).toEqual([])
    expect(buildSolid("cone", { center: { x: 0, y: 0, z: 0 }, radius: 1, height: 2, segments: 8 }, createBuilderContext("cone")).diagnostics).toEqual([])
    expect(buildFrustum({ bottom: triangle, top: triangle.map((point) => ({ x: point.x, y: point.y, z: 2 })) }, createBuilderContext("frustum")).diagnostics).toEqual([])
  })

  it("returns diagnostics for malformed template input without throwing", () => {
    expect(() => buildSolid("cube", undefined, createBuilderContext("invalid"))).not.toThrow()
    expect(buildSolid("cube", undefined, createBuilderContext("invalid")).diagnostics.map((diagnostic) => diagnostic.code)).toContain("invalid-input")
  })

  it("allows a validated custom builder strategy to be registered", () => {
    registerSolidBuilder({
      id: "test-builder",
      label: "测试构造器",
      create: () => ({ primitives: [], vertexIds: [], edgeIds: [], faceIds: [], diagnostics: [] })
    })

    expect(listSolidBuilders()).toContain("test-builder")
    expect(buildSolid("test-builder", {}, createBuilderContext("custom")).diagnostics).toEqual([])
  })

  it("does not throw for invalid registration or a failing custom builder", () => {
    expect(() => registerSolidBuilder(undefined as never)).not.toThrow()
    expect(registerSolidBuilder(undefined as never)).toBe(false)
    expect(() => registerSolidBuilder({ id: "", label: "", create: () => ({}) } as never)).not.toThrow()
    expect(registerSolidBuilder({ id: "", label: "", create: () => ({}) } as never)).toBe(false)
    expect(registerSolidBuilder({ id: "failing-builder", label: "Failing", create: () => { throw new Error("boom") } })).toBe(true)

    const result = buildSolid("failing-builder", {}, createBuilderContext("failing"))
    expect(result.primitives).toEqual([])
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("invalid-input")
  })

  it("validates solids after translating large world coordinates", () => {
    const result = buildFromPoints({
      vertices: [
        { x: 1e9, y: 1e9, z: 1e9 },
        { x: 1e9 + 1, y: 1e9, z: 1e9 },
        { x: 1e9 + 1, y: 1e9 + 1, z: 1e9 },
        { x: 1e9, y: 1e9 + 1, z: 1e9 },
        { x: 1e9, y: 1e9, z: 1e9 + 1 },
        { x: 1e9 + 1, y: 1e9, z: 1e9 + 1 },
        { x: 1e9 + 1, y: 1e9 + 1, z: 1e9 + 1 },
        { x: 1e9, y: 1e9 + 1, z: 1e9 + 1 }
      ],
      faces: [[3, 2, 1, 0], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
    }, createBuilderContext("large-coordinate"))

    expect(result.diagnostics).toEqual([])
  })
})
