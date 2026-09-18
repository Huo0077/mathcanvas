import { expect, test } from "@playwright/test"

test.use({ viewport: { width: 1280, height: 900 } })

/**
 * 用户反馈："平面缩放也会导致网格大小变化，我需要固定网格大小。"
 *
 * 与 3D 背景网格同一套语义（当时的原话是"立体缩放不要改变网格图大小，网格大小要严格对应一比一"）：
 * **一格恒为 1 个世界单位**，缩放只改变可见范围（看到更多 / 更少的格），格子的世界尺寸不变。
 * 这里直接在真实浏览器里量：取相邻两条竖网格线在 SVG 里的间距，除以当前缩放，必须恒为 1。
 */
test("keeps the planar grid at one world unit per cell while zooming", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到平面几何" }).click()
  const canvas = page.getByRole("img", { name: "几何画布" })
  await expect(canvas).toHaveAttribute("data-grid-cell", "1")
  await expect(canvas).toHaveAttribute("data-grid-major", "10")

  /** 某一层竖网格线的世界坐标（只比较差值，因此"SVG 单位 ÷ 缩放"就够了）。 */
  const verticalWorldPositions = async (layer: "minor" | "major") => {
    const scale = Number(await canvas.getAttribute("data-viewport-scale"))
    const xs = await canvas.locator(`[data-grid-layer="${layer}"] line`).evaluateAll((lines) => lines
      .filter((line) => line.getAttribute("x1") === line.getAttribute("x2"))
      .map((line) => Number(line.getAttribute("x1"))))
    return [...new Set(xs)].sort((first, second) => first - second).map((value) => value / scale)
  }
  const gapsOf = (positions: number[]) => positions.slice(1).map((value, index) => Number((value - positions[index]).toFixed(6)))

  /** 细线 + 主线合起来的相邻间距：必须处处相等，且等于 1 个世界单位。 */
  const worldSpacing = async () => {
    const all = [...await verticalWorldPositions("minor"), ...await verticalWorldPositions("major")].sort((first, second) => first - second)
    const gaps = gapsOf([...new Set(all)])
    expect(gaps.length, "至少要有两条竖网格线才能量间距").toBeGreaterThan(0)
    expect(new Set(gaps).size, "相邻间距不一致就说明格子在变").toBe(1)
    return gaps[0]
  }

  expect(await worldSpacing()).toBeCloseTo(1, 6)
  // 主线每 10 格一条，间距同样固定。
  const majorGaps = gapsOf(await verticalWorldPositions("major"))
  expect(majorGaps.length).toBeGreaterThan(0)
  expect(majorGaps.every((gap) => Math.abs(gap - 10) < 1e-6)).toBe(true)

  const box = (await canvas.boundingBox())!
  await canvas.hover({ position: { x: box.width / 2, y: box.height / 2 } })

  // 放大：格子在屏幕上更大，但世界尺寸还是 1。
  await page.mouse.wheel(0, -600)
  expect(await canvas.getAttribute("data-grid-cell")).toBe("1")
  expect(await worldSpacing()).toBeCloseTo(1, 6)
  expect(gapsOf(await verticalWorldPositions("major")).every((gap) => Math.abs(gap - 10) < 1e-6)).toBe(true)

  // 缩小：看到更多格，每格的边长仍然是 1。
  await page.mouse.wheel(0, 2000)
  expect(await worldSpacing()).toBeCloseTo(1, 6)

  // 重置视图后也一样（默认视图的格边长本来就是 1）。
  await page.getByRole("button", { name: "重置视图" }).click()
  await expect(canvas).toHaveAttribute("data-viewport-center", "0,0")
  expect(await worldSpacing()).toBeCloseTo(1, 6)
})
