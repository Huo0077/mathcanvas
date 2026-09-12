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
})
