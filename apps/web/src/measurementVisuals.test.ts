import { describe, expect, it } from "vitest"

import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"

import { measurementLabelScale, resolveMeasurementVisual } from "./measurementVisuals"

function tetrahedronDocument(): GeometryDocument {
  const document = createEmptyDocument("geometry3d")
  document.primitives = [
    { id: "point-a", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "free" } },
    { id: "point-b", type: "point3", position: { x: 1, y: 0, z: 0 }, binding: { kind: "free" } },
    { id: "point-c", type: "point3", position: { x: 0, y: 1, z: 0 }, binding: { kind: "free" } },
    { id: "point-d", type: "point3", position: { x: 0, y: 0, z: 1 }, binding: { kind: "free" } },
    { id: "face-abc", type: "face3", pointIds: ["point-a", "point-b", "point-c"] },
    { id: "face-abd", type: "face3", pointIds: ["point-a", "point-b", "point-d"] }
  ]
  document.measurements = [{ id: "dihedral-1", kind: "measurement3", sourceIds: ["face-abc", "face-abd"], metric: "dihedral", dihedralKind: "interior", value: 90, unit: "°", precision: "numeric-approximation", status: "valid", explanation: "二面角测试" }]
  return document
}

describe("3D measurement visuals", () => {
  it("resolves a valid dihedral measurement with its actual stored value", () => {
    const visual = resolveMeasurementVisual(tetrahedronDocument(), "dihedral-1")

    expect(visual?.kind).toBe("dihedral")
    expect(visual?.label).toContain("90.000°")
    expect(visual?.sourceIds).toEqual(["face-abc", "face-abd"])
    expect(visual?.arc?.length).toBeGreaterThan(2)
    expect(visual?.segments).toHaveLength(3)
  })

  it("returns null for an invalid measurement instead of inventing coordinates", () => {
    const document = tetrahedronDocument()
    document.measurements[0].status = "insufficient-data"

    expect(resolveMeasurementVisual(document, "dihedral-1")).toBeNull()
  })

  it("keeps label scale within readable bounds as the camera changes", () => {
    const near = measurementLabelScale(2, 800)
    const far = measurementLabelScale(200, 800)

    expect(far).toBeGreaterThan(near)
    expect(near).toBeLessThanOrEqual(2)
    expect(far).toBeGreaterThanOrEqual(0.35)
  })
})
