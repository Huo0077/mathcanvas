import { describe, expect, it } from "vitest"

import type { EllipsePrimitive, HyperbolaPrimitive, ParabolaPrimitive } from "@draw/dsl"

import {
  arcConstraint,
  circleConstraint,
  conicCoefficients,
  conicGradient,
  conicValue,
  constraintTangentAt,
  ellipseConstraint,
  functionGraphConstraint,
  hyperbolaConstraint,
  normalFromTangent,
  parabolaConstraint,
  tangentSegment
} from "./planar-constraints"

/**
 * 曲线切线的验收。
 *
 * 用户口径："创建一条曲线后，可以点击这条曲线，右侧功能栏里应有一个选项是创建一条在这个曲线上的切线。
 * 曲线包括抛物线，双曲线，圆，椭圆。"
 *
 * 这里钉住的是**几何正确性**，不是"函数被调用了"。判据刻意与参数化无关，只用隐式形式 F(P) = 0 与 ∇F：
 *  1. 切点在曲线上：F(P) = 0；
 *  2. 切向是切向：∇F(P) · d = 0（这正是"切线"的定义，也与参数化选得好不好无关）；
 *  3. 竖直切线也能表达：圆的左右顶点斜率无穷大，斜截式在那里会直接坏掉。
 */
describe("curve tangents", () => {
  const round = (point: { x: number; y: number }) => ({ x: Number(point.x.toFixed(9)), y: Number(point.y.toFixed(9)) })
  const dot = (first: { x: number; y: number }, second: { x: number; y: number }) => first.x * second.x + first.y * second.y

  /** 通用的"这是不是这条圆锥曲线的切线"判据，四条曲线共用同一份断言。 */
  const expectTangentToConic = (primitive: EllipsePrimitive | HyperbolaPrimitive | ParabolaPrimitive, parameter: number, branch = 0) => {
    const coefficients = conicCoefficients(primitive)
    const tangent = constraintTangentAt(primitive.type === "ellipse" ? ellipseConstraint(primitive.id, primitive) : primitive.type === "hyperbola" ? hyperbolaConstraint(primitive.id, primitive) : parabolaConstraint(primitive.id, primitive), parameter, branch)!
    expect(tangent).not.toBeNull()
    // 1. 切点在曲线上。
    expect(conicValue(coefficients, tangent.point)).toBeCloseTo(0, 7)
    // 2. 切向与梯度垂直。
    const gradient = conicGradient(coefficients, tangent.point)
    expect(dot(gradient, tangent.direction)).toBeCloseTo(0, 7)
    // 3. 单位切向。
    expect(Math.hypot(tangent.direction.x, tangent.direction.y)).toBeCloseTo(1, 12)
    return tangent
  }

  it("gives a circle's tangent perpendicular to the radius", () => {
    const circle = circleConstraint("c", { x: 1, y: -2 }, 3)
    for (const angle of [0, Math.PI / 6, Math.PI / 2, Math.PI, 4.7]) {
      const tangent = constraintTangentAt(circle, angle)!
      expect(Math.hypot(tangent.point.x - 1, tangent.point.y + 2)).toBeCloseTo(3, 9)
      const radius = { x: tangent.point.x - 1, y: tangent.point.y + 2 }
      expect(dot(radius, tangent.direction)).toBeCloseTo(0, 9)
      expect(Math.hypot(tangent.direction.x, tangent.direction.y)).toBeCloseTo(1, 12)
    }
  })

  it("expresses a vertical circle tangent, where a slope would be infinite", () => {
    const circle = circleConstraint("c", { x: 0, y: 0 }, 2)
    const tangent = constraintTangentAt(circle, 0)!
    expect(round(tangent.point)).toEqual({ x: 2, y: 0 })
    // 竖直：方向没有 x 分量。斜截式在这里会得到 Infinity。
    expect(Math.abs(tangent.direction.x)).toBeLessThan(1e-12)
    const segment = tangentSegment(tangent, 2)
    expect(segment.a.x).toBeCloseTo(2, 9)
    expect(segment.b.x).toBeCloseTo(2, 9)
    expect(Math.abs(segment.a.y - segment.b.y)).toBeCloseTo(4, 9)
    // 线段的中点就是切点：切线是**以切点为中心**画出来的。
    expect((segment.a.y + segment.b.y) / 2).toBeCloseTo(tangent.point.y, 9)
  })

  it("keeps an arc's tangent inside the arc's own parameter domain", () => {
    const arc = arcConstraint("a", { x: 0, y: 0 }, 2, 0, Math.PI / 2)
    expect(constraintTangentAt(arc, Math.PI / 4)).not.toBeNull()
    // 参数域是弧自己声明的：它不会被静默当成整圆。
    expect(arc.parameterBounds().min).toBeCloseTo(0, 12)
    expect(arc.parameterBounds().max).toBeCloseTo(Math.PI / 2, 12)
  })

  it("gives a rotated ellipse's tangent perpendicular to its implicit gradient", () => {
    const ellipse: EllipsePrimitive = { id: "e", type: "ellipse", center: { x: 1, y: 1 }, radiusX: 4, radiusY: 2, rotation: 0.4 }
    for (const parameter of [0, 0.9, 2.5, 5.1]) expectTangentToConic(ellipse, parameter)
  })

  it("gives a hyperbola's tangent on both branches", () => {
    const hyperbola: HyperbolaPrimitive = { id: "h", type: "hyperbola", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2, axis: "x" }
    for (const branch of [0, 1]) for (const parameter of [-2, 0, 2.5]) expectTangentToConic(hyperbola, parameter, branch)
    // 两支在同一个参数处给出关于横轴对称的点，切向也随之镜像（这是这一支参数化的定义）。
    const constraint = hyperbolaConstraint("h", hyperbola)
    const upper = constraintTangentAt(constraint, 2, 0)!
    const lower = constraintTangentAt(constraint, 2, 1)!
    expect(upper.point.x).toBeCloseTo(lower.point.x, 9)
    expect(upper.point.y).toBeCloseTo(-lower.point.y, 9)
    expect(upper.direction.y).toBeCloseTo(-lower.direction.y, 9)
  })

  it("gives a parabola's tangent at its vertex and away from it", () => {
    const parabola: ParabolaPrimitive = { id: "p", type: "parabola", vertex: { x: 0, y: 0 }, focalParameter: 2, axis: "y" }
    expectTangentToConic(parabola, 0)
    expectTangentToConic(parabola, 3)
    // 顶点处切线水平。
    const vertex = constraintTangentAt(parabolaConstraint("p", parabola), 0)!
    expect(round(vertex.point)).toEqual({ x: 0, y: 0 })
    expect(Math.abs(vertex.direction.y)).toBeLessThan(1e-12)
    // axis "y"：P(u) = (u, u²/2p)，切线斜率 = u/p = 1.5。
    const away = constraintTangentAt(parabolaConstraint("p", parabola), 3)!
    expect(away.direction.y / away.direction.x).toBeCloseTo(1.5, 9)
  })

  it("folds a periodic parameter back into its domain so readouts stay stable", () => {
    const circle = circleConstraint("c", { x: 0, y: 0 }, 1)
    const once = constraintTangentAt(circle, 0.5)!
    const wrapped = constraintTangentAt(circle, 0.5 + 4 * Math.PI)!
    expect(wrapped.parameter).toBeCloseTo(once.parameter, 9)
    expect(round(wrapped.point)).toEqual(round(once.point))
  })

  it("follows a function graph, including a vertical normal", () => {
    const graph = functionGraphConstraint("f", (x) => x * x, [-4, 4])
    const tangent = constraintTangentAt(graph, 1)!
    expect(round(tangent.point)).toEqual({ x: 1, y: 1 })
    expect(tangent.direction.y / tangent.direction.x).toBeCloseTo(2, 9)
    // 法线是切向转 90°：在 x = 0 处切线水平，法线因此竖直。
    const normal = normalFromTangent(constraintTangentAt(graph, 0)!)
    expect(Math.abs(normal.direction.x)).toBeLessThan(1e-12)
    expect(normal.point).toEqual(constraintTangentAt(graph, 0)!.point)
  })

  it("refuses degenerate curves and non-finite parameters instead of inventing a line", () => {
    expect(constraintTangentAt(ellipseConstraint("e", { id: "e", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 0, radiusY: 0 }), 0)).toBeNull()
    expect(constraintTangentAt(parabolaConstraint("p", { id: "p", type: "parabola", vertex: { x: 0, y: 0 }, focalParameter: 0, axis: "y" }), 0)).toBeNull()
    expect(constraintTangentAt(circleConstraint("c", { x: 0, y: 0 }, 1), Number.NaN)).toBeNull()
    // 函数在间断点处没有切点。
    expect(constraintTangentAt(functionGraphConstraint("f", (x) => (x === 0 ? Number.NaN : 1 / x), [-2, 2]), 0)).toBeNull()
  })
})
