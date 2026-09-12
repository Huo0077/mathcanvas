import { describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"

import { applyOperation, commitPatch, getAffectedPrimitiveIds, recomputeDerivedObjects } from "./index"

describe("scene graph operations", () => {
  it("updates a parameter without mutating the previous document", () => {
    const before = createEmptyDocument("calculus")
    const result = applyOperation(before, { op: "setParameter", id: "slope", value: 2 })

    expect(before.parameters.slope).toBeUndefined()
    expect(result.document.parameters.slope?.value).toBe(2)
  })

  it("recomputes expression parameters after a base parameter update", () => {
    const before = createEmptyDocument("calculus")
    before.parameters = {
      slope: { id: "slope", value: 2 },
      doubled: { id: "doubled", value: 4, expression: "slope * 2" }
    }

    const result = applyOperation(before, { op: "setParameter", id: "slope", value: 3 })

    expect(result.changed).toBe(true)
    expect(result.document.parameters.doubled.value).toBe(6)
  })

  it("rejects circular expression parameters without mutating the document", () => {
    const before = createEmptyDocument("calculus")
    before.parameters = {
      first: { id: "first", value: 1, expression: "second + 1" },
      second: { id: "second", value: 2, expression: "first + 1" }
    }

    const result = applyOperation(before, { op: "setParameterExpression", id: "first", expression: "second + 1" })

    expect(result.changed).toBe(false)
    expect(result.document).toBe(before)
    expect(result.error).toContain("Circular parameter reference")
  })

  it("tracks only the dependent primitives for a parameter change", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "line-a", type: "line", a: { x: -1, y: 0 }, b: { x: 1, y: 1 }, slopeParameter: "slope" },
      { id: "line-b", type: "line", a: { x: -1, y: 1 }, b: { x: 1, y: 0 } },
      { id: "intersection", type: "intersection", lineA: "line-a", lineB: "line-b", x: 0, y: 0 },
      { id: "unrelated", type: "point", x: 2, y: 2 }
    ]
    expect([...getAffectedPrimitiveIds(document, ["slope"])]).toEqual(["slope", "line-a", "intersection"])
    expect(recomputeDerivedObjects(document, ["slope"]).primitives.find((primitive) => primitive.id === "unrelated")).toEqual(document.primitives[3])
  })

  it("rejects an invalid constraint without changing the document", () => {
    const document = createEmptyDocument("calculus")
    const result = commitPatch(document, { op: "addConstraint", constraint: { id: "parallel-1", type: "parallel", targets: ["missing-a", "missing-b"] } })

    expect(result.changed).toBe(false)
    expect(result.document).toBe(document)
    expect(result.error).toContain("constraint has invalid targets")
  })

  it("projects a valid parallel constraint through the domain operation", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "line-a", type: "line", a: { x: 0, y: 0 }, b: { x: 4, y: 0 } },
      { id: "line-b", type: "line", a: { x: 1, y: 2 }, b: { x: 2, y: 5 } }
    ]

    const result = commitPatch(document, { op: "addConstraint", constraint: { id: "parallel-1", type: "parallel", targets: ["line-a", "line-b"] } })
    const line = result.document.primitives.find((primitive) => primitive.id === "line-b")

    expect(result.changed).toBe(true)
    expect(line).toMatchObject({ a: { y: 3.5 }, b: { y: 3.5 } })
    expect((line as Extract<typeof line, { type: "line" }>).b.x - (line as Extract<typeof line, { type: "line" }>).a.x).toBeCloseTo(Math.sqrt(10))
  })

  it("reprojects constrained dependents when a driving parameter changes", () => {
    const document = createEmptyDocument("calculus")
    document.parameters.slope = { id: "slope", value: 1 }
    document.primitives = [
      { id: "line-a", type: "line", a: { x: 0, y: 0 }, b: { x: 4, y: 4 }, slopeParameter: "slope" },
      { id: "line-b", type: "line", a: { x: 1, y: 2 }, b: { x: 2, y: 5 } }
    ]
    document.constraints = [{ id: "perpendicular-1", type: "perpendicular", targets: ["line-a", "line-b"] }]

    const result = applyOperation(document, { op: "setParameter", id: "slope", value: 0 })
    const line = result.document.primitives.find((primitive) => primitive.id === "line-b") as Extract<typeof document.primitives[number], { type: "line" }>
    const delta = { x: line.b.x - line.a.x, y: line.b.y - line.a.y }

    expect(delta.x).toBeCloseTo(0)
    expect(delta.y).toBeCloseTo(Math.sqrt(10))
  })

  it("toggles lock state through a domain operation", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [{ id: "point-1", type: "point", x: 1, y: 2 }]

    const result = applyOperation(document, { op: "toggleLock", id: "point-1", locked: true })

    expect(result.changed).toBe(true)
    expect(result.document.primitives[0]).toMatchObject({ id: "point-1", locked: true })
  })

  it("keeps a 1000-primitive incremental recomputation bounded", () => {
    const document = createEmptyDocument("calculus")
    document.parameters.slope = { id: "slope", value: 1 }
    document.primitives = [
      { id: "line-a", type: "line", a: { x: -2, y: -2 }, b: { x: 2, y: 2 }, slopeParameter: "slope" },
      { id: "line-b", type: "line", a: { x: -2, y: 2 }, b: { x: 2, y: -2 } },
      { id: "intersection", type: "intersection", lineA: "line-a", lineB: "line-b", x: 0, y: 0 },
      ...Array.from({ length: 997 }, (_, index) => ({ id: `point-${index}`, type: "point" as const, x: index % 20, y: Math.floor(index / 20) }))
    ]
    const unrelated = document.primitives.at(-1)

    const startedAt = performance.now()
    const recomputed = recomputeDerivedObjects(document, ["slope"])
    const elapsed = performance.now() - startedAt

    expect(document.primitives).toHaveLength(1000)
    expect([...getAffectedPrimitiveIds(document, ["slope"])]).toEqual(["slope", "line-a", "intersection"])
    expect(recomputed.primitives.at(-1)).toBe(unrelated)
    expect(elapsed).toBeLessThan(100)
  })
})
