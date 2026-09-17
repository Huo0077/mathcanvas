import { describe, expect, it } from "vitest"

import { intersectSampledPrimitives, intersectionDedupeTolerance } from "./curve-intersections"

/**
 * 采样求交的去重尺度。
 *
 * 旧的去重容差是 `1e-4 * max(1, |x|, |y|)`，有两个毛病：
 *  1. **随"图形画在离原点多远"膨胀**：同一个半径 1 的圆放在原点附近容差是 1e-4，
 *     平移到 x≈1000 之后容差变成 0.1，于是用 y = √(1 − 0.025²) 的割线去切时，
 *     两个相距 **0.0497** 的真实交点被并成一个（实测）。
 *  2. **相对容差本身太松**：1e-4 是"图形尺寸的万分之一"，一个尺寸 2800 的图形
 *     （半径 1000 的圆）就会把相距 0.05 的两个交点并掉。
 *
 * 不变式：**交点的数量只跟图形自身的大小有关，与它画在平面的哪里无关；而"图形尺寸的
 * 相对容差"必须是机器精度量级**——因为"同一交点的重复候选"实测是**完全相等**的
 * （交点落在采样顶点上时，相邻两条弦给出同一个 double，间距 0.000e+0）。
 */

const circle = (centerX: number, radius = 1) => ({ id: "circle", type: "circle" as const, center: { x: centerX, y: 0 }, radius })

/**
 * 水平割线。定义点 `a` 放在圆心正上方：`line` 是按 `a - 100u … a + 100u` 采样成一条**有限**折线的，
 * 把定义点写在图形外面（比如半径 1000 的圆却把点写在 ±2000）会让采样窗口整段落在图形之外——
 * 那是测试数据的问题，不是求交的问题。
 */
const secant = (centerX: number, radius = 1, ratio = Math.sqrt(1 - 0.025 ** 2)) => ({
  id: "line",
  type: "line" as const,
  a: { x: centerX, y: ratio * radius },
  b: { x: centerX + 1, y: ratio * radius }
})

describe("sampled intersection dedupe", () => {
  it("keeps two crossings 0.05 apart wherever the figure sits", () => {
    for (const centerX of [0, 20, 1000, 100000]) {
      const result = intersectSampledPrimitives(circle(centerX), secant(centerX))

      expect(result.kind, `centre x=${centerX}`).toBe("points")
      if (result.kind !== "points") continue
      expect(result.points, `centre x=${centerX}`).toHaveLength(2)
      const gap = Math.abs(result.points[0].x - result.points[1].x)
      expect(gap, `centre x=${centerX}`).toBeGreaterThan(0.04)
      expect(gap, `centre x=${centerX}`).toBeLessThan(0.06)
    }
  })

  it("keeps a near-tangent pair on a figure whose own size is 2800", () => {
    // 半径 1000 的圆、几乎相切的割线：两个交点相距约 5e-5，都落在圆顶附近。
    // 旧容差是 1e-4 × 1000 = 0.1，把它们并成一个；新容差是图形尺寸的 1e-9（≈3e-6）。
    const radius = 1000
    const ratio = Math.sqrt(1 - (0.025 / radius) ** 2)
    const result = intersectSampledPrimitives(circle(0, radius), secant(0, radius, ratio))

    expect(result.kind).toBe("points")
    if (result.kind !== "points") return
    expect(result.points).toHaveLength(2)
    // 不写死间距：采样点数一改，近切交点的间距就跟着变。这里只要求两个交点都在刀口附近。
    expect(result.points.every((point) => Math.abs(point.x) < 0.1 && point.y > radius - 1)).toBe(true)
  })

  it("still merges the exact duplicates a crossing on a sample vertex produces", () => {
    // 圆的两个采样顶点（角度 0 与 π）正好落在 x 轴上，每个交点会被相邻两条弦各算一次
    const result = intersectSampledPrimitives(
      { id: "circle", type: "circle", center: { x: 0, y: 0 }, radius: 1 },
      { id: "line", type: "line", a: { x: -2, y: 0 }, b: { x: 2, y: 0 } }
    )

    expect(result.kind).toBe("points")
    if (result.kind !== "points") return
    expect(result.points).toHaveLength(2)
    expect(result.points.map((point) => point.x).sort((left, right) => left - right)).toEqual([-1, 1])
  })
})

describe("intersectionDedupeTolerance", () => {
  it("depends on the figure size, not on where the figure sits", () => {
    const cloud = (offset: number) => [[{ x: offset, y: 0 }, { x: offset + 2, y: 0 }]]

    const atOrigin = intersectionDedupeTolerance(cloud(0))
    const farAway = intersectionDedupeTolerance(cloud(1000))

    expect(farAway).toBe(atOrigin)
    const relative = atOrigin / 2
    expect(relative).toBeGreaterThan(0.9e-9)
    expect(relative).toBeLessThan(1.1e-9)
    // 旧实现是 1e-4 乘上"离原点多远"，这里明确记录"不再有那个量级"
    expect(relative).toBeLessThan(1e-6)
  })

  it("grows with the figure size", () => {
    const small = intersectionDedupeTolerance([[{ x: 0, y: 0 }, { x: 2, y: 0 }]])
    const big = intersectionDedupeTolerance([[{ x: 0, y: 0 }, { x: 2000, y: 0 }]])

    expect(big / small).toBeCloseTo(1000, 6)
  })
})
