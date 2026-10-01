import { describe, expect, it } from "vitest"

import { buildGridGeometry, GRAPH_PAPER_GRID_TOKENS, GRID_FADE_START_RATIO, GRID_MAJOR_COLOR, GRID_MINOR_COLOR, gridFadeBand } from "./threeGrid"

/**
 * 背景栅格的几何：**1 格 = 1 个世界单位**（用户要求"网格大小要严格对应一比一"）。
 * 覆盖 `[-radius, radius]`；主线（每 10 格）与细线分成两份几何，
 * 因为缩得很远时要把细线淡出、只留主线，而两者的间距都必须是精确的整数单位。
 */
const positionsOf = (geometry: ReturnType<typeof buildGridGeometry>) => Array.from(geometry.getAttribute("position").array as Float32Array)

describe("background grid geometry", () => {
  it("draws one line per whole unit on both axes, and covers exactly the radius", () => {
    const positions = positionsOf(buildGridGeometry(4))
    // 每个整数位置两条线（平行 X / 平行 Y），每条线 2 个顶点 × 3 个分量
    expect(positions).toHaveLength(2 * (2 * 4 + 1) * 2 * 3)
    const extent = Math.max(...positions.filter((_, index) => index % 3 !== 2).map(Math.abs))
    expect(extent).toBe(4)
  })

  it("spaces neighbouring lines exactly one world unit apart", () => {
    const positions = positionsOf(buildGridGeometry(4))
    expect(positions.slice(0, 6)).toEqual([-4, -4, 0, -4, 4, 0])
    expect(positions.slice(12, 18)).toEqual([-3, -4, 0, -3, 4, 0])
  })

  it("can skip the lines another layer already draws", () => {
    const minor = buildGridGeometry(10, { skipMultiplesOf: 10 })
    // 21 个整数位置 × 2 条线，减去主线（-10、0、10 → 3 × 2 条）
    const positions = positionsOf(minor)
    expect(positions).toHaveLength((2 * 21 - 6) * 2 * 3)
    // 竖直方向的线里不该再出现 x = -10 / 0 / 10（它们由主线那一层负责）
    const verticals = new Set<number>()
    for (let offset = 0; offset < positions.length; offset += 6) {
      const [x1, , , x2] = positions.slice(offset, offset + 6)
      if (x1 === x2) verticals.add(x1)
    }
    expect([...verticals].some((x) => x % 10 === 0)).toBe(false)
    expect(verticals.size).toBe(21 - 3)
  })

  it("spaces the major lines exactly ten units apart", () => {
    const major = buildGridGeometry(30, { every: 10 })
    // -30、-20、-10、0、10、20、30 → 7 个位置 × 2 条线
    expect(positionsOf(major)).toHaveLength(7 * 2 * 2 * 3)
    const xs = [...new Set(positionsOf(major).filter((_, index) => index % 3 === 0))]
    expect(xs.sort((left, right) => left - right)).toEqual([-30, -20, -10, 0, 10, 20, 30])
  })

  /**
   * 立体几何的 UI 令牌与平面几何对齐：两侧共用**同一组格线色**。
   *
   * three.js 读不到 CSS 变量，颜色只能各写一份，所以这里把"两端同源"钉成断言：
   * 立体几何的栅格色必须与 `styles/tokens.css` 里 `--color-graph-grid-minor/major` 的值**逐字相同**。
   * 忘了同步时，先红的是这条用例，而不是用户的眼睛。
   *
   * 2026-09-18 视觉重构：两个画布整体转冷，格线从暖灰黄换成极浅冷灰（断言从"暖"翻成"冷"）。
   * **2026-10-01 当天翻过一次又翻回来了**：先按用户口径"整个 UI 换成淡黄色 + 纸质感"改成守"暖"，
   * 当天即按用户口径"太丑了，还是回退吧"整体回退 —— 所以这里仍是守"冷"（与回退后的令牌一致）。
   * 那次调色的可恢复副本在 `git stash`（见 CHANGELOG 同日一节）。
   */
  it("uses the same cool grid colours as the canvas tokens", () => {
    expect(GRAPH_PAPER_GRID_TOKENS).toEqual({ minor: "--color-graph-grid-minor", major: "--color-graph-grid-major" })
    expect(GRID_MINOR_COLOR.toLowerCase()).toBe("#cdd8e6")
    expect(GRID_MAJOR_COLOR.toLowerCase()).toBe("#aebccf")
    // 冷色 = 蓝分量不低于红分量（旧的暖灰黄正好相反）。
    const coolness = (hex: string) => Number.parseInt(hex.slice(5, 7), 16) - Number.parseInt(hex.slice(1, 3), 16)
    expect(coolness(GRID_MINOR_COLOR)).toBeGreaterThanOrEqual(0)
    expect(coolness(GRID_MAJOR_COLOR)).toBeGreaterThanOrEqual(0)
  })
})

/**
 * **远处的淡出**（用户口径："把 0 平面也就是 z=0 的格子网做成无限延伸的感觉"）。
 *
 * 栅格终究是一块有限方块（1 格 = 1 单位、按 2 的幂分档），所以它的直边一定存在。
 * 做法不是把方块铺到无穷大（铺不出来），而是让**它在到达边界之前就化开**：
 * 内圈全实、外圈渐隐，到边界处正好为 0 —— 于是那条边永远看不见。
 */
describe("grid distance fade", () => {
  it("fades to nothing exactly at the patch edge", () => {
    const band = gridFadeBand(64)
    expect(band.start).toBeLessThan(band.end)
    expect(band.end).toBe(64)
    // 满实区要占掉大部分半径（否则整块纸都灰蒙蒙的）。
    expect(band.start).toBeGreaterThan(64 * 0.5)
  })

  it("starts the fade at the documented ratio of the radius", () => {
    expect(gridFadeBand(100).start).toBeCloseTo(100 * GRID_FADE_START_RATIO, 6)
    // 这个比例也是"覆盖率"那条计算的依据（见 sceneGrid）：满实区必须盖住可见脚印。
    expect(GRID_FADE_START_RATIO).toBeGreaterThanOrEqual(0.5)
    expect(GRID_FADE_START_RATIO).toBeLessThan(1)
  })

  it("does not blow up on a degenerate radius", () => {
    expect(gridFadeBand(0)).toEqual({ start: 0, end: 0 })
    expect(gridFadeBand(Number.NaN)).toEqual({ start: 0, end: 0 })
  })

  it("bakes the far-field fade into vertex colours (line colour near, paper colour far)", () => {
    const geometry = buildGridGeometry(8, { color: "#000000", paper: "#ffffff", fade: { start: 4, end: 8 } })
    const colour = geometry.getAttribute("color")
    // 着色器 uniform 是 `THREE.Color`（不能塞字符串，那样上传到 GPU 就是垃圾值）：按 hex 比。
    expect(colour.count).toBe(geometry.getAttribute("position").count)
    // 透明度由"一格占多少像素"逐帧写（细线太密时淡出），所以初值只要存在且可写。
    // 近处（块中心附近）必须是格线色：这里格线色取纯黑，方便判据。
    // 淡出端点也是逐帧写的：材质建出来时先给一个不会误伤的区间。
    expect(Math.min(...(colour.array as Float32Array))).toBeLessThan(0.02)
    // 到边界处必须是纸色（白）：那条方块边因此看不见。
    expect(Math.max(...(colour.array as Float32Array))).toBeGreaterThan(0.98)
  })
})
