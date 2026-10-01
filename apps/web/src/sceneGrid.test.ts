import { describe, expect, it } from "vitest"

import { GRID_CELL, GRID_FADE_START_RATIO, GRID_MAJOR_EVERY, gridPlacement, gridRadius, niceGridStep } from "./sceneGrid"

/**
 * 背景坐标系的尺寸与位置。
 *
 * 用户反馈："立体缩放不要改变网格图大小，网格大小要严格对应一比一。"
 * 旧实现按可见范围挑"好读"的格边长（1/2/5 × 10ⁿ），于是缩放时格子的**世界尺寸**一直在变，
 * 网格不再是一把可靠的尺子。现在格边长**恒为 1 个世界单位**，只有覆盖范围随视图长大。
 */

const base = {
  distance: 16,
  fovDegrees: 42,
  aspect: 16 / 9,
  target: { x: 0, y: 0 },
  contentSpan: 0,
  contentReach: 0
}

describe("background coordinate system placement", () => {
  it("always uses one world unit per cell, whatever the zoom", () => {
    for (const distance of [0.5, 4, 16, 120, 2000]) {
      const placement = gridPlacement({ ...base, distance })
      expect(placement.cell, `distance=${distance}`).toBe(GRID_CELL)
      expect(placement.cell, `distance=${distance}`).toBe(1)
    }
  })

  it("does not move or resize the grid while zooming inside one coverage step", () => {
    // 这是用户报告的核心：视图缩放时网格本身**完全不动**（同档内覆盖范围也一致）。
    const near = gridPlacement({ ...base, distance: 100, target: { x: 3.2, y: -1.4 } })
    const far = gridPlacement({ ...base, distance: 105, target: { x: 3.2, y: -1.4 } })

    expect(far.cell).toBe(near.cell)
    expect(far.extent).toBe(near.extent)
    expect(far.centre).toEqual(near.centre)
  })

  it("covers more area (same unit cells) when zoomed out a long way", () => {
    const near = gridPlacement({ ...base, distance: 100 })
    const far = gridPlacement({ ...base, distance: 4000 })

    expect(far.extent).toBeGreaterThan(near.extent)
    expect(far.cell).toBe(near.cell)
    // 覆盖范围按 2 的幂分档，并且真的盖住可见范围。
    expect(Number.isInteger(Math.log2(far.extent))).toBe(true)
  })

  it("covers the visible span so the plane never runs out at the edges", () => {
    const placement = gridPlacement({ ...base, distance: 40, aspect: 2 })
    const visibleHalfWidth = 40 * Math.tan((42 * Math.PI) / 360) * 2

    expect(placement.extent).toBeGreaterThanOrEqual(visibleHalfWidth)
  })

  it("reaches content that sits far from the origin", () => {
    const placement = gridPlacement({ ...base, contentSpan: 22.8, contentReach: 20.1 })

    expect(placement.centre.x - placement.extent).toBeLessThanOrEqual(0)
    expect(placement.centre.x + placement.extent).toBeGreaterThanOrEqual(20)
  })

  it("snaps the centre to whole units so the lines do not crawl while orbiting", () => {
    const placement = gridPlacement({ ...base, target: { x: 3.7, y: -1.2 }, contentSpan: 10, contentReach: 6 })

    expect(placement.centre.x).toBe(4)
    expect(placement.centre.y).toBe(-1)
  })

  it("marks every tenth line as a major line", () => {
    expect(gridPlacement(base).majorEvery).toBe(GRID_MAJOR_EVERY)
    expect(GRID_MAJOR_EVERY).toBe(10)
  })

  it("keeps the axes in the same order of magnitude as the visible area", () => {
    expect(gridPlacement({ ...base, distance: 40 }).axesLength).toBeGreaterThan(10)
    expect(gridPlacement(base).axesLength).toBeGreaterThan(1)
  })
})

describe("gridRadius", () => {
  it("rounds up to a power-of-two multiple of the smallest radius", () => {
    expect(gridRadius(1)).toBe(8)
    expect(gridRadius(8)).toBe(8)
    expect(gridRadius(9)).toBe(16)
    expect(gridRadius(40)).toBe(64)
  })

  it("never returns anything smaller than the minimum", () => {
    for (const value of [0, -5, Number.NaN, 0.001]) expect(gridRadius(value)).toBe(8)
  })
})

describe("regression: the old fixed-extent grid could not reach content at x = 20", () => {
  it("reaches it now, and its axes are longer than the old formula's", () => {
    /**
     * 旧实现的公式照抄在这里，用来固定用户报告过的现象：栅格固定 14 格、以**原点**为中心、
     * 格边长 = nice(max(内容对角线, 4) / 14)。"原点一个立方体 + 一个位于 x = 20 的点"时
     * 坐标面只铺到 ±14 —— 点落在外面。
     */
    const oldFormula = (contentSpan: number) => {
      const cell = niceGridStep(Math.max(contentSpan, 4) / 14)
      return { extent: 7 * cell, axesLength: Math.max(Math.min((contentSpan / 2) * 1.6, 60) * 0.7, 1.2) }
    }

    const cubeAndFarPoint = { contentSpan: 22.8, contentReach: 20.1 }
    const old = oldFormula(cubeAndFarPoint.contentSpan)
    expect(old.extent).toBeLessThan(20)
    expect(old.axesLength).toBeLessThan(20)

    const placement = gridPlacement({ ...base, ...cubeAndFarPoint })
    expect(placement.centre.x - placement.extent).toBeLessThanOrEqual(0)
    expect(placement.centre.x + placement.extent).toBeGreaterThanOrEqual(20)
    expect(placement.axesLength).toBeGreaterThan(old.axesLength)
  })
})

/**
 * **可见地面脚印**（用户口径 2026-10-01："把 0 平面也就是 z=0 的格子网做成无限延伸的感觉"）。
 *
 * 只看 `visibleWidth/Height` 是不够的：贴地视角下 z=0 平面在画面上一直延伸到地平线，
 * 可见脚印比"视口宽高"远得多，于是那块方块的直边就进了画面。这里把脚印当输入，
 * 并且按**淡出比例**倒推所需半径 —— 满实区必须盖住脚印，化开的那一圈落在视野之外。
 */
describe("grid coverage for the visible ground footprint", () => {
  it("grows the patch so the fully opaque zone still covers the footprint", () => {
    const placement = gridPlacement({ ...base, groundReach: 200 })

    // 满实区（淡出起点以内）必须盖住脚印：否则远处会在画面里化开。
    expect(placement.extent * GRID_FADE_START_RATIO).toBeGreaterThanOrEqual(200)
    // 仍然按 2 的幂分档（同档内不许动）。
    expect(Number.isInteger(Math.log2(placement.extent / 8))).toBe(true)
  })

  it("ignores the footprint when there is none", () => {
    expect(gridPlacement({ ...base, groundReach: 0 }).extent).toBe(gridPlacement(base).extent)
    expect(gridPlacement({ ...base, groundReach: Number.NaN }).extent).toBe(gridPlacement(base).extent)
  })

  it("stays in one coverage step while a small zoom happens", () => {
    // 脚印会随缩放微微变，但档位是 2 的幂：小幅缩放不许换档，否则那圈网格会跳一下。
    const near = gridPlacement({ ...base, distance: 100, groundReach: 120 })
    const far = gridPlacement({ ...base, distance: 104, groundReach: 124 })

    expect(far.extent).toBe(near.extent)
  })

  it("keeps the footprint requirement dominated by the patch, never the other way round", () => {
    // 极端贴地（脚印极大）时撞上覆盖上限：仍然给一个有限的、能铺出来的方块。
    const placement = gridPlacement({ ...base, groundReach: 1e9 })

    expect(Number.isFinite(placement.extent)).toBe(true)
    expect(placement.extent).toBeLessThanOrEqual(4096)
  })
})
