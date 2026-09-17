import { describe, expect, it } from "vitest"

import type { EllipsePrimitive, HyperbolaPrimitive, ParabolaPrimitive } from "@draw/dsl"

import { sampleEllipse, sampleHyperbola, sampleHyperbolaBranches, sampleParabola } from "./conics"
import { DynamicPoint, beginDrag, createDynamicPoint, movePoints, traceParameters } from "./dynamic-points"
import {
  arcConstraint,
  circleConstraint,
  conicCoefficients,
  conicConstraint,
  conicValue,
  ellipseConstraint,
  functionGraphConstraint,
  hyperbolaConstraint,
  implicitConicConstraint,
  lineConstraint,
  linearConstraint,
  parabolaConstraint,
  polylineConstraint,
  rayConstraint,
  segmentConstraint
} from "./planar-constraints"

const ellipse: EllipsePrimitive = { id: "e", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 4, radiusY: 1 }
const circleLike: EllipsePrimitive = { id: "ec", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 2, radiusY: 2 }
const hyperbola: HyperbolaPrimitive = { id: "h", type: "hyperbola", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2, axis: "x" }
const parabola: ParabolaPrimitive = { id: "p", type: "parabola", vertex: { x: 0, y: 0 }, focalParameter: 2, axis: "y" }

describe("linear constraints", () => {
  const segment = segmentConstraint("s", { x: 0, y: 0 }, { x: 4, y: 0 })

  it("maps a parameter onto the segment and clamps it to [0, 1]", () => {
    expect(segment.parameterBounds()).toEqual({ min: 0, max: 1, wrap: false })
    expect(segment.evaluate(0)).toEqual({ x: 0, y: 0 })
    expect(segment.evaluate(0.5)).toEqual({ x: 2, y: 0 })
    expect(segment.evaluate(1)).toEqual({ x: 4, y: 0 })
    const projection = segment.project({ x: 2, y: 5 })
    expect(projection?.parameter).toBeCloseTo(0.5, 12)
    expect(projection?.point).toEqual({ x: 2, y: 0 })
    expect(projection?.distance).toBeCloseTo(5, 12)
  })

  it("clamps beyond an endpoint and reports the snapped distance", () => {
    const projection = segment.project({ x: 10, y: 0 })
    expect(projection?.parameter).toBe(1)
    expect(projection?.point).toEqual({ x: 4, y: 0 })
    expect(projection?.distance).toBeCloseTo(6, 12)
  })

  it("leaves a ray unbounded on the positive side only", () => {
    const ray = rayConstraint("r", { x: 0, y: 0 }, { x: 4, y: 0 })
    expect(ray.project({ x: -8, y: 0 })?.parameter).toBe(0)
    expect(ray.project({ x: 20, y: 0 })?.parameter).toBeCloseTo(5, 12)
  })

  it("leaves a line unbounded on both sides", () => {
    const line = lineConstraint("l", { x: 0, y: 0 }, { x: 4, y: 0 })
    expect(line.project({ x: -8, y: 0 })?.parameter).toBeCloseTo(-2, 12)
    expect(line.project({ x: 20, y: 0 })?.parameter).toBeCloseTo(5, 12)
  })

  it("measures the perpendicular residual for a line and the endpoint distance outside a segment", () => {
    expect(lineConstraint("l", { x: 0, y: 0 }, { x: 4, y: 0 }).residual({ x: 2, y: 5 })).toBeCloseTo(5, 12)
    expect(segment.residual({ x: 2, y: 3 })).toBeCloseTo(3, 12)
    expect(segment.residual({ x: 7, y: 0 })).toBeCloseTo(3, 12)
    expect(segment.residual({ x: -2, y: 0 })).toBeCloseTo(2, 12)
    expect(segment.residual({ x: 2, y: 0 })).toBeCloseTo(0, 12)
  })

  it("flags when the projection was pulled back to a parameter-domain boundary", () => {
    expect(segment.project({ x: 2, y: 5 })?.clamped).toBe(false)
    expect(segment.project({ x: 10, y: 0 })?.clamped).toBe(true)
    expect(segment.project({ x: -10, y: 0 })?.clamped).toBe(true)
    // A full line has an unbounded parameter domain, so it never clamps.
    expect(lineConstraint("l", { x: 0, y: 0 }, { x: 4, y: 0 }).project({ x: 1e6, y: 0 })?.clamped).toBe(false)
    const ray = rayConstraint("r", { x: 0, y: 0 }, { x: 4, y: 0 })
    expect(ray.project({ x: 20, y: 0 })?.clamped).toBe(false)
    expect(ray.project({ x: -20, y: 0 })?.clamped).toBe(true)
  })

  it("reports a unit tangent", () => {
    const tangent = segment.tangent(0.5)
    expect(tangent?.x).toBeCloseTo(1, 12)
    expect(tangent?.y).toBeCloseTo(0, 12)
    expect(Math.hypot(tangent!.x, tangent!.y)).toBeCloseTo(1, 12)
  })

  it("does not produce NaN for a degenerate constraint", () => {
    const degenerate = linearConstraint("segment", "d", { x: 2, y: 2 }, { x: 2, y: 2 })
    const projection = degenerate.project({ x: 5, y: 2 })
    expect(projection?.point).toEqual({ x: 2, y: 2 })
    expect(Number.isFinite(projection!.distance)).toBe(true)
    expect(degenerate.residual({ x: 5, y: 2 })).toBeCloseTo(3, 12)
    expect(degenerate.tangent(0.5)).toBeNull()
  })
})

describe("circular constraints", () => {
  const circle = circleConstraint("c", { x: 0, y: 0 }, 2)

  it("uses an angle parameter that wraps for a full circle", () => {
    expect(circle.parameterBounds().wrap).toBe(true)
    expect(circle.evaluate(0)?.x).toBeCloseTo(2, 12)
    expect(circle.evaluate(Math.PI / 2)?.y).toBeCloseTo(2, 12)
    expect(circle.project({ x: 5, y: 0 })?.point.x).toBeCloseTo(2, 12)
    expect(circle.project({ x: 5, y: 0 })?.distance).toBeCloseTo(3, 12)
    expect(circle.residual({ x: 5, y: 0 })).toBeCloseTo(3, 12)
  })

  it("falls back to the start angle when the point sits on the centre", () => {
    const projection = circle.project({ x: 0, y: 0 })
    expect(projection?.parameter).toBe(0)
    expect(projection?.distance).toBeCloseTo(2, 12)
  })

  it("snaps to the endpoint that is actually nearer for an arc", () => {
    const arc = arcConstraint("a", { x: 0, y: 0 }, 1, 0, Math.PI / 2)
    expect(arc.parameterBounds()).toEqual({ min: 0, max: Math.PI / 2, wrap: false })
    const inside = arc.project({ x: 5, y: 5 })
    expect(inside?.parameter).toBeCloseTo(Math.PI / 4, 6)
    expect(inside?.clamped).toBe(false)
    // (5, -5) is angularly just "before" the start angle; distance-based snapping must pick the start.
    const outside = arc.project({ x: 5, y: -5 })
    expect(outside?.parameter).toBe(0)
    expect(outside?.point.x).toBeCloseTo(1, 12)
    expect(outside?.clamped).toBe(true)
  })

  it("measuring a point outside an arc uses the endpoint distance", () => {
    const arc = arcConstraint("a", { x: 0, y: 0 }, 1, 0, Math.PI / 2)
    expect(arc.residual({ x: 5, y: -5 })).toBeCloseTo(Math.hypot(4, 5), 9)
    expect(arc.residual({ x: 2, y: 0 })).toBeCloseTo(1, 12)
  })

  /**
   * 体检发现的真缺陷：顺时针弧（`span < 0`，`inside` 判据明确支持）的投影返回
   * `startAngle + delta`（delta ∈ [0, 2π)），于是参数落在弧**之外**、甚至超过 2π，
   * 而 `parameterBounds` 又原样返回 `{min: startAngle, max: endAngle}` 这个反序区间。
   * 下游 `DynamicPoint` 用 `clamp(parameter, min, max)` 归一化 → 参数被夹成 endAngle，
   * 鼠标还没拖，点就先跳到弧的端点上；滑块拿到的也是倒过来的区间。
   */
  it("projects onto a clockwise arc with an in-domain parameter and sorted bounds", () => {
    const startAngle = 0.5
    const arc = arcConstraint("a", { x: 0, y: 0 }, 1, startAngle, startAngle - Math.PI)
    const bounds = arc.parameterBounds()
    expect(bounds.min).toBeLessThan(bounds.max)

    // 角度 0.4 在弧内（从 0.5 顺时针走 0.1 弧度）：参数就该是 0.4 本身。
    const projection = arc.project({ x: Math.cos(0.4), y: Math.sin(0.4) })
    expect(projection?.clamped).toBe(false)
    expect(projection?.parameter).toBeCloseTo(0.4, 9)
    expect(projection!.parameter).toBeGreaterThanOrEqual(bounds.min)
    expect(projection!.parameter).toBeLessThanOrEqual(bounds.max)
    expect(projection?.point.x).toBeCloseTo(Math.cos(0.4), 9)
    expect(projection?.distance).toBeCloseTo(0, 9)

    // 参数域内的任意参数都必须映射回同一个角度（顺时针方向）。
    for (const parameter of [bounds.min, (bounds.min + bounds.max) / 2, bounds.max]) {
      const point = arc.evaluate(parameter)!
      expect(arc.residual(point)).toBeCloseTo(0, 9)
      expect(Math.atan2(point.y, point.x)).toBeCloseTo(parameter, 9)
    }
  })

  it("returns a fresh bounds object so callers cannot corrupt the constraint", () => {
    const arc = arcConstraint("a", { x: 0, y: 0 }, 1, 0, Math.PI / 2)
    const bounds = arc.parameterBounds()
    bounds.min = 999
    expect(arc.parameterBounds().min).toBe(0)
    const line = lineConstraint("l", { x: 0, y: 0 }, { x: 4, y: 0 })
    const lineBounds = line.parameterBounds()
    lineBounds.max = 0
    expect(line.parameterBounds().max).toBe(Number.POSITIVE_INFINITY)
  })

  /**
   * 同一次体检：`lineConstraint.project` 对非有限输入会原样算出 `Infinity` 参数与坐标并报
   * `converged: true`（直线参数域本来就是 ±∞，clamp 拦不住）。动点只有一个"合法参数"的假象，
   * 却把 ∞ 写进文档。投影失败必须显式返回 null，让 `DynamicPoint.moveTo` 走"未收敛、不移动"那条路。
   */
  it("refuses to project a non-finite request instead of returning an infinite point", () => {
    const line = lineConstraint("l", { x: 0, y: 0 }, { x: 4, y: 0 })
    expect(line.project({ x: Number.POSITIVE_INFINITY, y: 0 })).toBeNull()
    expect(line.project({ x: 0, y: Number.NaN })).toBeNull()
    const segment = segmentConstraint("s", { x: 0, y: 0 }, { x: 4, y: 0 })
    expect(segment.project({ x: Number.POSITIVE_INFINITY, y: 0 })).toBeNull()
    // 正常输入照旧。
    expect(line.project({ x: 8, y: 3 })?.parameter).toBeCloseTo(2, 12)
  })

  it("uses an arc-length normalised parameter for a polyline", () => {
    const polyline = polylineConstraint("pl", [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 1 }])
    // Half of the total length 11 is 5.5, which is inside the long first segment, not at the vertex.
    const midpoint = polyline.evaluate(0.5)
    expect(midpoint?.x).toBeCloseTo(5.5, 12)
    expect(midpoint?.y).toBeCloseTo(0, 12)
    expect(polyline.evaluate(10 / 11)?.x).toBeCloseTo(10, 9)
    expect(polyline.evaluate(1)?.y).toBeCloseTo(1, 12)
  })

  it("has an unambiguous parameter at a polyline vertex because it is arc-length based", () => {
    const polyline = polylineConstraint("pl", [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 30 }])
    const projection = polyline.project({ x: 10, y: 0 })
    expect(projection?.parameter).toBeCloseTo(10 / 40, 12)
    // Round-tripping the projection parameter returns the same vertex.
    expect(polyline.evaluate(projection!.parameter)?.x).toBeCloseTo(10, 9)
    expect(polyline.evaluate(projection!.parameter)?.y).toBeCloseTo(0, 9)
  })
})

describe("function graph constraints", () => {
  it("uses x as the parameter and refuses to evaluate outside the function's domain", () => {
    const graph = functionGraphConstraint("g", (x) => 1 / x, [-2, 2])
    expect(graph.evaluate(2)).toEqual({ x: 2, y: 0.5 })
    expect(graph.evaluate(0)).toBeNull()
    const root = functionGraphConstraint("g2", (x) => Math.sqrt(x), [-4, 4])
    expect(root.evaluate(-1)).toBeNull()
    expect(root.evaluate(4)).toEqual({ x: 4, y: 2 })
  })

  it("finds the true nearest point on a steep graph rather than the point at the same x", () => {
    const cubic = functionGraphConstraint("c", (x) => x ** 3, [-3, 3])
    const projection = cubic.project({ x: 1, y: 5 })
    expect(projection).not.toBeNull()
    // The same-x point (1, 1) is 4 away; the real nearest point is far closer.
    expect(projection!.distance).toBeLessThan(1)
    expect(projection!.distance).toBeLessThan(Math.hypot(1 - 1, 1 - 5))
    expect(Math.abs(projection!.point.y - projection!.point.x ** 3)).toBeLessThan(1e-9)
  })

  it("reports a unit tangent that follows the slope", () => {
    const identity = functionGraphConstraint("i", (x) => x, [-10, 10])
    const tangent = identity.tangent(3)
    expect(tangent?.x).toBeCloseTo(Math.SQRT1_2, 6)
    expect(tangent?.y).toBeCloseTo(Math.SQRT1_2, 6)
  })
})

describe("conic constraints", () => {
  it("parameterises an ellipse by eccentric angle", () => {
    const constraint = ellipseConstraint("e", ellipse)
    expect(constraint.parameterBounds().wrap).toBe(true)
    expect(constraint.evaluate(0)?.x).toBeCloseTo(4, 12)
    expect(constraint.evaluate(0)?.y).toBeCloseTo(0, 12)
    expect(constraint.evaluate(Math.PI / 2)?.x).toBeCloseTo(0, 12)
    expect(constraint.evaluate(Math.PI / 2)?.y).toBeCloseTo(1, 12)
  })

  it("applies the rotation to the ellipse frame", () => {
    const rotated = ellipseConstraint("e", { ...ellipse, rotation: Math.PI / 2 })
    expect(rotated.evaluate(0)?.x).toBeCloseTo(0, 12)
    expect(rotated.evaluate(0)?.y).toBeCloseTo(4, 12)
  })

  /**
   * 周期约束的投影必须落在 `parameterBounds` 声明的域内。
   * 违反这条契约的后果很隐蔽：调用方按 [0, 1] 归一化时，负角会被截断成 0，
   * 于是椭圆的下半部分整段塌到右顶点，点"只能在上方运动"。
   */
  it("keeps a periodic parameter inside its declared [0, 2π) domain for every direction", () => {
    for (const constraint of [ellipseConstraint("e", ellipse), circleConstraint("c", { x: 0, y: 0 }, 3)]) {
      const bounds = constraint.parameterBounds()
      expect(bounds.wrap).toBe(true)
      // Walk all around the curve, outside and inside, and check every projection.
      for (let index = 0; index < 64; index += 1) {
        const angle = (index / 64) * Math.PI * 2
        for (const radius of [0.3, 1, 3]) {
          const desired = { x: radius * 8 * Math.cos(angle), y: radius * 2 * Math.sin(angle) }
          const projection = constraint.project(desired)
          expect(projection).not.toBeNull()
          expect(projection!.parameter).toBeGreaterThanOrEqual(bounds.min)
          expect(projection!.parameter).toBeLessThan(bounds.max)
        }
      }
    }
  })

  it("reaches the lower half of an ellipse instead of collapsing to a vertex", () => {
    const constraint = ellipseConstraint("e", ellipse)
    // (0, -1) is the bottom vertex of this ellipse and lies exactly on it.
    const bottom = constraint.project({ x: 0, y: -1 })
    expect(bottom!.parameter).toBeCloseTo(Math.PI * 1.5, 6)
    expect(bottom!.point.x).toBeCloseTo(0, 9)
    expect(bottom!.point.y).toBeCloseTo(-1, 9)
    // Normalised the way the document model does it, the bottom vertex is t = 0.75, not 0.
    expect(bottom!.parameter / (Math.PI * 2)).toBeCloseTo(0.75, 9)
    // And the left vertex (θ = π) is t = 0.5.
    const left = constraint.project({ x: -4, y: 0 })
    expect(left!.parameter / (Math.PI * 2)).toBeCloseTo(0.5, 6)
  })

  it("projects onto a circle-like ellipse exactly", () => {
    const constraint = ellipseConstraint("ec", circleLike)
    const projection = constraint.project({ x: 5, y: 0 })
    expect(projection?.distance).toBeCloseTo(3, 9)
    expect(projection?.point.x).toBeCloseTo(2, 6)
  })

  it("never returns a farther point than the eccentric-angle seed", () => {
    const constraint = ellipseConstraint("e", ellipse)
    const desired = { x: 4, y: 3 }
    const projection = constraint.project(desired)
    const seedPoint = constraint.evaluate(Math.atan2(desired.y / ellipse.radiusY, desired.x / ellipse.radiusX))!
    expect(projection!.distance).toBeLessThanOrEqual(Math.hypot(seedPoint.x - desired.x, seedPoint.y - desired.y) + 1e-9)
  })

  it("takes the true nearest point on an ellipse, which is the vertex on the minor axis", () => {
    const projection = ellipseConstraint("e", ellipse).project({ x: 0, y: 3 })
    expect(projection?.point.x).toBeCloseTo(0, 6)
    expect(projection?.point.y).toBeCloseTo(1, 6)
    expect(projection?.distance).toBeCloseTo(2, 6)
  })

  it("gives a hyperbola two branches that are reflections through the centre", () => {
    const constraint = hyperbolaConstraint("h", hyperbola)
    expect(constraint.branchCount).toBe(2)
    expect(constraint.evaluate(0, 0)).toEqual({ x: 0, y: 2 })
    expect(constraint.evaluate(0, 1)).toEqual({ x: 0, y: -2 })
    // Branch 1 at u is the reflection through the centre of branch 0 at -u.
    const image = constraint.evaluate(3, 1)!
    const source = constraint.evaluate(-3, 0)!
    expect(image.x).toBeCloseTo(-source.x, 12)
    expect(image.y).toBeCloseTo(-source.y, 12)
    expect(source.y).toBeCloseTo(2 * Math.sqrt(2), 12)
  })

  it("stays on the requested branch when previousBranch is given", () => {
    const constraint = hyperbolaConstraint("h", hyperbola)
    const desired = { x: 0, y: 2 }
    expect(constraint.project(desired)?.branch).toBe(0)
    const locked = constraint.project(desired, { previousBranch: 1 })
    expect(locked?.branch).toBe(1)
    expect(locked?.point.y).toBeCloseTo(-2, 6)
  })

  it("matches the existing parabola sampling convention for both axes and a rotation", () => {
    for (const axis of ["x", "y"] as const) {
      for (const rotation of [0, Math.PI / 2, 0.4]) {
        const primitive: ParabolaPrimitive = { id: "p", type: "parabola", vertex: { x: 1, y: 2 }, focalParameter: 2, axis, rotation }
        const constraint = parabolaConstraint("p", primitive)
        for (const parameter of [-2, -0.5, 0, 0.5, 2]) {
          const [sampled] = sampleParabola(primitive, [parameter, parameter], 1)
          const evaluated = constraint.evaluate(parameter)!
          expect(evaluated.x).toBeCloseTo(sampled.x, 12)
          expect(evaluated.y).toBeCloseTo(sampled.y, 12)
        }
      }
    }
  })
})

describe("implicit conic form agrees with the parameterisation", () => {
  it("vanishes on every sampled point of an ellipse, including a rotated one", () => {
    for (const primitive of [ellipse, circleLike, { ...ellipse, center: { x: 1, y: -2 }, rotation: 0.7 }]) {
      const coefficients = conicCoefficients(primitive)
      for (const point of sampleEllipse(primitive, 48)) expect(conicValue(coefficients, point)).toBeCloseTo(0, 6)
    }
  })

  it("vanishes on every sampled point of a parabola", () => {
    for (const axis of ["x", "y"] as const) {
      for (const rotation of [0, 0.3]) {
        const primitive: ParabolaPrimitive = { id: "p", type: "parabola", vertex: { x: -1, y: 3 }, focalParameter: 1.5, axis, rotation }
        const coefficients = conicCoefficients(primitive)
        for (const point of sampleParabola(primitive, [-3, 3], 48)) expect(conicValue(coefficients, point)).toBeCloseTo(0, 6)
      }
    }
  })

  it("vanishes on every sampled point of both hyperbola branches", () => {
    for (const axis of ["x", "y"] as const) {
      const primitive: HyperbolaPrimitive = { id: "h", type: "hyperbola", center: { x: 2, y: 1 }, radiusX: 3, radiusY: 2, axis, rotation: 0.5 }
      const coefficients = conicCoefficients(primitive)
      const branches = [sampleHyperbola(primitive, [-3, 3], 32), ...sampleHyperbolaBranches(primitive, [-3, 3], 32)]
      for (const branch of branches) for (const point of branch) expect(conicValue(coefficients, point)).toBeCloseTo(0, 6)
    }
  })

  it("projects through the implicit form and lands on the curve", () => {
    const coefficients = conicCoefficients(ellipse)
    const constraint = implicitConicConstraint("ie", coefficients)
    const desired = { x: 5, y: 3 }
    const projection = constraint.project(desired)
    expect(projection).not.toBeNull()
    expect(conicValue(coefficients, projection!.point)).toBeCloseTo(0, 9)
    const explicit = ellipseConstraint("e", ellipse).project(desired)!
    expect(projection!.distance).toBeCloseTo(explicit.distance, 6)
    expect(projection!.converged).toBe(true)
  })

  it("cannot be sampled when no parameterisation is supplied, but still projects", () => {
    const constraint = implicitConicConstraint("ie", conicCoefficients(ellipse))
    expect(constraint.evaluate(0)).toBeNull()
    expect(constraint.project({ x: 5, y: 3 })).not.toBeNull()
  })

  it("reports a linearised residual from the gradient and an exact distance from the projection", () => {
    const coefficients = conicCoefficients(ellipse)
    const constraint = implicitConicConstraint("ie", coefficients)
    expect(constraint.residual({ x: 4, y: 0 })).toBeCloseTo(0, 9)
    // `residual` is deliberately the cheap first-order estimate |F| / |∇F|: at (6,0) on this
    // ellipse F = 20 and |∇F| = 12, so it underestimates the true distance of 2.
    expect(constraint.residual({ x: 6, y: 0 })).toBeCloseTo(20 / 12, 9)
    // The projection gives the exact distance — use it when accuracy matters more than speed.
    expect(constraint.project({ x: 6, y: 0 })!.distance).toBeCloseTo(2, 6)
  })

  /**
   * 体检发现的真缺陷：梯度为零时 `|F| / |∇F|` 不成立，旧实现退回 `|F|`——那是 F 的**量纲**，不是距离。
   * 椭圆中心实测得到 16（F 的缩放值），而真实距离是短半轴 1。这种点改成用精确投影的距离。
   */
  it("returns the true distance when the gradient vanishes instead of the raw curve value", () => {
    const constraint = implicitConicConstraint("ie", conicCoefficients(ellipse))

    // 中心：F = -16、∇F = 0 → 旧实现给 16；真实距离是短半轴（radiusY = 1）。
    expect(constraint.residual({ x: 0, y: 0 })).toBeCloseTo(1, 6)
    // 投影仍然给出同一个数，两条通路自洽。
    expect(constraint.project({ x: 0, y: 0 })!.distance).toBeCloseTo(1, 6)
  })

  it("keeps the named conic constraint and the implicit one on the same curve", () => {
    const named = conicConstraint("e", ellipse)
    const implicit = implicitConicConstraint("ie", conicCoefficients(ellipse))
    for (const parameter of [0, 1, 2, 3, 4, 5]) {
      const point = named.evaluate(parameter)!
      expect(implicit.residual(point)).toBeCloseTo(0, 6)
    }
  })
})

describe("dynamic points", () => {
  it("keeps the coordinate exactly on the constraint after every move", () => {
    const constraint = ellipseConstraint("e", ellipse)
    const point = createDynamicPoint("P", constraint, { parameter: 0.3 })
    for (const desired of [{ x: 5, y: 3 }, { x: 0, y: 4 }, { x: -6, y: -1 }, { x: 1, y: 1 }]) {
      point.moveTo(desired)
      const state = point.state
      const expected = constraint.evaluate(state.parameter, state.branch)!
      expect(state.point.x).toBeCloseTo(expected.x, 12)
      expect(state.point.y).toBeCloseTo(expected.y, 12)
    }
  })

  it("clamps at a segment endpoint and reports the snap distance", () => {
    const point = createDynamicPoint("P", segmentConstraint("s", { x: 0, y: 0 }, { x: 4, y: 0 }))
    const result = point.moveTo({ x: 10, y: 0 })
    expect(result.clamped).toBe(true)
    expect(result.parameter).toBe(1)
    expect(result.point).toEqual({ x: 4, y: 0 })
    expect(result.snapDistance).toBeCloseTo(6, 12)
    expect(result.converged).toBe(true)
  })

  it("reports no change when the move does not move the point", () => {
    const point = createDynamicPoint("P", segmentConstraint("s", { x: 0, y: 0 }, { x: 4, y: 0 }))
    expect(point.moveTo({ x: 2, y: 0 }).changed).toBe(true)
    expect(point.moveTo({ x: 2, y: 0 }).changed).toBe(false)
    // Sliding perpendicular onto the same foot point is also not a change.
    expect(point.moveTo({ x: 2, y: 9 }).changed).toBe(false)
  })

  it("wraps the parameter for a circle and clamps it for an arc", () => {
    const circle = createDynamicPoint("C", circleConstraint("c", { x: 0, y: 0 }, 2))
    const wrapped = circle.setParameter(Math.PI * 7)
    expect(wrapped.parameter).toBeCloseTo(Math.PI, 9)
    expect(wrapped.parameter).toBeGreaterThanOrEqual(0)
    expect(wrapped.parameter).toBeLessThan(Math.PI * 2)

    const arc = createDynamicPoint("A", arcConstraint("a", { x: 0, y: 0 }, 1, 0, Math.PI / 2))
    const clamped = arc.setParameter(Math.PI * 3)
    expect(clamped.clamped).toBe(true)
    expect(clamped.parameter).toBeCloseTo(Math.PI / 2, 12)
  })

  it("refuses a non-finite parameter instead of corrupting the state", () => {
    const point = createDynamicPoint("P", segmentConstraint("s", { x: 0, y: 0 }, { x: 4, y: 0 }), { parameter: 0.5 })
    const result = point.setParameter(Number.NaN)
    expect(result.converged).toBe(false)
    expect(result.changed).toBe(false)
    expect(point.state.parameter).toBeCloseTo(0.5, 12)
  })

  /**
   * 体检发现的真缺陷：隐式投影的 `maxIterations` 直接取调用方的值。`0`（或负数 / NaN）会让内层循环
   * 一次都不跑，`converged` 恒为 false，而"残差够小就接受"的分支仍可能把**种子点**当成投影返回——
   * 一个没迭代过的"投影"。上限必须归一化（非有限值用默认 40）。
   */
  it("normalises the implicit-projection iteration cap instead of accepting the seed", () => {
    const coefficients = conicCoefficients(ellipse)
    const constraint = implicitConicConstraint("ie", coefficients)
    // (6, 0) 在椭圆外：真正迭代过之后才会落到 (4, 0)。
    const desired = { x: 6, y: 0 }

    for (const maxIterations of [0, -5, Number.NaN, Number.NEGATIVE_INFINITY]) {
      const projection = constraint.project(desired, { maxIterations })
      expect(projection, `maxIterations=${maxIterations}`).not.toBeNull()
      expect(projection!.point.x, `maxIterations=${maxIterations}`).toBeCloseTo(4, 6)
      expect(projection!.point.y, `maxIterations=${maxIterations}`).toBeCloseTo(0, 6)
      expect(projection!.converged).toBe(true)
    }
  })

  it("re-derives the coordinate from a re-evaluated constraint on refresh", () => {
    let scale = 1
    const graph = functionGraphConstraint("g", (x) => scale * x, [0, 10])
    const point = createDynamicPoint("P", graph, { parameter: 2 })
    expect(point.position).toEqual({ x: 2, y: 2 })
    scale = 3
    const refreshed = point.refresh()
    expect(refreshed.changed).toBe(true)
    expect(point.state.parameter).toBeCloseTo(2, 12)
    expect(point.position).toEqual({ x: 2, y: 6 })
  })

  it("marks the point invalid at a discontinuity and restores it afterwards", () => {
    const point = createDynamicPoint("P", functionGraphConstraint("g", (x) => 1 / x, [-2, 2]), { parameter: 1 })
    expect(point.state.valid).toBe(true)
    point.setParameter(0)
    expect(point.state.valid).toBe(false)
    point.setParameter(2)
    expect(point.state.valid).toBe(true)
    expect(point.position).toEqual({ x: 2, y: 0.5 })
  })

  it("keeps the parameter when a projection cannot converge", () => {
    const point = createDynamicPoint("P", segmentConstraint("s", { x: 0, y: 0 }, { x: 4, y: 0 }), { parameter: 0.25 })
    const result = point.moveTo({ x: Number.NaN, y: 1 })
    expect(result.converged).toBe(false)
    expect(point.state.parameter).toBeCloseTo(0.25, 12)
  })

  it("preserves the grab offset while dragging", () => {
    const point = createDynamicPoint("P", lineConstraint("l", { x: 0, y: 0 }, { x: 0, y: 1 }), { parameter: 5 })
    const session = beginDrag(point, { x: 0, y: 8 })
    expect(session.offset).toEqual({ x: 0, y: 3 })
    const result = session.update({ x: 0, y: 10 })
    expect(result.point.y).toBeCloseTo(7, 9)
  })

  it("restores the original state after tracing parameters", () => {
    const point = createDynamicPoint("P", segmentConstraint("s", { x: 0, y: 0 }, { x: 10, y: 0 }), { parameter: 0.4 })
    const traced = traceParameters(point, [0, 0.25, 0.5, 0.75, 1])
    expect(traced.map((entry) => entry?.x)).toEqual([0, 2.5, 5, 7.5, 10])
    expect(point.state.parameter).toBeCloseTo(0.4, 12)
    expect(point.position.x).toBeCloseTo(4, 12)
  })

  it("moves a batch of points and reports only the ones that moved", () => {
    const first = createDynamicPoint("P1", segmentConstraint("s", { x: 0, y: 0 }, { x: 10, y: 0 }), { parameter: 0.2 })
    const second = createDynamicPoint("P2", segmentConstraint("s", { x: 0, y: 0 }, { x: 10, y: 0 }), { parameter: 0.9 })
    const batch = movePoints([first, second], new Map([["P1", { x: 9, y: 0 }], ["P2", { x: 9, y: 0 }]]))
    expect(batch.changedPointIds).toEqual(["P1"])
    expect(batch.movedConstraintIds).toEqual(["s"])
    expect(batch.results.size).toBe(2)
  })

  it("exposes a snapshot that does not alias internal state", () => {
    const point = createDynamicPoint("P", segmentConstraint("s", { x: 0, y: 0 }, { x: 4, y: 0 }), { parameter: 0.5 })
    const state = point.state
    state.point.x = 999
    expect(point.position.x).toBeCloseTo(2, 12)
  })

  it("is constructible directly through the class as well as the factory", () => {
    const point = new DynamicPoint("P", segmentConstraint("s", { x: 0, y: 0 }, { x: 4, y: 0 }), { parameter: 0.5 })
    expect(point.position).toEqual({ x: 2, y: 0 })
    expect(point.constraint.id).toBe("s")
    expect(point.distanceTo({ x: 2, y: 3 })).toBeCloseTo(3, 12)
  })
})
