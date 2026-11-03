import { expect, test } from "@playwright/test"

test("keeps workspace navigation in the tab bar and supports Ribbon fold, popup and pin", async ({ page }) => {
  await page.goto("/")

  await expect(page.getByRole("button", { name: "平面几何" })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("banner").getByRole("button", { name: "立体几何" })).toHaveCount(0)

  const ribbon = page.getByRole("region", { name: "功能区" })
  await expect(ribbon).toHaveAttribute("data-ribbon-expanded", "true")
  await page.getByRole("button", { name: "收起功能区" }).click()
  await expect(ribbon).toHaveAttribute("data-ribbon-expanded", "false")
  await expect(ribbon.getByRole("button", { name: "添加点" })).toHaveCount(0)

  await page.getByRole("button", { name: "平面几何" }).click()
  await expect(ribbon.getByRole("button", { name: "添加点" })).toBeVisible()
  await page.getByRole("button", { name: "添加点" }).click()
  await expect(ribbon.getByRole("button", { name: "添加点" })).toHaveCount(0)

  await page.keyboard.press("Control+F1")
  await expect(ribbon).toHaveAttribute("data-ribbon-expanded", "true")

  await page.getByRole("button", { name: "收起功能区" }).click()
  await page.getByRole("button", { name: "平面几何" }).click()
  await page.getByRole("button", { name: "固定功能区" }).click()
  await page.getByRole("button", { name: "添加点" }).click()
  await expect(ribbon.getByRole("button", { name: "添加点" })).toBeVisible()

  await page.getByRole("button", { name: "取消固定功能区" }).click()
  await page.getByRole("status", { name: "操作提示" }).click()
  await expect(ribbon.getByRole("button", { name: "添加点" })).toHaveCount(0)
})

test("keeps the workbench content within the viewport at desktop, tablet and phone widths", async ({ page }) => {
  await page.goto("/")

  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 })
    const metrics = await page.evaluate(() => {
      const shell = document.querySelector(".app-shell")!
      const workbench = document.querySelector(".workbench")!
      const status = workbench.querySelector(".status-bar")!
      return {
        viewportHeight: window.innerHeight,
        shellHeight: shell.getBoundingClientRect().height,
        workbenchHeight: workbench.getBoundingClientRect().height,
        workbenchScrollHeight: workbench.scrollHeight,
        statusBottom: status.getBoundingClientRect().bottom,
        inspectorWidth: workbench.querySelector(".panel.right")!.getBoundingClientRect().width
      }
    })

    expect(metrics.shellHeight).toBe(metrics.viewportHeight)
    expect(metrics.workbenchScrollHeight).toBeLessThanOrEqual(metrics.workbenchHeight)
    expect(metrics.statusBottom).toBeLessThanOrEqual(metrics.viewportHeight)
    if (width === 1440) expect(metrics.inspectorWidth).toBeGreaterThanOrEqual(280)
    if (width === 1440) expect(metrics.inspectorWidth).toBeLessThanOrEqual(300)

    if (width === 390) {
      await page.getByRole("button", { name: "对象列表" }).click()
      await expect(page.locator(".algebra-panel")).toBeVisible()
      await page.getByRole("button", { name: "属性检查器" }).click()
      await expect(page.getByRole("region", { name: "属性检查器" })).toBeVisible()
      await expect(page.locator(".algebra-panel")).toBeHidden()
    }
  }

  await page.getByRole("button", { name: "添加点" }).click()
  await page.getByRole("button", { name: "对象列表" }).click()
  await page.locator(".algebra-panel").getByText("A", { exact: true }).click()
  await page.getByRole("button", { name: "属性检查器" }).click()
  await expect(page.locator(".inspector-selected-heading h3")).toHaveText("A")
  const inspectorBounds = await page.locator(".panel.right").boundingBox()
  expect(inspectorBounds?.width).toBeLessThanOrEqual(358)
  expect((inspectorBounds?.y ?? 900) + (inspectorBounds?.height ?? 0)).toBeLessThanOrEqual(900)

  await page.setViewportSize({ width: 390, height: 900 })
  await page.getByRole("button", { name: "工程制图" }).click()
  const cadMetrics = await page.evaluate(() => {
    const shell = document.querySelector(".app-shell")!
    const workbench = document.querySelector(".engineering-workbench")!
    const status = workbench.querySelector(".workbench-status-region")!
    return {
      viewportHeight: window.innerHeight,
      shellHeight: shell.getBoundingClientRect().height,
      workbenchHeight: workbench.getBoundingClientRect().height,
      workbenchScrollHeight: workbench.scrollHeight,
      statusBottom: status.getBoundingClientRect().bottom
    }
  })

  expect(cadMetrics.shellHeight).toBe(cadMetrics.viewportHeight)
  expect(cadMetrics.workbenchScrollHeight).toBeLessThanOrEqual(cadMetrics.workbenchHeight)
  expect(cadMetrics.statusBottom).toBeLessThanOrEqual(cadMetrics.viewportHeight)
})
