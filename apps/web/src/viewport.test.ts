import { describe, expect, it } from "vitest"

import { DEFAULT_VIEWPORT, MAX_ZOOM, MIN_ZOOM, WORLD_SCALE, gridStep, rayToViewport, svgToWorld, worldToSvg, zoomViewport, zoomViewportAt } from "./viewport"

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

  /**
   * 体检发现的真缺陷：旧实现把"到边界的距离"和常数 20 取 min。起点在视口外时射线只画 20 个单位
   * 就断了——从 x = −20 向右的射线停在视口中间；导出侧那份副本还把 x 方向写反，两边画得都不一样。
   */
  it("clips a ray whose origin is outside the viewport across the whole visible span", () => {
    const visible = { minX: -10, maxX: 10, minY: -6, maxY: 6 }

    expect(rayToViewport({ a: { x: -20, y: 0 }, b: { x: -19, y: 0 } }, visible)).toEqual({ a: { x: -20, y: 0 }, b: { x: 10, y: 0 } })
    // 起点在视口外、斜着穿过：终点落在视口角上。
    const diagonal = rayToViewport({ a: { x: -20, y: -20 }, b: { x: -19, y: -19 } }, visible)
    expect(diagonal.b.x).toBeCloseTo(6, 9)
    expect(diagonal.b.y).toBeCloseTo(6, 9)
    // 背对视口 / 平行于某轴且在带外：什么都不画（退化成起点），而不是画一段视口外的假线。
    expect(rayToViewport({ a: { x: -20, y: 0 }, b: { x: -21, y: 0 } }, visible)).toEqual({ a: { x: -20, y: 0 }, b: { x: -20, y: 0 } })
    expect(rayToViewport({ a: { x: 0, y: 20 }, b: { x: 1, y: 20 } }, visible)).toEqual({ a: { x: 0, y: 20 }, b: { x: 0, y: 20 } })
    expect(rayToViewport({ a: { x: 5, y: 5 }, b: { x: 5, y: 5 } }, visible)).toEqual({ a: { x: 5, y: 5 }, b: { x: 5, y: 5 } })
  })
})

describe("canvas zoom", () => {
  it("keeps the world point under the cursor while zooming", () => {
    const viewport = { center: { x: 1, y: -0.5 }, scale: WORLD_SCALE }
    const anchor = { x: 520, y: 130 }
    const anchoredWorld = svgToWorld(anchor, viewport)

    const zoomed = zoomViewportAt(viewport, 2, anchor)

    expect(zoomed.scale).toBeCloseTo(WORLD_SCALE * 2)
    expect(worldToSvg(anchoredWorld, zoomed).x).toBeCloseTo(anchor.x, 6)
    expect(worldToSvg(anchoredWorld, zoomed).y).toBeCloseTo(anchor.y, 6)
  })

  it("clamps zoom to the supported range and ignores non-finite factors", () => {
    const anchor = { x: 400, y: 220 }

    expect(zoomViewportAt(DEFAULT_VIEWPORT, 1e6, anchor).scale).toBeCloseTo(WORLD_SCALE * MAX_ZOOM)
    expect(zoomViewportAt(DEFAULT_VIEWPORT, 1e-6, anchor).scale).toBeCloseTo(WORLD_SCALE * MIN_ZOOM)
    expect(zoomViewportAt(DEFAULT_VIEWPORT, Number.NaN, anchor).scale).toBeCloseTo(WORLD_SCALE)
  })

  it("keeps the viewport centre when zooming about the middle of the canvas", () => {
    const viewport = { center: { x: 4, y: -3 }, scale: WORLD_SCALE }

    expect(zoomViewport(viewport, 2).center).toEqual({ x: 4, y: -3 })
    expect(zoomViewport(viewport, 2).scale).toBeCloseTo(WORLD_SCALE * 2)
  })

  it("widens the grid step as the canvas zooms out so the grid stays readable", () => {
    expect(gridStep(WORLD_SCALE)).toBe(1)
    expect(gridStep(WORLD_SCALE * 0.1)).toBe(10)
    expect(gridStep(WORLD_SCALE * 10)).toBe(0.1)
  })
})
