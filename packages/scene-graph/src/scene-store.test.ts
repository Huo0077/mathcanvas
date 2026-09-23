import { describe, expect, it } from "vitest"

import { createEmptyDocument, encodeMgeo, validateDocument, type GeometryDocument } from "@draw/dsl"
import { buildSolidTemplate, solveCircumsphere3, solveInsphere3, type SolidBoundary } from "@draw/geometry-kernel"

import { compileSolidPrism } from "./actions"
import { applyOperation, commitPatch, createFace3, createLine3, createPoint3, createPolyhedron3, deletionTargets, getAffectedPrimitiveIds, getDependencyIndex, ownerOfTopology, patchPoint3, recomputeDerivedObjects, resolvePolyhedronTopology, sectionPlaneThroughSource, solidStatusReport, solidTopology3, topologicalRecomputeOrder, topologyOfEntity, validateDeletion, validatePatch } from "./index"

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

  /**
   * **按数值改模板顶点现在被拒**（Fix round 1，Recompute/Store 缺陷）。
   *
   * 旧期望：`changed === true`，模板拓扑翻成 `fromFaces`（"把模板物化成显式面环"这条功能）。
   * 新期望：`changed === false` + 一条可读的错误 —— 因为翻转之后那四个面**不再共面**
   *（"扭过的四边形"），文档从此 schema 非法；旧行为把它照收不误，于是界面更新、磁盘上还是旧的
   *（保存时 `encodeMgeo` 报错，而那条错误又被 `saveDraft` 吞掉）。
   *
   * 代价（记在交付报告里）：**单顶点拖动模板实体**这条路现在会被拒 —— 要恢复它，
   * 需要在 `operations.ts` 里把翻转后的面三角化（或放宽面的共面要求），那是另一个切片的文件。
   */
  it("refuses a numeric vertex edit that would leave a non-planar face", () => {
    const source = { id: "cube-1", type: "cube" as const, origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 }, label: "立方体 1" }
    const topology = buildSolidTemplate(source)
    const document = createEmptyDocument("geometry3d")
    document.primitives = [source, ...topology.primitives]

    const updated = commitPatch(document, { op: "updatePrimitive", id: topology.vertexIds[0], patch: { position3: { x: -2, y: -1, z: -1 } } })

    expect(updated.changed).toBe(false)
    expect(updated.error).toContain("face3 points are not coplanar")
    // 文档**原样不动**：宁可拒绝，也不让 store 拿着一份存不下去的文档。
    expect(updated.document).toBe(document)
    expect(updated.document.primitives.find((primitive) => primitive.id === topology.vertexIds[0])).toMatchObject({ position: { x: -1 } })
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
      // The binding parameter is the angle in radians, so π/2 is the top of the circle.
      { id: "point-1", type: "point", x: 0, y: 0, binding: { kind: "onPath", pathId: "circle-1", parameter: Math.PI / 2 } }
    ]

    const recomputed = recomputeDerivedObjects(document)
    const point = recomputed.primitives.find((primitive) => primitive.id === "point-1")
    expect(point?.type).toBe("point")
    if (point?.type === "point") {
      expect(point.x).toBeCloseTo(1)
      expect(point.y).toBeCloseTo(5)
    }
  })

  /**
   * 封闭曲线绕定点旋转：`rotationAbout.pivot` 是那个**定点**，曲线转过任意角度都要仍然过它。
   *
   * 这四条钉住的是完整链路——依赖图（点 → 曲线）、几何求解（constraint 用放置后的圆心）、
   * 以及"转一整圈回到原处"（放置是纯函数，不累积漂移）。
   */
  it("keeps a curve passing through its fixed point at every angle", () => {
    const document = createEmptyDocument("conics")
    const angle = (value: number) => ({
      ...document,
      primitives: [
        { id: "circle-1", type: "circle" as const, center: { x: 0, y: 0 }, radius: 3, rotationAbout: { pivot: { kind: "coordinate" as const, x: 3, y: 0 }, angle: value, baseCenter: { x: 0, y: 0 } } },
        { id: "pivot-1", type: "point" as const, x: 3, y: 0, binding: { kind: "onPath" as const, pathId: "circle-1", parameter: 0 } }
      ]
    })

    for (const value of [0, Math.PI / 5, Math.PI / 2, Math.PI, 5.6]) {
      const recomputed = recomputeDerivedObjects(angle(value))
      const circle = recomputed.primitives.find((primitive) => primitive.id === "circle-1")
      const pivot = recomputed.primitives.find((primitive) => primitive.id === "pivot-1")
      expect(circle?.type).toBe("circle")
      expect(pivot?.type).toBe("point")
      if (circle?.type !== "circle" || pivot?.type !== "point") continue
      // 定点画在圆上：到圆心的距离就是半径（用户口径里的"过一个定点"）。
      expect(Math.hypot(pivot.x - circle.center.x, pivot.y - circle.center.y)).toBeCloseTo(3, 9)
    }

    // 一整圈回到原处：不会因为反复重算而漂移。
    const full = recomputeDerivedObjects(angle(2 * Math.PI)).primitives.find((primitive) => primitive.id === "circle-1")
    expect(full?.type === "circle" && full.center.x).toBeCloseTo(0, 9)
    expect(full?.type === "circle" && full.center.y).toBeCloseTo(0, 9)
  })

  /**
   * 幂等：重算从 `baseCenter` 出发，所以再算一遍不会把曲线又转一次。
   * 这是真实缺陷的回归保护——第一版把结果烧进 `center` 且不存基准，
   * 第二次重算就把圆心从 (1.5,-2.6) 推到 (4.5,-2.6)、曲线离开定点。
   */
  it("does not drift when the same document is recomputed repeatedly", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 3, rotationAbout: { pivot: { kind: "coordinate", x: 3, y: 0 }, angle: Math.PI / 3, baseCenter: { x: 0, y: 0 } } }
    ]

    let current = recomputeDerivedObjects(document)
    const first = current.primitives[0]
    if (first?.type !== "circle") throw new Error("expected a circle")
    for (let pass = 0; pass < 5; pass += 1) {
      current = recomputeDerivedObjects(current)
      const circle = current.primitives[0]
      if (circle?.type !== "circle") throw new Error("expected a circle")
      expect(circle.center.x).toBeCloseTo(first.center.x, 9)
      expect(circle.center.y).toBeCloseTo(first.center.y, 9)
      expect(Math.hypot(circle.center.x - 3, circle.center.y)).toBeCloseTo(3, 9)
    }
  })

  it("moves the whole curve when the fixed point moves", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      // 定点是文档里的一个点图元。基准圆心在原点、转角 90°，于是圆心被转到 (0,-3) 一侧。
      { id: "pivot-1", type: "point", x: 3, y: 0 },
      { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 3, rotationAbout: { pivot: { kind: "primitive", primitiveId: "pivot-1" }, angle: Math.PI / 2, baseCenter: { x: 0, y: 0 } } },
      { id: "glider", type: "point", x: 0, y: 0, binding: { kind: "onPath", pathId: "circle-1", parameter: 0 } }
    ]

    const recomputed = recomputeDerivedObjects(document)
    const circle = recomputed.primitives.find((primitive) => primitive.id === "circle-1")
    const glider = recomputed.primitives.find((primitive) => primitive.id === "glider")
    // 绕 (3,0) 转 90°：圆心 (0,0) → (3,0) + R(90°)·(-3,0) = (3,-3)。
    expect(circle?.type === "circle" && circle.center.x).toBeCloseTo(3, 9)
    expect(circle?.type === "circle" && circle.center.y).toBeCloseTo(-3, 9)
    // 圆上的动点跟着圆走：绑定参数不变，坐标由放置后的曲线算出（参数 0 = 圆心 +(r,0)）。
    expect(glider?.type === "point" && glider.x).toBeCloseTo(6, 9)
    expect(glider?.type === "point" && glider.y).toBeCloseTo(-3, 9)

    // 定点挪动后整条曲线跟着重算：这是"定点是动点"的那条通路（依赖图 + 脏集）。
    const moved = { ...document, primitives: document.primitives.map((primitive) => primitive.id === "pivot-1" ? { ...primitive, x: 0, y: -3 } : primitive) }
    const afterMove = recomputeDerivedObjects(moved, ["pivot-1"]).primitives.find((primitive) => primitive.id === "circle-1")
    // 绕 (0,-3) 转 90°：圆心 (0,0) → (0,-3) + R(90°)·(0,3) = (-3,-3)。
    expect(afterMove?.type === "circle" && afterMove.center.x).toBeCloseTo(-3, 9)
    expect(afterMove?.type === "circle" && afterMove.center.y).toBeCloseTo(-3, 9)
  })

  it("lists the fixed point as a dependency of the curve that turns about it", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "pivot-1", type: "point", x: 3, y: 0 },
      { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 3, rotationAbout: { pivot: { kind: "primitive", primitiveId: "pivot-1" }, angle: 0.2, baseCenter: { x: 0, y: 0 } } }
    ]

    // 定点动了，曲线（以及绑定在曲线上的点）必须进脏集；反过来曲线动不该带动定点。
    expect([...getAffectedPrimitiveIds(document, ["pivot-1"])].sort()).toEqual(["circle-1", "pivot-1"])
    expect([...getAffectedPrimitiveIds(document, ["circle-1"])].sort()).toEqual(["circle-1"])
  })

  /**
   * 删掉定点，以它为定点的曲线**一起消失**（用户口径："在删除定点后，这个动圆也会跟着消失"）。
   *
   * 这是级联、不是"被引用所以拒绝删除"：曲线的圆心正是由定点 + 半径算出来的，
   * 定点一走它就没有独立存在的意义。反过来删曲线不影响定点。
   */
  it("deletes a curve together with the fixed point it turns about", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "pivot-1", type: "point", x: 3, y: 0 },
      { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 3, rotationAbout: { pivot: { kind: "primitive", primitiveId: "pivot-1" }, angle: 0.2, baseCenter: { x: 0, y: 0 } } },
      { id: "keep-me", type: "point", x: -2, y: 1 }
    ]

    // 级联目标里包含曲线，而且删除**被允许**（不是拿"被别的对象引用"来挡）。
    expect([...deletionTargets(document, "pivot-1")].sort()).toEqual(["circle-1", "pivot-1"])
    expect(validateDeletion(document, ["pivot-1"])).toEqual({ valid: true })

    const deleted = commitPatch(document, { op: "deleteObject", id: "pivot-1" }).document
    expect(deleted.primitives.map((primitive) => primitive.id)).toEqual(["keep-me"])

    // 反过来：删曲线不该带走定点。
    const curveDeleted = commitPatch(document, { op: "deleteObject", id: "circle-1" }).document
    expect(curveDeleted.primitives.map((primitive) => primitive.id).sort()).toEqual(["keep-me", "pivot-1"])
  })

  it("carries the fixed point along when the curve is translated", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 3, rotationAbout: { pivot: { kind: "coordinate", x: 3, y: 0 }, angle: Math.PI / 2, baseCenter: { x: 0, y: 0 } } }
    ]

    const moved = applyOperation(document, { op: "translatePrimitive", id: "circle-1", delta: { x: 2, y: -1 } })
    const circle = moved.document.primitives[0]
    expect(circle?.type).toBe("circle")
    if (circle?.type !== "circle" || !circle.rotationAbout || circle.rotationAbout.pivot.kind !== "coordinate") throw new Error("expected a placed circle")
    // 定点与基准圆心一起平移，因此"绕定点转了 90°"这件事一点没变。
    expect(circle.rotationAbout.pivot.x).toBeCloseTo(5)
    expect(circle.rotationAbout.pivot.y).toBeCloseTo(-1)
    expect(circle.rotationAbout.baseCenter.x).toBeCloseTo(2)
    expect(circle.rotationAbout.baseCenter.y).toBeCloseTo(-1)
    // 圆心 = 基准绕定点转 90°：(2,-1) → (5,-1) + R(90°)·(-3,0) = (5,-4)。
    expect(circle.center.x).toBeCloseTo(5)
    expect(circle.center.y).toBeCloseTo(-4)
    expect(Math.hypot(circle.center.x - 5, circle.center.y - -1)).toBeCloseTo(3, 9)
  })

  /**
   * 绑定参数是曲线的**自然参数**：椭圆的离心角用弧度、函数的参数就是 x、直线是仿射比例 t。
   * 于是正向映射（`resolveBoundPoint`）与反向映射（`dragBoundPoint`）由内核同一份约束定义保证互逆。
   */
  it("recomputes a point bound to an ellipse path using the eccentric angle", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "ellipse-1", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 4, radiusY: 2 },
      { id: "point-1", type: "point", x: 0, y: 0, binding: { kind: "onPath", pathId: "ellipse-1", parameter: 0 } },
      { id: "point-2", type: "point", x: 0, y: 0, binding: { kind: "onPath", pathId: "ellipse-1", parameter: Math.PI / 2 } },
      { id: "point-3", type: "point", x: 0, y: 0, binding: { kind: "onPath", pathId: "ellipse-1", parameter: Math.PI } }
    ]

    const recomputed = recomputeDerivedObjects(document)
    const at = (id: string) => recomputed.primitives.find((primitive) => primitive.id === id)
    expect(at("point-1")).toMatchObject({ x: expect.closeTo(4, 9), y: expect.closeTo(0, 9) })
    expect(at("point-2")).toMatchObject({ x: expect.closeTo(0, 9), y: expect.closeTo(2, 9) })
    expect(at("point-3")).toMatchObject({ x: expect.closeTo(-4, 9), y: expect.closeTo(0, 9) })
  })

  it("follows the driving parameter table for an ellipse-bound point", () => {
    const document = createEmptyDocument("conics")
    document.parameters = { t: { id: "t", value: 0, min: 0, max: Math.PI * 2 } }
    document.primitives = [
      { id: "ellipse-1", type: "ellipse", center: { x: 1, y: 1 }, radiusX: 2, radiusY: 3, rotation: Math.PI / 2 },
      { id: "point-1", type: "point", x: 0, y: 0, binding: { kind: "onPath", pathId: "ellipse-1", parameterId: "t", parameter: 0 } }
    ]

    const atZero = recomputeDerivedObjects(document).primitives.find((primitive) => primitive.id === "point-1")
    // Rotated by π/2 the major axis (radiusX = 2) lies along y, so θ = 0 gives (1, 1 + 2).
    expect(atZero).toMatchObject({ x: expect.closeTo(1, 9), y: expect.closeTo(3, 9) })

    const moved = structuredClone(document) as typeof document
    moved.parameters.t.value = Math.PI
    const atHalf = recomputeDerivedObjects(moved).primitives.find((primitive) => primitive.id === "point-1")
    expect(atHalf).toMatchObject({ x: expect.closeTo(1, 9), y: expect.closeTo(-1, 9) })
  })

  /**
   * 抛物线与双曲线的轴向参数是无界的，绑定**可以不带 `domain`** —— 那时用与图形尺度成比例的默认窗口。
   * 真正没有绑定含义的是悬空的 pathId，那种情况必须保持坐标不动（而不是抛错）。
   */
  it("falls back to a scale-derived window for a conic binding without a domain, and is a no-op for a dangling path", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "parabola-1", type: "parabola", vertex: { x: 0, y: 0 }, focalParameter: 2, axis: "y" },
      { id: "point-1", type: "point", x: 5, y: 99, binding: { kind: "onPath", pathId: "parabola-1", parameter: 3 } },
      { id: "point-2", type: "point", x: 7, y: 9, binding: { kind: "onPath", pathId: "ghost", parameter: 3 } }
    ]

    const recomputed = recomputeDerivedObjects(document)
    // No domain given, but the binding still resolves: u = 3 on y = x²/4 is (3, 2.25).
    expect(recomputed.primitives.find((primitive) => primitive.id === "point-1")).toMatchObject({ x: expect.closeTo(3, 6), y: expect.closeTo(2.25, 6) })
    // A dangling pathId stays a no-op rather than throwing.
    expect(recomputed.primitives.find((primitive) => primitive.id === "point-2")).toMatchObject({ x: 7, y: 9 })
  })

  it("resolves a point bound to a line whose geometry comes from a slope parameter", () => {
    const document = createEmptyDocument("calculus")
    document.parameters = { slope: { id: "slope", value: 1 } }
    // The bound point is declared before the line it depends on, so only a dependency-aware
    // pass can give it the current geometry rather than a stale one.
    document.primitives = [
      { id: "point-1", type: "point", x: 0, y: 0, binding: { kind: "onPath", pathId: "line-a", parameter: 1 } },
      { id: "line-a", type: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, slopeParameter: "slope" }
    ]

    const recomputed = recomputeDerivedObjects(document)
    // b.y = a.y + slope * (b.x - a.x) = 1, and the point sits at t = 1, i.e. at b.
    expect(recomputed.primitives.find((primitive) => primitive.id === "point-1")).toMatchObject({ x: expect.closeTo(1, 9), y: expect.closeTo(1, 9) })
  })

  /**
   * 动点的核心交互：拖着一个被约束的点，它必须沿着自己的曲线滑动。
   *
   * 拖拽在视图层被翻译成 `translatePrimitive`（增量），所以约束点必须把"当前位置 + 增量"
   * 投影回曲线上、并写回参数 —— 而不是像自由点那样直接加 x/y
   * （那样会立刻被重算用旧参数覆盖掉，拖动等于没发生）。
   */
  it("slides a point bound to a line along that line when it is dragged", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "line-1", type: "line", a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      { id: "point-1", type: "point", x: 5, y: 0, binding: { kind: "onPath", pathId: "line-1", parameter: 0.5 } }
    ]

    // (5,0) + (3,2) = (8,2); projected onto y = 0 that is (8,0), i.e. t = 0.8.
    const dragged = applyOperation(document, { op: "translatePrimitive", id: "point-1", delta: { x: 3, y: 2 } })
    const point = dragged.document.primitives.find((primitive) => primitive.id === "point-1")

    expect(point).toMatchObject({ x: expect.closeTo(8, 9), y: expect.closeTo(0, 9) })
    expect(point?.type === "point" && point.binding?.kind === "onPath" ? point.binding.parameter : null).toBeCloseTo(0.8, 9)
  })

  /**
   * 绑定参数必须用曲线的**自然参数**，而不是一律归一化到 [0, 1]。
   * 归一化对直线是致命的：直线在画布上是横贯整个视野画的，但 `clamp(t, 0, 1)` 把点锁在
   * `a..b` 这一段里 —— 用户看到一条长线，点却只能在中间一小段滑动。
   */
  it("lets a point bound to a line travel beyond the a..b segment", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "line-1", type: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 0 } },
      { id: "point-1", type: "point", x: 0.5, y: 0, binding: { kind: "onPath", pathId: "line-1", parameter: 0.5 } }
    ]

    // Drag 10 units right: the line is infinite, so the point must follow all the way.
    const forward = applyOperation(document, { op: "translatePrimitive", id: "point-1", delta: { x: 10, y: 0 } })
    expect(forward.document.primitives.find((primitive) => primitive.id === "point-1")).toMatchObject({ x: expect.closeTo(10.5, 6), y: expect.closeTo(0, 6) })

    // And far to the other side, with a vertical component that must be projected away.
    const backward = applyOperation(document, { op: "translatePrimitive", id: "point-1", delta: { x: -100, y: 40 } })
    expect(backward.document.primitives.find((primitive) => primitive.id === "point-1")).toMatchObject({ x: expect.closeTo(-99.5, 6), y: expect.closeTo(0, 6) })
  })

  it("lets a point bound to a ray run forward without limit but not backwards", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "ray-1", type: "ray", a: { x: 0, y: 0 }, b: { x: 1, y: 0 } },
      { id: "point-1", type: "point", x: 1, y: 0, binding: { kind: "onPath", pathId: "ray-1", parameter: 1 } }
    ]
    const forward = applyOperation(document, { op: "translatePrimitive", id: "point-1", delta: { x: 50, y: 0 } })
    expect(forward.document.primitives.find((primitive) => primitive.id === "point-1")).toMatchObject({ x: expect.closeTo(51, 6) })
    // The ray starts at a, so dragging behind it pins the point to the origin.
    const backward = applyOperation(document, { op: "translatePrimitive", id: "point-1", delta: { x: -20, y: 0 } })
    expect(backward.document.primitives.find((primitive) => primitive.id === "point-1")).toMatchObject({ x: expect.closeTo(0, 6) })
  })

  it("lets a point bound to a function reach both ends of its domain", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "fn-1", type: "function", expression: "x*x", domain: [-6, 6], samples: 128 },
      { id: "point-1", type: "point", x: 0, y: 0, binding: { kind: "onPath", pathId: "fn-1", parameter: 0 } }
    ]
    // The parameter of a function graph is x itself, so the point sits at (0, 0).
    const initial = recomputeDerivedObjects(document)
    expect(initial.primitives.find((primitive) => primitive.id === "point-1")).toMatchObject({ x: expect.closeTo(0, 6), y: expect.closeTo(0, 6) })

    // Aim just past the right end of the curve: clamped there, because that is where the curve ends.
    const dragged = applyOperation(initial, { op: "translatePrimitive", id: "point-1", delta: { x: 6.5, y: 36 } })
    expect(dragged.document.primitives.find((primitive) => primitive.id === "point-1")).toMatchObject({ x: expect.closeTo(6, 4), y: expect.closeTo(36, 3) })
    // ...and the left end is reachable too, so the whole drawn curve is usable.
    const left = applyOperation(initial, { op: "translatePrimitive", id: "point-1", delta: { x: -6.5, y: 36 } })
    expect(left.document.primitives.find((primitive) => primitive.id === "point-1")).toMatchObject({ x: expect.closeTo(-6, 4), y: expect.closeTo(36, 3) })
  })

  it("slides a point bound to a circle along the circle when it is dragged", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 2 },
      { id: "point-1", type: "point", x: 2, y: 0, binding: { kind: "onPath", pathId: "circle-1", parameter: 0 } }
    ]

    // Drag far up and to the right: desired = (2,0) + (5,5) = (7,5). The nearest point on the
    // circle lies on the same ray from the centre, so the angle must match atan2(5, 7).
    const dragged = applyOperation(document, { op: "translatePrimitive", id: "point-1", delta: { x: 5, y: 5 } })
    const point = dragged.document.primitives.find((primitive) => primitive.id === "point-1")
    if (point?.type !== "point") throw new Error("point missing")

    expect(Math.hypot(point.x, point.y)).toBeCloseTo(2, 9)
    expect(Math.atan2(point.y, point.x)).toBeCloseTo(Math.atan2(5, 7), 9)
    expect(point.y).toBeGreaterThan(0)
    expect(point.x).toBeGreaterThan(0)
  })

  it("clamps a bound point at the end of its segment instead of letting it leave", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "segment-1", type: "segment", a: { x: 0, y: 0 }, b: { x: 4, y: 0 } },
      { id: "point-1", type: "point", x: 2, y: 0, binding: { kind: "onPath", pathId: "segment-1", parameter: 0.5 } }
    ]

    const dragged = applyOperation(document, { op: "translatePrimitive", id: "point-1", delta: { x: 100, y: 0 } })
    const point = dragged.document.primitives.find((primitive) => primitive.id === "point-1")

    expect(point).toMatchObject({ x: expect.closeTo(4, 9), y: expect.closeTo(0, 9) })
    expect(point?.type === "point" && point.binding?.kind === "onPath" ? point.binding.parameter : null).toBeCloseTo(1, 9)
  })

  /**
   * 椭圆的离心角是**周期**参数（`parameterBounds` 声明 wrap，域 [0, 2π)）。
   * 投影出来的角可能是负的（下半部分），必须先折回 [0, 2π) 再交给调用方；
   * 直接 `clamp(θ / 2π, 0, 1)` 会把所有负角压成 0，于是点只能在上半部分跑，
   * 一下拖到下方就弹回右顶点。
   */
  it("slides an ellipse-bound point through the lower half as well", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "ellipse-1", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 4, radiusY: 1 },
      { id: "point-1", type: "point", x: 4, y: 0, binding: { kind: "onPath", pathId: "ellipse-1", parameter: 0 } }
    ]

    // Desired = (4,0) + (-4,-1) = (0,-1), which already lies on the ellipse.
    const dragged = applyOperation(document, { op: "translatePrimitive", id: "point-1", delta: { x: -4, y: -1 } })
    const point = dragged.document.primitives.find((primitive) => primitive.id === "point-1")
    if (point?.type !== "point") throw new Error("point missing")

    expect(point.x).toBeCloseTo(0, 6)
    expect(point.y).toBeCloseTo(-1, 6)
    // The bottom vertex is θ = 3π/2.
    expect(point.binding?.kind === "onPath" ? point.binding.parameter : null).toBeCloseTo(Math.PI * 1.5, 6)
  })

  /**
   * 拓扑重算顺序：声明顺序颠倒也必须先算上游。
   * 这也正是被删掉的 `recomputeBoundPoint3s`（"最多重跑 N 遍直到不动"）原本在硬扛的事情。
   */
  describe("topological recompute order", () => {
    /** m1 = midpoint(a, b); m2 = midpoint(m1, c) —— 故意把 m2 声明在 m1 前面。 */
    const chainedDocument = () => {
      const document = createEmptyDocument("geometry3d")
      document.primitives = [
        createPoint3("m2", { x: 0, y: 0, z: 0 }, { kind: "derived", feature: "midpoint", sourceIds: ["m1", "c"] }),
        createPoint3("m1", { x: 0, y: 0, z: 0 }, { kind: "derived", feature: "midpoint", sourceIds: ["a", "b"] }),
        createPoint3("a", { x: 0, y: 0, z: 0 }),
        createPoint3("b", { x: 4, y: 0, z: 0 }),
        createPoint3("c", { x: 0, y: 0, z: 4 }),
        createPoint3("unrelated", { x: 9, y: 9, z: 9 })
      ]
      return document
    }

    it("puts every dependency before its dependents", () => {
      const order = topologicalRecomputeOrder(chainedDocument(), ["a"])
      expect(order).toContain("m1")
      expect(order).toContain("m2")
      expect(order.indexOf("a")).toBeLessThan(order.indexOf("m1"))
      expect(order.indexOf("m1")).toBeLessThan(order.indexOf("m2"))
    })

    it("restricts the order to the affected closure", () => {
      expect(topologicalRecomputeOrder(chainedDocument(), ["a"])).not.toContain("unrelated")
      expect(topologicalRecomputeOrder(chainedDocument(), ["unrelated"])).toEqual(["unrelated"])
    })

    it("covers every primitive when no change set is given", () => {
      const order = topologicalRecomputeOrder(chainedDocument())
      expect([...order].sort()).toEqual(chainedDocument().primitives.map((primitive) => primitive.id).sort())
    })

    it("resolves a chained derived point in one pass regardless of declaration order", () => {
      const recomputed = recomputeDerivedObjects(chainedDocument())
      const at = (id: string) => recomputed.primitives.find((primitive) => primitive.id === id)
      // a=(0,0,0), b=(4,0,0) → m1=(2,0,0); c=(0,0,4) → m2 = midpoint(m1, c) = (1,0,2)
      expect(at("m1")).toMatchObject({ position: { x: 2, y: 0, z: 0 } })
      expect(at("m2")).toMatchObject({ position: { x: 1, y: 0, z: 2 } })
    })

    it("resolves a chain deep enough that a single blind pass could not converge", () => {
      const document = createEmptyDocument("geometry3d")
      // Each point is the midpoint of the previous one and the origin: a 6-deep derived chain,
      // declared in exactly reverse order. p6 = 1/64 of p0.
      const primitives = [createPoint3("p0", { x: 64, y: 0, z: 0 })]
      for (let level = 6; level >= 1; level -= 1) {
        const sourceIds = level === 1 ? ["p0", "origin"] : [`p${level - 1}`, "origin"]
        primitives.push(createPoint3(`p${level}`, { x: 0, y: 0, z: 0 }, { kind: "derived", feature: "midpoint", sourceIds }))
      }
      primitives.push(createPoint3("origin", { x: 0, y: 0, z: 0 }))
      document.primitives = primitives

      const recomputed = recomputeDerivedObjects(document)
      expect(recomputed.primitives.find((primitive) => primitive.id === "p6")).toMatchObject({ position: { x: 1, y: 0, z: 0 } })
    })
  })

  /**
   * 平面测量的价值就在这一条：它会保留来源对象，并在**动点沿曲线滑动**时自动重算。
   */
  describe("planar measurements", () => {
    const measuredDocument = () => {
      const document = createEmptyDocument("conics")
      document.primitives = [
        { id: "line-1", type: "line", a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
        { id: "p1", type: "point", x: 0, y: 0 },
        { id: "p2", type: "point", x: 5, y: 0, binding: { kind: "onPath", pathId: "line-1", parameter: 0.5 } }
      ]
      document.measurements = [{ id: "m1", kind: "measurement3", sourceIds: ["p1", "p2"], metric: "length", precision: "numeric-approximation", status: "valid", explanation: "" }]
      return document
    }

    it("evaluates a planar length in a planar workspace", () => {
      const recomputed = recomputeDerivedObjects(measuredDocument())
      expect(recomputed.measurements[0].value).toBeCloseTo(5, 9)
      expect(recomputed.measurements[0].status).toBe("valid")
      expect(recomputed.measurements[0].unit).toBe("u")
    })

    /**
     * 界面上的"夹角（两条线）""面积 / 周长 / 半径"按钮必须真的算得出数来。
     * 这条在**重算路径**上钉住它：来源是切线与直线、以及一个动圆，都不是点。
     */
    it("evaluates a tangent-line angle and a circle's metrics", () => {
      const document = createEmptyDocument("conics")
      document.primitives = [
        { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 3 },
        { id: "line-1", type: "line", a: { x: 0, y: 0 }, b: { x: 4, y: 0 } },
        { id: "tangent-1", type: "tangent", sourceId: "circle-1", x: 0, point: { x: 3, y: 0 }, slope: 0, a: { x: 3, y: -3 }, b: { x: 3, y: 3 }, status: "approximate", anchor: { kind: "parameter", parameter: 0 } }
      ]
      document.measurements = [
        { id: "m-angle", kind: "measurement3", sourceIds: ["line-1", "tangent-1"], metric: "angle", value: 0, unit: "rad", precision: "numeric-approximation", status: "valid", explanation: "" },
        { id: "m-area", kind: "measurement3", sourceIds: ["circle-1"], metric: "area", value: 0, unit: "u²", precision: "numeric-approximation", status: "valid", explanation: "" },
        { id: "m-perimeter", kind: "measurement3", sourceIds: ["circle-1"], metric: "perimeter", value: 0, unit: "u", precision: "numeric-approximation", status: "valid", explanation: "" },
        { id: "m-radius", kind: "measurement3", sourceIds: ["circle-1"], metric: "radius", value: 0, unit: "u", precision: "numeric-approximation", status: "valid", explanation: "" }
      ]

      const recomputed = recomputeDerivedObjects(document)
      const reading = (id: string) => recomputed.measurements.find((measurement) => measurement.id === id)!

      // 切线竖直、直线水平 ⇒ 夹角 90°。
      expect(reading("m-angle").value).toBeCloseTo(Math.PI / 2, 9)
      expect(reading("m-angle").status).toBe("valid")
      expect(reading("m-area").value).toBeCloseTo(Math.PI * 9, 9)
      expect(reading("m-perimeter").value).toBeCloseTo(Math.PI * 6, 9)
      expect(reading("m-radius").value).toBeCloseTo(3, 9)
    })

    it("follows a dynamic point as it slides along its curve", () => {
      const dragged = applyOperation(measuredDocument(), { op: "translatePrimitive", id: "p2", delta: { x: 4, y: 0 } })
      // desired = (5,0) + (4,0) = (9,0) → t = 0.9, so the length becomes 9.
      expect(dragged.changed).toBe(true)
      expect(dragged.document.measurements[0].value).toBeCloseTo(9, 9)
    })

    it("reports degenerate geometry instead of a zero reading", () => {
      const document = measuredDocument()
      document.primitives = document.primitives.map((primitive) => primitive.id === "p2" ? { ...primitive, x: 0, y: 0, binding: undefined } : primitive)
      const recomputed = recomputeDerivedObjects(document)
      expect(recomputed.measurements[0].status).toBe("degenerate")
      expect(recomputed.measurements[0].value).toBeUndefined()
    })

    it("measures an angle and an area from three planar points", () => {
      const document = createEmptyDocument("conics")
      document.primitives = [
        { id: "a", type: "point", x: 1, y: 0 },
        { id: "v", type: "point", x: 0, y: 0 },
        { id: "b", type: "point", x: 0, y: 1 }
      ]
      document.measurements = [
        { id: "angle", kind: "measurement3", sourceIds: ["a", "v", "b"], metric: "angle", dihedralKind: "interior", precision: "numeric-approximation", status: "valid", explanation: "" },
        { id: "area", kind: "measurement3", sourceIds: ["a", "v", "b"], metric: "area", precision: "numeric-approximation", status: "valid", explanation: "" },
        { id: "distance", kind: "measurement3", sourceIds: ["a", "v", "b"], metric: "distance", precision: "numeric-approximation", status: "valid", explanation: "" }
      ]
      const recomputed = recomputeDerivedObjects(document)
      const at = (id: string) => recomputed.measurements.find((measurement) => measurement.id === id)
      expect(at("angle")?.value).toBeCloseTo(Math.PI / 2, 9)
      expect(at("area")?.value).toBeCloseTo(0.5, 9)
      // The perpendicular distance from b to the line through a and v.
      expect(at("distance")?.value).toBeCloseTo(1, 9)
    })

    it("leaves a measurement alone when none of its sources changed", () => {
      const document = measuredDocument()
      const initial = recomputeDerivedObjects(document)
      // Move an unrelated point: the stored reading must survive untouched.
      const withExtra = structuredClone(initial) as typeof initial
      withExtra.primitives.push({ id: "unrelated", type: "point", x: 7, y: 7 })
      const moved = recomputeDerivedObjects(withExtra, ["unrelated"])
      expect(moved.measurements[0]).toEqual(initial.measurements[0])
    })

    it("still uses the spatial evaluator in the 3D workspace", () => {
      const document = createEmptyDocument("geometry3d")
      document.primitives = [
        createPoint3("a", { x: 0, y: 0, z: 0 }),
        createPoint3("b", { x: 3, y: 0, z: 0 })
      ]
      document.measurements = [{ id: "m1", kind: "measurement3", sourceIds: ["a", "b"], metric: "length", precision: "numeric-approximation", status: "valid", explanation: "" }]
      expect(recomputeDerivedObjects(document).measurements[0].value).toBeCloseTo(3, 9)
    })
  })

  /**
   * 抛物线与双曲线的自然参数是**无界**的轴向参数 u，所以绑定自带 `domain` 作为扫描窗口，
   * 双曲线还要记录分支。这是"只能在曲线上一小段里动"那类问题的正面解法。
   */
  it("binds a point to a parabola and lets it slide along the whole axis", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "parabola-1", type: "parabola", vertex: { x: 0, y: 0 }, focalParameter: 2, axis: "y" },
      { id: "point-1", type: "point", x: 0, y: 0, binding: { kind: "onPath", pathId: "parabola-1", parameter: 0, domain: [-8, 8] } }
    ]
    // axis "y": local = (u, u²/2p) = (u, u²/4), so the parameter is x itself.
    const initial = recomputeDerivedObjects(document)
    expect(initial.primitives.find((primitive) => primitive.id === "point-1")).toMatchObject({ x: expect.closeTo(0, 6), y: expect.closeTo(0, 6) })

    // (3, 2.25) lies exactly on the parabola.
    const right = applyOperation(initial, { op: "translatePrimitive", id: "point-1", delta: { x: 3, y: 2.25 } })
    expect(right.document.primitives.find((primitive) => primitive.id === "point-1")).toMatchObject({ x: expect.closeTo(3, 4), y: expect.closeTo(2.25, 4) })

    // The negative half is just as reachable: (-5, 6.25) is also on the curve.
    const left = applyOperation(initial, { op: "translatePrimitive", id: "point-1", delta: { x: -5, y: 6.25 } })
    expect(left.document.primitives.find((primitive) => primitive.id === "point-1")).toMatchObject({ x: expect.closeTo(-5, 4), y: expect.closeTo(6.25, 4) })
  })

  it("keeps a point on its hyperbola branch when it is dragged towards the other one", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "hyperbola-1", type: "hyperbola", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2, axis: "x" },
      // axis "x": local = (u, ±b√(1 + u²/a²)); branch 1 takes the minus sign, so u = 0 is (0, -2).
      { id: "point-1", type: "point", x: 0, y: -2, binding: { kind: "onPath", pathId: "hyperbola-1", parameter: 0, branch: 1, domain: [-6, 6] } }
    ]
    const initial = recomputeDerivedObjects(document)
    expect(initial.primitives.find((primitive) => primitive.id === "point-1")).toMatchObject({ x: expect.closeTo(0, 6), y: expect.closeTo(-2, 6) })

    // Drag far above the axis: the upper branch is nearer, but the binding pins this point to the lower one.
    const upward = applyOperation(initial, { op: "translatePrimitive", id: "point-1", delta: { x: 0, y: 10 } })
    const pinned = upward.document.primitives.find((primitive) => primitive.id === "point-1")
    expect(pinned && pinned.type === "point" ? pinned.y : 0).toBeLessThan(0)
    expect(pinned?.type === "point" && pinned.binding?.kind === "onPath" ? pinned.binding.branch : null).toBe(1)

    // And it can still travel far along its own branch: u = 6 gives (6, -2√5).
    const along = applyOperation(initial, { op: "translatePrimitive", id: "point-1", delta: { x: 6, y: -2.4721 } })
    const moved = along.document.primitives.find((primitive) => primitive.id === "point-1")
    expect(moved).toMatchObject({ x: expect.closeTo(6, 3), y: expect.closeTo(-2 * Math.sqrt(5), 3) })
  })

  /**
   * 驱动参数的生命周期：绑定产生的 `t-<点id>` 带 `ownerId`，归属对象被删时自动回收；
   * 用户手工创建的参数没有 `ownerId`，永远不会被这一步碰掉。
   */
  describe("driver parameter lifecycle", () => {
    const boundDocument = () => {
      const document = createEmptyDocument("conics")
      document.parameters = { "t-point-1": { id: "t-point-1", value: 2, min: -4, max: 4, step: 0.08, label: "P 的路径参数", ownerId: "point-1" } }
      document.primitives = [
        { id: "parabola-1", type: "parabola", vertex: { x: 0, y: 0 }, focalParameter: 2, axis: "y" },
        { id: "point-1", type: "point", x: 2, y: 1, binding: { kind: "onPath", pathId: "parabola-1", parameterId: "t-point-1", parameter: 2, domain: [-4, 4] } },
        { id: "locus-1", type: "locus", sourcePointId: "point-1", parameterId: "t-point-1", domain: [-4, 4], samples: 32 }
      ]
      return document
    }

    it("reclaims the driver parameter when its owner is deleted", () => {
      const deleted = applyOperation(boundDocument(), { op: "deleteObject", id: "point-1" })
      expect(deleted.changed).toBe(true)
      // The point and its locus go, and so does the parameter that only existed to drive it.
      expect(deleted.document.primitives.map((primitive) => primitive.id)).toEqual(["parabola-1"])
      expect(Object.keys(deleted.document.parameters)).toEqual([])
    })

    it("keeps a manually created parameter because it has no owner", () => {
      const document = boundDocument()
      document.parameters.user = { id: "user", value: 0.5, min: 0, max: 1 }
      const deleted = applyOperation(document, { op: "deleteObject", id: "point-1" })
      expect(Object.keys(deleted.document.parameters)).toEqual(["user"])
    })

    it("keeps a driver parameter that something else still references", () => {
      const document = boundDocument()
      // A second point shares the same driver, so the parameter must survive the first point's deletion.
      document.primitives.push({ id: "point-2", type: "point", x: 2, y: 1, binding: { kind: "onPath", pathId: "parabola-1", parameterId: "t-point-1", parameter: 2 } })
      const deleted = applyOperation(document, { op: "deleteObject", id: "point-1" })
      expect(Object.keys(deleted.document.parameters)).toEqual(["t-point-1"])
      // Deleting the last referrer finally reclaims it.
      const last = applyOperation(deleted.document, { op: "deleteObject", id: "point-2" })
      expect(Object.keys(last.document.parameters)).toEqual([])
    })

    /**
     * 宿主被删除时回收孤儿参数（Reactive DAG 切片 Task 2）。
     *
     * 绑定点在宿主消失后会被**降级为自由点**（位置保留，`unbindDeletedHost`），
     * 于是它的 `t-<点id>` 参数既没有引用者、也再没有意义。旧实现在这里只按"归属对象也没了"回收，
     * 于是删掉圆之后参数列表里留下一个没人用的驱动参数。
     */
    it("reclaims a generated driver parameter after its host is deleted", () => {
      const document = createEmptyDocument("conics")
      document.parameters = { "t-point-1": { id: "t-point-1", value: 0, min: 0, max: 6.28, step: 0.05, ownerId: "point-1" } }
      document.primitives = [
        { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 2 },
        { id: "point-1", type: "point", x: 2, y: 0, binding: { kind: "onPath", pathId: "circle-1", parameterId: "t-point-1", parameter: 0 } }
      ]

      const deleted = applyOperation(document, { op: "deleteObject", id: "circle-1" })
      expect(deleted.changed).toBe(true)
      // 点保留（降级为自由点），但它自动生成的驱动参数是孤儿，应当被回收。
      expect(deleted.document.primitives.find((primitive) => primitive.id === "point-1")).toMatchObject({ x: 2, y: 0, binding: { kind: "free" } })
      expect(Object.keys(deleted.document.parameters)).toEqual([])
      // 手工参数没有 ownerId，不受影响。
      const manual = structuredClone(document) as typeof document
      manual.parameters.slider = { id: "slider", value: 1 }
      const manualDeleted = applyOperation(manual, { op: "deleteObject", id: "circle-1" })
      expect(Object.keys(manualDeleted.document.parameters)).toEqual(["slider"])
    })

    it("refuses to delete a parameter that is still referenced", () => {
      const document = boundDocument()
      const refused = applyOperation(document, { op: "deleteParameter", id: "t-point-1" })
      expect(refused.changed).toBe(false)
      expect(refused.error).toContain("referenced")

      const withSpare = structuredClone(document) as typeof document
      withSpare.parameters.spare = { id: "spare", value: 0 }
      const removed = applyOperation(withSpare, { op: "deleteParameter", id: "spare" })
      expect(removed.changed).toBe(true)
      expect(Object.keys(removed.document.parameters)).toEqual(["t-point-1"])
      expect(applyOperation(document, { op: "deleteParameter", id: "ghost" }).error).toBe("parameter not found")
    })

    it("records parameter metadata in one operation without erasing it on a value-only update", () => {
      const created = applyOperation(createEmptyDocument("conics"), { op: "setParameter", id: "p1", value: 0.5, min: 0, max: 1, step: 0.01, label: "参数 1" })
      expect(created.document.parameters.p1).toEqual({ id: "p1", value: 0.5, min: 0, max: 1, step: 0.01, label: "参数 1" })
      // A slider drag only sends the value; the bounds and label must survive.
      const dragged = applyOperation(created.document, { op: "setParameter", id: "p1", value: 0.9 })
      expect(dragged.document.parameters.p1).toEqual({ id: "p1", value: 0.9, min: 0, max: 1, step: 0.01, label: "参数 1" })
    })

    it("keeps a driver parameter and its point consistent while the value is driven", () => {
      const document = boundDocument()
      // u = -3 on y = x²/4 is (-3, 2.25).
      const driven = applyOperation(document, { op: "setParameter", id: "t-point-1", value: -3 })
      expect(driven.document.primitives.find((primitive) => primitive.id === "point-1")).toMatchObject({ x: expect.closeTo(-3, 6), y: expect.closeTo(2.25, 6) })
    })
  })

  /**
   * 「动点之间建立线段」在 DSL 里就是 `connection`（kind: "segment"，引用两个点）。
   * 它只存点 id，所以三条能力缺一不可：跟着点走、被依赖图登记、以及删点时不留下悬空引用。
   */
  describe("connection segments between dynamic points", () => {
    const twoDynamicPoints = () => {
      const document = createEmptyDocument("conics")
      document.primitives = [
        { id: "line-x", type: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 0 } },
        { id: "line-y", type: "line", a: { x: 0, y: 0 }, b: { x: 0, y: 1 } },
        { id: "p1", type: "point", x: 0.5, y: 0, binding: { kind: "onPath", pathId: "line-x", parameter: 0.5 } },
        { id: "p2", type: "point", x: 0, y: 0.5, binding: { kind: "onPath", pathId: "line-y", parameter: 0.5 } },
        { id: "seg", type: "connection", kind: "segment", startPointId: "p1", endPointId: "p2" }
      ]
      return document
    }

    it("registers the connection as depending on the points it joins", () => {
      const document = recomputeDerivedObjects(twoDynamicPoints())
      // Moving either endpoint must put the segment in the affected set, or nothing downstream sees it.
      expect(getAffectedPrimitiveIds(document, ["p1"]).has("seg")).toBe(true)
      expect(getAffectedPrimitiveIds(document, ["p2"]).has("seg")).toBe(true)
    })

    it("follows both endpoints as they slide along their curves", () => {
      const document = recomputeDerivedObjects(twoDynamicPoints())
      // The endpoints start at (0.5, 0) and (0, 0.5).
      expect(document.primitives.find((primitive) => primitive.id === "p1")).toMatchObject({ x: expect.closeTo(0.5, 9), y: expect.closeTo(0, 9) })
      expect(document.primitives.find((primitive) => primitive.id === "p2")).toMatchObject({ x: expect.closeTo(0, 9), y: expect.closeTo(0.5, 9) })

      // Slide p1 to the right and p2 up: the segment is defined by the two *current* positions.
      const moved = applyOperation(document, { op: "translatePrimitive", id: "p1", delta: { x: 0.4, y: 0 } })
      const second = applyOperation(moved.document, { op: "translatePrimitive", id: "p2", delta: { x: 0, y: 0.25 } })
      expect(second.document.primitives.find((primitive) => primitive.id === "p1")).toMatchObject({ x: expect.closeTo(0.9, 6) })
      expect(second.document.primitives.find((primitive) => primitive.id === "p2")).toMatchObject({ y: expect.closeTo(0.75, 6) })
      // The connection itself stores no coordinates — it is pure reference, so it can never go stale.
      expect(second.document.primitives.find((primitive) => primitive.id === "seg")).toEqual({ id: "seg", type: "connection", kind: "segment", startPointId: "p1", endPointId: "p2" })
    })

    it("deletes the connection together with a point it joins, keeping the document savable", () => {
      const document = createEmptyDocument("conics")
      document.primitives = [
        { id: "p1", type: "point", x: 0, y: 0 },
        { id: "p2", type: "point", x: 3, y: 0 },
        { id: "keep", type: "point", x: 9, y: 9 },
        { id: "seg", type: "connection", kind: "segment", startPointId: "p1", endPointId: "p2" }
      ]

      expect(validatePatch(document, { op: "deleteObject", id: "p1" })).toEqual({ valid: true })
      const deleted = commitPatch(document, { op: "deleteObject", id: "p1" }).document
      expect(deleted.primitives.map((primitive) => primitive.id).sort()).toEqual(["keep", "p2"])

      // Without the cascade the dangling reference would make the whole document unsavable.
      const dangling = { ...document, primitives: document.primitives.filter((primitive) => primitive.id !== "p1") }
      expect(validateDocument(dangling).valid).toBe(false)
      expect(validateDocument(deleted).valid).toBe(true)
    })

    it("can be intersected, so a segment between two dynamic points is real geometry", () => {
      const document = createEmptyDocument("conics")
      document.primitives = [
        { id: "line-x", type: "line", a: { x: -5, y: 0 }, b: { x: 5, y: 0 } },
        { id: "p1", type: "point", x: -4, y: 0, binding: { kind: "onPath", pathId: "line-x", parameter: 0.1 } },
        { id: "p2", type: "point", x: 4, y: 0, binding: { kind: "onPath", pathId: "line-x", parameter: 0.9 } },
        { id: "seg", type: "connection", kind: "segment", startPointId: "p1", endPointId: "p2" },
        { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 1 },
        { id: "hits", type: "intersectionSet", objectA: "seg", objectB: "circle-1", points: [] }
      ]

      // p1 = (-4, 0) and p2 = (4, 0), so the segment crosses the unit circle at (±1, 0).
      const recomputed = recomputeDerivedObjects(document)
      const hits = recomputed.primitives.find((primitive) => primitive.id === "hits")
      if (hits?.type !== "intersectionSet") throw new Error("intersection set missing")
      expect(hits.points).toHaveLength(2)
      for (const point of hits.points) {
        expect(Math.abs(point.x)).toBeCloseTo(1, 6)
        expect(point.y).toBeCloseTo(0, 6)
      }
    })

    /**
     * 用户口径："由动点引申出来的图元（切线、动圆）也需要能够反映和其他图元的交点"。
     * 切线由动点定位；动点一动，持久化的交点必须跟着重算，而不是留着上一次的结果。
     */
    it("keeps an intersection set live when its source is a tangent driven by a point", () => {
      const document = createEmptyDocument("conics")
      document.primitives = [
        { id: "circle-src", type: "circle", center: { x: 0, y: 0 }, radius: 2 },
        { id: "point-a", type: "point", x: 2, y: 0, binding: { kind: "onPath", pathId: "circle-src", parameter: 0, parameterId: "t-a" } },
        { id: "line-1", type: "line", a: { x: -6, y: 1 }, b: { x: 10, y: 1 } },
        { id: "tangent-1", type: "tangent", sourceId: "circle-src", x: 0, point: { x: 2, y: 0 }, slope: 0, a: { x: 2, y: -2 }, b: { x: 2, y: 2 }, status: "approximate", anchor: { kind: "point", pointId: "point-a" } },
        { id: "hits", type: "intersectionSet", objectA: "tangent-1", objectB: "line-1", points: [] }
      ]
      document.parameters = { "t-a": { id: "t-a", value: 0, min: 0, max: 6.28, step: 0.05, ownerId: "point-a" } }

      // 参数 0：切点在 (2,0)，切线竖直 x=2 ⇒ 与 y=1 交于 (2,1)。
      const atZero = recomputeDerivedObjects(document)
      const hitsAtZero = atZero.primitives.find((primitive) => primitive.id === "hits")
      if (hitsAtZero?.type !== "intersectionSet") throw new Error("intersection set missing")
      expect(hitsAtZero.points).toHaveLength(1)
      expect(hitsAtZero.points[0].x).toBeCloseTo(2, 6)
      expect(hitsAtZero.points[0].y).toBeCloseTo(1, 6)

      // 参数转到 90°：切点走到 (0,2)，切线变成水平 y=2 ⇒ 与 y=1 不再相交。
      // 留旧结果的实现会仍然报一个 (2,1)，所以"变成 0 个"正是这条用例要钉的性质。
      const turned = applyOperation(atZero, { op: "setParameter", id: "t-a", value: Math.PI / 2 })
      const hitsTurned = turned.document.primitives.find((primitive) => primitive.id === "hits")
      if (hitsTurned?.type !== "intersectionSet") throw new Error("intersection set missing")
      expect(hitsTurned.points).toEqual([])
    })

    it("keeps the intersection live when the dynamic endpoint slides", () => {
      const document = createEmptyDocument("conics")
      document.primitives = [
        { id: "line-x", type: "line", a: { x: -5, y: 0 }, b: { x: 5, y: 0 } },
        { id: "p1", type: "point", x: -4, y: 0, binding: { kind: "onPath", pathId: "line-x", parameter: 0.1 } },
        { id: "p2", type: "point", x: 4, y: 0, binding: { kind: "onPath", pathId: "line-x", parameter: 0.9 } },
        { id: "seg", type: "connection", kind: "segment", startPointId: "p1", endPointId: "p2" },
        { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 1 },
        { id: "hits", type: "intersectionSet", objectA: "seg", objectB: "circle-1", points: [] }
      ]
      const initial = recomputeDerivedObjects(document)

      // Pull p1 back to the origin's side so the segment no longer reaches the circle on the left.
      const moved = applyOperation(initial, { op: "translatePrimitive", id: "p1", delta: { x: 4.5, y: 0 } })
      const hits = moved.document.primitives.find((primitive) => primitive.id === "hits")
      if (hits?.type !== "intersectionSet") throw new Error("intersection set missing")
      // p1 is now at (0.5, 0), so only the right crossing at (1, 0) survives.
      expect(hits.points).toHaveLength(1)
      expect(hits.points[0].x).toBeCloseTo(1, 6)
    })
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
    expect(cubePlane?.normal).toEqual({ x: 0, y: 0, z: 1 })
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

    // 世界是 Z 轴朝上，所以"水平剖切面"的法向是 +Z、常数取包围盒 z 范围的中点。
    const cubePlane = sectionPlaneThroughSource(document, "cube-1")!
    expect(cubePlane.normal).toEqual({ x: 0, y: 0, z: 1 })
    expect(cubePlane.constant).toBeCloseTo(0, 10)

    // 棱锥：底面在 z = 0、顶点在 z = 4（Z-up），所以默认剖切面是 z = 2 ⇒ constant = -2。
    // 旧实现用的是 Y-up 的回退几何，算出来的刀口落在实体之外（已修）。
    const pyramidPlane = sectionPlaneThroughSource(document, "pyramid-1")!
    expect(pyramidPlane.normal).toEqual({ x: 0, y: 0, z: 1 })
    expect(pyramidPlane.constant).toBeCloseTo(-2, 10)
  })

  it("cuts every template solid with its default plane", () => {
    // 四个模板的**默认刀口**（过包围盒中高处的水平面）都必须真的切出一个多边形：
    // 棱锥/圆柱/圆锥的默认几何曾经还是 Y-up 的旧约定，刀口会切在边界甚至切空（切片 1B 修掉）。
    const templates = [
      { id: "cube-1", type: "cube", origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } },
      { id: "pyramid-1", type: "pyramid", baseCenter: { x: 0, y: 0, z: 0 }, baseSize: { x: 4, y: 4 }, height: 4 },
      { id: "cylinder-1", type: "cylinder", center: { x: 0, y: 0, z: 0 }, radius: 2, height: 4, segments: 32 },
      { id: "cone-1", type: "cone", center: { x: 0, y: 0, z: 0 }, radius: 2, height: 4, segments: 32 }
    ] as const

    for (const template of templates) {
      const document = createEmptyDocument("geometry3d")
      document.primitives = [template]
      const plane = sectionPlaneThroughSource(document, template.id)
      expect(plane, template.id).not.toBeNull()
      if (!plane) continue
      const withSection = structuredClone(document)
      withSection.primitives = [...document.primitives, { id: "section-1", type: "section", sourceId: template.id, plane, points: [], classification: "none" as const, status: "undefined" as const }]

      const section = recomputeDerivedObjects(withSection).primitives.find((primitive) => primitive.id === "section-1")
      if (section?.type !== "section") throw new Error(`section missing for ${template.id}`)
      expect(section.classification, template.id).toBe("polygon")
      expect(section.points.length, template.id).toBeGreaterThanOrEqual(3)
      expect((section.loops ?? []).length, template.id).toBeGreaterThanOrEqual(1)
    }
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

  /**
   * 体检发现的真缺陷：删对象时分组只"摘掉被删成员"，从不回收只剩一个成员的壳。
   * 而 `validateDocument` 要求 `members.length >= 2`——于是删掉组里的一个对象之后，
   * 文档**再也存不下去**（`encodeMgeo` 抛 "group has invalid members"）。
   */
  it("drops a group once a deletion leaves it with a single member", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "point-1", type: "point", x: 1, y: 2 },
      { id: "point-2", type: "point", x: 3, y: 4 },
      { id: "point-3", type: "point", x: 5, y: 6 }
    ]
    const grouped = commitPatch(document, { op: "createGroup", group: { id: "group-1", members: ["point-1", "point-2", "point-3"] } })

    const pruned = commitPatch(grouped.document, { op: "deleteObject", id: "point-3" })
    expect(pruned.document.groups).toEqual([{ id: "group-1", members: ["point-1", "point-2"] }])
    expect(encodeMgeo(pruned.document)).toContain("group-1")

    const dissolved = commitPatch(pruned.document, { op: "deleteObject", id: "point-2" })
    expect(dissolved.document.groups).toEqual([])
    // 存得下去才是修好了：校验失败的文档在导出路径上会直接抛错。
    expect(encodeMgeo(dissolved.document)).toContain("point-1")
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

/**
 * **Solid/Prism 切片 Fix round 2**：真源的一致性（I4）与派生状态的可见性（I5）。
 *
 * 两条都从**生产入口**走：I4 用 `patchPoint3` / `applyOperation`（属性栏与拖动走的那条路），
 * I5 用 `solidStatusReport`（场景图对已提交文档算出的派生读数），而不是在测试里直接调内核求解器。
 */
const PRISM_BASE = [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 3, z: 0 }, { x: 0, y: 3, z: 0 }]
const PRISM_VECTOR = { x: 1, y: 0.5, z: 3 }

/** 一只按生产口径建出来的棱柱（`compileSolidPrism` 就是 `solid.create_prism` 的实现）。 */
function prismDocument(): GeometryDocument {
  const built = compileSolidPrism("solid-1", PRISM_BASE, PRISM_VECTOR, "斜棱柱 1")
  expect(built.diagnostics).toEqual([])
  const document = createEmptyDocument("geometry3d")
  document.primitives = built.primitives
  return document
}

describe("a prism's construction descriptor stays the truth source", () => {
  /**
   * **I4**：顶点一动，`construction` 就不能再宣称"我还是按底面 + 向量拉伸出来的那只棱柱"。
   *
   * 之前只有 `kind === "template"` 会被翻成 `fromFaces`，棱柱不会 —— 于是顶点被拖走之后，
   * 文档里存着一份**与几何矛盾**的描述（而描述是规格 §1.2 声明的真源）。
   * 现在的口径与模板一致：还能与实际顶点对上的棱柱保持 `prism`；一旦对不上，
   * 就如实改记成显式面环（`fromFaces`）并保留归属 `sourceId`（否则这个实体会从截面 / 交线里静默消失）。
   */
  it("downgrades the descriptor once a vertex stops matching the base + vector recipe", () => {
    const document = prismDocument()
    const moved = applyOperation(document, patchPoint3("solid-1:v6", { x: 0, y: 0, z: 9 }))
    expect(moved.error).toBeUndefined()
    const solid = moved.document.primitives.find((primitive) => primitive.id === "solid-1")
    if (solid?.type !== "polyhedron3") throw new Error("expected the prism solid")

    expect(solid.construction).toEqual({ kind: "fromFaces", sourceIds: [...solid.faceIds], sourceId: "solid-1" })
    // 拓扑本身没被动过：只是"描述不再自称棱柱"。
    expect(solid.vertexIds).toHaveLength(8)
  })

  it("keeps the prism descriptor while every vertex still matches it", () => {
    const document = prismDocument()
    // 改的是**外观**（属性栏改名），几何一个点都没动。
    const restyled = applyOperation(document, { op: "updatePrimitive", id: "solid-1", patch: { label: "棱柱 A" } })
    const solid = restyled.document.primitives.find((primitive) => primitive.id === "solid-1")
    if (solid?.type !== "polyhedron3") throw new Error("expected the prism solid")
    expect(solid.construction).toEqual({ kind: "prism", base: { polygon: PRISM_BASE }, vector: PRISM_VECTOR })
  })

  /**
   * **整只实体被搬动之后，棱柱的描述符必须跟着顶点走**（外部审查 M1）。
   *
   * `prismMatchesVertices` 那道检查原先只在 `updatePrimitive` 的 `point3` 分支里跑 ——
   * 于是拖动 / 旋转**整只**实体之后，文档继续宣称"我是由这个底面加这个向量拉伸出来的"，
   * 而顶点已经不是了（实测：平移 `(5,0,0)` 之后描述符里的底面还在原点）。
   * 规格 §1.2 的口径是"构造描述才是真源、顶点是确定性派生拓扑"，所以不能让它说假话。
   */
  it("keeps the prism descriptor true after the whole solid is dragged", () => {
    const document = prismDocument()
    const moved = applyOperation(document, { op: "translatePrimitive3", id: "solid-1", delta: { x: 5, y: 0, z: 0 } })
    expect(moved.error).toBeUndefined()

    const solid = moved.document.primitives.find((primitive) => primitive.id === "solid-1")
    if (solid?.type !== "polyhedron3") throw new Error("expected the prism solid")
    if (solid.construction?.kind !== "prism") throw new Error(`expected the prism descriptor, got ${solid.construction?.kind}`)
    // 描述符搬了同样的位移：底面第一个点走到 x+5，而刚体平移不改变拉伸向量。
    expect(solid.construction.base.polygon[0]).toEqual({ x: PRISM_BASE[0].x + 5, y: PRISM_BASE[0].y, z: PRISM_BASE[0].z })
    expect(solid.construction.vector).toEqual(PRISM_VECTOR)
    // 顶点确实也走到了那里 —— 描述符与顶点在说**同一件事**。
    const vertex = moved.document.primitives.find((primitive) => primitive.id === solid.vertexIds[0])
    expect(vertex).toMatchObject({ type: "point3", position: { x: PRISM_BASE[0].x + 5, y: PRISM_BASE[0].y, z: PRISM_BASE[0].z } })
  })

  it("leaves a template solid's own upgrade path alone", () => {
    const source = { id: "cube-1", type: "cube" as const, origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }
    const topology = buildSolidTemplate(source)
    const document = createEmptyDocument("geometry3d")
    document.primitives = [source, ...topology.primitives]

    const moved = applyOperation(document, patchPoint3(topology.vertexIds[0]!, { x: -3, y: -1, z: -1 }))
    const template = moved.document.primitives.find((primitive) => primitive.type === "polyhedron3" && primitive.construction?.kind === "fromFaces")

    expect(template).toBeDefined()
    if (template?.type !== "polyhedron3" || template.construction?.kind !== "fromFaces") throw new Error("expected the downgraded template")
    expect(template.construction.sourceId).toBe("cube-1")
  })
})

describe("solid status report surfaces the derived results", () => {
  /** **I5**：`DerivedSolidResult` 的状态必须能从**已提交的文档**读出来，而不是只活在单测里。 */
  it("reports the circumsphere and insphere status of every polyhedron", () => {
    const document = prismDocument()

    const report = solidStatusReport(document)

    const circumsphere = report.find((entry) => entry.solidId === "solid-1" && entry.code === "derived.circumsphere")
    const insphere = report.find((entry) => entry.solidId === "solid-1" && entry.code === "derived.insphere")
    // 斜棱柱：一般多面体不一定有外接球 / 内切球，两个都如实报 `undefined`。
    expect(circumsphere?.status).toBe("undefined")
    expect(insphere?.status).toBe("undefined")
    // 理由要能读：只给状态码，用户还是不知道为什么"没有球"。
    expect(circumsphere?.message).toContain("外接球")
    expect(insphere?.message).toContain("内切球")

    // 报告与内核求解器**是同一份**结论（不是报告层自己另算一遍）。
    const primitiveMap = new Map(document.primitives.map((primitive) => [primitive.id, primitive]))
    const topology = solidTopology3(primitiveMap.get("solid-1")!, primitiveMap)!
    const boundary: SolidBoundary = { vertices: topology.vertices, faces: topology.faces }
    expect([solveCircumsphere3(boundary).status, solveInsphere3(boundary).status]).toEqual([circumsphere?.status, insphere?.status])
  })

  it("reports a box's exact circumsphere and insphere as exact", () => {
    const source = { id: "cube-1", type: "cube" as const, origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }
    const document = createEmptyDocument("geometry3d")
    document.primitives = [source, ...buildSolidTemplate(source).primitives]

    const report = solidStatusReport(document)

    expect(report.find((entry) => entry.code === "derived.circumsphere")?.status).toBe("exact")
    expect(report.find((entry) => entry.code === "derived.insphere")?.status).toBe("exact")
  })

  it("reports a section's classification against its own solid", () => {
    const document = prismDocument()
    document.primitives = [
      ...document.primitives,
      { id: "section-1", type: "section", sourceId: "solid-1", plane: { normal: { x: 0, y: 0, z: 1 }, constant: -1.5 }, points: [], classification: "none", status: "undefined" }
    ]

    const report = solidStatusReport(document)

    const section = report.find((entry) => entry.code === "derived.section")
    expect(section?.status).toBe("exact")
    // 状态之外还要有可用的形状读数：截面是四边形。
    expect(section?.message).toContain("polygon")
  })

  /**
   * **范围参数真的把计算限制住了**（外部审查 G1）。
   *
   * `PropertiesBar` 的注释一直写着"按选中对象过滤，而且只在选中实体 / 截面时才算"，
   * 但它原先是在**算完整篇文档之后**再 `.filter(...)` —— 过滤只筛结果、不省计算，
   * 而"算"才是贵的那一半（每只实体都要解外接球与内切球，内切球还是迭代求解）。
   * 这里钉住的是"范围传进去之后结果只含范围内那几只"，界面才可能真的省下计算。
   */
  it("scopes the report to the requested solids when a scope is given", () => {
    const document = prismDocument()
    // **找到真正那只多面体**再克隆（`primitives[0]` 未必是它 —— 棱柱的顶点排在前面）。
    const solid = document.primitives.find((primitive) => primitive.type === "polyhedron3")
    expect(solid, "the fixture must contain a polyhedron3").toBeDefined()
    document.primitives = [...document.primitives, { ...structuredClone(solid!), id: "solid-2" }]

    // 不传范围 = 整篇文档（观察层要的就是全量）。
    const all = solidStatusReport(document)
    expect(new Set(all.map((entry) => entry.solidId))).toEqual(new Set(["solid-1", "solid-2"]))

    const scoped = solidStatusReport(document, { solidIds: ["solid-2"] })
    expect(scoped).toHaveLength(2)
    expect(new Set(scoped.map((entry) => entry.solidId))).toEqual(new Set(["solid-2"]))
    expect(scoped.map((entry) => entry.code)).toEqual(["derived.circumsphere", "derived.insphere"])
  })

  it("scopes the report to the requested sections when a scope is given", () => {
    const document = prismDocument()
    document.primitives = [
      ...document.primitives,
      { id: "section-1", type: "section", sourceId: "solid-1", plane: { normal: { x: 0, y: 0, z: 1 }, constant: -1.5 }, points: [], classification: "none", status: "undefined" },
      { id: "section-2", type: "section", sourceId: "solid-1", plane: { normal: { x: 0, y: 0, z: 1 }, constant: -0.5 }, points: [], classification: "none", status: "undefined" }
    ]

    const scoped = solidStatusReport(document, { sectionIds: ["section-1"] })

    // 截面范围只留那一刀；`solidIds` 缺省时球体读数照旧**不**被这个范围清掉。
    expect(scoped.filter((entry) => entry.code === "derived.section").map((entry) => entry.sourceId)).toEqual(["section-1"])
    expect(scoped.some((entry) => entry.code === "derived.circumsphere")).toBe(true)
  })

  it("says nothing about a solid whose topology cannot be read", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [{ id: "solid-broken", type: "polyhedron3", vertexIds: ["missing"], edgeIds: [], faceIds: [] }]

    expect(solidStatusReport(document)).toEqual([])
  })

  /**
   * **两条截面读数各自说自己属于哪一个截面图元**（Fix round 1 / M1）。
   *
   * 报告原先只有 `solidId`（= 截面的 `sourceId`），于是一只实体上的两个截面产出两条
   * **完全一样**的读数记录：界面既分不清哪一行是哪一刀（React key 还会撞），
   * 模型也读不出"是哪条截面的分类"。这里把截面图元自己的 id 一起报出去。
   */
  it("attributes every section reading to the section primitive it came from", () => {
    const document = prismDocument()
    document.primitives = [
      ...document.primitives,
      { id: "section-1", type: "section", sourceId: "solid-1", plane: { normal: { x: 0, y: 0, z: 1 }, constant: -1.5 }, points: [], classification: "none", status: "undefined" },
      { id: "section-2", type: "section", sourceId: "solid-1", plane: { normal: { x: 0, y: 0, z: 1 }, constant: -0.5 }, points: [], classification: "none", status: "undefined" }
    ]

    const sections = solidStatusReport(document).filter((entry) => entry.code === "derived.section")

    expect(sections).toHaveLength(2)
    expect(sections.map((entry) => entry.sourceId)).toEqual(["section-1", "section-2"])
    // 球体读数没有"哪条截面"可言：这个字段对它们保持缺省，而不是填一个假的 id。
    expect(solidStatusReport(document).find((entry) => entry.code === "derived.circumsphere")?.sourceId).toBeUndefined()
  })
})

/**
 * **实体的物化拓扑只有一条规则**（Fix round 1 / I2；D8）。
 *
 * 两种记法都要认：模板物化是 `kind: "template"` + `sourceIds[0] === 实体 id`；
 * 而按数值改过顶点的模板会被翻成 `fromFaces`，归属记在 `sourceId` 上。
 * 这条规则此前只活在 `templateTopology` 里（未导出），界面只好自己再写一遍 ——
 * 而界面那一版只认第一种记法，于是"拖一个顶点之后派生读数整块消失"。
 * 现在它从这里出口，两边调同一份。
 */
describe("topologyOfEntity", () => {
  function cubeDocument(): { document: GeometryDocument; vertexId: string; polyhedronId: string } {
    const source = { id: "cube-1", type: "cube" as const, origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }
    const built = buildSolidTemplate(source)
    const document = createEmptyDocument("geometry3d")
    document.primitives = [source, ...built.primitives]
    return { document, vertexId: built.vertexIds[0]!, polyhedronId: built.polyhedronId! }
  }

  it("finds a template solid's topology through the template notation", () => {
    const { document, polyhedronId } = cubeDocument()

    expect(topologyOfEntity(document, "cube-1")?.id).toBe(polyhedronId)
    // 反方向是同一个答案（`ownerOfTopology` 与 `topologyOfEntity` 共用一条规则）。
    expect(ownerOfTopology(document.primitives.find((primitive) => primitive.id === polyhedronId) as Extract<GeometryDocument["primitives"][number], { type: "polyhedron3" }>)).toBe("cube-1")
  })

  /**
   * 翻成 `fromFaces` 之后仍然找得到 —— 这是"拖一个顶点"的真实路径
   *（`patchPoint3` → `applyOperation`，与属性栏和拖动走同一条）。
   */
  it("still finds it after a numeric vertex edit flipped the notation to fromFaces", () => {
    const { document, vertexId, polyhedronId } = cubeDocument()
    const flipped = applyOperation(document, patchPoint3(vertexId, { x: -3, y: -1, z: -1 }))
    expect(flipped.error).toBeUndefined()
    const topology = flipped.document.primitives.find((primitive) => primitive.id === polyhedronId)
    if (topology?.type !== "polyhedron3") throw new Error("expected the topology")
    expect(topology.construction).toMatchObject({ kind: "fromFaces", sourceId: "cube-1" })

    expect(topologyOfEntity(flipped.document, "cube-1")?.id).toBe(polyhedronId)
    expect(ownerOfTopology(topology)).toBe("cube-1")
  })

  it("prefers the parameterised template notation when both notations exist", () => {
    const { document, polyhedronId } = cubeDocument()
    // 同一实体同时留下两份拓扑：模板那一份才是参数真源。
    const duplicate = { id: "cube-1-polyhedron-old", type: "polyhedron3" as const, vertexIds: [], edgeIds: [], faceIds: [], construction: { kind: "fromFaces" as const, sourceIds: [], sourceId: "cube-1" } }
    document.primitives = [duplicate, ...document.primitives]

    expect(topologyOfEntity(document, "cube-1")?.id).toBe(polyhedronId)
  })

  it("returns null for an entity that has no materialised topology", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [{ id: "point3-1", type: "point3", position: { x: 0, y: 0, z: 0 } }]

    expect(topologyOfEntity(document, "point3-1")).toBeNull()
    expect(topologyOfEntity(document, "nope")).toBeNull()
  })
})
