import { describe, expect, it } from "vitest"

import {
  baseConic,
  conicPivotAngle,
  placedConic,
  sampleEllipse,
  sampleHyperbola,
  sampleHyperbolaBranches,
  sampleParabola,
  type PlaceableConic
} from "./conics"

describe("conic sampling", () => {
  it("samples finite parabola, ellipse, and hyperbola points", () => {
    expect(sampleParabola({ id: "p", type: "parabola", vertex: { x: 0, y: 0 }, focalParameter: 2, axis: "y" }, [-2, 2], 8)).toHaveLength(9)
    expect(sampleEllipse({ id: "e", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2 }, 16)).toHaveLength(17)
    expect(sampleHyperbola({ id: "h", type: "hyperbola", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2, axis: "x" }, [-3, 3], 8)).toHaveLength(9)
  })

  it("rotates sampled conics around their vertex or center", () => {
    const [ellipsePoint] = sampleEllipse({ id: "e", type: "ellipse", center: { x: 1, y: 2 }, radiusX: 3, radiusY: 2, rotation: Math.PI / 2 }, 4)
    const [parabolaPoint] = sampleParabola({ id: "p", type: "parabola", vertex: { x: 1, y: 2 }, focalParameter: 2, axis: "x", rotation: Math.PI / 2 }, [0, 0], 1)

    expect(ellipsePoint.x).toBeCloseTo(1)
    expect(ellipsePoint.y).toBeCloseTo(5)
    expect(parabolaPoint.x).toBeCloseTo(1)
    expect(parabolaPoint.y).toBeCloseTo(2)
  })

  it("keeps both hyperbola branches on the rotated local axis", () => {
    const [first, second] = sampleHyperbolaBranches({ id: "h", type: "hyperbola", center: { x: 1, y: 2 }, radiusX: 3, radiusY: 2, axis: "x", rotation: Math.PI / 4 }, [2, 2], 1)

    expect(second[0].x).toBeCloseTo(2 - first[0].x)
    expect(second[0].y).toBeCloseTo(4 - first[0].y)
  })
})

/**
 * 绕定点旋转的几何：pivot 是那个**定点**，angle 是绕它的转角，baseCenter 是基准圆心。
 *
 * 这一组用例逐条钉住两件事：①"曲线始终过定点"——转角取多少都不能让定点掉出曲线
 * （掉了就不再是"过定点的旋转曲线"，用户的原话）；②**幂等**——重算从基准出发，
 * 反复重算不能累积旋转（真实缺陷：只烧结果的话，第二次重算会把圆心推离定点）。
 */
describe("closed curve rotating about a fixed point", () => {
  const circle: PlaceableConic = { id: "c", type: "circle", center: { x: 0, y: 0 }, radius: 3 }
  // 定点 (3,0) 落在圆上，基准圆心就是原点。
  const anchor = (angle: number) => ({ pivot: { x: 3, y: 0 }, angle, baseCenter: { x: 0, y: 0 } })

  it("keeps the circle passing through the fixed point at every angle", () => {
    for (let step = 0; step < 12; step += 1) {
      const placed = placedConic(circle, anchor((step * Math.PI) / 6))
      // 定点落在圆上：到新圆心的距离恰好是半径。
      expect(Math.hypot(placed.center.x - 3, placed.center.y)).toBeCloseTo(3, 12)
    }
  })

  it("orbits the centre around the fixed point instead of shrinking the circle", () => {
    const placed = placedConic(circle, anchor(Math.PI / 2))
    expect(placed.center.x).toBeCloseTo(3, 12)
    expect(placed.center.y).toBeCloseTo(-3, 12)
    expect(placed.radius).toBe(3)
    // 绕一整圈回到原处，不累积漂移。
    const full = placedConic(circle, anchor(2 * Math.PI))
    expect(full.center.x).toBeCloseTo(0, 12)
    expect(full.center.y).toBeCloseTo(0, 12)
  })

  /**
   * 幂等：把上一次的结果当成新的输入再算一遍，必须逐位不变。
   * 这条是真实缺陷的回归保护——第一版把结果烧进 `center` 且没有基准，
   * 第二次重算时圆心从 (1.5,-2.6) 跳到 (4.5,-2.6)，曲线离开定点。
   */
  it("is idempotent when recomputed from its own output", () => {
    const once = placedConic(circle, anchor(Math.PI / 3))
    const twice = placedConic({ ...circle, ...once }, anchor(Math.PI / 3))

    expect(twice.center.x).toBeCloseTo(once.center.x, 12)
    expect(twice.center.y).toBeCloseTo(once.center.y, 12)
    expect(Math.hypot(twice.center.x - 3, twice.center.y)).toBeCloseTo(3, 12)
  })

  it("restores the base geometry when the placement is removed", () => {
    const placed = placedConic(circle, anchor(Math.PI / 2))
    const restored = baseConic({ ...circle, ...placed }, anchor(Math.PI / 2))

    expect(restored.center.x).toBeCloseTo(0, 12)
    expect(restored.center.y).toBeCloseTo(0, 12)
    expect(restored.rotation).toBeCloseTo(0, 12)
  })

  it("leaves a curve without a placement exactly where it was", () => {
    expect(placedConic(circle)).toEqual(circle)
    expect(baseConic(circle)).toEqual(circle)
    const ellipse: PlaceableConic = { id: "e", type: "ellipse", center: { x: 1, y: 1 }, radiusX: 4, radiusY: 2, rotation: 0.3 }
    expect(placedConic(ellipse)).toEqual(ellipse)
  })

  it("reports the angle that puts the fixed point on the curve", () => {
    expect(conicPivotAngle(circle, { x: 3, y: 0 })).toBeCloseTo(0, 12)
    expect(conicPivotAngle(circle, { x: -3, y: 0 })).toBeCloseTo(Math.PI, 12)
    // 椭圆上定点的自然角就是"从当前 (radiusX, radiusY) 基准起算的角"。
    const ellipse: PlaceableConic = { id: "e", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 4, radiusY: 2 }
    expect(conicPivotAngle(ellipse, { x: 4, y: 0 })).toBeCloseTo(0, 12)
    expect(conicPivotAngle(ellipse, { x: 0, y: 2 })).toBeCloseTo(Math.PI / 2, 12)
    const tilted: PlaceableConic = { ...ellipse, rotation: Math.PI / 3 }
    const onAxis = { x: 4 * Math.cos(Math.PI / 3), y: 4 * Math.sin(Math.PI / 3) }
    expect(conicPivotAngle(tilted, onAxis)).toBeCloseTo(0, 12)
  })

  it("keeps the ellipse's fixed point on the curve while its orientation turns", () => {
    const ellipse: PlaceableConic = { id: "e", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 4, radiusY: 2 }
    const atZero = conicPivotAngle(ellipse, { x: 0, y: 2 })
    const placed = placedConic(ellipse, { pivot: { x: 0, y: 2 }, angle: Math.PI / 3, baseCenter: { x: 0, y: 0 } })

    // 定点在曲线上的参数被转角整体搬运，因此"过定点"这条性质只与 pivot 有关。
    expect(atZero).toBeCloseTo(Math.PI / 2, 12)
    expect(placed.rotation).toBeCloseTo(Math.PI / 3, 12)
    // 定点确实在放置后的椭圆上。
    const onCurve = sampleEllipse(placed, 360).some((candidate) => Math.hypot(candidate.x, candidate.y - 2) < 1e-6)
    expect(onCurve).toBe(true)
  })

  it("rotates in place when the fixed point is the curve's own centre", () => {
    const ellipse: PlaceableConic = { id: "e", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 4, radiusY: 2, rotation: 0.2 }
    const placed = placedConic(ellipse, { pivot: { x: 0, y: 0 }, angle: 0.5, baseCenter: { x: 0, y: 0 } })
    expect(placed.center.x).toBeCloseTo(0, 12)
    expect(placed.center.y).toBeCloseTo(0, 12)
    expect(placed.rotation).toBeCloseTo(0.7, 12)
  })

  /**
   * 两次半圈等于一次整圈：`angle` 是**累积转角**（拖动时把它加上去），
   * 基准始终是 `baseCenter`，所以两段转动可以直接相加。
   */
  it("composes consecutive turns into one", () => {
    const start = { pivot: { x: 3, y: 0 }, angle: Math.PI / 2, baseCenter: { x: 0, y: 0 } }
    const half = placedConic(circle, start)
    const second = placedConic({ ...circle, ...half }, { ...start, angle: start.angle + Math.PI / 2 })
    const once = placedConic(circle, { ...start, angle: Math.PI })

    expect(second.center.x).toBeCloseTo(once.center.x, 12)
    expect(second.center.y).toBeCloseTo(once.center.y, 12)
    expect(second.center.y).toBeCloseTo(0, 12)
  })
})
