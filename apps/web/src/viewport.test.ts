import { describe, expect, it } from "vitest"

import { DEFAULT_VIEWPORT, MAX_GRID_LINES, MAX_ZOOM, MIN_ZOOM, WORLD_SCALE, gridLinePositions, rayToViewport, svgToWorld, visibleWorldBounds, worldToSvg, zoomViewport, zoomViewportAt } from "./viewport"
import { GRID_CELL } from "./sceneGrid"

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

  /**
   * 用户要求："平面缩放也会导致网格大小变化，我需要固定网格大小。"
   * 因此格边长恒为 1 个世界单位（与 3D 背景网格同一套语义），缩放只改变可见范围。
   * 这个函数刻意不接缩放参数——"不随缩放变化"是结构性的。
   */
  it("keeps the grid at one world unit per cell instead of widening the step with zoom", () => {
    expect(GRID_CELL).toBe(1)

    const spacing = (positions: number[]) => positions.slice(1).map((value, index) => Number((value - positions[index]).toFixed(9)))

    // 缩到最远（0.05×，可见范围约 ±216 格）与放到最大（40×，可见范围不到一格）：
    // 格边长都还是 1。
    const wide = visibleWorldBounds(zoomViewport(DEFAULT_VIEWPORT, MIN_ZOOM))
    const close = visibleWorldBounds(zoomViewport(DEFAULT_VIEWPORT, MAX_ZOOM))
    const widePositions = gridLinePositions(wide.minX, wide.maxX)
    expect(new Set(spacing(widePositions))).toEqual(new Set([GRID_CELL]))
    expect(widePositions.every((value) => Number.isInteger(value))).toBe(true)
    expect(close.maxX - close.minX).toBeLessThan(1)
    expect(gridLinePositions(close.minX, close.maxX).every(Number.isInteger)).toBe(true)

    // 平移到非整数中心也一样锚在整格上（线不会跟着指针爬）。
    expect(gridLinePositions(-2.4, 2.4).slice(0, 3)).toEqual([-2, -1, 0])
    // 退化输入与"要画上万条线"的极端情况都返回空数组，而不是抛出或冻住画布。
    expect(gridLinePositions(5, 5, 0)).toEqual([])
    expect(gridLinePositions(Number.NaN, 1)).toEqual([])
    expect(gridLinePositions(0, MAX_GRID_LINES * 2)).toEqual([])
  })
})
