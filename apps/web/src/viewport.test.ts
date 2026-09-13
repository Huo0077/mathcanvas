import { describe, expect, it } from "vitest"

import { svgToWorld, worldToSvg } from "./viewport"

describe("shared viewport mapping", () => {
  it("round-trips world coordinates", () => {
    const point = { x: 3.25, y: -2.5 }

    expect(svgToWorld(worldToSvg(point))).toEqual(point)
  })

  it("uses the same screen scale for one world unit on both axes", () => {
    const origin = worldToSvg({ x: 0, y: 0 })
    const horizontal = worldToSvg({ x: 1, y: 0 })
    const vertical = worldToSvg({ x: 0, y: 1 })

    expect(Math.abs(horizontal.x - origin.x)).toBeCloseTo(Math.abs(vertical.y - origin.y))
  })
})
