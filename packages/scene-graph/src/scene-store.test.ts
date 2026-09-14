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

  it("recomputes a point bound to a circle path", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "circle-1", type: "circle", center: { x: 1, y: 2 }, radius: 3 },
      { id: "point-1", type: "point", x: 0, y: 0, binding: { kind: "onPath", pathId: "circle-1", parameter: 0.25 } }
    ]

    const recomputed = recomputeDerivedObjects(document)
    const point = recomputed.primitives.find((primitive) => primitive.id === "point-1")
    expect(point?.type).toBe("point")
    if (point?.type === "point") {
      expect(point.x).toBeCloseTo(1)
      expect(point.y).toBeCloseTo(5)
    }
  })

  it("recomputes an intersection set with every sampled solution", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "line-a", type: "line", a: { x: -2, y: 0 }, b: { x: 2, y: 0 } },
      { id: "line-b", type: "line", a: { x: 0, y: -2 }, b: { x: 0, y: 2 } },
      { id: "set-1", type: "intersectionSet", objectA: "line-a", objectB: "line-b", points: [] }
    ]

    const result = recomputeDerivedObjects(document)
    expect(result.primitives.find((primitive) => primitive.id === "set-1")).toMatchObject({ visible: true, points: [{ x: 0, y: 0 }] })
  })

  it("recomputes a derivative when its source function changes", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "function-1", type: "function", expression: "x^2", domain: [-2, 2], samples: 16 },
      { id: "derivative-1", type: "derivative", sourceId: "function-1", order: 1, domain: [-2, 2], samples: 16, points: [], status: "approximate" }
    ]

    const initial = recomputeDerivedObjects(document)
    const updated = applyOperation(initial, { op: "updatePrimitive", id: "function-1", patch: { expression: "2*x" } })
    const derivative = updated.document.primitives.find((primitive) => primitive.id === "derivative-1")

    expect(initial.primitives.find((primitive) => primitive.id === "derivative-1")).toMatchObject({ points: expect.any(Array) })
    expect(derivative).toMatchObject({ status: "approximate", points: expect.arrayContaining([expect.objectContaining({ y: expect.closeTo(2, 0.1) })]) })
  })

  it("recomputes tangent, normal, and secant values from their source function", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "function-1", type: "function", expression: "x^2", domain: [-2, 2], samples: 16 },
      { id: "tangent-1", type: "tangent", sourceId: "function-1", x: 1, point: { x: 0, y: 0 }, slope: 0, a: { x: -2, y: 0 }, b: { x: 2, y: 0 }, status: "failed" },
      { id: "normal-1", type: "normal", sourceId: "function-1", x: 1, point: { x: 0, y: 0 }, slope: 0, a: { x: -2, y: 0 }, b: { x: 2, y: 0 }, status: "failed" },
      { id: "secant-1", type: "secant", sourceId: "function-1", x1: -1, x2: 1, points: [], slope: 0, a: { x: -2, y: 0 }, b: { x: 2, y: 0 }, status: "failed" }
    ]

    const result = recomputeDerivedObjects(document)
    expect(result.primitives).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "tangent-1", point: { x: 1, y: 1 }, slope: expect.closeTo(2, 0.1), status: "approximate" }),
      expect.objectContaining({ id: "normal-1", point: { x: 1, y: 1 }, slope: expect.closeTo(-0.5, 0.1), status: "approximate" }),
      expect.objectContaining({ id: "secant-1", points: [{ x: -1, y: 1 }, { x: 1, y: 1 }], slope: expect.closeTo(0, 0.1), status: "approximate" })
    ]))
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

  it("rejects conflicting constraints and rolls back the document", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "line-a", type: "line", a: { x: 0, y: 0 }, b: { x: 4, y: 0 } },
      { id: "line-b", type: "line", a: { x: 1, y: 2 }, b: { x: 2, y: 5 } }
    ]
    document.constraints = [{ id: "parallel-1", type: "parallel", targets: ["line-a", "line-b"] }]

    const result = commitPatch(document, { op: "addConstraint", constraint: { id: "perpendicular-1", type: "perpendicular", targets: ["line-a", "line-b"] } })

    expect(result.changed).toBe(false)
    expect(result.document).toBe(document)
    expect(result.error).toContain("constraint solving failed")
  })

  it("hides a valid parallel intersection without rejecting the transaction", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "line-a", type: "line", a: { x: 0, y: 0 }, b: { x: 2, y: 0 } },
      { id: "line-b", type: "line", a: { x: 0, y: 1 }, b: { x: 2, y: 1 } },
      { id: "intersection", type: "intersection", lineA: "line-a", lineB: "line-b", x: 0, y: 0 }
    ]

    const result = applyOperation(document, { op: "updatePrimitive", id: "line-a", patch: { b: { x: 3, y: 0 } } })

    expect(result.changed).toBe(true)
    expect(result.document.primitives[2]).toMatchObject({ visible: false })
  })

  it("rolls back recomputation for a degenerate intersection source", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "line-a", type: "line", a: { x: 1, y: 1 }, b: { x: 1, y: 1 } },
      { id: "line-b", type: "line", a: { x: 0, y: 0 }, b: { x: 2, y: 0 } },
      { id: "intersection", type: "intersection", lineA: "line-a", lineB: "line-b", x: 0, y: 0 }
    ]

    const result = applyOperation(document, { op: "updatePrimitive", id: "line-b", patch: { b: { x: 3, y: 0 } } })

    expect(result.changed).toBe(false)
    expect(result.document).toBe(document)
    expect(result.error).toContain("degenerate intersection")
  })

  it("toggles lock state through a domain operation", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [{ id: "point-1", type: "point", x: 1, y: 2 }]

    const result = applyOperation(document, { op: "toggleLock", id: "point-1", locked: true })

    expect(result.changed).toBe(true)
    expect(result.document.primitives[0]).toMatchObject({ id: "point-1", locked: true })
  })

  it("creates and removes a persistent group atomically", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "point-1", type: "point", x: 1, y: 2 },
      { id: "point-2", type: "point", x: 3, y: 4 }
    ]

    const grouped = commitPatch(document, { op: "createGroup", group: { id: "group-1", label: "分组 1", members: ["point-1", "point-2"] } })
    const ungrouped = commitPatch(grouped.document, { op: "deleteGroup", id: "group-1" })

    expect(grouped.document.groups).toEqual([{ id: "group-1", label: "分组 1", members: ["point-1", "point-2"] }])
    expect(grouped.document.revision).toBe(1)
    expect(ungrouped.document.groups).toEqual([])
    expect(ungrouped.document.revision).toBe(2)
  })

  it("aligns primitive bounds in one transaction", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "point-1", type: "point", x: 1, y: 2 },
      { id: "circle-1", type: "circle", center: { x: 5, y: 4 }, radius: 2 }
    ]

    const result = commitPatch(document, { op: "alignPrimitives", ids: ["point-1", "circle-1"], alignment: "left" })

    expect(result.document.primitives).toEqual([
      { id: "point-1", type: "point", x: 1, y: 2 },
      { id: "circle-1", type: "circle", center: { x: 3, y: 4 }, radius: 2 }
    ])
    expect(result.document.revision).toBe(1)
  })

  it("aligns horizontal and vertical centers on their matching axes", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "point-1", type: "point", x: 1, y: 2 },
      { id: "point-2", type: "point", x: 5, y: 6 }
    ]

    const horizontal = commitPatch(document, { op: "alignPrimitives", ids: ["point-1", "point-2"], alignment: "horizontalCenter" })
    const vertical = commitPatch(document, { op: "alignPrimitives", ids: ["point-1", "point-2"], alignment: "verticalCenter" })

    expect(horizontal.document.primitives.map((primitive) => (primitive.type === "point" ? primitive.x : null))).toEqual([3, 3])
    expect(vertical.document.primitives.map((primitive) => (primitive.type === "point" ? primitive.y : null))).toEqual([4, 4])
  })

  it("updates visibility for multiple primitives in one transaction", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "point-1", type: "point", x: 1, y: 2 },
      { id: "point-2", type: "point", x: 3, y: 4 }
    ]

    const result = commitPatch(document, { op: "setPrimitivesVisible", ids: ["point-1", "point-2"], visible: false })

    expect(result.document.primitives.map((primitive) => primitive.visible)).toEqual([false, false])
    expect(result.document.revision).toBe(1)
  })

  it("keeps a 1000-primitive incremental recomputation bounded", () => {
    const document = createEmptyDocument("calculus")
    document.parameters.slope = { id: "slope", value: 1 }
    document.primitives = [
      { id: "line-a", type: "line", a: { x: -2, y: -2 }, b: { x: 2, y: 2 }, slopeParameter: "slope" },
      { id: "line-b", type: "line", a: { x: -2, y: 2 }, b: { x: 2, y: -2 } },
      { id: "intersection", type: "intersection", lineA: "line-a", lineB: "line-b", x: 0, y: 0 },
      { id: "near-line-a", type: "line", a: { x: -2, y: -1e-9 }, b: { x: 2, y: 1e-9 } },
      { id: "near-line-b", type: "line", a: { x: -2, y: 1 }, b: { x: 2, y: 1 + 3e-9 } },
      { id: "near-intersection", type: "intersection", lineA: "near-line-a", lineB: "near-line-b", x: 0, y: 0 },
      ...Array.from({ length: 994 }, (_, index) => ({ id: `point-${index}`, type: "point" as const, x: index % 20, y: Math.floor(index / 20) }))
    ]
    const unrelated = document.primitives.at(-1)

    const startedAt = performance.now()
    const recomputed = recomputeDerivedObjects(document, ["slope", "near-line-a"])
    const elapsed = performance.now() - startedAt

    expect(document.primitives).toHaveLength(1000)
    expect([...getAffectedPrimitiveIds(document, ["slope", "near-line-a"])]).toEqual(["slope", "near-line-a", "line-a", "near-intersection", "intersection"])
    const nearIntersection = recomputed.primitives.find((primitive) => primitive.id === "near-intersection")
    expect(nearIntersection).toMatchObject({ visible: true })
    expect(nearIntersection && nearIntersection.type === "intersection" && Number.isFinite(nearIntersection.x) && Number.isFinite(nearIntersection.y)).toBe(true)
    expect(recomputed.primitives.at(-1)).toBe(unrelated)
    expect(elapsed).toBeLessThan(100)
  })

  it("keeps independent constraint components stable during incremental recomputation", () => {
    const document = createEmptyDocument("calculus")
    document.parameters.slope = { id: "slope", value: 1 }
    const activeLines = Array.from({ length: 12 }, (_, index) => ({ id: `active-${index}`, type: "line" as const, a: { x: 0, y: index }, b: { x: 2, y: index + 1 }, ...(index === 0 ? { slopeParameter: "slope" } : {}) }))
    const untouchedLines = Array.from({ length: 12 }, (_, index) => ({ id: `untouched-${index}`, type: "line" as const, a: { x: 10, y: index }, b: { x: 12, y: index + 2 } }))
    document.primitives = [...activeLines, ...untouchedLines]
    document.constraints = [...Array.from({ length: 11 }, (_, index) => ({ id: `active-${index}`, type: "parallel" as const, targets: [`active-${index}`, `active-${index + 1}`] })), ...Array.from({ length: 11 }, (_, index) => ({ id: `untouched-${index}`, type: "perpendicular" as const, targets: [`untouched-${index}`, `untouched-${index + 1}`] }))]
    const untouched = document.primitives.find((primitive) => primitive.id === "untouched-11")

    const recomputed = recomputeDerivedObjects(document, ["slope"])

    expect(recomputed.primitives.find((primitive) => primitive.id === "untouched-11")).toBe(untouched)
    expect(recomputed.primitives.find((primitive) => primitive.id === "active-11")).not.toBe(activeLines[11])
  })

  it.each([1000, 5000, 10000])("keeps %s constrained lines within the incremental budget", (lineCount) => {
    const document = createEmptyDocument("calculus")
    document.parameters.slope = { id: "slope", value: 1 }
    document.primitives = Array.from({ length: lineCount }, (_, index) => ({
      id: `line-${index}`,
      type: "line" as const,
      a: { x: 0, y: index },
      b: { x: 2, y: index + (index === 0 ? 2 : 1) },
      ...(index === 0 ? { slopeParameter: "slope" } : {})
    }))
    const componentSize = 10
    document.constraints = Array.from({ length: (lineCount / componentSize) * (componentSize - 1) }, (_, index) => {
      const componentIndex = Math.floor(index / (componentSize - 1))
      const lineIndex = componentIndex * componentSize + index % (componentSize - 1)
      return {
        id: `constraint-${index}`,
        type: "parallel" as const,
        targets: [`line-${lineIndex}`, `line-${lineIndex + 1}`]
      }
    })
    const untouched = document.primitives.at(-1)

    const startedAt = performance.now()
    const recomputed = recomputeDerivedObjects(document, ["slope"])
    const elapsed = performance.now() - startedAt

    expect(elapsed).toBeLessThan(1000)
    expect(recomputed.primitives.find((primitive) => primitive.id === "line-1")).not.toBe(document.primitives[1])
    expect(recomputed.primitives.at(-1)).toBe(untouched)
  })
})
