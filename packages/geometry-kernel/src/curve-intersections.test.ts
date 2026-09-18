import { describe, expect, it } from "vitest"

import type { LinePrimitive, PolylinePrimitive } from "@draw/dsl"

import { intersectSampledPrimitives, type SampledPrimitive } from "./curve-intersections"
import { intersectPolylineCircleDetailed, intersectPolylineLineDetailed } from "./intersections"

const xAxis: LinePrimitive = { id: "axis", type: "line", a: { x: -8, y: 0 }, b: { x: 8, y: 0 } }

function pointsOf(result: ReturnType<typeof intersectSampledPrimitives>) {
  return result.kind === "points" ? result.points : result.kind === "point" || result.kind === "tangent" ? [result.point] : []
}

describe("sampled curve intersections", () => {
  it("keeps every crossing of a function and a line", () => {
    const sine = { id: "sine", type: "function" as const, expression: "sin(x)", domain: [-7, 7] as [number, number], samples: 256 }

    const points = pointsOf(intersectSampledPrimitives(sine, xAxis))

    // sin(x) = 0 five times inside [-7, 7]; a two-point cap used to drop three of them.
    for (const zero of [-2 * Math.PI, -Math.PI, 0, Math.PI, 2 * Math.PI]) {
      expect(points.some((point) => Math.abs(point.x - zero) < 0.02)).toBe(true)
    }
    expect(points).toHaveLength(5)
  })

  it("keeps every crossing of a function that meets a line four times", () => {
    const quartic = { id: "quartic", type: "function" as const, expression: "x^4 - 5*x^2 + 4", domain: [-4, 4] as [number, number], samples: 256 }

    const points = pointsOf(intersectSampledPrimitives(quartic, xAxis))

    for (const root of [-2, -1, 1, 2]) {
      expect(points.some((point) => Math.abs(point.x - root) < 0.02)).toBe(true)
    }
    expect(points).toHaveLength(4)
  })
})

describe("polyline intersections with an unbounded number of crossings", () => {
  it("keeps three polyline-line crossings", () => {
    const zigzag: PolylinePrimitive = { id: "zigzag", type: "polyline", points: [{ x: -3, y: 1 }, { x: -1, y: -1 }, { x: 1, y: 1 }, { x: 3, y: -1 }] }

    const result = intersectPolylineLineDetailed(zigzag, xAxis)

    expect(result.kind).toBe("points")
    expect(result.kind === "points" ? result.points : []).toHaveLength(3)
  })

  it("keeps three polyline-circle crossings", () => {
    const path: PolylinePrimitive = { id: "path", type: "polyline", points: [{ x: 2, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 2 }, { x: 0, y: -2 }] }

    const result = intersectPolylineCircleDetailed(path, { id: "unit", type: "circle", center: { x: 0, y: 0 }, radius: 1 })

    expect(result.kind).toBe("points")
    expect(result.kind === "points" ? result.points : []).toHaveLength(3)
  })
})

/**
 * 由其它图元引申出来的图元也要能求交（用户口径："由动点引申出来的图元（如切线，动圆）
 * 也需要能够反映和其他图元的交点"）。几何都在下面按坐标写清楚，不靠"看起来对"。
 */
describe("sampled intersections with derived primitives", () => {
  // 圆心 (0,2)、半径 2 ⇒ 在 x=0 上过 (0,0) 与 (0,4)；在 y=2 上过 (−2,2) 与 (2,2)。
  const circle: SampledPrimitive = { id: "c", type: "circle", center: { x: 0, y: 2 }, radius: 2 }
  const xAxisLine: SampledPrimitive = { id: "l", type: "line", a: { x: -10, y: 0 }, b: { x: 10, y: 0 } }

  // 切线：水平、y = 4，从 x=−3 到 x=3 ⇒ 与 x 轴不相交，但与圆在 (0,4) 相切。
  const tangent: SampledPrimitive = { id: "t", type: "tangent", sourceId: "c", x: 4, point: { x: 0, y: 4 }, slope: 0, a: { x: -3, y: 4 }, b: { x: 3, y: 4 }, status: "approximate", anchor: { kind: "parameter", parameter: 0 } }
  // 法线：竖直、x = 0，从 y=1 到 y=5 ⇒ 与圆交于 (0,4) 一点（(0,0) 在段外）。
  const normal: SampledPrimitive = { id: "n", type: "normal", sourceId: "c", x: 4, point: { x: 0, y: 4 }, slope: 0, a: { x: 0, y: 1 }, b: { x: 0, y: 5 }, status: "approximate", anchor: { kind: "parameter", parameter: 0 } }
  // 割线：水平、y = 2，从 x=−2 到 x=2 ⇒ 与圆交于两点（正是圆的两端）。
  const secant: SampledPrimitive = { id: "s", type: "secant", sourceId: "f", x1: -2, x2: 2, points: [{ x: -2, y: 2 }, { x: 2, y: 2 }], slope: 0, a: { x: -2, y: 2 }, b: { x: 2, y: 2 }, status: "approximate" }
  // 导函数：采样点是 y = x 这条直线上的两点 ⇒ 与圆交于 (0,0) 与 (2,2)。
  const derivative: SampledPrimitive = { id: "d", type: "derivative", sourceId: "f", order: 1, domain: [-2, 2], samples: 2, points: [{ x: -2, y: -2 }, { x: 2, y: 2 }], status: "approximate" }
  // 积分区域：上边界 y = 2、从 x=−2 到 x=2 ⇒ 与圆交于 (−2,2) 与 (2,2)。
  const integral: SampledPrimitive = { id: "i", type: "integral", sourceId: "f", domain: [-2, 2], steps: 2, points: [{ x: -2, y: 2 }, { x: 2, y: 2 }], area: 8, status: "approximate" }

  it("samples a tangent and a normal as the segment they are drawn as", () => {
    // 切线与 x 轴不相交（它在 y=4 上，而可视段只到 x=±3）。
    expect(pointsOf(intersectSampledPrimitives(tangent, xAxisLine))).toEqual([])
    // 切线与圆的相切点。
    const tangentOnCircle = pointsOf(intersectSampledPrimitives(tangent, circle))
    expect(tangentOnCircle).toHaveLength(1)
    expect(tangentOnCircle[0].x).toBeCloseTo(0, 6)
    expect(tangentOnCircle[0].y).toBeCloseTo(4, 6)
    // 法线的竖直段穿过圆一次。
    const normalOnCircle = pointsOf(intersectSampledPrimitives(normal, circle))
    expect(normalOnCircle).toHaveLength(1)
    expect(normalOnCircle[0].y).toBeCloseTo(4, 6)
  })

  it("samples a secant, a derivative and an integral", () => {
    expect(pointsOf(intersectSampledPrimitives(secant, circle))).toHaveLength(2)
    expect(pointsOf(intersectSampledPrimitives(derivative, circle))).toHaveLength(2)
    expect(pointsOf(intersectSampledPrimitives(integral, circle))).toHaveLength(2)
  })

  it("draws nothing from a derived primitive whose status is not approximate", () => {
    // 同一个切线，只把状态改成 failed：它的 a/b 仍然穿过圆，但算不出来的对象不该产生交点。
    const failed = { ...tangent, status: "failed" as const }
    expect(pointsOf(intersectSampledPrimitives(failed, circle))).toEqual([])
    const undefinedTangent = { ...tangent, status: "undefined" as const }
    expect(pointsOf(intersectSampledPrimitives(undefinedTangent, circle))).toEqual([])
  })
})
