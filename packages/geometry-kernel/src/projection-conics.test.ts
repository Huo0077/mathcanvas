import { describe, expect, it } from "vitest"

import { projectConic3 } from "./projection-conics"
import { projectVector3 } from "./projections3d"
import { circleConic3, coneQuadric3, cylinderQuadric3, intersectPlaneQuadric3, type Conic3 } from "./quadrics"

const RADIUS = 2
const HEIGHT = 3
const cylinder = { id: "cylinder-1", type: "cylinder" as const, center: { x: 0, y: 0, z: 0 }, radius: RADIUS, height: HEIGHT, segments: 48 }
const cone = { id: "cone-1", type: "cone" as const, center: { x: 0, y: 0, z: 0 }, radius: RADIUS, height: HEIGHT, segments: 48 }
const degrees = (value: number) => (value * Math.PI) / 180

/** 平面 `n·x + c = 0`。 */
const plane = (normal: { x: number; y: number; z: number }, constant: number) => ({ normal, constant })

/**
 * 一个半径为 `radius` 的圆，其平面法向取 `(sin θ, 0, cos θ)`。
 *
 * `front` 视图的视线（depth 轴）是 `+z`，所以**视线与圆平面法向的夹角恰好是 θ**——
 * 这是"离心率 = sin θ"这条验收断言唯一依赖的量。
 */
function tiltedCircle(theta: number, radius = 2.5, center = { x: 1, y: -2, z: 3 }): Conic3 {
  const conic = circleConic3(center, { x: Math.sin(theta), y: 0, z: Math.cos(theta) }, radius)
  if (!conic) throw new Error("circleConic3 refused the fixture circle")
  return conic
}

/** 投影椭圆的离心率闭式：`e = √(1 − b²/a²)`。 */
function eccentricityOf(semiMajor: number, semiMinor: number): number {
  return Math.sqrt(Math.max(0, 1 - (semiMinor / semiMajor) ** 2))
}

function ellipseOf(conic: Conic3, view: Parameters<typeof projectConic3>[1]) {
  const projected = projectConic3(conic, view)
  if (projected?.kind !== "ellipse") throw new Error(`expected an ellipse record, got ${projected?.kind ?? "null"}`)
  return projected
}

describe("analytic projection of a space conic (A1 §5.5 item 7)", () => {
  it("projects a face-on circle to a circle at the projected centre", () => {
    const center = { x: 1, y: -2, z: 3 }
    const projected = ellipseOf(tiltedCircle(0, 2.5, center), "front")

    // 圆心就是投影后的中心：投影约定必须与 `projectVector3` 逐位一致（含 depth）。
    expect(projected.center).toEqual(projectVector3(center, "front"))
    // 正对视线时两个半轴都等于半径：不许把圆报成有离心率的椭圆。
    expect(projected.semiMajor).toBeCloseTo(projected.semiMinor, 9)
    expect(projected.semiMajor).toBeCloseTo(2.5, 12)
    expect(projected.semiMinor).toBeCloseTo(2.5, 12)
  })

  it("projects a 30° and a 60° tilt to an ellipse with eccentricity sin θ", () => {
    const radius = 2.5
    for (const angle of [30, 60]) {
      const theta = degrees(angle)
      const projected = ellipseOf(tiltedCircle(theta, radius), "front")

      // 验收：视线与圆平面法向成 θ 时，投影椭圆的离心率精确是 sin θ。
      expect(eccentricityOf(projected.semiMajor, projected.semiMinor)).toBeCloseTo(Math.sin(theta), 9)
      /**
       * 该夹具绕 y 轴倾斜：长半轴仍是半径（它落在与视线垂直的方向上），
       * 短半轴被压缩成 `r·cos θ`——半轴本身也要对得上，不能只有一个离心率凑巧正确。
       */
      expect(projected.semiMajor).toBeCloseTo(radius, 9)
      expect(projected.semiMinor).toBeCloseTo(radius * Math.cos(theta), 9)
      // 长轴方向是竖直的：`rotation` 是**投影二维坐标系**里的角（从水平轴量起），这里应是 ±90°。
      expect(Math.abs(Math.sin(projected.rotation))).toBeCloseTo(1, 9)
    }
  })

  it("projects a non-circular ellipse input too (a 30° cylinder cut seen along the axis is a circle again)", () => {
    /**
     * 斜切圆柱得到的是**椭圆**（`kind: "ellipse"`，`a = R/cos α ≠ b = R`），不是圆——它同样要能解析投影。
     * 沿柱轴（`front`）看回去：长轴方向 `v` 与视线的夹角把它压回 `cos α` 倍，短轴不动，
     * 于是投影恰好又是半径 `R` 的**圆**。这条断言同时钉住"支持椭圆"与"半轴确实分开参与投影"。
     */
    const alpha = degrees(30)
    const cut = intersectPlaneQuadric3(plane({ x: Math.sin(alpha), y: 0, z: Math.cos(alpha) }, 0), cylinderQuadric3(cylinder))
    expect(cut.kind).toBe("ellipse")
    expect(cut.semiMajor).toBeCloseTo(RADIUS / Math.cos(alpha), 12)
    expect(cut.semiMinor).toBeCloseTo(RADIUS, 12)

    const projected = ellipseOf(cut, "front")

    expect(projected.semiMajor).toBeCloseTo(RADIUS, 9)
    expect(projected.semiMinor).toBeCloseTo(RADIUS, 9)
    expect(eccentricityOf(projected.semiMajor, projected.semiMinor)).toBeCloseTo(0, 9)
  })

  it("reports an edge-on circle as a segment instead of a zero-area ellipse", () => {
    const projected = projectConic3(tiltedCircle(Math.PI / 2, 2.5, { x: 0, y: 0, z: 0 }), "front")

    // 视线落在圆平面内（θ = 90°）时像是**线段**：如实报线段，不报压扁的椭圆。
    expect(projected?.kind).toBe("segment")
    if (projected?.kind !== "segment") throw new Error("an edge-on circle must project to a segment")
    expect(Math.hypot(projected.a.x - projected.b.x, projected.a.y - projected.b.y)).toBeCloseTo(5, 9)
    // 端点是圆上真实的点：中点就是圆心的投影。
    expect((projected.a.x + projected.b.x) / 2).toBeCloseTo(0, 9)
    expect((projected.a.y + projected.b.y) / 2).toBeCloseTo(0, 9)
    expect(projected.a.depth).toBeCloseTo(0, 9)
    expect(projected.b.depth).toBeCloseTo(0, 9)
  })

  it("refuses non-circular conics, degenerate input, and non-finite coordinates", () => {
    const quadric = coneQuadric3(cone)
    const coneCut = (theta: number) => intersectPlaneQuadric3(plane({ x: Math.sin(theta), y: 0, z: Math.cos(theta) }, -Math.cos(theta)), quadric)
    // 半顶角 α = atan(R/h)；平面法向与轴成 90° − α 时平面平行于一条母线 → 抛物线，> 该角 → 双曲线。
    const parabola = coneCut(Math.atan(HEIGHT / RADIUS))
    const hyperbola = coneCut(degrees(70))
    // 圆柱：平行于轴的平面给出两条平行线，相切平面（偏移 = R）给出一条直线。
    const cylinderQuadric = cylinderQuadric3(cylinder)
    const lines = intersectPlaneQuadric3(plane({ x: 1, y: 0, z: 0 }, -1), cylinderQuadric)
    const line = intersectPlaneQuadric3(plane({ x: 1, y: 0, z: 0 }, -RADIUS), cylinderQuadric)

    // 先确认夹具本身分类正确，否则"返回 null"的断言可能只是因为夹具造错了。
    expect(parabola.kind).toBe("parabola")
    expect(hyperbola.kind).toBe("hyperbola")
    expect(lines.kind).toBe("lines")
    expect(line.kind).toBe("line")
    for (const conic of [parabola, hyperbola, lines, line]) expect(projectConic3(conic, "front")).toBeNull()

    // 退化输入一律 null：缺数据、退化成一点、半径为零、坐标非有限——不编一个"看着像"的椭圆。
    const circle = tiltedCircle(0)
    expect(projectConic3({ ...circle, kind: "point" }, "front")).toBeNull()
    expect(projectConic3({ ...circle, center: undefined }, "front")).toBeNull()
    expect(projectConic3({ ...circle, axes: undefined }, "front")).toBeNull()
    expect(projectConic3({ ...circle, semiMinor: 0 }, "front")).toBeNull()
    expect(projectConic3({ ...circle, center: { x: Number.NaN, y: 0, z: 0 } }, "front")).toBeNull()
  })
})
