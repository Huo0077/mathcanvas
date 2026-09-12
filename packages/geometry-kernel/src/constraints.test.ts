import { describe, expect, it } from "vitest"

import { projectLineConstraint } from "./constraints"

const first = { id: "first", type: "line" as const, a: { x: 0, y: 0 }, b: { x: 4, y: 0 } }

describe("line constraint projection", () => {
  it("projects a line to be parallel while preserving its center and length", () => {
    const result = projectLineConstraint(first, { id: "second", type: "line", a: { x: 1, y: 2 }, b: { x: 2, y: 5 } }, "parallel")

    expect(result.a).toEqual({ x: 1.5 - Math.sqrt(10) / 2, y: 3.5 })
    expect(result.b).toEqual({ x: 1.5 + Math.sqrt(10) / 2, y: 3.5 })
  })

  it("projects a line to be perpendicular while preserving its center", () => {
    const result = projectLineConstraint(first, { id: "second", type: "line", a: { x: 1, y: 2 }, b: { x: 2, y: 5 } }, "perpendicular")

    expect(result.a.x).toBeCloseTo(1.5)
    expect(result.a.y).toBeCloseTo(3.5 - Math.sqrt(10) / 2)
    expect(result.b.x).toBeCloseTo(1.5)
    expect(result.b.y).toBeCloseTo(3.5 + Math.sqrt(10) / 2)
  })

  it("projects a line onto the first line for a coincident constraint", () => {
    const result = projectLineConstraint(first, { id: "second", type: "line", a: { x: 3, y: 2 }, b: { x: 4, y: 5 } }, "coincident")

    expect(result.a.x).toBeCloseTo(3.5 - Math.sqrt(10) / 2)
    expect(result.a.y).toBeCloseTo(0)
    expect(result.b.x).toBeCloseTo(3.5 + Math.sqrt(10) / 2)
    expect(result.b.y).toBeCloseTo(0)
  })
})
