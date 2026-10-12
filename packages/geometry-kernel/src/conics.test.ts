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

/**
 * **双曲线的 `axis` 是"实轴往哪边走"**（Task 14，2026-10-12）。
 *
 * 判据来自题面侧的唯一声明 —— `diagramObligations.ts:150` 的注释原文：
 * 「`axis` 由**写法**决定：`x²/… − y²/… = 1` 的实轴沿 x」，两条写法各自映射成
 * `hyperbolaAxes(分母, 分母, "x" | "y")`；核验文案（`diagramVerification.ts:361` 的
 * `实轴沿 ${axis} 轴`）与焦点 / 顶点标记（`GraphicsView.tsx:79`、`annotations.ts:18`）
 * 也都把 `axis` 当**实轴**用。所以：
 *
 * - `axis: "x"` ⇒ 曲线是 `x'²/radiusX² − y'²/radiusY² = 1`（半实轴 = `radiusX`，顶点在 `(±radiusX, 0)`）；
 * - `axis: "y"` ⇒ 曲线是 `y'²/radiusY² − x'²/radiusX² = 1`（半实轴 = `radiusY`，顶点在 `(0, ±radiusY)`）。
 *
 * 下面这几条**自己用普通算术算**，不读内核的隐式形式 —— 拿 `conicValue` 去验
 * `sampleHyperbola` 是"用系统自己的判断证明系统自己"（那两处本来就一致，一起错也能自洽）。
 */
describe("双曲线的 axis 语义（实轴，不是参数方向）", () => {
  const hyperbola = (axis: "x" | "y") => ({ id: "h", type: "hyperbola" as const, center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2, axis })

  it("采样点必须落在 axis 声明的那条双曲线上", () => {
    for (const axis of ["x", "y"] as const) {
      const primitive = hyperbola(axis)
      const a = primitive.radiusX
      const b = primitive.radiusY
      const branches = [sampleHyperbola(primitive, [0, 6], 48), ...sampleHyperbolaBranches(primitive, [0, 6], 48)]
      let counted = 0
      for (const branch of branches) {
        for (const point of branch) {
          // axis=x ⇒ x²/a² − y²/b² = 1；axis=y ⇒ y²/b² − x²/a² = 1。
          const value = axis === "x" ? point.x * point.x / (a * a) - point.y * point.y / (b * b) : point.y * point.y / (b * b) - point.x * point.x / (a * a)
          expect(value, `axis=${axis} 的点 (${point.x}, ${point.y}) 不在这条双曲线上`).toBeCloseTo(1, 6)
          counted += 1
        }
      }
      expect(counted, `axis=${axis} 一个采样点都没有`).toBeGreaterThan(0)
    }
  })

  it("顶点落在实轴上：axis=x ⇒ (±radiusX, 0)，axis=y ⇒ (0, ±radiusY)", () => {
    for (const axis of ["x", "y"] as const) {
      const primitive = hyperbola(axis)
      const points = sampleHyperbolaBranches(primitive, [0, 6], 512).flat()
      const semi = axis === "x" ? primitive.radiusX : primitive.radiusY
      const has = (predicate: (point: { x: number; y: number }) => boolean) => points.some(predicate)
      // **两个**顶点都要在：只要求"有一个"会把"只有一支画出来了"放过去。
      const onAxis = (sign: 1 | -1) => (axis === "x"
        ? (point: { x: number; y: number }) => Math.abs(point.y) < 1e-9 && Math.abs(point.x - sign * semi) < 1e-9
        : (point: { x: number; y: number }) => Math.abs(point.x) < 1e-9 && Math.abs(point.y - sign * semi) < 1e-9)
      expect(has(onAxis(1)), `axis=${axis} 的正向顶点没落在曲线上`).toBe(true)
      expect(has(onAxis(-1)), `axis=${axis} 的负向顶点没落在曲线上`).toBe(true)
      // 而"垂直方向 ± 半虚轴"那些点**不在**曲线上（旧实现在那里给出顶点，正是错的来源）。
      const offCurve = axis === "x" ? { x: 0, y: primitive.radiusY } : { x: primitive.radiusX, y: 0 }
      expect(has((point) => Math.abs(point.x - offCurve.x) < 1e-9 && Math.abs(point.y - offCurve.y) < 1e-9)).toBe(false)
    }
  })
})

describe("conic sampling", () => {
  it("samples finite parabola, ellipse, and hyperbola points", () => {
    expect(sampleParabola({ id: "p", type: "parabola", vertex: { x: 0, y: 0 }, focalParameter: 2, axis: "y" }, [-2, 2], 8)).toHaveLength(9)
    expect(sampleEllipse({ id: "e", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2 }, 16)).toHaveLength(17)
    /**
     * 双曲线的 `domain` 是**实轴那条坐标**的范围，`|坐标| < 半实轴` 的部分不存在
     * （2026-10-12 起；旧实现把参数扫在 x 上，所以 `[-3, 3]` 也"有"点）。这里取 `[0, 6]`：
     * 夹到顶点 3 之后是从 3 扫到 6 的一支 —— 下半支 9 个点 + 上半支 8 个（顶点只算一次）。
     */
    expect(sampleHyperbola({ id: "h", type: "hyperbola", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2, axis: "x" }, [0, 6], 8)).toHaveLength(17)
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
    const [first, second] = sampleHyperbolaBranches({ id: "h", type: "hyperbola", center: { x: 1, y: 2 }, radiusX: 3, radiusY: 2, axis: "x", rotation: Math.PI / 4 }, [3, 5], 1)

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
