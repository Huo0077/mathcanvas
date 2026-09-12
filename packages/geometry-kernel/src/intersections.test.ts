import { describe, expect, it } from "vitest"

import { intersectCircles, intersectLineCircle, intersectLines } from "./index"

describe("line intersections", () => {
  it("returns the intersection of two non-parallel lines", () => {
    expect(
      intersectLines(
        { id: "a", type: "line", a: { x: 0, y: 0 }, b: { x: 2, y: 2 } },
        { id: "b", type: "line", a: { x: 0, y: 2 }, b: { x: 2, y: 0 } }
      )
    ).toEqual({ x: 1, y: 1 })
  })

  it("returns no point for parallel lines", () => {
    expect(intersectLines(
      { id: "a", type: "line", a: { x: 0, y: 0 }, b: { x: 2, y: 2 } },
      { id: "b", type: "line", a: { x: 0, y: 1 }, b: { x: 2, y: 3 } }
    )).toBeNull()
  })

  it("finds both intersections between a line and a circle", () => {
    expect(intersectLineCircle(
      { id: "line", type: "line", a: { x: -2, y: 0 }, b: { x: 2, y: 0 } },
      { id: "circle", type: "circle", center: { x: 0, y: 0 }, radius: 1 }
    )).toEqual([{ x: -1, y: 0 }, { x: 1, y: 0 }])
  })

  it("finds both intersections between two circles", () => {
    expect(intersectCircles(
      { id: "first", type: "circle", center: { x: 0, y: 0 }, radius: 2 },
      { id: "second", type: "circle", center: { x: 2, y: 0 }, radius: 2 }
    )).toEqual([{ x: 1, y: Math.sqrt(3) }, { x: 1, y: -Math.sqrt(3) }])
  })
})
