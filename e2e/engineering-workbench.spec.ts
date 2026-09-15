import { readFile } from "node:fs/promises"

import { expect, test } from "@playwright/test"

test("drafts on a new layer, hides it, and keeps the layout after a refresh", async ({ page }) => {
  await page.goto("/")
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/cad-point.mgeo")
  await page.getByRole("button", { name: "工程制图" }).click()

  // A legacy .mgeo document is migrated to the default layer, sheet and four-view layout.
  await page.getByRole("tab", { name: "图层树" }).click()
  await expect(page.getByRole("button", { name: "几何", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "尺寸", exact: true })).toBeVisible()

  // Create and activate a layer, then draw a line on it in 2D drafting mode.
  await page.getByRole("button", { name: "新建图层" }).click()
  await page.getByRole("button", { name: "图层 1", exact: true }).click()
  await page.getByRole("button", { name: "2D 绘图" }).click()
  await page.getByRole("button", { name: "创建", exact: true }).click()
  await page.getByRole("button", { name: "添加直线" }).click()

  const surface = page.getByRole("img", { name: /模型视图/ })
  await surface.click({ position: { x: 120, y: 120 } })
  await surface.click({ position: { x: 280, y: 220 } })
  await expect(page.locator(".engineering-drawing-draft")).toHaveCount(1)

  // Hiding the layer removes its geometry from the drafting viewport.
  await page.getByRole("button", { name: "隐藏 图层 1" }).click()
  await expect(page.locator(".engineering-drawing-draft")).toHaveCount(0)

  // Change a projection view scale, which is persisted document state.
  await page.getByRole("button", { name: "3D 投影" }).click()
  await page.getByRole("button", { name: "放大 主视图" }).click()
  await expect(page.locator('.drawing-viewport[data-view-id="view-front"]')).toContainText("比例 1.5")

  await page.reload()

  // The CAD workspace, the active tree tab, the hidden layer and the view scale all survive the refresh.
  await expect(page.getByRole("button", { name: "工程制图" })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("tab", { name: "图层树" })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("button", { name: "显示 图层 1" })).toBeVisible()
  await expect(page.locator('.drawing-viewport[data-view-id="view-front"]')).toContainText("比例 1.5")
})

test("undoes and redoes from both the buttons and the keyboard", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "工程制图" }).click()

  const workbench = page.locator(".engineering-workbench")
  const revision = async () => Number(await workbench.getAttribute("data-revision"))
  const undo = page.getByRole("button", { name: "撤销" })
  const redo = page.getByRole("button", { name: "重做" })

  // A restored document starts with no history: the buttons used to look enabled and do nothing.
  await expect(undo).toBeDisabled()
  await expect(redo).toBeDisabled()

  await page.getByRole("button", { name: "创建", exact: true }).click()
  await page.getByRole("button", { name: "空间点", exact: true }).click()
  await expect.poll(revision).toBe(1)
  await expect(undo).toBeEnabled()
  await expect(redo).toBeDisabled()

  // Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z were unbound anywhere in the app before this fix.
  await page.keyboard.press("Control+z")
  await expect.poll(revision).toBe(0)
  await expect(undo).toBeDisabled()
  await expect(redo).toBeEnabled()

  await page.keyboard.press("Control+Shift+z")
  await expect.poll(revision).toBe(1)
  await page.keyboard.press("Control+z")
  await expect.poll(revision).toBe(0)

  await redo.click()
  await expect.poll(revision).toBe(1)
  await undo.click()
  await expect.poll(revision).toBe(0)
})

test("keeps hidden views out of the exported SVG", async ({ page }) => {
  await page.goto("/")
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/cad-dimension.mgeo")
  await page.getByRole("button", { name: "工程制图" }).click()

  await page.getByRole("tab", { name: "图纸树" }).click()
  const tree = page.getByRole("region", { name: "模型与图纸树" })
  await tree.getByRole("button", { name: "隐藏 主视图" }).click()

  await page.getByRole("button", { name: "导出", exact: true }).click()
  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "导出 SVG", exact: true }).click()
  const path = await (await download).path()
  const svg = await readFile(path, "utf8")

  expect(svg).toContain('data-drawing-view="top"')
  expect(svg).not.toContain('data-drawing-view="front"')
})

test("supports keyboard selection, command entry, cancellation and inspector tabs", async ({ page }) => {
  await page.goto("/")
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/cad-point.mgeo")
  await page.getByRole("button", { name: "工程制图" }).click()

  const source = page.getByRole("main", { name: "工程制图视图" }).locator('[data-source-id="point3-1"]').first()
  await source.focus()
  await page.keyboard.press("Enter")
  await expect(page.locator('[data-source-id="point3-1"][data-selected="true"]')).toHaveCount(4)

  const inspector = page.getByRole("region", { name: "工程属性检查器" })
  await inspector.getByRole("tab", { name: "数据" }).focus()
  await page.keyboard.press("ArrowRight")
  await expect(inspector.getByRole("tab", { name: "外观" })).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("ArrowLeft")
  await expect(inspector.getByRole("tab", { name: "数据" })).toHaveAttribute("aria-selected", "true")

  await page.getByRole("button", { name: "创建", exact: true }).click()
  await page.getByRole("button", { name: "空间点", exact: true }).click()
  await expect(page.getByRole("region", { name: "工程状态栏" })).toContainText("空间点")

  await page.keyboard.press("Escape")
  await expect(page.getByRole("button", { name: "空间点", exact: true })).toHaveCount(0)
})
