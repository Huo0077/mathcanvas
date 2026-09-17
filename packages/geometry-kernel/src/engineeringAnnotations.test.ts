import { createEmptyDocument, type EngineeringAnnotation, type GeometryDocument, type PrimitiveSpec } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { resolveEngineeringAnnotation } from "./engineeringAnnotations"

function pointDocument(primitives: PrimitiveSpec[]): GeometryDocument {
  return { ...createEmptyDocument("cad"), coordinateSystems: ["cartesian-3d"], primitives }
}

const points: PrimitiveSpec[] = [
  { id: "point-a", type: "point3", position: { x: 0, y: 0, z: 0 } },
  { id: "point-b", type: "point3", position: { x: 3, y: 4, z: 0 } },
  { id: "point-c", type: "point3", position: { x: 3, y: 0, z: 0 } },
  { id: "edge-ab", type: "edge3", pointIds: ["point-a", "point-b"] }
]

function annotation(overrides: Partial<EngineeringAnnotation>): EngineeringAnnotation {
  return {
    id: "annotation-1",
    kind: "linear",
    sourceIds: ["point-a", "point-b"],
    view: "front",
    unit: "mm",
    status: "valid",
    explanation: "",
    ...overrides
  }
}

describe("engineering annotation calculations", () => {
  it("calculates a valid linear dimension from two point sources", () => {
    const result = resolveEngineeringAnnotation(pointDocument(points), annotation({}))

    expect(result.status).toBe("valid")
    expect(result.value).toBe(5)
    expect(result.position).toMatchObject({ x: 1.5, y: 2, depth: 0 })
  })

  it("calculates an angle from three point sources", () => {
    const result = resolveEngineeringAnnotation(pointDocument(points), annotation({ kind: "angular", sourceIds: ["point-a", "point-c", "point-b"], unit: "deg" }))

    expect(result.status).toBe("valid")
    expect(result.value).toBe(90)
    expect(result.unit).toBe("deg")
  })

  it("accepts an edge source for a linear dimension", () => {
    const result = resolveEngineeringAnnotation(pointDocument(points), annotation({ sourceIds: ["edge-ab"] }))

    expect(result.status).toBe("valid")
    expect(result.value).toBe(5)
  })

  /**
   * 体检发现的真缺陷：两条棱的角度固定用**第一条棱的起点**当顶点。
   * 折线拐角（一条棱的终点正好是另一条棱的起点）是最常见的用法，量出来的却是错的角：
   * A=(0,0,0)-(1,0,0) 与 B=(1,0,0)-(1,1,0) 在公共端点处的夹角是 90°，旧实现算成 45°。
   */
  it("measures an angle between two edges at their shared endpoint", () => {
    const document = pointDocument([
      { id: "point-a", type: "point3", position: { x: 0, y: 0, z: 0 } },
      { id: "point-b", type: "point3", position: { x: 1, y: 0, z: 0 } },
      { id: "point-c", type: "point3", position: { x: 1, y: 1, z: 0 } },
      { id: "edge-ab", type: "edge3", pointIds: ["point-a", "point-b"] },
      { id: "edge-bc", type: "edge3", pointIds: ["point-b", "point-c"] }
    ])

    const result = resolveEngineeringAnnotation(document, annotation({ kind: "angular", sourceIds: ["edge-ab", "edge-bc"], unit: "deg" }))

    expect(result.status).toBe("valid")
    expect(result.value).toBeCloseTo(90, 9)
  })

  it("reports an angle between edges that share nothing as insufficient data", () => {
    const document = pointDocument([
      { id: "point-a", type: "point3", position: { x: 0, y: 0, z: 0 } },
      { id: "point-b", type: "point3", position: { x: 1, y: 0, z: 0 } },
      { id: "point-c", type: "point3", position: { x: 0, y: 5, z: 0 } },
      { id: "point-d", type: "point3", position: { x: 1, y: 5, z: 0 } },
      { id: "edge-ab", type: "edge3", pointIds: ["point-a", "point-b"] },
      { id: "edge-cd", type: "edge3", pointIds: ["point-c", "point-d"] }
    ])

    const result = resolveEngineeringAnnotation(document, annotation({ kind: "angular", sourceIds: ["edge-ab", "edge-cd"], unit: "deg" }))

    expect(result.status).toBe("insufficient-data")
    expect(result.value).toBeUndefined()
  })

  it("returns insufficient data without inventing a position for missing sources", () => {
    const result = resolveEngineeringAnnotation(pointDocument(points), annotation({ sourceIds: ["missing-point", "point-b"] }))

    expect(result.status).toBe("insufficient-data")
    expect(result.value).toBeUndefined()
    expect(result.position).toBeUndefined()
  })

  it("returns a degenerate status for zero-length dimensions", () => {
    const document = pointDocument([{ id: "point-a", type: "point3", position: { x: 1, y: 1, z: 1 } }, { id: "point-b", type: "point3", position: { x: 1, y: 1, z: 1 } }])
    const result = resolveEngineeringAnnotation(document, annotation({}))

    expect(result.status).toBe("degenerate")
    expect(result.value).toBeUndefined()
    expect(result.position).toBeUndefined()
  })
})
