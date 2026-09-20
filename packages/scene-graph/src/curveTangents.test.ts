import { describe, expect, it } from "vitest"

import { createEmptyDocument, decodeMgeo, encodeMgeo, validateDocument, type GeometryDocument, type PrimitiveSpec } from "@draw/dsl"

import { commitPatch, recomputeDerivedObjects, validateDeletion } from "./index"

/**
 * 用户口径：
 *
 * 1. "创建一条曲线后，可以点击这条曲线，右侧功能栏里应有一个选项是创建一条在这个曲线上的切线。
 *    曲线包括抛物线，双曲线，圆，椭圆。"
 * 2. "动点在轨道上能够在动点位置画切线，同时切线能根据动点位置进行动态变化，
 *    第二动点能够作为圆心作圆，圆的半径能够调节，也能够根据动点位置进行动态变化。"
 *
 * 这一层钉住的是**文档语义**（重算写出的几何、依赖边、级联删除、校验），而不是界面：
 * 界面只负责把这几条操作发出来，正确性必须落在这里。
 */

function find(document: GeometryDocument, id: string): PrimitiveSpec {
  const primitive = document.primitives.find((candidate) => candidate.id === id)
  if (!primitive) throw new Error(`missing primitive ${id}`)
  return primitive
}

/** 圆上/圆锥曲线上的一点，用隐式判据检验"切点确实在曲线上"，与参数化无关。 */
function circleResidual(circle: { center: { x: number; y: number }; radius: number }, point: { x: number; y: number }): number {
  return Math.abs(Math.hypot(point.x - circle.center.x, point.y - circle.center.y) - circle.radius)
}

/** 一份包含四条曲线 + 一个动点的平面文档，供下面每条用例各取所需。 */
function curveDocument(): GeometryDocument {
  const document = createEmptyDocument("conics")
  document.primitives = [
    { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 3 },
    { id: "ellipse-1", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 4, radiusY: 2 },
    { id: "hyperbola-1", type: "hyperbola", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2, axis: "x" },
    { id: "parabola-1", type: "parabola", vertex: { x: 0, y: 0 }, focalParameter: 2, axis: "y" },
    // 动点：绑在圆上，参数 0 就是 (3, 0)。
    { id: "point-a", type: "point", x: 3, y: 0, binding: { kind: "onPath", pathId: "circle-1", parameter: 0, parameterId: "t-point-a" } },
    { id: "point-b", type: "point", x: 1, y: 1 }
  ]
  document.parameters = { "t-point-a": { id: "t-point-a", value: 0, min: 0, max: 6.28, step: 0.05, label: "驱动 A", ownerId: "point-a" } }
  return document
}

/** 参数定位的切线：`anchor` 就是这个圆锥曲线的自然参数。 */function parameterTangent(id: string, sourceId: string, parameter: number) {
  return { id, type: "tangent" as const, sourceId, x: parameter, point: { x: 0, y: 0 }, slope: 0, a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, status: "approximate" as const, anchor: { kind: "parameter" as const, parameter } }
}

describe("curve tangents in the document", () => {
  it("puts a tangent on every kind of curve the user named, with the tangency point on the curve", () => {
    const document = { ...curveDocument() }
    document.primitives = [
      ...document.primitives,
      parameterTangent("tangent-circle", "circle-1", 0),
      parameterTangent("tangent-ellipse", "ellipse-1", 0.7),
      parameterTangent("tangent-hyperbola", "hyperbola-1", 1.4),
      parameterTangent("tangent-parabola", "parabola-1", 1.5)
    ]
    const settled = recomputeDerivedObjects(document)
    for (const id of ["tangent-circle", "tangent-ellipse", "tangent-hyperbola", "tangent-parabola"]) {
      const tangent = find(settled, id)
      if (tangent.type !== "tangent") throw new Error(`expected a tangent at ${id}`)
      expect(tangent.status, id).toBe("approximate")
      // 切线是一条**真的线段**：两端不同，而且切点严格是它的中点。
      expect(Number.isFinite(tangent.a.x) && Number.isFinite(tangent.b.x), id).toBe(true)
      expect(Math.hypot(tangent.b.x - tangent.a.x, tangent.b.y - tangent.a.y), id).toBeGreaterThan(0)
      expect((tangent.a.x + tangent.b.x) / 2, id).toBeCloseTo(tangent.point.x, 9)
      expect((tangent.a.y + tangent.b.y) / 2, id).toBeCloseTo(tangent.point.y, 9)
    }
    // 圆上参数 0 的切点是 (3, 0)，切线竖直 —— 斜截式在这里会得到 Infinity。
    const circleTangent = find(settled, "tangent-circle")
    if (circleTangent.type !== "tangent") throw new Error("expected a tangent")
    expect(circleTangent.point.x).toBeCloseTo(3, 9)
    expect(circleTangent.point.y).toBeCloseTo(0, 9)
    expect(circleTangent.vertical).toBe(true)
    expect(circleTangent.a.x).toBeCloseTo(3, 9)
    expect(circleTangent.b.x).toBeCloseTo(3, 9)
    expect(circleResidual({ center: { x: 0, y: 0 }, radius: 3 }, circleTangent.point)).toBeCloseTo(0, 9)
  })

  it("honours an explicit half length, leaving the tangent point alone", () => {
    const document = curveDocument()
    document.primitives = [...document.primitives, parameterTangent("tangent-circle", "circle-1", 0)]
    const settled = recomputeDerivedObjects(document)

    const longer = commitPatch(settled, { op: "updatePrimitive", id: "tangent-circle", patch: { halfLength: 10 } })
    expect(longer.changed).toBe(true)
    const resized = find(longer.document, "tangent-circle")
    if (resized.type !== "tangent") throw new Error("expected a tangent")
    expect(Math.hypot(resized.b.x - resized.a.x, resized.b.y - resized.a.y)).toBeCloseTo(20, 9)
    // 拉长不改切点。
    expect(resized.point.x).toBeCloseTo(3, 9)
    expect(resized.point.y).toBeCloseTo(0, 9)
  })

  /**
   * 用户口径（2026-09-18）："切线长度还要增长一点，**最好是无限长**"。
   *
   * 这条取代了上一轮的"缺省半长 = 1.5 × 曲线尺度"：没有显式 `halfLength` 的切线 / 法线
   * 现在是**无限长**（用 ±10000 世界单位表达，见 `INFINITE_TANGENT_EXTENT`），
   * 显式填了半长的仍然被修剪。函数来源同样无限长（教科书里的切线本来就是一条直线）。
   */
  it("draws a tangent as an infinite line unless an explicit half length trims it", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 2 },
      parameterTangent("tan-infinite", "circle-1", 0),
      { ...parameterTangent("tan-trimmed", "circle-1", 0), halfLength: 1 },
      { id: "fn-1", type: "function", expression: "x", domain: [-2, 2], samples: 32 },
      { id: "tan-fn", type: "tangent", sourceId: "fn-1", x: 0, point: { x: 0, y: 0 }, slope: 1, a: { x: -2, y: -2 }, b: { x: 2, y: 2 }, status: "approximate" }
    ]

    const settled = recomputeDerivedObjects(document)
    const span = (id: string) => {
      const tangent = find(settled, id)
      if (tangent.type !== "tangent") throw new Error("expected a tangent")
      return Math.hypot(tangent.b.x - tangent.a.x, tangent.b.y - tangent.a.y)
    }

    // 缺省无限长：圆来源与函数来源都是。
    expect(span("tan-infinite")).toBeGreaterThan(19000)
    expect(span("tan-fn")).toBeGreaterThan(19000)
    // 显式 halfLength 仍然是"修剪"：半长 1 ⇒ 全长 2。
    expect(span("tan-trimmed")).toBeCloseTo(2, 6)
    // 无限长仍然以切点为中心（不能偏到一边去）。
    const infinite = find(settled, "tan-infinite")
    if (infinite.type !== "tangent") throw new Error("expected a tangent")
    expect((infinite.a.y + infinite.b.y) / 2).toBeCloseTo(0, 6)
    expect((infinite.a.x + infinite.b.x) / 2).toBeCloseTo(2, 6)
  })

  it("anchors a tangent to a dynamic point, and the tangent follows when the point moves", () => {
    const document = curveDocument()
    document.primitives = [...document.primitives, { ...parameterTangent("tangent-a", "circle-1", 0), anchor: { kind: "point" as const, pointId: "point-a" } }]
    const settled = recomputeDerivedObjects(document)
    const before = find(settled, "tangent-a")
    if (before.type !== "tangent") throw new Error("expected a tangent")
    // 动点当前在 (3, 0)：切线必须正好切在那里。
    expect(before.point.x).toBeCloseTo(3, 9)
    expect(circleResidual({ center: { x: 0, y: 0 }, radius: 3 }, before.point)).toBeCloseTo(0, 9)

    // 把动点沿轨道推到参数 1.1：切线必须跟着走，而且仍然切在同一位置。
    const moved = commitPatch(settled, { op: "setParameter", id: "t-point-a", value: 1.1 })
    expect(moved.changed).toBe(true)
    const point = find(moved.document, "point-a")
    const after = find(moved.document, "tangent-a")
    if (point.type !== "point" || after.type !== "tangent") throw new Error("unexpected types")
    expect(after.point.x).toBeCloseTo(point.x, 9)
    expect(after.point.y).toBeCloseTo(point.y, 9)
    expect(circleResidual({ center: { x: 0, y: 0 }, radius: 3 }, after.point)).toBeCloseTo(0, 9)
    // 切向与半径垂直（圆心在原点的圆：半径方向 · 切向 = 0）。
    const direction = { x: after.b.x - after.a.x, y: after.b.y - after.a.y }
    expect(point.x * direction.x + point.y * direction.y).toBeCloseTo(0, 9)
  })

  it("follows a dynamic point that is dragged by its coordinates instead of its parameter", () => {
    const document = curveDocument()
    document.primitives = [...document.primitives, { ...parameterTangent("tangent-a", "circle-1", 0), anchor: { kind: "point" as const, pointId: "point-a" } }]
    const settled = recomputeDerivedObjects(document)
    const dragged = commitPatch(settled, { op: "translatePrimitive", id: "point-a", delta: { x: -2, y: 3 } })
    expect(dragged.changed).toBe(true)
    const point = find(dragged.document, "point-a")
    const tangent = find(dragged.document, "tangent-a")
    if (point.type !== "point" || tangent.type !== "tangent") throw new Error("unexpected types")
    // 动点被拖到别处之后仍然是**曲线上的点**（绑定把它投影回去了），切线必须贴在它身上。
    expect(circleResidual({ center: { x: 0, y: 0 }, radius: 3 }, point)).toBeCloseTo(0, 9)
    expect(tangent.point.x).toBeCloseTo(point.x, 9)
    expect(tangent.point.y).toBeCloseTo(point.y, 9)
  })

  it("projects a free anchor point onto the curve instead of refusing to draw a tangent", () => {
    const document = curveDocument()
    // point-b 是自由点 (1,1)：它没有绑在圆上，切线应该切在圆上离它最近的地方。
    document.primitives = [...document.primitives, { ...parameterTangent("tangent-b", "circle-1", 0), anchor: { kind: "point" as const, pointId: "point-b" } }]
    const settled = recomputeDerivedObjects(document)
    const tangent = find(settled, "tangent-b")
    if (tangent.type !== "tangent") throw new Error("expected a tangent")
    expect(tangent.status).toBe("approximate")
    expect(circleResidual({ center: { x: 0, y: 0 }, radius: 3 }, tangent.point)).toBeCloseTo(0, 9)
    // (1,1) 方向上的最近点是半径方向上的 (3/√2, 3/√2)。
    expect(tangent.point.x).toBeCloseTo(3 / Math.SQRT2, 6)
    expect(tangent.point.y).toBeCloseTo(3 / Math.SQRT2, 6)
  })

  it("follows a dynamic point whose track is a function graph, not just a conic", () => {
    /**
     * 函数图像也是动点能绑定的轨道，所以"在动点处作切线"完全可能落在它上面。
     * 这一条专门盯住分派顺序：按"来源是函数"优先分派的话，`anchor` 会被静默忽略，
     * 表现就是"切线切出来了，但拖点它不动"。
     */
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "fn-1", type: "function", expression: "x^2", domain: [-3, 3], samples: 64 },
      { id: "point-f", type: "point", x: 0, y: 0, binding: { kind: "onPath", pathId: "fn-1", parameter: 0, parameterId: "t-point-f" } },
      { ...parameterTangent("tangent-f", "fn-1", 0), anchor: { kind: "point" as const, pointId: "point-f" } }
    ]
    document.parameters = { "t-point-f": { id: "t-point-f", value: 0, min: -3, max: 3, step: 0.05, label: "驱动 F", ownerId: "point-f" } }
    const settled = recomputeDerivedObjects(document)
    const atZero = find(settled, "tangent-f")
    if (atZero.type !== "tangent") throw new Error("expected a tangent")
    // x = 0 处 y = 0，切线水平。
    expect(atZero.point.x).toBeCloseTo(0, 9)
    expect(atZero.point.y).toBeCloseTo(0, 9)
    expect(Math.abs(atZero.slope)).toBeCloseTo(0, 6)

    const moved = commitPatch(settled, { op: "setParameter", id: "t-point-f", value: 1.5 })
    expect(moved.changed).toBe(true)
    const point = find(moved.document, "point-f")
    const tangent = find(moved.document, "tangent-f")
    if (point.type !== "point" || tangent.type !== "tangent") throw new Error("unexpected types")
    // 切线必须落在动点上（y = x²），而且斜率 = 2x。
    expect(tangent.point.x).toBeCloseTo(point.x, 9)
    expect(tangent.point.y).toBeCloseTo(point.x * point.x, 9)
    expect(tangent.slope).toBeCloseTo(2 * point.x, 6)
  })

  it("reports a clear failure instead of inventing geometry when the anchor is gone", () => {
    const document = curveDocument()
    document.primitives = [...document.primitives, { ...parameterTangent("tangent-a", "circle-1", 0), anchor: { kind: "point" as const, pointId: "point-a" } }]
    const settled = recomputeDerivedObjects(document)
    // 删掉定位点：切线是纯派生的，跟着一起走。
    const deleted = commitPatch(settled, { op: "deleteObject", id: "point-a" })
    expect(deleted.changed).toBe(true)
    expect(deleted.document.primitives.some((primitive) => primitive.id === "tangent-a")).toBe(false)
  })

  it("removes a tangent together with the curve it describes", () => {
    const document = curveDocument()
    document.primitives = [...document.primitives, parameterTangent("tangent-circle", "circle-1", 0)]
    const settled = recomputeDerivedObjects(document)
    const deleted = commitPatch(settled, { op: "deleteObject", id: "circle-1" })
    expect(deleted.changed).toBe(true)
    expect(deleted.document.primitives.some((primitive) => primitive.id === "tangent-circle")).toBe(false)
  })
})

describe("a circle centred on a dynamic point whose radius follows another one", () => {
  /** 第二个动点作圆心、第一个动点的距离作半径 —— 正是用户描述的那道题。 */
  function dynamicCircleDocument(): GeometryDocument {
    const document = curveDocument()
    document.primitives = [
      ...document.primitives,
      { id: "point-c", type: "point", x: -2, y: 0 },
      { id: "circle-dyn", type: "circle", center: { x: -2, y: 0 }, radius: 1, centerPointId: "point-c", radiusFrom: { pointId: "point-a", factor: 1 } }
    ]
    return document
  }

  it("takes its centre from the point and its radius from the distance to the other point", () => {
    const settled = recomputeDerivedObjects(dynamicCircleDocument())
    const circle = find(settled, "circle-dyn")
    const center = find(settled, "point-c")
    const driver = find(settled, "point-a")
    if (circle.type !== "circle" || center.type !== "point" || driver.type !== "point") throw new Error("unexpected types")
    // 圆心就是这个点。
    expect(circle.center).toEqual({ x: center.x, y: center.y })
    // 半径就是这个点到圆心的距离：圆因此**正好经过那个动点**。
    expect(circle.radius).toBeCloseTo(Math.hypot(driver.x - center.x, driver.y - center.y), 9)
    expect(circleResidual(circle, driver)).toBeCloseTo(0, 9)
  })

  it("keeps the radius equal to the distance while the driving point moves along its track", () => {
    const settled = recomputeDerivedObjects(dynamicCircleDocument())
    for (const parameter of [0.4, 1.2, 2.6, 4.9]) {
      const moved = commitPatch(settled, { op: "setParameter", id: "t-point-a", value: parameter })
      expect(moved.changed, `parameter ${parameter}`).toBe(true)
      const circle = find(moved.document, "circle-dyn")
      const driver = find(moved.document, "point-a")
      if (circle.type !== "circle" || driver.type !== "point") throw new Error("unexpected types")
      expect(circle.radius, `parameter ${parameter}`).toBeCloseTo(Math.hypot(driver.x - circle.center.x, driver.y - circle.center.y), 9)
      // 圆始终过那个动点 —— 这就是"半径随动点位置动态变化"的可验证含义。
      expect(circleResidual(circle, driver), `parameter ${parameter}`).toBeCloseTo(0, 9)
    }
  })

  it("moves the centre when the centre point itself moves", () => {
    const settled = recomputeDerivedObjects(dynamicCircleDocument())
    const moved = commitPatch(settled, { op: "translatePrimitive", id: "point-c", delta: { x: 4, y: -1 } })
    expect(moved.changed).toBe(true)
    const circle = find(moved.document, "circle-dyn")
    const center = find(moved.document, "point-c")
    const driver = find(moved.document, "point-a")
    if (circle.type !== "circle" || center.type !== "point" || driver.type !== "point") throw new Error("unexpected types")
    expect(circle.center).toEqual({ x: center.x, y: center.y })
    expect(circle.radius).toBeCloseTo(Math.hypot(driver.x - center.x, driver.y - center.y), 9)
  })

  it("lets the radius be scaled and pinned back to a plain editable number", () => {
    const settled = recomputeDerivedObjects(dynamicCircleDocument())
    // 倍率：半径 = 2 × 距离。
    const scaled = commitPatch(settled, { op: "updatePrimitive", id: "circle-dyn", patch: { radiusFrom: { pointId: "point-a", factor: 2 } } })
    expect(scaled.changed).toBe(true)
    const circle = find(scaled.document, "circle-dyn")
    const driver = find(scaled.document, "point-a")
    if (circle.type !== "circle" || driver.type !== "point") throw new Error("unexpected types")
    expect(circle.radius).toBeCloseTo(2 * Math.hypot(driver.x - circle.center.x, driver.y - circle.center.y), 9)

    // 去掉规则：半径回到可直接编辑的数字，而且这个数字是**最后一次算出来的值**（不跳）。
    const frozen = commitPatch(scaled.document, { op: "updatePrimitive", id: "circle-dyn", patch: { radiusFrom: null } })
    expect(frozen.changed).toBe(true)
    const manual = find(frozen.document, "circle-dyn")
    if (manual.type !== "circle") throw new Error("expected a circle")
    expect(manual.radiusFrom).toBeUndefined()
    expect(manual.radius).toBeCloseTo(circle.radius, 9)
    const resized = commitPatch(frozen.document, { op: "updatePrimitive", id: "circle-dyn", patch: { radius: 7 } })
    expect(resized.changed).toBe(true)
    expect(find(resized.document, "circle-dyn").type === "circle" && (find(resized.document, "circle-dyn") as Extract<PrimitiveSpec, { type: "circle" }>).radius).toBeCloseTo(7, 9)
  })

  it("keeps the circle but drops the radius rule when only the driving point is deleted", () => {
    const settled = recomputeDerivedObjects(dynamicCircleDocument())
    const deleted = commitPatch(settled, { op: "deleteObject", id: "point-a" })
    expect(deleted.changed).toBe(true)
    const circle = find(deleted.document, "circle-dyn")
    if (circle.type !== "circle") throw new Error("expected the circle to survive")
    expect(circle.radiusFrom).toBeUndefined()
    expect(circle.radius).toBeGreaterThan(0)
    // 圆心点还在，所以"以它为圆心"这件事仍然成立。
    expect(circle.centerPointId).toBe("point-c")
  })

  it("removes the circle together with the point that is its centre", () => {
    const settled = recomputeDerivedObjects(dynamicCircleDocument())
    const deleted = commitPatch(settled, { op: "deleteObject", id: "point-c" })
    expect(deleted.changed).toBe(true)
    expect(deleted.document.primitives.some((primitive) => primitive.id === "circle-dyn")).toBe(false)
  })

  it("refuses dangling references and non-positive factors before they can be written", () => {
    const settled = recomputeDerivedObjects(dynamicCircleDocument())
    expect(validateDeletion(settled, ["point-c"]).valid).toBe(true)
    // 悬空圆心 / 悬空驱动点 / 非法倍率都必须被拦下来。
    for (const patch of [
      { centerPointId: "nope" },
      { radiusFrom: { pointId: "nope", factor: 1 } },
      { radiusFrom: { pointId: "point-a", factor: 0 } },
      { radiusFrom: { pointId: "point-a", factor: -2 } }
    ]) {
      const result = commitPatch(settled, { op: "updatePrimitive", id: "circle-dyn", patch })
      expect(result.changed, JSON.stringify(patch)).toBe(false)
    }
    // 切线：悬空定位点同样必须被拦下。
    const withTangent = recomputeDerivedObjects({
      ...settled,
      primitives: [...settled.primitives, { ...parameterTangent("tangent-a", "circle-1", 0), anchor: { kind: "point" as const, pointId: "point-a" } }]
    })
    const dangling = commitPatch(withTangent, { op: "updatePrimitive", id: "tangent-a", patch: { anchor: { kind: "point", pointId: "nope" } } })
    expect(dangling.changed).toBe(false)
  })
})

describe("the new fields survive the archive format", () => {
  it("round-trips through .mgeo and stays schema-valid", () => {
    const document = curveDocument()
    document.primitives = [
      ...document.primitives,
      { id: "point-c", type: "point", x: -2, y: 0 },
      { id: "circle-dyn", type: "circle", center: { x: -2, y: 0 }, radius: 1, centerPointId: "point-c", radiusFrom: { pointId: "point-a", factor: 2 } },
      { ...parameterTangent("tangent-a", "circle-1", 0), anchor: { kind: "point" as const, pointId: "point-a" }, halfLength: 4.5 },
      parameterTangent("tangent-parabola", "parabola-1", 1.25)
    ]
    const settled = recomputeDerivedObjects(document)
    const validation = validateDocument(settled)
    expect(validation.valid, validation.valid ? "" : validation.errors.join("; ")).toBe(true)
    const decoded = decodeMgeo(encodeMgeo(settled))
    const circle = find(decoded, "circle-dyn")
    const tangent = find(decoded, "tangent-a")
    if (circle.type !== "circle" || tangent.type !== "tangent") throw new Error("unexpected types")
    expect(circle.centerPointId).toBe("point-c")
    expect(circle.radiusFrom).toEqual({ pointId: "point-a", factor: 2 })
    expect(tangent.anchor).toEqual({ kind: "point", pointId: "point-a" })
    expect(tangent.halfLength).toBe(4.5)
    // 打开之后仍然会算：几何与存盘前逐位一致。
    expect(recomputeDerivedObjects(decoded).primitives).toEqual(settled.primitives)
  })

  it("still accepts a legacy function tangent with no anchor at all", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "fn-1", type: "function", expression: "x^2", domain: [-3, 3], samples: 32 },
      { id: "tan-1", type: "tangent", sourceId: "fn-1", x: 1, point: { x: 1, y: 1 }, slope: 2, a: { x: -3, y: -11 }, b: { x: 3, y: 13 }, status: "approximate" }
    ]
    const settled = recomputeDerivedObjects(document)
    const tangent = find(settled, "tan-1")
    if (tangent.type !== "tangent") throw new Error("expected a tangent")
    expect(tangent.anchor).toBeUndefined()
    expect(tangent.slope).toBeCloseTo(2, 6)
    expect(decodeMgeo(encodeMgeo(settled)).primitives).toEqual(settled.primitives)
  })

  it("rejects a curve tangent that has no anchor, because 'where does it touch' would be ambiguous", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 3 },
      { id: "tan-1", type: "tangent", sourceId: "circle-1", x: 0, point: { x: 3, y: 0 }, slope: 0, a: { x: 3, y: -3 }, b: { x: 3, y: 3 }, status: "approximate" }
    ]
    expect(validateDocument(document).valid).toBe(false)
  })

  /**
   * 函数来源的**旧切线**用横坐标 `x` 定位，所以"沿函数图像把切线拖走"就是把指针的横向位移加到 `x` 上。
   *
   * 它需要两处配合，缺一处都会表现为"拖不动"：补丁校验要允许切线带 `x`（以前只有点可以），
   * 应用补丁时要真的把 `x` 写进那条切线（以前只处理 point）。**带 `anchor` 的曲线切线不走这条路**：
   * 它的切点由 anchor 决定，写 `x` 会被下一趟重算覆盖掉。
   */
  it("slides a legacy function tangent along its graph by moving x, but ignores x on an anchored tangent", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "fn-1", type: "function", expression: "x^2", domain: [-3, 3], samples: 64 },
      { id: "tan-legacy", type: "tangent", sourceId: "fn-1", x: 1, point: { x: 1, y: 1 }, slope: 2, a: { x: -3, y: -11 }, b: { x: 3, y: 13 }, status: "approximate" },
      { id: "tan-anchored", type: "tangent", sourceId: "fn-1", x: 0, point: { x: 0, y: 0 }, slope: 0, a: { x: -3, y: 0 }, b: { x: 3, y: 0 }, status: "approximate", anchor: { kind: "parameter", parameter: 0, branch: 0 } }
    ]
    const settled = recomputeDerivedObjects(document)

    const moved = commitPatch(settled, { op: "updatePrimitive", id: "tan-legacy", patch: { x: 2.5 } })
    expect(moved.changed).toBe(true)
    const slid = find(moved.document, "tan-legacy")
    if (slid.type !== "tangent") throw new Error("expected a tangent")
    expect(slid.x).toBeCloseTo(2.5, 9)
    expect(slid.point.x).toBeCloseTo(2.5, 9)
    expect(slid.point.y).toBeCloseTo(6.25, 9)
    expect(slid.slope).toBeCloseTo(5, 6)

    // 锚定的切线上写 `x` 会被重算覆盖：补丁本身合法，但几何不会跟着走。
    //
    // 契约变更（Task 0.3）：既然**重算把这次补丁完全抹掉了**，它就不算一次语义改动，
    // `changed` 必须是 `false`（以前无条件 `true`，于是撤销栈里会留下一个什么都没变的空步）。
    // 注意它**不是错误**：补丁被接受了，只是结论是"没有变化"。
    const anchored = commitPatch(moved.document, { op: "updatePrimitive", id: "tan-anchored", patch: { x: 2.5 } })
    expect(anchored.changed).toBe(false)
    expect((anchored as { error?: string }).error).toBeUndefined()
    const still = find(anchored.document, "tan-anchored")
    if (still.type !== "tangent") throw new Error("expected a tangent")
    expect(still.point.x).toBeCloseTo(0, 9)
    expect(still.anchor).toEqual({ kind: "parameter", parameter: 0, branch: 0 })

    // 纵坐标仍然只给点：切线的高度是算出来的。
    expect(commitPatch(settled, { op: "updatePrimitive", id: "tan-legacy", patch: { y: 3 } }).changed).toBe(false)
  })
})
