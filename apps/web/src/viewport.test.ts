import { describe, expect, it } from "vitest"

import { DEFAULT_VIEWPORT, WORLD_SCALE, rayToViewport, svgToWorld, worldToSvg } from "./viewport"

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

  it("maps coordinates relative to a translated viewport center", () => {
    const viewport = { center: { x: 25, y: -12 }, scale: WORLD_SCALE }
    const point = { x: 28.5, y: -14.25 }

    expect(svgToWorld(worldToSvg(point, viewport), viewport)).toEqual(point)
    expect(worldToSvg(viewport.center, viewport)).toEqual(worldToSvg(DEFAULT_VIEWPORT.center))
  })

  it("clips a positive ray at the visible maximum boundary", () => {
    const visible = { minX: -10, maxX: 10, minY: -6, maxY: 6 }

    expect(rayToViewport({ a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }, visible)).toEqual({ a: { x: 0, y: 0 }, b: { x: 10, y: 0 } })
  })
})
