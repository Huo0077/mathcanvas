import { describe, expect, it } from "vitest"

import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"

import { measurementLabelScale, measurementVisualsForDocument, resolveMeasurementVisual } from "./measurementVisuals"

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

  /**
   * 测量数字**常驻画布**（slice 5）：不选中任何对象也要有标签。
   *
   * 用户口径："我希望数学测量的结果能在图中浮现一个数字，而不是非要去看右侧属性栏。"
   * 这条用例的语义就是"这个函数根本**没有**选择参数"——常驻不是靠调用方记得别过滤，
   * 而是这里压根拿不到选中集合。退化 / 值非有限仍然一个都不画。
   */
  it("draws every valid measurement without asking what is selected, and nothing for a broken one", () => {
    const document = tetrahedronDocument()
    expect(measurementVisualsForDocument(document)).toHaveLength(1)

    // 再加一条有效测量：两条都常驻（不是只有某一条）。
    document.measurements.push({ id: "length-1", kind: "measurement3", sourceIds: ["point-a", "point-b"], metric: "length", value: 1, unit: "u", precision: "numeric-approximation", status: "valid", explanation: "" })
    expect(measurementVisualsForDocument(document).map((visual) => visual.id)).toEqual(["dihedral-1", "length-1"])

    // 退化 / 数据不足 / 值缺失：不画。
    const broken = tetrahedronDocument()
    broken.measurements.push({ id: "area-1", kind: "measurement3", sourceIds: ["point-a", "point-b", "point-c"], metric: "area", status: "degenerate", precision: "numeric-approximation", explanation: "三点共线" })
    broken.measurements.push({ id: "length-2", kind: "measurement3", sourceIds: ["point-a", "point-b"], metric: "length", status: "valid", precision: "numeric-approximation", explanation: "" })
    expect(measurementVisualsForDocument(broken).map((visual) => visual.id)).toEqual(["dihedral-1"])
  })
})
