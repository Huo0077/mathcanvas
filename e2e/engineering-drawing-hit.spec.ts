import { expect, test } from "@playwright/test"

/**
 * 「工程图不好画」的两个底层原因，都被这两个度量钉住：
 * 1. `vector-effect: non-scaling-stroke` 下的线宽单位是屏幕像素，写成 0.022 会渲染成 0.085px 的隐形线；
 * 2. 细线的命中带同样只有 0.1px，离中心 1px 就点不中。
 */
test("draft geometry is visible and has a forgiving hit band", async ({ page }) => {
  await page.goto("/")
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/cad-point.mgeo")
  await page.getByRole("button", { name: "工程制图" }).click()
  await page.getByRole("button", { name: "2D 绘图" }).click()

  const surface = page.getByRole("img", { name: /模型视图/ })
  await page.getByRole("button", { name: "添加线段", exact: true }).click()
  await surface.click({ position: { x: 120, y: 160 } })
  await surface.click({ position: { x: 300, y: 160 } })
  await expect(page.locator(".engineering-drawing-draft")).toHaveCount(1)

  const probe = await page.evaluate(() => {
    const line = document.querySelector(".engineering-drawing-draft line") as SVGLineElement | null
    if (!line) return null
    const rect = line.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const hitOffsets: number[] = []
    for (const offset of [0, 2, 5, 6]) {
      const element = document.elementFromPoint(centerX, centerY + offset)
      if (element?.closest("[data-primitive-id]")) hitOffsets.push(offset)
    }
    return { strokeWidth: parseFloat(getComputedStyle(line).strokeWidth), hitOffsets }
  })

  expect(probe).not.toBeNull()
  // 可见：计算线宽必须是像素量级（修复前是 0.04px，等于隐形）。
  // 注意别用 getBoundingClientRect 量——SVG 的 gBCR 不包含 non-scaling-stroke 的描边宽度。
  expect(probe!.strokeWidth).toBeGreaterThanOrEqual(1)
  // 好点：离中心 5px 仍然命中图元（透明命中带 14px；修复前 1px 就点不中）。
  expect(probe!.hitOffsets).toContain(0)
  expect(probe!.hitOffsets).toContain(2)
  expect(probe!.hitOffsets).toContain(5)

  // 点离线 5px 处应该真的选中它，而不是落成新图元或什么都不做。
  await surface.click({ position: { x: 210, y: 165 } })
  await expect(surface.locator('[data-primitive-id][data-selected="true"]')).toHaveCount(1)
  await expect(page.locator(".engineering-drawing-draft")).toHaveCount(1)
})
