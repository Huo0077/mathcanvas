import { describe, expect, it } from "vitest"

import type { ConstraintSpec, PrimitiveSpec } from "@draw/dsl"

import { constraintResidual3, diagnoseConstraint3, solvePoint3Constraints } from "./constraints3d"

const points: PrimitiveSpec[] = [
  { id: "a", type: "point3", position: { x: 0, y: 0, z: 0 } },
  { id: "b", type: "point3", position: { x: 1, y: 0, z: 0 } },
  { id: "c", type: "point3", position: { x: 0, y: 1, z: 0 } },
  { id: "d", type: "point3", position: { x: 0, y: 0, z: 1 } },
  { id: "line", type: "line3", definition: { kind: "throughPoints", pointIds: ["a", "b"] } },
  { id: "plane", type: "plane3", definition: { kind: "throughPoints", pointIds: ["a", "b", "c"] } }
]

describe("3D constraints", () => {
  it("diagnoses point-on-line, point-on-plane, collinear and coplanar constraints", () => {
    const constraints: ConstraintSpec[] = [
      { id: "on-line", type: "pointOnLine", targets: ["a", "line"] },
      { id: "on-plane", type: "pointOnPlane", targets: ["d", "plane"] },
      { id: "collinear", type: "collinear", targets: ["a", "b", "c"] },
      { id: "coplanar", type: "coplanar", targets: ["a", "b", "c", "d"] }
    ]

    expect(constraintResidual3(constraints[0], points)).toBe(0)
    expect(constraintResidual3(constraints[1], points)).toBe(1)
    expect(diagnoseConstraint3(constraints[1], points).explanation).toContain("冲突")
    expect(constraintResidual3(constraints[2], points)).toBeCloseTo(1)
    expect(constraintResidual3(constraints[3], points)).toBeCloseTo(1)
  })

  it("returns diagnostics without moving source points", () => {
    const constraint: ConstraintSpec = { id: "fixed", type: "fixedDistance", targets: ["a", "b"], value: 2 }
    const solved = solvePoint3Constraints([constraint], points)

    expect(solved.converged).toBe(false)
    expect(solved.diagnostics[0].conflict).toBe(true)
    expect(solved.positions.get("b")).toEqual({ x: 1, y: 0, z: 0 })
  })
})
