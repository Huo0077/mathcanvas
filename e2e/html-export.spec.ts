import { readFile } from "node:fs/promises"

import { expect, test } from "@playwright/test"

/**
 * **HTML 导出**（自包含快照 + 可再导入存档）。
 *
 * 三条判据都由浏览器给：① 平面几何导出后文件里真有内嵌 SVG、且零外链；
 * ② 把它当普通网页打开，图看得见；③ 立体几何**明确拒绝**且不产生下载。
 * 单测已经钉住转义与存档往返（`apps/web/src/persistence/htmlExporter.test.ts`），
 * 这里只管"用户点得到、点完拿到的能用"。
 */
test("exports a self-contained HTML snapshot of a planar figure", async ({ page }) => {
  await page.goto("/")
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/planar-demo.mgeo")

  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "导出 HTML", exact: true }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/\.html$/)

  const html = await readFile(await file.path(), "utf8")
  expect(html).toContain("<svg")
  expect(html).toContain('type="application/json"')
  // 零外部引用：没有外链样式、没有带 src 的 script、没有指向网络的 src/href、没有 @import。
  // （内嵌 SVG 的 `xmlns="http://www.w3.org/2000/svg"` 是 XML 命名空间，不是网络请求。）
  expect(html).not.toMatch(/<link\b/i)
  expect(html).not.toMatch(/<script[^>]*\bsrc=/i)
  expect(html).not.toMatch(/(?:src|href)\s*=\s*["']https?:/i)
  expect(html).not.toMatch(/@import/i)

  // 把文件当普通网页打开：图真的画出来了，损失清单那一节也在。
  await page.setContent(html)
  await expect(page.locator("svg")).toBeVisible()
  await expect(page.getByRole("heading", { level: 2, name: "这次导出漏了什么" })).toBeVisible()
})

test("exports the four CAD views as a self-contained HTML snapshot", async ({ page }) => {
  await page.goto("/")
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/cad-dimension.mgeo")
  await page.getByRole("button", { name: "跳转到工程制图" }).click()

  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "导出 HTML", exact: true }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe("CAD-linear-dimension-A-B.html")
  const html = await readFile(await file.path(), "utf8")

  // 四个视图来自 `exportEngineeringSvg`。**不要断言"主视图"这类中文标签** ——
  // 实测 `svgDrawing`（engineeringExporters.ts:108）只写 `data-drawing-view="front"` 这类属性，
  // 视图的中文名（`drawingViewLabels`）不出现在导出文件里。
  for (const view of ["front", "top", "left", "axonometric"]) expect(html).toContain(`data-drawing-view="${view}"`)
  expect(html.match(/<svg\b/g)).toHaveLength(1)
})

/**
 * **立体几何必须明确拒绝**（spec §4 的硬性要求）。
 *
 * 反例很具体：照现有分支走，3D 文档会落进平面导出器的 `else`，得到一份
 * "导出成功、HTML 里只有一个坐标网格"的文件。所以判据是"报错 + 不产生下载"，
 * 不是"文件是空的"。
 */
test("refuses HTML export in the 3D workspace instead of writing an empty file", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()

  let downloaded = false
  page.on("download", () => { downloaded = true })
  await page.getByRole("button", { name: "导出 HTML", exact: true }).click()

  await expect(page.getByRole("alert")).toContainText("立体几何")
  expect(downloaded).toBe(false)
})
