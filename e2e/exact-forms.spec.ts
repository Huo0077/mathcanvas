import { expect, test } from "@playwright/test"

/**
 * 「精确形式」面板**已按用户要求删除**（2026-09-18，用户口径：「删除右侧的"精确形式"，似乎没什么用」）。
 *
 * 这份用例保住了删除的**边界**：面板整块不再存在（标签、行、空状态文案都没有），
 * 而"量一个圆的面积"这条主路径照旧可用、读数照旧常驻画布。
 * 之所以不删掉整个文件：它原本就是唯一走完整路径的浏览器用例（画圆 → 改半径 → 量面积），
 * 删掉面板的展示不该顺手丢掉这段覆盖。
 */
test("no longer shows the exact-form panel, while measuring still works", async ({ page }) => {
  await page.goto("/")
  const ribbon = page.getByRole("region", { name: "功能区" })
  await page.getByRole("button", { name: "固定功能区" }).click()
  const algebra = page.locator(".algebra-panel")
  const canvas = page.locator("svg[aria-label='几何画布']")

  // 面板整块不存在：不选中任何东西时也没有，量完之后也没有。
  await expect(page.locator('[aria-label="数值转换"]')).toHaveCount(0)
  await expect(page.locator("[data-exact-form-panel], [data-exact-form-row]")).toHaveCount(0)
  await expect(page.getByText("还没有测量：先在画布上量一个长度、角度或面积。")).toHaveCount(0)
  // 属性栏仍然从自己的标题开始（删掉的只是那块只读展示）。
  // 收窄到 `.properties`：左侧对象列表面板里也有一个 `.panel-title`。
  await expect(page.locator(".properties .panel-title")).toHaveText("属性面板")

  // 半径 2 的圆。
  const box = (await canvas.boundingBox())!
  await ribbon.getByRole("button", { name: "添加圆", exact: true }).click()
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.5)
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.5)
  await algebra.getByText("圆 1", { exact: true }).click()
  await page.getByRole("spinbutton", { name: "圆心 X" }).fill("0")
  await page.getByRole("spinbutton", { name: "圆心 Y" }).fill("0")
  await page.getByRole("spinbutton", { name: "半径" }).fill("2")

  // 量面积：π·2² = 4π ≈ 12.566 —— 测量本身照旧，读数照旧常驻画布。
  await page.locator('[aria-label="平面测量工具"]').getByRole("button", { name: "面积", exact: true }).click()
  await expect(canvas).toContainText("12.566")

  // 量完之后面板依然不在（这一条防的是"面板只是被藏起来、又慢慢长回来"）。
  await expect(page.locator('[aria-label="数值转换"]')).toHaveCount(0)
  await expect(page.locator("[data-exact-form-row]")).toHaveCount(0)
})
