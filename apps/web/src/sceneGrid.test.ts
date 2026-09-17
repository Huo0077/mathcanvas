import { describe, expect, it } from "vitest"

import { GRID_CELLS, gridPlacement, niceGridStep } from "./sceneGrid"

const base = {
  distance: 16,
  fovDegrees: 42,
  aspect: 16 / 9,
  target: { x: 0, y: 0 },
  contentSpan: 0,
  contentReach: 0
}

describe("background coordinate system placement", () => {
  it("keeps a readable cell size and shows a usable plane for an empty scene", () => {
    const placement = gridPlacement(base)

    expect(placement.cell).toBeGreaterThan(0)
    expect(niceGridStep(placement.cell)).toBe(placement.cell)
    expect(placement.extent).toBeGreaterThanOrEqual(4)
  })

  it("reaches content that sits far from the origin", () => {
    // 用户报告：点的坐标设到 20 左右就"跑到坐标系外面"。栅格必须铺到那里。
    const placement = gridPlacement({ ...base, contentSpan: 22.8, contentReach: 20.1 })

    expect(placement.centre.x - placement.extent).toBeLessThanOrEqual(-2)
    expect(placement.centre.x + placement.extent).toBeGreaterThanOrEqual(20)
  })

  it("still reaches content 200 units away", () => {
    const placement = gridPlacement({ ...base, contentSpan: 200, contentReach: 200 })

    expect(placement.centre.x + placement.extent).toBeGreaterThanOrEqual(200)
  })

  it("scales the cell with the visible span, so zooming out shows more area instead of empty space", () => {
    const near = gridPlacement({ ...base, distance: 5 })
    const far = gridPlacement({ ...base, distance: 200 })

    expect(far.cell).toBeGreaterThan(near.cell)
    // 格子数恒定：变的是格边长，不是可见范围（否则缩小后就只剩一小块坐标面）。
    expect(far.extent / far.cell).toBeCloseTo(GRID_CELLS / 2, 6)
    expect(near.extent / near.cell).toBeCloseTo(GRID_CELLS / 2, 6)
  })

  it("snaps the centre to the cell so the lines do not crawl while orbiting", () => {
    const placement = gridPlacement({ ...base, target: { x: 3.7, y: -1.2 }, contentSpan: 10, contentReach: 6 })

    expect(placement.centre.x % placement.cell).toBeCloseTo(0, 9)
    expect(placement.centre.y % placement.cell).toBeCloseTo(0, 9)
  })

  it("keeps the axes in the same order of magnitude as the visible area", () => {
    expect(gridPlacement({ ...base, distance: 40 }).axesLength).toBeGreaterThan(10)
    expect(gridPlacement(base).axesLength).toBeGreaterThan(1)
  })

  it("reaches content the old fixed-extent grid could not", () => {
    /**
     * 旧实现的公式（见提交 27236bf 的 threeScene.tsx）照抄在这里，用来证明用户报告的现象：
     * 栅格固定 14 格、以**原点**为中心、格边长 = nice(max(内容对角线, 4) / 14)；
     * 坐标轴长 = max(min(内容半径 × 1.6, 60) × 0.7, 1.2)。
     * 场景是"原点一个立方体 + 一个位于 x = 20 的点"时，坐标面只铺到 ±14 —— 点在外面。
     */
    const oldFormula = (contentSpan: number) => {
      const cell = niceGridStep(Math.max(contentSpan, 4) / 14)
      return {
        extent: (14 / 2) * cell,
        axesLength: Math.max(Math.min((contentSpan / 2) * 1.6, 60) * 0.7, 1.2)
      }
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
