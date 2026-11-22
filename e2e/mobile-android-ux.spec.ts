import { expect, test } from "@playwright/test"

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true
})

test("Android phone viewport keeps canvas usable, mobile docks dismissible, Agent conversations switchable, and back button wired", async ({ page }) => {
  await page.goto("/")

  // 1. No horizontal page overflow on 390px phone screen.
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)

  // 2. Planar canvas is immediately visible with generous height (status bar compacted to 40px).
  const svg = page.getByRole("img", { name: "几何画布" })
  await expect(svg).toBeVisible()
  const svgBox = await svg.boundingBox()
  expect(svgBox).not.toBeNull()
  expect(svgBox!.height).toBeGreaterThan(220)

  // 3. Mobile dock controls open & Android back closes them cleanly.
  await page.getByRole("button", { name: "对象列表" }).click()
  await expect(page.locator("#algebra-dock")).toHaveClass(/is-mobile-open/)
  const consumedDockBack = await page.evaluate(() => {
    const fn = (window as unknown as { __mathcanvasHandleAndroidBack?: () => boolean }).__mathcanvasHandleAndroidBack
    return fn ? fn() : false
  })
  expect(consumedDockBack).toBe(true)
  await expect(page.locator("#algebra-dock")).not.toHaveClass(/is-mobile-open/)

  // 4. Switch to Agent workspace: mobile conversation drawer & quick new chat work!
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await expect(page.locator(".app-shell")).toHaveAttribute("data-app-module", "agent")
  await expect(page.getByRole("button", { name: "对话列表" })).toBeVisible()
  await expect(page.getByRole("button", { name: "＋ 新对话" })).toBeVisible()

  await page.getByRole("button", { name: "对话列表" }).click()
  await expect(page.locator(".agent-workspace")).toHaveAttribute("data-mobile-sidebar-open", "true")

  // Android back closes the mobile Agent conversation drawer first.
  const consumedDrawerBack = await page.evaluate(() => {
    const fn = (window as unknown as { __mathcanvasHandleAndroidBack?: () => boolean }).__mathcanvasHandleAndroidBack
    return fn ? fn() : false
  })
  expect(consumedDrawerBack).toBe(true)
  await expect(page.locator(".agent-workspace")).toHaveAttribute("data-mobile-sidebar-open", "false")

  // Next Android back returns from Agent workspace to Canvas.
  const consumedModuleBack = await page.evaluate(() => {
    const fn = (window as unknown as { __mathcanvasHandleAndroidBack?: () => boolean }).__mathcanvasHandleAndroidBack
    return fn ? fn() : false
  })
  expect(consumedModuleBack).toBe(true)
  await expect(page.locator(".app-shell")).toHaveAttribute("data-app-module", "traditional")

  // At top-level Canvas with no overlays, Android back returns false so OS handles exit.
  const consumedRootBack = await page.evaluate(() => {
    const fn = (window as unknown as { __mathcanvasHandleAndroidBack?: () => boolean }).__mathcanvasHandleAndroidBack
    return fn ? fn() : true
  })
  expect(consumedRootBack).toBe(false)

  // 5. Switch to 3D workspace on mobile viewport and verify canvas renders cleanly.
  await page.getByRole("button", { name: "立体几何" }).click()
  await expect(page.locator(".three-canvas-shell")).toBeVisible()
  const threeBox = await page.locator(".three-canvas-shell").boundingBox()
  expect(threeBox).not.toBeNull()
  expect(threeBox!.height).toBeGreaterThan(220)
})
