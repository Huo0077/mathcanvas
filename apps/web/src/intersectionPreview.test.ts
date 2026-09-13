import { describe, expect, it } from "vitest"

import { createEmptyDocument, type PrimitiveSpec } from "@draw/dsl"

import { getIntersectionPreviews } from "./intersectionPreview"

describe("live intersection previews", () => {
  it("finds a line intersection without creating a primitive", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "line-a", type: "line", a: { x: -2, y: 0 }, b: { x: 2, y: 0 } },
      { id: "line-b", type: "line", a: { x: 0, y: -2 }, b: { x: 0, y: 2 } }
    ]

    const previews = getIntersectionPreviews(document)

    expect(previews).toHaveLength(1)
    expect(previews[0]).toMatchObject({ objectA: "line-a", objectB: "line-b", point: { x: 0, y: 0 }, solutionIndex: 0 })
    expect(document.primitives).toHaveLength(2)
  })

  it("keeps both circle intersections as separate clickable previews", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "circle-a", type: "circle", center: { x: 0, y: 0 }, radius: 2 },
      { id: "circle-b", type: "circle", center: { x: 2, y: 0 }, radius: 2 }
    ]

    const previews = getIntersectionPreviews(document)

    expect(previews).toHaveLength(2)
    expect(previews.every((preview) => preview.objectA === "circle-a" && preview.objectB === "circle-b")).toBe(true)
    expect(previews.map((preview) => preview.solutionIndex)).toEqual([0, 1])
  })

  it("ignores hidden and derived intersection primitives", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "line-a", type: "line", a: { x: -2, y: 0 }, b: { x: 2, y: 0 }, visible: false },
      { id: "line-b", type: "line", a: { x: 0, y: -2 }, b: { x: 0, y: 2 } },
      { id: "intersection-1", type: "intersection", lineA: "line-a", lineB: "line-b", x: 0, y: 0 }
    ] as PrimitiveSpec[]

    expect(getIntersectionPreviews(document)).toEqual([])
  })
})
