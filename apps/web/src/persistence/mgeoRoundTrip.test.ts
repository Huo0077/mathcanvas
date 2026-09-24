import { describe, expect, it } from "vitest"

import { createEmptyDocument, decodeMgeo, encodeMgeo } from "@draw/dsl"
import { applyOperation, compileSolidTetrahedron, recomputeDerivedObjects } from "@draw/scene-graph"

import { createDemoDocument } from "../demoDocument"

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
})
