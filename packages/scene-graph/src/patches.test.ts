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

  it("rejects editing and deleting a locked object", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [{ id: "point-1", type: "point", x: 1, y: 2, locked: true }]

    expect(validatePatch(document, { op: "deleteObject", id: "point-1" })).toEqual({ valid: false, errors: ["object is locked"] })
    expect(validatePatch(document, { op: "updatePrimitive", id: "point-1", patch: { center: { x: 2, y: 3 } } })).toEqual({ valid: false, errors: ["object is locked", "only circles and conics support center"] })
  })

  it("validates and edits segment endpoints", () => {
    const document = createEmptyDocument("calculus")
    const segment = { id: "segment-1", type: "segment" as const, a: { x: 0, y: 0 }, b: { x: 2, y: 1 } }
    const added = commitPatch(document, { op: "addPrimitive", primitive: segment })

    expect(added.changed).toBe(true)
    expect(commitPatch(added.document, { op: "updatePrimitive", id: segment.id, patch: { b: { x: 4, y: 3 } } }).document.primitives[0]).toMatchObject({ b: { x: 4, y: 3 } })
    expect(validatePatch(document, { op: "addPrimitive", primitive: { ...segment, b: segment.a } })).toEqual({ valid: false, errors: ["segment endpoints must differ"] })
    expect(commitPatch(added.document, { op: "updatePrimitive", id: segment.id, patch: { b: segment.a } })).toMatchObject({ document: added.document, changed: false, error: "segment endpoints must differ" })
  })

  it("rejects degenerate rays and polylines at the patch boundary", () => {
    const document = createEmptyDocument("calculus")
    const ray = { id: "ray-1", type: "ray" as const, a: { x: 0, y: 0 }, b: { x: 0, y: 0 } }
    const polyline = { id: "polyline-1", type: "polyline" as const, points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] }

    expect(validatePatch(document, { op: "addPrimitive", primitive: ray })).toEqual({ valid: false, errors: ["ray direction must differ"] })
    expect(validatePatch(document, { op: "addPrimitive", primitive: polyline })).toEqual({ valid: false, errors: ["polyline consecutive points must differ"] })
  })

  it("validates conic and function property edits", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "parabola-1", type: "parabola", vertex: { x: 0, y: 0 }, focalParameter: 2, axis: "y" },
      { id: "function-1", type: "function", expression: "x*x", domain: [-4, 4], samples: 32 }
    ]

    const parabola = commitPatch(document, { op: "updatePrimitive", id: "parabola-1", patch: { focalParameter: 3, vertex: { x: 1, y: 2 } } })
    const functionResult = commitPatch(parabola.document, { op: "updatePrimitive", id: "function-1", patch: { expression: "2*x+1", domain: [-2, 6] } })

    expect(parabola.document.primitives[0]).toMatchObject({ focalParameter: 3, vertex: { x: 1, y: 2 } })
    expect(functionResult.document.primitives[1]).toMatchObject({ expression: "2*x+1", domain: [-2, 6] })
    expect(validatePatch(document, { op: "updatePrimitive", id: "function-1", patch: { expression: "x+" } })).toEqual({ valid: false, errors: ["invalid function expression"] })
  })

  it("accepts rotation and label edits for conics", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [{ id: "ellipse-1", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 4, radiusY: 2 }]

    const result = commitPatch(document, { op: "updatePrimitive", id: "ellipse-1", patch: { rotation: Math.PI / 4, label: "旋转椭圆" } })

    expect(result.document.primitives[0]).toMatchObject({ rotation: Math.PI / 4, label: "旋转椭圆" })
  })

  it("rejects invalid style patch values", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [{ id: "point-1", type: "point", x: 0, y: 0 }]

    expect(validatePatch(document, { op: "updatePrimitive", id: "point-1", patch: { style: { stroke: 12 as unknown as string, dash: 8 as unknown as string } } })).toEqual({ valid: false, errors: ["stroke is invalid", "dash is invalid"] })
  })

  it("creates and protects a sampled curve intersection", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "ellipse-1", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 4, radiusY: 2 },
      { id: "function-1", type: "function", expression: "x*x", domain: [-4, 4], samples: 128 }
    ]

    const result = commitPatch(document, { op: "addPrimitive", primitive: { id: "curve-intersection-1", type: "curveIntersection", objectA: "ellipse-1", objectB: "function-1", x: 0, y: 0 } })

    expect(result.changed).toBe(true)
    expect(result.document.primitives[2]).toMatchObject({ type: "curveIntersection", visible: true })
    expect(validatePatch(result.document, { op: "deleteObject", id: "ellipse-1" })).toEqual({ valid: false, errors: ["object is referenced by another object"] })
  })

  it("rejects overlapping groups and locked batch alignment", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "point-1", type: "point", x: 1, y: 2 },
      { id: "point-2", type: "point", x: 3, y: 4, locked: true },
      { id: "point-3", type: "point", x: 5, y: 6 }
    ]
    document.groups = [{ id: "group-1", members: ["point-1", "point-2"] }]

    expect(validatePatch(document, { op: "createGroup", group: { id: "group-2", members: ["point-2", "point-3"] } })).toEqual({ valid: false, errors: ["primitive already belongs to a group"] })
    expect(validatePatch(document, { op: "alignPrimitives", ids: ["point-1", "point-2"], alignment: "left" })).toEqual({ valid: false, errors: ["selection contains locked object"] })
  })

  it("rejects invalid alignment values and locked constrained dependents", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "line-a", type: "line", a: { x: 0, y: 0 }, b: { x: 2, y: 0 } },
      { id: "line-b", type: "line", a: { x: 0, y: 1 }, b: { x: 2, y: 1 } },
      { id: "line-c", type: "line", a: { x: 0, y: 2 }, b: { x: 2, y: 2 }, locked: true },
      { id: "point-1", type: "point", x: 5, y: 5 }
    ]
    document.constraints = [
      { id: "parallel-1", type: "parallel", targets: ["line-a", "line-b"] },
      { id: "parallel-2", type: "parallel", targets: ["line-b", "line-c"] }
    ]

    const invalidAlignment = validatePatch(document, { op: "alignPrimitives", ids: ["line-a", "point-1"], alignment: "diagonal" as never })
    const lockedDependent = validatePatch(document, { op: "alignPrimitives", ids: ["line-a", "point-1"], alignment: "left" })
    const singleObject = validatePatch(document, { op: "alignPrimitives", ids: ["line-a"], alignment: "left" })

    expect(invalidAlignment.valid).toBe(false)
    expect(invalidAlignment.valid ? [] : invalidAlignment.errors).toContain("alignment is invalid")
    expect(lockedDependent.valid).toBe(false)
    expect(lockedDependent.valid ? [] : lockedDependent.errors).toContain("alignment would move locked constrained object")
    expect(singleObject.valid).toBe(false)
    expect(singleObject.valid ? [] : singleObject.errors).toContain("alignment requires multiple objects")
  })

  it("rejects malformed primitive patches without throwing", () => {
    const document = createEmptyDocument("calculus")
    const malformedOperations = [
      { op: "addPrimitive", primitive: { id: "point-1", type: "point" } },
      { op: "addPrimitive", primitive: { id: "segment-1", type: "segment" } }
    ] as never[]

    for (const operation of malformedOperations) {
      expect(() => validatePatch(document, operation)).not.toThrow()
      expect(validatePatch(document, operation).valid).toBe(false)
    }
  })

  it("translates a function through one domain operation", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [{ id: "function-1", type: "function", expression: "x*x", domain: [-2, 2] }]

    const result = commitPatch(document, { op: "translatePrimitive", id: "function-1", delta: { x: 2, y: 1 } })

    expect(result.changed).toBe(true)
    expect(result.document.primitives[0]).toMatchObject({ expression: "((x-2)*(x-2))+1", domain: [0, 4] })
  })

  it("translates a ray body while preserving its direction", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [{ id: "ray-1", type: "ray", a: { x: 1, y: 2 }, b: { x: 3, y: 5 } }]

    const result = commitPatch(document, { op: "translatePrimitive", id: "ray-1", delta: { x: -2, y: 4 } })

    expect(result.document.primitives[0]).toMatchObject({ a: { x: -1, y: 6 }, b: { x: 1, y: 9 } })
  })
})
