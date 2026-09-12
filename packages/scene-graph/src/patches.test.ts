import { describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"

import { commitPatch, validatePatch } from "./patches"

describe("domain patches", () => {
  it("rejects an intersection that references missing lines", () => {
    const document = createEmptyDocument("calculus")
    const operation = { op: "addPrimitive" as const, primitive: { id: "intersection-1", type: "intersection" as const, lineA: "missing-a", lineB: "missing-b", x: 0, y: 0 } }

    expect(validatePatch(document, operation)).toEqual({ valid: false, errors: ["intersection references missing line"] })
  })

  it("commits a valid patch and increments the document revision", () => {
    const document = createEmptyDocument("calculus")
    const operation = { op: "addPrimitive" as const, primitive: { id: "point-1", type: "point" as const, x: 1, y: 2 } }

    expect(commitPatch(document, operation).document.primitives).toHaveLength(1)
    expect(commitPatch(document, operation).document.revision).toBe(1)
  })

  it("rejects malformed parameter expressions before commit", () => {
    const document = createEmptyDocument("calculus")
    const operation = { op: "setParameterExpression" as const, id: "slope", expression: "2 +" }

    expect(validatePatch(document, operation)).toEqual({ valid: false, errors: ["invalid parameter expression"] })
  })

  it("accepts a parallel constraint only for existing lines", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "line-a", type: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } },
      { id: "line-b", type: "line", a: { x: 0, y: 1 }, b: { x: 1, y: 2 } }
    ]
    const operation = { op: "addConstraint" as const, constraint: { id: "parallel-1", type: "parallel" as const, targets: ["line-a", "line-b"] } }

    expect(validatePatch(document, operation)).toEqual({ valid: true })
    expect(commitPatch(document, operation).document.constraints).toEqual([operation.constraint])
  })

  it("rejects deleting an object referenced by a derived intersection", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "line-a", type: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } },
      { id: "line-b", type: "line", a: { x: 0, y: 1 }, b: { x: 1, y: 0 } },
      { id: "intersection", type: "intersection", lineA: "line-a", lineB: "line-b", x: 0.5, y: 0.5 }
    ]

    expect(validatePatch(document, { op: "deleteObject", id: "line-a" })).toEqual({ valid: false, errors: ["object is referenced by another object"] })
  })
})
