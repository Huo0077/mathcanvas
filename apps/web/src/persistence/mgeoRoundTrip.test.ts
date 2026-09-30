import { describe, expect, it } from "vitest"

import type { GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { createEmptyDocument, decodeMgeo, encodeMgeo } from "@draw/dsl"
import { applyOperation, compileSolidTetrahedron, recomputeDerivedObjects } from "@draw/scene-graph"

import { createDemoDocument } from "../demoDocument"
import { commitSpatialCreation } from "../spatialCreationCommands"
import type { SpatialCreationSession } from "../spatialCreationSession"

/**
 * `.mgeo` 往返的集成用例。
 *
 * 之前这些用例经由 `persistence/mgeoStorage.ts`（`saveMgeo` / `loadMgeo` 两个只转发
 * `encodeMgeo` / `decodeMgeo` 的壳）执行，而那个模块在全仓库**没有任何生产调用点**——
 * 死代码删掉了，用例直接测真正的编解码入口，覆盖不变。
 */
describe("mgeo round trip", () => {
  it("round-trips the workbench document", () => {
    const restored = decodeMgeo(encodeMgeo(createDemoDocument()))
    expect(restored.primitives.some((primitive) => primitive.id === "intersection-main")).toBe(true)
  })

  /**
   * 动点必须能存下来再打开，而且打开之后**还是动点**——光断言字段还在不够：
   * 要证明重新加载的文档拖一下仍然沿曲线滑动（也就是约束、驱动参数、轨迹都还活着）。
   */
  it("reloads a bound dynamic point that can still be dragged along its curve", () => {
    const document = createEmptyDocument("conics")
    // A parabola binding carries a domain, because its axial parameter is unbounded.
    document.parameters = { "t-point-1": { id: "t-point-1", value: 2, min: -4, max: 4 } }
    document.primitives = [
      { id: "parabola-1", type: "parabola", vertex: { x: 0, y: 0 }, focalParameter: 2, axis: "y" },
      { id: "point-1", type: "point", x: 2, y: 1, binding: { kind: "onPath", pathId: "parabola-1", parameterId: "t-point-1", parameter: 2, domain: [-4, 4] } },
      { id: "locus-1", type: "locus", sourcePointId: "point-1", parameterId: "t-point-1", domain: [-4, 4], samples: 32 }
    ]
    const saved = recomputeDerivedObjects(document)

    const restored = decodeMgeo(encodeMgeo(saved))
    // The binding, its driver parameter and the locus all survive the round trip.
    const point = restored.primitives.find((primitive) => primitive.id === "point-1")
    expect(point?.type === "point" ? point.binding : null).toEqual({
      kind: "onPath",
      pathId: "parabola-1",
      parameterId: "t-point-1",
      parameter: 2,
      domain: [-4, 4]
    })
    expect(restored.parameters["t-point-1"]).toMatchObject({ min: -4, max: 4 })
    expect(restored.primitives.find((primitive) => primitive.id === "locus-1")).toMatchObject({ parameterId: "t-point-1", domain: [-4, 4] })

    // And it is still a live dynamic point: u = 2 on y = x²/4 is (2, 1).
    expect(restored.primitives.find((primitive) => primitive.id === "point-1")).toMatchObject({ x: expect.closeTo(2, 6), y: expect.closeTo(1, 6) })

    // Drag it to (-3, 2.25), which is also on the parabola: the constraint still holds after reload.
    const dragged = applyOperation(restored, { op: "translatePrimitive", id: "point-1", delta: { x: -5, y: 1.25 } })
    expect(dragged.changed).toBe(true)
    const moved = dragged.document.primitives.find((primitive) => primitive.id === "point-1")
    expect(moved).toMatchObject({ x: expect.closeTo(-3, 3), y: expect.closeTo(2.25, 3) })
    expect(dragged.document.parameters["t-point-1"].value).toBeCloseTo(-3, 3)
  })

  /**
   * **用户现场（2026-09-23）**：Agent 建的正四面体在对象列表里是 **14 行顶层图元**（4 点 / 6 棱 / 4 面）——
   * 说明 `polyhedron3` 不在文档里（否则 `AlgebraView` 会把子对象折叠到实体行下面），删除时那些碎片
   * 互相引用，界面报 `object is referenced by another object`。
   *
   * `.mgeo` 往返（自动保存 → 恢复）此前**只用模板实体、棱柱与动态点测过**，点集构造的多面体没测过。
   */
  it("keeps a fromPoints solid (the agent's tetrahedron) through a save and reload", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = compileSolidTetrahedron("solid-1", { baseCenter: { x: 0, y: 0, z: 0 }, edge: 3 }, "正四面体 1").primitives
    expect(document.primitives).toHaveLength(15)

    const restored = decodeMgeo(encodeMgeo(document))

    const inventory = restored.primitives.map((primitive) => `${primitive.type}:${primitive.id}`).join(", ")
    expect(restored.primitives.filter((primitive) => primitive.type === "polyhedron3"), `round-tripped: ${inventory}`).toHaveLength(1)
    expect(restored.primitives, `round-tripped: ${inventory}`).toHaveLength(15)
  })

  it("round-trips a hyperbola binding together with its branch", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "hyperbola-1", type: "hyperbola", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2, axis: "x" },
      { id: "point-1", type: "point", x: 0, y: -2, binding: { kind: "onPath", pathId: "hyperbola-1", parameter: 0, branch: 1, domain: [-6, 6] } }
    ]

    const restored = decodeMgeo(encodeMgeo(recomputeDerivedObjects(document)))
    const point = restored.primitives.find((primitive) => primitive.id === "point-1")
    expect(point?.type === "point" ? point.binding : null).toMatchObject({ branch: 1, domain: [-6, 6] })
    // Still pinned to the lower branch after a reload.
    const dragged = applyOperation(restored, { op: "translatePrimitive", id: "point-1", delta: { x: 0, y: 10 } })
    const moved = dragged.document.primitives.find((primitive) => primitive.id === "point-1")
    expect(moved?.type === "point" ? moved.y : 0).toBeLessThan(0)
  })

  /**
   * **画布上直接画的点 / 线段 / 直线 / 面**（P0 的创建会话）此前**没有**往返用例：
   * 上面几条覆盖的是工作台文档、绑定动点与点集多面体，而"在 3D 画布上按步骤落点建出来的图元"
   * 是本期新加的路径。这里走真实入口（`commitSpatialCreation` + `applyOperation`，与 App 落盘同一条路）。
   *
   * 验收标准沿用本文件的惯例：不只看"字段还在"，还要证明**重开之后还能用** —— 在重开出来的文档上
   * 再画一笔引用旧点的线段，必须**复用那个点**、不新造一个重复点（规格里"点/棱/面依赖 ID 稳定"那条）。
   */
  it("keeps canvas-drawn spatial primitives through a save and reload, dependencies included", () => {
    const draw = (document: GeometryDocument, session: SpatialCreationSession): GeometryDocument => {
      const result = commitSpatialCreation(document, session)
      if ("error" in result) throw new Error(result.error)
      return result.operations.reduce((current, operation) => applyOperation(current, operation).document, document)
    }

    let document = createEmptyDocument("geometry3d")
    // 三笔共用一部分坐标：它们是**各自独立**的点，落盘后既不串号也不合并
    document = draw(document, { tool: "segment3", anchors: [{ position: { x: 0, y: 0, z: 0 } }, { position: { x: 2, y: 0, z: 0 } }] })
    document = draw(document, { tool: "line3", anchors: [{ position: { x: 0, y: 0, z: 0 } }, { position: { x: 0, y: 3, z: 0 } }] })
    document = draw(document, { tool: "face3", anchors: [{ position: { x: 0, y: 0, z: 0 } }, { position: { x: 2, y: 0, z: 0 } }, { position: { x: 0, y: 2, z: 0 } }] })

    const restored = decodeMgeo(encodeMgeo(recomputeDerivedObjects(document)))
    expect(restored.primitives).toHaveLength(document.primitives.length)
    const ids = new Set(restored.primitives.map((primitive) => primitive.id))
    expect(ids.size).toBe(restored.primitives.length)

    const point3s = restored.primitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "point3" }> => primitive.type === "point3")
    const segments = restored.primitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "segment3" }> => primitive.type === "segment3")
    const lines = restored.primitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "line3" }> => primitive.type === "line3")
    const faces = restored.primitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "face3" }> => primitive.type === "face3")
    expect(point3s).toHaveLength(7)
    expect(segments).toHaveLength(1)
    expect(lines).toHaveLength(1)
    expect(faces).toHaveLength(1)

    // 依赖仍然指着存在的点：线段 / 直线 / 面各查一遍（只查一条会漏掉另一种引用写法）
    expect(segments[0].pointIds.every((id) => ids.has(id))).toBe(true)
    expect(faces[0].pointIds.every((id) => ids.has(id))).toBe(true)
    const definition = lines[0].definition
    expect(definition.kind).toBe("throughPoints")
    expect(definition.kind === "throughPoints" && definition.pointIds.every((id) => ids.has(id))).toBe(true)

    // 几何逐值不变
    for (const expected of [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 0, y: 3, z: 0 }, { x: 0, y: 2, z: 0 }]) {
      expect(point3s.some((primitive) => primitive.position.x === expected.x && primitive.position.y === expected.y && primitive.position.z === expected.z)).toBe(true)
    }

    // **重开之后还能用**：再画一条线段引用重开后的那个点 —— 必须复用，只新造另一个点。
    // 注：`SpatialAnchor.position` 在类型上是必填（复用分支并不读它），所以这里给**那个点自己的坐标**，
    // 而不是随手编一个 —— 万一哪天复用分支也开始读它，这条用例仍然说的是真话。
    const reusePoint = point3s.find((primitive) => primitive.id === segments[0].pointIds[0])
    if (!reusePoint) throw new Error("重开后的文档里找不到被线段引用的那个点")
    const drawn = draw(restored, { tool: "segment3", anchors: [{ pointId: reusePoint.id, position: reusePoint.position }, { position: { x: 5, y: 5, z: 5 } }] })
    const drawnPoints = drawn.primitives.filter((primitive) => primitive.type === "point3")
    expect(drawnPoints).toHaveLength(point3s.length + 1)
    const drawnSegment = drawn.primitives.find((primitive): primitive is Extract<PrimitiveSpec, { type: "segment3" }> => primitive.type === "segment3" && primitive.id !== segments[0].id)
    expect(drawnSegment?.pointIds[0]).toBe(reusePoint.id)
  })
})
