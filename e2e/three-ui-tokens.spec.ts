import { expect, test } from "@playwright/test"

/**
 * 立体几何的 UI 令牌与平面几何对齐（slice 6）。
 *
 * 用户口径："优化立体几何的 ui 设计，主要参考平面几何的 ui 设计。"
 *
 * 这一条守的是**令牌**而不是像素：两个画布都带 `data-canvas-surface="graph-paper"`（同一套纸色 / 纸纹 /
 * 水印 / 控件样式都由它命中），并且立体几何的栅格色与平面几何的 CSS 变量**逐字相同**——
 * three.js 读不到 CSS 变量，颜色只能各写一份，所以这条断言就是"两端同源"的守卫（截图对照是另一道）。
 */
test("dresses the 3D canvas in the planar paper tokens", async ({ page }) => {
  await page.goto("/")

  // 平面几何：纸令牌的名字。
  const planar = page.locator(".graphics")
  await expect(planar).toHaveAttribute("data-canvas-surface", "graph-paper")
  const gridMinorToken = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-graph-grid-minor").trim())
  const gridMajorToken = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-graph-grid-major").trim())

  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  const scene = page.locator("[data-3d-scene]")
  // 同一个标记名：两侧共用一套 CSS 规则，而不是各写一份"看起来差不多"的颜色。
  await expect(scene).toHaveAttribute("data-canvas-surface", "graph-paper")
  await page.getByRole("button", { name: "添加立方体" }).click()

  // 栅格色 = 平面几何的格线令牌（一字不差）。
  await expect(scene).toHaveAttribute("data-grid-colors", `${gridMinorToken},${gridMajorToken}`)

  // 纸色也确实落到了画布上：外壳的背景是**冷色**（蓝分量 ≥ 红分量），与 #F8FAFC / #E2E8F0 的那套冷调一致
  //（2026-09-18 视觉重构之前这里断言的是"暖色草稿纸"，本轮按用户口径整体转冷，断言方向随之翻转）。
  const shellBackground = await page.locator(".three-canvas-shell").evaluate((element) => getComputedStyle(element).backgroundImage + getComputedStyle(element).backgroundColor)
  const coolness = await page.locator(".three-canvas-shell").evaluate((element) => {
    const renderTarget = element.querySelector(".three-render-target") as HTMLElement | null
    const [red, , blue] = getComputedStyle(renderTarget ?? element).backgroundColor.match(/\d+/g)?.map(Number) ?? [0, 0, 0]
    return blue - red
  })
  expect(shellBackground).toContain("gradient")
  expect(coolness).toBeGreaterThanOrEqual(0)
})
