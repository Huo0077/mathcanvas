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

  /**
   * 体检发现的真缺陷：schema 只要求平面法向"非零"，于是 (1e-30,0,0) 这种数量级能存进文档，
   * 而 `normalizeVector3` 对它的长度（< 1e-12）返回**零向量** → 点到这个平面的残差恒为 0，
   * 得到一个"永远满足"的假约束。法向归一化失败时必须报数据不足，不能报 0。
   */
  it("refuses a plane whose normal cannot be normalised instead of reporting a satisfied constraint", () => {
    const degenerate: PrimitiveSpec[] = [
      ...points,
      { id: "degenerate-plane", type: "plane3", definition: { kind: "pointNormal", pointId: "a", normal: { x: 1e-30, y: 0, z: 0 } } }
    ]
    const constraint: ConstraintSpec = { id: "on-degenerate", type: "pointOnPlane", targets: ["d", "degenerate-plane"] }

    expect(constraintResidual3(constraint, degenerate)).toBeNull()
    const diagnosis = diagnoseConstraint3(constraint, degenerate)
    expect(diagnosis.residual).toBeNull()
    expect(diagnosis.satisfied).toBe(false)
    expect(diagnosis.conflict).toBe(true)
    expect(diagnosis.explanation).toContain("无法计算约束残差")

    // 正常法向照旧（单位法向、非单位法向都要能用）。
    const scaled: PrimitiveSpec[] = [
      ...points,
      { id: "scaled-plane", type: "plane3", definition: { kind: "pointNormal", pointId: "a", normal: { x: 0, y: 0, z: 5 } } }
    ]
    expect(constraintResidual3({ ...constraint, targets: ["d", "scaled-plane"] }, scaled)).toBe(1)
  })
})
