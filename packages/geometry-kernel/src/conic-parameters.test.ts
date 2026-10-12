import { describe, expect, it } from "vitest"

import type { Coordinate, EllipsePrimitive, HyperbolaPrimitive, ParabolaPrimitive } from "@draw/dsl"

import {
  conicFromFocusDirectrixAndEccentricity,
  ellipseFromFociAndPoint,
  hyperbolaFromFociAndPoint,
  parabolaFromFocusAndDirectrix
} from "./conic-parameters"
import { sampleEllipse, sampleHyperbolaBranches, sampleParabola } from "./conics"

/**
 * **由条件反求圆锥曲线的参数**（Task 14）。
 *
 * ## 为什么这是"真实缺的"那一块
 *
 * 调研 §2.2 归出来的子型 C1 就是「焦点/准线/离心率 ⇒ 参数反求」，而仓里此前**只有正向计算**
 * （给了 a、b、轴再算别的）。真题里更常见的是反过来的：给两个焦点与曲线上一点、给焦点与准线、
 * 给离心率与准线 —— 这些都得先把 `a`、`b`、轴**解出来**才能画。
 *
 * ## 判据怎么算
 *
 * 一律**回到定义**，而且是在**采样出来的曲线上**逐点复核（不是拿反求过程自己的中间量自证）：
 * - 椭圆：`|PF₁| + |PF₂| = 2a`；
 * - 双曲线：`| |PF₁| − |PF₂| | = 2a`（实轴在焦点连线上）；
 * - 抛物线/统一式：`|PF| / dist(P, L) = e`（`e = 1` 就是抛物线）。
 */
describe("由条件反求圆锥曲线参数", () => {
  const distance = (first: Coordinate, second: Coordinate) => Math.hypot(first.x - second.x, first.y - second.y)
  /** 点到直线（过 `a`、`b`）的距离。 */
  const distanceToLine = (point: Coordinate, line: { a: Coordinate; b: Coordinate }) => {
    const dx = line.b.x - line.a.x
    const dy = line.b.y - line.a.y
    const length = Math.hypot(dx, dy)
    return Math.abs(dy * (point.x - line.a.x) - dx * (point.y - line.a.y)) / length
  }

  describe("抛物线：焦点 + 准线", () => {
    it("F(1, 0)、准线 x = −1 ⇒ 顶点在原点、p = 2、开口沿 +x", () => {
      const result = parabolaFromFocusAndDirectrix({ x: 1, y: 0 }, { a: { x: -1, y: -5 }, b: { x: -1, y: 5 } })
      expect(result.kind).toBe("solved")
      if (result.kind !== "solved") throw new Error("expected a solution")
      const parabola = result.conic
      expect(parabola.axis).toBe("x")
      expect(parabola.rotation ?? 0).toBeCloseTo(0, 9)
      expect(parabola.vertex.x).toBeCloseTo(0, 9)
      expect(parabola.vertex.y).toBeCloseTo(0, 9)
      /** 焦准距就是 `|FL|`（不是它的一半 —— 这一点与"题面 `y² = 4x` 里的 4 是 `2p`"是两个坑）。 */
      expect(parabola.focalParameter).toBeCloseTo(2, 9)
      // **回到定义**：采样出来的每个点到焦点的距离都等于它到准线的距离。
      for (const point of sampleParabola(parabola, [-4, 4], 24)) {
        expect(distance(point, { x: 1, y: 0 })).toBeCloseTo(distanceToLine(point, { a: { x: -1, y: -5 }, b: { x: -1, y: 5 } }), 9)
      }
      expect(result.sampledResidual).toBeLessThan(1e-9)
    })

    it("F(0, 1)、准线 y = −1 ⇒ 轴是 y（不是 x + 旋转）", () => {
      const result = parabolaFromFocusAndDirectrix({ x: 0, y: 1 }, { a: { x: -5, y: -1 }, b: { x: 5, y: -1 } })
      expect(result.kind).toBe("solved")
      if (result.kind !== "solved") throw new Error("expected a solution")
      // 轴对齐时就该报轴对齐：报成 `axis: "x" + rotation: π/2` 会让核验器比轴那一条判成"另一条曲线"。
      expect(result.conic.axis).toBe("y")
      expect(result.conic.rotation ?? 0).toBeCloseTo(0, 9)
      expect(result.conic.focalParameter).toBeCloseTo(2, 9)
    })

    it("斜的准线：F(1, 1)、准线 x + y = 0 ⇒ 开口沿 (1,1)、p = √2", () => {
      const directrix = { a: { x: 0, y: 0 }, b: { x: 1, y: -1 } }
      const result = parabolaFromFocusAndDirectrix({ x: 1, y: 1 }, directrix)
      expect(result.kind).toBe("solved")
      if (result.kind !== "solved") throw new Error("expected a solution")
      expect(result.conic.focalParameter).toBeCloseTo(Math.SQRT2, 9)
      expect(result.conic.rotation ?? 0).toBeCloseTo(Math.PI / 4, 9)
      for (const point of sampleParabola(result.conic, [-4, 4], 24)) {
        expect(distance(point, { x: 1, y: 1 })).toBeCloseTo(distanceToLine(point, directrix), 9)
      }
    })

    it("焦点落在准线上 ⇒ contradictory，不硬造一条抛物线", () => {
      const result = parabolaFromFocusAndDirectrix({ x: 1, y: 0 }, { a: { x: 1, y: -5 }, b: { x: 1, y: 5 } })
      expect(result.kind).toBe("contradictory")
    })
  })

  describe("椭圆：两个焦点 + 曲线上一点", () => {
    it("焦点 (±1, 0)、点 (2, 0) ⇒ a = 2、b = √3、e = 0.5", () => {
      const result = ellipseFromFociAndPoint([{ x: -1, y: 0 }, { x: 1, y: 0 }], { x: 2, y: 0 })
      expect(result.kind).toBe("solved")
      if (result.kind !== "solved") throw new Error("expected a solution")
      const ellipse = result.conic
      expect(ellipse.radiusX).toBeCloseTo(2, 9)
      expect(ellipse.radiusY).toBeCloseTo(Math.sqrt(3), 9)
      expect(ellipse.rotation ?? 0).toBeCloseTo(0, 9)
      expect(result.eccentricity).toBeCloseTo(0.5, 9)
      // **回到定义**：采样点上 `|PF₁| + |PF₂| = 2a`。
      const foci = [{ x: -1, y: 0 }, { x: 1, y: 0 }] as const
      for (const point of sampleEllipse(ellipse, 32)) {
        expect(distance(point, foci[0]) + distance(point, foci[1])).toBeCloseTo(4, 9)
      }
      expect(result.sampledResidual).toBeLessThan(1e-9)
    })

    it("焦点在 y 轴上 ⇒ 长轴沿 y（用 rotation 表达）", () => {
      const result = ellipseFromFociAndPoint([{ x: 0, y: -1 }, { x: 0, y: 1 }], { x: 0, y: 2 })
      expect(result.kind).toBe("solved")
      if (result.kind !== "solved") throw new Error("expected a solution")
      expect(result.conic.radiusX).toBeCloseTo(2, 9)
      expect(result.conic.radiusY).toBeCloseTo(Math.sqrt(3), 9)
      expect(Math.abs(result.conic.rotation ?? 0)).toBeCloseTo(Math.PI / 2, 9)
    })

    it("点落在两个焦点之间（2a ≤ 2c）⇒ contradictory，不给一个退化的椭圆", () => {
      expect(ellipseFromFociAndPoint([{ x: -1, y: 0 }, { x: 1, y: 0 }], { x: 0.5, y: 0 }).kind).toBe("contradictory")
    })

    it("两个焦点重合 ⇒ unsupported（定义不出一条椭圆）", () => {
      expect(ellipseFromFociAndPoint([{ x: 0, y: 0 }, { x: 0, y: 0 }], { x: 1, y: 0 }).kind).toBe("unsupported")
    })
  })

  describe("双曲线：两个焦点 + 曲线上一点", () => {
    it("焦点 (±5, 0)、点 (3, 0) ⇒ a = 3、b = 4、实轴沿 x、e = 5/3", () => {
      const result = hyperbolaFromFociAndPoint([{ x: -5, y: 0 }, { x: 5, y: 0 }], { x: 3, y: 0 })
      expect(result.kind).toBe("solved")
      if (result.kind !== "solved") throw new Error("expected a solution")
      const hyperbola = result.conic
      expect(hyperbola.axis).toBe("x")
      expect(hyperbola.radiusX).toBeCloseTo(3, 9)
      expect(hyperbola.radiusY).toBeCloseTo(4, 9)
      expect(result.eccentricity).toBeCloseTo(5 / 3, 9)
      // **回到定义**：采样点上 `| |PF₁| − |PF₂| | = 2a = 6`。
      const foci = [{ x: -5, y: 0 }, { x: 5, y: 0 }] as const
      for (const point of sampleHyperbolaBranches(hyperbola, [3, 7], 16).flat()) {
        expect(Math.abs(distance(point, foci[0]) - distance(point, foci[1]))).toBeCloseTo(6, 9)
      }
      expect(result.sampledResidual).toBeLessThan(1e-9)
    })

    it("焦点在 y 轴上 ⇒ 实轴沿 y（核验器比的就是这个字段）", () => {
      const result = hyperbolaFromFociAndPoint([{ x: 0, y: -5 }, { x: 0, y: 5 }], { x: 0, y: 3 })
      expect(result.kind).toBe("solved")
      if (result.kind !== "solved") throw new Error("expected a solution")
      expect(result.conic.axis).toBe("y")
      expect(result.conic.radiusX).toBeCloseTo(4, 9)
      expect(result.conic.radiusY).toBeCloseTo(3, 9)
    })

    it("点给出的 2a ≥ 2c ⇒ contradictory", () => {
      expect(hyperbolaFromFociAndPoint([{ x: -5, y: 0 }, { x: 5, y: 0 }], { x: 0, y: 0 }).kind).toBe("contradictory")
    })
  })

  describe("统一式：焦点 + 准线 + 离心率", () => {
    const focus = { x: 1, y: 0 }
    const directrix = { a: { x: -1, y: -5 }, b: { x: -1, y: 5 } }
    /** 采样点上逐点复核 `|PF| / dist(P, L) = e`。 */
    const checkRatio = (conic: EllipsePrimitive | HyperbolaPrimitive | ParabolaPrimitive, e: number) => {
      const sampled = conic.type === "parabola"
        ? sampleParabola(conic, [-6, 6], 24)
        : conic.type === "ellipse"
          ? sampleEllipse(conic, 32)
          : sampleHyperbolaBranches(conic, [1, 9], 16).flat()
      expect(sampled.length).toBeGreaterThan(0)
      for (const point of sampled) {
        expect(distance(point, focus) / distanceToLine(point, directrix)).toBeCloseTo(e, 8)
      }
    }

    it("e = 1 ⇒ 抛物线（与上面那条焦点+准线的结果一致）", () => {
      const result = conicFromFocusDirectrixAndEccentricity(focus, directrix, 1)
      expect(result.kind).toBe("solved")
      if (result.kind !== "solved") throw new Error("expected a solution")
      expect(result.conic.type).toBe("parabola")
      expect(result.eccentricity).toBeCloseTo(1, 12)
      checkRatio(result.conic, 1)
    })

    it("e = 0.5 ⇒ 椭圆，且焦点确实落在给定的那个点上", () => {
      const result = conicFromFocusDirectrixAndEccentricity(focus, directrix, 0.5)
      expect(result.kind).toBe("solved")
      if (result.kind !== "solved") throw new Error("expected a solution")
      expect(result.conic.type).toBe("ellipse")
      const ellipse = result.conic as EllipsePrimitive
      expect(ellipse.radiusX).toBeCloseTo(4 / 3, 9)
      expect(ellipse.radiusY).toBeCloseTo((4 / 3) * Math.sqrt(0.75), 9)
      // 长轴沿焦点连线的法向（这里是 x），中心离准线 `a/e`。
      expect(ellipse.center.x).toBeCloseTo(-1 + 4 / 3 / 0.5, 9)
      checkRatio(ellipse, 0.5)
    })

    it("e = 2 ⇒ 双曲线，实轴沿焦点—准线法向", () => {
      const result = conicFromFocusDirectrixAndEccentricity(focus, directrix, 2)
      expect(result.kind).toBe("solved")
      if (result.kind !== "solved") throw new Error("expected a solution")
      expect(result.conic.type).toBe("hyperbola")
      const hyperbola = result.conic as HyperbolaPrimitive
      expect(hyperbola.radiusX).toBeCloseTo(4 / 3, 9)
      expect(hyperbola.radiusY).toBeCloseTo((4 / 3) * Math.sqrt(3), 9)
      // 中心落在准线的**另一侧**（负 x），这正是 e > 1 与 e < 1 的分野。
      expect(hyperbola.center.x).toBeLessThan(-1)
      checkRatio(hyperbola, 2)
    })

    it("离心率非正 ⇒ unsupported（离心率必须为正）", () => {
      expect(conicFromFocusDirectrixAndEccentricity(focus, directrix, 0).kind).toBe("unsupported")
      expect(conicFromFocusDirectrixAndEccentricity(focus, directrix, -1).kind).toBe("unsupported")
    })
  })
})
