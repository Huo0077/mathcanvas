import { describe, expect, it } from "vitest"

import { cylinderQuadric3, circleConic3, coneQuadric3, intersectPlaneQuadric3 } from "@draw/geometry-kernel"

import { conicKindLabel, conicMetrics, exactConicOf, fullClosedConicOf, sectionConicMetrics } from "./conicMetrics"

const cylinder = { id: "cylinder-1", type: "cylinder" as const, center: { x: 0, y: 0, z: 0 }, radius: 2, height: 3, segments: 48 }
const cone = { id: "cone-1", type: "cone" as const, center: { x: 0, y: 0, z: 0 }, radius: 2, height: 3, segments: 48 }
const plane = (normal: { x: number; y: number; z: number }, constant: number) => ({ normal, constant })
const degrees = (value: number) => (value * Math.PI) / 180
const rowValue = (rows: { label: string; value: string }[], label: string) => rows.find((row) => row.label === label)?.value

describe("conic readouts for the inspector", () => {
  it("describes a circle by centre, radius and zero eccentricity", () => {
    const circle = intersectPlaneQuadric3(plane({ x: 0, y: 0, z: 1 }, -1), cylinderQuadric3(cylinder))
    const rows = conicMetrics(circle)

    expect(rowValue(rows, "结论")).toBe("圆")
    expect(rowValue(rows, "圆心")).toBe("(0.000, 0.000, 1.000)")
    expect(rowValue(rows, "半径")).toBe("2.000")
    expect(rowValue(rows, "离心率")).toBe("0.000")
    // 圆不报"长短半轴"：它就是半径。
    expect(rowValue(rows, "长半轴")).toBeUndefined()
  })

  it("describes an ellipse by both semi-axes, eccentricity and foci", () => {
    const theta = degrees(30)
    const ellipse = intersectPlaneQuadric3(plane({ x: Math.sin(theta), y: 0, z: Math.cos(theta) }, 0), cylinderQuadric3(cylinder))
    const rows = conicMetrics(ellipse)

    expect(rowValue(rows, "结论")).toBe("椭圆")
    expect(rowValue(rows, "长半轴")).toBe("2.309")
    expect(rowValue(rows, "短半轴")).toBe("2.000")
    expect(rowValue(rows, "离心率")).toBe("0.500")
    expect(rowValue(rows, "焦点")).toMatch(/^-?\(/)
  })

  it("describes parabola and hyperbola with their own vocabulary", () => {
    const parabola = intersectPlaneQuadric3(plane({ x: Math.sin(Math.atan(1.5)), y: 0, z: Math.cos(Math.atan(1.5)) }, -Math.cos(Math.atan(1.5))), coneQuadric3(cone))
    const parabolaRows = conicMetrics(parabola)
    expect(rowValue(parabolaRows, "结论")).toBe("抛物线")
    expect(rowValue(parabolaRows, "顶点")).toMatch(/^\(/)
    expect(rowValue(parabolaRows, "焦准距 p")).toBeDefined()

    const hyperbola = intersectPlaneQuadric3(plane({ x: Math.sin(degrees(70)), y: 0, z: Math.cos(degrees(70)) }, -Math.cos(degrees(70))), coneQuadric3(cone))
    const hyperbolaRows = conicMetrics(hyperbola)
    expect(rowValue(hyperbolaRows, "结论")).toBe("双曲线")
    expect(rowValue(hyperbolaRows, "实半轴")).toBeDefined()
    expect(rowValue(hyperbolaRows, "虚半轴")).toBeDefined()
    expect(Number(rowValue(hyperbolaRows, "离心率"))).toBeGreaterThan(1)
  })

  it("reports degenerate and empty conclusions without inventing numbers", () => {
    const emptyRows = conicMetrics(intersectPlaneQuadric3(plane({ x: 1, y: 0, z: 0 }, -3), cylinderQuadric3(cylinder)))
    expect(rowValue(emptyRows, "结论")).toBe("空集（平面没切到实体）")
    expect(emptyRows).toHaveLength(1)

    const linesRows = conicMetrics(intersectPlaneQuadric3(plane({ x: 1, y: 0, z: 0 }, -1), cylinderQuadric3(cylinder)))
    expect(rowValue(linesRows, "结论")).toBe("两条直线")
    expect(rowValue(linesRows, "直线条数")).toBe("2")
    expect(conicKindLabel("point")).toBe("一点")
  })

  it("finds the conic inside a section's piece loop and stays honest without one", () => {
    const conic = circleConic3({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }, 2)!
    const section = {
      id: "section-1", type: "section" as const, sourceId: "cylinder-1",
      plane: { normal: { x: 0, y: 0, z: 1 }, constant: -1 },
      points: [], classification: "polygon" as const, status: "exact" as const,
      exact: { kind: "circle" as const, loops: [[{ kind: "segment" as const, a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 } }, { kind: "conic" as const, conic, parameterRange: [0, Math.PI] as [number, number] }]] }
    }
    expect(exactConicOf(section)?.kind).toBe("circle")
    // 旧文档（没有 exact 字段）如实返回 null，检查器就不显示解析读数。
    expect(exactConicOf({ ...section, exact: undefined })).toBeNull()
    expect(exactConicOf({ ...section, exact: { kind: "lines" as const, loops: [] } })).toBeNull()
    expect(sectionConicMetrics({ ...section, exact: undefined })).toEqual([])
  })

  /**
   * 面积 / 周长只在**整条圆锥曲线没被端面裁切**时才有闭式。
   * 被裁切的截面（椭圆弧 + 端面弦）拿 `πab` 冒充面积就是一个看着有效、其实错的读数。
   */
  it("reports exact closed-form area and perimeter only for an unclipped conic", () => {
    const circle = circleConic3({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }, 2)!
    const whole = {
      id: "section-1", type: "section" as const, sourceId: "cylinder-1",
      plane: { normal: { x: 0, y: 0, z: 1 }, constant: -1 },
      points: [], classification: "polygon" as const, status: "exact" as const,
      exact: { kind: "circle" as const, loops: [[{ kind: "conic" as const, conic: circle, parameterRange: [0, Math.PI * 2] as [number, number] }]] }
    }
    const rows = sectionConicMetrics(whole)
    expect(rowValue(rows, "面积")).toBe("12.566（πab 精确）")
    expect(rowValue(rows, "周长")).toBe("12.566（2πr 精确）")
    expect(fullClosedConicOf(whole)?.kind).toBe("circle")

    // 椭圆：面积精确、周长如实标"数值近似"。
    const ellipse = { ...circle, kind: "ellipse" as const, semiMajor: 2, semiMinor: 1 }
    const ellipseRows = sectionConicMetrics({ ...whole, exact: { kind: "ellipse" as const, loops: [[{ kind: "conic" as const, conic: ellipse, parameterRange: [0, Math.PI * 2] as [number, number] }]] } })
    expect(rowValue(ellipseRows, "面积")).toBe("6.283（πab 精确）")
    expect(rowValue(ellipseRows, "周长")).toContain("椭圆级数，数值近似")

    // 被端面裁切（椭圆弧 + 一段弦）：面积如实说"由端面裁切"，不给 πab。
    const clipped = { ...whole, exact: { kind: "ellipse" as const, loops: [[{ kind: "conic" as const, conic: ellipse, parameterRange: [0.3, 2.4] as [number, number] }, { kind: "segment" as const, a: { x: 1, y: 0, z: 0 }, b: { x: 0, y: 1, z: 0 } }]] } }
    expect(fullClosedConicOf(clipped)).toBeNull()
    expect(rowValue(sectionConicMetrics(clipped), "面积")).toBe("由端面裁切，无解析闭式")
    expect(rowValue(sectionConicMetrics(clipped), "周长")).toBeUndefined()
  })
})
