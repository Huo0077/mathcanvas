import { describe, expect, it } from "vitest"

import { createDefaultCadLayout, createEmptyDocument, decodeMgeo, encodeMgeo, validateDocument } from "./index"

/** 一只拓扑合法的四面体（`solid-spec` / `solid-bad` 的顶点、棱、面都指向它）。 */
function prismTopology() {
  return [
    { id: "point-a", type: "point3" as const, position: { x: 0, y: 0, z: 0 } },
    { id: "point-b", type: "point3" as const, position: { x: 1, y: 0, z: 0 } },
    { id: "point-c", type: "point3" as const, position: { x: 0, y: 1, z: 0 } },
    { id: "point-d", type: "point3" as const, position: { x: 0, y: 0, z: 1 } },
    { id: "edge-ab", type: "edge3" as const, pointIds: ["point-a", "point-b"] as [string, string] },
    { id: "edge-ac", type: "edge3" as const, pointIds: ["point-a", "point-c"] as [string, string] },
    { id: "edge-ad", type: "edge3" as const, pointIds: ["point-a", "point-d"] as [string, string] },
    { id: "edge-bc", type: "edge3" as const, pointIds: ["point-b", "point-c"] as [string, string] },
    { id: "edge-bd", type: "edge3" as const, pointIds: ["point-b", "point-d"] as [string, string] },
    { id: "edge-cd", type: "edge3" as const, pointIds: ["point-c", "point-d"] as [string, string] },
    { id: "face-abc", type: "face3" as const, pointIds: ["point-a", "point-b", "point-c"], edgeIds: ["edge-ab", "edge-bc", "edge-ac"] },
    { id: "face-abd", type: "face3" as const, pointIds: ["point-a", "point-b", "point-d"], edgeIds: ["edge-ab", "edge-bd", "edge-ad"] },
    { id: "face-acd", type: "face3" as const, pointIds: ["point-a", "point-c", "point-d"], edgeIds: ["edge-ac", "edge-cd", "edge-ad"] },
    { id: "face-bcd", type: "face3" as const, pointIds: ["point-b", "point-c", "point-d"], edgeIds: ["edge-bc", "edge-cd", "edge-bd"] }
  ]
}

describe("Geometry DSL codec", () => {
  it("round-trips the orientation of a template solid", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [{ id: "cone-1", type: "cone", center: { x: 0, y: 0, z: 0 }, radius: 1, height: 2, segments: 24, rotation: { x: Math.PI / 2, y: 0, z: -Math.PI / 4 } }]

    const restored = decodeMgeo(encodeMgeo(document))

    expect(restored.primitives[0]).toMatchObject({ type: "cone", rotation: { x: Math.PI / 2, y: 0, z: -Math.PI / 4 } })
  })

  it("keeps upright the solids written before orientation existed", () => {
    const legacy = { format: "mgeo", formatVersion: "0.1", document: { ...createEmptyDocument("geometry3d"), primitives: [{ id: "cone-1", type: "cone", center: { x: 0, y: 0, z: 0 }, radius: 1, height: 2, segments: 24 }] } }

    const restored = decodeMgeo(JSON.stringify(legacy))

    expect((restored.primitives[0] as { rotation?: unknown }).rotation).toBeUndefined()
  })

  /**
   * 轨道圆改成**自带圆心**之后，旧文档里的 `centerId`（引用一个点当圆心）必须在**校验之前**搬成 `center`。
   *
   * 顺序反了旧文件会因为"字段不合法"直接打不开（`decodeMgeo` 对不合法文档是 `throw`），
   * 这不是"少一个功能"，而是"用户的文件打不开"。
   */
  it("migrates a legacy circle track that referenced a point, and is idempotent", () => {
    const legacy = JSON.stringify({
      format: "mgeo",
      formatVersion: "0.1",
      document: {
        ...createEmptyDocument("geometry3d"),
        primitives: [
          { id: "point-a", type: "point3", position: { x: 1, y: 2, z: 3 }, binding: { kind: "free" } },
          { id: "orbit-1", type: "circle3", centerId: "point-a", normal: { x: 0, y: 0, z: 1 }, radius: 2 }
        ]
      }
    })

    const document = decodeMgeo(legacy)
    const track = document.primitives.find((primitive) => primitive.id === "orbit-1") as { center?: { x: number; y: number; z: number }; centerId?: string }
    expect(track.center).toEqual({ x: 1, y: 2, z: 3 })
    expect("centerId" in track).toBe(false)

    // 幂等：已经搬好的文档再解一次不变（导出再导入也一样）。
    const again = decodeMgeo(encodeMgeo(document))
    expect(again.primitives.find((primitive) => primitive.id === "orbit-1")).toMatchObject({ center: { x: 1, y: 2, z: 3 } })
    expect(again.primitives).toHaveLength(2)
  })

  it("drops only the track whose centre point is missing, keeping the rest of the file loadable", () => {
    const legacy = JSON.stringify({
      format: "mgeo",
      formatVersion: "0.1",
      document: {
        ...createEmptyDocument("geometry3d"),
        primitives: [
          { id: "point-a", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "free" } },
          { id: "orbit-broken", type: "circle3", centerId: "gone", normal: { x: 0, y: 0, z: 1 }, radius: 2 }
        ]
      }
    })

    // 宁可少一条轨道，也不能让整份文件打不开。
    expect(decodeMgeo(legacy).primitives.map((primitive) => primitive.id)).toEqual(["point-a"])
  })

  it("rejects an orientation that is not three finite radians", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [{ id: "cone-1", type: "cone", center: { x: 0, y: 0, z: 0 }, radius: 1, height: 2, segments: 24, rotation: { x: Number.NaN, y: 0, z: 0 } }]

    expect(validateDocument(document).valid).toBe(false)
    expect(() => encodeMgeo(document)).toThrow(/rotation must be three finite radians/)
  })

  it("round-trips an explicit plane patch size", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "p0", type: "point3", position: { x: 0, y: 0, z: 0 } },
      { id: "p1", type: "point3", position: { x: 4, y: 0, z: 0 } },
      { id: "p2", type: "point3", position: { x: 0, y: 4, z: 0 } },
      { id: "plane-abc", type: "plane3", definition: { kind: "throughPoints", pointIds: ["p0", "p1", "p2"] }, halfSize: 6 }
    ]

    const restored = decodeMgeo(encodeMgeo(document))

    expect(restored.primitives.find((primitive) => primitive.id === "plane-abc")).toMatchObject({ halfSize: 6 })
  })

  it("rejects a plane patch size that is not a positive number", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "p0", type: "point3", position: { x: 0, y: 0, z: 0 } },
      { id: "p1", type: "point3", position: { x: 4, y: 0, z: 0 } },
      { id: "p2", type: "point3", position: { x: 0, y: 4, z: 0 } },
      { id: "plane-abc", type: "plane3", definition: { kind: "throughPoints", pointIds: ["p0", "p1", "p2"] }, halfSize: 0 }
    ]

    expect(validateDocument(document).valid).toBe(false)
    expect(() => encodeMgeo(document)).toThrow(/halfSize must be a positive finite number/)
  })

  it("migrates legacy CAD documents to default layers and views", () => {
    const document = createEmptyDocument("cad")
    document.primitives = [{ id: "point-1", type: "point", x: 1, y: 2 }]
    const originalPrimitives = structuredClone(document.primitives)

    const restored = decodeMgeo(JSON.stringify(document))

    expect(restored.layers?.map((layer) => layer.name)).toEqual(["几何", "尺寸", "辅助线", "注释"])
    expect(restored.drawingSheets).toHaveLength(1)
    expect(restored.drawingViews?.map((view) => view.kind)).toEqual(["front", "top", "left", "axonometric"])
    expect(restored.primitives).toEqual(originalPrimitives)
  })

  it("round trips nested layer and sheet layout data", () => {
    const document = createDefaultCadLayout(createEmptyDocument("cad"))
    document.layers?.push({
      id: "layer-detail",
      name: "细节",
      parentId: "layer-geometry",
      kind: "geometry",
      visible: true,
      locked: false,
      printable: true
    })
    const frontView = document.drawingViews?.find((view) => view.id === "view-front")
    if (frontView) Object.assign(frontView, { x: 24, y: 32, width: 240, height: 180, scale: 2 })

    const restored = decodeMgeo(encodeMgeo(document))

    expect(restored.layers).toEqual(document.layers)
    expect(restored.drawingSheets).toEqual(document.drawingSheets)
    expect(restored.drawingViews).toEqual(document.drawingViews)
  })

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

  it("round-trips a point-driven 3D document with topology, section and dihedral measurement", () => {
    const document = createEmptyDocument("geometry3d")
    const positions: Record<string, { x: number; y: number; z: number }> = {
      v0: { x: -1, y: -1, z: -1 }, v1: { x: 1, y: -1, z: -1 }, v2: { x: 1, y: 1, z: -1 }, v3: { x: -1, y: 1, z: -1 },
      v4: { x: -1, y: -1, z: 1 }, v5: { x: 1, y: -1, z: 1 }, v6: { x: 1, y: 1, z: 1 }, v7: { x: -1, y: 1, z: 1 }
    }
    document.primitives = [
      ...Object.entries(positions).map(([id, position]) => ({ id, type: "point3" as const, position })),
      { id: "e0", type: "edge3", pointIds: ["v0", "v1"] }, { id: "e1", type: "edge3", pointIds: ["v1", "v2"] },
      { id: "e2", type: "edge3", pointIds: ["v2", "v3"] }, { id: "e3", type: "edge3", pointIds: ["v3", "v0"] },
      { id: "e4", type: "edge3", pointIds: ["v4", "v5"] }, { id: "e5", type: "edge3", pointIds: ["v5", "v6"] },
      { id: "e6", type: "edge3", pointIds: ["v6", "v7"] }, { id: "e7", type: "edge3", pointIds: ["v7", "v4"] },
      { id: "e8", type: "edge3", pointIds: ["v0", "v4"] }, { id: "e9", type: "edge3", pointIds: ["v1", "v5"] },
      { id: "e10", type: "edge3", pointIds: ["v2", "v6"] }, { id: "e11", type: "edge3", pointIds: ["v3", "v7"] },
      { id: "f-bottom", type: "face3", pointIds: ["v0", "v1", "v2", "v3"] },
      { id: "f-top", type: "face3", pointIds: ["v4", "v5", "v6", "v7"] },
      { id: "f-front", type: "face3", pointIds: ["v0", "v1", "v5", "v4"] },
      { id: "f-right", type: "face3", pointIds: ["v1", "v2", "v6", "v5"] },
      { id: "f-back", type: "face3", pointIds: ["v2", "v3", "v7", "v6"] },
      { id: "f-left", type: "face3", pointIds: ["v3", "v0", "v4", "v7"] },
      { id: "solid-1", type: "polyhedron3", vertexIds: Object.keys(positions), edgeIds: ["e0", "e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8", "e9", "e10", "e11"], faceIds: ["f-bottom", "f-top", "f-front", "f-right", "f-back", "f-left"] },
      { id: "section-1", type: "section", sourceId: "solid-1", plane: { normal: { x: 0, y: 0, z: 1 }, constant: 0 }, points: [{ x: -1, y: -1, z: 0 }, { x: 1, y: -1, z: 0 }, { x: 1, y: 1, z: 0 }, { x: -1, y: 1, z: 0 }], classification: "polygon", status: "approximate" }
    ]
    document.measurements = [{ id: "measurement3-1", kind: "measurement3", sourceIds: ["f-bottom", "f-front"], metric: "dihedral", dihedralKind: "exterior", value: 90, unit: "°", precision: "numeric-approximation", status: "valid", explanation: "以公共棱为轴计算二面角。" }]

    const restored = decodeMgeo(encodeMgeo(document))

    expect(restored.primitives).toEqual(document.primitives)
    expect(restored.measurements).toEqual(document.measurements)
    expect(restored.schemaVersion).toBe("0.1")
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

  it("round-trips an intersection-line primitive and rejects invalid ones", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "cube-a", type: "cube", origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } },
      { id: "cube-b", type: "cube", origin: { x: 0, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } },
      { id: "line-1", type: "intersectionLine", sourceIds: ["cube-a", "cube-b"], segments: [{ a: { x: 2, y: -2, z: -2 }, b: { x: 2, y: 2, z: -2 } }], classification: "segment", status: "valid" }
    ]

    const restored = decodeMgeo(encodeMgeo(document))
    expect(restored.primitives).toEqual(document.primitives)
    expect(restored.schemaVersion).toBe("0.1")

    // 校验必须拦住：来源不足两个、来源相同、来源缺失、来源类型不对、段端点非有限、状态非法。
    const invalid = (primitive: Record<string, unknown>) => validateDocument({ ...document, primitives: [document.primitives[0], document.primitives[1], primitive as never] })
    expect(invalid({ id: "x", type: "intersectionLine", sourceIds: ["cube-a"], segments: [], status: "valid" }).valid).toBe(false)
    expect(invalid({ id: "x", type: "intersectionLine", sourceIds: ["cube-a", "cube-a"], segments: [], status: "valid" }).valid).toBe(false)
    expect(invalid({ id: "x", type: "intersectionLine", sourceIds: ["cube-a", "missing"], segments: [], status: "valid" }).valid).toBe(false)
    expect(invalid({ id: "x", type: "intersectionLine", sourceIds: ["cube-a", "cube-b"], segments: [{ a: { x: 0, y: 0, z: Number.NaN }, b: { x: 1, y: 1, z: 1 } }], status: "valid" }).valid).toBe(false)
    expect(invalid({ id: "x", type: "intersectionLine", sourceIds: ["cube-a", "cube-b"], segments: [], status: "wrong" }).valid).toBe(false)
  })

  it("round-trips an intersection-solid primitive and rejects invalid ones", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "cube-a", type: "cube", origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } },
      { id: "cube-b", type: "cube", origin: { x: 0, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } },
      {
        id: "solid-1",
        type: "intersectionSolid",
        sourceIds: ["cube-a", "cube-b"],
        vertices: [{ x: 0, y: -2, z: -2 }, { x: 2, y: -2, z: -2 }, { x: 2, y: 2, z: -2 }, { x: 0, y: 2, z: -2 }, { x: 0, y: -2, z: 2 }, { x: 2, y: -2, z: 2 }, { x: 2, y: 2, z: 2 }, { x: 0, y: 2, z: 2 }],
        faces: [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]],
        volume: 16,
        area: 40,
        status: "polyhedron"
      }
    ]

    const restored = decodeMgeo(encodeMgeo(document))
    expect(restored.primitives).toEqual(document.primitives)

    // 校验必须拦住：来源不足两个、来源相同、来源缺失、顶点非有限、面环越界、体积非有限、状态非法。
    const invalid = (primitive: Record<string, unknown>) => validateDocument({ ...document, primitives: [document.primitives[0], document.primitives[1], primitive as never] })
    const valid = document.primitives[2] as unknown as Record<string, unknown>
    expect(invalid({ ...valid, sourceIds: ["cube-a"] }).valid).toBe(false)
    expect(invalid({ ...valid, sourceIds: ["cube-a", "cube-a"] }).valid).toBe(false)
    expect(invalid({ ...valid, sourceIds: ["cube-a", "missing"] }).valid).toBe(false)
    expect(invalid({ ...valid, vertices: [{ x: Number.NaN, y: 0, z: 0 }] }).valid).toBe(false)
    expect(invalid({ ...valid, faces: [[0, 1, 9]] }).valid).toBe(false)
    expect(invalid({ ...valid, volume: Number.POSITIVE_INFINITY }).valid).toBe(false)
    expect(invalid({ ...valid, status: "wrong" }).valid).toBe(false)
  })

  it("round-trips an intersection face and an intersection point, and rejects invalid ones", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "cube-a", type: "cube", origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } },
      { id: "cube-b", type: "cube", origin: { x: 0, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } },
      {
        id: "face-1",
        type: "intersectionFace",
        sourceIds: ["cube-a", "cube-b"],
        points: [{ x: 0, y: -2, z: -2 }, { x: 2, y: -2, z: -2 }, { x: 2, y: 2, z: -2 }, { x: 0, y: 2, z: -2 }],
        normal: { x: 0, y: 0, z: -1 },
        area: 16,
        hint: { x: 1, y: 0, z: -2 },
        status: "valid"
      },
      {
        id: "point-1",
        type: "intersectionPoint3",
        sourceIds: ["cube-a", "cube-b"],
        position: { x: 0, y: -2, z: -2 },
        hint: { x: 0, y: -2, z: -2 },
        status: "valid"
      }
    ]

    const restored = decodeMgeo(encodeMgeo(document))
    expect(restored.primitives).toEqual(document.primitives)

    // 校验必须拦住：来源不足两个 / 相同 / 缺失 / 类型不对、顶点或法向非有限、面积非有限、
    // 位置非有限、状态非法。
    const invalid = (primitive: Record<string, unknown>) => validateDocument({ ...document, primitives: [document.primitives[0], document.primitives[1], primitive as never] })
    const face = document.primitives[2] as unknown as Record<string, unknown>
    const point = document.primitives[3] as unknown as Record<string, unknown>
    expect(invalid({ ...face, sourceIds: ["cube-a"] }).valid).toBe(false)
    expect(invalid({ ...face, sourceIds: ["cube-a", "cube-a"] }).valid).toBe(false)
    expect(invalid({ ...face, sourceIds: ["cube-a", "missing"] }).valid).toBe(false)
    expect(invalid({ ...face, points: [{ x: Number.NaN, y: 0, z: 0 }] }).valid).toBe(false)
    expect(invalid({ ...face, normal: { x: Number.NaN, y: 0, z: 0 } }).valid).toBe(false)
    expect(invalid({ ...face, area: Number.POSITIVE_INFINITY }).valid).toBe(false)
    expect(invalid({ ...face, hint: { x: 0, y: Number.NaN, z: 0 } }).valid).toBe(false)
    expect(invalid({ ...face, status: "wrong" }).valid).toBe(false)
    expect(invalid({ ...point, sourceIds: ["cube-a", "cube-a"] }).valid).toBe(false)
    expect(invalid({ ...point, position: { x: Number.NaN, y: 0, z: 0 } }).valid).toBe(false)
    expect(invalid({ ...point, status: "wrong" }).valid).toBe(false)
    // 交面必须是两个**实体**：面和平面没有体积可言（交点是交线的端点，面/平面可以）。
    expect(invalid({ ...face, sourceIds: ["cube-a", "point-1"] }).valid).toBe(false)
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

  /**
   * **规格 §3.2 的文档要能打开，并在解析边界被抬成世界顶点**（Fix round 2 / I6 + Deviation 5）。
   *
   * 规格给的是 `base.plane`（原点 + 法向）与**二维**多边形点；存储形式仍是世界顶点
   * （不引入第二份几何真源，见 `types.ts` 的 `PrismConstruction`）。抬升只发生在**解析边界**
   * —— `decodeMgeo` 的解码器里，与 `withCircleTrackCenter` / `withSectionClassification`
   * 同一条流水线（都必须在校验之前），否则照规格写的文件会因为"缺少 z"直接打不开。
   */
  it("lifts a spec §3.2 prism base (plane + 2-D polygon) to world vertices", () => {
    const specDocument = (construction: unknown) => JSON.stringify({
      format: "mgeo",
      formatVersion: "0.1",
      document: { ...createEmptyDocument("geometry3d"), primitives: [...prismTopology(), { id: "solid-spec", type: "polyhedron3", vertexIds: ["point-a", "point-b", "point-c", "point-d"], edgeIds: ["edge-ab", "edge-ac", "edge-ad", "edge-bc", "edge-bd", "edge-cd"], faceIds: ["face-abc", "face-abd", "face-acd", "face-bcd"], construction }] }
    })

    const document = decodeMgeo(specDocument({
      kind: "prism",
      base: {
        plane: { origin: { x: 0, y: 0, z: 2 }, normal: { x: 0, y: 0, z: 1 } },
        // 规格 §3.2 的那个底面：2-D 点。
        polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 5, y: 2 }, { x: 1, y: 2 }]
      },
      vector: { x: 1, y: 0.5, z: 3 }
    }))
    const solid = document.primitives.find((primitive) => primitive.id === "solid-spec")
    if (solid?.type !== "polyhedron3" || solid.construction?.kind !== "prism") throw new Error("expected the prism solid")

    /**
     * 抬到平面上：`B = origin + x·u + y·v`，其中 `(u, v)` 是平面内的一组正交单位基。
     *
     * 断言分两层，免得把测试绑在基底的**朝向**上：
     * 1. 每个点都落在给定平面上（`z = 2`）—— 这是规格 "底面点共面" 的硬要求；
     * 2. 边长相符 —— 抬升是刚体等距变换，形状不许变。
     * 具体坐标（(0,4)、(2,5)… 这种带旋转的写法）只作为读数记在下面，好让"底面朝向"这件事可见。
     */
    const polygon = solid.construction.base.polygon
    expect(polygon).toHaveLength(4)
    for (const point of polygon) expect(point.z).toBeCloseTo(2, 9)
    const lengths = polygon.map((point, index) => {
      const next = polygon[(index + 1) % polygon.length]
      return Math.hypot(point.x - next.x, point.y - next.y, point.z - next.z)
    })
    // 规格例子的底面边长：4、√5、4、√5（菱形一样的四边形）。
    expect(lengths.map((length) => Number(length.toFixed(6))).sort((first, second) => first - second)).toEqual([4, 4, Math.sqrt(5), Math.sqrt(5)].map((length) => Number(length.toFixed(6))).sort((first, second) => first - second))
    // 抬升是幂等的，而且抬过之后再存再读不再变。
    expect(decodeMgeo(encodeMgeo(document)).primitives).toEqual(document.primitives)
  })

  /**
   * **导入路径上的几何语义校验**（Fix round 2 / I6）：手改 / 导入的 `.mgeo` 里那只"自交底面"
   * 或"不共面底面"的棱柱必须被**拒掉**，而不是画出来一堆非平面的侧面。
   *
   * 判据不是 schema 自己抄的一份，而是内核的 `validatePrismInput` —— 创建路径与导入路径
   * 因此用的是同一个判据（规格 §6.2）。
   */
  it("rejects an imported prism whose base is self-intersecting or non-coplanar", () => {
    const imported = (id: string, polygon: unknown, vector: unknown) => JSON.stringify({
      format: "mgeo",
      formatVersion: "0.1",
      document: { ...createEmptyDocument("geometry3d"), primitives: [...prismTopology(), { id, type: "polyhedron3", vertexIds: ["point-a", "point-b", "point-c", "point-d"], edgeIds: ["edge-ab", "edge-ac", "edge-ad", "edge-bc", "edge-bd", "edge-cd"], faceIds: ["face-abc", "face-abd", "face-acd", "face-bcd"], construction: { kind: "prism", base: { polygon }, vector } }] }
    })

    // 自交（bowtie）：`validatePrismInput` 报 self-intersection。
    expect(() => decodeMgeo(imported("solid-bad", [{ x: 0, y: 0, z: 0 }, { x: 4, y: 4, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 0, y: 4, z: 0 }], { x: 0, y: 0, z: 3 }))).toThrow(/solid-bad prism base is invalid[\s\S]*自交/)
    // 不共面：四个点里有一个翘出平面。
    expect(() => decodeMgeo(imported("solid-bad", [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 3, z: 0 }, { x: 0, y: 3, z: 1 }], { x: 0, y: 0, z: 3 }))).toThrow(/solid-bad prism base is invalid[\s\S]*共面/)
    // 零体积（拉伸向量平行于底面）：同一份判据也要挡住导入路径。
    expect(() => decodeMgeo(imported("solid-flat", [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 3, z: 0 }, { x: 0, y: 3, z: 0 }], { x: 2, y: 0, z: 0 }))).toThrow(/solid-flat prism base is invalid[\s\S]*体积/)

    // 合法的棱柱照旧能读（这条是上面三条的对照，防止"一律拒绝"式的假修复）。
    expect(() => decodeMgeo(imported("solid-ok", [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 3, z: 0 }, { x: 0, y: 3, z: 0 }], { x: 0, y: 0, z: 3 }))).not.toThrow()
  })

  /**
   * **带 `plane` 字段不能成为绕过几何语义校验的通行证**（外部审查 G2）。
   *
   * 上面那条用例没有 `plane`，所以它一直是绿的、从来没覆盖到这条路。而 schema 的判据
   * 原先以 `planeBase === undefined` 为门：只要给底面配一个平面，`base.polygon` 是**三维**
   * 世界坐标也照样跳过内核判据（`isPrismPlaneBase` 要求二维点没有 `z`，两种写法互斥，
   * 所以这种输入既不被 codec 抬升、也不被 schema 校验）。导入与保存两条路径一起漏。
   */
  it("rejects the same invalid bases even when a plane field is attached", () => {
    const plane = { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } }
    const imported = (id: string, polygon: unknown, vector: unknown) => JSON.stringify({
      format: "mgeo",
      formatVersion: "0.1",
      document: { ...createEmptyDocument("geometry3d"), primitives: [...prismTopology(), { id, type: "polyhedron3", vertexIds: ["point-a", "point-b", "point-c", "point-d"], edgeIds: ["edge-ab", "edge-ac", "edge-ad", "edge-bc", "edge-bd", "edge-cd"], faceIds: ["face-abc", "face-abd", "face-acd", "face-bcd"], construction: { kind: "prism", base: { plane, polygon }, vector } }] }
    })

    // 自交（bowtie）、不共面、零体积 —— 与上一条完全相同的三份坏输入，只多了一个 `plane`。
    expect(() => decodeMgeo(imported("solid-bowtie", [{ x: 0, y: 0, z: 0 }, { x: 4, y: 4, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 0, y: 4, z: 0 }], { x: 0, y: 0, z: 3 }))).toThrow(/solid-bowtie prism base is invalid[\s\S]*自交/)
    expect(() => decodeMgeo(imported("solid-skew", [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 3, z: 0 }, { x: 0, y: 3, z: 1 }], { x: 0, y: 0, z: 3 }))).toThrow(/solid-skew prism base is invalid[\s\S]*共面/)
    expect(() => decodeMgeo(imported("solid-flat", [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 3, z: 0 }, { x: 0, y: 3, z: 0 }], { x: 2, y: 0, z: 0 }))).toThrow(/solid-flat prism base is invalid[\s\S]*体积/)

    // 对照：合法的三维底面配一个多余的 `plane` 照旧能读（防止"一律拒绝"式的假修复）。
    expect(() => decodeMgeo(imported("solid-ok", [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 3, z: 0 }, { x: 0, y: 3, z: 0 }], { x: 0, y: 0, z: 3 }))).not.toThrow()
  })

  it("rejects malformed primitive fields without throwing", () => {    const base = createEmptyDocument("calculus")
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
      { id: "circle-abc", type: "circle3", center: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, radius: 2 },
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
      { id: "solid-4", type: "polyhedron3", vertexIds: ["point-a", "point-b", "point-c", "point-d"], edgeIds: [], faceIds: [], construction: { kind: "template", templateId: "cube", parameterIds: ["missing-parameter"], sourceIds: [] } },
      { id: "solid-5", type: "polyhedron3", vertexIds: ["point-a", "point-b", "point-c", "point-d"], edgeIds: [], faceIds: [], construction: { kind: "prism", base: { polygon: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }] }, vector: { x: 0, y: 0, z: 0 } } }
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
      expect(result.errors).toContain("polyhedron3 prism construction is invalid")
    }
  })

  /**
   * **棱柱构造的描述符要能往返**（Solid/Prism 切片 Task 1）。
   *
   * 构造描述是**真源**（规格 §1.2），顶点 / 棱 / 面是确定性派生拓扑：所以"存下来的是哪份描述"
   * 必须逐字往返，否则重新打开文档时算出来的是另一只棱柱。
   */
  it("round-trips a prism construction descriptor", () => {
    const document = createEmptyDocument("geometry3d")
    const polygon = [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 3, y: 2, z: 0 }, { x: 1, y: 2, z: 0 }]
    const vector = { x: 1, y: 0.5, z: 4 }
    const baseIds = polygon.map((_, index) => `solid-1:v${index}`)
    const topIds = polygon.map((_, index) => `solid-1:v${polygon.length + index}`)
    const vertexIds = [...baseIds, ...topIds]
    const edgeIds = vertexIds.map((_, index) => `solid-1:e${index}`)
    const faceIds = vertexIds.map((_, index) => `solid-1:f${index}`)
    // 构造描述与它派生的拓扑可以同时存在：前者是真源，后者是缓存的几何事实。
    document.primitives = [
      ...vertexIds.map((id, index) => ({ id, type: "point3" as const, position: index < polygon.length ? polygon[index] : { x: polygon[index - polygon.length].x + vector.x, y: polygon[index - polygon.length].y + vector.y, z: polygon[index - polygon.length].z + vector.z }, binding: { kind: "free" as const } })),
      ...edgeIds.map((id) => ({ id, type: "edge3" as const, pointIds: [vertexIds[0], vertexIds[1]] as [string, string] })),
      ...faceIds.map((id) => ({ id, type: "face3" as const, pointIds: vertexIds.slice(0, 3) })),
      { id: "solid-1", type: "polyhedron3", vertexIds, edgeIds, faceIds, construction: { kind: "prism", base: { polygon }, vector } }
    ]

    const restored = decodeMgeo(encodeMgeo(document))

    expect(restored.primitives).toEqual(document.primitives)
    expect((restored.primitives.at(-1) as { construction?: unknown }).construction).toEqual({ kind: "prism", base: { polygon }, vector })
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

  it("defaults engineering annotations for legacy documents and round-trips them", () => {
    const document = createEmptyDocument("cad")
    document.primitives = [
      { id: "point-a", type: "point3", position: { x: 0, y: 0, z: 0 } },
      { id: "point-b", type: "point3", position: { x: 3, y: 4, z: 0 } }
    ]
    const legacy = JSON.parse(encodeMgeo(document)) as { document: Record<string, unknown> }
    delete legacy.document.engineeringAnnotations
    const restoredLegacy = decodeMgeo(JSON.stringify(legacy))
    expect(restoredLegacy.engineeringAnnotations).toEqual([])

    document.engineeringAnnotations = [{
      id: "dimension-1",
      kind: "linear",
      sourceIds: ["point-a", "point-b"],
      view: "front",
      value: 5,
      unit: "mm",
      status: "valid",
      explanation: "两点之间的线性尺寸"
    }]
    expect(decodeMgeo(encodeMgeo(document)).engineeringAnnotations).toEqual(document.engineeringAnnotations)
  })

  it("rejects engineering annotations with missing sources", () => {
    const document = createEmptyDocument("cad")
    document.engineeringAnnotations = [{
      id: "dimension-invalid",
      kind: "linear",
      sourceIds: ["missing-point"],
      view: "front",
      status: "insufficient-data",
      explanation: "缺少来源"
    }]

    const result = validateDocument(document)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors).toContain("engineering annotation has invalid sources: dimension-invalid")
  })

  /**
   * **四种构造形状必须并存可读**（Solid/Prism 切片 Task 6 的第二条验收）。
   *
   * 这一条把"旧文档仍然能打开"钉在**同一次解码**里：用户的历史文件里
   * `template` / `fromPoints` / `fromFaces` 都有，而新加的 `prism` 必须和它们共处，
   * 不能因为多了一支就把别支判成非法。
   */
  it("reads a document that carries all four solid construction kinds at once", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "cube-1", type: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } },
      { id: "point-a", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "free" } },
      { id: "point-b", type: "point3", position: { x: 1, y: 0, z: 0 }, binding: { kind: "free" } },
      { id: "point-c", type: "point3", position: { x: 0, y: 1, z: 0 }, binding: { kind: "free" } },
      { id: "point-d", type: "point3", position: { x: 0, y: 0, z: 1 }, binding: { kind: "free" } },
      { id: "edge-ab", type: "edge3", pointIds: ["point-a", "point-b"] },
      { id: "edge-ac", type: "edge3", pointIds: ["point-a", "point-c"] },
      { id: "edge-ad", type: "edge3", pointIds: ["point-a", "point-d"] },
      { id: "edge-bc", type: "edge3", pointIds: ["point-b", "point-c"] },
      { id: "edge-bd", type: "edge3", pointIds: ["point-b", "point-d"] },
      { id: "edge-cd", type: "edge3", pointIds: ["point-c", "point-d"] },
      { id: "face-abc", type: "face3", pointIds: ["point-a", "point-b", "point-c"], edgeIds: ["edge-ab", "edge-bc", "edge-ac"] },
      { id: "face-abd", type: "face3", pointIds: ["point-a", "point-b", "point-d"], edgeIds: ["edge-ab", "edge-bd", "edge-ad"] },
      { id: "face-acd", type: "face3", pointIds: ["point-a", "point-c", "point-d"], edgeIds: ["edge-ac", "edge-cd", "edge-ad"] },
      { id: "face-bcd", type: "face3", pointIds: ["point-b", "point-c", "point-d"], edgeIds: ["edge-bc", "edge-cd", "edge-bd"] },
      { id: "solid-fromPoints", type: "polyhedron3", vertexIds: ["point-a", "point-b", "point-c", "point-d"], edgeIds: ["edge-ab", "edge-ac", "edge-ad", "edge-bc", "edge-bd", "edge-cd"], faceIds: ["face-abc", "face-abd", "face-acd", "face-bcd"], construction: { kind: "fromPoints", sourceIds: ["point-a", "point-b", "point-c", "point-d"] } },
      { id: "solid-fromFaces", type: "polyhedron3", vertexIds: ["point-a", "point-b", "point-c", "point-d"], edgeIds: ["edge-ab", "edge-ac", "edge-ad", "edge-bc", "edge-bd", "edge-cd"], faceIds: ["face-abc", "face-abd", "face-acd", "face-bcd"], construction: { kind: "fromFaces", sourceIds: ["face-abc", "face-abd", "face-acd", "face-bcd"] } },
      { id: "solid-template", type: "polyhedron3", vertexIds: ["point-a", "point-b", "point-c", "point-d"], edgeIds: ["edge-ab", "edge-ac", "edge-ad", "edge-bc", "edge-bd", "edge-cd"], faceIds: ["face-abc", "face-abd", "face-acd", "face-bcd"], construction: { kind: "template", templateId: "cube", sourceIds: ["cube-1"] } },
      { id: "solid-prism", type: "polyhedron3", vertexIds: ["point-a", "point-b", "point-c", "point-d"], edgeIds: ["edge-ab", "edge-ac", "edge-ad", "edge-bc", "edge-bd", "edge-cd"], faceIds: ["face-abc", "face-abd", "face-acd", "face-bcd"], construction: { kind: "prism", base: { polygon: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }] }, vector: { x: 0, y: 0, z: 1 } } }
    ]

    expect(validateDocument(document)).toEqual({ valid: true })
    expect(decodeMgeo(encodeMgeo(document)).primitives).toEqual(document.primitives)
  })
})
