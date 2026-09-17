import { describe, expect, it } from "vitest"

import { FILL_PALETTE, NO_FILL, PLANAR_PALETTE, isActiveColour, normalizeColour, paletteValueOf, supportsFill } from "./palette"

describe("colour palette", () => {
  it("normalizes colours for comparison", () => {
    // 浏览器把 `<input type="color">` 的值统一成小写，两边不一致会让"当前颜色"永远判不中。
    expect(normalizeColour("#FF0000")).toBe("#ff0000")
    expect(normalizeColour(undefined)).toBeUndefined()
    expect(isActiveColour("#FF0000", "#ff0000", "#000000")).toBe(true)
    expect(isActiveColour("#ff0000", undefined, "#ff0000")).toBe(true)
    expect(isActiveColour("#ff0000", undefined, "#00ff00")).toBe(false)
  })

  it("reports which palette entry is current, and nothing when it is a custom colour", () => {
    expect(paletteValueOf(PLANAR_PALETTE, "#dc2626", "#172033")).toBe("#dc2626")
    // 没有显式颜色时用默认色判断，所以"默认就是蓝色"的图元会点亮蓝格。
    expect(paletteValueOf(PLANAR_PALETTE, undefined, "#2563eb")).toBe("#2563eb")
    // 自定义取色器挑的颜色不在色板里：不硬点一格最接近的，界面据此显示"没有预设被选中"。
    expect(paletteValueOf(PLANAR_PALETTE, "#123456", "#172033")).toBeUndefined()
  })

  it("offers 无填充 as a real choice in the fill palette only", () => {
    expect(FILL_PALETTE.some((entry) => entry.value === NO_FILL)).toBe(true)
    expect(PLANAR_PALETTE.some((entry) => entry.value === NO_FILL)).toBe(false)
  })

  /**
   * 哪些图元有"填充"这一说。
   *
   * 点与交点的填充恒等于自身线条色（见 `fillFor`），给它们独立的填充色没有意义 ——
   * 面板上多一个改不动的控件只会让人困惑。
   */
  it("only offers fill on shapes that have an inside", () => {
    expect(supportsFill({ id: "c", type: "circle", center: { x: 0, y: 0 }, radius: 1 })).toBe(true)
    expect(supportsFill({ id: "e", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 2, radiusY: 1 })).toBe(true)
    expect(supportsFill({ id: "p", type: "point", x: 0, y: 0 })).toBe(false)
    expect(supportsFill({ id: "i", type: "intersection", lineA: "a", lineB: "b", x: 0, y: 0 })).toBe(false)
    expect(supportsFill({ id: "l", type: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } })).toBe(false)
  })
})
