import { expect, test } from "@playwright/test"

test("opens the CAD workspace with four accessible engineering views", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到工程制图" }).click()

  const engineeringDrawing = page.getByRole("main", { name: "工程制图视图" })
  await expect(engineeringDrawing).toBeVisible()
  await expect(engineeringDrawing.locator("[data-drawing-view]")).toHaveCount(4)
  await expect(engineeringDrawing.getByText("暂无可投影的空间对象")).toHaveCount(4)
  await expect(page.getByRole("button", { name: "添加点" })).toHaveCount(0)
  await expect(page.getByRole("region", { name: "工程状态栏" })).toContainText("工程制图根据当前文档的 3D 点、棱和面显示四个视图。")

  await expect(page.getByRole("button", { name: "导出 SVG", exact: true })).toBeEnabled()
})

test("links CAD views with temporary projection lines and shared source selection", async ({ page }) => {
  await page.goto("/")
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/cad-point.mgeo")
  await page.getByRole("button", { name: "跳转到工程制图" }).click()

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

test("creates a linear engineering annotation from selected CAD sources", async ({ page }) => {
  await page.goto("/")
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/cad-dimension.mgeo")
  await page.getByRole("button", { name: "跳转到工程制图" }).click()

  const engineeringDrawing = page.getByRole("main", { name: "工程制图视图" })
  await engineeringDrawing.locator('[data-source-id="point3-1"]').first().click()
  await engineeringDrawing.locator('[data-source-id="point3-2"]').first().click({ modifiers: ["Shift"] })
  await page.getByRole("tab", { name: "工程标注" }).click()
  await page.getByRole("button", { name: "Add linear annotation" }).click()

  await expect(engineeringDrawing.getByTestId("engineering-annotation")).toContainText("5.000 mm")
  await expect(page.getByRole("tab", { name: "工程标注" })).toHaveAttribute("aria-selected", "true")
})

test("exports CAD views as SVG, DXF, and PDF", async ({ page }) => {
  await page.goto("/")
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/cad-dimension.mgeo")
  await page.getByRole("button", { name: "跳转到工程制图" }).click()
  for (const [label, extension] of [["导出 SVG", ".svg"], ["导出 DXF", ".dxf"], ["导出 PDF", ".pdf"]] as const) {
    const download = page.waitForEvent("download")
    await page.getByRole("button", { name: label, exact: true }).click()
    await expect((await download).suggestedFilename()).toMatch(new RegExp(`${extension.replace(".", "\\.")}$`))
  }
})

/**
 * **球的工程投影**（实施计划 Task 7）。
 *
 * 球区别于所有多面体的那条性质：**正投影下它的轮廓永远是半径等于球半径的圆，与视线方向无关**。
 * 所以判据不是"导出文件非空"，而是**四个视图里每一个都有这条轮廓**（立方体在四个视图里是三个
 * 不同的矩形，而球是四个同样大的圆）。半径本身由单元用例钉住
 * （`apps/web/src/sphereProjection.test.ts`：四个视图的点集半径都等于球半径）。
 */
test("projects a sphere as an outline in all four CAD views and exports it", async ({ page }) => {
  await page.goto("/")
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/cad-sphere.mgeo")
  await page.getByRole("button", { name: "跳转到工程制图" }).click()

  const engineeringDrawing = page.getByRole("main", { name: "工程制图视图" })
  const viewports = engineeringDrawing.locator("[data-drawing-view]")
  await expect(viewports).toHaveCount(4)
  // 不是"总共 4 条"就算 —— 逐个视图点名，否则"四条全挤在一个视图里"也会绿。
  for (let index = 0; index < 4; index += 1) {
    await expect(viewports.nth(index).locator('[data-source-id="sphere-1"]'), `第 ${index + 1} 个视图里的球轮廓`).toHaveCount(1)
  }
  // 有东西可投影，就不该再显示"暂无可投影的空间对象"。
  await expect(engineeringDrawing.getByText("暂无可投影的空间对象")).toHaveCount(0)

  for (const [label, extension] of [["导出 SVG", ".svg"], ["导出 DXF", ".dxf"], ["导出 PDF", ".pdf"]] as const) {
    const download = page.waitForEvent("download")
    await page.getByRole("button", { name: label, exact: true }).click()
    await expect((await download).suggestedFilename()).toMatch(new RegExp(`${extension.replace(".", "\\.")}$`))
  }
})
