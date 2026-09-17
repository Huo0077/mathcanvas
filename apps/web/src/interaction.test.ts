import { describe, expect, it } from "vitest"

import type { PrimitiveSpec } from "@draw/dsl"

import { createDragAction, getDragHandle, primitiveHandlePoints } from "./interaction"

describe("direct manipulation", () => {
  it("translates a line body by the pointer delta", () => {
    const line: PrimitiveSpec = { id: "line-1", type: "line", a: { x: 0, y: 0 }, b: { x: 2, y: 1 } }

    expect(createDragAction(line, "body", { x: 1, y: 0.5 }, { x: 3, y: 2 })).toEqual({
      kind: "translate",
      delta: { x: 2, y: 1.5 }
    })
  })

  it("updates a line endpoint when its handle is dragged", () => {
    const line: PrimitiveSpec = { id: "line-1", type: "line", a: { x: 0, y: 0 }, b: { x: 2, y: 1 } }

    expect(getDragHandle(line, { x: 0.05, y: 0.04 })).toBe("a")
    expect(createDragAction(line, "a", { x: 0, y: 0 }, { x: -1, y: 2 })).toEqual({
      kind: "update",
      patch: { a: { x: -1, y: 2 } }
    })
  })

  it("updates a circle radius from its radius handle", () => {
    const circle: PrimitiveSpec = { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 2 }

    expect(getDragHandle(circle, { x: 2.05, y: 0 })).toBe("radius")
    expect(createDragAction(circle, "radius", { x: 2, y: 0 }, { x: 3, y: 0 })).toEqual({
      kind: "update",
      patch: { radius: 3 }
    })
  })

  it("keeps derived intersections non-draggable", () => {
    const intersection: PrimitiveSpec = { id: "intersection-1", type: "intersection", lineA: "a", lineB: "b", x: 0, y: 0 }

    expect(getDragHandle(intersection, { x: 0, y: 0 })).toBeNull()
  })

  it("rotates a selected ellipse from its rotation handle", () => {
    const ellipse: PrimitiveSpec = { id: "ellipse-1", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2, rotation: 0 }

    expect(getDragHandle(ellipse, { x: 4, y: 0 })).toBe("rotation")
    expect(createDragAction(ellipse, "rotation", { x: 4, y: 0 }, { x: 0, y: 4 })).toEqual({
      kind: "update",
      patch: { rotation: Math.PI / 2 }
    })
  })

  it("translates function graphs with their domain", () => {
    const functionPrimitive: PrimitiveSpec = { id: "function-1", type: "function", expression: "x*x", domain: [-2, 2] }

    expect(createDragAction(functionPrimitive, "body", { x: 0, y: 0 }, { x: 2, y: 1 })).toEqual({
      kind: "translate",
      delta: { x: 2, y: 1 }
    })
  })
})

describe("grip handle points", () => {
  it("puts a handle on both endpoints of a segment", () => {
    expect(primitiveHandlePoints({ id: "s", type: "segment", a: { x: 0, y: 0 }, b: { x: 5, y: 2 } })).toEqual([
      { handle: "a", point: { x: 0, y: 0 } },
      { handle: "b", point: { x: 5, y: 2 } }
    ])
  })

  it("puts one handle per polyline vertex, a radius handle on a circle, and three on an arc", () => {
    expect(primitiveHandlePoints({ id: "p", type: "polyline", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }] }).map((entry) => entry.handle)).toEqual(["vertex-0", "vertex-1", "vertex-2"])
    expect(primitiveHandlePoints({ id: "c", type: "circle", center: { x: 1, y: 1 }, radius: 2 })).toEqual([{ handle: "radius", point: { x: 3, y: 1 } }])
    expect(primitiveHandlePoints({ id: "a", type: "arc", center: { x: 0, y: 0 }, radius: 2, startAngle: 0, endAngle: Math.PI / 2 }).map((entry) => entry.handle)).toEqual(["startAngle", "endAngle", "radius"])
  })

  it("offers no handles for locked or derived objects", () => {
    expect(primitiveHandlePoints({ id: "s", type: "segment", a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, locked: true })).toEqual([])
    expect(primitiveHandlePoints({ id: "i", type: "intersection", lineA: "a", lineB: "b", x: 0, y: 0 })).toEqual([])
    expect(primitiveHandlePoints({ id: "pt", type: "point", x: 1, y: 1 })).toEqual([])
  })

  /**
   * 绕定点旋转的曲线：多一个 `rotate` 手柄，而且**半径手柄按基准摆**。
   *
   * `center` 是派生值（转过之后的位置），拿它算手柄会让半径手柄跟着转过去、
   * 看起来像曲线换了半径。
   */
  describe("a curve rotating about a fixed point", () => {
    const placed = {
      id: "circle-1",
      type: "circle" as const,
      center: { x: 3, y: -3 },
      radius: 3,
      rotation: Math.PI / 2,
      rotationAbout: { pivot: { kind: "coordinate" as const, x: 3, y: 0 }, angle: Math.PI / 2, baseCenter: { x: 0, y: 0 } }
    }
    const target = { pivot: { x: 3, y: 0 }, baseCenter: { x: 0, y: 0 }, pivotPrimitiveId: null, angle: Math.PI / 2 }

    /**
     * 控制点只在**选中**时画出来，命中判定必须跟着一致。
     *
     * 动圆的半径手柄摆在"定点 + 半径"处，正好落在圆周上；不过滤选中状态的话，
     * 未选中的曲线会用一个看不见的手柄吃掉圆周上那一小块的指针 —— 用户在那里按下想拖动曲线，
     * 实际却变成了改半径（实测：拖完曲线没转，半径变了，定点也被甩开）。
     */
    it("does not let an unselected curve's handles swallow the pointer on its own outline", () => {
      const onOutline = { x: 3, y: 0 }
      // 未选中：圆周上那一点应当落到曲线本体（= 绕定点转），不是半径手柄。
      expect(getDragHandle(placed, onOutline, 0.35, target, false)).toBe("body")
      // 选中：同一个点就是半径手柄，可以改半径。
      expect(getDragHandle(placed, onOutline, 0.35, target, true)).toBe("radius")
      // 缺省（旧调用方不传 selected）保持原行为：按选中处理。
      expect(getDragHandle(placed, onOutline, 0.35, target)).toBe("radius")
    })

    it("keeps the radius handle on the base geometry and adds no separate rotate handle", () => {
      const handles = primitiveHandlePoints(placed, target)
      // 圆不再单独给旋转手柄：拖圆本身就是绕定点转（见下一条）。半径手柄仍按**基准**几何摆放。
      expect(handles.map((entry) => entry.handle)).toEqual(["radius"])
      // 半径手柄按基准圆心 (0,0) 摆 → (3,0)，而不是按转过之后的圆心 (3,-3) 摆 → (6,-3)。
      expect(handles[0].point).toEqual({ x: 3, y: 0 })
    })

    it("turns the curve when its body is dragged, without moving the fixed point", () => {
      // 拖圆本体就是"绕定点转"：所以手柄解析出来是 `body`，动作是更新转角而不是平移。
      expect(getDragHandle(placed, { x: 3, y: -3 }, 0.35, target)).toBe("body")
      const action = createDragAction(placed, "body", { x: 3, y: -3 }, { x: 6, y: 0 }, { ...target, pivotPrimitiveId: "p1" })
      expect(action?.kind).toBe("update")
      if (action?.kind !== "update") throw new Error("expected an update")
      // 定点 (3,0)：指针从 -90°（正下方）转到 0°（正右方），差值 +π/2。
      // 新转角 = 起始 π/2 + π/2 = π。按 mod 2π 同余比较，避免把一个正确的角判成错。
      const turned = (action.patch.rotation ?? 0) - Math.PI / 2
      expect(Math.cos(turned)).toBeCloseTo(Math.cos(Math.PI / 2), 9)
      expect(Math.sin(turned)).toBeCloseTo(Math.sin(Math.PI / 2), 9)
      // 定点没被改写：它还是原来那个坐标。
      expect(action.patch.rotationAbout).toEqual({
        pivot: { kind: "coordinate", x: 3, y: 0 },
        angle: action.patch.rotation,
        baseCenter: { x: 0, y: 0 }
      })
    })

    /**
     * 定点是**固定坐标**的曲线：拖本体是**整体平移**——定点与基准中心一起搬，
     * 于是"绕这个定点转了 angle"在平移前后完全一致。
     * （定点是**点图元**的动圆才走"拖本体即转动"，见下一条。）
     */
    it("carries the fixed point and base centre when the curve body is moved", () => {
      const action = createDragAction(placed, "body", { x: 3, y: -3 }, { x: 6, y: 0 }, target)
      expect(action?.kind).toBe("update")
      if (action?.kind !== "update") throw new Error("expected an update")
      // delta = (3, 3)：定点 (3,0)→(6,3)，基准中心 (0,0)→(3,3)；转角不变。
      expect(action.patch.rotationAbout).toEqual({
        pivot: { kind: "coordinate", x: 6, y: 3 },
        angle: Math.PI / 2,
        baseCenter: { x: 3, y: 3 }
      })
      expect(action.patch.rotation).toBeCloseTo(Math.PI / 2, 9)
    })

    it("keeps the fixed point on the curve when the radius is dragged", () => {
      const action = createDragAction(placed, "radius", { x: 3, y: 0 }, { x: 5, y: 0 }, target)
      expect(action?.kind).toBe("update")
      if (action?.kind !== "update") throw new Error("expected an update")
      expect(action.patch.radius).toBeCloseTo(5, 9)
      // 基准圆心从 (0,0) 沿同方向推到离定点恰好 5：(3,0) + 5·(-1,0) = (-2,0)。
      expect(action.patch.rotationAbout).toEqual({
        pivot: { kind: "coordinate", x: 3, y: 0 },
        angle: Math.PI / 2,
        baseCenter: { x: -2, y: 0 }
      })
    })

    /** 定点是点图元（"动圆"）时不能改写它的位置：拖圆本体改的是转角，定点保持原样。 */
    it("only updates the angle when the fixed point is a point primitive", () => {
      const withPointPivot = {
        ...placed,
        rotationAbout: { pivot: { kind: "primitive" as const, primitiveId: "p1" }, angle: Math.PI / 2, baseCenter: { x: 0, y: 0 } }
      }
      // 拖本体：点图元定点不动，只把转角换成"指针绕定点转过的角"。
      const action = createDragAction(withPointPivot, "body", { x: 3, y: -3 }, { x: 3, y: -3 }, { ...target, pivotPrimitiveId: "p1" })
      expect(action?.kind).toBe("update")
      if (action?.kind !== "update") throw new Error("expected an update")
      expect(action.patch.rotationAbout).toEqual({
        pivot: { kind: "primitive", primitiveId: "p1" },
        angle: Math.PI / 2,
        baseCenter: { x: 0, y: 0 }
      })
    })
  })
})
