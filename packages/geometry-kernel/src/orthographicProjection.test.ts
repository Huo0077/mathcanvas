import { describe, expect, it } from "vitest"

import {
  outlinesAgree,
  projectPrismViews,
  projectPyramidViews,
  simplifyOutline,
  type Outline2D
} from "./orthographicProjection"

/**
 * **W7：轮廓反投影（2026-11-09）**。
 *
 * 这一组钉的是"只看包围盒不够"：同一组宽/深/高的**棱柱与棱锥**包围盒完全相同，
 * 但主视图顶点数（4 vs 3）不同、体积不同。轮廓比较必须能区分它们。
 */

const square = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 3 }, { x: 0, y: 3 }]
const lShape = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 2, y: 4 }, { x: 2, y: 6 }, { x: 0, y: 6 }]

describe("W7 直棱柱投影", () => {
  it("projects a 2×3 base extruded to height 4", () => {
    const views = projectPrismViews(square, 4)!
    expect(views.front).toMatchObject({ width: 2, height: 4 })
    expect(views.top).toMatchObject({ width: 2, height: 3 })
    expect(views.side).toMatchObject({ width: 3, height: 4 })
    expect(views.front.vertices).toHaveLength(4)
    expect(views.top.vertices).toHaveLength(4)
  })

  it("keeps the L-shaped top outline at six vertices", () => {
    const views = projectPrismViews(lShape, 5)!
    expect(views.top.vertices).toHaveLength(6)
    expect(views.top.width).toBeCloseTo(6, 12)
    expect(views.top.height).toBeCloseTo(6, 12)
  })

  it("is invariant under translation of the base", () => {
    const moved = square.map((point) => ({ x: point.x + 10, y: point.y - 3 }))
    const views = projectPrismViews(moved, 4)!
    expect(views.front.width).toBeCloseTo(2, 12)
    expect(views.top.height).toBeCloseTo(3, 12)
  })

  it("scales extents with the base and the height", () => {
    const scaled = square.map((point) => ({ x: point.x * 2, y: point.y * 2 }))
    const views = projectPrismViews(scaled, 12)!
    expect(views.front).toMatchObject({ width: 4, height: 12 })
    expect(views.side).toMatchObject({ width: 6, height: 12 })
  })

  it("returns null for a degenerate base or non-positive height", () => {
    expect(projectPrismViews([{ x: 0, y: 0 }, { x: 1, y: 0 }], 2)).toBeNull()
    expect(projectPrismViews([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], 2)).toBeNull()
    expect(projectPrismViews(square, 0)).toBeNull()
    expect(projectPrismViews([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: Number.NaN, y: 2 }], 2)).toBeNull()
  })
})

describe("W7 同一包围盒的棱柱与棱锥", () => {
  it("distinguishes them by outline vertex count, not by bounding box", () => {
    const prism = projectPrismViews(square, 4)!
    const pyramid = projectPyramidViews(2, 3, 4)!
    expect(prism.front).toMatchObject({ width: pyramid.front.width, height: pyramid.front.height })
    expect(prism.front.vertices).toHaveLength(4)
    expect(pyramid.front.vertices).toHaveLength(3)

    const declaredFront = pyramid.front
    expect(outlinesAgree(declaredFront, prism.front)).toMatchObject({ ok: false })
    expect(outlinesAgree(declaredFront, prism.front).reasonCodes).toContain("outline_vertex_mismatch")
    expect(outlinesAgree(declaredFront, pyramid.front).ok).toBe(true)
  })

  it("still compares sizes when the declared outline gives no vertices", () => {
    const prism = projectPrismViews(square, 4)!
    const bare: Outline2D = { width: 2, height: 4, vertices: [] }
    expect(outlinesAgree(bare, prism.front).ok).toBe(true)
    expect(outlinesAgree({ width: 3, height: 4, vertices: [] }, prism.front).ok).toBe(false)
    expect(outlinesAgree({ width: 3, height: 4, vertices: [] }, prism.front).reasonCodes).toContain("outline_width_mismatch")
  })

  it("drops duplicate endpoints and collinear points before comparing", () => {
    const outline = simplifyOutline([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 0, y: 0 }])
    expect(outline).toHaveLength(4)
  })
})
