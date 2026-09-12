import { describe, expect, it } from "vitest"

import type { ConstraintSpec } from "@draw/dsl"

import { projectLineConstraint, solveLineConstraints } from "./constraints"

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

  it("does not report coincident lines after one pass when their directions still differ", () => {
    const lines = new Map([
      ["line-a", { id: "line-a", type: "line" as const, a: { x: -1, y: 0 }, b: { x: 1, y: 0 } }],
      ["line-b", { id: "line-b", type: "line" as const, a: { x: 0, y: 0 }, b: { x: 2, y: 0 } }],
      ["line-c", { id: "line-c", type: "line" as const, a: { x: 0, y: -1 }, b: { x: 0, y: 1 } }]
    ])
    const constraints: ConstraintSpec[] = [
      { id: "coincident-ab", type: "coincident", targets: ["line-a", "line-b"] },
      { id: "coincident-ca", type: "coincident", targets: ["line-c", "line-a"] }
    ]
    const result = solveLineConstraints(lines, constraints, 1)
    const converged = solveLineConstraints(lines, constraints)
    const solvedA = converged.lines.get("line-a")!
    const solvedB = converged.lines.get("line-b")!

    expect(result.converged).toBe(false)
    expect(converged.converged).toBe(true)
    expect(solvedA.a.x).toBeCloseTo(solvedA.b.x)
    expect(solvedB.a.x).toBeCloseTo(solvedB.b.x)
    expect(solvedA.a.x).toBeCloseTo(solvedB.a.x)
  })

  it("solves a reverse-ordered constraint chain longer than twelve edges", () => {
    const lines = new Map(Array.from({ length: 14 }, (_, index) => [
      `line-${index}`,
      { id: `line-${index}`, type: "line" as const, a: { x: 0, y: 0 }, b: index === 0 ? { x: 2, y: 0 } : { x: 0, y: 2 } }
    ]))
    const constraints = Array.from({ length: 13 }, (_, index) => ({
      id: `parallel-${12 - index}`,
      type: "parallel" as const,
      targets: [`line-${12 - index}`, `line-${13 - index}`]
    }))

    const result = solveLineConstraints(lines, constraints)
    const last = result.lines.get("line-13")!

    expect(result.converged).toBe(true)
    expect(last.b.y - last.a.y).toBeCloseTo(0)
  })

  it("keeps degenerate line constraints as a converged no-op", () => {
    const degenerate = { id: "degenerate", type: "line" as const, a: { x: 1, y: 1 }, b: { x: 1, y: 1 } }
    const movable = { id: "movable", type: "line" as const, a: { x: 0, y: 0 }, b: { x: 2, y: 1 } }
    const result = solveLineConstraints(new Map([[degenerate.id, degenerate], [movable.id, movable]]), [
      { id: "parallel-1", type: "parallel", targets: [degenerate.id, movable.id] }
    ])

    expect(result.converged).toBe(true)
    expect(result.lines.get(movable.id)).toEqual(movable)
  })

  it("solves only the constraint component containing an active line", () => {
    const activeLine = { id: "active", type: "line" as const, a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }
    const activeDependent = { id: "active-dependent", type: "line" as const, a: { x: 0, y: 2 }, b: { x: 1, y: 4 } }
    const untouchedLine = { id: "untouched", type: "line" as const, a: { x: 0, y: 0 }, b: { x: 0, y: 1 } }
    const untouchedDependent = { id: "untouched-dependent", type: "line" as const, a: { x: 2, y: 0 }, b: { x: 4, y: 1 } }
    const lines = new Map([
      [activeLine.id, activeLine],
      [activeDependent.id, activeDependent],
      [untouchedLine.id, untouchedLine],
      [untouchedDependent.id, untouchedDependent]
    ])
    const constraints: ConstraintSpec[] = [
      { id: "active-parallel", type: "parallel", targets: [activeLine.id, activeDependent.id] },
      { id: "untouched-perpendicular", type: "perpendicular", targets: [untouchedLine.id, untouchedDependent.id] }
    ]

    const result = solveLineConstraints(lines, constraints, undefined, undefined, new Set([activeLine.id]))

    expect(result.converged).toBe(true)
    expect(result.lines.get(activeDependent.id)).not.toBe(activeDependent)
    expect(result.lines.get(untouchedLine.id)).toBe(untouchedLine)
    expect(result.lines.get(untouchedDependent.id)).toBe(untouchedDependent)
  })
})
