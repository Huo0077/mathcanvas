import { describe, expect, it } from "vitest"

import { nearestPreview } from "./intersectionPreview"

/**
 * 预览命中：两个解挨得很近时，选谁必须由**到光标的屏幕距离**决定，
 * 而不是由 SVG 的绘制顺序（后画的会吃掉点击）决定——这正是旧实现的一个真实缺陷。
 */
describe("nearest intersection preview", () => {
  const project = (point: { x: number; y: number }) => ({ x: point.x * 10, y: point.y * 10 })
  const first = { objectA: "a", objectB: "b", point: { x: 1, y: 0 }, solutionIndex: 0, approximate: false }
  const second = { objectA: "a", objectB: "b", point: { x: 1.5, y: 0 }, solutionIndex: 1, approximate: false }

  it("picks the preview closest to the cursor, not the last drawn one", () => {
    // 光标更靠近第二个解 → 即使第一个解在数组里排在前面也要选第二个。
    expect(nearestPreview([first, second], { x: 14, y: 0 }, project)).toBe(second)
    expect(nearestPreview([first, second], { x: 11, y: 0 }, project)).toBe(first)
    // 顺序反过来结论不变。
    expect(nearestPreview([second, first], { x: 11, y: 0 }, project)).toBe(first)
  })

  it("returns null outside the hit radius", () => {
    // 两个解在屏幕上是 x=10 与 x=15，所以远离它们（x=200）时谁都不命中。
    expect(nearestPreview([first, second], { x: 200, y: 0 }, project)).toBeNull()
    expect(nearestPreview([], { x: 10, y: 0 }, project)).toBeNull()
  })

  it("respects a custom radius", () => {
    expect(nearestPreview([first], { x: 25, y: 0 }, project, 20)).toBe(first)
    expect(nearestPreview([first], { x: 25, y: 0 }, project, 5)).toBeNull()
  })
})
