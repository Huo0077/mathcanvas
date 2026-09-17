import { describe, expect, it } from "vitest"

import { coneQuadric3, conic3PointAt, cylinderQuadric3, intersectPlaneQuadric3, planeQuadric3, quadricScaleOf, quadricValueAt } from "./quadrics"

const RADIUS = 2
const HEIGHT = 3
const cylinder = { id: "cylinder-1", type: "cylinder" as const, center: { x: 0, y: 0, z: 0 }, radius: RADIUS, height: HEIGHT, segments: 48 }
const cone = { id: "cone-1", type: "cone" as const, center: { x: 0, y: 0, z: 0 }, radius: RADIUS, height: HEIGHT, segments: 48 }
const degrees = (value: number) => (value * Math.PI) / 180

/** 平面 `n·x + c = 0`。 */
const plane = (normal: { x: number; y: number; z: number }, constant: number) => ({ normal, constant })

describe("plane ∩ quadric (analytic)", () => {
  it("cuts a perpendicular circle exactly", () => {
    const conic = intersectPlaneQuadric3(plane({ x: 0, y: 0, z: 1 }, -1), cylinderQuadric3(cylinder))

    expect(conic.kind).toBe("circle")
    expect(conic.closed).toBe(true)
    expect(conic.semiMajor).toBeCloseTo(RADIUS, 12)
    expect(conic.semiMinor).toBeCloseTo(RADIUS, 12)
    expect(conic.eccentricity).toBe(0)
    expect(conic.center!.x).toBeCloseTo(0, 12)
    expect(conic.center!.y).toBeCloseTo(0, 12)
    expect(conic.center!.z).toBeCloseTo(1, 12)
  })

  it("cuts a 30° ellipse with a = R/cos θ, b = R, e = sin θ", () => {
    const theta = degrees(30)
    // 平面过原点：圆锥曲线的中心就是"轴 ∩ 平面" = 原点。
    const conic = intersectPlaneQuadric3(plane({ x: Math.sin(theta), y: 0, z: Math.cos(theta) }, 0), cylinderQuadric3(cylinder))

    expect(conic.kind).toBe("ellipse")
    expect(conic.semiMajor).toBeCloseTo(RADIUS / Math.cos(theta), 12)
    expect(conic.semiMinor).toBeCloseTo(RADIUS, 12)
    expect(conic.eccentricity).toBeCloseTo(0.5, 12)
    expect(conic.closed).toBe(true)
    expect(conic.foci).toHaveLength(2)
    // 焦距 = √(a² − b²) = a·e，焦点对称落在长轴上。
    const focalDistance = Math.hypot(conic.foci![0].x - conic.foci![1].x, conic.foci![0].y - conic.foci![1].y, conic.foci![0].z - conic.foci![1].z)
    expect(focalDistance / 2).toBeCloseTo(conic.semiMajor! * conic.eccentricity!, 12)
  })

  it("reports two parallel lines, one tangent line, and the empty set", () => {
    const axisParallel = (offset: number) => intersectPlaneQuadric3(plane({ x: 1, y: 0, z: 0 }, -offset), cylinderQuadric3(cylinder))

    const two = axisParallel(1)
    expect(two.kind).toBe("lines")
    expect(two.lines).toHaveLength(2)
    const offsets = two.lines!.map((line) => line.through.t).sort((first, second) => first - second)
    expect(offsets[0]).toBeCloseTo(-Math.sqrt(RADIUS * RADIUS - 1), 12)
    expect(offsets[1]).toBeCloseTo(Math.sqrt(RADIUS * RADIUS - 1), 12)
    // 两条平行线：方向相同、过点不同。
    expect(two.lines![0].direction.t).toBeCloseTo(two.lines![1].direction.t, 12)
    expect(two.lines![0].direction.s).toBeCloseTo(two.lines![1].direction.s, 12)

    expect(axisParallel(RADIUS).kind).toBe("line")
    expect(axisParallel(3).kind).toBe("empty")
    expect(axisParallel(3).lines).toBeUndefined()
  })

  it("classifies cone sections by the angle between the plane and the axis", () => {
    const quadric = coneQuadric3(cone)
    // 半顶角 α = atan(R/h) = 33.69°；平面与轴的夹角 > α → 椭圆族，= α → 抛物线，< α → 双曲线。
    // 平面法向与轴的夹角 θ 满足：θ < 90° − α → 椭圆/圆；θ = 90° − α → 抛物线；θ > 90° − α → 双曲线。
    const cut = (theta: number) => intersectPlaneQuadric3(plane({ x: Math.sin(theta), y: 0, z: Math.cos(theta) }, -Math.cos(theta)), quadric)

    const perpendicular = cut(0)
    expect(perpendicular.kind).toBe("circle")
    // z=1 处的圆半径 = R(1 − z/h) = 4/3。
    expect(perpendicular.semiMajor).toBeCloseTo((RADIUS * (1 - 1 / HEIGHT)), 12)

    expect(cut(degrees(20)).kind).toBe("ellipse")
    expect(cut(Math.atan(HEIGHT / RADIUS)).kind).toBe("parabola")
    expect(cut(degrees(70)).kind).toBe("hyperbola")

    const throughApex = intersectPlaneQuadric3(plane({ x: 0, y: 0, z: 1 }, -HEIGHT), quadric)
    expect(throughApex.kind).toBe("point")
    expect(throughApex.point!.z).toBeCloseTo(HEIGHT, 12)
  })

  it("declares a circle only down to 1e-12 relative axis difference: a 1e-3° tilt is an ellipse", () => {
    const orthogonal = intersectPlaneQuadric3(plane({ x: 0, y: 0, z: 1 }, -1), cylinderQuadric3(cylinder))
    expect(orthogonal.kind).toBe("circle")

    const tilt = degrees(1e-3)
    const tilted = intersectPlaneQuadric3(plane({ x: Math.sin(tilt), y: 0, z: Math.cos(tilt) }, -Math.cos(tilt)), cylinderQuadric3(cylinder))
    expect(tilted.kind).toBe("ellipse")
    expect(tilted.eccentricity).toBeCloseTo(Math.sin(tilt), 8)
    expect(tilted.semiMajor! - tilted.semiMinor!).toBeGreaterThan(0)
  })

  it("turns a rotated cylinder's perpendicular cut into the same exact circle", () => {
    // 绕轴中点 (0,0,1.5) 绕 x 轴转 90°：轴变成沿 −y、过 (0,0,1.5) 的线段。
    const rotated = cylinderQuadric3({ ...cylinder, rotation: { x: degrees(90), y: 0, z: 0 } })
    expect(rotated.bounds!.axis.x).toBeCloseTo(0, 12)
    expect(rotated.bounds!.axis.y).toBeCloseTo(-1, 12)
    expect(rotated.bounds!.origin.x).toBeCloseTo(0, 12)
    expect(rotated.bounds!.origin.z).toBeCloseTo(1.5, 12)

    const conic = intersectPlaneQuadric3(plane({ x: 0, y: 1, z: 0 }, 0), rotated)
    expect(conic.kind).toBe("circle")
    expect(conic.semiMajor).toBeCloseTo(RADIUS, 12)
    expect(conic.center!.y).toBeCloseTo(0, 12)
    expect(conic.center!.z).toBeCloseTo(1.5, 12)
  })

  it("keeps every sampled conic point on the quadric (property)", () => {
    const quadric = cylinderQuadric3(cylinder)
    const conic = intersectPlaneQuadric3(plane({ x: Math.sin(0.4), y: 0, z: Math.cos(0.4) }, -0.7), quadric)
    expect(conic.kind).toBe("ellipse")

    const scale = quadricScaleOf(quadric)
    for (let index = 0; index < 64; index += 1) {
      const point = conic3PointAt(conic, (index / 64) * Math.PI * 2)!
      expect(Math.abs(quadricValueAt(quadric, point))).toBeLessThan(1e-9 * scale * scale)
    }
  })

  it("keeps every sampled parabola point on the cone (property, open curve)", () => {
    const quadric = coneQuadric3(cone)
    const theta = Math.atan(HEIGHT / RADIUS)
    const conic = intersectPlaneQuadric3(plane({ x: Math.sin(theta), y: 0, z: Math.cos(theta) }, -Math.cos(theta)), quadric)
    expect(conic.kind).toBe("parabola")
    expect(conic.focalParameter!).toBeGreaterThan(0)

    const scale = quadricScaleOf(quadric)
    for (let index = -8; index <= 8; index += 1) {
      const point = conic3PointAt(conic, index * 0.3)!
      expect(Math.abs(quadricValueAt(quadric, point))).toBeLessThan(1e-9 * scale * scale)
    }
  })

  it("ignores the polygon segment count: segments is a render hint only", () => {
    const coarse = intersectPlaneQuadric3(plane({ x: 0, y: 0, z: 1 }, -1), cylinderQuadric3({ ...cylinder, segments: 6 }))
    expect(coarse.kind).toBe("circle")
    expect(coarse.semiMajor).toBeCloseTo(RADIUS, 12)
  })

  it("does not invent geometry for a plane's own quadric", () => {
    const conic = intersectPlaneQuadric3(plane({ x: 0, y: 0, z: 1 }, -1), planeQuadric3(plane({ x: 0, y: 0, z: 1 }, 0)))
    // 平面 ∩ 平面是两条重合的平面（不是这里支持的实体求交）：系数退化，如实报退化类型，绝不编折线。
    expect(["line", "lines", "insufficient-data"]).toContain(conic.kind)
  })
})
