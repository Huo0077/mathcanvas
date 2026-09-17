import { describe, expect, it } from "vitest"

import type { PrimitiveSpec } from "@draw/dsl"
import { placedConic } from "@draw/geometry-kernel"

import {
  anchoredCurve,
  anchorPointFor,
  baseCenterOf,
  dragRotationAngle,
  isRotatableCurve,
  placementPatch,
  placementPivot,
  rotationDegrees,
  rotationHandlePoint
} from "./curveRotation"

const circle = (overrides: Partial<Extract<PrimitiveSpec, { type: "circle" }>> = {}) =>
  ({ id: "c", type: "circle" as const, center: { x: 0, y: 0 }, radius: 3, ...overrides })

const ellipse = (overrides: Partial<Extract<PrimitiveSpec, { type: "ellipse" }>> = {}) =>
  ({ id: "e", type: "ellipse" as const, center: { x: 0, y: 0 }, radiusX: 4, radiusY: 2, ...overrides })

describe("rotation about a fixed point in the planar view", () => {
  it("only offers the capability on closed curves", () => {
    expect(isRotatableCurve(circle())).toBe(true)
    expect(isRotatableCurve(ellipse())).toBe(true)
    expect(isRotatableCurve({ id: "a", type: "arc", center: { x: 0, y: 0 }, radius: 2, startAngle: 0, endAngle: 1 })).toBe(false)
    expect(isRotatableCurve({ id: "h", type: "hyperbola", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2, axis: "x" })).toBe(false)
  })

  /**
   * 定点必须在曲线上：点选一个近处的点也要被拉到曲线上，
   * 否则存下来的就是"曲线并不真的过这个定点"。
   */
  it("pulls a chosen point onto the curve so the fixed point really lies on it", () => {
    const onCircle = anchorPointFor(circle(), { x: 5, y: 0 })
    expect(onCircle?.x).toBeCloseTo(3, 9)
    expect(onCircle?.y).toBeCloseTo(0, 9)

    const offCircle = anchorPointFor(circle(), { x: 2, y: 2 })
    expect(Math.hypot(offCircle!.x, offCircle!.y)).toBeCloseTo(3, 9)
    // 方向保持：投影落在原方向的那条射线上。
    expect(offCircle!.x).toBeCloseTo(offCircle!.y, 9)

    // 椭圆的投影落在椭圆上（隐式方程等于 1）。
    const onEllipse = anchorPointFor(ellipse(), { x: 5, y: 5 })!
    expect((onEllipse.x / 4) ** 2 + (onEllipse.y / 2) ** 2).toBeCloseTo(1, 9)

    // 曲线中心处没有方向可言，不能当定点。
    expect(anchorPointFor(circle(), { x: 0, y: 0 })).toBeNull()
    expect(anchorPointFor(ellipse(), { x: 0, y: 0 })).toBeNull()
  })

  /** 定型之后：基准中心摆到"离定点恰好一个半轴"，因此放置出来的曲线确实过定点。 */
  it("anchors the curve so the placed result passes through the fixed point", () => {
    const anchored = anchoredCurve(circle(), { x: 5, y: 0 })!
    expect(anchored.pivot.x).toBeCloseTo(3, 9)
    expect(anchored.rotationAbout.baseCenter.x).toBeCloseTo(0, 9)
    // 定型后的曲线本体：中心就是基准中心，角为 0（基准与结果重合）。
    expect(anchored.curve.center.x).toBeCloseTo(0, 9)
    expect(anchored.curve.center.y).toBeCloseTo(0, 9)

    const placed = placedConic(circle({ rotationAbout: anchored.rotationAbout }), {
      pivot: anchored.pivot,
      angle: Math.PI / 2,
      baseCenter: anchored.rotationAbout.baseCenter
    })
    expect(Math.hypot(placed.center.x - 3, placed.center.y)).toBeCloseTo(3, 9)
  })

  it("anchors an ellipse so its fixed point lands on the curve", () => {
    const anchored = anchoredCurve(ellipse(), { x: 0, y: 5 })!
    expect(anchored.pivot.y).toBeCloseTo(2, 9)
    // 基准中心离定点恰好一个长半轴。
    expect(Math.hypot(anchored.rotationAbout.baseCenter.x - anchored.pivot.x, anchored.rotationAbout.baseCenter.y - anchored.pivot.y)).toBeCloseTo(4, 9)

    const placed = placedConic(ellipse({ rotationAbout: anchored.rotationAbout }), {
      pivot: anchored.pivot,
      angle: 0.7,
      baseCenter: anchored.rotationAbout.baseCenter
    })
    // 定点在放置后的椭圆上：隐式方程（转回去算）等于 1。
    const rotation = placed.rotation ?? 0
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    const dx = anchored.pivot.x - placed.center.x
    const dy = anchored.pivot.y - placed.center.y
    const localX = dx * cos + dy * sin
    const localY = -dx * sin + dy * cos
    expect((localX / 4) ** 2 + (localY / 2) ** 2).toBeCloseTo(1, 9)
  })

  it("keeps the base centre when a placement is already in effect", () => {
    const raw = circle()
    expect(baseCenterOf(raw)).toEqual({ x: 0, y: 0 })

    const placed = circle({
      rotationAbout: { pivot: { kind: "coordinate", x: 3, y: 0 }, angle: Math.PI / 2, baseCenter: { x: 0, y: 0 } }
    })
    // 已经放置过的曲线：`center` 是转过之后的位置，基准要从 `rotationAbout` 里取，
    // 否则下一次拖动会把"转过的位置"当基准，曲线越转越偏。
    expect(baseCenterOf(placed)).toEqual({ x: 0, y: 0 })

    const patch = placementPatch(placed, { x: 3, y: 0 }, Math.PI)
    expect(patch.rotationAbout.baseCenter).toEqual({ x: 0, y: 0 })
    expect(patch.rotationAbout.angle).toBeCloseTo(Math.PI, 12)
    expect(patch.rotation).toBeCloseTo(Math.PI, 12)
  })

  it("resolves the fixed point, including when it is a point primitive", () => {
    expect(placementPivot(circle(), () => undefined)).toBeNull()

    const byCoordinate = circle({ rotationAbout: { pivot: { kind: "coordinate", x: 3, y: 0 }, angle: 0, baseCenter: { x: 0, y: 0 } } })
    expect(placementPivot(byCoordinate, () => undefined)).toEqual({ x: 3, y: 0 })

    const byPoint = circle({ rotationAbout: { pivot: { kind: "primitive", primitiveId: "p1" }, angle: 0, baseCenter: { x: 0, y: 0 } } })
    expect(placementPivot(byPoint, (id) => id === "p1" ? { id: "p1", type: "point", x: 1, y: 2 } : undefined)).toEqual({ x: 1, y: 2 })
    // 引用悬空时不编造位置，界面按"没有定点"处理。
    expect(placementPivot(byPoint, () => undefined)).toBeNull()
  })

  /** 拖动用**差值**算角度：按下手柄的那一下不能跳。 */
  it("turns by how far the pointer moved around the fixed point", () => {
    // 手柄从 (3,1) 拖到 (-1,0)：相对定点 (3,0) 转了 90°。
    const angle = dragRotationAngle({ x: 3, y: 0 }, { x: 3, y: 1 }, { x: -1, y: 0 }, 0)
    expect(angle).toBeCloseTo(Math.PI / 2, 9)
    // 从已有转角继续累加。
    expect(dragRotationAngle({ x: 3, y: 0 }, { x: 3, y: 1 }, { x: -1, y: 0 }, Math.PI)).toBeCloseTo(Math.PI * 1.5, 9)
    // 指针没动，转角就不变（按下不动不会让曲线跳）。
    expect(dragRotationAngle({ x: 3, y: 0 }, { x: 4, y: 2 }, { x: 4, y: 2 }, 0.4)).toBeCloseTo(0.4, 12)
  })

  it("puts the rotation handle outside the curve, away from the fixed point", () => {
    // 定点 (3,0) 在圆上、圆心在原点：手柄从定点朝曲线内侧摆出一个半径加一点。
    const near = rotationHandlePoint(circle(), { x: 3, y: 0 })
    expect(near.x).toBeCloseTo(-0.6, 9)
    expect(near.y).toBeCloseTo(0, 9)

    // 定点在圆心时没有方向可言：退化情况也要给出有限坐标，不能是 NaN。
    const degenerate = rotationHandlePoint(circle(), { x: 0, y: 0 })
    expect(degenerate.x).toBeCloseTo(3.6, 9)
    expect(degenerate.y).toBeCloseTo(0, 9)

    // 椭圆按长半轴摆：定点 (0,2) 在椭圆上，手柄落在 (0, 2-4.6)。
    const onEllipse = rotationHandlePoint(ellipse(), { x: 0, y: 2 })
    expect(onEllipse.x).toBeCloseTo(0, 9)
    expect(onEllipse.y).toBeCloseTo(2 - 4.6, 9)
  })

  it("reports the turn as degrees in [0, 360)", () => {
    expect(rotationDegrees(0)).toBeCloseTo(0, 9)
    expect(rotationDegrees(Math.PI / 2)).toBeCloseTo(90, 9)
    expect(rotationDegrees(-Math.PI / 2)).toBeCloseTo(270, 9)
    expect(rotationDegrees(3 * Math.PI)).toBeCloseTo(180, 9)
  })
})
