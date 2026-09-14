import { describe, expect, it } from "vitest"

import type { Point3Primitive, PrimitiveSpec } from "@draw/dsl"

import { createMeasurement3, measureAngle3 } from "./measurements3d"

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
    expect(angle).toMatchObject({ metric: "angle", value: 90, unit: "°", status: "valid" })
  })

  it("reports degenerate angles instead of inventing a result", () => {
    const angle = measureAngle3("angle-1", ["a", "a", "b"], points[0].position, points[1].position, points[0].position)

    expect(angle.status).toBe("degenerate")
    expect(angle.value).toBeUndefined()
  })

  it("calculates solid volumes and polygon areas", () => {
    const cube: PrimitiveSpec = { id: "cube", type: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 3, z: 4 } }
    const face: PrimitiveSpec = { id: "face", type: "face3", pointIds: ["a", "c", "b"] }
    const volume = createMeasurement3("volume-1", "volume", ["cube"], [...points, cube])
    const area = createMeasurement3("area-1", "area", ["face"], [...points, face])

    expect(volume).toMatchObject({ value: 24, unit: "u³", status: "valid" })
    expect(area).toMatchObject({ value: 6, unit: "u²", status: "valid" })
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

  it("reports the normal-vector angle for a dihedral measurement and discloses the supplement", () => {
    const primitives: PrimitiveSpec[] = [
      { id: "face-a", type: "face3", pointIds: ["a", "b", "c"] },
      { id: "face-b", type: "face3", pointIds: ["a", "b", "d"] },
      { id: "a", type: "point3", position: { x: 0, y: 0, z: 0 } },
      { id: "b", type: "point3", position: { x: 1, y: 0, z: 0 } },
      { id: "c", type: "point3", position: { x: 0, y: 1, z: 0 } },
      { id: "d", type: "point3", position: { x: 0, y: -0.5, z: -Math.sqrt(3) / 2 } }
    ]

    const measurement = createMeasurement3("dihedral-1", "dihedral", ["face-a", "face-b"], primitives)

    expect(measurement.status).toBe("valid")
    expect(measurement.value).toBeCloseTo(120, 5)
    expect(measurement.explanation).toContain("补角")
  })
})
