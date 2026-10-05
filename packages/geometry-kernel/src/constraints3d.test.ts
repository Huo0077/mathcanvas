import { describe, expect, it } from "vitest"

import type { ConstraintSpec, PrimitiveSpec } from "@draw/dsl"

import { constraintResidual3, diagnoseConstraint3, findConstraintContradictions, solvePoint3Constraints } from "./constraints3d"

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

/**
 * **可证的矛盾**：把"我还不知道"（可能只是投影没收敛）与"我知道它不成立"分开。
 *
 * 这一层的纪律是**只报能证明的**：一条编出来的"矛盾"会把一份本来能解的题直接判死。
 * 所以这里有一半用例是**反例**（看起来像矛盾、其实能解），它们比正例更重要。
 *
 * `points` 里：`line` 是 x 轴，`plane` 是 z = 0 —— 所以 `line` **落在** `plane` 里。
 */
describe("3D 约束里可证的矛盾", () => {
  it("同一条线段两个不同的长度：报矛盾，两条约束都点名", () => {
    const constraints: ConstraintSpec[] = [
      { id: "len-2", type: "fixedDistance", targets: ["a", "b"], value: 2 },
      { id: "len-3", type: "fixedDistance", targets: ["a", "b"], value: 3 }
    ]
    const found = findConstraintContradictions(constraints, points)

    expect(found).toHaveLength(1)
    expect(found[0]?.code).toBe("same-segment-two-lengths")
    expect(found[0]?.constraintIds).toEqual(["len-2", "len-3"])
  })

  it("同一个长度写两遍**不是**矛盾 —— 那是冗余，能解", () => {
    const constraints: ConstraintSpec[] = [
      { id: "len-2", type: "fixedDistance", targets: ["a", "b"], value: 2 },
      { id: "len-2-again", type: "fixedDistance", targets: ["a", "b"], value: 2 }
    ]

    expect(findConstraintContradictions(constraints, points)).toEqual([])
  })

  it("点对顺序反过来仍是同一条线段", () => {
    const constraints: ConstraintSpec[] = [
      { id: "forward", type: "fixedDistance", targets: ["a", "b"], value: 2 },
      { id: "backward", type: "fixedDistance", targets: ["b", "a"], value: 3 }
    ]

    expect(findConstraintContradictions(constraints, points).map((entry) => entry.code)).toEqual(["same-segment-two-lengths"])
  })

  it("不同线段各自的长度要求互不相干", () => {
    const constraints: ConstraintSpec[] = [
      { id: "ab", type: "fixedDistance", targets: ["a", "b"], value: 2 },
      { id: "ac", type: "fixedDistance", targets: ["a", "c"], value: 3 }
    ]

    expect(findConstraintContradictions(constraints, points)).toEqual([])
  })

  it("点既在线上又在面上，而线与面平行且不相交：报矛盾", () => {
    const lifted: PrimitiveSpec[] = [
      ...points,
      { id: "e", type: "point3", position: { x: 0, y: 0, z: 1 } },
      { id: "f", type: "point3", position: { x: 1, y: 0, z: 1 } },
      { id: "lifted-line", type: "line3", definition: { kind: "throughPoints", pointIds: ["e", "f"] } }
    ]
    const constraints: ConstraintSpec[] = [
      { id: "on-lifted", type: "pointOnLine", targets: ["d", "lifted-line"] },
      { id: "on-plane", type: "pointOnPlane", targets: ["d", "plane"] }
    ]
    const found = findConstraintContradictions(constraints, lifted)

    expect(found).toHaveLength(1)
    expect(found[0]?.code).toBe("line-parallel-to-plane")
    expect(found[0]?.constraintIds).toEqual(["on-plane", "on-lifted"])
  })

  it("直线**落在**平面里不是矛盾：交集就是整条线，随便取一个点都行", () => {
    const constraints: ConstraintSpec[] = [
      { id: "on-line", type: "pointOnLine", targets: ["d", "line"] },
      { id: "on-plane", type: "pointOnPlane", targets: ["d", "plane"] }
    ]

    expect(findConstraintContradictions(constraints, points)).toEqual([])
  })

  it("直线与平面相交也不是矛盾：那个交点就是唯一解", () => {
    const axis: PrimitiveSpec[] = [
      ...points,
      { id: "g", type: "point3", position: { x: 0, y: 0, z: 1 } },
      { id: "z-line", type: "line3", definition: { kind: "throughPoints", pointIds: ["a", "g"] } }
    ]
    const constraints: ConstraintSpec[] = [
      { id: "on-z", type: "pointOnLine", targets: ["d", "z-line"] },
      { id: "on-plane", type: "pointOnPlane", targets: ["d", "plane"] }
    ]

    expect(findConstraintContradictions(constraints, axis)).toEqual([])
  })
})
