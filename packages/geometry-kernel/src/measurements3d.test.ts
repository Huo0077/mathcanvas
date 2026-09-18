import { describe, expect, it } from "vitest"

import type { Point3Primitive, PrimitiveSpec } from "@draw/dsl"

import { calculateMeasurement3, createMeasurement3, measureAngle3 } from "./measurements3d"

const points: Point3Primitive[] = [
  { id: "a", type: "point3", position: { x: 0, y: 0, z: 0 } },
  { id: "b", type: "point3", position: { x: 3, y: 4, z: 0 } },
  { id: "c", type: "point3", position: { x: 3, y: 0, z: 0 } },
  { id: "d", type: "point3", position: { x: 0, y: 0, z: 2 } }
]

describe("3D measurements", () => {
  it("measures point distance and angle with explainable sources", () => {
    const distance = createMeasurement3("distance-1", "distance", ["a", "b"], points)
    const angle = createMeasurement3("angle-1", "angle", ["a", "c", "b"], points)

    expect(distance).toMatchObject({ metric: "distance", value: 5, unit: "u", status: "valid", precision: "numeric-approximation" })
    expect(distance.explanation).toContain("两个空间点")
    /**
     * **角度一律用弧度**（2026-09-17 用户决定："改成弧度"）。
     *
     * 平面测量的角本来就是弧度（内核 `evaluatePlanarMeasurement` 的约定），立体这边原来是度 ⇒
     * 同一个应用里两种角的单位，画布上的数与导出都跟着分裂。现在两边统一到弧度：
     * `value` 是弧度、`unit` 是 `"rad"`，画布标签与属性栏显示的就是这个数（一个测量只有一个数）。
     */
    expect(angle).toMatchObject({ metric: "angle", value: Math.PI / 2, unit: "rad", status: "valid" })
    expect(angle.value).toBeCloseTo(Math.PI / 2, 12)
  })

  it("reports degenerate angles instead of inventing a result", () => {
    const angle = measureAngle3("angle-1", ["a", "a", "b"], points[0].position, points[1].position, points[0].position)

    expect(angle.status).toBe("degenerate")
    expect(angle.value).toBeUndefined()
  })

  /**
   * A1 第 5 片：`precision` 的语义是"读数是不是**闭式**给的"。
   *
   * 圆柱 `πr²h`、圆锥 `πr²h/3`、立方体 / 棱锥体积、空间圆面积 `πr²`、平面多边形面积都是闭式，
   * 标 `"exact-input"`；多面体体积是**网格求和**（对 48 边形的圆柱 / 圆锥就是不精确的），
   * 距离 / 长度 / 角度 / 二面角由坐标推出，保持 `"numeric-approximation"`——不许把近似说成精确。
   */
  it("marks closed-form readings exact and mesh sums approximate", () => {
    const cylinder: PrimitiveSpec = { id: "cylinder", type: "cylinder", center: { x: 0, y: 0, z: 0 }, radius: 2, height: 3, segments: 48 }
    const cone: PrimitiveSpec = { id: "cone", type: "cone", center: { x: 0, y: 0, z: 0 }, radius: 2, height: 3, segments: 48 }
    const cube: PrimitiveSpec = { id: "cube", type: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 3, z: 4 } }
    const circle3: PrimitiveSpec = { id: "circle3", type: "circle3", centerId: "point-a", normal: { x: 0, y: 0, z: 1 }, radius: 2 }
    const primitives = [cylinder, cone, cube, circle3]

    const measure = (metric: "volume" | "area", sourceIds: string[]) =>
      calculateMeasurement3({ id: "m", kind: "measurement3", sourceIds, metric, precision: "numeric-approximation", status: "valid", explanation: "" }, primitives)

    const cylinderVolume = measure("volume", ["cylinder"])
    expect(cylinderVolume.value).toBeCloseTo(Math.PI * 4 * 3, 12)
    expect(cylinderVolume.precision).toBe("exact-input")

    const coneVolume = measure("volume", ["cone"])
    expect(coneVolume.value).toBeCloseTo((Math.PI * 4 * 3) / 3, 12)
    expect(coneVolume.precision).toBe("exact-input")

    expect(measure("volume", ["cube"]).precision).toBe("exact-input")
    expect(measure("volume", ["cube"]).value).toBe(24)

    const circleArea = measure("area", ["circle3"])
    expect(circleArea.value).toBeCloseTo(Math.PI * 4, 12)
    expect(circleArea.precision).toBe("exact-input")

    // 多面体（网格集合）体积保持近似：48 边形的圆柱体积**不是** πr²h。
    const polyhedron: PrimitiveSpec = { id: "poly", type: "polyhedron3", vertexIds: ["p0", "p1", "p2", "p3"], edgeIds: [], faceIds: ["f0", "f1", "f2", "f3"] }
    expect(calculateMeasurement3({ id: "m2", kind: "measurement3", sourceIds: ["poly"], metric: "volume", precision: "numeric-approximation", status: "valid", explanation: "" }, [polyhedron]).precision).toBe("numeric-approximation")
  })

  it("calculates solid volumes and polygon areas", () => {
    const cube: PrimitiveSpec = { id: "cube", type: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 3, z: 4 } }
    const face: PrimitiveSpec = { id: "face", type: "face3", pointIds: ["a", "c", "b"] }
    const volume = createMeasurement3("volume-1", "volume", ["cube"], [...points, cube])
    const area = createMeasurement3("area-1", "area", ["face"], [...points, face])

    expect(volume).toMatchObject({ value: 24, unit: "u³", status: "valid" })
    expect(area).toMatchObject({ value: 6, unit: "u²", status: "valid" })
  })

  /**
   * 同一次体检：平面法向数量级过小时 `normalizeVector3` 返回零向量，点积恒为 0，
   * "点到平面的距离"被算成 0——一个看着有效、其实毫无意义的读数。必须报数据不足。
   */
  it("reports a degenerate plane normal instead of a zero distance", () => {
    const tinyPlane: PrimitiveSpec = { id: "tiny-plane", type: "plane3", definition: { kind: "pointNormal", pointId: "a", normal: { x: 1e-30, y: 0, z: 0 } } }
    const tiny = createMeasurement3("distance-tiny", "distance", ["d", "tiny-plane"], [...points, tinyPlane])
    const scaledPlane: PrimitiveSpec = { id: "scaled-plane", type: "plane3", definition: { kind: "pointNormal", pointId: "a", normal: { x: 0, y: 0, z: 5 } } }
    const scaled = createMeasurement3("distance-scaled", "distance", ["d", "scaled-plane"], [...points, scaledPlane])

    expect(tiny.status).toBe("insufficient-data")
    expect(tiny.value).toBeUndefined()
    // 非单位但可归一化的法向照常工作：点 d 到 z=0 平面的距离是 2。
    expect(scaled).toMatchObject({ value: 2, status: "valid" })
  })

  it("returns insufficient data for missing sources", () => {
    const measurement = createMeasurement3("length-1", "length", ["missing"], points)

    expect(measurement.status).toBe("insufficient-data")
    expect(measurement.explanation).toContain("不存在")
  })

  it("does not measure a point-to-plane distance from the origin when the plane point is missing", () => {
    const primitives: PrimitiveSpec[] = [
      { id: "p", type: "point3", position: { x: 0, y: 0, z: 5 } },
      { id: "plane", type: "plane3", definition: { kind: "pointNormal", pointId: "missing", normal: { x: 0, y: 0, z: 1 } } }
    ]

    const measurement = createMeasurement3("distance-1", "distance", ["p", "plane"], primitives)

    expect(measurement.status).toBe("insufficient-data")
    expect(measurement.value).toBeUndefined()
  })

  it("reports the interior dihedral with its common edge and discloses the supplement", () => {
    const primitives: PrimitiveSpec[] = [
      { id: "face-a", type: "face3", pointIds: ["a", "b", "c"] },
      { id: "face-b", type: "face3", pointIds: ["a", "b", "d"] },
      { id: "a", type: "point3", position: { x: 0, y: 0, z: 0 } },
      { id: "b", type: "point3", position: { x: 1, y: 0, z: 0 } },
      { id: "c", type: "point3", position: { x: 0, y: 1, z: 0 } },
      { id: "d", type: "point3", position: { x: 0, y: -0.5, z: -Math.sqrt(3) / 2 } }
    ]

    const measurement = createMeasurement3("dihedral-1", "dihedral", ["face-a", "face-b"], primitives)
    const exterior = createMeasurement3("dihedral-2", "dihedral", ["face-a", "face-b"], primitives, "exterior")

    expect(measurement.status).toBe("valid")
    expect(measurement.dihedralKind).toBe("interior")
    // 弧度（与平面测量同一套单位）：120° = 2π/3，补角 60° = π/3。
    expect(measurement.value).toBeCloseTo((2 * Math.PI) / 3, 9)
    expect(measurement.unit).toBe("rad")
    expect(measurement.explanation).toContain("补角")
    // 说明文字里的数必须与 `value` 同一个单位，否则读数与解释自相矛盾。
    expect(measurement.explanation).toContain("rad")
    expect(measurement.explanation).not.toContain("°")
    expect(measurement.explanation).toContain("公共棱：a、b")
    expect(exterior).toMatchObject({ dihedralKind: "exterior", status: "valid", unit: "rad" })
    expect(exterior.value).toBeCloseTo(Math.PI / 3, 9)
  })

  it("reports insufficient data when the two faces do not share an edge", () => {
    const primitives: PrimitiveSpec[] = [
      { id: "face-a", type: "face3", pointIds: ["a", "b", "c"] },
      { id: "face-b", type: "face3", pointIds: ["a", "d", "e"] },
      { id: "a", type: "point3", position: { x: 0, y: 0, z: 0 } },
      { id: "b", type: "point3", position: { x: 1, y: 0, z: 0 } },
      { id: "c", type: "point3", position: { x: 0, y: 1, z: 0 } },
      { id: "d", type: "point3", position: { x: 0, y: 0, z: 1 } },
      { id: "e", type: "point3", position: { x: 1, y: 0, z: 1 } }
    ]

    const measurement = createMeasurement3("dihedral-3", "dihedral", ["face-a", "face-b"], primitives)

    expect(measurement.status).toBe("insufficient-data")
    expect(measurement.value).toBeUndefined()
  })
})
