import { expect, test } from "@playwright/test"

import { projectWorldPoint } from "./helpers/projection"

test("keeps a teacher's dashed spatial segment separate from view-only hidden edges", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "绘制线段" }).click()
  for (const point of [{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }]) {
    const projected = await projectWorldPoint(page, point)
    await page.mouse.click(projected.x, projected.y)
  }
  await expect(page.locator(".algebra-panel").getByText("空间线段 1").first()).toBeVisible()
  await page.getByRole("button", { name: "外观样式" }).click()
  const style = page.getByRole("combobox", { name: "教学线型" })
  await expect(style).toHaveValue("solid")
  await style.selectOption("8 6")
  await expect(style).toHaveValue("8 6")
  await page.getByRole("button", { name: "隐藏边" }).click()
  await expect(style).toHaveValue("8 6")
  await expect(page.getByText(/教学虚线.*隐藏边/)).toBeVisible()
  await page.getByRole("button", { name: "隐藏边" }).click()
  await expect(style).toHaveValue("8 6")
})