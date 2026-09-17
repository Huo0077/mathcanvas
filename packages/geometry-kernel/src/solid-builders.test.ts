import { describe, expect, it } from "vitest"

import { buildFromPoints, buildFrustum, buildPrism, buildSolid, buildSolidTemplate, createBuilderContext, listSolidBuilders, registerSolidBuilder } from "./solid-builders"

const triangle = [
  { x: 0, y: 0, z: 0 },
  { x: 2, y: 0, z: 0 },
  { x: 0, y: 2, z: 0 }
]

describe("solid builders", () => {
  it("creates stable topology templates from legacy solid parameters", () => {
    const legacy = { id: "cube-1", type: "cube" as const, origin: { x: -1, y: -2, z: -3 }, size: { x: 2, y: 4, z: 6 }, label: "立方体 1" }
    const first = buildSolidTemplate(legacy)
    const second = buildSolidTemplate(legacy)
    const polyhedron = first.primitives.find((primitive) => primitive.type === "polyhedron3")

    expect(first.diagnostics).toEqual([])
    expect(first.vertexIds).toHaveLength(8)
    expect(first.edgeIds).toHaveLength(12)
    expect(first.faceIds).toHaveLength(6)
    expect(polyhedron).toMatchObject({ label: "立方体 1", construction: { kind: "template", templateId: "cube", sourceIds: expect.arrayContaining(["cube-1"]) } })
    expect(second.vertexIds).toEqual(first.vertexIds)
    expect(second.edgeIds).toEqual(first.edgeIds)
    expect(second.faceIds).toEqual(first.faceIds)
  })

  const degrees = (value: number) => value * Math.PI / 180
  const solidPoints = (result: ReturnType<typeof buildSolidTemplate>) => result.primitives.flatMap((primitive) => primitive.type === "point3" ? [{ ...primitive.position }] : [])
  const span = (points: { x: number; y: number; z: number }[], axis: "x" | "y" | "z") => Math.max(...points.map((point) => point[axis])) - Math.min(...points.map((point) => point[axis]))
  const distance = (point: { x: number; y: number; z: number }, origin: { x: number; y: number; z: number }) => Math.hypot(point.x - origin.x, point.y - origin.y, point.z - origin.z)

  it("tips a cone by rotating it about its own axis midpoint", () => {
    const cone = { id: "cone-1", type: "cone" as const, center: { x: 0, y: 0, z: 0 }, radius: 2, height: 4, segments: 4 }
    const upright = buildSolidTemplate(cone)
    const tipped = buildSolidTemplate({ ...cone, rotation: { x: degrees(90), y: 0, z: 0 } })
    const pivot = { x: 0, y: 0, z: 2 }
    // The apex is the vertex closest to the axis midpoint: the base ring sits further out at sqrt(r^2 + (h/2)^2).
    const apex = (result: ReturnType<typeof buildSolidTemplate>) => solidPoints(result).reduce((closest, point) => distance(point, pivot) < distance(closest, pivot) ? point : closest)

    expect(buildSolidTemplate(cone).diagnostics).toEqual([])
    expect(tipped.diagnostics).toEqual([])
    expect(apex(upright).z).toBeCloseTo(4, 6)
    // A 90 degree turn about X lays the axis along -Y instead of leaving it on +Z.
    expect(apex(tipped).x).toBeCloseTo(0, 6)
    expect(apex(tipped).y).toBeCloseTo(-2, 6)
    expect(apex(tipped).z).toBeCloseTo(2, 6)
    // Rigid: the cone is tipped, not resized, so every vertex keeps its distance to the pivot.
    const uprightDistances = solidPoints(upright).map((point) => distance(point, pivot)).sort((first, second) => first - second)
    const tippedDistances = solidPoints(tipped).map((point) => distance(point, pivot)).sort((first, second) => first - second)
    tippedDistances.forEach((value, index) => expect(value).toBeCloseTo(uprightDistances[index], 6))
  })

  it("lays a cylinder down by rotating it about its own axis midpoint", () => {
    const cylinder = { id: "cylinder-1", type: "cylinder" as const, center: { x: 0, y: 0, z: 0 }, radius: 1, height: 6, segments: 4 }
    const upright = solidPoints(buildSolidTemplate(cylinder))
    const lying = solidPoints(buildSolidTemplate({ ...cylinder, rotation: { x: 0, y: degrees(90), z: 0 } }))

    expect(span(upright, "z")).toBeCloseTo(6, 6)
    expect(span(upright, "x")).toBeCloseTo(2, 6)
    // Standing up the height is on Z; after a 90 degree turn about Y the same length is on X.
    expect(span(lying, "x")).toBeCloseTo(6, 6)
    expect(span(lying, "z")).toBeCloseTo(2, 6)
  })

  it("tilts a cube about its box centre and a pyramid about its axis midpoint", () => {
    const cube = { id: "cube-1", type: "cube" as const, origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }
    const tiltedCube = solidPoints(buildSolidTemplate({ ...cube, rotation: { x: 0, y: 0, z: degrees(45) } }))
    // The pivot is the box centre, so a 45 degree turn about Z lines the diagonal up with the X axis.
    expect(span(tiltedCube, "x")).toBeCloseTo(2 * Math.SQRT2, 6)
    expect(span(tiltedCube, "z")).toBeCloseTo(2, 6)

    const pyramid = { id: "pyramid-1", type: "pyramid" as const, baseCenter: { x: 0, y: 0, z: 0 }, baseSize: { x: 4, y: 4 }, height: 3 }
    const tippedPyramid = solidPoints(buildSolidTemplate({ ...pyramid, rotation: { x: degrees(90), y: 0, z: 0 } }))
    expect(span(tippedPyramid, "z")).toBeCloseTo(4, 6)
    expect(span(tippedPyramid, "y")).toBeCloseTo(3, 6)
  })

  it("leaves an unrotated template exactly as it was", () => {
    const cube = { id: "cube-1", type: "cube" as const, origin: { x: -1, y: -2, z: -3 }, size: { x: 2, y: 4, z: 6 } }

    expect(solidPoints(buildSolidTemplate({ ...cube, rotation: { x: 0, y: 0, z: 0 } }))).toEqual(solidPoints(buildSolidTemplate(cube)))
  })

  it("builds a point-driven triangular prism with closed topology", () => {    const result = buildPrism({ base: triangle, vector: { x: 0, y: 0, z: 3 } }, createBuilderContext("prism"))

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
    // 体检发现的真缺陷：`catch {}` 把**任何**内部异常都说成"输入不合法"，
    // 真实原因（构造器内部崩溃）被吞掉。诊断必须带上原始消息。
    expect(result.diagnostics.map((diagnostic) => diagnostic.message).join(" ")).toContain("boom")
  })

  /**
   * 同一次体检：`segments` 只有下界（< 3 才拒绝）。`buildSolid("cylinder", { segments: 1e9 })`
   * 会去分配十亿个顶点数组——浏览器直接卡死 / 内存爆掉。schema 卡在 256，内核这一层也要卡住。
   */
  it("refuses an absurd segment count instead of allocating it", () => {
    const input = { center: { x: 0, y: 0, z: 0 }, radius: 1, height: 2, segments: 257 }
    const tooMany = buildSolid("cylinder", input, createBuilderContext("too-many-segments"))
    expect(tooMany.primitives).toEqual([])
    expect(tooMany.diagnostics[0].code).toBe("invalid-input")
    expect(tooMany.diagnostics[0].message).toContain("256")

    const absurd = buildSolid("cylinder", { ...input, segments: 1e9 }, createBuilderContext("absurd-segments"))
    expect(absurd.primitives).toEqual([])
    expect(absurd.diagnostics[0].message).toContain("256")

    // 上限之内照常构建（默认的 48 段）。
    expect(buildSolid("cylinder", { ...input, segments: 48 }, createBuilderContext("ok-segments")).primitives.length).toBeGreaterThan(0)
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
