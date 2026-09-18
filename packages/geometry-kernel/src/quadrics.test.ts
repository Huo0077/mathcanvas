import { describe, expect, it } from "vitest"

import { sectionQuadric3 } from "./section-quadric"
import { circleConic3, coneQuadric3, conic3Area, conic3FromCircle3, conic3Perimeter, conic3PointAt, cylinderQuadric3, intersectPlaneQuadric3, planeQuadric3, quadricScaleOf, quadricValueAt, rimCircles3, type Conic3 } from "./quadrics"

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

  it("builds an exact circle directly and reports the rim circles of round solids", () => {
    const circle = circleConic3({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }, 2)!
    expect(circle.kind).toBe("circle")
    expect(circle.semiMajor).toBe(2)
    expect(circle.eccentricity).toBe(0)
    // 圆上的采样点必须落在圆上（性质检查，不靠肉眼）。
    for (let index = 0; index < 16; index += 1) {
      const point = conic3PointAt(circle, (index / 16) * Math.PI * 2)!
      expect(Math.hypot(point.x, point.y)).toBeCloseTo(2, 12)
      expect(point.z).toBeCloseTo(1, 12)
    }
    expect(circleConic3({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 0)).toBeNull()
    expect(circleConic3({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, Number.NaN)).toBeNull()

    // 圆柱两个边界圆、圆锥一个。
    const rims = rimCircles3(cylinder)
    expect(rims).toHaveLength(2)
    expect(rims.map((conic) => conic.center!.z).sort((first, second) => first - second)).toEqual([0, HEIGHT])
    expect(rims.every((conic) => conic.semiMajor === RADIUS)).toBe(true)
    expect(rimCircles3(cone)).toHaveLength(1)
    // 旋转过的圆柱：边界圆跟着走到旋转后的位置。
    const turned = rimCircles3({ ...cylinder, rotation: { x: degrees(90), y: 0, z: 0 } })
    expect(turned).toHaveLength(2)
    expect(turned[0].center!.z).toBeCloseTo(1.5, 12)
    expect(turned[0].center!.y).toBeCloseTo(1.5, 12)
    expect(turned[1].center!.y).toBeCloseTo(-1.5, 12)
    // 不是圆类实体就没有边界圆。
    expect(rimCircles3({ id: "cube-1", type: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 } })).toEqual([])
  })

  /**
   * **平移到别处的圆柱 / 圆锥**：二次型必须把 `center` 算进去。
   *
   * 这一条是 A2 实现时被探针抓出来的 A1 真缺陷：非旋转分支当年直接返回**局部**矩阵
   *（原点在 `center` 的坐标系里），于是"表面点代回去 ≠ 0"、"平面切出来的圆心在原点"——
   * 画布上那圈解析截面边界会画在离实体很远的地方。应用默认的圆柱就建在 `center=(3,0,0)`，
   * 所以这不是边角情形。
   */
  it("moves the quadric to the solid's own centre (translated solids)", () => {
    const placed = { ...cylinder, center: { x: 3, y: 0, z: 0 } }
    const quadric = cylinderQuadric3(placed)

    // 真正的表面点：半径 2、z=1 ⇒ (5, 0, 1)。代回二次型必须是 0。
    expect(Math.abs(quadricValueAt(quadric, { x: 5, y: 0, z: 1 }))).toBeLessThan(1e-9 * quadricScaleOf(quadric) ** 2)
    expect(Math.abs(quadricValueAt(quadric, { x: 3, y: 2, z: 2 }))).toBeLessThan(1e-9 * quadricScaleOf(quadric) ** 2)
    // 轴上的点不是表面点（半径 0 ≠ 2），残差必须远离 0——否则上面的断言可能只是恒真。
    expect(Math.abs(quadricValueAt(quadric, { x: 3, y: 0, z: 1 }))).toBeGreaterThan(1)

    const conic = intersectPlaneQuadric3(plane({ x: 0, y: 0, z: 1 }, -1), quadric)
    expect(conic.kind).toBe("circle")
    expect(conic.semiMajor).toBeCloseTo(RADIUS, 12)
    expect(conic.center!.x).toBeCloseTo(3, 12)

    // 截面边界也要落在实体所在的位置（这是 A2 分组的成员判定依赖的量）。
    const section = sectionQuadric3(quadric, plane({ x: 0, y: 0, z: 1 }, -1))!
    const conicPiece = section.loops[0].find((piece) => piece.kind === "conic")
    expect(conicPiece).toBeDefined()
    if (conicPiece?.kind === "conic") expect(conicPiece.conic.center!.x).toBeCloseTo(3, 12)
  })

  it("measures circles exactly and ellipses honestly", () => {
    const circle = circleConic3({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }, 2)!
    const circleArea = conic3Area(circle)!
    const circlePerimeter = conic3Perimeter(circle)!
    expect(circleArea.value).toBeCloseTo(Math.PI * 4, 12)
    expect(circleArea.exact).toBe(true)
    expect(circlePerimeter.value).toBeCloseTo(2 * Math.PI * 2, 12)
    expect(circlePerimeter.exact).toBe(true)

    // 椭圆：面积 πab 精确；周长没有初等闭式 → 级数 + 如实标近似。
    // a=2、b=1 的周长是公开参考值 9.688448220547675。
    const ellipse: Conic3 = { ...circle, kind: "ellipse", semiMajor: 2, semiMinor: 1, eccentricity: Math.sqrt(0.75) }
    const ellipseArea = conic3Area(ellipse)!
    const ellipsePerimeter = conic3Perimeter(ellipse)!
    expect(ellipseArea.value).toBeCloseTo(2 * Math.PI, 12)
    expect(ellipseArea.exact).toBe(true)
    expect(ellipsePerimeter.value).toBeCloseTo(9.688448220547675, 8)
    expect(ellipsePerimeter.exact).toBe(false)
    // 周长必须落在 2πb 与 2πa 之间（不靠参考值也知道它合理）。
    expect(ellipsePerimeter.value).toBeGreaterThan(2 * Math.PI * 1)
    expect(ellipsePerimeter.value).toBeLessThan(2 * Math.PI * 2)

    // 开曲线与退化情形没有面积/周长，绝不编数字。
    const parabola = intersectPlaneQuadric3(plane({ x: Math.sin(Math.atan(1.5)), y: 0, z: Math.cos(Math.atan(1.5)) }, -Math.cos(Math.atan(1.5))), coneQuadric3(cone))
    expect(conic3Area(parabola)).toBeNull()
    expect(conic3Perimeter(parabola)).toBeNull()
    expect(conic3Area({ ...circle, semiMajor: 0 })).toBeNull()
  })

  it("turns a document circle3 into an analytic circle at its own centre", () => {
    // 圆心是图元自己的字段：解析圆不再需要点表（签名里也没有它了）。
    const conic = conic3FromCircle3({ id: "circle3-1", type: "circle3", center: { x: 1, y: 2, z: 3 }, normal: { x: 0, y: 1, z: 0 }, radius: 1.5 })!
    expect(conic.kind).toBe("circle")
    expect(conic.center).toEqual({ x: 1, y: 2, z: 3 })
    expect(conic.semiMajor).toBe(1.5)
    expect(conic.frame.normal.y).toBeCloseTo(1, 12)
    // 退化输入如实返回 null：非有限圆心、零法向、非正半径。
    expect(conic3FromCircle3({ id: "circle3-2", type: "circle3", center: { x: Number.NaN, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, radius: 1 })).toBeNull()
    expect(conic3FromCircle3({ id: "circle3-3", type: "circle3", center: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 0 }, radius: 1 })).toBeNull()
    expect(conic3FromCircle3({ id: "circle3-4", type: "circle3", center: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, radius: 0 })).toBeNull()
  })
})
