import { describe, expect, it } from "vitest"

import type { ConstraintSpec, PrimitiveSpec } from "@draw/dsl"

import { projectPoint3Constraints } from "./constraints3dProjection"

/**
 * **求解预算**（2026-10-19，P3-3）：到点即停，结果是半成品，不能读成“已满足”。
 */
describe("point3 projection deadline", () => {
  const primitives: PrimitiveSpec[] = [
    { id: "a", type: "point3", position: { x: 0, y: 0, z: 0 } },
    { id: "b", type: "point3", position: { x: 1, y: 0, z: 0 } },
    { id: "c", type: "point3", position: { x: 0, y: 1, z: 0 } },
    { id: "p", type: "point3", position: { x: 2, y: 3, z: 4 } },
    { id: "plane-abc", type: "plane3", definition: { kind: "throughPoints", pointIds: ["a", "b", "c"] } }
  ]
  const constraints: ConstraintSpec[] = [{ id: "on-plane", type: "pointOnPlane", targets: ["p", "plane-abc"] }]

  it("stops before the first pass when the budget is already spent", () => {
    const result = projectPoint3Constraints(primitives, constraints, { deadlineMs: 0 })

    expect(result.timedOut).toBe(true)
    expect(result.satisfied).toBe(false)
    expect(result.iterations).toBe(0)
    expect(result.positions.get("p")).toEqual({ x: 2, y: 3, z: 4 })
  })

  it("still converges when the budget is generous", () => {
    const result = projectPoint3Constraints(primitives, constraints, { deadlineMs: 60_000 })

    expect(result.timedOut).toBe(false)
    expect(result.satisfied).toBe(true)
    expect(result.positions.get("p")).toEqual({ x: 2, y: 3, z: 0 })
  })
})
