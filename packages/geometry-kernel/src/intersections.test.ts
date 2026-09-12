import { describe, expect, it } from "vitest"

import { intersectLines } from "./index"

describe("line intersections", () => {
  it("returns the intersection of two non-parallel lines", () => {
    expect(
      intersectLines(
        { id: "a", type: "line", a: { x: 0, y: 0 }, b: { x: 2, y: 2 } },
        { id: "b", type: "line", a: { x: 0, y: 2 }, b: { x: 2, y: 0 } }
      )
    ).toEqual({ x: 1, y: 1 })
  })
})
