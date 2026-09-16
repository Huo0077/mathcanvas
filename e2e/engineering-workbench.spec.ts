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
  await page.getByRole("button", { name: "添加直线" }).click()

  const surface = page.getByRole("img", { name: /模型视图/ })
  await surface.click({ position: { x: 120, y: 120 } })
  await surface.click({ position: { x: 280, y: 220 } })
  await expect(page.locator(".engineering-drawing-draft")).toHaveCount(1)

  // Hiding the layer removes its geometry from the drafting viewport.
  await page.getByRole("button", { name: "隐藏 图层 1" }).click()
  await expect(page.locator(".engineering-drawing-draft")).toHaveCount(0)

  // Change a projection view scale, which is persisted document state. The per-view controls appear on hover,
  // so the panel is hovered first.
  await page.getByRole("button", { name: "3D 投影" }).click()
  const frontView = page.locator('.drawing-viewport[data-view-id="view-front"]')
  await frontView.hover()
  await page.getByRole("button", { name: "放大 主视图" }).click()
  await expect(page.getByRole("button", { name: "缩小 主视图" })).toBeEnabled()

  await page.reload()

  // The CAD workspace, the active tree tab, the hidden layer and the view scale all survive the refresh.
  await expect(page.getByRole("button", { name: "工程制图" })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("tab", { name: "图层树" })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("button", { name: "显示 图层 1" })).toBeVisible()
  await page.locator('.drawing-viewport[data-view-id="view-front"]').hover()
  await expect(page.getByRole("button", { name: "缩小 主视图" })).toBeEnabled()
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

  await page.getByRole("button", { name: "添加空间点", exact: true }).click()
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

  await page.getByRole("button", { name: "2D 绘图" }).click()
  await page.getByRole("button", { name: "添加直线", exact: true }).click()
  await expect(page.getByRole("region", { name: "工程状态栏" })).toContainText("第1步：点击确定直线的第一个点")

  await page.keyboard.press("Escape")
  await expect(page.getByRole("region", { name: "工程状态栏" })).toContainText("2D 绘图：")
  await expect(page.locator(".engineering-drawing-draft")).toHaveCount(0)
})

test("fills the drafting area with the sheet and keeps an explicit display scale", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "工程制图" }).click()
  await page.waitForSelector(".drawing-sheet")
  // The measured fit arrives after the first paint, so wait for the scale to settle away from the 1:1 default.
  await expect.poll(async () => page.locator(".drawing-sheet").getAttribute("data-sheet-scale")).not.toBe("1.000")

  const geometry = async () => page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector).getBoundingClientRect()
    const areaElement = document.querySelector(".drawing-sheet-area")
    const style = getComputedStyle(areaElement)
    const area = rect(".drawing-sheet-area")
    const sheet = rect(".drawing-sheet")
    return {
      area: { w: Math.round(area.width), h: Math.round(area.height) },
      // The area keeps its own margin; fit is measured against what is left of it.
      available: { w: Math.round(areaElement.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)), h: Math.round(areaElement.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) },
      sheet: { w: Math.round(sheet.width), h: Math.round(sheet.height) },
      scale: Number(document.querySelector(".drawing-sheet").getAttribute("data-sheet-scale")),
      zoomText: document.querySelector("[data-sheet-zoom]").textContent,
      overflowX: document.documentElement.scrollWidth > window.innerWidth
    }
  })

  /** The sheet animates its scale, so a measurement is only trusted once two samples agree. */
  const settle = async () => {
    let previous = ""
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const current = await page.evaluate(() => {
        const sheet = document.querySelector(".drawing-sheet").getBoundingClientRect()
        return `${Math.round(sheet.width)}x${Math.round(sheet.height)}`
      })
      if (current === previous) break
      previous = current
      await page.waitForTimeout(80)
    }
    return geometry()
  }

  const fitted = await settle()
  // Fit means the sheet uses most of the area on its binding axis without ever exceeding it.
  expect(fitted.sheet.h).toBeLessThanOrEqual(fitted.available.h + 1)
  expect(fitted.sheet.w).toBeLessThanOrEqual(fitted.available.w + 1)
  expect(Math.max(fitted.sheet.h / fitted.available.h, fitted.sheet.w / fitted.available.w)).toBeGreaterThan(0.9)
  expect(fitted.zoomText).toContain(`${Math.round(fitted.scale * 100)}%`)
  expect(fitted.overflowX).toBe(false)

  // The automatic fit is overridable: one step in magnifies, and the sheet pans instead of being cropped.
  await page.getByRole("button", { name: "放大图纸" }).click()
  const zoomed = await settle()
  expect(zoomed.scale).toBeGreaterThan(fitted.scale)
  expect(zoomed.sheet.h).toBeGreaterThan(zoomed.available.h)
  expect(await page.locator(".drawing-sheet-area").evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)

  await page.getByRole("button", { name: "适应图纸" }).click()
  const refitted = await settle()
  expect(refitted.scale).toBeCloseTo(fitted.scale, 2)
  expect(await page.locator(".drawing-sheet-area").evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true)
})
