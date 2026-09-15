import { expect, test } from "@playwright/test"

test("opens the CAD workspace with four accessible engineering views", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "工程制图" }).click()

  const engineeringDrawing = page.getByRole("main", { name: "工程制图视图" })
  await expect(engineeringDrawing).toBeVisible()
  await expect(engineeringDrawing.locator("[data-drawing-view]")).toHaveCount(4)
  await expect(engineeringDrawing.getByText("暂无可投影的空间对象")).toHaveCount(4)
  await expect(page.getByRole("button", { name: "添加点" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "导出 SVG" })).toBeDisabled()
  await expect(page.getByText("工程制图根据当前文档的 3D 点、棱和面显示四个视图。")).toBeVisible()
})

test("links CAD views with temporary projection lines and shared source selection", async ({ page }) => {
  await page.goto("/")
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/cad-point.mgeo")
  await page.getByRole("button", { name: "工程制图" }).click()

  const engineeringDrawing = page.getByRole("main", { name: "工程制图视图" })
  const source = engineeringDrawing.locator('[data-source-id="point3-1"]')
  await expect(source).toHaveCount(4)
  await source.first().click()
  await expect(engineeringDrawing.locator('[data-source-id="point3-1"][data-selected="true"]')).toHaveCount(4)

  const projectionToggle = page.getByRole("button", { name: "显示投影线" })
  await projectionToggle.click()
  await expect(page.getByRole("button", { name: "隐藏投影线" })).toHaveAttribute("aria-pressed", "true")
  await expect(engineeringDrawing.getByTestId("projection-line")).toHaveCount(12)

  await page.getByRole("button", { name: "隐藏投影线" }).click()
  await expect(engineeringDrawing.getByTestId("projection-line")).toHaveCount(0)
  await expect(engineeringDrawing.locator('[data-source-id="point3-1"][data-selected="true"]')).toHaveCount(4)
})
