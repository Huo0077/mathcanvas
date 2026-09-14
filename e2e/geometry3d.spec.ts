import { expect, test } from "@playwright/test"

test("opens the 3D workspace and adds a parameterized cube", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()

  const scene = page.locator("[data-3d-scene]")
  await expect(scene).toBeVisible()
  await expect(page.getByText("添加立方体")).toBeVisible()

  await page.getByRole("button", { name: "添加立方体" }).click()
  await expect(page.getByText("立方体 1").first()).toBeVisible()
  await page.getByRole("button", { name: "添加棱锥" }).click()
  await expect(page.getByText("棱锥 1").first()).toBeVisible()
  await page.getByRole("button", { name: "添加圆柱" }).click()
  await expect(page.getByText("圆柱 1").first()).toBeVisible()
  await page.getByRole("button", { name: "添加圆锥" }).click()
  await expect(page.getByText("圆锥 1").first()).toBeVisible()
  await expect(scene).toHaveAttribute("aria-label", "3D 几何场景")
})
